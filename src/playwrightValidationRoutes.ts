import { Router, type RequestHandler } from "express";
import { z } from "zod";

import {
  createPlaywrightValidationJob,
  getPlaywrightValidationJob,
  listPlaywrightValidationJobs,
  updatePlaywrightValidationJob,
} from "./projectStore.js";
import { validatePlaywrightCode } from "./playwrightValidationService.js";

export const playwrightValidationRouter = Router();

const ValidationJobSchema = z.object({
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  moduleId: z.string().optional(),
  requirementId: z.string().optional(),
  requirementTitle: z.string().optional(),
  fileName: z.string().trim().min(3).max(160),
  playwrightCode: z.string().min(1).max(80_000),
});

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (async (request, response, next) => {
    try {
      await handler(request, response, next);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler;
}

function runValidationInBackground(jobId: string) {
  setTimeout(() => {
    void (async () => {
      const job = await getPlaywrightValidationJob(jobId);
      if (!job) return;
      await updatePlaywrightValidationJob(jobId, { status: "Running" });
      try {
        const result = await validatePlaywrightCode({
          playwrightCode: job.playwrightCode,
          fileName: job.fileName,
          requirementTitle: job.requirementTitle,
        });
        await updatePlaywrightValidationJob(jobId, {
          status: result.status,
          result,
          errorMessage: undefined,
        });
      } catch (error) {
        await updatePlaywrightValidationJob(jobId, {
          status: "Error",
          errorMessage: error instanceof Error ? error.message : "Playwright validation failed.",
        });
      }
    })().catch((error) => {
      console.error("Playwright validation job failed", error);
    });
  }, 0);
}

playwrightValidationRouter.post(
  "/playwright-validation/jobs",
  asyncRoute(async (request, response) => {
    const input = ValidationJobSchema.parse(request.body);
    const job = await createPlaywrightValidationJob({
      ...input,
      createdBy: request.userId,
    });
    runValidationInBackground(job.id);
    response.status(202).json(job);
  }),
);

playwrightValidationRouter.get(
  "/playwright-validation/jobs",
  asyncRoute(async (request, response) => {
    const filters = z
      .object({
        workspaceId: z.string().optional(),
        projectId: z.string().optional(),
        requirementId: z.string().optional(),
      })
      .parse(request.query);
    response.json(await listPlaywrightValidationJobs(filters));
  }),
);

playwrightValidationRouter.get(
  "/playwright-validation/jobs/:jobId",
  asyncRoute(async (request, response) => {
    const jobId = String(request.params.jobId);
    const job = await getPlaywrightValidationJob(jobId);
    if (!job) {
      response.status(404).json({ message: "Playwright validation job not found." });
      return;
    }
    response.json(job);
  }),
);
