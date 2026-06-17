import type {
  RepositoryAISuggestion,
  RepositoryChangedFile,
  RepositoryGeneratedUpdate,
  RepositoryImpactedTest,
  RepositoryAnalysisBuildTool,
  RepositoryAnalysisFramework,
  RepositoryAnalysisLanguage,
  RepositoryAnalysisPattern,
  RepositoryPrPreview,
  RepositoryRiskLevel,
} from "./projectTypes.js";

export interface GitHubAutomationConfig {
  token: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  testFolderPath: string;
}

export interface PushPlaywrightInput {
  fileName: string;
  playwrightCode: string;
  requirementTitle: string;
  projectName?: string;
  moduleName?: string;
  coverageScore?: number;
  generatedBy?: string;
  version?: number | string;
  repositoryAnalysis?: RepositoryAnalysisSummary | null;
}

export interface RepositoryAnalysisSummary {
  framework: RepositoryAnalysisFramework;
  language: RepositoryAnalysisLanguage;
  buildTool: RepositoryAnalysisBuildTool;
  testFolderPath: string;
  pageObjectFolderPath?: string;
  usesPageObjectModel: boolean;
  usesFixtures: boolean;
  namingConvention: string;
  importStyle: string;
  pattern: RepositoryAnalysisPattern;
  confidenceScore: number;
  scannedFiles: string[];
}

export interface RepositorySyncDetection {
  latestCommitSha: string;
  changedFiles: RepositoryChangedFile[];
  impactedTests: RepositoryImpactedTest[];
  riskLevel: RepositoryRiskLevel;
  testFiles: string[];
}

interface GitHubApiError extends Error {
  statusCode?: number;
}

function githubError(message: string, statusCode = 500): GitHubApiError {
  const error = new Error(message) as GitHubApiError;
  error.statusCode = statusCode;
  return error;
}

function normalizePath(...parts: string[]) {
  return parts
    .join("/")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "playwright-tests";
}

function uniqueGitSuffix() {
  const timestamp = new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace(/[^0-9]/g, "");
  const random = Math.random().toString(36).slice(2, 7);
  return `${timestamp}-${random}`;
}

function titleFromPath(filePath: string) {
  const name = filePath.split("/").pop() ?? filePath;
  return name.replace(/\.[^.]+$/, "").replace(/[-_.]+/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

async function githubRequest<T>(
  config: GitHubAutomationConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    const message = typeof body?.message === "string" ? body.message : "GitHub request failed.";
    throw githubError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function getRepoInfo(config: GitHubAutomationConfig) {
  return githubRequest<{
    full_name: string;
    default_branch: string;
    html_url: string;
    permissions?: { push?: boolean };
  }>(config, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`);
}

export async function createGitHubWebhook(config: GitHubAutomationConfig, input: {
  webhookUrl: string;
  secret: string;
}) {
  return githubRequest<{
    id: number;
    active: boolean;
    config: { url?: string };
    events: string[];
  }>(config, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/hooks`, {
    method: "POST",
    body: JSON.stringify({
      name: "web",
      active: true,
      events: ["push", "pull_request"],
      config: {
        url: input.webhookUrl,
        content_type: "json",
        secret: input.secret,
        insecure_ssl: "0",
      },
    }),
  });
}

export async function compareGitHubCommits(config: GitHubAutomationConfig, baseSha: string, headSha: string) {
  return githubRequest<{
    files?: Array<{
      filename: string;
      status: "added" | "modified" | "removed" | "renamed";
      additions?: number;
      deletions?: number;
      patch?: string;
      previous_filename?: string;
    }>;
  }>(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`,
  );
}

export async function listGitHubPullRequestFiles(config: GitHubAutomationConfig, pullRequestNumber: number) {
  return githubRequest<Array<{
    filename: string;
    status: "added" | "modified" | "removed" | "renamed";
    additions?: number;
    deletions?: number;
    patch?: string;
    previous_filename?: string;
  }>>(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/pulls/${pullRequestNumber}/files?per_page=100`,
  );
}

export async function getDefaultBranch(config: GitHubAutomationConfig) {
  const branch = await githubRequest<{ commit: { sha: string } }>(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/branches/${encodeURIComponent(config.defaultBranch)}`,
  );
  return branch.commit.sha;
}

async function getRepositoryTree(config: GitHubAutomationConfig) {
  const baseSha = await getDefaultBranch(config);
  const tree = await githubRequest<{ tree: Array<{ path: string; type: "blob" | "tree"; size?: number }> }>(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/trees/${encodeURIComponent(baseSha)}?recursive=1`,
  );
  return tree.tree;
}

export async function getLatestCommitSha(config: GitHubAutomationConfig) {
  return getDefaultBranch(config);
}

export async function readRepositoryFile(config: GitHubAutomationConfig, filePath: string) {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  try {
    const file = await githubRequest<{ content?: string; encoding?: string; path: string }>(
      config,
      `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(config.defaultBranch)}`,
    );
    if (file.encoding !== "base64" || !file.content) return "";
    return Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8");
  } catch (error) {
    if ((error as GitHubApiError).statusCode === 404) return "";
    throw error;
  }
}

export async function fileExists(config: GitHubAutomationConfig, filePath: string) {
  const content = await readRepositoryFile(config, filePath);
  return content.length > 0;
}

function folderFromPath(filePath: string) {
  const parts = filePath.split("/");
  parts.pop();
  return parts.join("/") || ".";
}

function commonPrefix(paths: string[]) {
  if (!paths.length) return "";
  const split = paths.map((item) => folderFromPath(item).split("/"));
  const prefix: string[] = [];
  for (let index = 0; index < split[0].length; index += 1) {
    const part = split[0][index];
    if (split.every((candidate) => candidate[index] === part)) prefix.push(part);
    else break;
  }
  return prefix.join("/");
}

export async function analyzeGitHubRepository(config: GitHubAutomationConfig): Promise<RepositoryAnalysisSummary> {
  const tree = await getRepositoryTree(config);
  const paths = tree.map((item) => item.path);
  const lowerPath = new Map(paths.map((item) => [item.toLowerCase(), item]));
  const importantFiles = [
    "package.json",
    "playwright.config.ts",
    "playwright.config.js",
    "tsconfig.json",
    "pom.xml",
    "build.gradle",
    "README.md",
  ];
  const commonFolders = ["tests", "e2e", "specs", "src/test", "src/test/java", "playwright", "automation"];
  const existingImportantFiles = importantFiles
    .map((file) => lowerPath.get(file.toLowerCase()))
    .filter((file): file is string => Boolean(file));
  const candidateTestFiles = paths.filter((path) =>
    /(\.spec\.(ts|js|tsx|jsx)|\.test\.(ts|js|tsx|jsx)|Test\.java)$/i.test(path),
  );
  const candidatePageFiles = paths.filter((path) =>
    /(^|\/)(pages?|page-objects?|pom)(\/|$)/i.test(path) || /Page\.(ts|js|java)$/i.test(path),
  );
  const candidateFixtureFiles = paths.filter((path) =>
    /(^|\/)(fixtures?|test-fixtures?)(\/|$)/i.test(path) || /fixtures?\.(ts|js)$/i.test(path),
  );
  const filesToRead = [
    ...existingImportantFiles,
    ...candidateTestFiles.slice(0, 5),
    ...candidatePageFiles.slice(0, 4),
    ...candidateFixtureFiles.slice(0, 3),
  ].filter((file, index, list) => list.indexOf(file) === index);
  const contents = new Map<string, string>();
  for (const file of filesToRead) {
    const treeItem = tree.find((item) => item.path === file);
    if (treeItem?.type === "blob" && (treeItem.size ?? 0) < 300_000) {
      contents.set(file, await readRepositoryFile(config, file));
    }
  }
  const packageJson = contents.get("package.json") ?? "";
  const pomXml = contents.get("pom.xml") ?? "";
  const gradle = contents.get("build.gradle") ?? "";
  const hasPlaywrightConfigTs = paths.includes("playwright.config.ts");
  const hasPlaywrightConfigJs = paths.includes("playwright.config.js");
  const hasPackagePlaywright = /@playwright\/test|playwright/i.test(packageJson);
  const hasJavaPlaywright = /com\.microsoft\.playwright|playwright/i.test(pomXml) || /playwright/i.test(gradle);
  const hasTsTests = candidateTestFiles.some((path) => /\.spec\.(ts|tsx)$/i.test(path) || /\.test\.(ts|tsx)$/i.test(path));
  const hasJsTests = candidateTestFiles.some((path) => /\.spec\.(js|jsx)$/i.test(path) || /\.test\.(js|jsx)$/i.test(path));
  const hasJavaTests = candidateTestFiles.some((path) => /Test\.java$/i.test(path));
  const usesFixtures = candidateFixtureFiles.length > 0 || [...contents.values()].some((content) => /test\.extend|fixtures?/i.test(content));
  const usesPageObjectModel = candidatePageFiles.length > 0 || [...contents.values()].some((content) => /new\s+\w+Page|class\s+\w+Page/i.test(content));
  const language: RepositoryAnalysisLanguage = hasPlaywrightConfigTs || hasTsTests || paths.includes("tsconfig.json")
    ? "TypeScript"
    : hasPlaywrightConfigJs || hasJsTests
      ? "JavaScript"
      : hasJavaPlaywright || hasJavaTests
        ? "Java"
        : "Unknown";
  const framework: RepositoryAnalysisFramework = hasJavaPlaywright || hasJavaTests
    ? "Java Playwright"
    : hasPackagePlaywright && (hasPlaywrightConfigTs || hasPlaywrightConfigJs)
      ? "Playwright Test Runner"
      : hasPackagePlaywright || hasPlaywrightConfigTs || hasPlaywrightConfigJs
        ? "Playwright"
        : candidateTestFiles.length
          ? "Custom Playwright setup"
          : "Unknown";
  const buildTool: RepositoryAnalysisBuildTool = packageJson
    ? "npm"
    : pomXml
      ? "Maven"
      : gradle
        ? "Gradle"
        : "Unknown";
  const detectedFolder = commonPrefix(candidateTestFiles) || commonFolders.find((folder) =>
    paths.some((path) => path === folder || path.startsWith(`${folder}/`)),
  ) || config.testFolderPath;
  const pageObjectFolderPath = commonPrefix(candidatePageFiles) || undefined;
  const firstTest = candidateTestFiles[0] ?? "";
  const namingConvention = firstTest
    ? firstTest.endsWith(".java")
      ? "*Test.java"
      : firstTest.includes(".test.")
        ? "*.test." + firstTest.split(".").pop()
        : "*.spec." + firstTest.split(".").pop()
    : language === "JavaScript"
      ? "*.spec.js"
      : "*.spec.ts";
  const importStyle = [...contents.values()].find((content) => content.includes("@playwright/test"))
    ? "@playwright/test"
    : [...contents.values()].find((content) => content.includes("com.microsoft.playwright"))
      ? "com.microsoft.playwright"
      : framework.includes("Playwright")
        ? "@playwright/test"
        : "Unknown";
  const pattern: RepositoryAnalysisPattern = usesPageObjectModel ? "Page Object Model" : usesFixtures ? "Fixtures" : "Direct Playwright";
  let confidenceScore = 20;
  if (framework !== "Unknown") confidenceScore += 25;
  if (language !== "Unknown") confidenceScore += 20;
  if (detectedFolder) confidenceScore += 15;
  if (existingImportantFiles.length) confidenceScore += Math.min(existingImportantFiles.length * 4, 16);
  if (usesPageObjectModel || usesFixtures) confidenceScore += 8;
  confidenceScore = Math.min(confidenceScore, 98);
  return {
    framework,
    language,
    buildTool,
    testFolderPath: detectedFolder,
    pageObjectFolderPath,
    usesPageObjectModel,
    usesFixtures,
    namingConvention,
    importStyle,
    pattern,
    confidenceScore,
    scannedFiles: [...new Set([...existingImportantFiles, ...candidateTestFiles.slice(0, 10), ...candidatePageFiles.slice(0, 6), ...candidateFixtureFiles.slice(0, 4)])],
  };
}

function riskForChangedFile(filePath: string): RepositoryRiskLevel {
  if (/(\.spec\.|\.test\.|Test\.java$|playwright\.config|package\.json|pom\.xml|build\.gradle)/i.test(filePath)) return "High";
  if (/(routes?|api|pages?|components?|views?|controllers?|services?)/i.test(filePath)) return "Medium";
  return "Low";
}

function changeTypeFromStatus(status: string): RepositoryChangedFile["changeType"] {
  if (status === "added") return "Added";
  if (status === "removed") return "Deleted";
  return "Modified";
}

function relatedModule(filePath: string) {
  const basename = titleFromPath(filePath);
  const segment = filePath.split("/").find((part) => !["src", "app", "pages", "components", "routes", "api", "tests", "e2e", "specs"].includes(part.toLowerCase()));
  return titleFromPath(segment || basename);
}

function possibleImpact(filePath: string, riskLevel: RepositoryRiskLevel) {
  if (/(\.spec\.|\.test\.|Test\.java$)/i.test(filePath)) return "Existing automation test changed and should be reviewed.";
  if (/playwright\.config|package\.json|pom\.xml|build\.gradle/i.test(filePath)) return "Automation runtime/configuration changed; regression suite may need validation.";
  if (riskLevel === "Medium") return "Application behavior or UI surface may have changed; related Playwright coverage should be reviewed.";
  return "Low-risk repository change; review related tests if module behavior changed.";
}

export async function detectRepositorySyncImpact(
  config: GitHubAutomationConfig,
  input: {
    previousCommitSha?: string;
    analysis?: RepositoryAnalysisSummary | null;
  },
): Promise<RepositorySyncDetection> {
  const latestCommitSha = await getLatestCommitSha(config);
  const tree = await getRepositoryTree(config);
  const allPaths = tree.map((item) => item.path);
  const testFolder = input.analysis?.testFolderPath || config.testFolderPath;
  const testFiles = allPaths.filter((path) =>
    path.startsWith(`${testFolder.replace(/^\/+|\/+$/g, "")}/`) ||
    /(\.spec\.(ts|js|tsx|jsx)|\.test\.(ts|js|tsx|jsx)|Test\.java)$/i.test(path),
  );
  let rawChangedFiles: Array<{ filename: string; status: string }> = [];
  if (input.previousCommitSha && input.previousCommitSha !== latestCommitSha) {
    const compare = await githubRequest<{ files?: Array<{ filename: string; status: string }> }>(
      config,
      `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/compare/${encodeURIComponent(input.previousCommitSha)}...${encodeURIComponent(latestCommitSha)}`,
    );
    rawChangedFiles = compare.files ?? [];
  } else {
    const commit = await githubRequest<{ files?: Array<{ filename: string; status: string }> }>(
      config,
      `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/commits/${encodeURIComponent(latestCommitSha)}`,
    );
    rawChangedFiles = commit.files ?? [];
  }
  const changedFiles = rawChangedFiles.slice(0, 60).map((file) => {
    const riskLevel = riskForChangedFile(file.filename);
    return {
      filePath: file.filename,
      changeType: changeTypeFromStatus(file.status),
      relatedModule: relatedModule(file.filename),
      riskLevel,
      possibleTestImpact: possibleImpact(file.filename, riskLevel),
    };
  });
  const impactedTests: RepositoryImpactedTest[] = [];
  for (const changed of changedFiles) {
    const moduleSlug = changed.relatedModule.toLowerCase().replace(/\s+/g, "");
    const matches = testFiles.filter((testFile) => {
      const normalized = testFile.toLowerCase().replace(/[^a-z0-9]/g, "");
      const changedBase = titleFromPath(changed.filePath).toLowerCase().replace(/\s+/g, "");
      return normalized.includes(moduleSlug) || normalized.includes(changedBase);
    });
    const targets = matches.length ? matches.slice(0, 3) : testFiles.slice(0, changed.riskLevel === "High" ? 3 : 1);
    targets.forEach((testFile) => {
      impactedTests.push({
        testFile,
        relatedChangedFile: changed.filePath,
        impactReason: changed.riskLevel === "High"
          ? "High-risk source or automation change may require Playwright updates."
          : "Related module changed; review automation coverage for this area.",
        suggestedAction: changed.changeType === "Added" ? "Add" : changed.changeType === "Deleted" ? "Review" : changed.riskLevel === "Low" ? "No Action" : "Update",
        confidenceScore: matches.includes(testFile) ? 84 : changed.riskLevel === "High" ? 68 : 52,
      });
    });
  }
  const highestRisk: RepositoryRiskLevel = changedFiles.some((file) => file.riskLevel === "High")
    ? "High"
    : changedFiles.some((file) => file.riskLevel === "Medium")
      ? "Medium"
      : "Low";
  return {
    latestCommitSha,
    changedFiles,
    impactedTests: impactedTests.slice(0, 40),
    riskLevel: highestRisk,
    testFiles,
  };
}

export function generateRepositorySyncSuggestions(input: {
  changedFiles: RepositoryChangedFile[];
  impactedTests: RepositoryImpactedTest[];
  riskLevel: RepositoryRiskLevel;
}): RepositoryAISuggestion[] {
  if (!input.changedFiles.length) {
    return [{
      summary: "No new repository changes were detected since the last sync.",
      impactedTests: [],
      suggestedUpdates: ["No update PR is required at this time."],
      riskLevel: "Low",
      recommendedPrAction: "No Action",
    }];
  }
  const highRiskFiles = input.changedFiles.filter((file) => file.riskLevel === "High");
  const impacted = input.impactedTests.slice(0, 8).map((item) => item.testFile);
  return [{
    summary: `${input.changedFiles.length} changed file(s) detected with ${input.impactedTests.length} potentially impacted Playwright test(s).`,
    impactedTests: [...new Set(impacted)],
    suggestedUpdates: [
      highRiskFiles.length ? "Review automation configuration and changed test files first." : "Review changed modules against related Playwright coverage.",
      "Validate locators, route expectations, and API mocks for impacted flows.",
      "Add regression coverage for newly added modules, pages, or API endpoints.",
      "Remove or update tests for deleted flows to reduce flaky failures.",
    ],
    riskLevel: input.riskLevel,
    recommendedPrAction: input.riskLevel === "Low" ? "Create review note PR if desired" : "Create update PR for QA review",
  }];
}

function buildRepositorySyncUpdateCode(input: {
  oldCode: string;
  testFile: string;
  relatedChangedFile: string;
  impactReason: string;
  suggestedAction: string;
  riskLevel: RepositoryRiskLevel;
}) {
  const updateBlock = [
    "",
    "",
    "// AI QA Copilot Repository Sync Beta",
    `// Impacted by: ${input.relatedChangedFile}`,
    `// Reason: ${input.impactReason}`,
    `// Suggested action: ${input.suggestedAction}`,
    `// Risk: ${input.riskLevel}`,
    "test.describe('AI QA Copilot repository sync coverage', () => {",
    `  test('review impacted flow for ${titleFromPath(input.relatedChangedFile)}', async ({ page }) => {`,
    "    // TODO: Review generated suggestion against the latest application change.",
    "    // Update locators, assertions, and navigation based on the changed flow.",
    "    await page.goto('/');",
    "  });",
    "});",
  ].join("\n");
  if (input.oldCode.trim()) {
    return `${input.oldCode.trimEnd()}${updateBlock}\n`;
  }
  return [
    "import { test, expect } from '@playwright/test';",
    "",
    `test.describe('${titleFromPath(input.testFile)}', () => {`,
    `  test('covers impacted change from ${titleFromPath(input.relatedChangedFile)}', async ({ page }) => {`,
    "    await page.goto('/');",
    "    await expect(page).toHaveURL(/.*/);",
    "  });",
    "});",
  ].join("\n");
}

export async function generateRepositorySyncUpdates(
  config: GitHubAutomationConfig,
  input: {
    syncId: string;
    impactedTests: RepositoryImpactedTest[];
    changedFiles: RepositoryChangedFile[];
    riskLevel: RepositoryRiskLevel;
  },
): Promise<RepositoryGeneratedUpdate[]> {
  const targets = input.impactedTests.length
    ? input.impactedTests.slice(0, 8)
    : input.changedFiles.slice(0, 3).map((file) => ({
        testFile: normalizePath(config.testFolderPath, `${slugify(file.relatedModule || titleFromPath(file.filePath))}.spec.ts`),
        relatedChangedFile: file.filePath,
        impactReason: file.possibleTestImpact,
        suggestedAction: "Add" as const,
        confidenceScore: file.riskLevel === "High" ? 72 : 64,
      }));
  const createdAt = new Date().toISOString();
  const updates: RepositoryGeneratedUpdate[] = [];
  for (const target of targets) {
    const changedFile = input.changedFiles.find((file) => file.filePath === target.relatedChangedFile);
    const riskLevel = changedFile?.riskLevel ?? input.riskLevel;
    const oldCode = await readRepositoryFile(config, target.testFile);
    const confidenceScore = Math.min(98, Math.max(40, target.confidenceScore));
    updates.push({
      id: `repo_update_${slugify(target.testFile)}_${updates.length + 1}`,
      syncId: input.syncId,
      testFilePath: target.testFile,
      oldCode,
      newCode: buildRepositorySyncUpdateCode({
        oldCode,
        testFile: target.testFile,
        relatedChangedFile: target.relatedChangedFile,
        impactReason: target.impactReason,
        suggestedAction: target.suggestedAction,
        riskLevel,
      }),
      impactReason: target.impactReason,
      changedLocatorOrFlow: `Review flow or locator affected by ${target.relatedChangedFile}`,
      confidenceScore,
      riskLevel,
      suggestedAction: confidenceScore < 70 ? "Needs Manual Review" : target.suggestedAction,
      createdAt,
    });
  }
  return updates;
}

export function buildRepositorySyncPrPreview(input: {
  generatedUpdates: RepositoryGeneratedUpdate[];
  changedFiles: RepositoryChangedFile[];
  riskLevel: RepositoryRiskLevel;
}): RepositoryPrPreview {
  const branchName = `aiqa/repository-sync-${uniqueGitSuffix()}`;
  const averageConfidence = input.generatedUpdates.length
    ? Math.round(input.generatedUpdates.reduce((total, update) => total + update.confidenceScore, 0) / input.generatedUpdates.length)
    : 0;
  return {
    filesToAdd: input.generatedUpdates.filter((update) => !update.oldCode.trim()).map((update) => update.testFilePath),
    filesToUpdate: input.generatedUpdates.filter((update) => update.oldCode.trim()).map((update) => update.testFilePath),
    branchName,
    title: "AI QA Copilot: Update impacted Playwright tests",
    description: [
      "This Pull Request was prepared by AI QA Copilot Repository Sync Beta.",
      "",
      "Requires QA review before merge.",
      "",
      `Risk Level: ${input.riskLevel}`,
      `Average Confidence: ${averageConfidence}%`,
      "",
      "Changed application files:",
      ...input.changedFiles.slice(0, 20).map((file) => `- ${file.changeType}: \`${file.filePath}\` (${file.riskLevel})`),
      "",
      "Impacted test updates:",
      ...input.generatedUpdates.map((update) => `- \`${update.testFilePath}\`: ${update.suggestedAction} (${update.confidenceScore}% confidence)`),
      "",
      "Generated by AI QA Copilot.",
    ].join("\n"),
    riskLevel: input.riskLevel,
    confidenceScore: averageConfidence,
    createdAt: new Date().toISOString(),
  };
}

export async function createRepositorySyncPullRequest(
  config: GitHubAutomationConfig,
  input: {
    changedFiles: RepositoryChangedFile[];
    impactedTests: RepositoryImpactedTest[];
    suggestions: RepositoryAISuggestion[];
    riskLevel: RepositoryRiskLevel;
  },
) {
  const timestamp = uniqueGitSuffix();
  const branchName = `aiqa/repository-sync-${timestamp}`;
  const reportPath = `aiqa-repository-sync/repository-sync-${timestamp}.md`;
  const report = [
    "# AI QA Copilot: Repository Sync Test Updates",
    "",
    `Risk Level: ${input.riskLevel}`,
    "",
    "## Changed Files",
    ...input.changedFiles.map((file) => `- ${file.changeType}: \`${file.filePath}\` (${file.riskLevel}) - ${file.possibleTestImpact}`),
    "",
    "## Impacted Tests",
    ...input.impactedTests.map((test) => `- \`${test.testFile}\` from \`${test.relatedChangedFile}\` - ${test.suggestedAction} (${test.confidenceScore}% confidence)`),
    "",
    "## AI Recommendations",
    ...input.suggestions.flatMap((suggestion) => [
      `- ${suggestion.summary}`,
      ...suggestion.suggestedUpdates.map((update) => `  - ${update}`),
      `  - Recommended PR Action: ${suggestion.recommendedPrAction}`,
    ]),
  ].join("\n");
  await createBranch(config, branchName);
  await createOrUpdateFile(config, {
    branchName,
    filePath: reportPath,
    content: report,
    message: "AI QA Copilot: repository sync test impact report",
  });
  const pr = await createPullRequest(config, {
    branchName,
    title: "AI QA Copilot: Repository Sync Test Updates",
    body: [
      "This PR was generated from AI QA Copilot Repository Sync Beta.",
      "",
      `- Risk Level: ${input.riskLevel}`,
      `- Changed Files: ${input.changedFiles.length}`,
      `- Impacted Tests: ${input.impactedTests.length}`,
      "",
      "Changed files:",
      ...input.changedFiles.slice(0, 20).map((file) => `- ${file.changeType}: \`${file.filePath}\` (${file.riskLevel})`),
      "",
      "AI recommendations:",
      ...input.suggestions.map((suggestion) => `- ${suggestion.summary}`),
    ].join("\n"),
  });
  return {
    branchName,
    reportPath,
    pullRequestUrl: pr.html_url,
    pullRequestNumber: pr.number,
  };
}

export async function createBranch(config: GitHubAutomationConfig, branchName: string) {
  const baseSha = await getDefaultBranch(config);
  await githubRequest(config, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    }),
  });
  return branchName;
}

export async function createOrUpdateFile(
  config: GitHubAutomationConfig,
  input: {
    branchName: string;
    filePath: string;
    content: string;
    message: string;
  },
) {
  const encodedPath = input.filePath.split("/").map(encodeURIComponent).join("/");
  try {
    await githubRequest(
      config,
      `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(input.branchName)}`,
    );
    throw githubError("A file already exists at this path. Rename the file or create an updated version.", 409);
  } catch (error) {
    if ((error as GitHubApiError).statusCode !== 404) throw error;
  }

  return githubRequest<{ content?: { path?: string; html_url?: string } }>(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: input.message,
        content: Buffer.from(input.content, "utf8").toString("base64"),
        branch: input.branchName,
      }),
    },
  );
}

export async function createOrReplaceFile(
  config: GitHubAutomationConfig,
  input: {
    branchName: string;
    filePath: string;
    content: string;
    message: string;
  },
) {
  const encodedPath = input.filePath.split("/").map(encodeURIComponent).join("/");
  let sha: string | undefined;
  try {
    const existing = await githubRequest<{ sha?: string }>(
      config,
      `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(input.branchName)}`,
    );
    sha = existing.sha;
  } catch (error) {
    if ((error as GitHubApiError).statusCode !== 404) throw error;
  }
  return githubRequest<{ content?: { path?: string; html_url?: string } }>(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: input.message,
        content: Buffer.from(input.content, "utf8").toString("base64"),
        branch: input.branchName,
        ...(sha ? { sha } : {}),
      }),
    },
  );
}

export async function createPullRequest(
  config: GitHubAutomationConfig,
  input: {
    branchName: string;
    title: string;
    body: string;
  },
) {
  return githubRequest<{ html_url: string; number: number; title: string }>(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        head: input.branchName,
        base: config.defaultBranch,
        body: input.body,
      }),
    },
  );
}

export async function triggerWorkflowDispatch(
  config: GitHubAutomationConfig,
  input: {
    workflowId: string;
    ref: string;
    inputs?: Record<string, string>;
  },
) {
  await githubRequest(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/workflows/${encodeURIComponent(input.workflowId)}/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({
        ref: input.ref,
        inputs: input.inputs ?? {},
      }),
    },
  );
}

export async function listWorkflowRuns(
  config: GitHubAutomationConfig,
  input: {
    workflowId: string;
    branch: string;
  },
) {
  return githubRequest<{
    workflow_runs: Array<{
      id: number;
      html_url: string;
      status: "queued" | "in_progress" | "completed" | string;
      conclusion: "success" | "failure" | "cancelled" | "skipped" | "timed_out" | "action_required" | null | string;
      run_started_at?: string;
      created_at: string;
      updated_at: string;
    }>;
  }>(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/workflows/${encodeURIComponent(input.workflowId)}/runs?branch=${encodeURIComponent(input.branch)}&event=workflow_dispatch&per_page=10`,
  );
}

export async function getWorkflowRun(config: GitHubAutomationConfig, runId: number) {
  return githubRequest<{
    id: number;
    html_url: string;
    status: "queued" | "in_progress" | "completed" | string;
    conclusion: "success" | "failure" | "cancelled" | "skipped" | "timed_out" | "action_required" | null | string;
    run_started_at?: string;
    created_at: string;
    updated_at: string;
  }>(config, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/runs/${runId}`);
}

export async function listWorkflowRunJobs(config: GitHubAutomationConfig, runId: number) {
  return githubRequest<{
    jobs: Array<{
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      started_at?: string | null;
      completed_at?: string | null;
      html_url: string;
      steps?: Array<{
        name: string;
        status: string;
        conclusion: string | null;
        number: number;
        started_at?: string | null;
        completed_at?: string | null;
      }>;
    }>;
  }>(config, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/runs/${runId}/jobs?per_page=100`);
}

export async function pushPlaywrightTestToGitHub(
  config: GitHubAutomationConfig,
  input: PushPlaywrightInput,
) {
  const timestamp = uniqueGitSuffix();
  const branchName = `aiqa/${slugify(input.requirementTitle)}-${timestamp}`;
  const safeFileName = input.fileName.trim().replace(/^\/+/, "");
  const filePath = normalizePath(config.testFolderPath, safeFileName);

  await createBranch(config, branchName);
  const file = await createOrUpdateFile(config, {
    branchName,
    filePath,
    content: input.playwrightCode,
    message: `AI QA Copilot: add Playwright tests for ${input.requirementTitle}`,
  });
  const pr = await createPullRequest(config, {
    branchName,
    title: `AI QA Copilot: Add Playwright tests for ${input.requirementTitle}`,
    body: [
      "This PR was generated from AI QA Copilot.",
      "",
      `- Project: ${input.projectName || "Not provided"}`,
      `- Module: ${input.moduleName || "Not provided"}`,
      `- Requirement: ${input.requirementTitle}`,
      `- Coverage Score: ${input.coverageScore ?? "Not provided"}`,
      `- Generated By: ${input.generatedBy || "AI QA Copilot"}`,
      `- Test Case Version: ${input.version ?? "Current generated result"}`,
      `- File: \`${filePath}\``,
      "",
      "Repository Analysis:",
      `- Framework: ${input.repositoryAnalysis?.framework ?? "Not analyzed"}`,
      `- Language: ${input.repositoryAnalysis?.language ?? "Not analyzed"}`,
      `- Test Folder: ${input.repositoryAnalysis?.testFolderPath ?? config.testFolderPath}`,
      `- Pattern Used: ${input.repositoryAnalysis?.pattern ?? "Generic Playwright"}`,
      `- Confidence Score: ${input.repositoryAnalysis?.confidenceScore ?? "Not available"}`,
    ].join("\n"),
  });

  return {
    branchName,
    filePath,
    fileUrl: file.content?.html_url ?? pr.html_url,
    pullRequestUrl: pr.html_url,
    pullRequestNumber: pr.number,
  };
}

export async function createRepositorySyncUpdatePullRequest(
  config: GitHubAutomationConfig,
  input: {
    preview: RepositoryPrPreview;
    generatedUpdates: RepositoryGeneratedUpdate[];
  },
) {
  if (!input.generatedUpdates.length) {
    throw githubError("No generated Playwright updates are available for this sync.", 400);
  }
  await createBranch(config, input.preview.branchName);
  for (const update of input.generatedUpdates) {
    await createOrReplaceFile(config, {
      branchName: input.preview.branchName,
      filePath: update.testFilePath,
      content: update.newCode,
      message: `AI QA Copilot: update ${update.testFilePath}`,
    });
  }
  const pr = await createPullRequest(config, {
    branchName: input.preview.branchName,
    title: input.preview.title,
    body: input.preview.description,
  });
  return {
    branchName: input.preview.branchName,
    updatedFiles: input.generatedUpdates.map((update) => update.testFilePath),
    pullRequestUrl: pr.html_url,
    pullRequestNumber: pr.number,
  };
}
