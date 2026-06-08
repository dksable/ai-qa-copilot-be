import { type RequestHandler, Router } from "express";
import { z } from "zod";

import { buildExcelExport, buildPdfExport, type ExportFormat } from "./exportService.js";
import {
  assertExportQuota,
  getHistoryById,
  listExportHistory,
  listHistory,
  recordExportHistory,
} from "./projectStore.js";
import type { ExportType, TestCaseHistoryRecord } from "./projectTypes.js";

const router = Router();

const HistoryStatusSchema = z.enum([
  "Draft",
  "Submitted for Review",
  "Changes Requested",
  "Approved",
  "Rejected",
]);
const ExportFormatSchema = z.enum(["excel", "pdf"]).default("excel");

const ExportFiltersSchema = z.object({
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

const ExportRequestSchema = z.object({
  historyIds: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  requirementId: z.string().optional(),
  filters: ExportFiltersSchema.optional(),
});

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function safeFilename(value: string) {
  return value.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "export";
}

async function getRecords(input: z.infer<typeof ExportRequestSchema>) {
  if (input.historyIds?.length) {
    const records = await Promise.all(input.historyIds.map((historyId) => getHistoryById(historyId)));
    return records.filter(Boolean) as TestCaseHistoryRecord[];
  }
  if (input.requirementId) {
    return listHistory({ requirementId: input.requirementId });
  }
  if (input.projectId) {
    return listHistory({ projectId: input.projectId });
  }
  return listHistory(input.filters ?? {});
}

function inferExportType(input: z.infer<typeof ExportRequestSchema>): ExportType {
  if (input.historyIds?.length === 1) return "version";
  if (input.historyIds?.length) return "versions";
  if (input.requirementId) return "requirement";
  if (input.projectId) return "project";
  return "filtered";
}

async function sendExport({
  response,
  records,
  format,
  exportType,
  projectId,
  requirementId,
  userId,
}: {
  response: Parameters<RequestHandler>[1];
  records: TestCaseHistoryRecord[];
  format: ExportFormat;
  exportType: ExportType;
  projectId?: string;
  requirementId?: string;
  userId?: string;
}) {
  if (!records.length) {
    response.status(404).json({ message: "No history records found for export." });
    return;
  }
  const blockedRecord = records.find((record) =>
    ["Rejected", "Changes Requested"].includes(record.reviewStatus),
  );
  if (blockedRecord) {
    response.status(403).json({
      message: "This test case version must be approved before final export.",
      historyId: blockedRecord.id,
      reviewStatus: blockedRecord.reviewStatus,
    });
    return;
  }

  await assertExportQuota(records[0].workspaceId);
  const buffer = format === "excel" ? await buildExcelExport(records) : await buildPdfExport(records);
  const extension = format === "excel" ? "xlsx" : "pdf";
  const contentType =
    format === "excel"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/pdf";
  const firstRecord = records[0];
  const filename = `${safeFilename(firstRecord.projectName)}-${exportType}-${Date.now()}.${extension}`;

  await recordExportHistory({
    exportType,
    exportFormat: format,
    workspaceId: records[0].workspaceId,
    userId,
    projectId,
    requirementId,
    totalRecords: records.length,
  });

  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  response.setHeader("Content-Length", buffer.byteLength);
  response.send(buffer);
}

router.get("/export/history", asyncRoute(async (_request, response) => {
  response.json(await listExportHistory());
}));

router.post("/export/excel", asyncRoute(async (request, response) => {
  const input = ExportRequestSchema.parse(request.body);
  await sendExport({
    response,
    records: await getRecords(input),
    format: "excel",
    exportType: inferExportType(input),
    projectId: input.projectId ?? input.filters?.projectId,
    requirementId: input.requirementId ?? input.filters?.requirementId,
    userId: request.userId,
  });
}));

router.post("/export/pdf", asyncRoute(async (request, response) => {
  const input = ExportRequestSchema.parse(request.body);
  await sendExport({
    response,
    records: await getRecords(input),
    format: "pdf",
    exportType: inferExportType(input),
    projectId: input.projectId ?? input.filters?.projectId,
    requirementId: input.requirementId ?? input.filters?.requirementId,
    userId: request.userId,
  });
}));

router.post("/export/project", asyncRoute(async (request, response) => {
  const input = z.object({ projectId: z.string().min(1), format: ExportFormatSchema }).parse(request.body);
  await sendExport({
    response,
    records: await listHistory({ projectId: input.projectId }),
    format: input.format,
    exportType: "project",
    projectId: input.projectId,
    userId: request.userId,
  });
}));

router.post("/export/requirement", asyncRoute(async (request, response) => {
  const input = z.object({ requirementId: z.string().min(1), format: ExportFormatSchema }).parse(request.body);
  await sendExport({
    response,
    records: await listHistory({ requirementId: input.requirementId }),
    format: input.format,
    exportType: "requirement",
    requirementId: input.requirementId,
    userId: request.userId,
  });
}));

router.post("/export/version", asyncRoute(async (request, response) => {
  const input = z
    .object({
      historyId: z.string().optional(),
      historyIds: z.array(z.string()).optional(),
      format: ExportFormatSchema,
    })
    .parse(request.body);
  const historyIds = input.historyIds ?? (input.historyId ? [input.historyId] : []);
  const records = (await Promise.all(historyIds.map((historyId) => getHistoryById(historyId)))).filter(
    Boolean,
  ) as TestCaseHistoryRecord[];
  await sendExport({
    response,
    records,
    format: input.format,
    exportType: historyIds.length > 1 ? "versions" : "version",
    projectId: records[0]?.projectId,
    requirementId: records[0]?.requirementId,
    userId: request.userId,
  });
}));

export { router as exportRouter };
