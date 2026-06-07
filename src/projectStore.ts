import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { TestFocus, TestPlan } from "./types.js";
import type {
  AIChat,
  AIChatSummary,
  DashboardStats,
  EntityStatus,
  ExportFormat,
  ExportHistory,
  ExportType,
  HistoryStatus,
  ModulePriority,
  Project,
  ProjectDatabase,
  ProjectDomain,
  ProjectModule,
  ProjectSummary,
  Requirement,
  TestCaseGenerationHistory,
  TestCaseHistoryCompare,
  TestCaseHistoryRecord,
} from "./projectTypes.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(currentDir, "../data");
const dbFile = path.join(dataDir, "db.json");
const defaultUserId = "demo-user";

const initialDb: ProjectDatabase = {
  users: [
    {
      id: defaultUserId,
      name: "Demo User",
      email: "demo@aiqacopilot.local",
      createdAt: new Date().toISOString(),
    },
  ],
  projects: [],
  modules: [],
  requirements: [],
  histories: [],
  exportHistories: [],
  aiChats: [],
};

let writeQueue = Promise.resolve();

function now() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function ensureDbFile() {
  await mkdir(dataDir, { recursive: true });
  try {
    await readFile(dbFile, "utf8");
  } catch {
    await writeFile(dbFile, JSON.stringify(initialDb, null, 2));
  }
}

async function readDb(): Promise<ProjectDatabase> {
  await ensureDbFile();
  await writeQueue;
  const raw = await readFile(dbFile, "utf8");
  const db = JSON.parse(raw) as ProjectDatabase;
  return {
    ...db,
    exportHistories: db.exportHistories ?? [],
    aiChats: db.aiChats ?? [],
    histories: (db.histories ?? []).map(normalizeHistory),
  };
}

async function writeDb(db: ProjectDatabase) {
  writeQueue = writeQueue.then(() => writeFile(dbFile, JSON.stringify(db, null, 2)));
  await writeQueue;
}

function countPlanTestCases(plan: TestPlan) {
  return plan.positive.length + plan.negative.length + plan.edge.length;
}

function normalizeHistory(history: TestCaseGenerationHistory): TestCaseGenerationHistory {
  return {
    ...history,
    userId: history.userId ?? defaultUserId,
    requirementInput: history.requirementInput ?? history.output.summary,
    status: history.status ?? "Draft",
    updatedAt: history.updatedAt ?? history.generatedAt,
  };
}

function enrichHistory(db: ProjectDatabase, history: TestCaseGenerationHistory): TestCaseHistoryRecord {
  const normalized = normalizeHistory(history);
  const project = db.projects.find((item) => item.id === normalized.projectId);
  const moduleItem = db.modules.find((item) => item.id === normalized.moduleId);
  const requirement = db.requirements.find((item) => item.id === normalized.requirementId);

  return {
    ...normalized,
    projectName: project?.name ?? "Unknown project",
    moduleName: moduleItem?.name ?? "Unknown module",
    requirementTitle: requirement?.title ?? "Untitled requirement",
  };
}

function allCases(plan: TestPlan) {
  return [...plan.positive, ...plan.negative, ...plan.edge];
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function summarizeProject(db: ProjectDatabase, project: Project): ProjectSummary {
  const modules = db.modules.filter((moduleItem) => moduleItem.projectId === project.id);
  const requirements = db.requirements.filter((requirement) => requirement.projectId === project.id);
  const histories = db.histories.filter((history) => history.projectId === project.id);
  const latestChildUpdate = [
    project.updatedAt,
    ...modules.map((moduleItem) => moduleItem.updatedAt),
    ...requirements.map((requirement) => requirement.updatedAt),
    ...histories.map((history) => history.generatedAt),
  ].sort((a, b) => b.localeCompare(a))[0];

  return {
    ...project,
    totalModules: modules.length,
    totalRequirements: requirements.length,
    totalTestCases: histories.reduce((total, history) => total + countPlanTestCases(history.output), 0),
    lastUpdatedAt: latestChildUpdate ?? project.updatedAt,
  };
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const db = await readDb();
  const projectSummaries = db.projects.map((project) => summarizeProject(db, project));
  const coverageScores = db.histories.map((history) => history.coverageScore);

  return {
    totalProjects: db.projects.length,
    activeProjects: db.projects.filter((project) => project.status === "Active").length,
    totalModules: db.modules.length,
    totalRequirements: db.requirements.length,
    totalTestCases: db.histories.reduce((total, history) => total + countPlanTestCases(history.output), 0),
    averageTestCoverageScore:
      coverageScores.length === 0
        ? 0
        : Math.round(coverageScores.reduce((total, score) => total + score, 0) / coverageScores.length),
    recentlyUpdatedProjects: projectSummaries
      .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))
      .slice(0, 5),
  };
}

export async function listProjects() {
  const db = await readDb();
  return db.projects
    .map((project) => summarizeProject(db, project))
    .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
}

export async function getProject(projectId: string) {
  const db = await readDb();
  const project = db.projects.find((item) => item.id === projectId);
  if (!project) return null;

  const modules = db.modules.filter((moduleItem) => moduleItem.projectId === projectId);
  const requirements = db.requirements.filter((requirement) => requirement.projectId === projectId);
  const histories = db.histories.filter((history) => history.projectId === projectId);

  return {
    project: summarizeProject(db, project),
    modules,
    requirements,
    histories,
  };
}

export async function createProject(input: {
  name: string;
  description: string;
  domain: ProjectDomain;
  status?: EntityStatus;
}) {
  const db = await readDb();
  const timestamp = now();
  const project: Project = {
    id: createId("project"),
    userId: defaultUserId,
    name: input.name,
    description: input.description,
    domain: input.domain,
    status: input.status ?? "Active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.projects.push(project);
  await writeDb(db);
  return summarizeProject(db, project);
}

export async function updateProject(projectId: string, input: Partial<Pick<Project, "name" | "description" | "domain" | "status">>) {
  const db = await readDb();
  const project = db.projects.find((item) => item.id === projectId);
  if (!project) return null;
  Object.assign(project, input, { updatedAt: now() });
  await writeDb(db);
  return summarizeProject(db, project);
}

export async function deleteProject(projectId: string) {
  const db = await readDb();
  const exists = db.projects.some((project) => project.id === projectId);
  if (!exists) return false;
  db.projects = db.projects.filter((project) => project.id !== projectId);
  db.modules = db.modules.filter((moduleItem) => moduleItem.projectId !== projectId);
  db.requirements = db.requirements.filter((requirement) => requirement.projectId !== projectId);
  db.histories = db.histories.filter((history) => history.projectId !== projectId);
  await writeDb(db);
  return true;
}

export async function listModules(projectId: string) {
  const db = await readDb();
  return db.modules
    .filter((moduleItem) => moduleItem.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createModule(input: {
  projectId: string;
  name: string;
  description: string;
  priority: ModulePriority;
  status?: EntityStatus;
}) {
  const db = await readDb();
  if (!db.projects.some((project) => project.id === input.projectId)) return null;
  const timestamp = now();
  const moduleItem: ProjectModule = {
    id: createId("module"),
    projectId: input.projectId,
    name: input.name,
    description: input.description,
    priority: input.priority,
    status: input.status ?? "Active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.modules.push(moduleItem);
  const project = db.projects.find((projectItem) => projectItem.id === input.projectId);
  if (project) project.updatedAt = timestamp;
  await writeDb(db);
  return moduleItem;
}

export async function updateModule(moduleId: string, input: Partial<Pick<ProjectModule, "name" | "description" | "priority" | "status">>) {
  const db = await readDb();
  const moduleItem = db.modules.find((item) => item.id === moduleId);
  if (!moduleItem) return null;
  Object.assign(moduleItem, input, { updatedAt: now() });
  await writeDb(db);
  return moduleItem;
}

export async function deleteModule(moduleId: string) {
  const db = await readDb();
  const exists = db.modules.some((moduleItem) => moduleItem.id === moduleId);
  if (!exists) return false;
  db.modules = db.modules.filter((moduleItem) => moduleItem.id !== moduleId);
  db.requirements = db.requirements.filter((requirement) => requirement.moduleId !== moduleId);
  db.histories = db.histories.filter((history) => history.moduleId !== moduleId);
  await writeDb(db);
  return true;
}

export async function listRequirements(moduleId: string) {
  const db = await readDb();
  return db.requirements
    .filter((requirement) => requirement.moduleId === moduleId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createRequirement(input: {
  projectId: string;
  moduleId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  priority: ModulePriority;
  status?: EntityStatus;
}) {
  const db = await readDb();
  const moduleItem = db.modules.find((item) => item.id === input.moduleId && item.projectId === input.projectId);
  if (!moduleItem) return null;
  const timestamp = now();
  const requirement: Requirement = {
    id: createId("requirement"),
    projectId: input.projectId,
    moduleId: input.moduleId,
    title: input.title,
    description: input.description,
    acceptanceCriteria: input.acceptanceCriteria,
    priority: input.priority,
    status: input.status ?? "Active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.requirements.push(requirement);
  const project = db.projects.find((projectItem) => projectItem.id === input.projectId);
  if (project) project.updatedAt = timestamp;
  moduleItem.updatedAt = timestamp;
  await writeDb(db);
  return requirement;
}

export async function updateRequirement(
  requirementId: string,
  input: Partial<Pick<Requirement, "title" | "description" | "acceptanceCriteria" | "priority" | "status">>,
) {
  const db = await readDb();
  const requirement = db.requirements.find((item) => item.id === requirementId);
  if (!requirement) return null;
  Object.assign(requirement, input, { updatedAt: now() });
  await writeDb(db);
  return requirement;
}

export async function deleteRequirement(requirementId: string) {
  const db = await readDb();
  const exists = db.requirements.some((requirement) => requirement.id === requirementId);
  if (!exists) return false;
  db.requirements = db.requirements.filter((requirement) => requirement.id !== requirementId);
  db.histories = db.histories.filter((history) => history.requirementId !== requirementId);
  await writeDb(db);
  return true;
}

function titleFromRequirement(requirement: string) {
  return requirement.split(/\n|\.|:/)[0]?.trim().slice(0, 90) || "Generated requirement";
}

export async function saveGenerationHistory(input: {
  projectId: string;
  moduleId: string;
  requirementId?: string;
  requirementText: string;
  testType: TestFocus;
  output: TestPlan;
  generatedBy?: string;
  aiModelUsed?: string;
}) {
  const db = await readDb();
  const moduleItem = db.modules.find((item) => item.id === input.moduleId && item.projectId === input.projectId);
  if (!moduleItem) return null;

  const timestamp = now();
  let requirement = input.requirementId
    ? db.requirements.find((item) => item.id === input.requirementId && item.moduleId === input.moduleId)
    : undefined;

  if (!requirement) {
    requirement = {
      id: createId("requirement"),
      projectId: input.projectId,
      moduleId: input.moduleId,
      title: titleFromRequirement(input.requirementText),
      description: input.requirementText,
      acceptanceCriteria: input.output.acceptanceCriteria.join("\n"),
      priority: "High",
      status: "Active",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.requirements.push(requirement);
  } else {
    requirement.description = input.requirementText;
    requirement.acceptanceCriteria = input.output.acceptanceCriteria.join("\n");
    requirement.updatedAt = timestamp;
  }

  const previousVersions = db.histories.filter((history) => history.requirementId === requirement.id);
  const history: TestCaseGenerationHistory = {
    id: createId("history"),
    userId: defaultUserId,
    projectId: input.projectId,
    moduleId: input.moduleId,
    requirementId: requirement.id,
    version: previousVersions.length + 1,
    requirementInput: input.requirementText,
    generatedAt: timestamp,
    generatedBy: input.generatedBy ?? "Current User",
    aiModelUsed: input.aiModelUsed ?? process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    testType: input.testType,
    coverageScore: input.output.coverageAnalysis.coverageScore,
    status: "Draft",
    updatedAt: timestamp,
    output: input.output,
  };

  db.histories.push(history);
  const project = db.projects.find((item) => item.id === input.projectId);
  if (project) project.updatedAt = timestamp;
  moduleItem.updatedAt = timestamp;

  await writeDb(db);
  return { requirement, history };
}

export async function getHistoryByRequirement(requirementId: string) {
  const db = await readDb();
  return db.histories
    .filter((history) => history.requirementId === requirementId)
    .map((history) => enrichHistory(db, history))
    .sort((a, b) => b.version - a.version);
}

export async function listHistory(filters: {
  projectId?: string;
  moduleId?: string;
  requirementId?: string;
  generatedBy?: string;
  status?: HistoryStatus;
  dateFrom?: string;
  dateTo?: string;
  minCoverage?: number;
  maxCoverage?: number;
  search?: string;
}) {
  const db = await readDb();
  const search = filters.search?.trim().toLowerCase();
  return db.histories
    .map((history) => enrichHistory(db, history))
    .filter((history) => !filters.projectId || history.projectId === filters.projectId)
    .filter((history) => !filters.moduleId || history.moduleId === filters.moduleId)
    .filter((history) => !filters.requirementId || history.requirementId === filters.requirementId)
    .filter((history) => !filters.generatedBy || history.generatedBy === filters.generatedBy)
    .filter((history) => !filters.status || history.status === filters.status)
    .filter((history) => !filters.dateFrom || history.generatedAt >= filters.dateFrom)
    .filter((history) => !filters.dateTo || history.generatedAt <= filters.dateTo)
    .filter((history) => filters.minCoverage === undefined || history.coverageScore >= filters.minCoverage)
    .filter((history) => filters.maxCoverage === undefined || history.coverageScore <= filters.maxCoverage)
    .filter((history) => {
      if (!search) return true;
      const caseTitles = allCases(history.output)
        .map((testCase) => testCase.title)
        .join(" ")
        .toLowerCase();
      return [
        history.projectName,
        history.moduleName,
        history.requirementTitle,
        history.requirementInput,
        caseTitles,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    })
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export async function getHistoryById(historyId: string) {
  const db = await readDb();
  const history = db.histories.find((item) => item.id === historyId);
  if (!history) return null;
  return enrichHistory(db, history);
}

export async function updateHistoryStatus(historyId: string, status: HistoryStatus) {
  const db = await readDb();
  const history = db.histories.find((item) => item.id === historyId);
  if (!history) return null;
  history.status = status;
  history.updatedAt = now();
  await writeDb(db);
  return enrichHistory(db, history);
}

export async function deleteHistory(historyId: string) {
  const db = await readDb();
  const exists = db.histories.some((history) => history.id === historyId);
  if (!exists) return false;
  db.histories = db.histories.filter((history) => history.id !== historyId);
  await writeDb(db);
  return true;
}

export async function compareHistoryVersions(fromId: string, toId: string): Promise<TestCaseHistoryCompare | null> {
  const db = await readDb();
  const fromHistory = db.histories.find((history) => history.id === fromId);
  const toHistory = db.histories.find((history) => history.id === toId);
  if (!fromHistory || !toHistory) return null;

  const from = enrichHistory(db, fromHistory);
  const to = enrichHistory(db, toHistory);
  const fromCases = new Map(allCases(from.output).map((testCase) => [testCase.id, testCase]));
  const toCases = new Map(allCases(to.output).map((testCase) => [testCase.id, testCase]));
  const addedTestCases = allCases(to.output)
    .filter((testCase) => !fromCases.has(testCase.id))
    .map((testCase) => `${testCase.id}: ${testCase.title}`);
  const removedTestCases = allCases(from.output)
    .filter((testCase) => !toCases.has(testCase.id))
    .map((testCase) => `${testCase.id}: ${testCase.title}`);
  const updatedTestCases = allCases(to.output)
    .filter((testCase) => {
      const previous = fromCases.get(testCase.id);
      return previous && JSON.stringify(previous) !== JSON.stringify(testCase);
    })
    .map((testCase) => `${testCase.id}: ${testCase.title}`);

  return {
    from,
    to,
    coverageDifference: to.coverageScore - from.coverageScore,
    addedTestCases,
    removedTestCases,
    updatedTestCases,
  };
}

export async function exportHistory(historyId: string, format: "csv" | "json" | "pdf" | "excel") {
  const history = await getHistoryById(historyId);
  if (!history) return null;

  if (format === "json") {
    return {
      contentType: "application/json",
      filename: `test-case-history-v${history.version}.json`,
      body: JSON.stringify(history, null, 2),
    };
  }

  const rows = [
    ["Project", history.projectName],
    ["Module", history.moduleName],
    ["Requirement", history.requirementTitle],
    ["Version", history.version],
    ["Status", history.status],
    ["Coverage Score", history.coverageScore],
    ["Generated By", history.generatedBy],
    ["AI Model", history.aiModelUsed],
    ["Generated Date", history.generatedAt],
    ["Requirement Input", history.requirementInput],
    ["Acceptance Criteria", history.output.acceptanceCriteria.join("\n")],
    ["Test Data", JSON.stringify(history.output.testData)],
    ["Positive Test Cases", JSON.stringify(history.output.positive)],
    ["Negative Test Cases", JSON.stringify(history.output.negative)],
    ["Edge Test Cases", JSON.stringify(history.output.edge)],
    ["Playwright Skeleton", history.output.playwright],
  ];

  if (format === "csv" || format === "excel") {
    return {
      contentType: format === "excel" ? "application/vnd.ms-excel" : "text/csv",
      filename: `test-case-history-v${history.version}.${format === "excel" ? "xls" : "csv"}`,
      body: rows.map((row) => row.map(csvCell).join(",")).join("\n"),
    };
  }

  const htmlRows = rows
    .map(([label, value]) => `<tr><th>${label}</th><td><pre>${String(value).replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char] ?? char)}</pre></td></tr>`)
    .join("");
  return {
    contentType: "text/html",
    filename: `test-case-history-v${history.version}.html`,
    body: `<!doctype html><html><head><meta charset="utf-8"><title>Test Case History</title><style>body{font-family:Arial,sans-serif;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:10px;vertical-align:top}th{text-align:left;background:#f5f5f5;width:220px}pre{white-space:pre-wrap;margin:0}</style></head><body><h1>Test Case History - Version ${history.version}</h1><table>${htmlRows}</table></body></html>`,
  };
}

export async function recordExportHistory(input: {
  exportType: ExportType;
  exportFormat: ExportFormat;
  projectId?: string;
  requirementId?: string;
  totalRecords: number;
}) {
  const db = await readDb();
  const exportRecord: ExportHistory = {
    id: createId("export"),
    userId: defaultUserId,
    exportType: input.exportType,
    exportFormat: input.exportFormat,
    projectId: input.projectId,
    requirementId: input.requirementId,
    totalRecords: input.totalRecords,
    createdAt: now(),
  };
  db.exportHistories.push(exportRecord);
  await writeDb(db);
  return exportRecord;
}

export async function listExportHistory() {
  const db = await readDb();
  return db.exportHistories.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function summarizeChat(db: ProjectDatabase, chat: AIChat): AIChatSummary {
  const project = db.projects.find((item) => item.id === chat.projectId);
  const requirement = db.requirements.find((item) => item.id === chat.requirementId);
  const lastMessage = [...chat.messages].reverse().find((message) => message.role === "user");

  return {
    id: chat.id,
    projectId: chat.projectId,
    moduleId: chat.moduleId,
    requirementId: chat.requirementId,
    historyVersionId: chat.historyVersionId,
    title: chat.title,
    projectName: project?.name ?? "Unknown project",
    requirementTitle: requirement?.title ?? "Untitled requirement",
    lastMessage: lastMessage?.content ?? "New chat",
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
}

export async function listAIChats() {
  const db = await readDb();
  return db.aiChats
    .map((chat) => summarizeChat(db, chat))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getAIChat(chatId: string) {
  const db = await readDb();
  const chat = db.aiChats.find((item) => item.id === chatId);
  if (!chat) return null;
  return {
    ...chat,
    projectName: db.projects.find((item) => item.id === chat.projectId)?.name ?? "Unknown project",
    moduleName: db.modules.find((item) => item.id === chat.moduleId)?.name ?? "Unknown module",
    requirementTitle:
      db.requirements.find((item) => item.id === chat.requirementId)?.title ?? "Untitled requirement",
  };
}

export async function deleteAIChat(chatId: string) {
  const db = await readDb();
  const exists = db.aiChats.some((chat) => chat.id === chatId);
  if (!exists) return false;
  db.aiChats = db.aiChats.filter((chat) => chat.id !== chatId);
  await writeDb(db);
  return true;
}

export async function getAIChatContext(input: {
  projectId: string;
  moduleId: string;
  requirementId: string;
  historyVersionId?: string;
  chatId?: string;
}) {
  const db = await readDb();
  const project = db.projects.find((item) => item.id === input.projectId);
  const moduleItem = db.modules.find((item) => item.id === input.moduleId);
  const requirement = db.requirements.find((item) => item.id === input.requirementId);
  const selectedHistory = input.historyVersionId
    ? db.histories.find((item) => item.id === input.historyVersionId)
    : db.histories
        .filter((item) => item.requirementId === input.requirementId)
        .sort((a, b) => b.version - a.version)[0];
  const chat = input.chatId ? db.aiChats.find((item) => item.id === input.chatId) : undefined;

  if (!project || !moduleItem || !requirement) return null;

  return {
    project,
    module: moduleItem,
    requirement,
    history: selectedHistory ? enrichHistory(db, selectedHistory) : undefined,
    previousMessages: chat?.messages ?? [],
  };
}

export async function appendAIChatMessages(input: {
  chatId?: string;
  projectId: string;
  moduleId: string;
  requirementId: string;
  historyVersionId?: string;
  userMessage: string;
  aiResponse: string;
}) {
  const db = await readDb();
  const timestamp = now();
  let chat = input.chatId ? db.aiChats.find((item) => item.id === input.chatId) : undefined;

  if (!chat) {
    const requirement = db.requirements.find((item) => item.id === input.requirementId);
    chat = {
      id: createId("chat"),
      userId: defaultUserId,
      projectId: input.projectId,
      moduleId: input.moduleId,
      requirementId: input.requirementId,
      historyVersionId: input.historyVersionId,
      title: requirement?.title ?? input.userMessage.slice(0, 80),
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.aiChats.push(chat);
  }

  chat.historyVersionId = input.historyVersionId ?? chat.historyVersionId;
  chat.messages.push({ role: "user", content: input.userMessage, createdAt: timestamp });
  chat.messages.push({ role: "assistant", content: input.aiResponse, createdAt: now() });
  chat.updatedAt = now();

  await writeDb(db);
  return chat;
}

export async function saveChatResponseAsNewVersion(input: { chatId: string; historyVersionId?: string }) {
  const db = await readDb();
  const chat = db.aiChats.find((item) => item.id === input.chatId);
  if (!chat) return null;

  const latestAssistantMessage = [...chat.messages].reverse().find((message) => message.role === "assistant");
  if (!latestAssistantMessage) return null;

  const sourceHistory = input.historyVersionId
    ? db.histories.find((item) => item.id === input.historyVersionId)
    : db.histories
        .filter((history) => history.requirementId === chat.requirementId)
        .sort((a, b) => b.version - a.version)[0];
  if (!sourceHistory) return null;

  const timestamp = now();
  const previousVersions = db.histories.filter((history) => history.requirementId === chat.requirementId);
  const output = {
    ...sourceHistory.output,
    summary: `AI chat improvement saved from conversation: ${chat.title}`,
    acceptanceCriteria: [
      ...sourceHistory.output.acceptanceCriteria,
      `AI chat notes: ${latestAssistantMessage.content.slice(0, 500)}`,
    ],
  };

  const history: TestCaseGenerationHistory = {
    id: createId("history"),
    userId: defaultUserId,
    projectId: chat.projectId,
    moduleId: chat.moduleId,
    requirementId: chat.requirementId,
    version: previousVersions.length + 1,
    requirementInput: sourceHistory.requirementInput,
    generatedAt: timestamp,
    generatedBy: "AI Chat",
    aiModelUsed: sourceHistory.aiModelUsed,
    testType: sourceHistory.testType,
    coverageScore: sourceHistory.coverageScore,
    status: "Draft",
    updatedAt: timestamp,
    output,
  };

  db.histories.push(history);
  await writeDb(db);
  return enrichHistory(db, history);
}
