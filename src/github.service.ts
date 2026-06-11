import type {
  RepositoryAnalysisBuildTool,
  RepositoryAnalysisFramework,
  RepositoryAnalysisLanguage,
  RepositoryAnalysisPattern,
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

async function readRepositoryFile(config: GitHubAutomationConfig, filePath: string) {
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

  return githubRequest<{ content: { path: string; html_url: string } }>(
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

export async function pushPlaywrightTestToGitHub(
  config: GitHubAutomationConfig,
  input: PushPlaywrightInput,
) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 12);
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
    fileUrl: file.content.html_url,
    pullRequestUrl: pr.html_url,
    pullRequestNumber: pr.number,
  };
}
