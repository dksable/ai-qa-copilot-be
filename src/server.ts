import "dotenv/config";

import cors from "cors";
import express from "express";
import { z } from "zod";

import { generateTestPlanWithGroq } from "./groq.js";

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
app.use(express.json({ limit: "1mb" }));

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

app.post("/api/generate-testcases", async (request, response) => {
  try {
    const input = GenerateRequestSchema.parse(request.body);
    const testPlan = await generateTestPlanWithGroq(input);
    response.json(testPlan);
  } catch (error) {
    if (error instanceof z.ZodError) {
      response.status(400).json({
        message: "Invalid request payload.",
        issues: error.issues,
      });
      return;
    }

    console.error(error);
    response.status(500).json({
      message: error instanceof Error ? error.message : "Unexpected backend error.",
    });
  }
});

app.use((_request, response) => {
  response.status(404).json({ message: "Route not found." });
});

app.listen(port, () => {
  console.log(`AI QA Copilot backend running at http://localhost:${port}`);
});
