import { type RequestHandler, Router } from "express";
import { z } from "zod";

import {
  createModule,
  createProject,
  createRequirement,
  compareHistoryVersions,
  deleteHistory,
  deleteModule,
  deleteProject,
  deleteRequirement,
  exportHistory,
  getDashboardStats,
  getHistoryById,
  getHistoryByRequirement,
  getProject,
  listHistory,
  listModules,
  listProjects,
  listRequirements,
  saveGenerationHistory,
  updateHistoryStatus,
  updateModule,
  updateProject,
  updateRequirement,
} from "./projectStore.js";
import { TestPlanSchema } from "./types.js";

const router = Router();

const DomainSchema = z.enum(["Banking", "Healthcare", "E-commerce", "SaaS", "Education", "Custom"]);
const StatusSchema = z.enum(["Active", "Archived"]);
const HistoryStatusSchema = z.enum([
  "Draft",
  "Submitted for Review",
  "Changes Requested",
  "Approved",
  "Rejected",
]);
const PrioritySchema = z.enum(["Low", "Medium", "High", "Critical"]);
const TestTypeSchema = z.enum(["functional", "api", "ui", "integration"]);

const ProjectSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  domain: DomainSchema,
  status: StatusSchema.default("Active"),
});

const ModuleSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().default(""),
  priority: PrioritySchema.default("Medium"),
  status: StatusSchema.default("Active"),
});

const RequirementSchema = z.object({
  projectId: z.string().min(1),
  moduleId: z.string().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  acceptanceCriteria: z.string().trim().default(""),
  priority: PrioritySchema.default("Medium"),
  status: StatusSchema.default("Active"),
});

const SaveHistorySchema = z.object({
  projectId: z.string().min(1),
  moduleId: z.string().min(1),
  requirementId: z.string().optional(),
  requirementText: z.string().trim().min(10),
  testType: TestTypeSchema,
  output: TestPlanSchema,
  generatedBy: z.string().optional(),
  aiModelUsed: z.string().optional(),
});

const HistoryFilterSchema = z.object({
  projectId: z.string().optional(),
  moduleId: z.string().optional(),
  requirementId: z.string().optional(),
  generatedBy: z.string().optional(),
  status: HistoryStatusSchema.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minCoverage: z.coerce.number().optional(),
  maxCoverage: z.coerce.number().optional(),
  search: z.string().optional(),
});

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

router.get("/dashboard", asyncRoute(async (_request, response) => {
  response.json(await getDashboardStats());
}));

router.get("/projects", asyncRoute(async (_request, response) => {
  response.json(await listProjects());
}));

router.post("/projects", asyncRoute(async (request, response) => {
  const input = ProjectSchema.parse(request.body);
  response.status(201).json(await createProject(input));
}));

router.get("/projects/:projectId", asyncRoute(async (request, response) => {
  const project = await getProject(param(request.params.projectId));
  if (!project) {
    response.status(404).json({ message: "Project not found." });
    return;
  }
  response.json(project);
}));

router.patch("/projects/:projectId", asyncRoute(async (request, response) => {
  const input = ProjectSchema.partial().parse(request.body);
  const project = await updateProject(param(request.params.projectId), input);
  if (!project) {
    response.status(404).json({ message: "Project not found." });
    return;
  }
  response.json(project);
}));

router.patch("/projects/:projectId/archive", asyncRoute(async (request, response) => {
  const project = await updateProject(param(request.params.projectId), { status: "Archived" });
  if (!project) {
    response.status(404).json({ message: "Project not found." });
    return;
  }
  response.json(project);
}));

router.delete("/projects/:projectId", asyncRoute(async (request, response) => {
  const deleted = await deleteProject(param(request.params.projectId));
  if (!deleted) {
    response.status(404).json({ message: "Project not found." });
    return;
  }
  response.status(204).send();
}));

router.get("/projects/:projectId/modules", asyncRoute(async (request, response) => {
  response.json(await listModules(param(request.params.projectId)));
}));

router.post("/modules", asyncRoute(async (request, response) => {
  const input = ModuleSchema.parse(request.body);
  const moduleItem = await createModule(input);
  if (!moduleItem) {
    response.status(404).json({ message: "Project not found." });
    return;
  }
  response.status(201).json(moduleItem);
}));

router.patch("/modules/:moduleId", asyncRoute(async (request, response) => {
  const input = ModuleSchema.omit({ projectId: true }).partial().parse(request.body);
  const moduleItem = await updateModule(param(request.params.moduleId), input);
  if (!moduleItem) {
    response.status(404).json({ message: "Module not found." });
    return;
  }
  response.json(moduleItem);
}));

router.delete("/modules/:moduleId", asyncRoute(async (request, response) => {
  const deleted = await deleteModule(param(request.params.moduleId));
  if (!deleted) {
    response.status(404).json({ message: "Module not found." });
    return;
  }
  response.status(204).send();
}));

router.get("/modules/:moduleId/requirements", asyncRoute(async (request, response) => {
  response.json(await listRequirements(param(request.params.moduleId)));
}));

router.post("/requirements", asyncRoute(async (request, response) => {
  const input = RequirementSchema.parse(request.body);
  const requirement = await createRequirement(input);
  if (!requirement) {
    response.status(404).json({ message: "Project module not found." });
    return;
  }
  response.status(201).json(requirement);
}));

router.patch("/requirements/:requirementId", asyncRoute(async (request, response) => {
  const input = RequirementSchema.omit({ projectId: true, moduleId: true }).partial().parse(request.body);
  const requirement = await updateRequirement(param(request.params.requirementId), input);
  if (!requirement) {
    response.status(404).json({ message: "Requirement not found." });
    return;
  }
  response.json(requirement);
}));

router.delete("/requirements/:requirementId", asyncRoute(async (request, response) => {
  const deleted = await deleteRequirement(param(request.params.requirementId));
  if (!deleted) {
    response.status(404).json({ message: "Requirement not found." });
    return;
  }
  response.status(204).send();
}));

router.post("/test-case-history", asyncRoute(async (request, response) => {
  const input = SaveHistorySchema.parse(request.body);
  const saved = await saveGenerationHistory(input);
  if (!saved) {
    response.status(404).json({ message: "Project module not found." });
    return;
  }
  response.status(201).json(saved);
}));

router.get("/test-case-history", asyncRoute(async (request, response) => {
  const filters = HistoryFilterSchema.parse(request.query);
  response.json(await listHistory(filters));
}));

router.get("/test-case-history/compare", asyncRoute(async (request, response) => {
  const input = z.object({ fromId: z.string().min(1), toId: z.string().min(1) }).parse(request.query);
  const comparison = await compareHistoryVersions(input.fromId, input.toId);
  if (!comparison) {
    response.status(404).json({ message: "One or both history versions were not found." });
    return;
  }
  response.json(comparison);
}));

router.get("/test-case-history/:historyId", asyncRoute(async (request, response) => {
  const history = await getHistoryById(param(request.params.historyId));
  if (!history) {
    response.status(404).json({ message: "History record not found." });
    return;
  }
  response.json(history);
}));

router.patch("/test-case-history/:historyId/status", asyncRoute(async (request, response) => {
  const input = z.object({ status: HistoryStatusSchema }).parse(request.body);
  const history = await updateHistoryStatus(param(request.params.historyId), input.status);
  if (!history) {
    response.status(404).json({ message: "History record not found." });
    return;
  }
  response.json(history);
}));

router.delete("/test-case-history/:historyId", asyncRoute(async (request, response) => {
  const deleted = await deleteHistory(param(request.params.historyId));
  if (!deleted) {
    response.status(404).json({ message: "History record not found." });
    return;
  }
  response.status(204).send();
}));

router.get("/test-case-history/:historyId/export", asyncRoute(async (request, response) => {
  const { format } = z.object({ format: z.enum(["pdf", "excel", "csv", "json"]).default("csv") }).parse(request.query);
  const exported = await exportHistory(param(request.params.historyId), format);
  if (!exported) {
    response.status(404).json({ message: "History record not found." });
    return;
  }
  response.setHeader("Content-Type", exported.contentType);
  response.setHeader("Content-Disposition", `attachment; filename="${exported.filename}"`);
  response.send(exported.body);
}));

router.get("/requirements/:requirementId/history", asyncRoute(async (request, response) => {
  response.json(await getHistoryByRequirement(param(request.params.requirementId)));
}));

export { router as projectRouter };
