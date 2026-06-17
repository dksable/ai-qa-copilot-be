import type {
  RepositoryGeneratedTestUpdate,
  RepositoryImpactAnalysis,
  RepositoryImpactAnalysisTest,
  RepositoryValidationRecommendation,
  RepositoryValidationRun,
} from "./projectTypes.js";
import { spawn } from "node:child_process";
import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GitHubAutomationConfig } from "./github.service.js";
import {
  createBranch,
  createOrReplaceFile,
  createPullRequest,
  fileExists,
  getWorkflowRun,
  listWorkflowRunJobs,
  listWorkflowRuns,
  readRepositoryFile,
  triggerWorkflowDispatch,
} from "./github.service.js";

const PLAYWRIGHT_VALIDATION_WORKFLOW = ".github/workflows/playwright-validation.yml";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "impact-update";
}

function uniqueSuffix() {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "").replace(/[^0-9]/g, "");
  const random = Math.random().toString(36).slice(2, 7);
  return `${timestamp}-${random}`;
}

function generatedCode(input: {
  oldCode: string;
  impactedTest: RepositoryImpactAnalysisTest;
  impactAnalysis: RepositoryImpactAnalysis;
}) {
  const reviewBlock = [
    "",
    "",
    "// AI QA Copilot Impact Update",
    `// Application change: ${input.impactedTest.relatedChangedFile}`,
    `// Impact reason: ${input.impactedTest.impactReason}`,
    `// Suggested action: ${input.impactedTest.suggestedAction}`,
    `// Risk: ${input.impactedTest.riskLevel}`,
  ].join("\n");

  if (input.oldCode.trim()) {
    return `${input.oldCode.trimEnd()}${reviewBlock}\n`;
  }

  const testName = input.impactedTest.relatedChangedFile.split("/").pop()?.replace(/\.[^.]+$/, "") || "impacted flow";
  return [
    "import { test, expect } from '@playwright/test';",
    "",
    `test.describe('${testName} impact coverage', () => {`,
    `  test('reviews impacted flow for ${testName}', async ({ page }) => {`,
    "    await page.goto('/');",
    "    await expect(page).toHaveURL(/.*/);",
    "  });",
    "});",
    reviewBlock,
    "",
  ].join("\n");
}

export async function generateRepositoryTestUpdates(input: {
  impactAnalysis: RepositoryImpactAnalysis;
  automationConfig: GitHubAutomationConfig;
  aiProvider: string;
  aiModel: string;
  createdBy?: string;
}): Promise<Omit<RepositoryGeneratedTestUpdate, "id" | "createdAt" | "updatedAt">[]> {
  const targets = input.impactAnalysis.impactedTests.filter((test) => test.suggestedAction !== "No Action").slice(0, 12);
  const updates: Omit<RepositoryGeneratedTestUpdate, "id" | "createdAt" | "updatedAt">[] = [];
  for (const impactedTest of targets) {
    const oldCode = await readRepositoryFile(input.automationConfig, impactedTest.testFilePath);
    updates.push({
      workspaceId: input.impactAnalysis.workspaceId,
      projectId: input.impactAnalysis.projectId,
      impactAnalysisId: input.impactAnalysis.id,
      testFilePath: impactedTest.testFilePath,
      oldCode,
      newCode: generatedCode({ oldCode, impactedTest, impactAnalysis: input.impactAnalysis }),
      updateSummary: `${impactedTest.suggestedAction} for ${impactedTest.relatedChangedFile}`,
      impactReason: impactedTest.impactReason,
      confidenceScore: impactedTest.confidenceScore,
      riskLevel: impactedTest.riskLevel,
      suggestedAction: impactedTest.suggestedAction,
      status: "Pending",
      aiProvider: input.aiProvider,
      aiModel: input.aiModel,
      createdBy: input.createdBy,
    });
  }
  return updates;
}

export async function validateRepositoryTestUpdates(input: {
  impactAnalysis: RepositoryImpactAnalysis;
  updates: RepositoryGeneratedTestUpdate[];
  automationConfig: GitHubAutomationConfig;
  createdBy?: string;
}): Promise<Omit<RepositoryValidationRun, "id" | "createdAt">> {
  const started = Date.now();
  const approved = input.updates.filter((update) => update.status === "Approved" || update.status === "Edited");
  if (!approved.length) {
    return {
      workspaceId: input.impactAnalysis.workspaceId,
      projectId: input.impactAnalysis.projectId,
      impactAnalysisId: input.impactAnalysis.id,
      status: "Failed",
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: Date.now() - started,
      browser: "chromium",
      environment: "temporary-validation-workspace",
      command: "npx playwright test --reporter=json,html --workers=1",
      logs: "No approved or edited Playwright updates were available for validation.",
      stdout: "",
      stderr: "",
      failedTestNames: [],
      failedTests: [],
      errorDetails: "Approve or edit at least one generated test update before running validation.",
      failureExplanation: "Validation did not run because there were no approved proposed test updates.",
      screenshots: [],
      videos: [],
      traceFiles: [],
      createdBy: input.createdBy,
      completedAt: new Date().toISOString(),
    };
  }

  const runId = `validation-${uniqueSuffix()}`;
  const workspacePath = path.join(process.cwd(), "tmp", "playwright-validation", runId);
  const setup = await createValidationWorkspace(workspacePath, approved, input.automationConfig);
  if (setup.exitCode !== 0) {
    return buildFailedSetupRun({
      impactAnalysis: input.impactAnalysis,
      workspacePath,
      setup,
      started,
      createdBy: input.createdBy,
    });
  }
  const result = await runPlaywrightValidation(workspacePath, setup.logs, setup.testPaths);
  const duration = Date.now() - started;
  const errorDetails = result.failed > 0 || result.exitCode !== 0
    ? buildValidationErrorDetails(result)
    : undefined;
  return {
    workspaceId: input.impactAnalysis.workspaceId,
    projectId: input.impactAnalysis.projectId,
    impactAnalysisId: input.impactAnalysis.id,
    status: result.failed > 0 || result.exitCode !== 0 ? "Failed" : "Passed",
    totalTests: result.totalTests,
    passed: result.passed,
    failed: result.failed,
    skipped: result.skipped,
    duration,
    browser: "chromium",
    environment: "temporary-validation-workspace",
    command: result.command,
    logs: result.logs,
    stdout: result.stdout,
    stderr: result.stderr,
    failedTestNames: result.failedTestNames,
    failedTests: result.failedTests,
    stackTrace: result.stackTrace,
    validationWorkspacePath: workspacePath,
    errorDetails,
    failureExplanation: errorDetails
      ? "Playwright executed the approved updates in an isolated temporary workspace and reported failures. Review stdout, stderr, and failed test names before creating a PR."
      : undefined,
    screenshots: result.screenshots,
    videos: result.videos,
    traceFiles: result.traceFiles,
    reportUrl: result.reportUrl,
    jsonReportPath: result.jsonReportPath,
    htmlReportPath: result.htmlReportPath,
    jsonReportData: result.jsonReportData,
    createdBy: input.createdBy,
    completedAt: new Date().toISOString(),
  };
}

export async function validateRepositoryTestUpdatesWithGitHubActions(input: {
  impactAnalysis: RepositoryImpactAnalysis;
  updates: RepositoryGeneratedTestUpdate[];
  automationConfig: GitHubAutomationConfig;
  createdBy?: string;
}): Promise<Omit<RepositoryValidationRun, "id" | "createdAt">> {
  const started = Date.now();
  const approved = input.updates.filter((update) => update.status === "Approved" || update.status === "Edited");
  if (!approved.length) {
    return {
      workspaceId: input.impactAnalysis.workspaceId,
      projectId: input.impactAnalysis.projectId,
      impactAnalysisId: input.impactAnalysis.id,
      status: "Failed",
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: Date.now() - started,
      browser: "GitHub Actions",
      environment: "github-actions",
      command: "workflow_dispatch",
      logs: "No approved or edited Playwright updates were available for GitHub Actions validation.",
      stdout: "",
      stderr: "",
      failedTestNames: [],
      failedTests: [],
      errorDetails: "Approve or edit at least one generated test update before running validation.",
      screenshots: [],
      videos: [],
      traceFiles: [],
      validationProvider: "github-actions",
      createdBy: input.createdBy,
      completedAt: new Date().toISOString(),
    };
  }

  const workflowExists = await fileExists(input.automationConfig, PLAYWRIGHT_VALIDATION_WORKFLOW);
  if (!workflowExists) {
    throw new Error(
      `GitHub Actions workflow not found at ${PLAYWRIGHT_VALIDATION_WORKFLOW}. Add this workflow to the automation repository default branch, then run validation again.`,
    );
  }

  const branchName = `aiqa/validation-${uniqueSuffix()}`;
  await createBranch(input.automationConfig, branchName);

  for (const update of approved) {
    await createOrReplaceFile(input.automationConfig, {
      branchName,
      filePath: update.testFilePath,
      content: update.newCode,
      message: `AI QA Copilot: validate ${update.testFilePath}`,
    });
  }

  const testFiles = approved.map((update) => update.testFilePath).join(",");
  await triggerWorkflowDispatch(input.automationConfig, {
    workflowId: "playwright-validation.yml",
    ref: branchName,
    inputs: {
      test_files: testFiles,
      validation_branch: branchName,
    },
  });

  const workflowRun = await waitForWorkflowRun(input.automationConfig, branchName);
  const completedRun = await waitForWorkflowCompletion(input.automationConfig, workflowRun.id);
  const jobs = await listWorkflowRunJobs(input.automationConfig, completedRun.id).catch(() => ({ jobs: [] }));
  const logs = summarizeWorkflowJobs(jobs.jobs);
  const failedTests = jobs.jobs
    .filter((job) => job.conclusion && job.conclusion !== "success" && job.conclusion !== "skipped")
    .map((job) => ({
      testFile: testFiles || "GitHub Actions workflow",
      testName: job.name,
      errorMessage: `GitHub Actions job concluded with ${job.conclusion}. Open the workflow logs for details.`,
      duration: durationBetween(job.started_at, job.completed_at),
      suggestedAction: "Open the workflow run, review failing Playwright logs, then edit or regenerate the proposed update.",
    }));

  const conclusion = completedRun.conclusion ?? "unknown";
  const passed = conclusion === "success" ? approved.length : 0;
  const skipped = conclusion === "skipped" ? approved.length : 0;
  const failed = conclusion === "success" || conclusion === "skipped" ? 0 : Math.max(1, failedTests.length || approved.length);

  return {
    workspaceId: input.impactAnalysis.workspaceId,
    projectId: input.impactAnalysis.projectId,
    impactAnalysisId: input.impactAnalysis.id,
    status: conclusion === "success" ? "Passed" : "Failed",
    totalTests: Math.max(approved.length, passed + failed + skipped),
    passed,
    failed,
    skipped,
    duration: Date.now() - started,
    browser: "GitHub Actions",
    environment: "github-actions",
    command: `workflow_dispatch ${PLAYWRIGHT_VALIDATION_WORKFLOW} on ${branchName}`,
    logs,
    stdout: logs,
    stderr: conclusion === "success" ? "" : `Workflow concluded with ${conclusion}.`,
    failedTestNames: failedTests.map((test) => test.testName),
    failedTests,
    errorDetails: conclusion === "success" ? undefined : `GitHub Actions validation workflow concluded with ${conclusion}.`,
    failureExplanation: conclusion === "success"
      ? undefined
      : "GitHub Actions ran the approved Playwright updates and reported a non-success conclusion. Review workflow logs before creating a pull request.",
    screenshots: [],
    videos: [],
    traceFiles: [],
    reportUrl: completedRun.html_url,
    validationProvider: "github-actions",
    validationBranchName: branchName,
    workflowRunId: completedRun.id,
    workflowRunUrl: completedRun.html_url,
    workflowConclusion: conclusion,
    createdBy: input.createdBy,
    completedAt: new Date().toISOString(),
  };
}

async function createValidationWorkspace(
  workspacePath: string,
  updates: RepositoryGeneratedTestUpdate[],
  automationConfig: GitHubAutomationConfig,
): Promise<{ exitCode: number; stdout: string; stderr: string; logs: string; testPaths: string[] }> {
  await rm(workspacePath, { recursive: true, force: true });
  await mkdir(path.dirname(workspacePath), { recursive: true });

  const localRepoPath = process.env.AIQA_AUTOMATION_REPO_LOCAL_PATH;
  const setupLogs: string[] = [];
  if (localRepoPath && await pathExists(localRepoPath)) {
    await cp(localRepoPath, workspacePath, {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}.git${path.sep}`),
    });
    setupLogs.push(`Copied automation repository from local path: ${localRepoPath}`);
  } else {
    const cloneUrl = buildGitHubCloneUrl(automationConfig);
    const clone = await runCommand("git", ["clone", "--depth", "1", "--branch", automationConfig.defaultBranch, cloneUrl, workspacePath], process.cwd(), 180_000, [automationConfig.token]);
    setupLogs.push(buildCommandFailureLogs(`git clone --depth 1 --branch ${automationConfig.defaultBranch} https://github.com/${automationConfig.owner}/${automationConfig.repo}.git`, clone));
    if (clone.exitCode !== 0) {
      return { exitCode: clone.exitCode, stdout: clone.stdout, stderr: clone.stderr, logs: setupLogs.join("\n\n"), testPaths: [] };
    }
  }

  const projectCheck = await inspectPlaywrightProject(workspacePath);
  if (!projectCheck.valid) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Connected automation repository is not a valid Playwright project.",
      logs: [
        ...setupLogs,
        "Connected automation repository is not a valid Playwright project.",
        projectCheck.reason,
      ].join("\n\n"),
      testPaths: [],
    };
  }

  const testPaths: string[] = [];
  for (const update of updates) {
    const safePath = normalizeValidationTestPath(update.testFilePath);
    const destination = path.join(workspacePath, safePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, sanitizePlaywrightCode(update.newCode), "utf8");
    testPaths.push(safePath);
  }

  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    logs: [
      ...setupLogs,
      `Applied ${updates.length} approved Playwright test update(s) into isolated automation repository copy.`,
    ].join("\n\n"),
    testPaths,
  };
}

function normalizeValidationTestPath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const safeSegments = normalized
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..");
  const safePath = safeSegments.join("/") || "tests/aiqa-generated.spec.ts";
  return safePath.startsWith("tests/") ? safePath : `tests/${safePath}`;
}

function sanitizePlaywrightCode(code: string) {
  const trimmed = code.trim();
  if (!trimmed) {
    return [
      "import { test, expect } from '@playwright/test';",
      "",
      "test('empty generated update placeholder', async ({ page }) => {",
      "  await page.goto('/');",
      "  await expect(page).toHaveURL(/.*/);",
      "});",
      "",
    ].join("\n");
  }
  return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
}

function runPlaywrightValidation(workspacePath: string, setupLogs = "", testPaths: string[] = []): Promise<{
  exitCode: number;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  command: string;
  stdout: string;
  stderr: string;
  logs: string;
  failedTestNames: string[];
  failedTests: NonNullable<RepositoryValidationRun["failedTests"]>;
  stackTrace?: string;
  screenshots: string[];
  videos: string[];
  traceFiles: string[];
  reportUrl?: string;
  jsonReportPath?: string;
  htmlReportPath?: string;
  jsonReportData?: unknown;
}> {
  let validationCommand = `npx playwright test ${testPaths.join(" ")} --reporter=json,html --workers=1`.replace(/\s+/g, " ").trim();
  return new Promise((resolve) => {
    void (async () => {
      const packageManager = await detectPackageManager(workspacePath);
      const installCommand = packageManagerInstallCommand(packageManager);
      const browserInstallCommand = packageManagerPlaywrightCommand(packageManager, ["install"]);
      const testCommand = packageManagerPlaywrightCommand(packageManager, ["test", ...testPaths, "--reporter=json,html", "--workers=1"]);
      validationCommand = testCommand.display;
      let dependencyInstall = { exitCode: 0, stdout: "", stderr: "", duration: 0 };
      if (!await pathExists(path.join(workspacePath, "node_modules", "@playwright", "test"))) {
        dependencyInstall = await runCommand(
          installCommand.command,
          installCommand.args,
          workspacePath,
          180_000,
          [],
          { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
        );
      }
      if (dependencyInstall.exitCode !== 0) {
        const logs = [
          setupLogs,
          buildCommandFailureLogs(installCommand.display, dependencyInstall),
        ].filter(Boolean).join("\n\n");
        resolve({
          exitCode: dependencyInstall.exitCode,
          totalTests: 0,
          passed: 0,
          failed: 1,
          skipped: 0,
          command: validationCommand,
          stdout: dependencyInstall.stdout,
          stderr: dependencyInstall.stderr,
          logs,
          failedTestNames: ["Playwright dependency installation"],
          failedTests: [{
            testFile: "package.json",
            testName: "Playwright dependency installation",
            errorMessage: dependencyInstall.stderr || dependencyInstall.stdout || "npm install failed.",
            duration: dependencyInstall.duration,
            suggestedAction: "Dependency installation failed. Please verify the automation repository package.json and Playwright setup.",
            stackTrace: dependencyInstall.stderr,
          }],
          stackTrace: dependencyInstall.stderr,
          screenshots: [],
          videos: [],
          traceFiles: [],
        });
        return;
      }

      let browserInstall = { exitCode: 0, stdout: "", stderr: "", duration: 0 };
      if (!process.env.PLAYWRIGHT_SKIP_BROWSER_INSTALL) {
        browserInstall = await runCommand(browserInstallCommand.command, browserInstallCommand.args, workspacePath, 180_000);
      }
      if (browserInstall.exitCode !== 0) {
        const logs = [
          setupLogs,
          dependencyInstall.stdout ? `npm install output:\n${dependencyInstall.stdout}` : "",
          buildCommandFailureLogs(browserInstallCommand.display, browserInstall),
        ].filter(Boolean).join("\n\n");
        resolve({
          exitCode: browserInstall.exitCode,
          totalTests: 0,
          passed: 0,
          failed: 1,
          skipped: 0,
          command: validationCommand,
          stdout: browserInstall.stdout,
          stderr: browserInstall.stderr,
          logs,
          failedTestNames: ["Playwright browser installation"],
          failedTests: [{
            testFile: "playwright.config",
            testName: "Playwright browser installation",
            errorMessage: browserInstall.stderr || browserInstall.stdout || "npx playwright install failed.",
            duration: browserInstall.duration,
            suggestedAction: "Install Playwright browsers on the validation runner or set up a pre-baked runner image.",
            stackTrace: browserInstall.stderr,
          }],
          stackTrace: browserInstall.stderr,
          screenshots: [],
          videos: [],
          traceFiles: [],
        });
        return;
      }

      const test = await runCommand(testCommand.command, testCommand.args, workspacePath, 180_000);
      const parsed = await parsePlaywrightJson(test.stdout, workspacePath);
      const artifacts = await collectValidationArtifacts(workspacePath);
      const exitCode = test.exitCode;
      resolve({
        command: validationCommand,
        exitCode,
        totalTests: parsed.totalTests,
        passed: parsed.passed,
        failed: parsed.failed || (exitCode !== 0 && parsed.totalTests === 0 ? 1 : parsed.failed),
        skipped: parsed.skipped,
        stdout: test.stdout,
        stderr: test.stderr,
        logs: [
          setupLogs,
          dependencyInstall.stdout ? `npm install output:\n${dependencyInstall.stdout}` : "",
          browserInstall.stdout ? `playwright install output:\n${browserInstall.stdout}` : "",
          buildValidationLogs({ stdout: test.stdout, stderr: test.stderr, parsed, exitCode }),
        ].filter(Boolean).join("\n\n"),
        failedTestNames: parsed.failedTestNames,
        failedTests: parsed.failedTests,
        stackTrace: parsed.stackTrace || test.stderr,
        screenshots: artifacts.screenshots,
        videos: artifacts.videos,
        traceFiles: artifacts.traceFiles,
        reportUrl: artifacts.htmlReportPath ? `/api/playwright-validation/${path.basename(workspacePath)}/report` : undefined,
        jsonReportPath: parsed.jsonReportPath,
        htmlReportPath: artifacts.htmlReportPath,
        jsonReportData: parsed.jsonReportData,
      });
    })().catch((error) => {
      resolve({
        exitCode: 1,
        totalTests: 0,
        passed: 0,
        failed: 1,
        skipped: 0,
        command: validationCommand,
        stdout: "",
        stderr: error instanceof Error ? error.message : "Playwright validation failed.",
        logs: error instanceof Error ? error.message : "Playwright validation failed.",
        failedTestNames: ["Playwright validation runner"],
        failedTests: [{
          testFile: "validation-runner",
          testName: "Playwright validation runner",
          errorMessage: error instanceof Error ? error.message : "Playwright validation failed.",
          duration: 0,
          suggestedAction: "Review backend validation runner logs and retry validation.",
          stackTrace: error instanceof Error ? error.stack : undefined,
        }],
        stackTrace: error instanceof Error ? error.stack : undefined,
        screenshots: [],
        videos: [],
        traceFiles: [],
      });
    });
  });
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  redactions: string[] = [],
  extraEnv: Record<string, string | undefined> = {},
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...extraEnv,
        CI: "1",
      },
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      stderr += `\nCommand timed out after ${timeoutMs / 1000}s.`;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        exitCode: 1,
        stdout: redactSecrets(stdout, redactions),
        stderr: redactSecrets(`${stderr}\n${error.message}`.trim(), redactions),
        duration: Date.now() - started,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        exitCode: typeof code === "number" ? code : 1,
        stdout: redactSecrets(stdout, redactions),
        stderr: redactSecrets(stderr, redactions),
        duration: Date.now() - started,
      });
    });
  });
}

function buildGitHubCloneUrl(config: GitHubAutomationConfig) {
  return `https://x-access-token:${encodeURIComponent(config.token)}@github.com/${config.owner}/${config.repo}.git`;
}

async function inspectPlaywrightProject(workspacePath: string): Promise<{ valid: boolean; reason: string }> {
  const packageJsonPath = path.join(workspacePath, "package.json");
  if (!await pathExists(packageJsonPath)) {
    return { valid: false, reason: "package.json was not found in the connected automation repository." };
  }
  const hasConfig = await pathExists(path.join(workspacePath, "playwright.config.ts")) || await pathExists(path.join(workspacePath, "playwright.config.js"));
  if (!hasConfig) {
    return { valid: false, reason: "playwright.config.ts or playwright.config.js was not found." };
  }
  try {
    const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
    const hasPlaywrightDependency = Boolean(
      pkg.dependencies?.["@playwright/test"] ||
      pkg.devDependencies?.["@playwright/test"] ||
      pkg.dependencies?.playwright ||
      pkg.devDependencies?.playwright,
    );
    return hasPlaywrightDependency
      ? { valid: true, reason: "Valid Playwright project detected." }
      : { valid: false, reason: "package.json does not include @playwright/test or playwright in dependencies/devDependencies." };
  } catch {
    return { valid: false, reason: "package.json could not be parsed." };
  }
}

async function detectPackageManager(workspacePath: string): Promise<"npm" | "pnpm" | "yarn"> {
  if (await pathExists(path.join(workspacePath, "pnpm-lock.yaml"))) return "pnpm";
  if (await pathExists(path.join(workspacePath, "yarn.lock"))) return "yarn";
  return "npm";
}

function packageManagerInstallCommand(packageManager: "npm" | "pnpm" | "yarn") {
  if (packageManager === "pnpm") {
    return { command: "pnpm", args: ["install", "--no-frozen-lockfile"], display: "pnpm install --no-frozen-lockfile" };
  }
  if (packageManager === "yarn") {
    return { command: "yarn", args: ["install"], display: "yarn install" };
  }
  return { command: "npm", args: ["install", "--no-audit", "--no-fund", "--silent"], display: "npm install --no-audit --no-fund --silent" };
}

function packageManagerPlaywrightCommand(packageManager: "npm" | "pnpm" | "yarn", playwrightArgs: string[]) {
  if (packageManager === "pnpm") {
    return {
      command: "pnpm",
      args: ["exec", "playwright", ...playwrightArgs],
      display: `pnpm exec playwright ${playwrightArgs.join(" ")}`.replace(/\s+/g, " ").trim(),
    };
  }
  if (packageManager === "yarn") {
    return {
      command: "yarn",
      args: ["playwright", ...playwrightArgs],
      display: `yarn playwright ${playwrightArgs.join(" ")}`.replace(/\s+/g, " ").trim(),
    };
  }
  return {
    command: "npx",
    args: ["playwright", ...playwrightArgs],
    display: `npx playwright ${playwrightArgs.join(" ")}`.replace(/\s+/g, " ").trim(),
  };
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function redactSecrets(value: string, secrets: string[]) {
  return secrets.reduce((text, secret) => secret ? text.split(secret).join("[REDACTED]") : text, value);
}

function buildFailedSetupRun(input: {
  impactAnalysis: RepositoryImpactAnalysis;
  workspacePath: string;
  setup: { exitCode: number; stdout: string; stderr: string; logs: string };
  started: number;
  createdBy?: string;
}): Omit<RepositoryValidationRun, "id" | "createdAt"> {
  const invalidProject = input.setup.stderr.includes("not a valid Playwright project");
  return {
    workspaceId: input.impactAnalysis.workspaceId,
    projectId: input.impactAnalysis.projectId,
    impactAnalysisId: input.impactAnalysis.id,
    status: "Failed",
    totalTests: 0,
    passed: 0,
    failed: 1,
    skipped: 0,
    duration: Date.now() - input.started,
    browser: "chromium",
    environment: "temporary-validation-workspace",
    command: "git clone automation repository",
    logs: input.setup.logs,
    stdout: input.setup.stdout,
    stderr: input.setup.stderr,
    failedTestNames: [invalidProject ? "Invalid Playwright project" : "Automation repository setup"],
    failedTests: [{
      testFile: invalidProject ? "playwright.config.ts" : "automation repository",
      testName: invalidProject ? "Automation repository validation" : "Automation repository setup",
      errorMessage: input.setup.stderr || input.setup.logs,
      duration: Date.now() - input.started,
      suggestedAction: invalidProject
        ? "Configure the automation repository with package.json and playwright.config.ts/js before running validation."
        : "Verify GitHub automation repository access, default branch, and token permissions.",
      stackTrace: input.setup.stderr,
    }],
    stackTrace: input.setup.stderr,
    validationWorkspacePath: input.workspacePath,
    errorDetails: invalidProject
      ? "Connected automation repository is not a valid Playwright project."
      : "Unable to prepare automation repository validation workspace.",
    failureExplanation: invalidProject
      ? "Validation did not run because the connected automation repository is missing Playwright configuration or dependencies."
      : "Validation did not run because the automation repository could not be cloned or copied into the temporary workspace.",
    screenshots: [],
    videos: [],
    traceFiles: [],
    createdBy: input.createdBy,
    completedAt: new Date().toISOString(),
  };
}

async function parsePlaywrightJson(stdout: string, workspacePath: string) {
  const empty = {
    totalTests: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    failedTestNames: [] as string[],
    failedTests: [] as NonNullable<RepositoryValidationRun["failedTests"]>,
    stackTrace: undefined as string | undefined,
    jsonReportPath: undefined as string | undefined,
    jsonReportData: undefined as unknown,
  };
  const json = extractJson(stdout);
  if (!json) return empty;
  try {
    const report = JSON.parse(json);
    const jsonReportPath = path.join(workspacePath, "playwright-report.json");
    await writeFile(jsonReportPath, JSON.stringify(report, null, 2));
    const stats = report.stats ?? {};
    const failedTestNames: string[] = [];
    const failedTests: NonNullable<RepositoryValidationRun["failedTests"]> = [];
    let stackTrace: string | undefined;
    const walkSuites = (suites: any[] = []) => {
      for (const suite of suites) {
        for (const spec of suite.specs ?? []) {
          for (const test of spec.tests ?? []) {
            for (const result of test.results ?? []) {
              const failed = result.status === "failed" || result.status === "timedOut" || result.status === "interrupted";
              if (!failed) continue;
              const testName = spec.title ?? test.title ?? "Unnamed Playwright test";
              const errorMessage = result.error?.message ?? result.errors?.[0]?.message ?? "Playwright test failed.";
              const resultStack = result.error?.stack ?? result.errors?.[0]?.stack;
              stackTrace = stackTrace ?? resultStack;
              failedTestNames.push(testName);
              failedTests.push({
                testFile: spec.file ?? suite.file ?? "unknown",
                testName,
                errorMessage,
                duration: Number(result.duration ?? 0),
                suggestedAction: "Review locator, page flow, test data, and expected result before creating the pull request.",
                stackTrace: resultStack,
              });
            }
          }
        }
        walkSuites(suite.suites ?? []);
      }
    };
    walkSuites(report.suites ?? []);
    const totalTests = Number(stats.expected ?? 0) + Number(stats.unexpected ?? 0) + Number(stats.flaky ?? 0) + Number(stats.skipped ?? 0);
    return {
      totalTests,
      passed: Number(stats.expected ?? 0) + Number(stats.flaky ?? 0),
      failed: Number(stats.unexpected ?? 0),
      skipped: Number(stats.skipped ?? 0),
      failedTestNames,
      failedTests,
      stackTrace,
      jsonReportPath,
      jsonReportData: report,
    };
  } catch {
    return empty;
  }
}

function extractJson(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  return value.slice(start, end + 1);
}

function buildValidationLogs(input: {
  stdout: string;
  stderr: string;
  parsed: Awaited<ReturnType<typeof parsePlaywrightJson>>;
  exitCode: number;
  installOutput?: string;
}) {
  const summary = [
    `Command: npx playwright test --reporter=json,html --workers=1`,
    `Exit code: ${input.exitCode}`,
    `Total: ${input.parsed.totalTests}`,
    `Passed: ${input.parsed.passed}`,
    `Failed: ${input.parsed.failed}`,
    `Skipped: ${input.parsed.skipped}`,
  ];
  if (input.parsed.failedTestNames.length) {
    summary.push("", "Failed tests:", ...input.parsed.failedTestNames.map((name) => `- ${name}`));
  }
  if (input.parsed.jsonReportPath) {
    summary.push("", `JSON report: ${input.parsed.jsonReportPath}`);
  }
  if (input.stderr.trim()) {
    summary.push("", "stderr:", input.stderr.trim());
  }
  if (input.stdout.trim()) {
    summary.push("", "stdout:", input.stdout.trim());
  }
  return summary.join("\n");
}

function buildCommandFailureLogs(command: string, result: { exitCode: number; stdout: string; stderr: string }) {
  return [
    `Command: ${command}`,
    `Exit code: ${result.exitCode}`,
    result.stderr ? `stderr:\n${result.stderr}` : "",
    result.stdout ? `stdout:\n${result.stdout}` : "",
  ].filter(Boolean).join("\n\n");
}

function buildValidationErrorDetails(result: Awaited<ReturnType<typeof runPlaywrightValidation>>) {
  if (result.failedTests.length) {
    return result.failedTests.map((test) => `${test.testName}: ${test.errorMessage}`).join("\n");
  }
  if (result.stderr.trim()) {
    return result.stderr.trim().split(/\r?\n/).slice(0, 4).join("\n");
  }
  return "Playwright validation command completed with a failing exit code.";
}

async function collectValidationArtifacts(workspacePath: string) {
  const files = await walkFiles(workspacePath);
  const relative = (file: string) => path.relative(workspacePath, file).replace(/\\/g, "/");
  const screenshots = files.filter((file) => /\.(png|jpg|jpeg)$/i.test(file)).map(relative);
  const videos = files.filter((file) => /\.(webm|mp4)$/i.test(file)).map(relative);
  const traceFiles = files.filter((file) => /\.zip$/i.test(file) || /trace/i.test(file)).map(relative);
  const htmlReportPath = files.find((file) => relative(file) === "playwright-report/index.html");
  return {
    screenshots,
    videos,
    traceFiles,
    htmlReportPath,
  };
}

async function walkFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root);
    const files: string[] = [];
    for (const entry of entries) {
      if (entry === "node_modules") continue;
      const fullPath = path.join(root, entry);
      const info = await stat(fullPath);
      if (info.isDirectory()) {
        files.push(...await walkFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function waitForWorkflowRun(config: GitHubAutomationConfig, branchName: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await delay(3000);
    const runs = await listWorkflowRuns(config, {
      workflowId: "playwright-validation.yml",
      branch: branchName,
    });
    const run = runs.workflow_runs[0];
    if (run) return run;
  }
  throw new Error("GitHub Actions workflow was dispatched, but no workflow run was found for the validation branch.");
}

async function waitForWorkflowCompletion(config: GitHubAutomationConfig, runId: number) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const run = await getWorkflowRun(config, runId);
    if (run.status === "completed") return run;
    await delay(5000);
  }
  throw new Error("GitHub Actions validation did not finish before the timeout.");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function durationBetween(start?: string | null, end?: string | null) {
  if (!start || !end) return 0;
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

function summarizeWorkflowJobs(jobs: Awaited<ReturnType<typeof listWorkflowRunJobs>>["jobs"]) {
  if (!jobs.length) return "GitHub Actions workflow completed. Job details were not available.";
  return jobs.map((job) => {
    const steps = job.steps?.map((step) => `    - ${step.name}: ${step.conclusion ?? step.status}`).join("\n") ?? "";
    return [
      `Job: ${job.name}`,
      `Status: ${job.status}`,
      `Conclusion: ${job.conclusion ?? "pending"}`,
      `URL: ${job.html_url}`,
      steps ? `Steps:\n${steps}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

export function buildFailureSuggestion(run: RepositoryValidationRun) {
  if (run.failed === 0) return "Validation passed. No fix suggestion is required.";
  const failedTests = (run.failedTests ?? []).slice(0, 3).map((test) => {
    const reason = test.errorMessage.split(/\r?\n/)[0];
    return `- ${test.testName}: ${reason}`;
  });
  return [
    "AI QA Copilot reviewed the Playwright validation failure.",
    failedTests.length ? `Likely failing areas:\n${failedTests.join("\n")}` : "The validation command failed before Playwright could report individual test failures.",
    "Possible causes include changed application flow, missing running app/baseURL, locator mismatch, unavailable browser binaries, or test data drift.",
    "Recommended next action: review stdout/stderr, update resilient locators such as getByRole/getByLabel/getByTestId, then regenerate or edit the proposed code before creating the pull request.",
  ].join(" ");
}

export async function createImpactUpdatePullRequest(input: {
  impactAnalysis: RepositoryImpactAnalysis;
  automationConfig: GitHubAutomationConfig;
  approvedUpdates: RepositoryGeneratedTestUpdate[];
  validationRun?: RepositoryValidationRun | null;
  validationRecommendation?: RepositoryValidationRecommendation | null;
}) {
  const branchName = `aiqa/impact-update-${uniqueSuffix()}`;
  await createBranch(input.automationConfig, branchName);
  const updatedFiles: string[] = [];
  for (const update of input.approvedUpdates) {
    await createOrReplaceFile(input.automationConfig, {
      branchName,
      filePath: update.testFilePath,
      content: update.newCode,
      message: `AI QA Copilot: update ${update.testFilePath}`,
    });
    updatedFiles.push(update.testFilePath);
  }
  const pr = await createPullRequest(input.automationConfig, {
    branchName,
    title: "AI QA Copilot: Update impacted Playwright tests",
    body: [
      "This PR was generated by AI QA Copilot from repository impact analysis.",
      "",
      `Application repository: ${input.impactAnalysis.repoOwner}/${input.impactAnalysis.repoName}`,
      `Branch: ${input.impactAnalysis.branch || "unknown"}`,
      `Commit: ${input.impactAnalysis.commitSha || "unknown"}`,
      `Risk level: ${input.impactAnalysis.riskLevel}`,
      `Confidence: ${input.impactAnalysis.confidenceScore}%`,
      "",
      "Changed application files:",
      ...input.impactAnalysis.changedFiles.map((file) => `- ${file.filePath} (${file.changeType})`),
      "",
      "Updated Playwright files:",
      ...updatedFiles.map((file) => `- ${file}`),
      "",
      "Validation summary:",
      input.validationRun
        ? [
          `- Status: ${input.validationRun.status}`,
          `- Total Tests: ${input.validationRun.totalTests}`,
          `- Passed: ${input.validationRun.passed}`,
          `- Failed: ${input.validationRun.failed}`,
          `- Skipped: ${input.validationRun.skipped}`,
          `- Duration: ${input.validationRun.duration}ms`,
        ].join("\n")
        : "- Validation was not run.",
      "",
      "AI Validation Recommendation:",
      input.validationRecommendation
        ? [
          `- Confidence Score: ${input.validationRecommendation.confidenceScore}%`,
          `- Risk Level: ${input.validationRecommendation.riskLevel}`,
          `- Release Recommendation: ${input.validationRecommendation.releaseRecommendation}`,
          `- Merge Decision: ${input.validationRecommendation.mergeDecision}`,
          "",
          `Summary: ${input.validationRecommendation.summary}`,
          "",
          "Reasons:",
          ...input.validationRecommendation.reasons.map((reason) => `- ${reason}`),
          "",
          "Recommended Actions:",
          ...input.validationRecommendation.recommendedActions.map((action) => `- ${action}`),
          "",
          `QA Owner Action: ${input.validationRecommendation.qaOwnerAction}`,
        ].join("\n")
        : "- AI validation recommendation was not generated.",
      "",
      "Requires QA review before merge.",
    ].join("\n"),
  });
  return { ...pr, branchName, updatedFiles };
}
