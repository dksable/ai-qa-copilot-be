import { type RequestHandler, Router } from "express";
import { z } from "zod";

import {
  getAnalyticsAIUsage,
  getAnalyticsCoverage,
  getAnalyticsExports,
  getAnalyticsGeneration,
  getAnalyticsProjectsHealth,
  getAnalyticsReview,
  getAnalyticsSummary,
  getAnalyticsUsersProductivity,
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
});

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function filters(query: unknown) {
  return FilterSchema.parse(query);
}

router.get("/analytics/summary", asyncRoute(async (request, response) => {
  response.json(await getAnalyticsSummary(filters(request.query)));
}));

router.get("/analytics/coverage", asyncRoute(async (request, response) => {
  response.json(await getAnalyticsCoverage(filters(request.query)));
}));

router.get("/analytics/generation", asyncRoute(async (request, response) => {
  response.json(await getAnalyticsGeneration(filters(request.query)));
}));

router.get("/analytics/review", asyncRoute(async (request, response) => {
  response.json(await getAnalyticsReview(filters(request.query)));
}));

router.get("/analytics/projects-health", asyncRoute(async (request, response) => {
  response.json(await getAnalyticsProjectsHealth(filters(request.query)));
}));

router.get("/analytics/users-productivity", asyncRoute(async (request, response) => {
  response.json(await getAnalyticsUsersProductivity(filters(request.query)));
}));

router.get("/analytics/ai-usage", asyncRoute(async (request, response) => {
  response.json(await getAnalyticsAIUsage(filters(request.query)));
}));

router.get("/analytics/exports", asyncRoute(async (request, response) => {
  response.json(await getAnalyticsExports(filters(request.query)));
}));

export { router as analyticsRouter };
