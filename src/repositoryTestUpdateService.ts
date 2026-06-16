import type {
  RepositoryGeneratedTestUpdate,
  RepositoryImpactAnalysis,
  RepositoryImpactAnalysisTest,
  RepositoryValidationRun,
} from "./projectTypes.js";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GitHubAutomationConfig } from "./github.service.js";
import {
  createBranch,
  createOrReplaceFile,
  createPullRequest,
  readRepositoryFile,
} from "./github.service.js";

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
      logs: "No approved or edited Playwright updates were available for validation.",
      stdout: "",
      stderr: "",
      failedTestNames: [],
      errorDetails: "Approve or edit at least one generated test update before running validation.",
      failureExplanation: "Validation did not run because there were no approved proposed test updates.",
      screenshots: [],
      videos: [],
      createdBy: input.createdBy,
      completedAt: new Date().toISOString(),
    };
  }

  const runId = `validation-${uniqueSuffix()}`;
  const workspacePath = path.join(process.cwd(), "tmp", "playwright-validation", runId);
  await createValidationWorkspace(workspacePath, approved);
  const result = await runPlaywrightValidation(workspacePath);
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
    logs: result.logs,
    stdout: result.stdout,
    stderr: result.stderr,
    failedTestNames: result.failedTestNames,
    validationWorkspacePath: workspacePath,
    errorDetails,
    failureExplanation: errorDetails
      ? "Playwright executed the approved updates in an isolated temporary workspace and reported failures. Review stdout, stderr, and failed test names before creating a PR."
      : undefined,
    screenshots: [],
    videos: [],
    createdBy: input.createdBy,
    completedAt: new Date().toISOString(),
  };
}

async function createValidationWorkspace(workspacePath: string, updates: RepositoryGeneratedTestUpdate[]) {
  await rm(workspacePath, { recursive: true, force: true });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(
    path.join(workspacePath, "package.json"),
    JSON.stringify({
      name: "aiqa-playwright-validation",
      private: true,
      type: "module",
      devDependencies: {
        "@playwright/test": "^1.55.0",
      },
      scripts: {
        test: "playwright test --reporter=json",
      },
    }, null, 2),
  );
  await writeFile(
    path.join(workspacePath, "playwright.config.ts"),
    [
      "import { defineConfig } from '@playwright/test';",
      "",
      "export default defineConfig({",
      "  testDir: './tests',",
      "  timeout: 30000,",
      "  retries: 0,",
      "  workers: 1,",
      "  use: {",
      "    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173',",
      "    trace: 'retain-on-failure',",
      "    screenshot: 'only-on-failure',",
      "    video: 'retain-on-failure',",
      "  },",
      "});",
      "",
    ].join("\n"),
  );

  for (const update of updates) {
    const safePath = normalizeValidationTestPath(update.testFilePath);
    const destination = path.join(workspacePath, safePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, sanitizePlaywrightCode(update.newCode), "utf8");
  }
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

function runPlaywrightValidation(workspacePath: string): Promise<{
  exitCode: number;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  stdout: string;
  stderr: string;
  logs: string;
  failedTestNames: string[];
}> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["playwright", "test", "--reporter=json", "--workers=1"], {
      cwd: workspacePath,
      env: {
        ...process.env,
        CI: "1",
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD ?? "1",
      },
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        totalTests: 0,
        passed: 0,
        failed: 1,
        skipped: 0,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        logs: `Failed to start Playwright validation command.\n${error.message}`,
        failedTestNames: ["Playwright validation command"],
      });
    });
    child.on("close", (code) => {
      const parsed = parsePlaywrightJson(stdout);
      const exitCode = typeof code === "number" ? code : 1;
      resolve({
        exitCode,
        totalTests: parsed.totalTests,
        passed: parsed.passed,
        failed: parsed.failed || (exitCode !== 0 && parsed.totalTests === 0 ? 1 : parsed.failed),
        skipped: parsed.skipped,
        stdout,
        stderr,
        logs: buildValidationLogs({ stdout, stderr, parsed, exitCode }),
        failedTestNames: parsed.failedTestNames,
      });
    });
  });
}

function parsePlaywrightJson(stdout: string) {
  const empty = { totalTests: 0, passed: 0, failed: 0, skipped: 0, failedTestNames: [] as string[] };
  const json = extractJson(stdout);
  if (!json) return empty;
  try {
    const report = JSON.parse(json);
    const stats = report.stats ?? {};
    const failedTestNames: string[] = [];
    const walkSuites = (suites: any[] = []) => {
      for (const suite of suites) {
        for (const spec of suite.specs ?? []) {
          for (const test of spec.tests ?? []) {
            const failed = (test.results ?? []).some((result: any) => result.status === "failed" || result.status === "timedOut" || result.status === "interrupted");
            if (failed) failedTestNames.push(spec.title ?? test.title ?? "Unnamed Playwright test");
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
  parsed: ReturnType<typeof parsePlaywrightJson>;
  exitCode: number;
}) {
  const summary = [
    `Command: npx playwright test --reporter=json --workers=1`,
    `Exit code: ${input.exitCode}`,
    `Total: ${input.parsed.totalTests}`,
    `Passed: ${input.parsed.passed}`,
    `Failed: ${input.parsed.failed}`,
    `Skipped: ${input.parsed.skipped}`,
  ];
  if (input.parsed.failedTestNames.length) {
    summary.push("", "Failed tests:", ...input.parsed.failedTestNames.map((name) => `- ${name}`));
  }
  if (input.stderr.trim()) {
    summary.push("", "stderr:", input.stderr.trim());
  }
  if (input.stdout.trim()) {
    summary.push("", "stdout:", input.stdout.trim());
  }
  return summary.join("\n");
}

function buildValidationErrorDetails(result: Awaited<ReturnType<typeof runPlaywrightValidation>>) {
  if (result.failedTestNames.length) {
    return `Playwright validation failed for: ${result.failedTestNames.join(", ")}`;
  }
  if (result.stderr.trim()) {
    return result.stderr.trim().split(/\r?\n/).slice(0, 4).join("\n");
  }
  return "Playwright validation command completed with a failing exit code.";
}

export function buildFailureSuggestion(run: RepositoryValidationRun) {
  if (run.failed === 0) return "Validation passed. No fix suggestion is required.";
  return [
    "Review failing update files for missing assertions, placeholder selectors, or incomplete navigation.",
    "Prefer resilient locators such as getByRole, getByLabel, or getByTestId.",
    "Regenerate or edit the proposed code before creating the pull request.",
  ].join(" ");
}

export async function createImpactUpdatePullRequest(input: {
  impactAnalysis: RepositoryImpactAnalysis;
  automationConfig: GitHubAutomationConfig;
  approvedUpdates: RepositoryGeneratedTestUpdate[];
  validationRun?: RepositoryValidationRun | null;
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
        ? `- Status: ${input.validationRun.status}; Passed: ${input.validationRun.passed}; Failed: ${input.validationRun.failed}; Skipped: ${input.validationRun.skipped}`
        : "- Validation was not run.",
      "",
      "Requires QA review before merge.",
    ].join("\n"),
  });
  return { ...pr, branchName, updatedFiles };
}
