import { type RequestHandler, Router } from "express";
import { z } from "zod";

import {
  getAIQualityGeneratedOutput,
  getAIQualityProject,
  getAIQualityRepository,
  getAIQualitySummary,
  getAIQualityTrends,
  recalculateAIQualityMetrics,
  type AIQualityFilters,
} from "./projectStore.js";

const router = Router();

const FilterSchema = z.object({
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  moduleId: z.string().optional(),
  userId: z.string().optional(),
  status: z
    .enum(["Draft", "Submitted for Review", "Changes Requested", "Approved", "Rejected"])
    .optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  repositoryId: z.string().optional(),
  aiProvider: z.string().optional(),
  validationMode: z.string().optional(),
});

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function filters(query: unknown): AIQualityFilters {
  return FilterSchema.parse(query);
}

router.get("/ai-quality/summary", asyncRoute(async (request, response) => {
  response.json(await getAIQualitySummary(filters(request.query)));
}));

router.get("/ai-quality/project/:projectId", asyncRoute(async (request, response) => {
  response.json(await getAIQualityProject(String(request.params.projectId), filters(request.query)));
}));

router.get("/ai-quality/repository/:repositoryId", asyncRoute(async (request, response) => {
  response.json(await getAIQualityRepository(String(request.params.repositoryId), filters(request.query)));
}));

router.get("/ai-quality/trends", asyncRoute(async (request, response) => {
  response.json(await getAIQualityTrends(filters(request.query)));
}));

router.get("/ai-quality/generated-output/:id", asyncRoute(async (request, response) => {
  const detail = await getAIQualityGeneratedOutput(String(request.params.id));
  if (!detail) {
    response.status(404).json({ message: "Generated output quality detail not found." });
    return;
  }
  response.json(detail);
}));

router.post("/ai-quality/recalculate", asyncRoute(async (request, response) => {
  response.json(await recalculateAIQualityMetrics(filters(request.body ?? {}), request.userId));
}));

export { router as aiQualityRouter };
