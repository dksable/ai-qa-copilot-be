import { type RequestHandler, Router } from "express";
import { z } from "zod";

import { getWorkspaceSubscription, listPlans, updateWorkspaceSubscription } from "./projectStore.js";

const router = Router();

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function workspaceIdFrom(request: Parameters<RequestHandler>[0]) {
  return String(request.query.workspaceId ?? request.body?.workspaceId ?? "");
}

router.get("/plans", asyncRoute(async (_request, response) => {
  response.json(await listPlans());
}));

router.get("/subscription/current", asyncRoute(async (request, response) => {
  const workspaceId = workspaceIdFrom(request);
  if (!workspaceId) {
    response.status(400).json({ message: "workspaceId is required." });
    return;
  }
  response.json(await getWorkspaceSubscription(workspaceId));
}));

router.patch("/subscription/current", asyncRoute(async (request, response) => {
  const input = z.object({
    workspaceId: z.string().min(1),
    planId: z.enum(["free", "pro", "enterprise"]),
    billingCycle: z.enum(["monthly", "yearly"]).optional(),
  }).parse(request.body);
  const result = await updateWorkspaceSubscription(input.workspaceId, input);
  if (!result) {
    response.status(404).json({ message: "Plan not found." });
    return;
  }
  response.json(result);
}));

export { router as pricingRouter };
