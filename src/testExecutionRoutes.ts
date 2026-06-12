import { type RequestHandler, Router } from "express";
import { z } from "zod";

import {
  addTestExecutionAttachment,
  createTestRun,
  deleteTestExecutionAttachment,
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
const BrowserSchema = z.enum(["Chrome", "Firefox", "Safari", "Edge"]);
const OperatingSystemSchema = z.enum(["Windows", "macOS", "Linux", "Android", "iOS"]);
const ExecutionDetailsSchema = z.object({
  actualResult: z.string().optional(),
  comments: z.string().optional(),
  screenshotUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  logUrl: z.string().optional(),
  bugId: z.string().optional(),
  jiraBugId: z.string().optional(),
  jiraBugUrl: z.string().optional(),
  executionTime: z.number().min(0).optional(),
  browser: BrowserSchema.optional(),
  operatingSystem: OperatingSystemSchema.optional(),
  buildNumber: z.string().optional(),
  environment: EnvironmentSchema.optional(),
});
const AttachmentSchema = z.object({
  attachmentType: z.enum(["screenshot", "video", "log"]),
  url: z.string().trim().min(1),
  fileName: z.string().trim().optional(),
  mimeType: z.string().trim().optional(),
  sizeBytes: z.number().min(0).max(10 * 1024 * 1024).optional(),
});

function validateAttachment(input: z.infer<typeof AttachmentSchema>) {
  const executablePattern = /\.(exe|dll|bat|cmd|sh|js|jar|msi|app)$/i;
  if (input.fileName && executablePattern.test(input.fileName)) {
    const error = new Error("Executable attachment types are not allowed.");
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }
  const allowedMimePrefixes = {
    screenshot: ["image/"],
    video: ["video/"],
    log: ["text/", "application/json", "application/xml", "application/octet-stream"],
  }[input.attachmentType];
  if (input.mimeType && !allowedMimePrefixes.some((prefix) => input.mimeType!.startsWith(prefix))) {
    const error = new Error("Attachment file type is not allowed for this evidence category.");
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }
}

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
  const input = ExecutionDetailsSchema.extend({
    status: ExecutionStatusSchema,
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
  const input = ExecutionDetailsSchema.parse(request.body);
  const execution = await updateTestExecutionDetails(param(request.params.id), input);
  if (!execution) {
    response.status(404).json({ message: "Test execution not found." });
    return;
  }
  response.json(execution);
}));

router.post("/test-executions/:id/attachments", asyncRoute(async (request, response) => {
  const input = AttachmentSchema.parse(request.body);
  validateAttachment(input);
  const execution = await addTestExecutionAttachment(param(request.params.id), input);
  if (!execution) {
    response.status(404).json({ message: "Test execution not found." });
    return;
  }
  response.status(201).json(execution);
}));

router.delete("/test-executions/:id/attachments/:attachmentId", asyncRoute(async (request, response) => {
  const attachmentId = z.enum(["screenshot", "video", "log"]).parse(request.params.attachmentId);
  const execution = await deleteTestExecutionAttachment(param(request.params.id), attachmentId);
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
