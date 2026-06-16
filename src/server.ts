import "dotenv/config";

import cors from "cors";
import express from "express";
import { z } from "zod";

import { generateTestPlanWithGroq } from "./groq.js";
import { aiChatRouter } from "./aiChatRoutes.js";
import { aiProviderRouter } from "./aiProviderRoutes.js";
import { analyticsRouter } from "./analyticsRoutes.js";
import { authRouter } from "./authRoutes.js";
import { exportRouter } from "./exportRoutes.js";
import { githubWebhookRouter, integrationRouter } from "./integrationRoutes.js";
import { requireAuth } from "./permissionMiddleware.js";
import { playwrightValidationRouter } from "./playwrightValidationRoutes.js";
import { pricingRouter } from "./pricingRoutes.js";
import { projectRouter } from "./projectRoutes.js";
import { reviewRouter } from "./reviewRoutes.js";
import { testExecutionRouter } from "./testExecutionRoutes.js";
import { workspaceRouter } from "./workspaceRoutes.js";
import { assertAIUsageQuota, expireExpiredTrials, getWorkspaceIdForProject, saveGenerationHistory } from "./projectStore.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const allowedOrigins = (process.env.CORS_ORIGIN ?? "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const localhostDevOrigin = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;

const GenerateRequestSchema = z.object({
  requirement: z.string().trim().min(10).max(8000),
  testType: z.enum(["functional", "api", "ui", "integration"]).default("functional"),
  projectId: z.string().optional(),
  moduleId: z.string().optional(),
  requirementId: z.string().optional(),
});

app.use(
  cors({
    origin(origin, callback) {
      if (
        allowedOrigins.includes("*") ||
        !origin ||
        allowedOrigins.includes(origin) ||
        localhostDevOrigin.test(origin)
      ) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  }),
);
app.options("*", cors());
app.use(express.json({
  limit: "1mb",
  verify: (request, _response, buffer) => {
    (request as typeof request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  },
}));

app.get("/", (_request, response) => {
  response.json({
    ok: true,
    service: "ai-qa-copilot-backend",
    routes: ["/health", "/api/generate-testcases"],
  });
});

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "ai-qa-copilot-backend" });
});

void expireExpiredTrials();
setInterval(() => {
  void expireExpiredTrials().catch((error) => {
    console.error("Trial expiry scheduler failed", error);
  });
}, 60 * 60 * 1000);

app.use("/api", authRouter);
app.use("/api", githubWebhookRouter);
app.use("/api", requireAuth);
app.use("/api", projectRouter);
app.use("/api", pricingRouter);
app.use("/api", analyticsRouter);
app.use("/api", exportRouter);
app.use("/api", integrationRouter);
app.use("/api", playwrightValidationRouter);
app.use("/api", aiChatRouter);
app.use("/api", aiProviderRouter);
app.use("/api", reviewRouter);
app.use("/api", testExecutionRouter);
app.use("/api", workspaceRouter);

app.post("/api/generate-testcases", async (request, response) => {
  try {
    const input = GenerateRequestSchema.parse(request.body);
    if (input.projectId && input.moduleId) {
      await assertAIUsageQuota({ projectId: input.projectId, moduleId: input.moduleId, type: "generation" });
    }

    const workspaceId = await getWorkspaceIdForProject(input.projectId);
    const testPlan = await generateTestPlanWithGroq({
      requirement: input.requirement,
      testType: input.testType,
    }, { workspaceId, createdBy: request.userId });

    if (input.projectId && input.moduleId) {
      const saved = await saveGenerationHistory({
        projectId: input.projectId,
        moduleId: input.moduleId,
        requirementId: input.requirementId,
        requirementText: input.requirement,
        testType: input.testType,
        output: testPlan,
        aiModelUsed: testPlan.aiModelUsed,
        userId: request.userId,
      });
      response.json({ ...testPlan, savedRequirementId: saved?.requirement.id, savedHistoryId: saved?.history.id });
      return;
    }

    response.json(testPlan);
  } catch (error) {
    if (error instanceof z.ZodError) {
      response.status(400).json({
        message: "Invalid request payload.",
        issues: error.issues,
      });
      return;
    }

    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (statusCode >= 500) console.error(error);
    response.status(statusCode).json({
      message: error instanceof Error ? error.message : "Unexpected backend error.",
    });
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error instanceof z.ZodError) {
    response.status(400).json({ message: "Invalid request payload.", issues: error.issues });
    return;
  }
  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 500;
  if (statusCode >= 500) console.error(error);
  response.status(statusCode).json({
    message: error instanceof Error ? error.message : "Unexpected backend error.",
  });
});

app.use((_request, response) => {
  response.status(404).json({ message: "Route not found." });
});

app.listen(port, () => {
  console.log(`AI QA Copilot backend running at http://localhost:${port}`);
});
