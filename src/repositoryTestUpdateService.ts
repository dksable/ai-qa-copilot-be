import type {
  RepositoryGeneratedTestUpdate,
  RepositoryImpactAnalysis,
  RepositoryImpactAnalysisTest,
  RepositoryValidationRun,
} from "./projectTypes.js";
import type { GitHubAutomationConfig } from "./github.service.js";
import {
  createBranch,
  createOrReplaceFile,
  createPullRequest,
  readRepositoryFile,
} from "./github.service.js";
import { validatePlaywrightCode } from "./playwrightValidationService.js";

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
  const results = await Promise.all(
    approved.map((update) => validatePlaywrightCode({
      fileName: update.testFilePath.split("/").pop() || "impact.spec.ts",
      playwrightCode: update.newCode,
      requirementTitle: update.updateSummary,
    })),
  );
  const failed = results.filter((result) => result.status === "Failed" || result.status === "Error").length;
  const warning = results.filter((result) => result.status === "Warning").length;
  const passed = Math.max(0, results.length - failed - warning);
  const logs = results.map((result, index) => {
    const update = approved[index];
    return [
      `[${result.status}] ${update.testFilePath} - ${result.score}/100`,
      result.summary,
      ...result.issues.map((issue) => `- ${issue.severity}: ${issue.message}`),
    ].join("\n");
  }).join("\n\n");
  return {
    workspaceId: input.impactAnalysis.workspaceId,
    projectId: input.impactAnalysis.projectId,
    impactAnalysisId: input.impactAnalysis.id,
    status: failed > 0 ? "Failed" : "Passed",
    totalTests: results.length,
    passed,
    failed,
    skipped: 0,
    duration: Date.now() - started,
    browser: "chromium",
    environment: "temporary-validation-workspace",
    logs: logs || "No approved updates were available for validation.",
    errorDetails: failed > 0 ? "One or more proposed Playwright updates failed static validation checks." : undefined,
    failureExplanation: failed > 0
      ? "Validation detected missing assertions, framework structure issues, or placeholder content. Review generated updates before creating a PR."
      : undefined,
    screenshots: [],
    videos: [],
    createdBy: input.createdBy,
    completedAt: new Date().toISOString(),
  };
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
