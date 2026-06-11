import { type RequestHandler, Router } from "express";
import { z } from "zod";

import {
  analyzeGitHubRepository,
  getRepoInfo,
  pushPlaywrightTestToGitHub,
  type GitHubAutomationConfig,
} from "./github.service.js";
import {
  getAutomationRepositoryConfig,
  getAutomationRepositoryRuntimeConfig,
  getCurrentWorkspaceMember,
  getRepositoryAnalysis,
  overrideRepositoryAnalysis,
  saveRepositoryAnalysis,
  saveAutomationRepositoryConfig,
} from "./projectStore.js";
import type { WorkspaceRole } from "./projectTypes.js";

export const integrationRouter = Router();

const GitHubConfigSchema = z.object({
  workspaceId: z.string().min(1),
  token: z.string().trim().min(20, "GitHub token is required."),
  owner: z.string().trim().min(1),
  repo: z.string().trim().min(1),
  defaultBranch: z.string().trim().min(1).default("main"),
  testFolderPath: z.string().trim().min(1).default("tests/e2e"),
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

integrationRouter.post("/integrations/github/analyze-repository", asyncRoute(async (request, response) => {
  const input = z.object({ workspaceId: z.string().min(1) }).parse(request.body);
  if (!(await requireWorkspaceRole(request, response, input.workspaceId, ["Owner", "Admin", "QA Lead"]))) return;
  const runtimeConfig = await getAutomationRepositoryRuntimeConfig(input.workspaceId);
  const config = toGitHubConfig(runtimeConfig);
  const analysis = await analyzeGitHubRepository(config);
  const saved = await saveRepositoryAnalysis({
    workspaceId: input.workspaceId,
    integrationId: runtimeConfig!.id,
    provider: "github",
    repoOwner: runtimeConfig!.owner,
    repoName: runtimeConfig!.repo,
    branch: runtimeConfig!.defaultBranch,
    ...analysis,
    createdBy: request.userId ?? "Current User",
  });
  response.status(201).json(saved);
}));

integrationRouter.get("/integrations/github/analysis", asyncRoute(async (request, response) => {
  const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.query);
  if (!(await requireWorkspaceRole(request, response, workspaceId, ["Owner", "Admin", "QA Lead", "QA Engineer"]))) return;
  response.json(await getRepositoryAnalysis(workspaceId));
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
