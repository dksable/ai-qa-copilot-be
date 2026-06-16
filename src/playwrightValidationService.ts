import type { PlaywrightValidationIssue, PlaywrightValidationResult } from "./projectTypes.js";

interface ValidatePlaywrightCodeInput {
  playwrightCode: string;
  fileName: string;
  requirementTitle?: string;
}

function createIssue(
  issues: PlaywrightValidationIssue[],
  issue: Omit<PlaywrightValidationIssue, "id">,
) {
  issues.push({
    ...issue,
    id: `issue_${issues.length + 1}`,
  });
}

function findLine(code: string, pattern: RegExp) {
  const lines = code.split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));
  return index >= 0 ? index + 1 : undefined;
}

function countMatches(code: string, pattern: RegExp) {
  return [...code.matchAll(pattern)].length;
}

function keywordOverlapScore(requirementTitle: string | undefined, code: string) {
  if (!requirementTitle) return 0;
  const words = requirementTitle
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);
  if (!words.length) return 0;
  const normalizedCode = code.toLowerCase();
  const matched = words.filter((word) => normalizedCode.includes(word));
  return Math.round((matched.length / words.length) * 100);
}

export async function validatePlaywrightCode(input: ValidatePlaywrightCodeInput): Promise<PlaywrightValidationResult> {
  const startedAt = Date.now();
  const code = input.playwrightCode.trim();
  const issues: PlaywrightValidationIssue[] = [];
  const recommendations: string[] = [];

  if (!code) {
    return {
      score: 0,
      status: "Error",
      summary: "No Playwright code was provided for validation.",
      issues: [
        {
          id: "issue_1",
          severity: "Error",
          category: "Input",
          message: "Generated Playwright code is empty.",
          recommendation: "Regenerate the Playwright test skeleton before validating or pushing to GitHub.",
        },
      ],
      recommendations: ["Regenerate Playwright code before creating a pull request."],
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    };
  }

  let score = 100;

  if (!/@playwright\/test/.test(code)) {
    score -= 18;
    createIssue(issues, {
      severity: "Error",
      category: "Framework",
      message: "The test does not import from @playwright/test.",
      recommendation: "Use the Playwright Test Runner import: import { test, expect } from \"@playwright/test\".",
      line: findLine(code, /import/),
    });
  }

  if (!/\btest(?:\.describe)?\s*\(/.test(code)) {
    score -= 20;
    createIssue(issues, {
      severity: "Error",
      category: "Structure",
      message: "No Playwright test block was detected.",
      recommendation: "Wrap the generated steps in test(...) or test.describe(...).",
    });
  }

  const assertionCount = countMatches(code, /\bexpect\s*\(/g);
  if (assertionCount === 0) {
    score -= 18;
    createIssue(issues, {
      severity: "Error",
      category: "Assertions",
      message: "No assertions were found.",
      recommendation: "Add expect(...) assertions that verify the expected result for each critical flow.",
    });
  }

  const actionCount = countMatches(code, /\.(click|fill|goto|selectOption|check|uncheck|press)\s*\(/g);
  const awaitedActionCount = countMatches(code, /await\s+[^;\n]*\.(click|fill|goto|selectOption|check|uncheck|press)\s*\(/g);
  if (actionCount > awaitedActionCount) {
    score -= 12;
    createIssue(issues, {
      severity: "Warning",
      category: "Async Reliability",
      message: "Some Playwright actions may not be awaited.",
      recommendation: "Await browser actions to reduce flaky execution behavior.",
    });
  }

  if (/TODO|replace-me|your-selector|example\.com|placeholder/i.test(code)) {
    score -= 15;
    createIssue(issues, {
      severity: "Warning",
      category: "Completeness",
      message: "Placeholder or TODO content was detected.",
      recommendation: "Replace placeholders with real application URLs, selectors, and test data before creating a PR.",
      line: findLine(code, /TODO|replace-me|your-selector|example\.com|placeholder/i),
    });
  }

  if (/page\.goto\(["']\/["']\)/.test(code)) {
    score -= 8;
    createIssue(issues, {
      severity: "Warning",
      category: "Environment",
      message: "The test navigates to the root path only.",
      recommendation: "Confirm the automation repository has a baseURL configured, or use the correct application route.",
      line: findLine(code, /page\.goto\(["']\/["']\)/),
    });
  }

  const resilientLocatorCount = countMatches(code, /getBy(Role|Label|Text|Placeholder|TestId)|locator\(/g);
  if (resilientLocatorCount === 0) {
    score -= 10;
    createIssue(issues, {
      severity: "Warning",
      category: "Locator Strategy",
      message: "No resilient Playwright locator strategy was detected.",
      recommendation: "Prefer getByRole, getByLabel, getByTestId, or stable locators instead of brittle CSS paths.",
    });
  }

  const requirementAlignment = keywordOverlapScore(input.requirementTitle, code);
  if (input.requirementTitle && requirementAlignment < 35) {
    score -= 8;
    createIssue(issues, {
      severity: "Info",
      category: "Requirement Alignment",
      message: "The generated code has limited keyword overlap with the selected requirement title.",
      recommendation: "Review whether the test names and assertions clearly reflect the requirement under test.",
    });
  }

  if (!/\.(spec|test)\.(ts|js)$/.test(input.fileName)) {
    score -= 5;
    createIssue(issues, {
      severity: "Info",
      category: "Naming",
      message: "The file name does not follow a common Playwright spec naming convention.",
      recommendation: "Use a filename like login.spec.ts or checkout.test.ts.",
    });
  }

  if (assertionCount < 2) {
    recommendations.push("Add at least two assertions for critical flows and expected outcomes.");
  }
  if (resilientLocatorCount > 0) {
    recommendations.push("Review locator names against the current application UI before merging.");
  }
  recommendations.push("Run the generated test in the target automation repository before approving the PR.");

  const boundedScore = Math.max(0, Math.min(100, score));
  const hasError = issues.some((issue) => issue.severity === "Error");
  const status = hasError || boundedScore < 65 ? "Failed" : boundedScore < 85 ? "Warning" : "Passed";

  return {
    score: boundedScore,
    status,
    summary:
      status === "Passed"
        ? "The generated Playwright test passed static validation checks and is ready for repository review."
        : status === "Warning"
          ? "The generated Playwright test is usable, but a reviewer should address the highlighted risks before merging."
          : "The generated Playwright test needs fixes before it should be pushed for review.",
    issues,
    recommendations: [...new Set(recommendations)],
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
  };
}
