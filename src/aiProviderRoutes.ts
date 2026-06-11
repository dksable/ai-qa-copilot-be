import { type RequestHandler, Router } from "express";
import { z } from "zod";

import { testAIProvider } from "./aiProviderRouter.js";
import {
  createAIProvider,
  deleteAIProvider,
  getAIProvider,
  getAIProviderFeatureMappings,
  getAIProviderRuntimeConfig,
  getCurrentWorkspaceMember,
  listAIProviderUsage,
  listAIProviders,
  markAIProviderTestResult,
  setAIProviderStatus,
  updateAIProvider,
  updateAIProviderFeatureMappings,
} from "./projectStore.js";
import type { WorkspaceRole } from "./projectTypes.js";

const router = Router();

const ProviderTypeSchema = z.enum([
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "azure-openai",
  "openrouter",
  "custom-openai-compatible",
]);
const FeatureNameSchema = z.enum([
  "test-generation",
  "ai-chat",
  "playwright-generation",
  "requirement-impact",
  "coverage-score",
]);

const ProviderSchema = z.object({
  workspaceId: z.string().min(1),
  providerType: ProviderTypeSchema,
  providerName: z.string().trim().min(1),
  apiKey: z.string().trim().optional(),
  baseUrl: z.string().trim().optional(),
  modelName: z.string().trim().min(1),
  endpointUrl: z.string().trim().optional(),
  deploymentName: z.string().trim().optional(),
  apiVersion: z.string().trim().optional(),
  requestFormat: z.literal("OpenAI Compatible").optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  maxTokens: z.coerce.number().min(256).max(32000).optional(),
  isActive: z.boolean().optional(),
  fallbackToDefault: z.boolean().optional(),
});

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

async function requireWorkspaceRole(
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
  workspaceId: string,
  roles: WorkspaceRole[],
) {
  const member = request.userId ? await getCurrentWorkspaceMember(workspaceId, request.userId) : null;
  if (!member || !roles.includes(member.role)) {
    response.status(403).json({ message: "You do not have permission to manage AI providers." });
    return false;
  }
  return true;
}

router.get("/ai-providers", asyncRoute(async (request, response) => {
  const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.query);
  if (!(await requireWorkspaceRole(request, response, workspaceId, ["Owner", "Admin", "QA Lead"]))) return;
  const [providers, featureMappings] = await Promise.all([
    listAIProviders(workspaceId),
    getAIProviderFeatureMappings(workspaceId),
  ]);
  response.json({ providers, featureMappings });
}));

router.post("/ai-providers", asyncRoute(async (request, response) => {
  const input = ProviderSchema.parse(request.body);
  if (!(await requireWorkspaceRole(request, response, input.workspaceId, ["Owner", "Admin"]))) return;
  response.status(201).json(await createAIProvider({ ...input, createdBy: request.userId }));
}));

router.get("/ai-providers/usage", asyncRoute(async (request, response) => {
  const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.query);
  if (!(await requireWorkspaceRole(request, response, workspaceId, ["Owner", "Admin", "QA Lead"]))) return;
  response.json(await listAIProviderUsage(workspaceId));
}));

router.put("/ai-providers/feature-mapping", asyncRoute(async (request, response) => {
  const input = z.object({
    workspaceId: z.string().min(1),
    mappings: z.array(z.object({
      featureName: FeatureNameSchema,
      providerId: z.string().min(1),
      modelName: z.string().trim().optional(),
      isActive: z.boolean().optional(),
    })),
  }).parse(request.body);
  if (!(await requireWorkspaceRole(request, response, input.workspaceId, ["Owner", "Admin"]))) return;
  response.json(await updateAIProviderFeatureMappings(input.workspaceId, input.mappings, request.userId));
}));

router.get("/ai-providers/:id", asyncRoute(async (request, response) => {
  const provider = await getAIProvider(param(request.params.id));
  if (!provider) {
    response.status(404).json({ message: "AI provider not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, provider.workspaceId, ["Owner", "Admin", "QA Lead"]))) return;
  response.json(provider);
}));

router.put("/ai-providers/:id", asyncRoute(async (request, response) => {
  const current = await getAIProvider(param(request.params.id));
  if (!current) {
    response.status(404).json({ message: "AI provider not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, current.workspaceId, ["Owner", "Admin"]))) return;
  const input = ProviderSchema.partial().omit({ workspaceId: true }).parse(request.body);
  response.json(await updateAIProvider(current.id, { ...input, updatedBy: request.userId }));
}));

router.delete("/ai-providers/:id", asyncRoute(async (request, response) => {
  const current = await getAIProvider(param(request.params.id));
  if (!current) {
    response.status(404).json({ message: "AI provider not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, current.workspaceId, ["Owner", "Admin"]))) return;
  await deleteAIProvider(current.id);
  response.status(204).send();
}));

router.post("/ai-providers/:id/test", asyncRoute(async (request, response) => {
  const current = await getAIProvider(param(request.params.id));
  if (!current) {
    response.status(404).json({ message: "AI provider not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, current.workspaceId, ["Owner", "Admin"]))) return;
  const runtimeProvider = await getAIProviderRuntimeConfig(current.id);
  if (!runtimeProvider) {
    response.status(404).json({ message: "AI provider not found." });
    return;
  }
  try {
    const message = await testAIProvider(runtimeProvider, runtimeProvider.workspaceId, request.userId);
    await markAIProviderTestResult(current.id, "Success");
    response.json({ ok: true, message });
  } catch (error) {
    await markAIProviderTestResult(current.id, "Failed");
    response.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "AI provider connection failed.",
    });
  }
}));

router.patch("/ai-providers/:id/activate", asyncRoute(async (request, response) => {
  const current = await getAIProvider(param(request.params.id));
  if (!current) {
    response.status(404).json({ message: "AI provider not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, current.workspaceId, ["Owner", "Admin"]))) return;
  response.json(await setAIProviderStatus(current.id, true));
}));

router.patch("/ai-providers/:id/deactivate", asyncRoute(async (request, response) => {
  const current = await getAIProvider(param(request.params.id));
  if (!current) {
    response.status(404).json({ message: "AI provider not found." });
    return;
  }
  if (!(await requireWorkspaceRole(request, response, current.workspaceId, ["Owner", "Admin"]))) return;
  response.json(await setAIProviderStatus(current.id, false));
}));

export { router as aiProviderRouter };
