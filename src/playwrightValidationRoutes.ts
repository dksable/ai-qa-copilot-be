import { Router, type RequestHandler } from "express";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  createPlaywrightValidationJob,
  getPlaywrightValidationJob,
  listPlaywrightValidationJobs,
  updatePlaywrightValidationJob,
} from "./projectStore.js";
import { validatePlaywrightCode } from "./playwrightValidationService.js";

export const playwrightValidationRouter = Router();

const validationRoot = path.join(process.cwd(), "tmp", "playwright-validation");

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

playwrightValidationRouter.get(
  "/playwright-validation/:runId/artifacts",
  asyncRoute(async (request, response) => {
    const runId = z.string().regex(/^validation-[a-zA-Z0-9-]+$/).parse(request.params.runId);
    const runPath = path.join(validationRoot, runId);
    const files = await walkArtifactFiles(runPath);
    response.json({
      runId,
      files: files.map((file) => ({
        path: path.relative(runPath, file).replace(/\\/g, "/"),
        type: artifactType(file),
      })),
      reportUrl: files.some((file) => path.relative(runPath, file).replace(/\\/g, "/") === "playwright-report/index.html")
        ? `/api/playwright-validation/${runId}/report`
        : null,
    });
  }),
);

playwrightValidationRouter.get(
  "/playwright-validation/:runId/report",
  asyncRoute(async (request, response) => {
    const runId = z.string().regex(/^validation-[a-zA-Z0-9-]+$/).parse(request.params.runId);
    const reportPath = path.join(validationRoot, runId, "playwright-report", "index.html");
    response.sendFile(reportPath, (error) => {
      if (error && !response.headersSent) {
        response.status(404).json({ message: "Playwright HTML report not found." });
      }
    });
  }),
);

async function walkArtifactFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root);
    const files: string[] = [];
    for (const entry of entries) {
      if (entry === "node_modules") continue;
      const fullPath = path.join(root, entry);
      const info = await stat(fullPath);
      if (info.isDirectory()) {
        files.push(...await walkArtifactFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    return files;
  } catch {
    return [];
  }
}

function artifactType(filePath: string) {
  if (/playwright-report[/\\]index\.html$/i.test(filePath)) return "html-report";
  if (/playwright-report\.json$/i.test(filePath)) return "json-report";
  if (/\.(png|jpg|jpeg)$/i.test(filePath)) return "screenshot";
  if (/\.(webm|mp4)$/i.test(filePath)) return "video";
  if (/\.zip$/i.test(filePath)) return "trace";
  return "file";
}
