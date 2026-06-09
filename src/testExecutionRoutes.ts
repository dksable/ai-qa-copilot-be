import { type RequestHandler, Router } from "express";
import { z } from "zod";

import {
  createTestRun,
  deleteTestRun,
  exportTestRunReport,
  getTestExecutionDashboard,
  getTestExecutionHistory,
  getTestExecutionReports,
  getTestRun,
  listApprovedTestCaseVersions,
  listTestExecutions,
  listTestRuns,
  updateTestExecutionDetails,
  updateTestExecutionStatus,
  updateTestRun,
} from "./projectStore.js";

const router = Router();

const EnvironmentSchema = z.enum(["QA", "UAT", "Staging", "Production"]);
const TestRunStatusSchema = z.enum(["Not Started", "In Progress", "Completed"]);
const ExecutionStatusSchema = z.enum(["Not Executed", "Passed", "Failed", "Blocked", "Skipped"]);

const TestRunSchema = z.object({
  name: z.string().trim().min(1),
  projectId: z.string().min(1),
  moduleId: z.string().min(1),
  requirementId: z.string().optional(),
  environment: EnvironmentSchema,
  buildVersion: z.string().trim().min(1),
  assignedTester: z.string().trim().optional().default(""),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  description: z.string().trim().default(""),
  historyIds: z.array(z.string()).optional(),
});

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

router.get("/approved-test-case-versions", asyncRoute(async (request, response) => {
  const filters = z.object({
    projectId: z.string().optional(),
    moduleId: z.string().optional(),
    requirementId: z.string().optional(),
  }).parse(request.query);
  response.json(await listApprovedTestCaseVersions(filters));
}));

router.post("/test-runs", asyncRoute(async (request, response) => {
  const input = TestRunSchema.parse(request.body);
  const run = await createTestRun({ ...input, createdBy: request.userId ?? "Current User" });
  if (!run) {
    response.status(404).json({ message: "Selected project or module was not found." });
    return;
  }
  response.status(201).json(run);
}));

router.get("/test-runs", asyncRoute(async (request, response) => {
  const filters = z.object({
    projectId: z.string().optional(),
    status: TestRunStatusSchema.optional(),
  }).parse(request.query);
  response.json(await listTestRuns(filters));
}));

router.get("/test-runs/:id", asyncRoute(async (request, response) => {
  const run = await getTestRun(param(request.params.id));
  if (!run) {
    response.status(404).json({ message: "Test run not found." });
    return;
  }
  response.json(run);
}));

router.put("/test-runs/:id", asyncRoute(async (request, response) => {
  const input = TestRunSchema.partial().extend({ status: TestRunStatusSchema.optional() }).parse(request.body);
  const run = await updateTestRun(param(request.params.id), input);
  if (!run) {
    response.status(404).json({ message: "Test run not found." });
    return;
  }
  response.json(run);
}));

router.delete("/test-runs/:id", asyncRoute(async (request, response) => {
  const deleted = await deleteTestRun(param(request.params.id));
  if (!deleted) {
    response.status(404).json({ message: "Test run not found." });
    return;
  }
  response.status(204).send();
}));

router.get("/test-runs/:id/executions", asyncRoute(async (request, response) => {
  response.json(await listTestExecutions(param(request.params.id)));
}));

router.get("/test-runs/:id/export", asyncRoute(async (request, response) => {
  const { format } = z.object({ format: z.enum(["pdf", "excel"]).default("pdf") }).parse(request.query);
  const report = await exportTestRunReport(param(request.params.id), format);
  if (!report) {
    response.status(404).json({ message: "Test run not found." });
    return;
  }
  response.setHeader("Content-Type", report.contentType);
  response.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
  response.send(report.body);
}));

router.patch("/test-executions/:id/status", asyncRoute(async (request, response) => {
  const input = z.object({
    status: ExecutionStatusSchema,
    actualResult: z.string().optional(),
    comments: z.string().optional(),
    screenshotUrl: z.string().optional(),
    bugId: z.string().optional(),
    updatedBy: z.string().optional(),
  }).parse(request.body);
  const execution = await updateTestExecutionStatus(param(request.params.id), input);
  if (!execution) {
    response.status(404).json({ message: "Test execution not found." });
    return;
  }
  response.json(execution);
}));

router.patch("/test-executions/:id/details", asyncRoute(async (request, response) => {
  const input = z.object({
    actualResult: z.string().optional(),
    comments: z.string().optional(),
    screenshotUrl: z.string().optional(),
    bugId: z.string().optional(),
  }).parse(request.body);
  const execution = await updateTestExecutionDetails(param(request.params.id), input);
  if (!execution) {
    response.status(404).json({ message: "Test execution not found." });
    return;
  }
  response.json(execution);
}));

router.get("/test-executions/:id/history", asyncRoute(async (request, response) => {
  response.json(await getTestExecutionHistory(param(request.params.id)));
}));

router.get("/test-execution/dashboard", asyncRoute(async (_request, response) => {
  response.json(await getTestExecutionDashboard());
}));

router.get("/test-execution/reports", asyncRoute(async (_request, response) => {
  response.json(await getTestExecutionReports());
}));

export { router as testExecutionRouter };
