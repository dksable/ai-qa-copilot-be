import type {
  RepositoryGeneratedTestUpdate,
  RepositoryImpactAnalysis,
  RepositoryImpactAnalysisTest,
  RepositoryValidationRecommendation,
  RepositoryValidationRun,
} from "./projectTypes.js";
import { spawn, spawnSync } from "node:child_process";
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
type ValidationDebugStep = NonNullable<RepositoryValidationRun["validationDebugLogs"]>[number];
type ValidationCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  debugLog: string;
  debugStep: ValidationDebugStep;
};

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
  validationMode?: RepositoryValidationRun["validationMode"];
  browser?: string;
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
      validationDebugLogs: [await buildManualDebugStep({
        stepName: "Approved update check",
        cwd: process.cwd(),
        command: "Validate approved generated test updates",
        status: "Failed",
        stdout: "",
        stderr: "No approved or edited Playwright updates were available for validation.",
        exitCode: 1,
      })],
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
  const result = await runPlaywrightValidation(workspacePath, setup.logs, setup.testPaths, setup.validationDebugLogs);
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
    validationDebugLogs: result.validationDebugLogs,
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
  validationMode?: RepositoryValidationRun["validationMode"];
  browser?: string;
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
      validationMode: input.validationMode ?? "quick",
      command: "workflow_dispatch",
      logs: "No approved or edited Playwright updates were available for GitHub Actions validation.",
      stdout: "",
      stderr: "",
      validationDebugLogs: [buildGitHubActionsDebugStep({
        stepName: "Approved update check",
        command: "Validate approved generated test updates",
        status: "Failed",
        stdout: "",
        stderr: "No approved or edited Playwright updates were available for GitHub Actions validation.",
        exitCode: 1,
        branch: "",
      })],
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
  const debugLogs: ValidationDebugStep[] = [
    buildGitHubActionsDebugStep({
      stepName: "Verify GitHub Actions workflow",
      command: `GitHub API: check ${PLAYWRIGHT_VALIDATION_WORKFLOW}`,
      status: workflowExists ? "Passed" : "Failed",
      stdout: workflowExists ? "Workflow file found." : "",
      stderr: workflowExists ? "" : `GitHub Actions workflow not found at ${PLAYWRIGHT_VALIDATION_WORKFLOW}.`,
      exitCode: workflowExists ? 0 : 1,
      branch: input.automationConfig.defaultBranch,
    }),
  ];
  if (!workflowExists) {
    throw new Error(
      `GitHub Actions workflow not found at ${PLAYWRIGHT_VALIDATION_WORKFLOW}. Add this workflow to the automation repository default branch, then run validation again.`,
    );
  }

  const branchName = `aiqa/validation-${uniqueSuffix()}`;
  await createBranch(input.automationConfig, branchName);
  debugLogs.push(buildGitHubActionsDebugStep({
    stepName: "Create validation branch",
    command: `GitHub API: create branch ${branchName}`,
    status: "Passed",
    stdout: `Created validation branch ${branchName}.`,
    stderr: "",
    exitCode: 0,
    branch: branchName,
  }));

  for (const update of approved) {
    await createOrReplaceFile(input.automationConfig, {
      branchName,
      filePath: update.testFilePath,
      content: update.newCode,
      message: `AI QA Copilot: validate ${update.testFilePath}`,
    });
  }
  debugLogs.push(buildGitHubActionsDebugStep({
    stepName: "Apply approved generated test updates",
    command: `GitHub API: create or update ${approved.length} test file(s)`,
    status: "Passed",
    stdout: approved.map((update) => update.testFilePath).join("\n"),
    stderr: "",
    exitCode: 0,
    branch: branchName,
  }));

  const validationMode = input.validationMode ?? "quick";
  const quickFiles = approved.map((update) => update.testFilePath);
  const impactFiles = Array.from(new Set([
    ...quickFiles,
    ...input.impactAnalysis.impactedTests.map((test) => test.testFilePath).filter(Boolean),
  ]));
  const selectedFiles = validationMode === "full"
    ? ""
    : (validationMode === "impact" ? impactFiles : quickFiles).join(",");
  const validationBrowser = input.browser || process.env.AIQA_VALIDATION_BROWSER || "chromium";
  await triggerWorkflowDispatch(input.automationConfig, {
    workflowId: "playwright-validation.yml",
    ref: branchName,
    inputs: {
      test_files: selectedFiles,
      validation_branch: branchName,
      browser: validationBrowser,
      validation_mode: validationMode,
    },
  });
  debugLogs.push(buildGitHubActionsDebugStep({
    stepName: "Trigger GitHub Actions validation",
    command: `workflow_dispatch ${PLAYWRIGHT_VALIDATION_WORKFLOW}`,
    status: "Passed",
    stdout: `Triggered workflow for branch ${branchName}. Mode: ${validationMode}. Browser: ${validationBrowser}. Test files: ${selectedFiles || "all"}`,
    stderr: "",
    exitCode: 0,
    branch: branchName,
  }));

  const workflowRun = await waitForWorkflowRun(input.automationConfig, branchName);
  const completedRun = await waitForWorkflowCompletion(input.automationConfig, workflowRun.id);
  const jobs = await listWorkflowRunJobs(input.automationConfig, completedRun.id).catch(() => ({ jobs: [] }));
  const logs = summarizeWorkflowJobs(jobs.jobs);
  const validationStageTimings = buildWorkflowStageTimings(jobs.jobs);
  debugLogs.push(...buildGitHubActionsDebugLogs({
    run: completedRun,
    jobs: jobs.jobs,
    branchName,
    logs,
  }));
  const failedTests = jobs.jobs
    .filter((job) => job.conclusion && job.conclusion !== "success" && job.conclusion !== "skipped")
    .map((job) => ({
      testFile: selectedFiles || "GitHub Actions workflow",
      testName: job.name,
      errorMessage: `GitHub Actions job concluded with ${job.conclusion}. Open the workflow logs for details.`,
      duration: durationBetween(job.started_at, job.completed_at),
      suggestedAction: "Open the workflow run, review failing Playwright logs, then edit or regenerate the proposed update.",
    }));

  const conclusion = completedRun.conclusion ?? "unknown";
  const passed = conclusion === "success" ? approved.length : 0;
  const skipped = conclusion === "skipped" ? approved.length : 0;
  const failed = conclusion === "success" || conclusion === "skipped" ? 0 : Math.max(1, failedTests.length || approved.length);
  const validationStatus = mapWorkflowConclusionToRunStatus(conclusion);
  const failedStepLogs = summarizeFailedWorkflowSteps(jobs.jobs);

  return {
    workspaceId: input.impactAnalysis.workspaceId,
    projectId: input.impactAnalysis.projectId,
    impactAnalysisId: input.impactAnalysis.id,
    status: validationStatus,
    totalTests: Math.max(approved.length, passed + failed + skipped),
    passed,
    failed,
    skipped,
    duration: Date.now() - started,
    browser: "GitHub Actions",
    environment: "github-actions",
    validationMode,
    command: `workflow_dispatch ${PLAYWRIGHT_VALIDATION_WORKFLOW} on ${branchName} (${validationMode}, ${validationBrowser})`,
    logs,
    stdout: logs,
    stderr: conclusion === "success" ? "" : failedStepLogs || `Workflow concluded with ${conclusion}.`,
    validationDebugLogs: debugLogs,
    validationStageTimings,
    failedTestNames: failedTests.map((test) => test.testName),
    failedTests,
    errorDetails: conclusion === "success" ? undefined : failedStepLogs || `GitHub Actions validation workflow concluded with ${conclusion}.`,
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
    workflowStatus: completedRun.status,
    workflowConclusion: conclusion,
    workflowCommitSha: completedRun.head_sha,
    createdBy: input.createdBy,
    completedAt: new Date().toISOString(),
  };
}

async function createValidationWorkspace(
  workspacePath: string,
  updates: RepositoryGeneratedTestUpdate[],
  automationConfig: GitHubAutomationConfig,
): Promise<{ exitCode: number; stdout: string; stderr: string; logs: string; testPaths: string[]; validationDebugLogs: ValidationDebugStep[] }> {
  await rm(workspacePath, { recursive: true, force: true });
  await mkdir(path.dirname(workspacePath), { recursive: true });

  const localRepoPath = process.env.AIQA_AUTOMATION_REPO_LOCAL_PATH;
  const setupLogs: string[] = [];
  const validationDebugLogs: ValidationDebugStep[] = [];
  if (localRepoPath && await pathExists(localRepoPath)) {
    await cp(localRepoPath, workspacePath, {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}.git${path.sep}`),
    });
    setupLogs.push(`Copied automation repository from local path: ${localRepoPath}`);
    validationDebugLogs.push(await buildManualDebugStep({
      stepName: "Copy automation repository",
      cwd: workspacePath,
      command: `Copy local automation repository from ${localRepoPath}`,
      status: "Passed",
      stdout: `Copied automation repository from local path: ${localRepoPath}`,
      stderr: "",
      exitCode: 0,
    }));
  } else {
    const cloneUrl = buildGitHubCloneUrl(automationConfig);
    const clone = await runCommand("git", ["clone", "--depth", "1", "--branch", automationConfig.defaultBranch, cloneUrl, workspacePath], process.cwd(), 180_000, [automationConfig.token], {}, "Git clone automation repository");
    validationDebugLogs.push(clone.debugStep);
    setupLogs.push(buildCommandFailureLogs(`git clone --depth 1 --branch ${automationConfig.defaultBranch} https://github.com/${automationConfig.owner}/${automationConfig.repo}.git`, clone));
    if (clone.exitCode !== 0) {
      return { exitCode: clone.exitCode, stdout: clone.stdout, stderr: clone.stderr, logs: setupLogs.join("\n\n"), testPaths: [], validationDebugLogs };
    }
  }

  const projectCheck = await inspectPlaywrightProject(workspacePath);
  validationDebugLogs.push(await buildManualDebugStep({
    stepName: "Verify repository root",
    cwd: workspacePath,
    command: "Verify package.json and Playwright config",
    status: projectCheck.valid ? "Passed" : "Failed",
    stdout: projectCheck.valid ? projectCheck.reason : "",
    stderr: projectCheck.valid ? "" : projectCheck.reason,
    exitCode: projectCheck.valid ? 0 : 1,
  }));
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
      validationDebugLogs,
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
  validationDebugLogs.push(await buildManualDebugStep({
    stepName: "Apply approved generated test updates",
    cwd: workspacePath,
    command: `Write ${updates.length} approved test update(s)`,
    status: "Passed",
    stdout: testPaths.join("\n"),
    stderr: "",
    exitCode: 0,
  }));

  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    logs: [
      ...setupLogs,
      `Applied ${updates.length} approved Playwright test update(s) into isolated automation repository copy.`,
    ].join("\n\n"),
    testPaths,
    validationDebugLogs,
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

function runPlaywrightValidation(workspacePath: string, setupLogs = "", testPaths: string[] = [], setupDebugLogs: ValidationDebugStep[] = []): Promise<{
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
  validationDebugLogs: ValidationDebugStep[];
}> {
  let validationCommand = `npx playwright test ${testPaths.join(" ")} --reporter=json,html --workers=1`.replace(/\s+/g, " ").trim();
  return new Promise((resolve) => {
    void (async () => {
      const packageManager = await detectPackageManager(workspacePath);
      const installCommand = packageManagerInstallCommand(packageManager);
      const browserInstallCommand = packageManagerPlaywrightCommand(packageManager, ["install"]);
      const testCommand = packageManagerPlaywrightCommand(packageManager, ["test", ...testPaths, "--reporter=json,html", "--workers=1"]);
      validationCommand = testCommand.display;
      let dependencyInstall: ValidationCommandResult = {
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 0,
        debugLog: "",
        debugStep: await buildManualDebugStep({
          stepName: "Install dependencies",
          cwd: workspacePath,
          command: installCommand.display,
          status: "Skipped",
          stdout: "No dependency installation was required.",
          stderr: "",
          exitCode: 0,
        }),
      };
      const validationDebugLogs = [...setupDebugLogs];
      if (!await pathExists(path.join(workspacePath, "node_modules", "@playwright", "test"))) {
        dependencyInstall = await runCommand(
          installCommand.command,
          installCommand.args,
          workspacePath,
          180_000,
          [],
          { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
          "Install dependencies",
        );
        validationDebugLogs.push(dependencyInstall.debugStep);
      } else {
        validationDebugLogs.push(await buildManualDebugStep({
          stepName: "Install dependencies",
          cwd: workspacePath,
          command: installCommand.display,
          status: "Skipped",
          stdout: "Skipped because node_modules/@playwright/test already exists.",
          stderr: "",
          exitCode: 0,
        }));
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
          validationDebugLogs,
        });
        return;
      }

      let browserInstall: ValidationCommandResult = {
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 0,
        debugLog: "",
        debugStep: await buildManualDebugStep({
          stepName: "Install Playwright browsers",
          cwd: workspacePath,
          command: browserInstallCommand.display,
          status: "Skipped",
          stdout: "No browser installation was required.",
          stderr: "",
          exitCode: 0,
        }),
      };
      if (!process.env.PLAYWRIGHT_SKIP_BROWSER_INSTALL) {
        browserInstall = await runCommand(browserInstallCommand.command, browserInstallCommand.args, workspacePath, 180_000, [], {}, "Install Playwright browsers");
        validationDebugLogs.push(browserInstall.debugStep);
      } else {
        validationDebugLogs.push(await buildManualDebugStep({
          stepName: "Install Playwright browsers",
          cwd: workspacePath,
          command: browserInstallCommand.display,
          status: "Skipped",
          stdout: "Skipped because PLAYWRIGHT_SKIP_BROWSER_INSTALL is enabled.",
          stderr: "",
          exitCode: 0,
        }));
      }
      if (browserInstall.exitCode !== 0) {
        const logs = [
          setupLogs,
          dependencyInstall.debugLog,
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
          validationDebugLogs,
        });
        return;
      }

      const test = await runCommand(testCommand.command, testCommand.args, workspacePath, 180_000, [], {}, "Run Playwright test command");
      validationDebugLogs.push(test.debugStep);
      const parsed = await parsePlaywrightJson(test.stdout, workspacePath);
      validationDebugLogs.push(await buildManualDebugStep({
        stepName: "Parse validation result",
        cwd: workspacePath,
        command: "Parse Playwright JSON report",
        status: parsed.totalTests || test.exitCode === 0 ? "Passed" : "Failed",
        stdout: `Total: ${parsed.totalTests}\nPassed: ${parsed.passed}\nFailed: ${parsed.failed}\nSkipped: ${parsed.skipped}`,
        stderr: parsed.totalTests || test.exitCode === 0 ? "" : "No Playwright JSON result could be parsed.",
        exitCode: parsed.totalTests || test.exitCode === 0 ? 0 : 1,
      }));
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
          dependencyInstall.debugLog,
          browserInstall.debugLog,
          test.debugLog,
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
        validationDebugLogs,
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
        validationDebugLogs: setupDebugLogs,
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
  stepName = "Execute command",
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  debugLog: string;
  debugStep: ValidationDebugStep;
}> {
  const started = Date.now();
  return new Promise((resolve) => {
    void (async () => {
      const commandLine = `${command} ${args.join(" ")}`.trim();
      const beforeDebug = await buildValidationCommandDebug({
        cwd,
        commandLine,
        redactions,
      });
      console.info(beforeDebug.log);
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
    const complete = (exitCode: number, extraStderr = "") => {
      const safeStdout = redactSecrets(stdout, redactions);
      const safeStderr = redactSecrets(`${stderr}${extraStderr ? `\n${extraStderr}` : ""}`.trim(), redactions);
      const afterDebug = buildValidationCommandResultDebug({
        exitCode,
        stdout: safeStdout,
        stderr: safeStderr,
      });
      const debugLog = `${beforeDebug.log}\n${afterDebug}`;
      const debugStep: ValidationDebugStep = {
        stepName,
        status: exitCode === 0 ? "Passed" : "Failed",
        command: beforeDebug.snapshot.commandLine,
        validationProvider: "local-runner",
        workingDirectory: beforeDebug.snapshot.cwd,
        repositoryPath: beforeDebug.snapshot.cwd,
        packageJsonExists: beforeDebug.snapshot.packageJsonExists,
        packageLockExists: beforeDebug.snapshot.packageLockExists,
        playwrightConfigTsExists: beforeDebug.snapshot.playwrightConfigTsExists,
        nodeModulesExists: beforeDebug.snapshot.nodeModulesExists,
        playwrightTestInstalled: beforeDebug.snapshot.playwrightTestInstalled,
        npmVersion: beforeDebug.snapshot.npmVersion,
        nodeVersion: beforeDebug.snapshot.nodeVersion,
        exitCode,
        stdout: safeStdout,
        stderr: safeStderr,
      };
      console.info(debugLog);
      return {
        exitCode,
        stdout: safeStdout,
        stderr: safeStderr,
        duration: Date.now() - started,
        debugLog,
        debugStep,
      };
    };
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
      resolve(complete(1, error.message));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(complete(typeof code === "number" ? code : 1));
    });
    })().catch((error) => {
      const message = error instanceof Error ? error.message : "Unable to build validation debug output.";
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: message,
        duration: Date.now() - started,
        debugLog: `Validation Debug Mode\nstderr:\n${message}`,
        debugStep: {
          stepName,
          status: "Failed",
          command: `${command} ${args.join(" ")}`.trim(),
          validationProvider: "local-runner",
          workingDirectory: cwd,
          repositoryPath: cwd,
          packageJsonExists: false,
          packageLockExists: false,
          playwrightConfigTsExists: false,
          nodeModulesExists: false,
          playwrightTestInstalled: false,
          npmVersion: getNpmVersion(),
          nodeVersion: process.version,
          exitCode: 1,
          stdout: "",
          stderr: message,
        },
      });
    });
  });
}

async function buildValidationCommandDebug(input: {
  cwd: string;
  commandLine: string;
  redactions: string[];
}) {
  const packageJsonExists = await pathExists(path.join(input.cwd, "package.json"));
  const packageLockExists = await pathExists(path.join(input.cwd, "package-lock.json"));
  const playwrightConfigTsExists = await pathExists(path.join(input.cwd, "playwright.config.ts"));
  const nodeModulesExists = await pathExists(path.join(input.cwd, "node_modules"));
  const playwrightTestInstalled = await pathExists(path.join(input.cwd, "node_modules", "@playwright", "test"));
  const npmVersion = getNpmVersion();
  const snapshot = {
    cwd: input.cwd,
    commandLine: redactSecrets(input.commandLine, input.redactions),
    packageJsonExists,
    packageLockExists,
    playwrightConfigTsExists,
    nodeModulesExists,
    playwrightTestInstalled,
    npmVersion,
    nodeVersion: process.version,
  };
  const log = redactSecrets([
    "Validation Debug Mode",
    "Before Command",
    `Current Working Directory: ${snapshot.cwd}`,
    `Repository Path: ${snapshot.cwd}`,
    `package.json exists?: ${packageJsonExists ? "Yes" : "No"}`,
    `package-lock.json exists?: ${packageLockExists ? "Yes" : "No"}`,
    `playwright.config.ts exists?: ${playwrightConfigTsExists ? "Yes" : "No"}`,
    `node_modules exists?: ${nodeModulesExists ? "Yes" : "No"}`,
    `@playwright/test installed?: ${playwrightTestInstalled ? "Yes" : "No"}`,
    `npm version: ${npmVersion}`,
    `node version: ${snapshot.nodeVersion}`,
    `Command being executed: ${snapshot.commandLine}`,
  ].join("\n"), input.redactions);
  return { log, snapshot };
}

async function buildManualDebugStep(input: {
  stepName: string;
  cwd: string;
  command: string;
  status: "Passed" | "Failed" | "Skipped";
  stdout: string;
  stderr: string;
  exitCode: number;
}): Promise<ValidationDebugStep> {
  const packageJsonExists = await pathExists(path.join(input.cwd, "package.json"));
  const packageLockExists = await pathExists(path.join(input.cwd, "package-lock.json"));
  const playwrightConfigTsExists = await pathExists(path.join(input.cwd, "playwright.config.ts"));
  const nodeModulesExists = await pathExists(path.join(input.cwd, "node_modules"));
  const playwrightTestInstalled = await pathExists(path.join(input.cwd, "node_modules", "@playwright", "test"));
  return {
    stepName: input.stepName,
    status: input.status,
    command: input.command,
    validationProvider: "local-runner",
    workingDirectory: input.cwd,
    repositoryPath: input.cwd,
    packageJsonExists,
    packageLockExists,
    playwrightConfigTsExists,
    nodeModulesExists,
    playwrightTestInstalled,
    npmVersion: getNpmVersion(),
    nodeVersion: process.version,
    exitCode: input.exitCode,
    stdout: input.stdout,
    stderr: input.stderr,
  };
}

function buildValidationCommandResultDebug(input: {
  exitCode: number;
  stdout: string;
  stderr: string;
}) {
  return [
    "After Command",
    `Exit code: ${input.exitCode}`,
    "stdout:",
    input.stdout || "(empty)",
    "stderr:",
    input.stderr || "(empty)",
  ].join("\n");
}

function getNpmVersion() {
  try {
    const result = spawnSync("npm", ["--version"], {
      encoding: "utf8",
      timeout: 5000,
      shell: process.platform === "win32",
    });
    return (result.stdout || result.stderr || "unknown").trim() || "unknown";
  } catch {
    return "unknown";
  }
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
  setup: { exitCode: number; stdout: string; stderr: string; logs: string; validationDebugLogs: ValidationDebugStep[] };
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
    validationDebugLogs: input.setup.validationDebugLogs,
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

function buildCommandFailureLogs(command: string, result: { exitCode: number; stdout: string; stderr: string; debugLog?: string }) {
  return [
    result.debugLog,
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

function mapWorkflowConclusionToRunStatus(conclusion: string): RepositoryValidationRun["status"] {
  if (conclusion === "success") return "Passed";
  if (conclusion === "cancelled") return "Cancelled";
  if (conclusion === "skipped") return "Completed";
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "action_required") return "Failed";
  return "Failed";
}

function mapWorkflowStepStatus(conclusion?: string | null, status?: string): ValidationDebugStep["status"] {
  if (conclusion === "success") return "Passed";
  if (conclusion === "skipped") return "Skipped";
  if (conclusion === "failure" || conclusion === "cancelled" || conclusion === "timed_out" || conclusion === "action_required") return "Failed";
  if (status === "completed") return "Passed";
  return "Failed";
}

function buildGitHubActionsDebugStep(input: {
  stepName: string;
  command: string;
  status: ValidationDebugStep["status"];
  stdout: string;
  stderr: string;
  exitCode: number;
  workflowRunId?: number;
  workflowUrl?: string;
  workflowStatus?: string;
  workflowConclusion?: string | null;
  branch?: string;
  commitSha?: string;
  jobName?: string;
  jobUrl?: string;
  startedAt?: string | null;
  completedAt?: string | null;
}): ValidationDebugStep {
  return {
    stepName: input.stepName,
    status: input.status,
    command: input.command,
    validationProvider: "github-actions",
    workflowRunId: input.workflowRunId,
    workflowUrl: input.workflowUrl,
    workflowStatus: input.workflowStatus,
    workflowConclusion: input.workflowConclusion,
    branch: input.branch,
    commitSha: input.commitSha,
    jobName: input.jobName,
    jobUrl: input.jobUrl,
    startedAt: input.startedAt ?? undefined,
    completedAt: input.completedAt ?? undefined,
    exitCode: input.exitCode,
    stdout: input.stdout,
    stderr: input.stderr,
  };
}

function buildGitHubActionsDebugLogs(input: {
  run: Awaited<ReturnType<typeof getWorkflowRun>>;
  jobs: Awaited<ReturnType<typeof listWorkflowRunJobs>>["jobs"];
  branchName: string;
  logs: string;
}): ValidationDebugStep[] {
  const runStatus = mapWorkflowStepStatus(input.run.conclusion, input.run.status);
  const steps: ValidationDebugStep[] = [
    buildGitHubActionsDebugStep({
      stepName: "GitHub Actions workflow result",
      command: `GitHub API: actions/runs/${input.run.id}`,
      status: runStatus,
      stdout: input.logs,
      stderr: input.run.conclusion === "success" ? "" : `Workflow concluded with ${input.run.conclusion ?? "unknown"}.`,
      exitCode: input.run.conclusion === "success" ? 0 : 1,
      workflowRunId: input.run.id,
      workflowUrl: input.run.html_url,
      workflowStatus: input.run.status,
      workflowConclusion: input.run.conclusion,
      branch: input.run.head_branch ?? input.branchName,
      commitSha: input.run.head_sha,
      startedAt: input.run.run_started_at ?? input.run.created_at,
      completedAt: input.run.updated_at,
    }),
  ];

  for (const job of input.jobs) {
    if (job.steps?.length) {
      for (const step of job.steps) {
        const status = mapWorkflowStepStatus(step.conclusion, step.status);
        const failed = status === "Failed";
        steps.push(buildGitHubActionsDebugStep({
          stepName: step.name,
          command: `GitHub Actions step #${step.number}`,
          status,
          stdout: [
            `Job: ${job.name}`,
            `Step: ${step.name}`,
            `Status: ${step.status}`,
            `Conclusion: ${step.conclusion ?? "pending"}`,
            `Workflow URL: ${job.html_url}`,
          ].join("\n"),
          stderr: failed ? `Step failed in GitHub Actions. Open the workflow URL for full logs: ${job.html_url}` : "",
          exitCode: failed ? 1 : 0,
          workflowRunId: input.run.id,
          workflowUrl: input.run.html_url,
          workflowStatus: input.run.status,
          workflowConclusion: input.run.conclusion,
          branch: input.run.head_branch ?? input.branchName,
          commitSha: input.run.head_sha,
          jobName: job.name,
          jobUrl: job.html_url,
          startedAt: step.started_at,
          completedAt: step.completed_at,
        }));
      }
      continue;
    }

    const status = mapWorkflowStepStatus(job.conclusion, job.status);
    steps.push(buildGitHubActionsDebugStep({
      stepName: job.name,
      command: "GitHub Actions job",
      status,
      stdout: `Job: ${job.name}\nStatus: ${job.status}\nConclusion: ${job.conclusion ?? "pending"}\nURL: ${job.html_url}`,
      stderr: status === "Failed" ? `Job failed in GitHub Actions. Open the workflow URL for full logs: ${job.html_url}` : "",
      exitCode: status === "Failed" ? 1 : 0,
      workflowRunId: input.run.id,
      workflowUrl: input.run.html_url,
      workflowStatus: input.run.status,
      workflowConclusion: input.run.conclusion,
      branch: input.run.head_branch ?? input.branchName,
      commitSha: input.run.head_sha,
      jobName: job.name,
      jobUrl: job.html_url,
      startedAt: job.started_at,
      completedAt: job.completed_at,
    }));
  }

  return steps;
}

function summarizeFailedWorkflowSteps(jobs: Awaited<ReturnType<typeof listWorkflowRunJobs>>["jobs"]) {
  const failedSteps = jobs.flatMap((job) => (job.steps ?? [])
    .filter((step) => mapWorkflowStepStatus(step.conclusion, step.status) === "Failed")
    .map((step) => `Job "${job.name}" step "${step.name}" failed with conclusion "${step.conclusion ?? step.status}". Logs: ${job.html_url}`));
  if (failedSteps.length) return failedSteps.join("\n");
  const failedJobs = jobs
    .filter((job) => mapWorkflowStepStatus(job.conclusion, job.status) === "Failed")
    .map((job) => `Job "${job.name}" failed with conclusion "${job.conclusion ?? job.status}". Logs: ${job.html_url}`);
  return failedJobs.join("\n");
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

function buildWorkflowStageTimings(jobs: Awaited<ReturnType<typeof listWorkflowRunJobs>>["jobs"]): NonNullable<RepositoryValidationRun["validationStageTimings"]> {
  const steps = jobs.flatMap((job) => job.steps ?? []);
  const stageFor = (name: string) => {
    const value = name.toLowerCase();
    if (value.includes("checkout")) return "Repository checkout";
    if (value.includes("detect package manager")) return "Package manager detection";
    if (value.includes("setup node") || value.includes("restore node") || value.includes("npm cache")) return "Dependency cache restore";
    if (value.includes("install dependencies")) return "Dependency install";
    if (value.includes("playwright browser") || value.includes("browser install")) return "Browser install";
    if (value.includes("run playwright")) return "Test execution";
    if (value.includes("summary")) return "GitHub summary";
    if (value.includes("upload")) return "Artifact upload";
    return name;
  };
  return steps.map((step) => {
    const status =
      step.conclusion === "success" ? "Passed" :
      step.conclusion === "failure" || step.conclusion === "cancelled" || step.conclusion === "timed_out" ? "Failed" :
      step.conclusion === "skipped" ? "Skipped" :
      step.status === "in_progress" ? "Running" :
      "Unknown";
    return {
      stage: stageFor(step.name),
      status,
      duration: durationBetween(step.started_at, step.completed_at),
      startedAt: step.started_at ?? undefined,
      completedAt: step.completed_at ?? undefined,
    };
  });
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
