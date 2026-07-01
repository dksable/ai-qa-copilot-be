import { type RequestHandler, Router } from "express";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import {
  analyzeGitHubRepository,
  buildRepositorySyncPrPreview,
  compareGitHubCommits,
  createBranch,
  createOrReplaceFile,
  createPullRequest,
  createGitHubWebhook,
  createRepositorySyncPullRequest,
  createRepositorySyncUpdatePullRequest,
  detectRepositorySyncImpact,
  generateRepositorySyncUpdates,
  generateRepositorySyncSuggestions,
  getRepoInfo,
  listGitHubPullRequestFiles,
  pushPlaywrightTestToGitHub,
  type GitHubAutomationConfig,
} from "./github.service.js";
import {
  createAIProviderUsageLog,
  createRepositoryActivity,
  deleteApplicationRepositoryConfig,
  findApplicationRepositoryRuntimeConfig,
  getApplicationRepositoryConfig,
  getApplicationRepositoryRuntimeConfig,
  getAutomationRepositoryConfig,
  getAutomationRepositoryRuntimeConfig,
  getCurrentWorkspaceMember,
  getRepositoryAnalysis,
  getRepositoryActivity,
  getRepositoryImpactAnalysis,
  getRepositoryImpactAnalysisByActivity,
  getRepositoryGeneratedTestUpdate,
  getRepositoryLearningProfile,
  getRepositoryValidationRun,
  getLatestRepositoryValidationRun,
  getLatestRepositoryValidationRecommendation,
  getValidationAutoFix,
  getValidationFailureAnalysis,
  getRepositorySync,
  latestRepositorySync,
  listApplicationRepositoryConfigs,
  listRepositoryActivities,
  listRepositoryGeneratedTestUpdates,
  listRepositoryValidationRuns,
  listValidationAutoFixes,
  listValidationRetryAttempts,
  listRepositorySyncs,
  overrideRepositoryAnalysis,
  createRepositorySync,
  resolveAIProviderForFeature,
  saveReleaseReadinessSnapshot,
  saveApplicationRepositoryConfig,
  saveRepositoryGeneratedTestUpdates,
  saveRepositoryUpdatePullRequest,
  saveRepositoryValidationRun,
  saveRepositoryValidationRecommendation,
  saveValidationAutoFix,
  saveValidationFailureAnalysis,
  saveValidationRetryAttempt,
  saveRepositoryImpactAnalysis,
  saveRepositoryAnalysis,
  saveAutomationRepositoryConfig,
  addRepositoryLearningFeedback,
  refreshRepositoryLearningProfile,
  resetRepositoryLearningProfile,
  updateApplicationRepositoryWebhook,
  updateRepositoryImpactAnalysisStatus,
  updateRepositoryGeneratedTestUpdate,
  updateRepositoryValidationRun,
  updateValidationAutoFix,
  updateRepositoryActivityStatus,
  updateRepositorySyncGeneratedUpdates,
  updateRepositorySyncPr,
  updateRepositorySyncUpdatePr,
  updateRepositorySyncSuggestions,
} from "./projectStore.js";
import { analyzeRepositoryImpact } from "./repositoryImpactAnalysisService.js";
import {
  buildFailureSuggestion,
  createImpactUpdatePullRequest,
  generateRepositoryTestUpdates,
  validateRepositoryTestUpdatesWithGitHubActions,
} from "./repositoryTestUpdateService.js";
import { generateValidationRecommendation } from "./repositoryValidationRecommendationService.js";
import type { RepositoryActivityChangedFile, RepositoryChangeType, RepositoryRiskLevel, WorkspaceRole } from "./projectTypes.js";

export const integrationRouter = Router();
export const githubWebhookRouter = Router();
const defaultWorkspaceId = "workspace_default";

const GitHubConfigSchema = z.object({
  workspaceId: z.string().min(1),
  token: z.string().trim().min(20, "GitHub token is required."),
  owner: z.string().trim().min(1),
  repo: z.string().trim().min(1),
  defaultBranch: z.string().trim().min(1).default("main"),
  testFolderPath: z.string().trim().min(1).default("tests/e2e"),
});

const ApplicationRepoSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().optional(),
  repositoryType: z.enum(["frontend", "backend"]),
  token: z.string().trim().min(20, "GitHub token is required."),
  owner: z.string().trim().min(1),
  repo: z.string().trim().min(1),
  defaultBranch: z.string().trim().min(1).default("main"),
  webhookSecret: z.string().trim().optional(),
});

const PushPlaywrightSchema = z.object({
  workspaceId: z.string().min(1),
  fileName: z.string().trim().min(1).regex(/\.spec\.(ts|js|tsx|jsx)$/i, "Use a Playwright spec filename like login.spec.ts."),
  playwrightCode: z.string().trim().min(20),
  requirementTitle: z.string().trim().min(1),
  projectName: z.string().trim().optional(),
  moduleName: z.string().trim().optional(),
  coverageScore: z.coerce.number().optional(),
  generatedBy: z.string().trim().optional(),
  version: z.union([z.string(), z.number()]).optional(),
});

const AnalysisOverrideSchema = z.object({
  workspaceId: z.string().min(1),
  framework: z.enum(["Playwright", "Playwright Test Runner", "Java Playwright", "Custom Playwright setup", "Unknown"]).optional(),
  language: z.enum(["TypeScript", "JavaScript", "Java", "Unknown"]).optional(),
  buildTool: z.enum(["npm", "Maven", "Gradle", "Unknown"]).optional(),
  testFolderPath: z.string().trim().min(1).optional(),
  pageObjectFolderPath: z.string().trim().optional(),
  usesPageObjectModel: z.boolean().optional(),
  usesFixtures: z.boolean().optional(),
  namingConvention: z.string().trim().min(1).optional(),
  importStyle: z.string().trim().min(1).optional(),
  pattern: z.enum(["Page Object Model", "Fixtures", "Direct Playwright", "Custom"]).optional(),
});

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

async function requireWorkspaceRole(
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
  workspaceId: string,
  roles: WorkspaceRole[],
  message = "You do not have permission to manage integrations.",
) {
  const member = request.userId ? await getCurrentWorkspaceMember(workspaceId, request.userId) : null;
  if (!member || !roles.includes(member.role)) {
    response.status(403).json({ message });
    return false;
  }
  return true;
}

function toGitHubConfig(config: Awaited<ReturnType<typeof getAutomationRepositoryRuntimeConfig>>): GitHubAutomationConfig {
  if (!config?.token) {
    const error = new Error("Please configure GitHub repository integration first.") as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return {
    token: config.token,
    owner: config.owner,
    repo: config.repo,
    defaultBranch: config.defaultBranch,
    testFolderPath: config.testFolderPath,
  };
}

function backendPublicUrl() {
  return (process.env.BACKEND_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT ?? 4000}`)
    .replace(/\/$/, "");
}

function webhookUrl() {
  return `${backendPublicUrl()}/api/integrations/github/webhook`;
}

function generateWebhookSecret() {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

function onboardingBranchName() {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "").replace(/[^0-9]/g, "");
  return `aiqa/automation-repository-onboarding-${timestamp}`;
}

function onboardingFileContent(filePath: string, testFolderPath = "tests") {
  if (filePath === "package.json") {
    return JSON.stringify({
      scripts: { test: "playwright test" },
      devDependencies: {
        "@playwright/test": "^1.46.0",
        typescript: "^5.5.0",
      },
    }, null, 2) + "\n";
  }
  if (filePath === "playwright.config.ts") {
    return [
      "import { defineConfig, devices } from '@playwright/test';",
      "",
      "export default defineConfig({",
      `  testDir: './${testFolderPath.replace(/^\/+/, "")}',`,
      "  fullyParallel: true,",
      "  reporter: [['html'], ['json']],",
      "  use: {",
      "    trace: 'on-first-retry',",
      "    screenshot: 'only-on-failure',",
      "    video: 'retain-on-failure',",
      "  },",
      "  projects: [",
      "    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },",
      "  ],",
      "});",
      "",
    ].join("\n");
  }
  if (filePath === ".github/workflows/playwright-validation.yml") {
    return [
      "name: AI QA Copilot Playwright Validation",
      "",
      "on:",
      "  workflow_dispatch:",
      "    inputs:",
      "      test_files:",
      "        description: 'Comma-separated Playwright test files to run'",
      "        required: false",
      "        default: ''",
      "      validation_branch:",
      "        description: 'AI QA Copilot validation branch'",
      "        required: false",
      "        default: ''",
      "      browser:",
      "        description: 'Browser project to validate'",
      "        required: false",
      "        default: 'chromium'",
      "      validation_mode:",
      "        description: 'Validation mode: quick, impact, or full'",
      "        required: false",
      "        default: 'quick'",
      "",
      "concurrency:",
      "  group: aiqa-validation-${{ github.ref }}-${{ github.event.inputs.validation_mode || 'quick' }}",
      "  cancel-in-progress: true",
      "",
      "permissions:",
      "  contents: read",
      "  actions: read",
      "",
      "jobs:",
      "  validate:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 10",
      "    env:",
      "      CI: true",
      "      PLAYWRIGHT_BROWSERS_PATH: ~/.cache/ms-playwright",
      "      VALIDATION_MODE: ${{ github.event.inputs.validation_mode || 'quick' }}",
      "      VALIDATION_BROWSER: ${{ github.event.inputs.browser || 'chromium' }}",
      "      VALIDATION_TEST_FILES: ${{ github.event.inputs.test_files }}",
      "    steps:",
      "      - name: Checkout repo",
      "        uses: actions/checkout@v4",
      "        with:",
      "          fetch-depth: 1",
      "      - name: Detect package manager",
      "        id: package-manager",
      "        shell: bash",
      "        run: |",
      "          if [ -f pnpm-lock.yaml ]; then",
      "            echo 'manager=pnpm' >> \"$GITHUB_OUTPUT\"",
      "            echo 'lockfile=pnpm-lock.yaml' >> \"$GITHUB_OUTPUT\"",
      "          elif [ -f yarn.lock ]; then",
      "            echo 'manager=yarn' >> \"$GITHUB_OUTPUT\"",
      "            echo 'lockfile=yarn.lock' >> \"$GITHUB_OUTPUT\"",
      "          else",
      "            echo 'manager=npm' >> \"$GITHUB_OUTPUT\"",
      "            echo 'lockfile=package-lock.json' >> \"$GITHUB_OUTPUT\"",
      "          fi",
      "      - name: Setup Node",
      "        uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 20",
      "          cache: ${{ steps.package-manager.outputs.manager }}",
      "          cache-dependency-path: ${{ steps.package-manager.outputs.lockfile }}",
      "      - name: Restore node_modules cache",
      "        id: node-modules-cache",
      "        uses: actions/cache@v4",
      "        with:",
      "          path: node_modules",
      "          key: ${{ runner.os }}-node20-node-modules-${{ steps.package-manager.outputs.manager }}-${{ hashFiles('package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock') }}",
      "          restore-keys: |",
      "            ${{ runner.os }}-node20-node-modules-${{ steps.package-manager.outputs.manager }}-",
      "      - name: Restore Playwright browser cache",
      "        id: playwright-cache",
      "        uses: actions/cache@v4",
      "        with:",
      "          path: ~/.cache/ms-playwright",
      "          key: ${{ runner.os }}-playwright-${{ env.VALIDATION_BROWSER }}-${{ hashFiles('package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock') }}-${{ hashFiles('playwright.config.ts', 'playwright.config.js') }}",
      "          restore-keys: |",
      "            ${{ runner.os }}-playwright-${{ env.VALIDATION_BROWSER }}-",
      "      - name: Install dependencies",
      "        shell: bash",
      "        run: |",
      "          echo \"Package manager: ${{ steps.package-manager.outputs.manager }}\"",
      "          echo \"node_modules cache hit: ${{ steps.node-modules-cache.outputs.cache-hit }}\"",
      "          if [ -d node_modules/@playwright/test ]; then",
      "            echo 'Dependencies already restored from cache. Skipping install.'",
      "          elif [ \"${{ steps.package-manager.outputs.manager }}\" = 'pnpm' ]; then",
      "            corepack enable",
      "            pnpm install --frozen-lockfile",
      "          elif [ \"${{ steps.package-manager.outputs.manager }}\" = 'yarn' ]; then",
      "            corepack enable",
      "            yarn install --frozen-lockfile",
      "          elif [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then",
      "            npm ci --prefer-offline --no-audit --no-fund",
      "          else",
      "            npm install --prefer-offline --no-audit --no-fund",
      "          fi",
      "      - name: Verify Playwright package",
      "        shell: bash",
      "        run: node -e \"require.resolve('@playwright/test'); console.log('@playwright/test resolved')\"",
      "      - name: Install Playwright browsers",
      "        if: steps.playwright-cache.outputs.cache-hit != 'true'",
      "        shell: bash",
      "        run: |",
      "          echo \"Playwright cache hit: ${{ steps.playwright-cache.outputs.cache-hit }}\"",
      "          BROWSER=\"$VALIDATION_BROWSER\"",
      "          if [ -z \"$BROWSER\" ] || [ \"$BROWSER\" = 'all' ]; then",
      "            npx playwright install chromium",
      "          else",
      "            npx playwright install \"$BROWSER\"",
      "          fi",
      "      - name: Skip browser install when cached",
      "        if: steps.playwright-cache.outputs.cache-hit == 'true'",
      "        run: echo 'Playwright browser cache restored. Skipping browser download.'",
      "      - name: Run Playwright validation",
      "        shell: bash",
      "        run: |",
      "          echo \"Validation mode: $VALIDATION_MODE\"",
      "          echo \"Browser: $VALIDATION_BROWSER\"",
      "          echo \"Test files: ${VALIDATION_TEST_FILES:-all}\"",
      "          BROWSER=\"$VALIDATION_BROWSER\"",
      "          PROJECT_ARG=\"\"",
      "          if [ -n \"$BROWSER\" ] && [ \"$BROWSER\" != 'all' ]; then",
      "            PROJECT_ARG=\"--project=$BROWSER\"",
      "          fi",
      "          if [ -n \"$VALIDATION_TEST_FILES\" ] && [ \"$VALIDATION_MODE\" != 'full' ]; then",
      "            IFS=',' read -ra FILES <<< \"$VALIDATION_TEST_FILES\"",
      "            npx playwright test \"${FILES[@]}\" $PROJECT_ARG --reporter=json,html --workers=1",
      "          else",
      "            npx playwright test $PROJECT_ARG --reporter=json,html --workers=1",
      "          fi",
      "      - name: Write GitHub Actions summary",
      "        if: always()",
      "        shell: bash",
      "        run: |",
      "          {",
      "            echo '## AI QA Copilot Validation Summary'",
      "            echo ''",
      "            echo '| Metric | Value |'",
      "            echo '| --- | --- |'",
      "            echo \"| Repository | ${{ github.repository }} |\"",
      "            echo \"| Branch | ${{ github.ref_name }} |\"",
      "            echo \"| Commit | ${{ github.sha }} |\"",
      "            echo \"| Validation Mode | $VALIDATION_MODE |\"",
      "            echo \"| Browser | $VALIDATION_BROWSER |\"",
      "            echo \"| Test Files | ${VALIDATION_TEST_FILES:-all} |\"",
      "            echo \"| Dependency Cache Hit | ${{ steps.node-modules-cache.outputs.cache-hit || 'false' }} |\"",
      "            echo \"| Browser Cache Hit | ${{ steps.playwright-cache.outputs.cache-hit || 'false' }} |\"",
      "          } >> \"$GITHUB_STEP_SUMMARY\"",
      "      - name: Upload Playwright report",
      "        if: always()",
      "        uses: actions/upload-artifact@v4",
      "        with:",
      "          name: playwright-report",
      "          path: playwright-report/",
      "          if-no-files-found: ignore",
      "          retention-days: 3",
      "          compression-level: 1",
      "      - name: Upload Playwright test artifacts",
      "        if: failure()",
      "        uses: actions/upload-artifact@v4",
      "        with:",
      "          name: playwright-test-results",
      "          path: test-results/",
      "          if-no-files-found: ignore",
      "          retention-days: 3",
      "          compression-level: 1",
      "",
    ].join("\n");
  }
  if (filePath.endsWith(".spec.ts")) {
    return [
      "import { test, expect } from '@playwright/test';",
      "",
      "test('AI QA Copilot onboarding smoke test', async ({ page }) => {",
      "  await page.goto('/');",
      "  await expect(page).toHaveURL(/.*/);",
      "});",
      "",
    ].join("\n");
  }
  return "";
}

function verifyGitHubSignature(rawBody: Buffer, secret: string, signatureHeader?: string) {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const actualBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function changeTypeFromGitHub(status?: string): RepositoryActivityChangedFile["changeType"] {
  if (status === "added") return "Added";
  if (status === "removed") return "Deleted";
  if (status === "renamed") return "Renamed";
  return "Modified";
}

function possibleModuleFromPath(filePath: string) {
  const parts = filePath.split("/").filter(Boolean);
  const filename = parts.at(-1)?.replace(/\.[^.]+$/, "") ?? filePath;
  if (parts.includes("auth")) return "auth";
  if (parts.includes("checkout")) return "checkout";
  if (parts.includes("payment")) return "payment";
  if (parts.includes("api")) return "api";
  return parts.length > 1 ? parts.at(-2) ?? filename : filename;
}

function riskFromPath(filePath: string): RepositoryRiskLevel {
  if (/auth|checkout|payment|routing|route|api|config|security|permission/i.test(filePath)) return "High";
  if (/components?|pages?|forms?|views?|screens?/i.test(filePath)) return "Medium";
  return "Low";
}

function mapGitHubFiles(files: Array<{
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
  previous_filename?: string;
}>): RepositoryActivityChangedFile[] {
  return files.map((file) => ({
    filePath: file.filename,
    changeType: changeTypeFromGitHub(file.status),
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
    possibleModule: possibleModuleFromPath(file.filename),
    riskLevel: riskFromPath(file.filename),
  }));
}

function runtimeToGitHubConfig(config: NonNullable<Awaited<ReturnType<typeof getApplicationRepositoryRuntimeConfig>>>): GitHubAutomationConfig {
  return {
    token: config.token,
    owner: config.owner,
    repo: config.repo,
    defaultBranch: config.defaultBranch,
    testFolderPath: "",
  };
}

integrationRouter.post("/integrations/github/connect", asyncRoute(async (request, response) => {
  const input = GitHubConfigSchema.parse(request.body);
  if (!(await requireWorkspaceRole(request, response, input.workspaceId, ["Owner", "Admin"]))) return;
  const saved = await saveAutomationRepositoryConfig({ ...input, userId: request.userId });
  response.status(201).json(saved);
}));

integrationRouter.get("/integrations/github/config", asyncRoute(async (request, response) => {
  const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.query);
  if (!(await requireWorkspaceRole(request, response, workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  response.json(await getAutomationRepositoryConfig(workspaceId));
}));

integrationRouter.post("/integrations/github/test-connection", asyncRoute(async (request, response) => {
  const input = z.object({ workspaceId: z.string().min(1) }).parse(request.body);
  if (!(await requireWorkspaceRole(request, response, input.workspaceId, ["Owner", "Admin"]))) return;
  const config = toGitHubConfig(await getAutomationRepositoryRuntimeConfig(input.workspaceId));
  const repo = await getRepoInfo(config);
  response.json({
    ok: true,
    repository: repo.full_name,
    defaultBranch: repo.default_branch,
    url: repo.html_url,
  });
}));

integrationRouter.post("/integrations/github/application-repos/connect", asyncRoute(async (request, response) => {
  const input = ApplicationRepoSchema.parse(request.body);
  if (!(await requireWorkspaceRole(request, response, input.workspaceId, ["Owner", "Admin"]))) return;
  const secret = input.webhookSecret?.trim() || generateWebhookSecret();
  const targetWebhookUrl = webhookUrl();
  let webhookStatus: "Connected" | "Failed" | "Pending" = "Pending";
  let webhookError: string | undefined;
  let webhookId: number | undefined;
  try {
    const hook = await createGitHubWebhook({
      token: input.token,
      owner: input.owner,
      repo: input.repo,
      defaultBranch: input.defaultBranch,
      testFolderPath: "",
    }, {
      webhookUrl: targetWebhookUrl,
      secret,
    });
    webhookStatus = hook.active ? "Connected" : "Pending";
    webhookId = hook.id;
  } catch (error) {
    webhookStatus = "Failed";
    webhookError = error instanceof Error ? error.message : "Webhook registration failed.";
  }
  const saved = await saveApplicationRepositoryConfig({
    ...input,
    webhookSecret: secret,
    webhookUrl: targetWebhookUrl,
    webhookStatus,
    webhookError,
    webhookId,
    userId: request.userId,
  });
  response.status(201).json({
    ...saved,
    manualSetup: webhookStatus === "Failed"
      ? {
          webhookUrl: targetWebhookUrl,
          contentType: "application/json",
          secret: saved.webhookSecretMasked,
          events: ["push", "pull_request"],
          message: "Automatic webhook registration failed. Add this webhook manually in GitHub repository settings.",
        }
      : undefined,
  });
}));

integrationRouter.get("/integrations/github/application-repos", asyncRoute(async (request, response) => {
  const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.query);
  if (!(await requireWorkspaceRole(request, response, workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  response.json(await listApplicationRepositoryConfigs(workspaceId));
}));

integrationRouter.get("/integrations/github/application-repos/:id", asyncRoute(async (request, response) => {
  const config = await getApplicationRepositoryConfig(String(request.params.id));
  if (!config) {
    response.status(404).json({ message: "Application repository config not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, config.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  response.json(config);
}));

integrationRouter.post("/integrations/github/application-repos/:id/test-connection", asyncRoute(async (request, response) => {
  const config = await getApplicationRepositoryRuntimeConfig(String(request.params.id));
  if (!config) {
    response.status(404).json({ message: "Application repository config not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, config.workspaceId, ["Owner", "Admin"]))) return;
  const repo = await getRepoInfo(runtimeToGitHubConfig(config));
  response.json({ ok: true, repository: repo.full_name, defaultBranch: repo.default_branch, url: repo.html_url });
}));

integrationRouter.post("/integrations/github/application-repos/:id/register-webhook", asyncRoute(async (request, response) => {
  const config = await getApplicationRepositoryRuntimeConfig(String(request.params.id));
  if (!config) {
    response.status(404).json({ message: "Application repository config not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, config.workspaceId, ["Owner", "Admin"]))) return;
  try {
    const hook = await createGitHubWebhook(runtimeToGitHubConfig(config), {
      webhookUrl: config.webhookUrl || webhookUrl(),
      secret: config.webhookSecret,
    });
    response.json(await updateApplicationRepositoryWebhook({
      configId: config.id,
      webhookStatus: hook.active ? "Connected" : "Pending",
      webhookId: hook.id,
      webhookUrl: config.webhookUrl || webhookUrl(),
      webhookError: undefined,
      userId: request.userId,
    }));
  } catch (error) {
    const updated = await updateApplicationRepositoryWebhook({
      configId: config.id,
      webhookStatus: "Failed",
      webhookError: error instanceof Error ? error.message : "Webhook registration failed.",
      userId: request.userId,
    });
    response.status(400).json({
      message: "Automatic webhook registration failed.",
      config: updated,
      manualSetup: {
        webhookUrl: config.webhookUrl || webhookUrl(),
        contentType: "application/json",
        secret: config.webhookSecretMasked,
        events: ["push", "pull_request"],
      },
    });
  }
}));

integrationRouter.delete("/integrations/github/application-repos/:id", asyncRoute(async (request, response) => {
  const config = await getApplicationRepositoryConfig(String(request.params.id));
  if (!config) {
    response.status(404).json({ message: "Application repository config not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, config.workspaceId, ["Owner", "Admin"]))) return;
  await deleteApplicationRepositoryConfig(config.id);
  response.status(204).end();
}));

integrationRouter.get("/integrations/github/repository-activity", asyncRoute(async (request, response) => {
  const filters = z.object({
    workspaceId: z.string().min(1),
    repositoryConfigId: z.string().optional(),
    status: z.enum(["New", "Reviewed", "Ignored"]).optional(),
  }).parse(request.query);
  if (!(await requireWorkspaceRole(request, response, filters.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  response.json(await listRepositoryActivities(filters));
}));

integrationRouter.get("/integrations/github/repository-activity/:id", asyncRoute(async (request, response) => {
  const activity = await getRepositoryActivity(String(request.params.id));
  if (!activity) {
    response.status(404).json({ message: "Repository activity not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, activity.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  response.json(activity);
}));

integrationRouter.patch("/integrations/github/repository-activity/:id/status", asyncRoute(async (request, response) => {
  const input = z.object({ status: z.enum(["New", "Reviewed", "Ignored"]) }).parse(request.body);
  const activity = await getRepositoryActivity(String(request.params.id));
  if (!activity) {
    response.status(404).json({ message: "Repository activity not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, activity.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  response.json(await updateRepositoryActivityStatus(activity.id, input.status));
}));

async function runImpactAnalysisForActivity(activityId: string, createdBy?: string, replaceExisting = false) {
  const activity = await getRepositoryActivity(activityId);
  if (!activity) return null;
  const [automationConfig, repositoryAnalysis, provider] = await Promise.all([
    getAutomationRepositoryConfig(activity.workspaceId),
    getRepositoryAnalysis(activity.workspaceId),
    resolveAIProviderForFeature(activity.workspaceId, "repository-impact"),
  ]);
  const analysis = analyzeRepositoryImpact({
    activity,
    automationConfig,
    repositoryAnalysis,
    createdBy,
  });
  const saved = await saveRepositoryImpactAnalysis(analysis, { replaceExisting });
  await createAIProviderUsageLog({
    workspaceId: activity.workspaceId,
    providerType: provider?.providerType ?? "default",
    providerName: provider?.providerName ?? "AI QA Copilot Default AI",
    modelName: provider?.modelName ?? process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    featureName: "repository-impact",
    tokenUsage: 0,
    status: "Success",
    createdBy,
  });
  return saved;
}

integrationRouter.post("/integrations/github/repository-activity/:activityId/impact-analysis", asyncRoute(async (request, response) => {
  const activity = await getRepositoryActivity(String(request.params.activityId));
  if (!activity) {
    response.status(404).json({ message: "Repository activity not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, activity.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const existing = await getRepositoryImpactAnalysisByActivity(activity.id);
  if (existing) {
    response.json(existing);
    return;
  }
  response.status(201).json(await runImpactAnalysisForActivity(activity.id, request.userId));
}));

integrationRouter.get("/integrations/github/repository-activity/:activityId/impact-analysis", asyncRoute(async (request, response) => {
  const activity = await getRepositoryActivity(String(request.params.activityId));
  if (!activity) {
    response.status(404).json({ message: "Repository activity not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, activity.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  const analysis = await getRepositoryImpactAnalysisByActivity(activity.id);
  if (!analysis) {
    response.status(404).json({ message: "Impact analysis not found." });
    return;
  }
  response.json(analysis);
}));

integrationRouter.post("/integrations/github/repository-activity/:activityId/impact-analysis/regenerate", asyncRoute(async (request, response) => {
  const activity = await getRepositoryActivity(String(request.params.activityId));
  if (!activity) {
    response.status(404).json({ message: "Repository activity not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, activity.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  response.json(await runImpactAnalysisForActivity(activity.id, request.userId, true));
}));

integrationRouter.patch("/integrations/github/impact-analysis/:impactAnalysisId/status", asyncRoute(async (request, response) => {
  const input = z.object({ status: z.enum(["Pending", "Completed", "Failed", "Reviewed"]) }).parse(request.body);
  const analysis = await getRepositoryImpactAnalysis(String(request.params.impactAnalysisId));
  if (!analysis) {
    response.status(404).json({ message: "Impact analysis not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, analysis.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  response.json(await updateRepositoryImpactAnalysisStatus(analysis.id, input.status));
}));

integrationRouter.post("/integrations/github/impact-analysis/:impactAnalysisId/generate-test-updates", asyncRoute(async (request, response) => {
  const analysis = await getRepositoryImpactAnalysis(String(request.params.impactAnalysisId));
  if (!analysis) {
    response.status(404).json({ message: "Impact analysis not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, analysis.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const runtimeConfig = await getAutomationRepositoryRuntimeConfig(analysis.workspaceId);
  if (!runtimeConfig) {
    response.status(400).json({ message: "Configure the automation repository before generating test updates." });
    return;
  }
  const provider = await resolveAIProviderForFeature(analysis.workspaceId, "repository-test-update");
  const repositoryAnalysis = await getRepositoryAnalysis(analysis.workspaceId);
  const learningProfile = runtimeConfig.id ? await refreshRepositoryLearningProfile(runtimeConfig.id, request.userId) : null;
  const updates = await generateRepositoryTestUpdates({
    impactAnalysis: analysis,
    automationConfig: toGitHubConfig(runtimeConfig),
    repositoryAnalysis: repositoryAnalysis ?? undefined,
    learningProfile,
    aiProvider: provider?.providerName ?? "AI QA Copilot Default AI",
    aiModel: provider?.modelName ?? process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    createdBy: request.userId,
  });
  await createAIProviderUsageLog({
    workspaceId: analysis.workspaceId,
    providerType: provider?.providerType ?? "default",
    providerName: provider?.providerName ?? "AI QA Copilot Default AI",
    modelName: provider?.modelName ?? process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    featureName: "repository-test-update",
    tokenUsage: 0,
    status: "Success",
    createdBy: request.userId,
  });
  response.status(201).json(await saveRepositoryGeneratedTestUpdates(analysis.id, updates));
}));

integrationRouter.get("/integrations/github/impact-analysis/:impactAnalysisId/test-updates", asyncRoute(async (request, response) => {
  const analysis = await getRepositoryImpactAnalysis(String(request.params.impactAnalysisId));
  if (!analysis) {
    response.status(404).json({ message: "Impact analysis not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, analysis.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  response.json(await listRepositoryGeneratedTestUpdates(analysis.id));
}));

integrationRouter.patch("/integrations/github/test-updates/:updateId/approve", asyncRoute(async (request, response) => {
  const update = await getRepositoryGeneratedTestUpdate(String(request.params.updateId));
  if (!update) {
    response.status(404).json({ message: "Generated test update not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, update.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const config = await getAutomationRepositoryConfig(update.workspaceId);
  if (config?.id) void addRepositoryLearningFeedback(config.id, { action: "Approved", confidenceDelta: 3 }, request.userId);
  response.json(await updateRepositoryGeneratedTestUpdate(update.id, { status: "Approved" }));
}));

integrationRouter.patch("/integrations/github/test-updates/:updateId/reject", asyncRoute(async (request, response) => {
  const update = await getRepositoryGeneratedTestUpdate(String(request.params.updateId));
  if (!update) {
    response.status(404).json({ message: "Generated test update not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, update.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const config = await getAutomationRepositoryConfig(update.workspaceId);
  if (config?.id) void addRepositoryLearningFeedback(config.id, { action: "Rejected", confidenceDelta: -5 }, request.userId);
  response.json(await updateRepositoryGeneratedTestUpdate(update.id, { status: "Rejected" }));
}));

integrationRouter.patch("/integrations/github/test-updates/:updateId/edit", asyncRoute(async (request, response) => {
  const body = z.object({ newCode: z.string().min(1), updateSummary: z.string().optional() }).parse(request.body);
  const update = await getRepositoryGeneratedTestUpdate(String(request.params.updateId));
  if (!update) {
    response.status(404).json({ message: "Generated test update not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, update.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const config = await getAutomationRepositoryConfig(update.workspaceId);
  const locatorStrategy = body.newCode.includes("getByTestId")
    ? "getByTestId"
    : body.newCode.includes("getByRole")
      ? "getByRole"
      : undefined;
  if (config?.id) void addRepositoryLearningFeedback(config.id, { action: "Edited", locatorStrategy, confidenceDelta: 2 }, request.userId);
  response.json(await updateRepositoryGeneratedTestUpdate(update.id, {
    status: "Edited",
    newCode: body.newCode,
    updateSummary: body.updateSummary ?? update.updateSummary,
  }));
}));

integrationRouter.post("/integrations/github/test-updates/:updateId/regenerate", asyncRoute(async (request, response) => {
  const update = await getRepositoryGeneratedTestUpdate(String(request.params.updateId));
  if (!update) {
    response.status(404).json({ message: "Generated test update not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, update.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const config = await getAutomationRepositoryConfig(update.workspaceId);
  if (config?.id) void addRepositoryLearningFeedback(config.id, { action: "Regenerated", confidenceDelta: -1 }, request.userId);
  const regenerated = `${update.newCode.trimEnd()}\n\n// Regenerated by AI QA Copilot on ${new Date().toISOString()}\n`;
  response.json(await updateRepositoryGeneratedTestUpdate(update.id, {
    status: "Pending",
    newCode: regenerated,
    updateSummary: `${update.updateSummary} (regenerated)`,
    confidenceScore: Math.min(99, update.confidenceScore + 2),
  }));
}));

integrationRouter.post("/integrations/github/impact-analysis/:impactAnalysisId/run-validation", asyncRoute(async (request, response) => {
  const validationInput = z.object({
    validationMode: z.enum(["quick", "impact", "full"]).default("quick"),
    browser: z.string().trim().min(1).max(40).default("chromium"),
  }).parse(request.body ?? {});
  const analysis = await getRepositoryImpactAnalysis(String(request.params.impactAnalysisId));
  if (!analysis) {
    response.status(404).json({ message: "Impact analysis not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, analysis.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const runtimeConfig = await getAutomationRepositoryRuntimeConfig(analysis.workspaceId);
  if (!runtimeConfig) {
    response.status(400).json({ message: "Configure the automation repository before running validation." });
    return;
  }
  const updates = await listRepositoryGeneratedTestUpdates(analysis.id);
  const runningRun = await saveRepositoryValidationRun({
    workspaceId: analysis.workspaceId,
    projectId: analysis.projectId,
    impactAnalysisId: analysis.id,
    status: "Running",
    totalTests: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
    browser: "chromium",
    environment: "github-actions",
    validationMode: validationInput.validationMode,
    command: "Preparing GitHub Actions validation...",
    logs: "Validation started. AI QA Copilot is creating a temporary validation branch, pushing approved Playwright updates, and dispatching GitHub Actions.",
    stdout: "",
    stderr: "",
    failedTestNames: [],
    failedTests: [],
    screenshots: [],
    videos: [],
    traceFiles: [],
    validationProvider: "github-actions",
    createdBy: request.userId,
  });

  void (async () => {
    try {
      const run = await validateRepositoryTestUpdatesWithGitHubActions({
        impactAnalysis: analysis,
        updates,
        automationConfig: toGitHubConfig(runtimeConfig),
        createdBy: request.userId,
        validationMode: validationInput.validationMode,
        browser: validationInput.browser,
      });
      const savedRun = await updateRepositoryValidationRun(runningRun.id, run);
      if (!savedRun) return;
      if (runtimeConfig.id) {
        void addRepositoryLearningFeedback(runtimeConfig.id, {
          action: savedRun.status === "Passed" ? "Validation Passed" : "Validation Failed",
          confidenceDelta: savedRun.status === "Passed" ? 5 : -4,
        }, request.userId);
      }
      void generateValidationRecommendation({
        impactAnalysis: analysis,
        validationRun: savedRun,
        updates,
        status: "Generated",
        createdBy: request.userId,
      })
        .then((recommendation) => saveRepositoryValidationRecommendation(recommendation))
        .catch((error) => {
          console.error("AI validation recommendation failed", error);
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Validation failed unexpectedly.";
      await updateRepositoryValidationRun(runningRun.id, {
        status: "Error",
        duration: 0,
        logs: [
          "GitHub Actions validation could not complete.",
          "Backend Playwright execution is disabled for Render deployments, so no local npx playwright test command was run.",
          message,
        ].join("\n\n"),
        stdout: "",
        stderr: message,
        errorDetails: message,
        failureExplanation: "Validation could not complete through GitHub Actions. Verify the automation repository workflow, token permissions, and branch access, then try again.",
        validationProvider: "github-actions",
        completedAt: new Date().toISOString(),
      });
    }
  })();

  response.status(202).json(runningRun);
}));

integrationRouter.get("/integrations/github/impact-analysis/:impactAnalysisId/validation-result", asyncRoute(async (request, response) => {
  const analysis = await getRepositoryImpactAnalysis(String(request.params.impactAnalysisId));
  if (!analysis) {
    response.status(404).json({ message: "Impact analysis not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, analysis.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  const run = await getLatestRepositoryValidationRun(analysis.id);
  if (!run) {
    response.status(404).json({ message: "Validation result not found." });
    return;
  }
  response.json(run);
}));

integrationRouter.post("/integrations/github/impact-analysis/:impactAnalysisId/generate-fix-suggestion", asyncRoute(async (request, response) => {
  const analysis = await getRepositoryImpactAnalysis(String(request.params.impactAnalysisId));
  if (!analysis) {
    response.status(404).json({ message: "Impact analysis not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, analysis.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const run = await getLatestRepositoryValidationRun(analysis.id);
  if (!run) {
    response.status(400).json({ message: "Run validation before generating a fix suggestion." });
    return;
  }
  const provider = await resolveAIProviderForFeature(analysis.workspaceId, "repository-fix-suggestion");
  await createAIProviderUsageLog({
    workspaceId: analysis.workspaceId,
    providerType: provider?.providerType ?? "default",
    providerName: provider?.providerName ?? "AI QA Copilot Default AI",
    modelName: provider?.modelName ?? process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    featureName: "repository-fix-suggestion",
    tokenUsage: 0,
    status: "Success",
    createdBy: request.userId,
  });
  response.json({ suggestion: buildFailureSuggestion(run) });
}));

integrationRouter.post("/integrations/github/impact-analysis/:impactAnalysisId/failure-explanation", asyncRoute(async (request, response) => {
  const analysis = await getRepositoryImpactAnalysis(String(request.params.impactAnalysisId));
  if (!analysis) {
    response.status(404).json({ message: "Impact analysis not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, analysis.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const run = await getLatestRepositoryValidationRun(analysis.id);
  if (!run) {
    response.status(400).json({ message: "Run validation before generating a failure explanation." });
    return;
  }
  const provider = await resolveAIProviderForFeature(analysis.workspaceId, "playwright-validation-failure");
  await createAIProviderUsageLog({
    workspaceId: analysis.workspaceId,
    providerType: provider?.providerType ?? "default",
    providerName: provider?.providerName ?? "AI QA Copilot Default AI",
    modelName: provider?.modelName ?? process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    featureName: "playwright-validation-failure",
    tokenUsage: 0,
    status: "Success",
    createdBy: request.userId,
  });
  const explanation = buildFailureSuggestion(run);
  const updated = await updateRepositoryValidationRun(run.id, {
    aiFailureExplanation: explanation,
    failureExplanation: explanation,
  });
  response.json({ suggestion: explanation, validationRun: updated ?? run });
}));

integrationRouter.post("/integrations/github/impact-analysis/:impactAnalysisId/validation-recommendation", asyncRoute(async (request, response) => {
  const analysis = await getRepositoryImpactAnalysis(String(request.params.impactAnalysisId));
  if (!analysis) {
    response.status(404).json({ message: "Impact analysis not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, analysis.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const run = await getLatestRepositoryValidationRun(analysis.id);
  if (!run) {
    response.status(400).json({ message: "Run validation before generating AI recommendation." });
    return;
  }
  const updates = await listRepositoryGeneratedTestUpdates(analysis.id);
  const recommendation = await generateValidationRecommendation({
    impactAnalysis: analysis,
    validationRun: run,
    updates,
    status: "Generated",
    createdBy: request.userId,
  });
  response.status(201).json(await saveRepositoryValidationRecommendation(recommendation));
}));

integrationRouter.get("/integrations/github/impact-analysis/:impactAnalysisId/validation-recommendation", asyncRoute(async (request, response) => {
  const analysis = await getRepositoryImpactAnalysis(String(request.params.impactAnalysisId));
  if (!analysis) {
    response.status(404).json({ message: "Impact analysis not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, analysis.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  const recommendation = await getLatestRepositoryValidationRecommendation(analysis.id);
  if (!recommendation) {
    response.status(404).json({ message: "AI validation recommendation not found." });
    return;
  }
  response.json(recommendation);
}));

integrationRouter.post("/integrations/github/impact-analysis/:impactAnalysisId/validation-recommendation/regenerate", asyncRoute(async (request, response) => {
  const analysis = await getRepositoryImpactAnalysis(String(request.params.impactAnalysisId));
  if (!analysis) {
    response.status(404).json({ message: "Impact analysis not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, analysis.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const run = await getLatestRepositoryValidationRun(analysis.id);
  if (!run) {
    response.status(400).json({ message: "Run validation before regenerating AI recommendation." });
    return;
  }
  const updates = await listRepositoryGeneratedTestUpdates(analysis.id);
  const recommendation = await generateValidationRecommendation({
    impactAnalysis: analysis,
    validationRun: run,
    updates,
    status: "Regenerated",
    createdBy: request.userId,
  });
  response.status(201).json(await saveRepositoryValidationRecommendation(recommendation));
}));

integrationRouter.post("/validation/:validationRunId/failure-analysis", asyncRoute(async (request, response) => {
  const run = await getRepositoryValidationRun(String(request.params.validationRunId));
  if (!run) {
    response.status(404).json({ message: "Validation run not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, run.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const existing = await getValidationFailureAnalysis(run.id);
  if (existing) {
    response.json(existing);
    return;
  }
  const analysis = await getRepositoryImpactAnalysis(run.impactAnalysisId);
  const provider = await resolveAIProviderForFeature(run.workspaceId, "playwright-validation-failure");
  const failedTest = run.failedTests?.[0];
  const affectedTestFile = failedTest?.testFile || run.failedTestNames?.[0] || analysis?.impactedTests[0]?.testFilePath || "Unknown";
  const logs = `${run.errorDetails ?? ""}\n${run.stderr ?? ""}\n${run.stdout ?? ""}`.toLowerCase();
  const category = logs.includes("locator") || logs.includes("strict mode") || logs.includes("getby")
    ? "Locator Issue"
    : logs.includes("expect") || logs.includes("assert")
      ? "Assertion Issue"
      : logs.includes("timeout") || logs.includes("navigation")
        ? "App Flow Change"
        : logs.includes("network") || logs.includes("api")
          ? "Network/API Issue"
          : logs.includes("module") || logs.includes("package") || logs.includes("dependency")
            ? "Dependency Issue"
            : run.validationProvider === "backend-fallback"
              ? "Environment Issue"
              : "Unknown";
  const riskLevel = run.failed > 0 ? "High" : "Low";
  const saved = await saveValidationFailureAnalysis({
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    validationRunId: run.id,
    rootCause: failedTest?.errorMessage || run.errorDetails || "Validation failed and requires review of workflow logs.",
    category,
    affectedModule: analysis?.impactedModules[0] || "Unknown",
    affectedTestFile,
    confidenceScore: category === "Unknown" ? 68 : 86,
    recommendedFix: category === "Locator Issue"
      ? "Review locators and prefer resilient Playwright locators such as getByRole, getByLabel, or getByTestId."
      : category === "Assertion Issue"
        ? "Update the expected result or assertion to match the changed application behavior."
        : "Review the failed flow, generated update, and application change before retrying validation.",
    autoFixAvailable: category !== "Dependency Issue" && category !== "Environment Issue" && affectedTestFile !== "Unknown",
    riskLevel,
    aiProvider: provider?.providerName ?? "AI QA Copilot Default AI",
    aiModel: provider?.modelName ?? process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
  });
  await createAIProviderUsageLog({
    workspaceId: run.workspaceId,
    providerType: provider?.providerType ?? "default",
    providerName: provider?.providerName ?? "AI QA Copilot Default AI",
    modelName: provider?.modelName ?? process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    featureName: "playwright-validation-failure",
    status: "Success",
    createdBy: request.userId,
  });
  response.status(201).json(saved);
}));

integrationRouter.get("/validation/:validationRunId/failure-analysis", asyncRoute(async (request, response) => {
  const run = await getRepositoryValidationRun(String(request.params.validationRunId));
  if (!run) {
    response.status(404).json({ message: "Validation run not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, run.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  const analysis = await getValidationFailureAnalysis(run.id);
  if (!analysis) {
    response.status(404).json({ message: "Failure analysis not found." });
    return;
  }
  response.json(analysis);
}));

integrationRouter.post("/validation/:validationRunId/auto-fix", asyncRoute(async (request, response) => {
  const run = await getRepositoryValidationRun(String(request.params.validationRunId));
  if (!run) {
    response.status(404).json({ message: "Validation run not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, run.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const failureAnalysis = await getValidationFailureAnalysis(run.id);
  if (!failureAnalysis) {
    response.status(400).json({ message: "Run AI failure analysis before generating an auto fix." });
    return;
  }
  if (!failureAnalysis.autoFixAvailable) {
    response.status(400).json({ message: "Auto-fix is not available for this failure category." });
    return;
  }
  const updates = await listRepositoryGeneratedTestUpdates(run.impactAnalysisId);
  const target = updates.find((update) => update.testFilePath === failureAnalysis.affectedTestFile) ?? updates[0];
  if (!target) {
    response.status(400).json({ message: "No generated Playwright update is available for auto-fix." });
    return;
  }
  const fixedCode = [
    target.newCode.trimEnd(),
    "",
    `// AI QA Copilot auto-fix suggestion: ${failureAnalysis.recommendedFix}`,
    "// Review and approve this fix before retrying validation.",
  ].join("\n");
  const saved = await saveValidationAutoFix({
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    validationRunId: run.id,
    failureAnalysisId: failureAnalysis.id,
    testFilePath: target.testFilePath,
    oldCode: target.newCode,
    fixedCode,
    fixSummary: `AI suggested fix for ${failureAnalysis.category}: ${failureAnalysis.recommendedFix}`,
    status: "Pending",
    confidenceScore: Math.max(60, failureAnalysis.confidenceScore - 4),
    createdBy: request.userId,
  });
  response.status(201).json(saved);
}));

integrationRouter.get("/validation/:validationRunId/auto-fix", asyncRoute(async (request, response) => {
  const run = await getRepositoryValidationRun(String(request.params.validationRunId));
  if (!run) {
    response.status(404).json({ message: "Validation run not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, run.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  response.json(await listValidationAutoFixes(run.id));
}));

integrationRouter.patch("/validation/auto-fix/:fixId/approve", asyncRoute(async (request, response) => {
  const fix = await getValidationAutoFix(String(request.params.fixId));
  if (!fix) {
    response.status(404).json({ message: "Auto fix not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, fix.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const run = await getRepositoryValidationRun(fix.validationRunId);
  const updates = run ? await listRepositoryGeneratedTestUpdates(run.impactAnalysisId) : [];
  const target = updates.find((update) => update.testFilePath === fix.testFilePath);
  if (target) {
    await updateRepositoryGeneratedTestUpdate(target.id, {
      status: "Edited",
      newCode: fix.fixedCode,
      updateSummary: fix.fixSummary,
      confidenceScore: fix.confidenceScore,
    });
  }
  response.json(await updateValidationAutoFix(fix.id, { status: "Approved" }));
}));

integrationRouter.patch("/validation/auto-fix/:fixId/reject", asyncRoute(async (request, response) => {
  const fix = await getValidationAutoFix(String(request.params.fixId));
  if (!fix) {
    response.status(404).json({ message: "Auto fix not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, fix.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  response.json(await updateValidationAutoFix(fix.id, { status: "Rejected" }));
}));

integrationRouter.patch("/validation/auto-fix/:fixId/edit", asyncRoute(async (request, response) => {
  const body = z.object({ fixedCode: z.string().min(1), fixSummary: z.string().optional() }).parse(request.body);
  const fix = await getValidationAutoFix(String(request.params.fixId));
  if (!fix) {
    response.status(404).json({ message: "Auto fix not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, fix.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  response.json(await updateValidationAutoFix(fix.id, {
    status: "Edited",
    fixedCode: body.fixedCode,
    fixSummary: body.fixSummary ?? fix.fixSummary,
  }));
}));

integrationRouter.post("/validation/:validationRunId/retry", asyncRoute(async (request, response) => {
  const previousRun = await getRepositoryValidationRun(String(request.params.validationRunId));
  if (!previousRun) {
    response.status(404).json({ message: "Validation run not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, previousRun.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const attempts = await listValidationRetryAttempts(previousRun.id);
  if (attempts.length >= 3) {
    response.status(400).json({ message: "Maximum retry attempts reached." });
    return;
  }
  const analysis = await getRepositoryImpactAnalysis(previousRun.impactAnalysisId);
  const runtimeConfig = analysis ? await getAutomationRepositoryRuntimeConfig(analysis.workspaceId) : null;
  if (!analysis || !runtimeConfig) {
    response.status(400).json({ message: "Impact analysis or automation repository config is missing." });
    return;
  }
  const updates = await listRepositoryGeneratedTestUpdates(analysis.id);
  const run = await validateRepositoryTestUpdatesWithGitHubActions({
    impactAnalysis: analysis,
    updates,
    automationConfig: toGitHubConfig(runtimeConfig),
    createdBy: request.userId,
  });
  const savedRun = await saveRepositoryValidationRun(run);
  const retry = await saveValidationRetryAttempt({
    workspaceId: previousRun.workspaceId,
    projectId: previousRun.projectId,
    validationRunId: previousRun.id,
    retryValidationRunId: savedRun.id,
    attemptNumber: attempts.length + 2,
    status: savedRun.status,
    passed: savedRun.passed,
    failed: savedRun.failed,
    skipped: savedRun.skipped,
    duration: savedRun.duration,
    workflowRunId: savedRun.workflowRunId,
    workflowUrl: savedRun.workflowRunUrl,
    createdBy: request.userId,
  });
  response.status(201).json({ retry, validationRun: savedRun });
}));

integrationRouter.get("/validation/:validationRunId/retries", asyncRoute(async (request, response) => {
  const run = await getRepositoryValidationRun(String(request.params.validationRunId));
  if (!run) {
    response.status(404).json({ message: "Validation run not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, run.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  response.json(await listValidationRetryAttempts(run.id));
}));

integrationRouter.get("/validation/history", asyncRoute(async (request, response) => {
  const filters = z.object({
    workspaceId: z.string().optional(),
    projectId: z.string().optional(),
    status: z.string().optional(),
  }).parse(request.query);
  const workspaceId = filters.workspaceId ?? defaultWorkspaceId;
  if (workspaceId && !(await requireWorkspaceRole(request, response, workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  response.json(await listRepositoryValidationRuns({ ...filters, workspaceId }));
}));

integrationRouter.get("/validation/history/:validationRunId", asyncRoute(async (request, response) => {
  const run = await getRepositoryValidationRun(String(request.params.validationRunId));
  if (!run) {
    response.status(404).json({ message: "Validation run not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, run.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  response.json({
    validationRun: run,
    failureAnalysis: await getValidationFailureAnalysis(run.id),
    autoFixes: await listValidationAutoFixes(run.id),
    retries: await listValidationRetryAttempts(run.id),
    recommendation: await getLatestRepositoryValidationRecommendation(run.impactAnalysisId),
  });
}));

integrationRouter.get("/release-readiness/summary", asyncRoute(async (request, response) => {
  const workspaceId = z.object({ workspaceId: z.string().optional() }).parse(request.query).workspaceId ?? defaultWorkspaceId;
  if (workspaceId && !(await requireWorkspaceRole(request, response, workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  const runs = await listRepositoryValidationRuns({ workspaceId });
  const failedValidations = runs.filter((run) => run.status === "Failed" || run.status === "Error").length;
  const completed = runs.filter((run) => ["Passed", "Failed", "Completed", "Error"].includes(run.status));
  const passed = completed.filter((run) => run.status === "Passed").length;
  const automationPassRate = completed.length ? Math.round((passed / completed.length) * 100) : 0;
  const pendingFixes = runs.length ? (await Promise.all(runs.slice(0, 25).map((run) => listValidationAutoFixes(run.id))))
    .flat()
    .filter((fix) => fix.status === "Pending").length : 0;
  const openHighRiskChanges = failedValidations + pendingFixes;
  const readinessScore = Math.max(0, Math.min(100, automationPassRate - failedValidations * 8 - pendingFixes * 5));
  const recommendation = readinessScore >= 90 ? "Ready for Release" : readinessScore >= 70 ? "Proceed with Caution" : "Not Recommended for Release";
  const snapshot = await saveReleaseReadinessSnapshot({
    workspaceId: workspaceId ?? "workspace_default",
    readinessScore,
    recommendation,
    automationPassRate,
    failedValidations,
    openHighRiskChanges,
    pendingFixes,
    prsWaitingForReview: 0,
    coverageScore: 0,
    manualExecutionPassRate: 0,
    riskSummary: {
      failedValidations,
      pendingFixes,
      passedValidations: passed,
    },
  });
  response.json(snapshot);
}));

integrationRouter.get("/release-readiness/project/:projectId", asyncRoute(async (request, response) => {
  const projectId = String(request.params.projectId);
  const runs = await listRepositoryValidationRuns({ projectId });
  const workspaceId = runs[0]?.workspaceId ?? defaultWorkspaceId;
  if (!(await requireWorkspaceRole(request, response, workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  const failedValidations = runs.filter((run) => run.status === "Failed" || run.status === "Error").length;
  const passed = runs.filter((run) => run.status === "Passed").length;
  const automationPassRate = runs.length ? Math.round((passed / runs.length) * 100) : 0;
  const readinessScore = Math.max(0, Math.min(100, automationPassRate - failedValidations * 10));
  response.json(await saveReleaseReadinessSnapshot({
    workspaceId,
    projectId,
    readinessScore,
    recommendation: readinessScore >= 90 ? "Ready for Release" : readinessScore >= 70 ? "Proceed with Caution" : "Not Recommended for Release",
    automationPassRate,
    failedValidations,
    openHighRiskChanges: failedValidations,
    pendingFixes: 0,
    prsWaitingForReview: 0,
    coverageScore: 0,
    manualExecutionPassRate: 0,
    riskSummary: { failedValidations, passedValidations: passed },
  }));
}));

integrationRouter.post("/integrations/github/impact-analysis/:impactAnalysisId/create-pr", asyncRoute(async (request, response) => {
  const analysis = await getRepositoryImpactAnalysis(String(request.params.impactAnalysisId));
  if (!analysis) {
    response.status(404).json({ message: "Impact analysis not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, analysis.workspaceId, ["Owner", "Admin", "QA Lead"]))) return;
  const runtimeConfig = await getAutomationRepositoryRuntimeConfig(analysis.workspaceId);
  if (!runtimeConfig) {
    response.status(400).json({ message: "Configure the automation repository before creating a PR." });
    return;
  }
  const updates = await listRepositoryGeneratedTestUpdates(analysis.id);
  const approvedUpdates = updates.filter((update) => update.status === "Approved" || update.status === "Edited");
  if (!approvedUpdates.length) {
    response.status(400).json({ message: "Approve at least one generated test update before creating a PR." });
    return;
  }
  const validationRun = await getLatestRepositoryValidationRun(analysis.id);
  const validationRecommendation = await getLatestRepositoryValidationRecommendation(analysis.id);
  const force = z.object({ force: z.boolean().optional() }).parse(request.body ?? {}).force ?? false;
  if (!validationRun) {
    response.status(400).json({ message: "Run Playwright validation before creating a pull request." });
    return;
  }
  if (validationRun.status !== "Passed" && !force) {
    response.status(409).json({ message: "Validation did not pass. Confirm force=true to create a PR for QA review." });
    return;
  }
  const pr = await createImpactUpdatePullRequest({
    impactAnalysis: analysis,
    automationConfig: toGitHubConfig(runtimeConfig),
    approvedUpdates,
    validationRun,
    validationRecommendation,
  });
  const saved = await saveRepositoryUpdatePullRequest({
    workspaceId: analysis.workspaceId,
    projectId: analysis.projectId,
    impactAnalysisId: analysis.id,
    branchName: pr.branchName,
    pullRequestUrl: pr.html_url,
    pullRequestNumber: pr.number,
    updatedFiles: pr.updatedFiles,
    validationRunId: validationRun?.id,
    status: "Created",
    createdBy: request.userId,
  });
  response.status(201).json({ ...saved, pullRequest: pr });
}));

integrationRouter.post("/integrations/github/analyze-repository", asyncRoute(async (request, response) => {
  const input = z.object({ workspaceId: z.string().min(1) }).parse(request.body);
  if (!(await requireWorkspaceRole(request, response, input.workspaceId, ["Owner", "Admin", "QA Lead"]))) return;
  const runtimeConfig = await getAutomationRepositoryRuntimeConfig(input.workspaceId);
  if (!runtimeConfig) {
    response.status(400).json({ message: "Configure GitHub automation repository before analysis." });
    return;
  }
  if (!runtimeConfig.token) {
    response.status(400).json({ message: "GitHub token could not be read. Please reconnect and save the GitHub automation repository configuration." });
    return;
  }
  try {
    const config = toGitHubConfig(runtimeConfig);
    const analysis = await analyzeGitHubRepository(config);
    const saved = await saveRepositoryAnalysis({
      workspaceId: input.workspaceId,
      integrationId: runtimeConfig.id,
      provider: "github",
      repoOwner: runtimeConfig.owner,
      repoName: runtimeConfig.repo,
      branch: runtimeConfig.defaultBranch,
      ...analysis,
      createdBy: request.userId ?? "Current User",
    });
    response.status(201).json(saved);
  } catch (error) {
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 502;
    response.status(statusCode >= 500 ? 502 : statusCode).json({
      message: error instanceof Error ? `GitHub repository analysis failed: ${error.message}` : "GitHub repository analysis failed.",
    });
  }
}));

integrationRouter.get("/integrations/github/analysis", asyncRoute(async (request, response) => {
  const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.query);
  if (!(await requireWorkspaceRole(request, response, workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  response.json(await getRepositoryAnalysis(workspaceId));
}));

integrationRouter.get("/repositories/:repositoryId/learning", asyncRoute(async (request, response) => {
  const repositoryId = String(request.params.repositoryId);
  const profile = await getRepositoryLearningProfile(repositoryId) ?? await refreshRepositoryLearningProfile(repositoryId, request.userId);
  if (!profile) {
    response.status(404).json({ message: "Repository learning profile not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, profile.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  response.json(profile);
}));

integrationRouter.post("/repositories/:repositoryId/learning/refresh", asyncRoute(async (request, response) => {
  const repositoryId = String(request.params.repositoryId);
  const profile = await refreshRepositoryLearningProfile(repositoryId, request.userId);
  if (!profile) {
    response.status(404).json({ message: "Repository learning profile not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, profile.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  response.json(profile);
}));

integrationRouter.get("/repositories/:repositoryId/learning/patterns", asyncRoute(async (request, response) => {
  const repositoryId = String(request.params.repositoryId);
  const profile = await getRepositoryLearningProfile(repositoryId) ?? await refreshRepositoryLearningProfile(repositoryId, request.userId);
  if (!profile) {
    response.status(404).json({ message: "Repository learning profile not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, profile.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  response.json({
    locatorPreferences: profile.locatorPreferences,
    namingPatterns: profile.namingPatterns,
    testStylePatterns: profile.testStylePatterns,
    authPatterns: profile.authPatterns,
    commonFlows: profile.commonFlows,
  });
}));

integrationRouter.post("/repositories/:repositoryId/learning/feedback", asyncRoute(async (request, response) => {
  const input = z.object({
    action: z.enum(["Approved", "Rejected", "Edited", "Regenerated", "Validation Passed", "Validation Failed"]),
    locatorStrategy: z.string().optional(),
    confidenceDelta: z.number().optional(),
  }).parse(request.body);
  const profile = await addRepositoryLearningFeedback(String(request.params.repositoryId), input, request.userId);
  if (!profile) {
    response.status(404).json({ message: "Repository learning profile not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, profile.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  response.json(profile);
}));

integrationRouter.get("/repositories/:repositoryId/learning/confidence", asyncRoute(async (request, response) => {
  const repositoryId = String(request.params.repositoryId);
  const profile = await getRepositoryLearningProfile(repositoryId) ?? await refreshRepositoryLearningProfile(repositoryId, request.userId);
  if (!profile) {
    response.status(404).json({ message: "Repository learning profile not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, profile.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"]))) return;
  response.json({
    repositoryMatchScore: profile.repositoryMatchScore,
    locatorConfidence: profile.locatorConfidence,
    assertionConfidence: profile.assertionConfidence,
    namingConfidence: profile.namingConfidence,
    businessFlowConfidence: profile.businessFlowConfidence,
    validationConfidence: profile.validationConfidence,
    overallConfidence: profile.overallConfidence,
    aiConfidenceTrend: profile.aiConfidenceTrend,
  });
}));

integrationRouter.delete("/repositories/:repositoryId/learning", asyncRoute(async (request, response) => {
  const profile = await getRepositoryLearningProfile(String(request.params.repositoryId));
  if (!profile) {
    response.status(404).json({ message: "Repository learning profile not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, profile.workspaceId, ["Owner", "Admin"]))) return;
  response.json(await resetRepositoryLearningProfile(String(request.params.repositoryId), request.userId));
}));

integrationRouter.post("/integrations/github/automation-onboarding/initialize", asyncRoute(async (request, response) => {
  const input = z.object({ workspaceId: z.string().min(1) }).parse(request.body);
  if (!(await requireWorkspaceRole(request, response, input.workspaceId, ["Owner", "Admin", "QA Lead"]))) return;
  const runtimeConfig = await getAutomationRepositoryRuntimeConfig(input.workspaceId);
  if (!runtimeConfig) {
    response.status(400).json({ message: "Configure GitHub automation repository before Automation Repository Onboarding." });
    return;
  }
  const config = toGitHubConfig(runtimeConfig);
  const analysis = await getRepositoryAnalysis(input.workspaceId);
  const missingFiles = new Set(analysis?.missingFiles ?? []);
  const testFolderPath = analysis?.testFolderPath || runtimeConfig.testFolderPath || "tests";
  if (!analysis?.githubActionsCompatible) missingFiles.add(".github/workflows/playwright-validation.yml");
  if (analysis?.framework === "Unknown") missingFiles.add("package.json");
  if (!analysis || !analysis.scannedFiles.some((file) => file === "playwright.config.ts" || file === "playwright.config.js")) {
    missingFiles.add("playwright.config.ts");
  }
  if (!analysis?.testFolderPath) missingFiles.add(`${testFolderPath.replace(/\/$/, "")}/aiqa-onboarding.spec.ts`);
  const filesToCreate = [...missingFiles].filter((file) => onboardingFileContent(file, testFolderPath));
  if (!filesToCreate.length) {
    response.json({
      message: "Automation Repository Onboarding is already ready. No missing initialization files were detected.",
      branchName: null,
      files: [],
      pullRequest: null,
    });
    return;
  }
  const branchName = onboardingBranchName();
  await createBranch(config, branchName);
  for (const filePath of filesToCreate) {
    await createOrReplaceFile(config, {
      branchName,
      filePath,
      content: onboardingFileContent(filePath, testFolderPath),
      message: `AI QA Copilot: initialize ${filePath}`,
    });
  }
  const pullRequest = await createPullRequest(config, {
    branchName,
    title: "AI QA Copilot: Automation Repository Onboarding",
    body: [
      "This pull request initializes the automation repository for AI QA Copilot validation.",
      "",
      "Created files:",
      ...filesToCreate.map((file) => `- ${file}`),
      "",
      "AI QA Copilot will use this setup to run Playwright validation through GitHub Actions.",
    ].join("\n"),
  });
  response.status(201).json({
    message: "Automation Repository Onboarding initialization PR created.",
    branchName,
    files: filesToCreate,
    pullRequest,
  });
}));

integrationRouter.put("/integrations/github/analysis/override", asyncRoute(async (request, response) => {
  const input = AnalysisOverrideSchema.parse(request.body);
  if (!(await requireWorkspaceRole(request, response, input.workspaceId, ["Owner", "Admin", "QA Lead"]))) return;
  const updated = await overrideRepositoryAnalysis(input.workspaceId, {
    framework: input.framework,
    language: input.language,
    buildTool: input.buildTool,
    testFolderPath: input.testFolderPath,
    pageObjectFolderPath: input.pageObjectFolderPath,
    usesPageObjectModel: input.usesPageObjectModel,
    usesFixtures: input.usesFixtures,
    namingConvention: input.namingConvention,
    importStyle: input.importStyle,
    pattern: input.pattern,
    confidenceScore: 95,
  }, request.userId);
  if (!updated) {
    response.status(404).json({ message: "Repository analysis was not found. Analyze the repository first." });
    return;
  }
  response.json(updated);
}));

integrationRouter.post("/integrations/github/sync", asyncRoute(async (request, response) => {
  const input = z.object({ workspaceId: z.string().min(1) }).parse(request.body);
  if (!(await requireWorkspaceRole(request, response, input.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const runtimeConfig = await getAutomationRepositoryRuntimeConfig(input.workspaceId);
  const config = toGitHubConfig(runtimeConfig);
  const analysis = await getRepositoryAnalysis(input.workspaceId);
  if (!analysis) {
    response.status(400).json({ message: "Run Smart Repository Analysis before syncing repository changes." });
    return;
  }
  const previous = await latestRepositorySync(input.workspaceId);
  const detection = await detectRepositorySyncImpact(config, {
    previousCommitSha: previous?.latestCommitSha,
    analysis,
  });
  const sync = await createRepositorySync({
    workspaceId: input.workspaceId,
    integrationId: runtimeConfig!.id,
    repoOwner: runtimeConfig!.owner,
    repoName: runtimeConfig!.repo,
    branch: runtimeConfig!.defaultBranch,
    previousCommitSha: previous?.latestCommitSha,
    latestCommitSha: detection.latestCommitSha,
    changedFiles: detection.changedFiles,
    impactedTests: detection.impactedTests,
    riskLevel: detection.riskLevel,
    status: "Completed",
    createdBy: request.userId,
  });
  response.status(201).json(sync);
}));

integrationRouter.get("/integrations/github/sync-history", asyncRoute(async (request, response) => {
  const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.query);
  if (!(await requireWorkspaceRole(request, response, workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  response.json(await listRepositorySyncs(workspaceId));
}));

integrationRouter.get("/integrations/github/sync/:syncId", asyncRoute(async (request, response) => {
  const sync = await getRepositorySync(String(request.params.syncId));
  if (!sync) {
    response.status(404).json({ message: "Repository sync not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, sync.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  response.json(sync);
}));

integrationRouter.post("/integrations/github/sync/:syncId/generate-suggestions", asyncRoute(async (request, response) => {
  const sync = await getRepositorySync(String(request.params.syncId));
  if (!sync) {
    response.status(404).json({ message: "Repository sync not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, sync.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  const suggestions = generateRepositorySyncSuggestions({
    changedFiles: sync.changedFiles,
    impactedTests: sync.impactedTests,
    riskLevel: sync.riskLevel,
  });
  response.json(await updateRepositorySyncSuggestions(sync.id, suggestions));
}));

integrationRouter.post("/integrations/github/sync/:syncId/generate-updates", asyncRoute(async (request, response) => {
  const sync = await getRepositorySync(String(request.params.syncId));
  if (!sync) {
    response.status(404).json({ message: "Repository sync not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, sync.workspaceId, ["Owner", "Admin", "QA Lead"]))) return;
  if (!sync.impactedTests.length && !sync.changedFiles.length) {
    response.status(400).json({ message: "No impacted tests or changed files were found for this sync." });
    return;
  }
  const config = toGitHubConfig(await getAutomationRepositoryRuntimeConfig(sync.workspaceId));
  const generatedUpdates = await generateRepositorySyncUpdates(config, {
    syncId: sync.id,
    impactedTests: sync.impactedTests,
    changedFiles: sync.changedFiles,
    riskLevel: sync.riskLevel,
  });
  const prPreview = buildRepositorySyncPrPreview({
    generatedUpdates,
    changedFiles: sync.changedFiles,
    riskLevel: sync.riskLevel,
  });
  response.json(await updateRepositorySyncGeneratedUpdates(sync.id, generatedUpdates, prPreview));
}));

integrationRouter.get("/integrations/github/sync/:syncId/pr-preview", asyncRoute(async (request, response) => {
  const sync = await getRepositorySync(String(request.params.syncId));
  if (!sync) {
    response.status(404).json({ message: "Repository sync not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, sync.workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  if (!sync.prPreview) {
    response.status(404).json({ message: "Generate Playwright updates before viewing PR preview." });
    return;
  }
  response.json(sync.prPreview);
}));

integrationRouter.post("/integrations/github/sync/:syncId/create-update-pr", asyncRoute(async (request, response) => {
  const sync = await getRepositorySync(String(request.params.syncId));
  if (!sync) {
    response.status(404).json({ message: "Repository sync not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, sync.workspaceId, ["Owner", "Admin", "QA Lead"]))) return;
  if (!sync.generatedUpdates?.length || !sync.prPreview) {
    response.status(400).json({ message: "Generate and review Playwright updates before creating a PR." });
    return;
  }
  const pr = await createRepositorySyncUpdatePullRequest(toGitHubConfig(await getAutomationRepositoryRuntimeConfig(sync.workspaceId)), {
    generatedUpdates: sync.generatedUpdates,
    preview: sync.prPreview,
  });
  const updated = await updateRepositorySyncUpdatePr(sync.id, {
    prUrl: pr.pullRequestUrl,
    branchName: pr.branchName,
    updatedFiles: pr.updatedFiles,
  });
  response.status(201).json({ ...updated, pullRequest: pr });
}));

integrationRouter.post("/integrations/github/sync/:syncId/create-pr", asyncRoute(async (request, response) => {
  const sync = await getRepositorySync(String(request.params.syncId));
  if (!sync) {
    response.status(404).json({ message: "Repository sync not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, sync.workspaceId, ["Owner", "Admin", "QA Lead"]))) return;
  if (!sync.aiSuggestions.length) {
    response.status(400).json({ message: "Generate AI suggestions before creating an update PR." });
    return;
  }
  const config = toGitHubConfig(await getAutomationRepositoryRuntimeConfig(sync.workspaceId));
  const pr = await createRepositorySyncPullRequest(config, {
    changedFiles: sync.changedFiles,
    impactedTests: sync.impactedTests,
    suggestions: sync.aiSuggestions,
    riskLevel: sync.riskLevel,
  });
  const updated = await updateRepositorySyncPr(sync.id, pr.pullRequestUrl);
  response.status(201).json({ ...updated, pullRequest: pr });
}));

integrationRouter.post("/integrations/github/push-playwright-test", asyncRoute(async (request, response) => {
  const input = PushPlaywrightSchema.parse(request.body);
  if (!(await requireWorkspaceRole(
    request,
    response,
    input.workspaceId,
    ["Owner", "Admin", "QA Lead", "QA Engineer"],
    "You do not have permission to push Playwright tests.",
  ))) return;
  const config = toGitHubConfig(await getAutomationRepositoryRuntimeConfig(input.workspaceId));
  const analysis = await getRepositoryAnalysis(input.workspaceId);
  const result = await pushPlaywrightTestToGitHub({
    ...config,
    testFolderPath: analysis?.testFolderPath || config.testFolderPath,
  }, {
    ...input,
    repositoryAnalysis: analysis,
  });
  response.status(201).json(result);
}));

githubWebhookRouter.post("/integrations/github/webhook", asyncRoute(async (request, response) => {
  const eventType = request.header("x-github-event");
  const deliveryId = request.header("x-github-delivery") ?? undefined;
  if (eventType !== "push" && eventType !== "pull_request") {
    response.status(202).json({ ok: true, ignored: true });
    return;
  }

  const payload = request.body as {
    repository?: { name?: string; owner?: { login?: string }; full_name?: string };
    ref?: string;
    before?: string;
    after?: string;
    head_commit?: { message?: string; author?: { name?: string; username?: string } };
    commits?: Array<{ added?: string[]; modified?: string[]; removed?: string[] }>;
    action?: string;
    pull_request?: {
      number?: number;
      title?: string;
      html_url?: string;
      state?: string;
      user?: { login?: string };
      head?: { ref?: string };
      base?: { ref?: string };
    };
  };
  const repoOwner = payload.repository?.owner?.login;
  const repoName = payload.repository?.name;
  if (!repoOwner || !repoName) {
    response.status(400).json({ message: "Repository payload is missing." });
    return;
  }

  const config = await findApplicationRepositoryRuntimeConfig({ owner: repoOwner, repo: repoName });
  if (!config) {
    response.status(404).json({ message: "Repository is not connected in AI QA Copilot." });
    return;
  }

  const rawBody = (request as typeof request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(request.body));
  if (!verifyGitHubSignature(rawBody, config.webhookSecret, request.header("x-hub-signature-256") ?? undefined)) {
    response.status(401).json({ message: "Invalid GitHub webhook signature." });
    return;
  }

  const gitHubConfig = runtimeToGitHubConfig(config);
  let changedFiles: RepositoryActivityChangedFile[] = [];
  let branch = payload.ref?.replace("refs/heads/", "");
  let commitSha = payload.after;
  let previousCommitSha = payload.before;
  let pullRequestNumber: number | undefined;
  let pullRequestTitle: string | undefined;
  let pullRequestUrl: string | undefined;
  let author = payload.head_commit?.author?.username || payload.head_commit?.author?.name;
  let message = payload.head_commit?.message;

  if (eventType === "push") {
    const filesFromPayload = payload.commits?.flatMap((commit) => [
      ...(commit.added ?? []).map((filename) => ({ filename, status: "added" })),
      ...(commit.modified ?? []).map((filename) => ({ filename, status: "modified" })),
      ...(commit.removed ?? []).map((filename) => ({ filename, status: "removed" })),
    ]) ?? [];
    changedFiles = mapGitHubFiles(filesFromPayload);
    if (previousCommitSha && commitSha) {
      try {
        const comparison = await compareGitHubCommits(gitHubConfig, previousCommitSha, commitSha);
        if (comparison.files?.length) changedFiles = mapGitHubFiles(comparison.files);
      } catch {
        // Payload file paths are enough for Sprint 1 if compare is unavailable.
      }
    }
  } else if (payload.pull_request) {
    pullRequestNumber = payload.pull_request.number;
    pullRequestTitle = payload.pull_request.title;
    pullRequestUrl = payload.pull_request.html_url;
    branch = payload.pull_request.head?.ref;
    author = payload.pull_request.user?.login;
    message = `${payload.action ?? "pull_request"} ${payload.pull_request.state ?? ""}`.trim();
    if (pullRequestNumber) {
      try {
        changedFiles = mapGitHubFiles(await listGitHubPullRequestFiles(gitHubConfig, pullRequestNumber));
      } catch {
        changedFiles = [];
      }
    }
  }

  const activity = await createRepositoryActivity({
    workspaceId: config.workspaceId,
    projectId: config.projectId,
    repositoryConfigId: config.id,
    repositoryType: config.repositoryType,
    provider: "github",
    eventType,
    action: payload.action,
    repoOwner,
    repoName,
    branch,
    commitSha,
    previousCommitSha,
    pullRequestNumber,
    pullRequestTitle,
    pullRequestUrl,
    author,
    message,
    changedFiles,
    fileCount: changedFiles.length,
    deliveryId,
    rawMetadata: {
      repository: payload.repository?.full_name,
      ref: payload.ref,
      eventType,
      action: payload.action,
    },
  });
  response.status(202).json({ ok: true, activityId: activity.id });
}));
