import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { MongoClient, type Collection } from "mongodb";

import type { TestFocus, TestPlan } from "./types.js";
import type {
  AIChat,
  AIChatSummary,
  AIProviderConfig,
  AIProviderFeatureMapping,
  AIProviderFeatureName,
  AIProviderType,
  AIProviderUsageLog,
  AIProviderUsageStatus,
  ActivityLog,
  ApplicationRepositoryConfig,
  ApplicationRepositoryStatus,
  ApplicationRepositoryType,
  AutomationRepositoryConfig,
  BillingCycle,
  DashboardStats,
  EntityStatus,
  ExportFormat,
  ExportHistory,
  ExportType,
  HistoryStatus,
  InviteStatus,
  MemberStatus,
  ModulePriority,
  Plan,
  PlanId,
  PlaywrightValidationJob,
  ProjectPermissionLevel,
  RepositoryAnalysis,
  RepositoryActivity,
  RepositoryActivityStatus,
  RepositoryImpactAnalysis,
  RepositoryImpactAnalysisStatus,
  RepositoryGeneratedTestUpdate,
  RepositoryGeneratedTestUpdateStatus,
  RepositoryUpdatePullRequest,
  RepositoryValidationRun,
  RepositoryValidationRecommendation,
  RepositoryAISuggestion,
  RepositoryChangedFile,
  RepositoryGeneratedUpdate,
  RepositoryImpactedTest,
  RepositoryPrPreview,
  RepositoryRiskLevel,
  RepositorySync,
  Project,
  ProjectDatabase,
  ProjectDomain,
  ProjectModule,
  ProjectSummary,
  Requirement,
  ReviewAction,
  ReviewComment,
  Subscription,
  TestExecution,
  TestExecutionHistory,
  TestExecutionStatus,
  TestCaseGenerationHistory,
  TestCaseHistoryCompare,
  TestCaseHistoryRecord,
  TestRun,
  TestRunEnvironment,
  TestRunStatus,
  Trial,
  UserRole,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspacePermission,
  WorkspaceRole,
} from "./projectTypes.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(currentDir, "../data");
const dbFile = path.join(dataDir, "db.json");
const mongoDocumentId = "ai-qa-copilot-poc";
const mongoCollectionName = "project_database";
const defaultUserId = "default-user";
const defaultWorkspaceId = "workspace_default";
const defaultUserEmail = "admin@aiqacopilot.local";
const defaultPasswordHash =
  "scrypt:demo-aiqa-salt-2026:5db2a0d89de2b4fc506a01ca83b2b01c92a884833ff230d54f8fcb6341b0584a1aa705d10c1e90bf6ff968174cf3ae9c956c75c786a1ed6c08b81dadadfb1856";
const scrypt = promisify(scryptCallback);
const trialDurationDays = 14;
const aiProviderFeatures: AIProviderFeatureName[] = [
  "test-generation",
  "ai-chat",
  "playwright-generation",
  "requirement-impact",
  "coverage-score",
  "repository-impact",
  "repository-test-update",
  "playwright-validation-failure",
  "ai-validation-recommendation",
  "repository-fix-suggestion",
];
const planCatalog: Plan[] = [
  {
    id: "free",
    name: "Free",
    description: "Start testing AI QA workflows with a small team.",
    monthlyPrice: 0,
    yearlyPrice: 0,
    trialDays: 14,
    features: ["1 Workspace", "2 Team Members", "2 Projects", "PDF Export", "14-Day Trial"],
    limits: {
      workspaces: 1,
      teamMembers: 2,
      projects: 2,
      requirementsPerMonth: 20,
      aiGenerationsPerMonth: 50,
      aiChatMessagesPerMonth: 50,
      exportsPerMonth: 25,
      storageMb: 100,
      exports: "PDF only",
      analytics: false,
      reviewWorkflow: false,
      jiraIntegration: false,
      prioritySupport: false,
      customLimits: false,
    },
  },
  {
    id: "pro",
    name: "Pro",
    description: "Scale AI test design and governed QA workflows.",
    monthlyPrice: 49,
    yearlyPrice: 470,
    recommended: true,
    features: ["10 Team Members", "Unlimited Projects", "1000 AI Generations", "Excel + PDF Export", "Analytics Dashboard", "Review Workflow"],
    limits: {
      workspaces: 1,
      teamMembers: 10,
      projects: "unlimited",
      requirementsPerMonth: "unlimited",
      aiGenerationsPerMonth: 1000,
      aiChatMessagesPerMonth: 2000,
      exportsPerMonth: 500,
      storageMb: 5120,
      exports: "Excel + PDF",
      analytics: true,
      reviewWorkflow: true,
      jiraIntegration: false,
      prioritySupport: false,
      customLimits: false,
    },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "Custom limits, advanced analytics, integrations, and support.",
    monthlyPrice: null,
    yearlyPrice: null,
    features: ["Unlimited Workspaces", "Unlimited Team Members", "Unlimited AI Usage", "Jira Integration", "Advanced Analytics", "Priority Support", "Custom Limits"],
    limits: {
      workspaces: "unlimited",
      teamMembers: "unlimited",
      projects: "unlimited",
      requirementsPerMonth: "unlimited",
      aiGenerationsPerMonth: "unlimited",
      aiChatMessagesPerMonth: "unlimited",
      exportsPerMonth: "unlimited",
      storageMb: "unlimited",
      exports: "Excel + PDF",
      analytics: true,
      reviewWorkflow: true,
      jiraIntegration: true,
      prioritySupport: true,
      customLimits: true,
    },
  },
];
const initialDb: ProjectDatabase = {
  plans: planCatalog,
  subscriptions: [
    {
      id: "subscription_default",
      workspaceId: defaultWorkspaceId,
      planId: "pro",
      billingCycle: "monthly",
      status: "Trialing",
      trialStartsAt: new Date().toISOString(),
      trialEndsAt: new Date(Date.now() + trialDurationDays * 86_400_000).toISOString(),
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  trials: [
    {
      id: "trial_default",
      workspaceId: defaultWorkspaceId,
      userId: defaultUserId,
      subscriptionId: "subscription_default",
      planId: "pro",
      status: "Active",
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + trialDurationDays * 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  workspaces: [
    {
      id: defaultWorkspaceId,
      workspaceName: "AI QA Copilot Workspace",
      description: "Default workspace for fresh demo setup.",
      ownerId: defaultUserId,
      status: "Active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  workspaceMembers: [
    {
      id: "member_default",
      workspaceId: defaultWorkspaceId,
      userId: defaultUserId,
      name: "Demo Admin",
      email: defaultUserEmail,
      role: "Owner",
      status: "Active",
      assignedProjects: [],
      joinedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    },
  ],
  workspaceInvites: [],
  workspacePermissions: [],
  activityLogs: [],
  users: [
    {
      id: defaultUserId,
      fullName: "Demo Admin",
      name: "Demo Admin",
      email: defaultUserEmail,
      passwordHash: defaultPasswordHash,
      authProvider: "email",
      role: "Owner",
      status: "Active",
      emailVerified: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  projects: [],
  modules: [],
  requirements: [],
  histories: [],
  exportHistories: [],
  aiChats: [],
  aiProviderConfigs: [],
  aiProviderFeatureMappings: [],
  aiProviderUsageLogs: [],
  automationRepositoryConfigs: [],
  applicationRepositoryConfigs: [],
  repositoryActivities: [],
  repositoryImpactAnalyses: [],
  repositoryGeneratedTestUpdates: [],
  repositoryValidationRuns: [],
  repositoryValidationRecommendations: [],
  repositoryUpdatePullRequests: [],
  repositoryAnalyses: [],
  repositorySyncs: [],
  playwrightValidations: [],
  testRuns: [],
  testExecutions: [],
  testExecutionHistories: [],
  reviewComments: [],
  reviewAuditTrail: [],
};

let writeQueue = Promise.resolve();
let mongoClientPromise: Promise<MongoClient> | null = null;

interface MongoProjectDatabaseDocument {
  _id: string;
  data: ProjectDatabase;
  updatedAt: string;
}

function now() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function httpError(message: string, statusCode: number) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = statusCode;
  return error;
}

function useMongoStorage() {
  return Boolean(process.env.MONGODB_URI?.trim());
}

async function mongoCollection(): Promise<Collection<MongoProjectDatabaseDocument>> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI is not configured.");
  mongoClientPromise ??= new MongoClient(uri).connect();
  const client = await mongoClientPromise;
  const dbName = process.env.MONGODB_DB_NAME?.trim() || "ai-qa-copilot";
  return client.db(dbName).collection<MongoProjectDatabaseDocument>(mongoCollectionName);
}

async function readLocalDbForSeed(): Promise<ProjectDatabase> {
  try {
    const raw = await readFile(dbFile, "utf8");
    return JSON.parse(raw) as ProjectDatabase;
  } catch {
    return initialDb;
  }
}

async function readMongoDb(): Promise<ProjectDatabase> {
  const collection = await mongoCollection();
  const existing = await collection.findOne({ _id: mongoDocumentId });
  if (existing?.data) return existing.data;
  const seed = await readLocalDbForSeed();
  await collection.updateOne(
    { _id: mongoDocumentId },
    { $set: { data: seed, updatedAt: now() } },
    { upsert: true },
  );
  return seed;
}

async function writeMongoDb(db: ProjectDatabase) {
  const collection = await mongoCollection();
  await collection.updateOne(
    { _id: mongoDocumentId },
    { $set: { data: db, updatedAt: now() } },
    { upsert: true },
  );
}

function encryptionKey() {
  return createHash("sha256")
    .update(process.env.AI_PROVIDER_ENCRYPTION_KEY || process.env.JWT_SECRET || "dev-ai-provider-key-change-me")
    .digest();
}

function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptAIProviderSecret(value?: string) {
  if (!value) return "";
  const [version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) return "";
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export const decryptAutomationRepositoryToken = decryptAIProviderSecret;

function maskSecret(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
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
  if (useMongoStorage()) {
    await writeQueue;
    return normalizeDatabase(await readMongoDb());
  }
  await ensureDbFile();
  await writeQueue;
  const raw = await readFile(dbFile, "utf8");
  const db = JSON.parse(raw) as ProjectDatabase;
  return normalizeDatabase(db);
}

function normalizeDatabase(db: ProjectDatabase): ProjectDatabase {
  const workspaces = db.workspaces?.length ? db.workspaces : initialDb.workspaces;
  const workspaceMembers = db.workspaceMembers?.length ? db.workspaceMembers : initialDb.workspaceMembers;
  return {
    ...db,
    plans: db.plans?.length ? db.plans : planCatalog,
    subscriptions: db.subscriptions?.length ? db.subscriptions : initialDb.subscriptions,
    trials: db.trials ?? initialDb.trials,
    workspaces,
    workspaceMembers,
    workspaceInvites: db.workspaceInvites ?? [],
    workspacePermissions: db.workspacePermissions ?? [],
    activityLogs: db.activityLogs ?? [],
    exportHistories: db.exportHistories ?? [],
    aiChats: (db.aiChats ?? []).map(normalizeChat),
    aiProviderConfigs: (db.aiProviderConfigs ?? []).map(normalizeAIProviderConfig),
    aiProviderFeatureMappings: db.aiProviderFeatureMappings ?? [],
    aiProviderUsageLogs: db.aiProviderUsageLogs ?? [],
    automationRepositoryConfigs: (db.automationRepositoryConfigs ?? []).map(normalizeAutomationRepositoryConfig),
    applicationRepositoryConfigs: (db.applicationRepositoryConfigs ?? []).map(normalizeApplicationRepositoryConfig),
    repositoryActivities: (db.repositoryActivities ?? []).map(normalizeRepositoryActivity),
    repositoryImpactAnalyses: (db.repositoryImpactAnalyses ?? []).map(normalizeRepositoryImpactAnalysis),
    repositoryGeneratedTestUpdates: (db.repositoryGeneratedTestUpdates ?? []).map(normalizeRepositoryGeneratedTestUpdate),
    repositoryValidationRuns: (db.repositoryValidationRuns ?? []).map(normalizeRepositoryValidationRun),
    repositoryValidationRecommendations: (db.repositoryValidationRecommendations ?? []).map(normalizeRepositoryValidationRecommendation),
    repositoryUpdatePullRequests: db.repositoryUpdatePullRequests ?? [],
    repositoryAnalyses: (db.repositoryAnalyses ?? []).map(normalizeRepositoryAnalysis),
    repositorySyncs: (db.repositorySyncs ?? []).map(normalizeRepositorySync),
    playwrightValidations: (db.playwrightValidations ?? []).map(normalizePlaywrightValidation),
    testRuns: db.testRuns ?? [],
    testExecutions: (db.testExecutions ?? []).map(normalizeTestExecution),
    testExecutionHistories: db.testExecutionHistories ?? [],
    reviewComments: db.reviewComments ?? [],
    reviewAuditTrail: db.reviewAuditTrail ?? [],
    users: (db.users ?? initialDb.users).map(normalizeUser),
    projects: (db.projects ?? []).map(normalizeProject),
    modules: (db.modules ?? []).map(normalizeModule),
    requirements: (db.requirements ?? []).map(normalizeRequirement),
    histories: (db.histories ?? []).map(normalizeHistory),
  };
}

async function writeDb(db: ProjectDatabase) {
  writeQueue = writeQueue.then(() =>
    useMongoStorage()
      ? writeMongoDb(db)
      : writeFile(dbFile, JSON.stringify(db, null, 2)),
  );
  await writeQueue;
}

function countPlanTestCases(plan: TestPlan) {
  return plan.positive.length + plan.negative.length + plan.edge.length;
}

function normalizeHistory(history: TestCaseGenerationHistory): TestCaseGenerationHistory {
  const status = history.reviewStatus ?? history.status ?? "Draft";
  return {
    ...history,
    userId: history.userId ?? defaultUserId,
    workspaceId: history.workspaceId ?? defaultWorkspaceId,
    requirementInput: history.requirementInput ?? history.output.summary,
    status,
    reviewStatus: status,
    isLocked: history.isLocked ?? (status === "Approved" || status === "Rejected"),
    updatedAt: history.updatedAt ?? history.generatedAt,
  };
}

function normalizeProject(project: Project): Project {
  return { ...project, workspaceId: project.workspaceId ?? defaultWorkspaceId };
}

function normalizeModule(moduleItem: ProjectModule): ProjectModule {
  return { ...moduleItem, workspaceId: moduleItem.workspaceId ?? defaultWorkspaceId };
}

function normalizeRequirement(requirement: Requirement): Requirement {
  return { ...requirement, workspaceId: requirement.workspaceId ?? defaultWorkspaceId };
}

function normalizeChat(chat: AIChat): AIChat {
  return { ...chat, workspaceId: chat.workspaceId ?? defaultWorkspaceId };
}

function normalizeAIProviderConfig(config: AIProviderConfig): AIProviderConfig {
  const timestamp = config.createdAt ?? now();
  return {
    ...config,
    workspaceId: config.workspaceId ?? defaultWorkspaceId,
    temperature: config.temperature ?? 0.2,
    maxTokens: config.maxTokens ?? 4000,
    isDefault: config.isDefault ?? false,
    isActive: config.isActive ?? true,
    fallbackToDefault: config.fallbackToDefault ?? true,
    createdAt: timestamp,
    updatedAt: config.updatedAt ?? timestamp,
  };
}

function normalizeAutomationRepositoryConfig(config: AutomationRepositoryConfig): AutomationRepositoryConfig {
  const timestamp = config.createdAt ?? now();
  return {
    ...config,
    workspaceId: config.workspaceId ?? defaultWorkspaceId,
    provider: "github",
    defaultBranch: config.defaultBranch ?? "main",
    testFolderPath: (config.testFolderPath ?? "tests/e2e").replace(/^\/+|\/+$/g, ""),
    createdAt: timestamp,
    updatedAt: config.updatedAt ?? timestamp,
  };
}

function normalizeApplicationRepositoryConfig(config: ApplicationRepositoryConfig): ApplicationRepositoryConfig {
  const timestamp = config.createdAt ?? now();
  return {
    ...config,
    provider: "github",
    repositoryType: config.repositoryType ?? "frontend",
    defaultBranch: config.defaultBranch ?? "main",
    webhookUrl: config.webhookUrl ?? "",
    webhookStatus: config.webhookStatus ?? "Pending",
    createdAt: timestamp,
    updatedAt: config.updatedAt ?? timestamp,
  };
}

function normalizeRepositoryActivity(activity: RepositoryActivity): RepositoryActivity {
  return {
    ...activity,
    provider: "github",
    repositoryType: activity.repositoryType ?? "frontend",
    changedFiles: activity.changedFiles ?? [],
    fileCount: activity.fileCount ?? activity.changedFiles?.length ?? 0,
    status: activity.status ?? "New",
    createdAt: activity.createdAt ?? now(),
  };
}

function normalizeRepositoryImpactAnalysis(analysis: RepositoryImpactAnalysis): RepositoryImpactAnalysis {
  const timestamp = analysis.createdAt ?? now();
  return {
    ...analysis,
    provider: "github",
    changedFiles: analysis.changedFiles ?? [],
    impactedModules: analysis.impactedModules ?? [],
    impactedTests: analysis.impactedTests ?? [],
    suggestions: analysis.suggestions ?? [],
    riskLevel: analysis.riskLevel ?? "Low",
    confidenceScore: analysis.confidenceScore ?? 0,
    recommendation: analysis.recommendation ?? "Review changed files before release.",
    status: analysis.status ?? "Completed",
    createdAt: timestamp,
    updatedAt: analysis.updatedAt ?? timestamp,
  };
}

function normalizeRepositoryGeneratedTestUpdate(update: RepositoryGeneratedTestUpdate): RepositoryGeneratedTestUpdate {
  const timestamp = update.createdAt ?? now();
  return {
    ...update,
    oldCode: update.oldCode ?? "",
    newCode: update.newCode ?? "",
    status: update.status ?? "Pending",
    aiProvider: update.aiProvider ?? "AI QA Copilot Default AI",
    aiModel: update.aiModel ?? process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    createdAt: timestamp,
    updatedAt: update.updatedAt ?? timestamp,
  };
}

function normalizeRepositoryValidationRun(run: RepositoryValidationRun): RepositoryValidationRun {
  const timestamp = run.createdAt ?? now();
  return {
    ...run,
    totalTests: run.totalTests ?? 0,
    passed: run.passed ?? 0,
    failed: run.failed ?? 0,
    skipped: run.skipped ?? 0,
    duration: run.duration ?? 0,
    browser: run.browser ?? "chromium",
    environment: run.environment ?? "temporary-workspace",
    logs: run.logs ?? "",
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    failedTestNames: run.failedTestNames ?? [],
    failedTests: run.failedTests ?? [],
    screenshots: run.screenshots ?? [],
    videos: run.videos ?? [],
    traceFiles: run.traceFiles ?? [],
    createdAt: timestamp,
  };
}

function normalizeRepositoryValidationRecommendation(recommendation: RepositoryValidationRecommendation): RepositoryValidationRecommendation {
  const timestamp = recommendation.createdAt ?? now();
  return {
    ...recommendation,
    confidenceScore: recommendation.confidenceScore ?? 0,
    releaseRecommendation: recommendation.releaseRecommendation ?? "Merge with Caution",
    riskLevel: recommendation.riskLevel ?? "Medium",
    summary: recommendation.summary ?? "",
    reasons: recommendation.reasons ?? [],
    recommendedActions: recommendation.recommendedActions ?? [],
    mergeDecision: recommendation.mergeDecision ?? "Warning",
    qaOwnerAction: recommendation.qaOwnerAction ?? "Review validation result before creating a pull request.",
    aiProvider: recommendation.aiProvider ?? "AI QA Copilot Default AI",
    aiModel: recommendation.aiModel ?? process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    status: recommendation.status ?? "Generated",
    createdAt: timestamp,
    updatedAt: recommendation.updatedAt ?? timestamp,
  };
}

function normalizeRepositoryAnalysis(analysis: RepositoryAnalysis): RepositoryAnalysis {
  const timestamp = analysis.createdAt ?? now();
  return {
    ...analysis,
    provider: "github",
    framework: analysis.framework ?? "Unknown",
    language: analysis.language ?? "Unknown",
    buildTool: analysis.buildTool ?? "Unknown",
    testFolderPath: analysis.testFolderPath ?? "tests/e2e",
    usesPageObjectModel: analysis.usesPageObjectModel ?? false,
    usesFixtures: analysis.usesFixtures ?? false,
    namingConvention: analysis.namingConvention ?? "*.spec.ts",
    importStyle: analysis.importStyle ?? "@playwright/test",
    pattern: analysis.pattern ?? "Direct Playwright",
    confidenceScore: analysis.confidenceScore ?? 0,
    scannedFiles: analysis.scannedFiles ?? [],
    createdAt: timestamp,
    updatedAt: analysis.updatedAt ?? timestamp,
  };
}

function normalizeRepositorySync(sync: RepositorySync): RepositorySync {
  const timestamp = sync.createdAt ?? now();
  return {
    ...sync,
    provider: "github",
    changedFiles: sync.changedFiles ?? [],
    impactedTests: sync.impactedTests ?? [],
    aiSuggestions: sync.aiSuggestions ?? [],
    generatedUpdates: sync.generatedUpdates ?? [],
    updatedFiles: sync.updatedFiles ?? [],
    riskLevel: sync.riskLevel ?? "Low",
    status: sync.status ?? "Completed",
    prStatus: sync.prStatus ?? (sync.prUrl ? "Created" : sync.prPreview ? "Preview Ready" : "Not Created"),
    createdAt: timestamp,
    updatedAt: sync.updatedAt ?? timestamp,
  };
}

function normalizePlaywrightValidation(job: PlaywrightValidationJob): PlaywrightValidationJob {
  const timestamp = job.createdAt ?? now();
  return {
    ...job,
    fileName: job.fileName ?? "playwright.spec.ts",
    playwrightCode: job.playwrightCode ?? "",
    status: job.status ?? "Queued",
    createdAt: timestamp,
    updatedAt: job.updatedAt ?? timestamp,
  };
}

function normalizeTestExecution(execution: TestExecution): TestExecution {
  const timestamp = execution.createdAt ?? now();
  return {
    ...execution,
    actualResult: execution.actualResult ?? "",
    comments: execution.comments ?? "",
    screenshotUrl: execution.screenshotUrl ?? "",
    videoUrl: execution.videoUrl ?? "",
    logUrl: execution.logUrl ?? "",
    bugId: execution.bugId ?? "",
    jiraBugId: execution.jiraBugId ?? execution.bugId ?? "",
    jiraBugUrl: execution.jiraBugUrl ?? "",
    executionTime: execution.executionTime ?? 0,
    buildNumber: execution.buildNumber ?? "",
    createdAt: timestamp,
    updatedAt: execution.updatedAt ?? timestamp,
  };
}

function sanitizeAIProvider(config: AIProviderConfig) {
  const { apiKeyEncrypted: _apiKeyEncrypted, ...safe } = config;
  return safe;
}

function sanitizeAutomationRepositoryConfig(config: AutomationRepositoryConfig) {
  const { tokenEncrypted: _tokenEncrypted, ...safe } = config;
  return safe;
}

function sanitizeApplicationRepositoryConfig(config: ApplicationRepositoryConfig) {
  const {
    tokenEncrypted: _tokenEncrypted,
    webhookSecretEncrypted: _webhookSecretEncrypted,
    ...safe
  } = config;
  return safe;
}

function defaultAIProvider(workspaceId = defaultWorkspaceId) {
  return {
    id: "default-ai-provider",
    workspaceId,
    providerType: "default" as AIProviderType,
    providerName: "AI QA Copilot Default AI",
    modelName: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    apiKeyMasked: "",
    temperature: 0.2,
    maxTokens: 4000,
    isDefault: true,
    isActive: true,
    fallbackToDefault: true,
    createdBy: "AI QA Copilot",
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeUser(user: ProjectDatabase["users"][number]): ProjectDatabase["users"][number] {
  const timestamp = user.createdAt ?? now();
  return {
    ...user,
    fullName: user.fullName ?? user.name ?? "Current User",
    name: user.name ?? user.fullName ?? "Current User",
    passwordHash: user.passwordHash,
    authProvider: "email",
    role: user.role ?? "Owner",
    status: user.status ?? "Active",
    emailVerified: user.emailVerified ?? true,
    createdAt: timestamp,
    updatedAt: user.updatedAt ?? timestamp,
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

function executionCounts(executions: TestExecution[]) {
  const counts: Record<TestExecutionStatus, number> = {
    "Not Executed": 0,
    Passed: 0,
    Failed: 0,
    Blocked: 0,
    Skipped: 0,
  };
  executions.forEach((execution) => {
    counts[execution.status] += 1;
  });
  const total = executions.length;
  const completed = total - counts["Not Executed"];
  return {
    total,
    passed: counts.Passed,
    failed: counts.Failed,
    blocked: counts.Blocked,
    skipped: counts.Skipped,
    notExecuted: counts["Not Executed"],
    passRate: total ? Math.round((counts.Passed / total) * 100) : 0,
    progress: total ? Math.round((completed / total) * 100) : 0,
  };
}

function testRunStatusFromExecutions(executions: TestExecution[]): TestRunStatus {
  const counts = executionCounts(executions);
  if (!counts.total || counts.notExecuted === counts.total) return "Not Started";
  if (counts.notExecuted === 0) return "Completed";
  return "In Progress";
}

function summarizeTestRun(db: ProjectDatabase, run: TestRun) {
  const executions = db.testExecutions.filter((execution) => execution.testRunId === run.id);
  const counts = executionCounts(executions);
  const project = db.projects.find((item) => item.id === run.projectId);
  const moduleItem = db.modules.find((item) => item.id === run.moduleId);
  const requirement = run.requirementId
    ? db.requirements.find((item) => item.id === run.requirementId)
    : undefined;
  return {
    ...run,
    projectName: project?.name ?? "Unknown project",
    moduleName: moduleItem?.name ?? "Unknown module",
    requirementTitle: requirement?.title,
    totalTestCases: counts.total,
    passed: counts.passed,
    failed: counts.failed,
    blocked: counts.blocked,
    skipped: counts.skipped,
    notExecuted: counts.notExecuted,
    passRate: counts.passRate,
    progress: counts.progress,
  };
}

function approvedHistoriesForRun(
  db: ProjectDatabase,
  input: { projectId: string; moduleId: string; requirementId?: string; historyIds?: string[] },
) {
  const selected = input.historyIds?.length
    ? db.histories.filter((history) => input.historyIds?.includes(history.id))
    : db.histories.filter(
        (history) =>
          history.projectId === input.projectId &&
          history.moduleId === input.moduleId &&
          (!input.requirementId || history.requirementId === input.requirementId),
      );
  return selected.filter((history) => history.reviewStatus === "Approved");
}

function executionRowsFromHistory(history: TestCaseGenerationHistory, timestamp: string) {
  const rows: TestExecution[] = [];
  const groups = [
    { category: "Positive" as const, cases: history.output.positive },
    { category: "Negative" as const, cases: history.output.negative },
    { category: "Edge" as const, cases: history.output.edge },
  ];
  groups.forEach(({ category, cases }) => {
    cases.forEach((testCase) => {
      rows.push({
        id: createId("execution"),
        testRunId: "",
        testCaseId: `${history.id}:${testCase.id}`,
        sourceHistoryId: history.id,
        sourceCategory: category,
        title: testCase.title,
        description: testCase.steps.join("\n"),
        expectedResult: testCase.expected,
        priority: testCase.priority,
        status: "Not Executed",
        actualResult: "",
        comments: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
  });
  return rows;
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function currentUser(role: UserRole = "Admin") {
  return {
    userId: defaultUserId,
    userName: "Current User",
    role,
  };
}

function addActivityLog(
  db: ProjectDatabase,
  input: {
    workspaceId?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    actorId?: string;
    actorName?: string;
    oldValue?: unknown;
    newValue?: unknown;
  },
) {
  const user = currentUser("Admin");
  const log: ActivityLog = {
    id: createId("activity"),
    workspaceId: input.workspaceId ?? defaultWorkspaceId,
    actorId: input.actorId ?? user.userId,
    actorName: input.actorName ?? user.userName,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    oldValue: input.oldValue,
    newValue: input.newValue,
    createdAt: now(),
  };
  db.activityLogs.push(log);
  return log;
}

function addReviewAudit(
  db: ProjectDatabase,
  input: {
    historyId: string;
    action: ReviewAction;
    oldStatus?: HistoryStatus;
    newStatus?: HistoryStatus;
    comment?: string;
    role?: UserRole;
  },
) {
  const user = currentUser(input.role);
  db.reviewAuditTrail.push({
    id: createId("audit"),
    historyId: input.historyId,
    action: input.action,
    userId: user.userId,
    userName: user.userName,
    role: user.role,
    oldStatus: input.oldStatus,
    newStatus: input.newStatus,
    timestamp: now(),
    comment: input.comment,
  });
}

function addReviewComment(
  db: ProjectDatabase,
  input: {
    historyId: string;
    actionType: ReviewAction;
    message: string;
    role?: UserRole;
  },
) {
  const user = currentUser(input.role);
  const comment: ReviewComment = {
    id: createId("comment"),
    historyId: input.historyId,
    userId: user.userId,
    userName: user.userName,
    role: user.role,
    message: input.message,
    actionType: input.actionType,
    createdAt: now(),
  };
  db.reviewComments.push(comment);
  return comment;
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
  const approvedWithDurations = db.histories
    .filter((history) => history.reviewStatus === "Approved" && history.submittedAt && history.approvedAt)
    .map((history) => new Date(history.approvedAt!).getTime() - new Date(history.submittedAt!).getTime());

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
    pendingReviews: db.histories.filter((history) => history.reviewStatus === "Submitted for Review").length,
    approvedTestCases: db.histories.filter((history) => history.reviewStatus === "Approved").length,
    changesRequested: db.histories.filter((history) => history.reviewStatus === "Changes Requested").length,
    rejectedItems: db.histories.filter((history) => history.reviewStatus === "Rejected").length,
    averageApprovalTimeHours:
      approvedWithDurations.length === 0
        ? 0
        : Math.round(
            approvedWithDurations.reduce((total, duration) => total + duration, 0) /
              approvedWithDurations.length /
              36_000,
          ) / 100,
    recentlyUpdatedProjects: projectSummaries
      .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))
      .slice(0, 5),
  };
}

export interface AnalyticsFilters {
  workspaceId?: string;
  projectId?: string;
  moduleId?: string;
  userId?: string;
  status?: HistoryStatus;
  dateFrom?: string;
  dateTo?: string;
}

function dateKey(value: string) {
  return value.slice(0, 10);
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function increment(map: Map<string, number>, key: string, value = 1) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function toSeries<TKey extends string>(map: Map<string, number>, valueKey: TKey) {
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({ name, [valueKey]: value }) as { name: string } & Record<TKey, number>);
}

function matchesAnalyticsFilters(history: TestCaseGenerationHistory, filters: AnalyticsFilters) {
  return (
    (!filters.workspaceId || history.workspaceId === filters.workspaceId) &&
    (!filters.projectId || history.projectId === filters.projectId) &&
    (!filters.moduleId || history.moduleId === filters.moduleId) &&
    (!filters.userId || history.userId === filters.userId || history.generatedBy === filters.userId) &&
    (!filters.status || history.reviewStatus === filters.status || history.status === filters.status) &&
    (!filters.dateFrom || history.generatedAt >= filters.dateFrom) &&
    (!filters.dateTo || history.generatedAt <= filters.dateTo)
  );
}

function analyticsData(db: ProjectDatabase, filters: AnalyticsFilters) {
  const histories = db.histories.filter((history) => matchesAnalyticsFilters(history, filters));
  const projectIds = new Set(histories.map((history) => history.projectId));
  if (filters.projectId) projectIds.add(filters.projectId);
  const moduleIds = new Set(histories.map((history) => history.moduleId));
  if (filters.moduleId) moduleIds.add(filters.moduleId);
  const workspaceId = filters.workspaceId;
  const projects = db.projects.filter(
    (project) =>
      (!workspaceId || project.workspaceId === workspaceId) &&
      (!filters.projectId || project.id === filters.projectId) &&
      (projectIds.size === 0 || projectIds.has(project.id) || !filters.dateFrom),
  );
  const modules = db.modules.filter(
    (moduleItem) =>
      (!workspaceId || moduleItem.workspaceId === workspaceId) &&
      (!filters.projectId || moduleItem.projectId === filters.projectId) &&
      (!filters.moduleId || moduleItem.id === filters.moduleId),
  );
  const requirements = db.requirements.filter(
    (requirement) =>
      (!workspaceId || requirement.workspaceId === workspaceId) &&
      (!filters.projectId || requirement.projectId === filters.projectId) &&
      (!filters.moduleId || requirement.moduleId === filters.moduleId),
  );
  const exports = db.exportHistories.filter(
    (exportRecord) =>
      (!workspaceId || exportRecord.workspaceId === workspaceId) &&
      (!filters.projectId || exportRecord.projectId === filters.projectId) &&
      (!filters.userId || exportRecord.userId === filters.userId) &&
      (!filters.dateFrom || exportRecord.createdAt >= filters.dateFrom) &&
      (!filters.dateTo || exportRecord.createdAt <= filters.dateTo),
  );
  const aiChats = db.aiChats.filter(
    (chat) =>
      (!workspaceId || chat.workspaceId === workspaceId) &&
      (!filters.projectId || chat.projectId === filters.projectId) &&
      (!filters.moduleId || chat.moduleId === filters.moduleId) &&
      (!filters.userId || chat.userId === filters.userId) &&
      (!filters.dateFrom || chat.createdAt >= filters.dateFrom) &&
      (!filters.dateTo || chat.createdAt <= filters.dateTo),
  );
  return { histories, projects, modules, requirements, exports, aiChats };
}

export async function getAnalyticsSummary(filters: AnalyticsFilters) {
  const db = await readDb();
  const { histories, projects, modules, requirements, exports, aiChats } = analyticsData(db, filters);
  const scores = histories.map((history) => history.coverageScore);
  return {
    totalProjects: projects.length,
    totalModules: modules.length,
    totalRequirements: requirements.length,
    totalTestCasesGenerated: histories.reduce((total, history) => total + countPlanTestCases(history.output), 0),
    averageCoverageScore: average(scores),
    approvedTestCases: histories.filter((history) => history.reviewStatus === "Approved").length,
    pendingReviews: histories.filter((history) => history.reviewStatus === "Submitted for Review").length,
    changesRequested: histories.filter((history) => history.reviewStatus === "Changes Requested").length,
    rejectedTestCases: histories.filter((history) => history.reviewStatus === "Rejected").length,
    totalExports: exports.reduce((total, exportRecord) => total + exportRecord.totalRecords, 0),
    aiChatInteractions: aiChats.reduce((total, chat) => total + chat.messages.filter((message) => message.role === "user").length, 0),
  };
}

export async function getAnalyticsCoverage(filters: AnalyticsFilters) {
  const db = await readDb();
  const { histories } = analyticsData(db, filters);
  const byProject = db.projects
    .map((project) => {
      const projectHistories = histories.filter((history) => history.projectId === project.id);
      return { projectId: project.id, projectName: project.name, averageCoverageScore: average(projectHistories.map((history) => history.coverageScore)) };
    })
    .filter((item) => item.averageCoverageScore > 0);
  const trendTotals = new Map<string, { total: number; count: number }>();
  histories.forEach((history) => {
    const key = dateKey(history.generatedAt);
    const current = trendTotals.get(key) ?? { total: 0, count: 0 };
    trendTotals.set(key, { total: current.total + history.coverageScore, count: current.count + 1 });
  });
  const trend = [...trendTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, averageCoverageScore: Math.round(value.total / value.count) }));
  const requirementRows = histories.map((history) => {
    const requirement = db.requirements.find((item) => item.id === history.requirementId);
    const project = db.projects.find((item) => item.id === history.projectId);
    const moduleItem = db.modules.find((item) => item.id === history.moduleId);
    return {
      historyId: history.id,
      requirementId: history.requirementId,
      requirementTitle: requirement?.title ?? "Untitled requirement",
      projectName: project?.name ?? "Unknown project",
      moduleName: moduleItem?.name ?? "Unknown module",
      coverageScore: history.coverageScore,
      version: history.version,
      generatedAt: history.generatedAt,
    };
  });
  return {
    byProject,
    trend,
    lowCoverageRequirements: requirementRows
      .filter((row) => row.coverageScore < 70)
      .sort((a, b) => a.coverageScore - b.coverageScore)
      .slice(0, 10),
    highCoverageRequirements: requirementRows
      .filter((row) => row.coverageScore >= 80)
      .sort((a, b) => b.coverageScore - a.coverageScore)
      .slice(0, 10),
    recommendation: "Coverage is low. Consider adding edge cases, negative cases, and security test cases.",
  };
}

export async function getAnalyticsGeneration(filters: AnalyticsFilters) {
  const db = await readDb();
  const { histories } = analyticsData(db, filters);
  const generatedByDate = new Map<string, number>();
  const byProject = new Map<string, number>();
  const byUser = new Map<string, number>();
  const byModule = new Map<string, number>();
  const distribution = { positive: 0, negative: 0, edge: 0 };
  histories.forEach((history) => {
    increment(generatedByDate, dateKey(history.generatedAt));
    increment(byProject, db.projects.find((project) => project.id === history.projectId)?.name ?? "Unknown project", countPlanTestCases(history.output));
    increment(byUser, history.generatedBy, countPlanTestCases(history.output));
    increment(byModule, db.modules.find((moduleItem) => moduleItem.id === history.moduleId)?.name ?? "Unknown module", countPlanTestCases(history.output));
    distribution.positive += history.output.positive.length;
    distribution.negative += history.output.negative.length;
    distribution.edge += history.output.edge.length;
  });
  return {
    generatedOverTime: toSeries(generatedByDate, "versions"),
    caseDistribution: [
      { name: "Positive", value: distribution.positive },
      { name: "Negative", value: distribution.negative },
      { name: "Edge", value: distribution.edge },
    ],
    generatedByProject: toSeries(byProject, "testCases"),
    generatedByUser: toSeries(byUser, "testCases"),
    mostActiveModules: toSeries(byModule, "testCases").sort((a, b) => b.testCases - a.testCases).slice(0, 10),
  };
}

export async function getAnalyticsReview(filters: AnalyticsFilters) {
  const db = await readDb();
  const { histories } = analyticsData(db, filters);
  const statuses: HistoryStatus[] = ["Draft", "Submitted for Review", "Changes Requested", "Approved", "Rejected"];
  const reviewerActivity = new Map<string, number>();
  db.reviewAuditTrail
    .filter((audit) => ["Approved", "Changes Requested", "Rejected"].includes(audit.action))
    .forEach((audit) => increment(reviewerActivity, audit.userName));
  const approvalDurations = histories
    .filter((history) => history.submittedAt && history.approvedAt)
    .map((history) => new Date(history.approvedAt!).getTime() - new Date(history.submittedAt!).getTime());
  const bottlenecks = histories
    .filter((history) => history.reviewStatus === "Submitted for Review" && history.submittedAt)
    .map((history) => ({
      historyId: history.id,
      requirementTitle: db.requirements.find((requirement) => requirement.id === history.requirementId)?.title ?? "Untitled requirement",
      projectName: db.projects.find((project) => project.id === history.projectId)?.name ?? "Unknown project",
      submittedAt: history.submittedAt!,
      waitingDays: Math.max(0, Math.round((Date.now() - new Date(history.submittedAt!).getTime()) / 86_400_000)),
    }))
    .sort((a, b) => b.waitingDays - a.waitingDays)
    .slice(0, 10);
  return {
    pendingReviewCount: histories.filter((history) => history.reviewStatus === "Submitted for Review").length,
    approvedCount: histories.filter((history) => history.reviewStatus === "Approved").length,
    rejectedCount: histories.filter((history) => history.reviewStatus === "Rejected").length,
    changesRequestedCount: histories.filter((history) => history.reviewStatus === "Changes Requested").length,
    averageApprovalTimeHours:
      approvalDurations.length === 0
        ? 0
        : Math.round(approvalDurations.reduce((total, value) => total + value, 0) / approvalDurations.length / 36_000) / 100,
    statusDistribution: statuses.map((status) => ({
      name: status,
      value: histories.filter((history) => history.reviewStatus === status).length,
    })),
    reviewBottlenecks: bottlenecks,
    reviewerActivity: toSeries(reviewerActivity, "reviewsCompleted"),
  };
}

export async function getAnalyticsProjectsHealth(filters: AnalyticsFilters) {
  const db = await readDb();
  const { projects } = analyticsData(db, filters);
  return projects.map((project) => {
    const histories = db.histories.filter((history) => history.projectId === project.id && matchesAnalyticsFilters(history, filters));
    const averageCoverageScore = average(histories.map((history) => history.coverageScore));
    const pendingReviews = histories.filter((history) => history.reviewStatus === "Submitted for Review").length;
    const rejectedItems = histories.filter((history) => history.reviewStatus === "Rejected").length;
    const status =
      averageCoverageScore < 60 || rejectedItems >= 3
        ? "Critical"
        : averageCoverageScore < 80 || pendingReviews >= 5
          ? "Needs Attention"
          : "Healthy";
    return {
      projectId: project.id,
      projectName: project.name,
      totalRequirements: db.requirements.filter((requirement) => requirement.projectId === project.id).length,
      totalGeneratedVersions: histories.length,
      averageCoverageScore,
      pendingReviews,
      approvedVersions: histories.filter((history) => history.reviewStatus === "Approved").length,
      lastActivityDate: [project.updatedAt, ...histories.map((history) => history.updatedAt)].sort().at(-1) ?? project.updatedAt,
      healthStatus: status,
    };
  });
}

export async function getAnalyticsUsersProductivity(filters: AnalyticsFilters) {
  const db = await readDb();
  const { histories, exports, aiChats } = analyticsData(db, filters);
  const members = filters.workspaceId
    ? db.workspaceMembers.filter((member) => member.workspaceId === filters.workspaceId)
    : db.workspaceMembers;
  return members.map((member) => ({
    userId: member.userId,
    userName: member.name,
    role: member.role,
    testCasesGenerated: histories
      .filter((history) => history.userId === member.userId)
      .reduce((total, history) => total + countPlanTestCases(history.output), 0),
    reviewsCompleted: db.reviewAuditTrail.filter(
      (audit) => audit.userId === member.userId && ["Approved", "Changes Requested", "Rejected"].includes(audit.action),
    ).length,
    approvedVersions: histories.filter((history) => history.approvedBy === member.userId || history.generatedBy === member.name && history.reviewStatus === "Approved").length,
    aiChatUsage: aiChats
      .filter((chat) => chat.userId === member.userId)
      .reduce((total, chat) => total + chat.messages.filter((message) => message.role === "user").length, 0),
    exports: exports.filter((exportRecord) => exportRecord.userId === member.userId).length,
    lastActiveDate: member.lastActiveAt,
  }));
}

export async function getAnalyticsAIUsage(filters: AnalyticsFilters) {
  const db = await readDb();
  const { histories, aiChats } = analyticsData(db, filters);
  const overTime = new Map<string, number>();
  const promptCounts = new Map<string, number>();
  const quickPrompts = ["Missing Test Cases", "Improve Coverage", "Security Test Cases", "API Test Cases", "Edge Cases", "Regression Test Cases"];
  aiChats.forEach((chat) => {
    chat.messages
      .filter((message) => message.role === "user")
      .forEach((message) => {
        increment(overTime, dateKey(message.createdAt));
        const prompt = quickPrompts.find((quickPrompt) => message.content.toLowerCase().includes(quickPrompt.toLowerCase()));
        if (prompt) increment(promptCounts, prompt);
      });
  });
  const savedFromChat = histories.filter((history) => history.aiModelUsed.includes("AI Chat")).length;
  const improvements = histories
    .filter((history) => history.version > 1)
    .map((history) => {
      const previous = db.histories.find(
        (item) => item.requirementId === history.requirementId && item.version === history.version - 1,
      );
      return previous ? history.coverageScore - previous.coverageScore : 0;
    })
    .filter((value) => value !== 0);
  return {
    totalAIGenerations: histories.length,
    totalAIChatMessages: aiChats.reduce((total, chat) => total + chat.messages.filter((message) => message.role === "user").length, 0),
    mostUsedQuickPrompts: toSeries(promptCounts, "count").sort((a, b) => b.count - a.count),
    averageCoverageImprovementAfterAIChat: average(improvements),
    aiGeneratedVersionsSaved: savedFromChat,
    usageOverTime: toSeries(overTime, "messages"),
  };
}

export async function getAnalyticsExports(filters: AnalyticsFilters) {
  const db = await readDb();
  const { histories, exports } = analyticsData(db, filters);
  const byProject = new Map<string, number>();
  const byUser = new Map<string, number>();
  const byRequirement = new Map<string, number>();
  exports.forEach((exportRecord) => {
    increment(byProject, db.projects.find((project) => project.id === exportRecord.projectId)?.name ?? "Project export", exportRecord.totalRecords);
    increment(byUser, db.users.find((user) => user.id === exportRecord.userId)?.name ?? "Current User", exportRecord.totalRecords);
    if (exportRecord.requirementId) {
      increment(byRequirement, db.requirements.find((requirement) => requirement.id === exportRecord.requirementId)?.title ?? "Requirement", exportRecord.totalRecords);
    }
  });
  return {
    totalExcelExports: exports.filter((exportRecord) => exportRecord.exportFormat === "excel").length,
    totalPdfExports: exports.filter((exportRecord) => exportRecord.exportFormat === "pdf").length,
    exportsByProject: toSeries(byProject, "exports"),
    exportsByUser: toSeries(byUser, "exports"),
    mostExportedRequirements: toSeries(byRequirement, "exports").sort((a, b) => b.exports - a.exports).slice(0, 10),
    approvedVsDraftExportCount: [
      { name: "Approved", value: histories.filter((history) => history.reviewStatus === "Approved").length },
      { name: "Draft", value: histories.filter((history) => history.reviewStatus === "Draft").length },
    ],
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
  workspaceId?: string;
  userId?: string;
}) {
  const db = await readDb();
  const timestamp = now();
  const workspaceId = input.workspaceId ?? primaryWorkspaceIdForUser(db, input.userId);
  const usage = workspaceUsage(db, workspaceId);
  assertLimit("Projects", usage.usage.projects.used, usage.usage.projects.limit);
  const project: Project = {
    id: createId("project"),
    workspaceId,
    userId: input.userId ?? defaultUserId,
    name: input.name,
    description: input.description,
    domain: input.domain,
    status: input.status ?? "Active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.projects.push(project);
  addActivityLog(db, {
    action: "Project created",
    resourceType: "Project",
    resourceId: project.id,
    newValue: { name: project.name },
  });
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
  const removedRunIds = db.testRuns.filter((run) => run.projectId === projectId).map((run) => run.id);
  db.testRuns = db.testRuns.filter((run) => run.projectId !== projectId);
  db.testExecutions = db.testExecutions.filter((execution) => !removedRunIds.includes(execution.testRunId));
  db.testExecutionHistories = db.testExecutionHistories.filter((history) => !removedRunIds.includes(history.testRunId));
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
  const project = db.projects.find((projectItem) => projectItem.id === input.projectId);
  if (!project) return null;
  const timestamp = now();
  const moduleItem: ProjectModule = {
    id: createId("module"),
    workspaceId: project.workspaceId,
    projectId: input.projectId,
    name: input.name,
    description: input.description,
    priority: input.priority,
    status: input.status ?? "Active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.modules.push(moduleItem);
  project.updatedAt = timestamp;
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
  const removedRunIds = db.testRuns.filter((run) => run.moduleId === moduleId).map((run) => run.id);
  db.testRuns = db.testRuns.filter((run) => run.moduleId !== moduleId);
  db.testExecutions = db.testExecutions.filter((execution) => !removedRunIds.includes(execution.testRunId));
  db.testExecutionHistories = db.testExecutionHistories.filter((history) => !removedRunIds.includes(history.testRunId));
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
  const usage = workspaceUsage(db, moduleItem.workspaceId);
  assertLimit("Requirements", usage.usage.requirements.used, usage.usage.requirements.limit);
  const timestamp = now();
  const requirement: Requirement = {
    id: createId("requirement"),
    workspaceId: moduleItem.workspaceId,
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
  const removedRunIds = db.testRuns.filter((run) => run.requirementId === requirementId).map((run) => run.id);
  db.testRuns = db.testRuns.filter((run) => run.requirementId !== requirementId);
  db.testExecutions = db.testExecutions.filter((execution) => !removedRunIds.includes(execution.testRunId));
  db.testExecutionHistories = db.testExecutionHistories.filter((history) => !removedRunIds.includes(history.testRunId));
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
  userId?: string;
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
    const usage = workspaceUsage(db, moduleItem.workspaceId);
    assertLimit("Requirements", usage.usage.requirements.used, usage.usage.requirements.limit);
    requirement = {
      id: createId("requirement"),
      workspaceId: moduleItem.workspaceId,
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
    userId: input.userId ?? defaultUserId,
    workspaceId: moduleItem.workspaceId,
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
    reviewStatus: "Draft",
    isLocked: false,
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
  const oldStatus = history.reviewStatus;
  history.status = status;
  history.reviewStatus = status;
  history.isLocked = status === "Approved" || status === "Rejected";
  history.updatedAt = now();
  addReviewAudit(db, {
    historyId,
    action: status === "Approved" ? "Approved" : status === "Rejected" ? "Rejected" : "Comment Added",
    oldStatus,
    newStatus: status,
    comment: "Status updated manually",
    role: "Admin",
  });
  await writeDb(db);
  return enrichHistory(db, history);
}

export async function deleteHistory(historyId: string) {
  const db = await readDb();
  const exists = db.histories.some((history) => history.id === historyId);
  if (!exists) return false;
  db.histories = db.histories.filter((history) => history.id !== historyId);
  const removedExecutionIds = db.testExecutions
    .filter((execution) => execution.sourceHistoryId === historyId)
    .map((execution) => execution.id);
  db.testExecutions = db.testExecutions.filter((execution) => execution.sourceHistoryId !== historyId);
  db.testExecutionHistories = db.testExecutionHistories.filter(
    (history) => !removedExecutionIds.includes(history.testExecutionId),
  );
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
  workspaceId?: string;
  userId?: string;
  projectId?: string;
  requirementId?: string;
  totalRecords: number;
}) {
  const db = await readDb();
  const exportRecord: ExportHistory = {
    id: createId("export"),
    userId: input.userId ?? defaultUserId,
    workspaceId: input.workspaceId ?? (input.projectId
      ? db.projects.find((project) => project.id === input.projectId)?.workspaceId ?? defaultWorkspaceId
      : defaultWorkspaceId),
    exportType: input.exportType,
    exportFormat: input.exportFormat,
    projectId: input.projectId,
    requirementId: input.requirementId,
    totalRecords: input.totalRecords,
    createdAt: now(),
  };
  db.exportHistories.push(exportRecord);
  addActivityLog(db, {
    workspaceId: exportRecord.workspaceId,
    action: exportRecord.exportType === "version" ? "Test case exported" : "Test cases exported",
    resourceType: "ExportHistory",
    resourceId: exportRecord.id,
    newValue: { format: exportRecord.exportFormat, totalRecords: exportRecord.totalRecords },
  });
  await writeDb(db);
  return exportRecord;
}

export async function listExportHistory() {
  const db = await readDb();
  return db.exportHistories.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getWorkspaceIdForProject(projectId?: string) {
  if (!projectId) return defaultWorkspaceId;
  const db = await readDb();
  return db.projects.find((project) => project.id === projectId)?.workspaceId ?? defaultWorkspaceId;
}

export async function listAIProviders(workspaceId = defaultWorkspaceId) {
  const db = await readDb();
  return [
    defaultAIProvider(workspaceId),
    ...db.aiProviderConfigs
      .filter((config) => config.workspaceId === workspaceId)
      .map(sanitizeAIProvider),
  ];
}

export async function getAIProvider(providerId: string) {
  const db = await readDb();
  const config = db.aiProviderConfigs.find((item) => item.id === providerId);
  return config ? sanitizeAIProvider(config) : null;
}

export async function getAIProviderRuntimeConfig(providerId: string) {
  const db = await readDb();
  const config = db.aiProviderConfigs.find((item) => item.id === providerId);
  return config
    ? {
        ...config,
        apiKey: decryptAIProviderSecret(config.apiKeyEncrypted),
      }
    : null;
}

export async function createAIProvider(input: {
  workspaceId: string;
  providerType: AIProviderType;
  providerName: string;
  apiKey?: string;
  baseUrl?: string;
  modelName: string;
  endpointUrl?: string;
  deploymentName?: string;
  apiVersion?: string;
  requestFormat?: "OpenAI Compatible";
  temperature?: number;
  maxTokens?: number;
  isActive?: boolean;
  fallbackToDefault?: boolean;
  createdBy?: string;
}) {
  const db = await readDb();
  const timestamp = now();
  const config: AIProviderConfig = {
    id: createId("ai_provider"),
    workspaceId: input.workspaceId,
    providerType: input.providerType,
    providerName: input.providerName,
    apiKeyEncrypted: input.apiKey ? encryptSecret(input.apiKey) : undefined,
    apiKeyMasked: input.apiKey ? maskSecret(input.apiKey) : undefined,
    baseUrl: input.baseUrl,
    modelName: input.modelName,
    endpointUrl: input.endpointUrl,
    deploymentName: input.deploymentName,
    apiVersion: input.apiVersion,
    requestFormat: input.requestFormat,
    temperature: input.temperature ?? 0.2,
    maxTokens: input.maxTokens ?? 4000,
    isDefault: false,
    isActive: input.isActive ?? true,
    fallbackToDefault: input.fallbackToDefault ?? true,
    createdBy: input.createdBy ?? "Current User",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.aiProviderConfigs.push(config);
  addActivityLog(db, {
    workspaceId: input.workspaceId,
    action: "AI provider created",
    resourceType: "AIProviderConfig",
    resourceId: config.id,
    newValue: { providerType: config.providerType, providerName: config.providerName, modelName: config.modelName },
  });
  await writeDb(db);
  return sanitizeAIProvider(config);
}

export async function updateAIProvider(providerId: string, input: Partial<{
  providerType: AIProviderType;
  providerName: string;
  apiKey: string;
  baseUrl: string;
  modelName: string;
  endpointUrl: string;
  deploymentName: string;
  apiVersion: string;
  requestFormat: "OpenAI Compatible";
  temperature: number;
  maxTokens: number;
  isActive: boolean;
  fallbackToDefault: boolean;
  updatedBy: string;
}>) {
  const db = await readDb();
  const config = db.aiProviderConfigs.find((item) => item.id === providerId);
  if (!config) return null;
  if (input.providerType) config.providerType = input.providerType;
  if (input.providerName !== undefined) config.providerName = input.providerName;
  if (input.apiKey) {
    config.apiKeyEncrypted = encryptSecret(input.apiKey);
    config.apiKeyMasked = maskSecret(input.apiKey);
  }
  if (input.baseUrl !== undefined) config.baseUrl = input.baseUrl;
  if (input.modelName !== undefined) config.modelName = input.modelName;
  if (input.endpointUrl !== undefined) config.endpointUrl = input.endpointUrl;
  if (input.deploymentName !== undefined) config.deploymentName = input.deploymentName;
  if (input.apiVersion !== undefined) config.apiVersion = input.apiVersion;
  if (input.requestFormat !== undefined) config.requestFormat = input.requestFormat;
  if (input.temperature !== undefined) config.temperature = input.temperature;
  if (input.maxTokens !== undefined) config.maxTokens = input.maxTokens;
  if (input.isActive !== undefined) config.isActive = input.isActive;
  if (input.fallbackToDefault !== undefined) config.fallbackToDefault = input.fallbackToDefault;
  config.updatedBy = input.updatedBy;
  config.updatedAt = now();
  addActivityLog(db, {
    workspaceId: config.workspaceId,
    action: "AI provider updated",
    resourceType: "AIProviderConfig",
    resourceId: config.id,
    newValue: { providerType: config.providerType, providerName: config.providerName, modelName: config.modelName },
  });
  await writeDb(db);
  return sanitizeAIProvider(config);
}

export async function deleteAIProvider(providerId: string) {
  const db = await readDb();
  const config = db.aiProviderConfigs.find((item) => item.id === providerId);
  if (!config) return false;
  db.aiProviderConfigs = db.aiProviderConfigs.filter((item) => item.id !== providerId);
  db.aiProviderFeatureMappings = db.aiProviderFeatureMappings.filter((item) => item.providerId !== providerId);
  addActivityLog(db, {
    workspaceId: config.workspaceId,
    action: "AI provider deleted",
    resourceType: "AIProviderConfig",
    resourceId: config.id,
    oldValue: { providerType: config.providerType, providerName: config.providerName },
  });
  await writeDb(db);
  return true;
}

export async function setAIProviderStatus(providerId: string, isActive: boolean) {
  return updateAIProvider(providerId, { isActive });
}

export async function markAIProviderTestResult(providerId: string, status: AIProviderUsageStatus) {
  const db = await readDb();
  const config = db.aiProviderConfigs.find((item) => item.id === providerId);
  if (!config) return null;
  config.lastTestedAt = now();
  config.lastTestStatus = status;
  config.updatedAt = config.lastTestedAt;
  await writeDb(db);
  return sanitizeAIProvider(config);
}

export async function getAIProviderFeatureMappings(workspaceId = defaultWorkspaceId) {
  const db = await readDb();
  return aiProviderFeatures.map((featureName) => {
    const mapping = db.aiProviderFeatureMappings.find(
      (item) => item.workspaceId === workspaceId && item.featureName === featureName,
    );
    const provider = mapping
      ? db.aiProviderConfigs.find((config) => config.id === mapping.providerId)
      : undefined;
    return {
      id: mapping?.id ?? `${workspaceId}_${featureName}`,
      workspaceId,
      featureName,
      providerId: mapping?.providerId ?? "default-ai-provider",
      providerName: provider?.providerName ?? "AI QA Copilot Default AI",
      providerType: provider?.providerType ?? "default",
      modelName: mapping?.modelName ?? provider?.modelName ?? process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      isActive: mapping?.isActive ?? true,
      updatedAt: mapping?.updatedAt ?? now(),
    };
  });
}

export async function updateAIProviderFeatureMappings(
  workspaceId: string,
  mappings: Array<{
    featureName: AIProviderFeatureName;
    providerId: string;
    modelName?: string;
    isActive?: boolean;
  }>,
  updatedBy?: string,
) {
  const db = await readDb();
  const timestamp = now();
  mappings.forEach((input) => {
    let mapping = db.aiProviderFeatureMappings.find(
      (item) => item.workspaceId === workspaceId && item.featureName === input.featureName,
    );
    const provider = db.aiProviderConfigs.find((config) => config.id === input.providerId);
    if (input.providerId === "default-ai-provider") {
      db.aiProviderFeatureMappings = db.aiProviderFeatureMappings.filter(
        (item) => !(item.workspaceId === workspaceId && item.featureName === input.featureName),
      );
      return;
    }
    if (!provider) throw httpError("Selected AI provider was not found.", 404);
    if (!mapping) {
      mapping = {
        id: createId("ai_provider_mapping"),
        workspaceId,
        featureName: input.featureName,
        providerId: input.providerId,
        modelName: input.modelName || provider.modelName,
        isActive: input.isActive ?? true,
        updatedAt: timestamp,
        updatedBy,
      };
      db.aiProviderFeatureMappings.push(mapping);
    } else {
      mapping.providerId = input.providerId;
      mapping.modelName = input.modelName || provider.modelName;
      mapping.isActive = input.isActive ?? true;
      mapping.updatedAt = timestamp;
      mapping.updatedBy = updatedBy;
    }
  });
  addActivityLog(db, {
    workspaceId,
    action: "AI provider feature mapping updated",
    resourceType: "AIProviderFeatureMapping",
    newValue: { features: mappings.map((mapping) => mapping.featureName) },
  });
  await writeDb(db);
  return getAIProviderFeatureMappings(workspaceId);
}

export async function resolveAIProviderForFeature(workspaceId: string, featureName: AIProviderFeatureName) {
  const db = await readDb();
  const mapping = db.aiProviderFeatureMappings.find(
    (item) => item.workspaceId === workspaceId && item.featureName === featureName && item.isActive,
  );
  const mappedProvider = mapping
    ? db.aiProviderConfigs.find((config) => config.id === mapping.providerId && config.isActive)
    : undefined;
  if (mappedProvider) {
    return {
      ...mappedProvider,
      modelName: mapping?.modelName || mappedProvider.modelName,
      apiKey: decryptAIProviderSecret(mappedProvider.apiKeyEncrypted),
    };
  }
  const activeProvider = db.aiProviderConfigs.find((config) => config.workspaceId === workspaceId && config.isActive);
  if (activeProvider) {
    return {
      ...activeProvider,
      apiKey: decryptAIProviderSecret(activeProvider.apiKeyEncrypted),
    };
  }
  return null;
}

export async function createAIProviderUsageLog(input: Omit<AIProviderUsageLog, "id" | "createdAt">) {
  const db = await readDb();
  const log: AIProviderUsageLog = {
    id: createId("ai_provider_usage"),
    createdAt: now(),
    ...input,
    errorMessage: input.errorMessage?.slice(0, 400),
  };
  db.aiProviderUsageLogs.unshift(log);
  db.aiProviderUsageLogs = db.aiProviderUsageLogs.slice(0, 500);
  await writeDb(db);
  return log;
}

export async function listAIProviderUsage(workspaceId = defaultWorkspaceId) {
  const db = await readDb();
  return db.aiProviderUsageLogs
    .filter((log) => log.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getAutomationRepositoryConfig(workspaceId = defaultWorkspaceId) {
  const db = await readDb();
  const config = db.automationRepositoryConfigs.find(
    (item) => item.workspaceId === workspaceId && item.provider === "github",
  );
  return config ? sanitizeAutomationRepositoryConfig(config) : null;
}

export async function getAutomationRepositoryRuntimeConfig(workspaceId = defaultWorkspaceId) {
  const db = await readDb();
  const config = db.automationRepositoryConfigs.find(
    (item) => item.workspaceId === workspaceId && item.provider === "github",
  );
  return config
    ? {
        ...config,
        token: decryptAutomationRepositoryToken(config.tokenEncrypted),
      }
    : null;
}

export async function saveAutomationRepositoryConfig(input: {
  workspaceId: string;
  token: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  testFolderPath: string;
  userId?: string;
}) {
  const db = await readDb();
  const timestamp = now();
  const folderPath = input.testFolderPath.replace(/^\/+|\/+$/g, "") || "tests/e2e";
  let config = db.automationRepositoryConfigs.find(
    (item) => item.workspaceId === input.workspaceId && item.provider === "github",
  );
  if (!config) {
    config = {
      id: createId("automation_repo"),
      workspaceId: input.workspaceId,
      provider: "github",
      tokenEncrypted: encryptSecret(input.token),
      tokenMasked: maskSecret(input.token),
      owner: input.owner,
      repo: input.repo,
      defaultBranch: input.defaultBranch,
      testFolderPath: folderPath,
      createdBy: input.userId ?? defaultUserId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.automationRepositoryConfigs.push(config);
  } else {
    config.tokenEncrypted = encryptSecret(input.token);
    config.tokenMasked = maskSecret(input.token);
    config.owner = input.owner;
    config.repo = input.repo;
    config.defaultBranch = input.defaultBranch;
    config.testFolderPath = folderPath;
    config.updatedBy = input.userId;
    config.updatedAt = timestamp;
  }
  addActivityLog(db, {
    workspaceId: input.workspaceId,
    action: "GitHub automation repository connected",
    resourceType: "AutomationRepositoryConfig",
    resourceId: config.id,
    newValue: {
      provider: config.provider,
      owner: config.owner,
      repo: config.repo,
      defaultBranch: config.defaultBranch,
      testFolderPath: config.testFolderPath,
    },
  });
  await writeDb(db);
  return sanitizeAutomationRepositoryConfig(config);
}

export async function saveApplicationRepositoryConfig(input: {
  workspaceId: string;
  projectId?: string;
  repositoryType: ApplicationRepositoryType;
  token: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  webhookSecret: string;
  webhookUrl: string;
  webhookStatus?: ApplicationRepositoryStatus;
  webhookError?: string;
  webhookId?: number;
  userId?: string;
}) {
  const db = await readDb();
  const timestamp = now();
  let config = db.applicationRepositoryConfigs.find(
    (item) =>
      item.workspaceId === input.workspaceId &&
      item.provider === "github" &&
      item.repositoryType === input.repositoryType &&
      item.owner.toLowerCase() === input.owner.toLowerCase() &&
      item.repo.toLowerCase() === input.repo.toLowerCase(),
  );
  if (!config) {
    config = {
      id: createId("application_repo"),
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      repositoryType: input.repositoryType,
      provider: "github",
      tokenEncrypted: encryptSecret(input.token),
      tokenMasked: maskSecret(input.token),
      owner: input.owner,
      repo: input.repo,
      defaultBranch: input.defaultBranch || "main",
      webhookSecretEncrypted: encryptSecret(input.webhookSecret),
      webhookSecretMasked: maskSecret(input.webhookSecret),
      webhookUrl: input.webhookUrl,
      webhookId: input.webhookId,
      webhookStatus: input.webhookStatus ?? "Pending",
      webhookError: input.webhookError,
      createdBy: input.userId ?? defaultUserId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.applicationRepositoryConfigs.push(config);
  } else {
    config.projectId = input.projectId ?? config.projectId;
    config.tokenEncrypted = encryptSecret(input.token);
    config.tokenMasked = maskSecret(input.token);
    config.owner = input.owner;
    config.repo = input.repo;
    config.defaultBranch = input.defaultBranch || "main";
    config.webhookSecretEncrypted = encryptSecret(input.webhookSecret);
    config.webhookSecretMasked = maskSecret(input.webhookSecret);
    config.webhookUrl = input.webhookUrl;
    config.webhookId = input.webhookId;
    config.webhookStatus = input.webhookStatus ?? config.webhookStatus;
    config.webhookError = input.webhookError;
    config.updatedBy = input.userId;
    config.updatedAt = timestamp;
  }
  addActivityLog(db, {
    workspaceId: input.workspaceId,
    action: "GitHub application repository connected",
    resourceType: "ApplicationRepositoryConfig",
    resourceId: config.id,
    newValue: {
      repositoryType: config.repositoryType,
      owner: config.owner,
      repo: config.repo,
      defaultBranch: config.defaultBranch,
      webhookStatus: config.webhookStatus,
    },
  });
  await writeDb(db);
  return sanitizeApplicationRepositoryConfig(config);
}

export async function listApplicationRepositoryConfigs(workspaceId = defaultWorkspaceId) {
  const db = await readDb();
  return db.applicationRepositoryConfigs
    .filter((config) => config.workspaceId === workspaceId)
    .map(sanitizeApplicationRepositoryConfig)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getApplicationRepositoryConfig(configId: string) {
  const db = await readDb();
  const config = db.applicationRepositoryConfigs.find((item) => item.id === configId);
  return config ? sanitizeApplicationRepositoryConfig(config) : null;
}

export async function getApplicationRepositoryRuntimeConfig(configId: string) {
  const db = await readDb();
  const config = db.applicationRepositoryConfigs.find((item) => item.id === configId);
  return config
    ? {
        ...config,
        token: decryptAutomationRepositoryToken(config.tokenEncrypted),
        webhookSecret: decryptAIProviderSecret(config.webhookSecretEncrypted),
      }
    : null;
}

export async function findApplicationRepositoryRuntimeConfig(input: {
  owner: string;
  repo: string;
}) {
  const db = await readDb();
  const config = db.applicationRepositoryConfigs.find(
    (item) =>
      item.provider === "github" &&
      item.owner.toLowerCase() === input.owner.toLowerCase() &&
      item.repo.toLowerCase() === input.repo.toLowerCase(),
  );
  return config
    ? {
        ...config,
        token: decryptAutomationRepositoryToken(config.tokenEncrypted),
        webhookSecret: decryptAIProviderSecret(config.webhookSecretEncrypted),
      }
    : null;
}

export async function updateApplicationRepositoryWebhook(input: {
  configId: string;
  webhookStatus: ApplicationRepositoryStatus;
  webhookId?: number;
  webhookError?: string;
  webhookUrl?: string;
  userId?: string;
}) {
  const db = await readDb();
  const config = db.applicationRepositoryConfigs.find((item) => item.id === input.configId);
  if (!config) return null;
  config.webhookStatus = input.webhookStatus;
  config.webhookId = input.webhookId ?? config.webhookId;
  config.webhookUrl = input.webhookUrl ?? config.webhookUrl;
  config.webhookError = input.webhookError;
  config.updatedBy = input.userId;
  config.updatedAt = now();
  await writeDb(db);
  return sanitizeApplicationRepositoryConfig(config);
}

export async function deleteApplicationRepositoryConfig(configId: string) {
  const db = await readDb();
  const index = db.applicationRepositoryConfigs.findIndex((item) => item.id === configId);
  if (index === -1) return false;
  const [config] = db.applicationRepositoryConfigs.splice(index, 1);
  addActivityLog(db, {
    workspaceId: config.workspaceId,
    action: "GitHub application repository disconnected",
    resourceType: "ApplicationRepositoryConfig",
    resourceId: config.id,
    oldValue: { owner: config.owner, repo: config.repo, repositoryType: config.repositoryType },
  });
  await writeDb(db);
  return true;
}

export async function createRepositoryActivity(input: Omit<RepositoryActivity, "id" | "status" | "createdAt">) {
  const db = await readDb();
  if (input.deliveryId && db.repositoryActivities.some((activity) => activity.deliveryId === input.deliveryId)) {
    return db.repositoryActivities.find((activity) => activity.deliveryId === input.deliveryId)!;
  }
  const timestamp = now();
  const activity: RepositoryActivity = {
    ...input,
    id: createId("repository_activity"),
    status: "New",
    createdAt: timestamp,
  };
  db.repositoryActivities.unshift(activity);
  db.repositoryActivities = db.repositoryActivities.slice(0, 1000);
  const config = db.applicationRepositoryConfigs.find((item) => item.id === input.repositoryConfigId);
  if (config) {
    config.lastEventReceivedAt = timestamp;
    config.lastSyncedAt = timestamp;
    config.updatedAt = timestamp;
  }
  await writeDb(db);
  return activity;
}

export async function listRepositoryActivities(filters: {
  workspaceId?: string;
  repositoryConfigId?: string;
  status?: RepositoryActivityStatus;
} = {}) {
  const db = await readDb();
  return db.repositoryActivities
    .filter((activity) => !filters.workspaceId || activity.workspaceId === filters.workspaceId)
    .filter((activity) => !filters.repositoryConfigId || activity.repositoryConfigId === filters.repositoryConfigId)
    .filter((activity) => !filters.status || activity.status === filters.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getRepositoryActivity(activityId: string) {
  const db = await readDb();
  return db.repositoryActivities.find((activity) => activity.id === activityId) ?? null;
}

export async function updateRepositoryActivityStatus(activityId: string, status: RepositoryActivityStatus) {
  const db = await readDb();
  const activity = db.repositoryActivities.find((item) => item.id === activityId);
  if (!activity) return null;
  activity.status = status;
  await writeDb(db);
  return activity;
}

export async function getRepositoryImpactAnalysisByActivity(activityId: string) {
  const db = await readDb();
  return db.repositoryImpactAnalyses.find((analysis) => analysis.repositoryActivityId === activityId) ?? null;
}

export async function getRepositoryImpactAnalysis(impactAnalysisId: string) {
  const db = await readDb();
  return db.repositoryImpactAnalyses.find((analysis) => analysis.id === impactAnalysisId) ?? null;
}

export async function saveRepositoryImpactAnalysis(
  input: Omit<RepositoryImpactAnalysis, "id" | "createdAt" | "updatedAt">,
  options: { replaceExisting?: boolean } = {},
) {
  const db = await readDb();
  const timestamp = now();
  const existing = db.repositoryImpactAnalyses.find(
    (analysis) => analysis.repositoryActivityId === input.repositoryActivityId,
  );
  if (existing && options.replaceExisting) {
    Object.assign(existing, input, { updatedAt: timestamp });
    await writeDb(db);
    return existing;
  }
  const analysis: RepositoryImpactAnalysis = {
    ...input,
    id: createId("repository_impact"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.repositoryImpactAnalyses.unshift(analysis);
  await writeDb(db);
  return analysis;
}

export async function updateRepositoryImpactAnalysisStatus(
  impactAnalysisId: string,
  status: RepositoryImpactAnalysisStatus,
) {
  const db = await readDb();
  const analysis = db.repositoryImpactAnalyses.find((item) => item.id === impactAnalysisId);
  if (!analysis) return null;
  analysis.status = status;
  analysis.updatedAt = now();
  await writeDb(db);
  return analysis;
}

export async function saveRepositoryGeneratedTestUpdates(
  impactAnalysisId: string,
  updates: Omit<RepositoryGeneratedTestUpdate, "id" | "createdAt" | "updatedAt">[],
) {
  const db = await readDb();
  const timestamp = now();
  db.repositoryGeneratedTestUpdates = db.repositoryGeneratedTestUpdates.filter(
    (update) => update.impactAnalysisId !== impactAnalysisId,
  );
  const saved = updates.map((update) => ({
    ...update,
    id: createId("repository_test_update"),
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  db.repositoryGeneratedTestUpdates.unshift(...saved);
  await writeDb(db);
  return saved;
}

export async function listRepositoryGeneratedTestUpdates(impactAnalysisId: string) {
  const db = await readDb();
  return db.repositoryGeneratedTestUpdates
    .filter((update) => update.impactAnalysisId === impactAnalysisId)
    .sort((a, b) => a.testFilePath.localeCompare(b.testFilePath));
}

export async function getRepositoryGeneratedTestUpdate(updateId: string) {
  const db = await readDb();
  return db.repositoryGeneratedTestUpdates.find((update) => update.id === updateId) ?? null;
}

export async function updateRepositoryGeneratedTestUpdate(
  updateId: string,
  input: Partial<Pick<RepositoryGeneratedTestUpdate, "status" | "newCode" | "updateSummary" | "confidenceScore">>,
) {
  const db = await readDb();
  const update = db.repositoryGeneratedTestUpdates.find((item) => item.id === updateId);
  if (!update) return null;
  Object.assign(update, input, { updatedAt: now() });
  await writeDb(db);
  return update;
}

export async function saveRepositoryValidationRun(input: Omit<RepositoryValidationRun, "id" | "createdAt">) {
  const db = await readDb();
  const run: RepositoryValidationRun = {
    ...input,
    id: createId("repository_validation"),
    createdAt: now(),
  };
  db.repositoryValidationRuns.unshift(run);
  await writeDb(db);
  return run;
}

export async function getLatestRepositoryValidationRun(impactAnalysisId: string) {
  const db = await readDb();
  return db.repositoryValidationRuns
    .filter((run) => run.impactAnalysisId === impactAnalysisId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export async function updateRepositoryValidationRun(
  runId: string,
  input: Partial<Pick<RepositoryValidationRun, "aiFailureExplanation" | "failureExplanation" | "errorDetails">>,
) {
  const db = await readDb();
  const run = db.repositoryValidationRuns.find((item) => item.id === runId);
  if (!run) return null;
  Object.assign(run, input);
  await writeDb(db);
  return run;
}

export async function saveRepositoryValidationRecommendation(
  input: Omit<RepositoryValidationRecommendation, "id" | "createdAt" | "updatedAt">,
) {
  const db = await readDb();
  const timestamp = now();
  db.repositoryValidationRecommendations = (db.repositoryValidationRecommendations ?? []).filter(
    (recommendation) => recommendation.impactAnalysisId !== input.impactAnalysisId,
  );
  const recommendation: RepositoryValidationRecommendation = {
    ...input,
    id: createId("repository_validation_recommendation"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.repositoryValidationRecommendations.unshift(recommendation);
  await writeDb(db);
  return recommendation;
}

export async function getLatestRepositoryValidationRecommendation(impactAnalysisId: string) {
  const db = await readDb();
  return (db.repositoryValidationRecommendations ?? [])
    .filter((recommendation) => recommendation.impactAnalysisId === impactAnalysisId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export async function saveRepositoryUpdatePullRequest(input: Omit<RepositoryUpdatePullRequest, "id" | "createdAt">) {
  const db = await readDb();
  const pr: RepositoryUpdatePullRequest = {
    ...input,
    id: createId("repository_update_pr"),
    createdAt: now(),
  };
  db.repositoryUpdatePullRequests.unshift(pr);
  await writeDb(db);
  return pr;
}

export async function saveRepositoryAnalysis(input: Omit<RepositoryAnalysis, "id" | "createdAt" | "updatedAt">) {
  const db = await readDb();
  const timestamp = now();
  db.repositoryAnalyses = db.repositoryAnalyses.filter(
    (item) => !(item.workspaceId === input.workspaceId && item.integrationId === input.integrationId),
  );
  const analysis: RepositoryAnalysis = {
    id: createId("repo_analysis"),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...input,
  };
  db.repositoryAnalyses.unshift(analysis);
  addActivityLog(db, {
    workspaceId: input.workspaceId,
    action: "GitHub repository analyzed",
    resourceType: "RepositoryAnalysis",
    resourceId: analysis.id,
    newValue: {
      framework: analysis.framework,
      language: analysis.language,
      testFolderPath: analysis.testFolderPath,
      confidenceScore: analysis.confidenceScore,
    },
  });
  await writeDb(db);
  return analysis;
}

export async function getRepositoryAnalysis(workspaceId = defaultWorkspaceId) {
  const db = await readDb();
  const config = db.automationRepositoryConfigs.find(
    (item) => item.workspaceId === workspaceId && item.provider === "github",
  );
  if (!config) return null;
  return db.repositoryAnalyses.find(
    (item) => item.workspaceId === workspaceId && item.integrationId === config.id,
  ) ?? null;
}

export async function overrideRepositoryAnalysis(
  workspaceId: string,
  input: Partial<Pick<
    RepositoryAnalysis,
    "framework" | "language" | "buildTool" | "testFolderPath" | "pageObjectFolderPath" | "usesPageObjectModel" | "usesFixtures" | "namingConvention" | "importStyle" | "pattern" | "confidenceScore"
  >>,
  userId?: string,
) {
  const db = await readDb();
  const config = db.automationRepositoryConfigs.find(
    (item) => item.workspaceId === workspaceId && item.provider === "github",
  );
  if (!config) return null;
  const analysis = db.repositoryAnalyses.find(
    (item) => item.workspaceId === workspaceId && item.integrationId === config.id,
  );
  if (!analysis) return null;
  Object.assign(analysis, input, {
    confidenceScore: input.confidenceScore ?? Math.max(analysis.confidenceScore, 80),
    updatedAt: now(),
  });
  addActivityLog(db, {
    workspaceId,
    actorId: userId,
    action: "Repository analysis overridden",
    resourceType: "RepositoryAnalysis",
    resourceId: analysis.id,
    newValue: input,
  });
  await writeDb(db);
  return analysis;
}

export async function latestRepositorySync(workspaceId = defaultWorkspaceId) {
  const db = await readDb();
  const config = db.automationRepositoryConfigs.find(
    (item) => item.workspaceId === workspaceId && item.provider === "github",
  );
  if (!config) return null;
  return db.repositorySyncs
    .filter((sync) => sync.workspaceId === workspaceId && sync.integrationId === config.id && sync.status === "Completed")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export async function createRepositorySync(input: {
  workspaceId: string;
  integrationId: string;
  repoOwner: string;
  repoName: string;
  branch: string;
  previousCommitSha?: string;
  latestCommitSha: string;
  changedFiles: RepositoryChangedFile[];
  impactedTests: RepositoryImpactedTest[];
  riskLevel: RepositoryRiskLevel;
  status?: RepositorySync["status"];
  createdBy?: string;
}) {
  const db = await readDb();
  const timestamp = now();
  const sync: RepositorySync = {
    id: createId("repo_sync"),
    provider: "github",
    aiSuggestions: [],
    generatedUpdates: [],
    updatedFiles: [],
    prStatus: "Not Created",
    createdAt: timestamp,
    updatedAt: timestamp,
    status: input.status ?? "Completed",
    createdBy: input.createdBy ?? defaultUserId,
    ...input,
  };
  db.repositorySyncs.unshift(sync);
  addActivityLog(db, {
    workspaceId: input.workspaceId,
    action: "GitHub repository synced",
    resourceType: "RepositorySync",
    resourceId: sync.id,
    newValue: {
      changedFiles: sync.changedFiles.length,
      impactedTests: sync.impactedTests.length,
      riskLevel: sync.riskLevel,
    },
  });
  await writeDb(db);
  return sync;
}

export async function listRepositorySyncs(workspaceId = defaultWorkspaceId) {
  const db = await readDb();
  return db.repositorySyncs
    .filter((sync) => sync.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getRepositorySync(syncId: string) {
  const db = await readDb();
  return db.repositorySyncs.find((sync) => sync.id === syncId) ?? null;
}

export async function updateRepositorySyncSuggestions(syncId: string, suggestions: RepositoryAISuggestion[]) {
  const db = await readDb();
  const sync = db.repositorySyncs.find((item) => item.id === syncId);
  if (!sync) return null;
  sync.aiSuggestions = suggestions;
  sync.updatedAt = now();
  await writeDb(db);
  return sync;
}

export async function updateRepositorySyncGeneratedUpdates(
  syncId: string,
  generatedUpdates: RepositoryGeneratedUpdate[],
  prPreview: RepositoryPrPreview,
) {
  const db = await readDb();
  const sync = db.repositorySyncs.find((item) => item.id === syncId);
  if (!sync) return null;
  sync.generatedUpdates = generatedUpdates;
  sync.prPreview = prPreview;
  sync.branchName = prPreview.branchName;
  sync.updatedFiles = generatedUpdates.map((update) => update.testFilePath);
  sync.prStatus = "Preview Ready";
  sync.updatedAt = now();
  await writeDb(db);
  return sync;
}

export async function updateRepositorySyncUpdatePr(
  syncId: string,
  input: { prUrl: string; branchName: string; updatedFiles: string[] },
) {
  const db = await readDb();
  const sync = db.repositorySyncs.find((item) => item.id === syncId);
  if (!sync) return null;
  sync.prUrl = input.prUrl;
  sync.branchName = input.branchName;
  sync.updatedFiles = input.updatedFiles;
  sync.prStatus = "Created";
  sync.updatedAt = now();
  addActivityLog(db, {
    workspaceId: sync.workspaceId,
    action: "Repository sync update PR created",
    resourceType: "RepositorySync",
    resourceId: sync.id,
    newValue: { prUrl: input.prUrl, updatedFiles: input.updatedFiles },
  });
  await writeDb(db);
  return sync;
}

export async function updateRepositorySyncPr(syncId: string, prUrl: string) {
  const db = await readDb();
  const sync = db.repositorySyncs.find((item) => item.id === syncId);
  if (!sync) return null;
  sync.prUrl = prUrl;
  sync.updatedAt = now();
  addActivityLog(db, {
    workspaceId: sync.workspaceId,
    action: "Repository sync PR created",
    resourceType: "RepositorySync",
    resourceId: sync.id,
    newValue: { prUrl },
  });
  await writeDb(db);
  return sync;
}

export async function createPlaywrightValidationJob(
  input: Omit<PlaywrightValidationJob, "id" | "status" | "createdAt" | "updatedAt">,
) {
  const db = await readDb();
  const timestamp = now();
  const job: PlaywrightValidationJob = {
    ...input,
    id: createId("playwright_validation"),
    status: "Queued",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.playwrightValidations.unshift(job);
  await writeDb(db);
  return job;
}

export async function updatePlaywrightValidationJob(
  jobId: string,
  input: Partial<Pick<PlaywrightValidationJob, "status" | "result" | "errorMessage">>,
) {
  const db = await readDb();
  const job = db.playwrightValidations.find((item) => item.id === jobId);
  if (!job) throw httpError("Playwright validation job not found.", 404);
  Object.assign(job, input, { updatedAt: now() });
  await writeDb(db);
  return job;
}

export async function getPlaywrightValidationJob(jobId: string) {
  const db = await readDb();
  return db.playwrightValidations.find((job) => job.id === jobId) ?? null;
}

export async function listPlaywrightValidationJobs(filters: {
  workspaceId?: string;
  projectId?: string;
  requirementId?: string;
} = {}) {
  const db = await readDb();
  return db.playwrightValidations
    .filter((job) => !filters.workspaceId || job.workspaceId === filters.workspaceId)
    .filter((job) => !filters.projectId || job.projectId === filters.projectId)
    .filter((job) => !filters.requirementId || job.requirementId === filters.requirementId)
    .slice(0, 50);
}

export async function listApprovedTestCaseVersions(filters: {
  projectId?: string;
  moduleId?: string;
  requirementId?: string;
}) {
  const db = await readDb();
  return db.histories
    .filter((history) => history.reviewStatus === "Approved")
    .filter((history) => !filters.projectId || history.projectId === filters.projectId)
    .filter((history) => !filters.moduleId || history.moduleId === filters.moduleId)
    .filter((history) => !filters.requirementId || history.requirementId === filters.requirementId)
    .map((history) => ({
      ...enrichHistory(db, history),
      totalTestCases: countPlanTestCases(history.output),
    }))
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export async function createTestRun(input: {
  name: string;
  projectId: string;
  moduleId: string;
  requirementId?: string;
  environment: TestRunEnvironment;
  buildVersion: string;
  assignedTester?: string;
  startDate: string;
  endDate: string;
  description: string;
  historyIds?: string[];
  createdBy?: string;
}) {
  const db = await readDb();
  const project = db.projects.find((item) => item.id === input.projectId);
  const moduleItem = db.modules.find((item) => item.id === input.moduleId && item.projectId === input.projectId);
  if (!project || !moduleItem) return null;

  const histories = approvedHistoriesForRun(db, input);
  if (!histories.length) {
    const error = new Error("Select at least one approved test case version for this test run.");
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }

  const timestamp = now();
  const run: TestRun = {
    id: createId("run"),
    workspaceId: project.workspaceId,
    projectId: input.projectId,
    moduleId: input.moduleId,
    requirementId: input.requirementId || undefined,
    name: input.name,
    environment: input.environment,
    buildVersion: input.buildVersion,
    assignedTester: input.assignedTester?.trim() || input.createdBy || "Unassigned",
    status: "Not Started",
    startDate: input.startDate,
    endDate: input.endDate,
    description: input.description,
    createdBy: input.createdBy ?? "Current User",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const executions = histories.flatMap((history) => executionRowsFromHistory(history, timestamp));
  executions.forEach((execution) => {
    execution.testRunId = run.id;
    execution.environment = run.environment;
    execution.buildNumber = run.buildVersion;
  });
  db.testRuns.push(run);
  db.testExecutions.push(...executions);
  addActivityLog(db, {
    workspaceId: run.workspaceId,
    action: "Test run created",
    resourceType: "TestRun",
    resourceId: run.id,
    newValue: { name: run.name, totalTestCases: executions.length },
  });
  await writeDb(db);
  return summarizeTestRun(db, run);
}

export async function listTestRuns(filters: { projectId?: string; status?: TestRunStatus } = {}) {
  const db = await readDb();
  return db.testRuns
    .map((run) => summarizeTestRun(db, run))
    .filter((run) => !filters.projectId || run.projectId === filters.projectId)
    .filter((run) => !filters.status || run.status === filters.status)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getTestRun(testRunId: string) {
  const db = await readDb();
  const run = db.testRuns.find((item) => item.id === testRunId);
  if (!run) return null;
  return {
    ...summarizeTestRun(db, run),
    executions: db.testExecutions.filter((execution) => execution.testRunId === testRunId),
  };
}

export async function updateTestRun(
  testRunId: string,
  input: Partial<Pick<TestRun, "name" | "environment" | "buildVersion" | "assignedTester" | "status" | "startDate" | "endDate" | "description">>,
) {
  const db = await readDb();
  const run = db.testRuns.find((item) => item.id === testRunId);
  if (!run) return null;
  Object.assign(run, input, { updatedAt: now() });
  await writeDb(db);
  return summarizeTestRun(db, run);
}

export async function deleteTestRun(testRunId: string) {
  const db = await readDb();
  const exists = db.testRuns.some((run) => run.id === testRunId);
  if (!exists) return false;
  db.testRuns = db.testRuns.filter((run) => run.id !== testRunId);
  db.testExecutions = db.testExecutions.filter((execution) => execution.testRunId !== testRunId);
  db.testExecutionHistories = db.testExecutionHistories.filter((history) => history.testRunId !== testRunId);
  await writeDb(db);
  return true;
}

export async function listTestExecutions(testRunId: string) {
  const db = await readDb();
  return db.testExecutions
    .filter((execution) => execution.testRunId === testRunId)
    .sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));
}

export async function updateTestExecutionStatus(
  executionId: string,
  input: {
    status: TestExecutionStatus;
    actualResult?: string;
    comments?: string;
    bugId?: string;
    screenshotUrl?: string;
    videoUrl?: string;
    logUrl?: string;
    jiraBugId?: string;
    jiraBugUrl?: string;
    executionTime?: number;
    browser?: TestExecution["browser"];
    operatingSystem?: TestExecution["operatingSystem"];
    buildNumber?: string;
    environment?: TestRunEnvironment;
    updatedBy?: string;
  },
) {
  const db = await readDb();
  const execution = db.testExecutions.find((item) => item.id === executionId);
  if (!execution) return null;
  const actualResult = input.actualResult ?? execution.actualResult;
  const comments = input.comments ?? execution.comments;
  const screenshotUrl = input.screenshotUrl ?? execution.screenshotUrl;
  const logUrl = input.logUrl ?? execution.logUrl;
  const jiraBugLink = input.jiraBugUrl ?? execution.jiraBugUrl ?? input.bugId ?? execution.bugId ?? input.jiraBugId ?? execution.jiraBugId;
  if (input.status === "Failed" && (!actualResult?.trim() || !comments?.trim() || (!screenshotUrl?.trim() && !logUrl?.trim() && !jiraBugLink?.trim()))) {
    const error = new Error("Actual result, comments, and screenshot/log/Jira bug evidence are required for failed executions.");
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }
  if (input.status === "Blocked" && !comments?.trim()) {
    const error = new Error("Comments or blocker reason are required for blocked executions.");
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }
  const timestamp = now();
  const oldStatus = execution.status;
  execution.status = input.status;
  execution.actualResult = actualResult;
  execution.comments = comments;
  execution.bugId = input.bugId ?? execution.bugId;
  execution.jiraBugId = input.jiraBugId ?? input.bugId ?? execution.jiraBugId;
  execution.jiraBugUrl = input.jiraBugUrl ?? execution.jiraBugUrl;
  execution.screenshotUrl = screenshotUrl;
  execution.videoUrl = input.videoUrl ?? execution.videoUrl;
  execution.logUrl = logUrl;
  execution.executionTime = input.executionTime ?? execution.executionTime;
  execution.browser = input.browser ?? execution.browser;
  execution.operatingSystem = input.operatingSystem ?? execution.operatingSystem;
  execution.buildNumber = input.buildNumber ?? execution.buildNumber;
  execution.environment = input.environment ?? execution.environment;
  execution.executedBy = input.updatedBy ?? execution.executedBy ?? "Current User";
  execution.executedAt = timestamp;
  execution.updatedAt = timestamp;
  db.testExecutionHistories.push({
    id: createId("execution_history"),
    testRunId: execution.testRunId,
    testExecutionId: execution.id,
    testCaseId: execution.testCaseId,
    oldStatus,
    newStatus: execution.status,
    updatedBy: input.updatedBy ?? "Current User",
    comment: input.comments,
    actualResult: input.actualResult,
    bugId: input.bugId,
    jiraBugId: input.jiraBugId,
    jiraBugUrl: input.jiraBugUrl,
    createdAt: timestamp,
  });
  const run = db.testRuns.find((item) => item.id === execution.testRunId);
  if (run) {
    run.status = testRunStatusFromExecutions(db.testExecutions.filter((item) => item.testRunId === run.id));
    run.updatedAt = timestamp;
  }
  await writeDb(db);
  return execution;
}

export async function updateTestExecutionDetails(
  executionId: string,
  input: Partial<Pick<TestExecution, "actualResult" | "comments" | "bugId" | "screenshotUrl" | "videoUrl" | "logUrl" | "jiraBugId" | "jiraBugUrl" | "executionTime" | "browser" | "operatingSystem" | "buildNumber" | "environment">>,
) {
  const db = await readDb();
  const execution = db.testExecutions.find((item) => item.id === executionId);
  if (!execution) return null;
  Object.assign(execution, input, { updatedAt: now() });
  await writeDb(db);
  return execution;
}

export async function addTestExecutionAttachment(
  executionId: string,
  input: { attachmentType: "screenshot" | "video" | "log"; url: string; fileName?: string; mimeType?: string; sizeBytes?: number },
) {
  const db = await readDb();
  const execution = db.testExecutions.find((item) => item.id === executionId);
  if (!execution) return null;
  const timestamp = now();
  if (input.attachmentType === "screenshot") execution.screenshotUrl = input.url;
  if (input.attachmentType === "video") execution.videoUrl = input.url;
  if (input.attachmentType === "log") execution.logUrl = input.url;
  execution.updatedAt = timestamp;
  db.testExecutionHistories.push({
    id: createId("execution_history"),
    testRunId: execution.testRunId,
    testExecutionId: execution.id,
    testCaseId: execution.testCaseId,
    oldStatus: execution.status,
    newStatus: execution.status,
    updatedBy: "Current User",
    comment: `${input.attachmentType} attachment added${input.fileName ? `: ${input.fileName}` : ""}`,
    createdAt: timestamp,
  });
  await writeDb(db);
  return execution;
}

export async function deleteTestExecutionAttachment(
  executionId: string,
  attachmentId: "screenshot" | "video" | "log",
) {
  const db = await readDb();
  const execution = db.testExecutions.find((item) => item.id === executionId);
  if (!execution) return null;
  if (attachmentId === "screenshot") execution.screenshotUrl = "";
  if (attachmentId === "video") execution.videoUrl = "";
  if (attachmentId === "log") execution.logUrl = "";
  execution.updatedAt = now();
  await writeDb(db);
  return execution;
}

export async function getTestExecutionHistory(executionId: string) {
  const db = await readDb();
  return db.testExecutionHistories
    .filter((history) => history.testExecutionId === executionId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getTestExecutionDashboard() {
  const db = await readDb();
  const runs = db.testRuns.map((run) => summarizeTestRun(db, run));
  const executions = db.testExecutions;
  const counts = executionCounts(executions);
  const projectProgress = db.projects.map((project) => {
    const projectRuns = runs.filter((run) => run.projectId === project.id);
    return {
      projectId: project.id,
      projectName: project.name,
      progress: projectRuns.length ? Math.round(projectRuns.reduce((total, run) => total + run.progress, 0) / projectRuns.length) : 0,
    };
  });
  const trendMap = new Map<string, number>();
  db.testExecutionHistories.forEach((history) => increment(trendMap, dateKey(history.createdAt)));
  const testerMap = new Map<string, { total: number; passed: number; failed: number }>();
  const browserFailureMap = new Map<string, number>();
  const osFailureMap = new Map<string, number>();
  const buildPassRateMap = new Map<string, { passed: number; total: number }>();
  let failedWithEvidence = 0;
  let linkedToBugs = 0;
  let executionTimeTotal = 0;
  let executionTimeCount = 0;
  executions.forEach((execution) => {
    const tester = execution.executedBy || "Unassigned";
    const current = testerMap.get(tester) ?? { total: 0, passed: 0, failed: 0 };
    current.total += execution.status === "Not Executed" ? 0 : 1;
    current.passed += execution.status === "Passed" ? 1 : 0;
    current.failed += execution.status === "Failed" ? 1 : 0;
    testerMap.set(tester, current);
    if (execution.status === "Failed" && (execution.screenshotUrl || execution.logUrl || execution.videoUrl || execution.jiraBugUrl || execution.jiraBugId || execution.bugId)) failedWithEvidence += 1;
    if (execution.jiraBugUrl || execution.jiraBugId || execution.bugId) linkedToBugs += 1;
    if (execution.executionTime && execution.executionTime > 0) {
      executionTimeTotal += execution.executionTime;
      executionTimeCount += 1;
    }
    if (execution.status === "Failed") {
      if (execution.browser) increment(browserFailureMap, execution.browser);
      if (execution.operatingSystem) increment(osFailureMap, execution.operatingSystem);
    }
    const build = execution.buildNumber || "Unspecified";
    const buildSummary = buildPassRateMap.get(build) ?? { passed: 0, total: 0 };
    if (execution.status !== "Not Executed") buildSummary.total += 1;
    if (execution.status === "Passed") buildSummary.passed += 1;
    buildPassRateMap.set(build, buildSummary);
  });
  return {
    totalTestRuns: runs.length,
    activeTestRuns: runs.filter((run) => run.status === "In Progress").length,
    completedTestRuns: runs.filter((run) => run.status === "Completed").length,
    passRate: counts.passRate,
    failedTestCases: counts.failed,
    blockedTestCases: counts.blocked,
    executionProgressByProject: projectProgress,
    passFailChart: [
      { name: "Passed", value: counts.passed },
      { name: "Failed", value: counts.failed },
      { name: "Blocked", value: counts.blocked },
      { name: "Skipped", value: counts.skipped },
      { name: "Not Executed", value: counts.notExecuted },
    ],
    dailyExecutionTrend: toSeries(trendMap, "executions"),
    testerSummary: [...testerMap.entries()].map(([tester, value]) => ({ tester, ...value })),
    failedTestsWithEvidence: failedWithEvidence,
    testsLinkedToBugs: linkedToBugs,
    averageExecutionTime: executionTimeCount ? Math.round(executionTimeTotal / executionTimeCount) : 0,
    browserWiseFailures: [...browserFailureMap.entries()].map(([browser, failures]) => ({ browser, failures })),
    osWiseFailures: [...osFailureMap.entries()].map(([operatingSystem, failures]) => ({ operatingSystem, failures })),
    buildWisePassRate: [...buildPassRateMap.entries()].map(([buildNumber, value]) => ({
      buildNumber,
      passRate: value.total ? Math.round((value.passed / value.total) * 100) : 0,
    })),
  };
}

export async function getTestExecutionReports() {
  const runs = await listTestRuns();
  return runs;
}

export async function exportTestRunReport(testRunId: string, format: "pdf" | "excel") {
  const detail = await getTestRun(testRunId);
  if (!detail) return null;
  const rows = [
    ["Test Run", detail.name],
    ["Project", detail.projectName],
    ["Environment", detail.environment],
    ["Build Version", detail.buildVersion],
    ["Tester", detail.assignedTester],
    ["Total Test Cases", detail.totalTestCases],
    ["Passed", detail.passed],
    ["Failed", detail.failed],
    ["Blocked", detail.blocked],
    ["Skipped", detail.skipped],
    ["Not Executed", detail.notExecuted],
    ["Pass Rate", `${detail.passRate}%`],
  ];
  const executionRows = detail.executions.map((execution) => [
    execution.testCaseId,
    execution.title,
    execution.priority,
    execution.status,
    execution.actualResult,
    execution.comments,
    execution.bugId ?? "",
    execution.screenshotUrl ?? "",
    execution.videoUrl ?? "",
    execution.logUrl ?? "",
    execution.jiraBugId ?? "",
    execution.jiraBugUrl ?? "",
    execution.executionTime ?? "",
    execution.browser ?? "",
    execution.operatingSystem ?? "",
    execution.buildNumber ?? "",
    execution.environment ?? "",
  ]);
  if (format === "excel") {
    return {
      contentType: "application/vnd.ms-excel",
      filename: `${detail.name.replace(/\W+/g, "-").toLowerCase()}-execution-report.xls`,
      body: [...rows, [], ["Test Case ID", "Title", "Priority", "Status", "Actual Result", "Comments", "Bug ID", "Screenshot Link", "Video Link", "Log Link", "Jira Bug ID", "Jira Bug URL", "Execution Time", "Browser", "OS", "Build Number", "Environment"], ...executionRows]
        .map((row) => row.map(csvCell).join(","))
        .join("\n"),
    };
  }
  const summaryHtml = rows.map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`).join("");
  const detailsHtml = executionRows
    .map((row) => `<tr>${row.map((value) => `<td>${String(value).replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char] ?? char)}</td>`).join("")}</tr>`)
    .join("");
  return {
    contentType: "text/html",
    filename: `${detail.name.replace(/\W+/g, "-").toLowerCase()}-execution-report.html`,
    body: `<!doctype html><html><head><meta charset="utf-8"><title>Execution Report</title><style>body{font-family:Arial,sans-serif;padding:24px}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}th{background:#f5f5f5}</style></head><body><h1>Execution Report</h1><table>${summaryHtml}</table><h2>Execution Details</h2><table><thead><tr><th>Test Case ID</th><th>Title</th><th>Priority</th><th>Status</th><th>Actual Result</th><th>Comments</th><th>Bug ID</th><th>Screenshot Link</th><th>Video Link</th><th>Log Link</th><th>Jira Bug ID</th><th>Jira Bug URL</th><th>Execution Time</th><th>Browser</th><th>OS</th><th>Build Number</th><th>Environment</th></tr></thead><tbody>${detailsHtml}</tbody></table></body></html>`,
  };
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
  userId?: string;
}) {
  const db = await readDb();
  const timestamp = now();
  let chat = input.chatId ? db.aiChats.find((item) => item.id === input.chatId) : undefined;

  if (!chat) {
    const requirement = db.requirements.find((item) => item.id === input.requirementId);
    const project = db.projects.find((item) => item.id === input.projectId);
    chat = {
      id: createId("chat"),
      userId: input.userId ?? defaultUserId,
      workspaceId: project?.workspaceId ?? defaultWorkspaceId,
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
  const usage = workspaceUsage(db, chat.workspaceId);
  assertLimit("AI Generations", usage.usage.aiGenerations.used, usage.usage.aiGenerations.limit);
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
    workspaceId: chat.workspaceId,
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
    reviewStatus: "Draft",
    isLocked: false,
    updatedAt: timestamp,
    output,
  };

  db.histories.push(history);
  await writeDb(db);
  return enrichHistory(db, history);
}

export async function submitHistoryForReview(historyId: string, comment?: string) {
  const db = await readDb();
  const history = db.histories.find((item) => item.id === historyId);
  if (!history) return null;
  if (!["Draft", "Changes Requested"].includes(history.reviewStatus)) {
    throw new Error("Only Draft or Changes Requested versions can be submitted for review.");
  }
  const oldStatus = history.reviewStatus;
  const timestamp = now();
  history.status = "Submitted for Review";
  history.reviewStatus = "Submitted for Review";
  history.submittedBy = currentUser("QA Engineer").userName;
  history.submittedAt = timestamp;
  history.updatedAt = timestamp;
  if (comment) addReviewComment(db, { historyId, actionType: "Submitted for Review", message: comment, role: "QA Engineer" });
  addReviewAudit(db, {
    historyId,
    action: "Submitted for Review",
    oldStatus,
    newStatus: "Submitted for Review",
    comment,
    role: "QA Engineer",
  });
  await writeDb(db);
  return enrichHistory(db, history);
}

export async function getReviewQueue() {
  const db = await readDb();
  return db.histories
    .filter((history) => history.reviewStatus === "Submitted for Review")
    .map((history) => enrichHistory(db, history))
    .sort((a, b) => (b.submittedAt ?? b.updatedAt).localeCompare(a.submittedAt ?? a.updatedAt));
}

export async function getReviewDetail(historyId: string) {
  const db = await readDb();
  const history = db.histories.find((item) => item.id === historyId);
  if (!history) return null;
  return {
    history: enrichHistory(db, history),
    comments: db.reviewComments
      .filter((comment) => comment.historyId === historyId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    auditTrail: db.reviewAuditTrail
      .filter((audit) => audit.historyId === historyId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
  };
}

export async function approveHistory(historyId: string, comment?: string) {
  const db = await readDb();
  const history = db.histories.find((item) => item.id === historyId);
  if (!history) return null;
  const oldStatus = history.reviewStatus;
  const timestamp = now();
  history.status = "Approved";
  history.reviewStatus = "Approved";
  history.reviewedBy = currentUser("QA Lead").userName;
  history.reviewedAt = timestamp;
  history.approvedBy = currentUser("QA Lead").userName;
  history.approvedAt = timestamp;
  history.isLocked = true;
  history.updatedAt = timestamp;
  if (comment) addReviewComment(db, { historyId, actionType: "Approved", message: comment, role: "QA Lead" });
  addReviewAudit(db, { historyId, action: "Approved", oldStatus, newStatus: "Approved", comment, role: "QA Lead" });
  await writeDb(db);
  return enrichHistory(db, history);
}

export async function requestHistoryChanges(historyId: string, comment: string) {
  const db = await readDb();
  const history = db.histories.find((item) => item.id === historyId);
  if (!history) return null;
  const oldStatus = history.reviewStatus;
  const timestamp = now();
  history.status = "Changes Requested";
  history.reviewStatus = "Changes Requested";
  history.reviewedBy = currentUser("QA Lead").userName;
  history.reviewedAt = timestamp;
  history.isLocked = false;
  history.updatedAt = timestamp;
  addReviewComment(db, { historyId, actionType: "Changes Requested", message: comment, role: "QA Lead" });
  addReviewAudit(db, {
    historyId,
    action: "Changes Requested",
    oldStatus,
    newStatus: "Changes Requested",
    comment,
    role: "QA Lead",
  });
  await writeDb(db);
  return enrichHistory(db, history);
}

export async function rejectHistory(historyId: string, comment: string) {
  const db = await readDb();
  const history = db.histories.find((item) => item.id === historyId);
  if (!history) return null;
  const oldStatus = history.reviewStatus;
  const timestamp = now();
  history.status = "Rejected";
  history.reviewStatus = "Rejected";
  history.reviewedBy = currentUser("QA Lead").userName;
  history.reviewedAt = timestamp;
  history.rejectedBy = currentUser("QA Lead").userName;
  history.rejectedAt = timestamp;
  history.isLocked = true;
  history.updatedAt = timestamp;
  addReviewComment(db, { historyId, actionType: "Rejected", message: comment, role: "QA Lead" });
  addReviewAudit(db, { historyId, action: "Rejected", oldStatus, newStatus: "Rejected", comment, role: "QA Lead" });
  await writeDb(db);
  return enrichHistory(db, history);
}

export async function addHistoryReviewComment(historyId: string, message: string) {
  const db = await readDb();
  const history = db.histories.find((item) => item.id === historyId);
  if (!history) return null;
  const comment = addReviewComment(db, { historyId, actionType: "Comment Added", message, role: "QA Engineer" });
  addReviewAudit(db, { historyId, action: "Comment Added", comment: message, role: "QA Engineer" });
  await writeDb(db);
  return comment;
}

export async function getHistoryReviewComments(historyId: string) {
  const db = await readDb();
  return db.reviewComments
    .filter((comment) => comment.historyId === historyId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listWorkspaces() {
  const db = await readDb();
  return db.workspaces.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function ensureWorkspaceSubscription(db: ProjectDatabase, workspaceId: string) {
  let subscription = db.subscriptions.find((item) => item.workspaceId === workspaceId);
  if (!subscription) {
    const timestamp = now();
    const trialEndsAt = new Date(Date.now() + trialDurationDays * 86_400_000).toISOString();
    const workspace = db.workspaces.find((item) => item.id === workspaceId);
    subscription = {
      id: createId("subscription"),
      workspaceId,
      planId: "pro",
      billingCycle: "monthly",
      status: "Trialing",
      trialStartsAt: timestamp,
      trialEndsAt,
      currentPeriodStart: timestamp,
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.subscriptions.push(subscription);
    db.trials.push({
      id: createId("trial"),
      workspaceId,
      userId: workspace?.ownerId ?? defaultUserId,
      subscriptionId: subscription.id,
      planId: "pro",
      status: "Active",
      startsAt: timestamp,
      endsAt: trialEndsAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  return subscription;
}

function expireTrials(db: ProjectDatabase) {
  const timestamp = now();
  let changed = false;
  db.trials
    .filter((trial) => trial.status === "Active" && trial.endsAt <= timestamp)
    .forEach((trial) => {
      trial.status = "Expired";
      trial.updatedAt = timestamp;
      const subscription = db.subscriptions.find((item) => item.id === trial.subscriptionId);
      if (subscription?.status === "Trialing") {
        const oldValue = { ...subscription };
        subscription.planId = "free";
        subscription.status = "Active";
        subscription.trialStartsAt = trial.startsAt;
        subscription.trialEndsAt = trial.endsAt;
        subscription.currentPeriodStart = timestamp;
        subscription.currentPeriodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
        subscription.updatedAt = timestamp;
        addActivityLog(db, {
          workspaceId: subscription.workspaceId,
          action: "Trial expired",
          resourceType: "Subscription",
          resourceId: subscription.id,
          oldValue,
          newValue: subscription,
        });
      }
      changed = true;
    });
  return changed;
}

function trialSummary(db: ProjectDatabase, workspaceId: string) {
  const trial = db.trials
    .filter((item) => item.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!trial) return null;
  const daysRemaining = Math.max(0, Math.ceil((new Date(trial.endsAt).getTime() - Date.now()) / 86_400_000));
  return {
    ...trial,
    daysRemaining,
    featuresAvailable: planWithDefaults(planCatalog.find((plan) => plan.id === trial.planId) ?? planCatalog[1]).features,
  };
}

function createProTrialSubscription(db: ProjectDatabase, workspaceId: string, userId: string, timestamp = now()) {
  const trialEndsAt = new Date(Date.now() + trialDurationDays * 86_400_000).toISOString();
  const subscription: Subscription = {
    id: createId("subscription"),
    workspaceId,
    planId: "pro",
    billingCycle: "monthly",
    status: "Trialing",
    trialStartsAt: timestamp,
    trialEndsAt,
    currentPeriodStart: timestamp,
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const trial: Trial = {
    id: createId("trial"),
    workspaceId,
    userId,
    subscriptionId: subscription.id,
    planId: "pro",
    status: "Active",
    startsAt: timestamp,
    endsAt: trialEndsAt,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.subscriptions.push(subscription);
  db.trials.push(trial);
  addActivityLog(db, {
    workspaceId,
    actorId: userId,
    action: "Pro trial started",
    resourceType: "Trial",
    resourceId: trial.id,
    newValue: { startsAt: trial.startsAt, endsAt: trial.endsAt },
  });
  return { subscription, trial };
}

function limitError(resource: string, used: number, limit: number | "unlimited") {
  const error = new Error(`Plan limit exceeded: ${resource} ${used} / ${limit} used. Upgrade to continue.`);
  (error as Error & { statusCode?: number; code?: string }).statusCode = 403;
  (error as Error & { statusCode?: number; code?: string }).code = "PLAN_LIMIT_EXCEEDED";
  return error;
}

function monthStart() {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

function planWithDefaults(plan: Plan): Plan {
  const catalogPlan = planCatalog.find((item) => item.id === plan.id) ?? planCatalog[0];
  return {
    ...catalogPlan,
    ...plan,
    limits: {
      ...catalogPlan.limits,
      ...plan.limits,
    },
  };
}

function workspaceStorageMb(db: ProjectDatabase, workspaceId: string) {
  const payload = {
    projects: db.projects.filter((project) => project.workspaceId === workspaceId),
    modules: db.modules.filter((moduleItem) => moduleItem.workspaceId === workspaceId),
    requirements: db.requirements.filter((requirement) => requirement.workspaceId === workspaceId),
    histories: db.histories.filter((history) => history.workspaceId === workspaceId),
    aiChats: db.aiChats.filter((chat) => chat.workspaceId === workspaceId),
    exportHistories: db.exportHistories.filter((exportRecord) => exportRecord.workspaceId === workspaceId),
    activityLogs: db.activityLogs.filter((log) => log.workspaceId === workspaceId),
  };
  return Number((Buffer.byteLength(JSON.stringify(payload), "utf8") / 1024 / 1024).toFixed(2));
}

function workspaceUsage(db: ProjectDatabase, workspaceId: string) {
  const subscription = ensureWorkspaceSubscription(db, workspaceId);
  const plan = planWithDefaults(
    (db.plans?.length ? db.plans : planCatalog).find((item) => item.id === subscription.planId) ?? planCatalog[0],
  );
  const monthlyStart = monthStart();
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  const members = db.workspaceMembers.filter(
    (member) => member.workspaceId === workspaceId && member.status === "Active",
  ).length;
  const pendingInvites = db.workspaceInvites.filter(
    (invite) => invite.workspaceId === workspaceId && invite.status === "Pending",
  ).length;
  const projects = db.projects.filter((project) => project.workspaceId === workspaceId).length;
  const requirements = db.requirements.filter(
    (requirement) => requirement.workspaceId === workspaceId && requirement.createdAt >= monthlyStart,
  ).length;
  const aiGenerations = db.histories.filter(
    (history) => history.workspaceId === workspaceId && history.generatedAt >= monthlyStart,
  ).length;
  const aiChatMessages = db.aiChats
    .filter((chat) => chat.workspaceId === workspaceId)
    .flatMap((chat) => chat.messages)
    .filter((message) => message.role === "user" && message.createdAt >= monthlyStart).length;
  const exports = db.exportHistories.filter(
    (exportRecord) => exportRecord.workspaceId === workspaceId && exportRecord.createdAt >= monthlyStart,
  ).length;
  const workspaces = workspace ? db.workspaces.filter((item) => item.ownerId === workspace.ownerId).length : 0;
  return {
    plan,
    subscription,
    trial: trialSummary(db, workspaceId),
    usage: {
      workspaces: { used: workspaces, limit: plan.limits.workspaces },
      members: { used: members + pendingInvites, limit: plan.limits.teamMembers },
      projects: { used: projects, limit: plan.limits.projects },
      requirements: { used: requirements, limit: plan.limits.requirementsPerMonth },
      aiGenerations: { used: aiGenerations, limit: plan.limits.aiGenerationsPerMonth },
      aiChatMessages: { used: aiChatMessages, limit: plan.limits.aiChatMessagesPerMonth },
      exports: { used: exports, limit: plan.limits.exportsPerMonth },
      activeUsers: { used: members, limit: plan.limits.teamMembers },
      storage: { used: workspaceStorageMb(db, workspaceId), limit: plan.limits.storageMb },
    },
  };
}

function assertLimit(resource: string, used: number, limit: number | "unlimited") {
  if (limit !== "unlimited" && used >= limit) throw limitError(resource, used, limit);
}

function primaryWorkspaceIdForUser(db: ProjectDatabase, userId?: string) {
  return (
    db.workspaceMembers.find((member) => member.userId === (userId ?? defaultUserId) && member.status === "Active")
      ?.workspaceId ?? defaultWorkspaceId
  );
}

function planForUser(db: ProjectDatabase, userId?: string) {
  const workspaceId = db.workspaceMembers.find(
    (member) => member.userId === (userId ?? defaultUserId) && member.status === "Active",
  )?.workspaceId;
  if (!workspaceId) return planCatalog[0];
  return workspaceUsage(db, workspaceId).plan;
}

export async function getWorkspaceUsage(workspaceId: string) {
  const db = await readDb();
  expireTrials(db);
  const result = workspaceUsage(db, workspaceId);
  await writeDb(db);
  return result;
}

export async function listPlans() {
  const db = await readDb();
  return (db.plans?.length ? db.plans : planCatalog).map(planWithDefaults);
}

export async function assertAIUsageQuota(input: { projectId: string; moduleId?: string; type: "generation" | "chat" }) {
  const db = await readDb();
  const project = db.projects.find((item) => item.id === input.projectId);
  if (!project) return null;
  const usage = workspaceUsage(db, project.workspaceId);
  if (input.type === "generation") {
    assertLimit("AI Generations", usage.usage.aiGenerations.used, usage.usage.aiGenerations.limit);
  } else {
    assertLimit("AI Chat", usage.usage.aiChatMessages.used, usage.usage.aiChatMessages.limit);
  }
  await writeDb(db);
  return usage;
}

export async function assertExportQuota(workspaceId: string) {
  const db = await readDb();
  const usage = workspaceUsage(db, workspaceId);
  assertLimit("Exports", usage.usage.exports.used, usage.usage.exports.limit);
  await writeDb(db);
  return usage;
}

export async function getWorkspaceSubscription(workspaceId: string) {
  const db = await readDb();
  expireTrials(db);
  const subscription = ensureWorkspaceSubscription(db, workspaceId);
  const plan = planWithDefaults(
    (db.plans?.length ? db.plans : planCatalog).find((item) => item.id === subscription.planId) ?? planCatalog[0],
  );
  await writeDb(db);
  return { subscription, plan, trial: trialSummary(db, workspaceId) };
}

export async function getWorkspaceTrial(workspaceId: string) {
  const db = await readDb();
  expireTrials(db);
  const summary = trialSummary(db, workspaceId);
  await writeDb(db);
  return summary;
}

export async function expireExpiredTrials() {
  const db = await readDb();
  const changed = expireTrials(db);
  if (changed) await writeDb(db);
  return { changed };
}

export async function updateWorkspaceSubscription(
  workspaceId: string,
  input: { planId: PlanId; billingCycle?: BillingCycle },
) {
  const db = await readDb();
  const rawPlan = (db.plans?.length ? db.plans : planCatalog).find((item) => item.id === input.planId);
  if (!rawPlan) return null;
  const plan = planWithDefaults(rawPlan);
  const subscription = ensureWorkspaceSubscription(db, workspaceId);
  const oldValue = { ...subscription };
  const activeTrial = db.trials.find((trial) => trial.workspaceId === workspaceId && trial.status === "Active");
  if (activeTrial && input.planId !== "free") {
    activeTrial.status = "Converted";
    activeTrial.updatedAt = now();
  }
  subscription.planId = input.planId;
  subscription.billingCycle = input.billingCycle ?? subscription.billingCycle;
  subscription.status = "Active";
  if (input.planId !== "pro" || activeTrial?.status === "Converted") {
    subscription.trialStartsAt = subscription.trialStartsAt;
    subscription.trialEndsAt = subscription.trialEndsAt;
  }
  subscription.currentPeriodStart = now();
  subscription.currentPeriodEnd = new Date(Date.now() + (subscription.billingCycle === "yearly" ? 365 : 30) * 86_400_000).toISOString();
  subscription.updatedAt = now();
  addActivityLog(db, {
    workspaceId,
    action: "Subscription plan changed",
    resourceType: "Subscription",
    resourceId: subscription.id,
    oldValue,
    newValue: subscription,
  });
  await writeDb(db);
  return { subscription, plan, trial: trialSummary(db, workspaceId) };
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, storedHash?: string) {
  if (!storedHash) return false;
  const [algorithm, salt, hash] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const original = Buffer.from(hash, "hex");
  return original.length === derived.length && timingSafeEqual(original, derived);
}

function safeUser(user: ProjectDatabase["users"][number]) {
  const { passwordHash, resetToken, resetTokenExpiresAt, ...rest } = user;
  void passwordHash;
  void resetToken;
  void resetTokenExpiresAt;
  return rest;
}

function defaultWorkspaceName(fullName: string, workspaceName?: string) {
  return workspaceName?.trim() || `${fullName.split(" ")[0] || "User"}'s Workspace`;
}

function authContext(db: ProjectDatabase, userId: string) {
  const user = db.users.find((item) => item.id === userId);
  if (!user || user.status !== "Active") return null;
  const member = db.workspaceMembers.find((item) => item.userId === userId && item.status === "Active");
  const workspace = member ? db.workspaces.find((item) => item.id === member.workspaceId) : undefined;
  return {
    user: safeUser(user),
    workspace: workspace ?? null,
    member: member ?? null,
    role: member?.role ?? user.role,
    permissions: permissionsForRole(member?.role ?? user.role),
  };
}

export async function getAuthContext(userId: string) {
  const db = await readDb();
  return authContext(db, userId);
}

export async function signupUser(input: {
  fullName: string;
  email: string;
  password: string;
  workspaceName?: string;
}) {
  const db = await readDb();
  const email = input.email.trim().toLowerCase();
  if (db.users.some((user) => user.email.toLowerCase() === email)) {
    throw httpError("An account already exists for this email.", 409);
  }
  const timestamp = now();
  const user = {
    id: createId("user"),
    fullName: input.fullName.trim(),
    name: input.fullName.trim(),
    email,
    passwordHash: await hashPassword(input.password),
    authProvider: "email" as const,
    role: "Owner" as const,
    status: "Active" as const,
    emailVerified: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const workspace: Workspace = {
    id: createId("workspace"),
    workspaceName: defaultWorkspaceName(user.fullName, input.workspaceName),
    description: "Default workspace created during signup.",
    ownerId: user.id,
    status: "Active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const member: WorkspaceMember = {
    id: createId("member"),
    workspaceId: workspace.id,
    userId: user.id,
    name: user.fullName,
    email: user.email,
    role: "Owner",
    status: "Active",
    assignedProjects: [],
    joinedAt: timestamp,
    lastActiveAt: timestamp,
  };
  db.users.push(user);
  db.workspaces.push(workspace);
  db.workspaceMembers.push(member);
  createProTrialSubscription(db, workspace.id, user.id, timestamp);
  addActivityLog(db, {
    workspaceId: workspace.id,
    actorId: user.id,
    actorName: user.fullName,
    action: "Workspace created",
    resourceType: "Workspace",
    resourceId: workspace.id,
  });
  await writeDb(db);
  return authContext(db, user.id)!;
}

export async function loginUser(emailInput: string, password: string) {
  const db = await readDb();
  const email = emailInput.trim().toLowerCase();
  const user = db.users.find((item) => item.email.toLowerCase() === email && item.authProvider === "email");
  if (!user || user.status !== "Active" || !(await verifyPassword(password, user.passwordHash))) {
    throw httpError("Invalid email or password.", 401);
  }
  user.lastLoginAt = now();
  user.updatedAt = user.lastLoginAt;
  const member = db.workspaceMembers.find((item) => item.userId === user.id && item.status === "Active");
  if (member) member.lastActiveAt = user.lastLoginAt;
  await writeDb(db);
  return authContext(db, user.id)!;
}

export async function updateUserProfile(userId: string, input: { fullName?: string; avatar?: string }) {
  const db = await readDb();
  const user = db.users.find((item) => item.id === userId);
  if (!user) return null;
  if (input.fullName) {
    user.fullName = input.fullName;
    user.name = input.fullName;
  }
  if (input.avatar !== undefined) user.avatar = input.avatar;
  user.updatedAt = now();
  db.workspaceMembers
    .filter((member) => member.userId === userId)
    .forEach((member) => {
      member.name = user.fullName;
    });
  await writeDb(db);
  return authContext(db, userId);
}

export async function changeUserPassword(userId: string, currentPassword: string, newPassword: string) {
  const db = await readDb();
  const user = db.users.find((item) => item.id === userId);
  if (!user || user.authProvider !== "email") throw new Error("Password changes are only available for email accounts.");
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new Error("Current password is incorrect.");
  user.passwordHash = await hashPassword(newPassword);
  user.updatedAt = now();
  await writeDb(db);
  return true;
}

export async function createPasswordReset(emailInput: string) {
  const db = await readDb();
  const email = emailInput.trim().toLowerCase();
  const user = db.users.find((item) => item.email.toLowerCase() === email && item.authProvider === "email");
  if (!user) return null;
  user.resetToken = randomBytes(24).toString("hex");
  user.resetTokenExpiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  user.updatedAt = now();
  await writeDb(db);
  return { resetToken: user.resetToken, resetLink: `/reset-password?token=${user.resetToken}` };
}

export async function resetUserPassword(token: string, password: string) {
  const db = await readDb();
  const user = db.users.find((item) => item.resetToken === token && item.resetTokenExpiresAt && item.resetTokenExpiresAt > now());
  if (!user) throw new Error("Reset link is invalid or expired.");
  user.passwordHash = await hashPassword(password);
  user.resetToken = undefined;
  user.resetTokenExpiresAt = undefined;
  user.updatedAt = now();
  await writeDb(db);
  return true;
}

export async function getWorkspace(workspaceId: string) {
  const db = await readDb();
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return null;
  return {
    workspace,
    members: db.workspaceMembers.filter((member) => member.workspaceId === workspaceId),
    invites: db.workspaceInvites.filter((invite) => invite.workspaceId === workspaceId),
    activityLogs: db.activityLogs
      .filter((log) => log.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function createWorkspace(input: { workspaceName: string; description: string; logo?: string; ownerId?: string }) {
  const db = await readDb();
  const timestamp = now();
  const ownerId = input.ownerId ?? defaultUserId;
  const owner = db.users.find((user) => user.id === ownerId);
  const plan = planForUser(db, ownerId);
  const ownedWorkspaces = db.workspaces.filter((workspace) => workspace.ownerId === ownerId).length;
  assertLimit("Workspaces", ownedWorkspaces, plan.limits.workspaces);
  const workspace: Workspace = {
    id: createId("workspace"),
    workspaceName: input.workspaceName,
    description: input.description,
    logo: input.logo,
    ownerId,
    status: "Active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const member: WorkspaceMember = {
    id: createId("member"),
    workspaceId: workspace.id,
    userId: ownerId,
    name: owner?.name ?? "Current User",
    email: owner?.email ?? "owner@aiqacopilot.local",
    role: "Owner",
    status: "Active",
    assignedProjects: [],
    joinedAt: timestamp,
    lastActiveAt: timestamp,
  };
  db.workspaces.push(workspace);
  db.workspaceMembers.push(member);
  addActivityLog(db, {
    workspaceId: workspace.id,
    action: "Workspace created",
    resourceType: "Workspace",
    resourceId: workspace.id,
    newValue: { workspaceName: workspace.workspaceName },
  });
  await writeDb(db);
  return workspace;
}

export async function updateWorkspace(
  workspaceId: string,
  input: Partial<Pick<Workspace, "workspaceName" | "description" | "logo" | "status">>,
) {
  const db = await readDb();
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return null;
  const oldValue = { ...workspace };
  Object.assign(workspace, input, { updatedAt: now() });
  addActivityLog(db, {
    workspaceId,
    action: input.status === "Archived" ? "Workspace archived" : "Workspace updated",
    resourceType: "Workspace",
    resourceId: workspaceId,
    oldValue,
    newValue: input,
  });
  await writeDb(db);
  return workspace;
}

export async function deleteWorkspace(workspaceId: string) {
  if (workspaceId === defaultWorkspaceId) {
    throw new Error("Default workspace cannot be deleted.");
  }
  const db = await readDb();
  const workspace = db.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return false;
  db.workspaces = db.workspaces.filter((item) => item.id !== workspaceId);
  db.workspaceMembers = db.workspaceMembers.filter((item) => item.workspaceId !== workspaceId);
  db.workspaceInvites = db.workspaceInvites.filter((item) => item.workspaceId !== workspaceId);
  db.workspacePermissions = db.workspacePermissions.filter((item) => item.workspaceId !== workspaceId);
  db.activityLogs = db.activityLogs.filter((item) => item.workspaceId !== workspaceId);
  await writeDb(db);
  return true;
}

export async function listWorkspaceMembers(workspaceId: string) {
  const db = await readDb();
  return db.workspaceMembers.filter((member) => member.workspaceId === workspaceId);
}

export async function updateWorkspaceMemberRole(workspaceId: string, memberId: string, role: WorkspaceRole) {
  const db = await readDb();
  const member = db.workspaceMembers.find((item) => item.workspaceId === workspaceId && item.id === memberId);
  if (!member) return null;
  if (member.role === "Owner") throw new Error("Owner role cannot be changed.");
  const oldValue = member.role;
  member.role = role;
  member.lastActiveAt = now();
  addActivityLog(db, {
    workspaceId,
    action: "Role changed",
    resourceType: "WorkspaceMember",
    resourceId: memberId,
    oldValue,
    newValue: role,
  });
  await writeDb(db);
  return member;
}

export async function updateWorkspaceMemberProjects(
  workspaceId: string,
  memberId: string,
  assignedProjects: WorkspaceMember["assignedProjects"],
) {
  const db = await readDb();
  const member = db.workspaceMembers.find((item) => item.workspaceId === workspaceId && item.id === memberId);
  if (!member) return null;
  const oldValue = member.assignedProjects;
  member.assignedProjects = assignedProjects;
  addActivityLog(db, {
    workspaceId,
    action: "Project assigned",
    resourceType: "WorkspaceMember",
    resourceId: memberId,
    oldValue,
    newValue: assignedProjects,
  });
  await writeDb(db);
  return member;
}

export async function deactivateWorkspaceMember(workspaceId: string, memberId: string) {
  const db = await readDb();
  const member = db.workspaceMembers.find((item) => item.workspaceId === workspaceId && item.id === memberId);
  if (!member) return null;
  if (member.role === "Owner") throw new Error("Owner cannot be deactivated.");
  member.status = "Inactive";
  addActivityLog(db, {
    workspaceId,
    action: "Member deactivated",
    resourceType: "WorkspaceMember",
    resourceId: memberId,
  });
  await writeDb(db);
  return member;
}

export async function removeWorkspaceMember(workspaceId: string, memberId: string) {
  const db = await readDb();
  const member = db.workspaceMembers.find((item) => item.workspaceId === workspaceId && item.id === memberId);
  if (!member) return false;
  if (member.role === "Owner") throw new Error("Owner cannot be removed.");
  member.status = "Removed";
  addActivityLog(db, {
    workspaceId,
    action: "Member removed",
    resourceType: "WorkspaceMember",
    resourceId: memberId,
  });
  await writeDb(db);
  return true;
}

export async function createWorkspaceInvite(input: {
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  assignedProjects: WorkspaceInvite["assignedProjects"];
  message?: string;
  invitedBy?: string;
}) {
  const db = await readDb();
  const workspace = db.workspaces.find((item) => item.id === input.workspaceId);
  if (!workspace) return null;
  const usage = workspaceUsage(db, input.workspaceId);
  assertLimit("Members", usage.usage.members.used, usage.usage.members.limit);
  const invite: WorkspaceInvite = {
    id: createId("invite"),
    workspaceId: input.workspaceId,
    email: input.email,
    role: input.role,
    assignedProjects: input.assignedProjects,
    message: input.message,
    token: crypto.randomUUID(),
    status: "Pending",
    invitedBy: input.invitedBy ?? defaultUserId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now(),
  };
  db.workspaceInvites.push(invite);
  addActivityLog(db, {
    workspaceId: input.workspaceId,
    action: "Member invited",
    resourceType: "WorkspaceInvite",
    resourceId: invite.id,
    newValue: { email: invite.email, role: invite.role },
  });
  await writeDb(db);
  return { ...invite, inviteLink: `/invite/${invite.token}` };
}

export async function listWorkspaceInvites(workspaceId: string) {
  const db = await readDb();
  return db.workspaceInvites.filter((invite) => invite.workspaceId === workspaceId);
}

export async function acceptWorkspaceInvite(token: string) {
  const db = await readDb();
  const invite = db.workspaceInvites.find((item) => item.token === token);
  if (!invite) return null;
  if (invite.status !== "Pending") throw new Error("Invite is not pending.");
  const usage = workspaceUsage(db, invite.workspaceId);
  const activeMembers = db.workspaceMembers.filter(
    (member) => member.workspaceId === invite.workspaceId && member.status === "Active",
  ).length;
  assertLimit("Members", activeMembers, usage.usage.members.limit);
  invite.status = "Accepted";
  const timestamp = now();
  const member: WorkspaceMember = {
    id: createId("member"),
    workspaceId: invite.workspaceId,
    userId: createId("user"),
    name: invite.email.split("@")[0] ?? "Invited User",
    email: invite.email,
    role: invite.role,
    status: "Active",
    assignedProjects: invite.assignedProjects,
    joinedAt: timestamp,
    lastActiveAt: timestamp,
  };
  db.workspaceMembers.push(member);
  addActivityLog(db, {
    workspaceId: invite.workspaceId,
    action: "Member joined",
    resourceType: "WorkspaceMember",
    resourceId: member.id,
    newValue: { email: member.email, role: member.role },
  });
  await writeDb(db);
  return member;
}

export async function updateWorkspaceInviteStatus(workspaceId: string, inviteId: string, status: InviteStatus) {
  const db = await readDb();
  const invite = db.workspaceInvites.find((item) => item.workspaceId === workspaceId && item.id === inviteId);
  if (!invite) return null;
  invite.status = status;
  addActivityLog(db, {
    workspaceId,
    action: status === "Revoked" ? "Invite revoked" : "Invite updated",
    resourceType: "WorkspaceInvite",
    resourceId: inviteId,
    newValue: { status },
  });
  await writeDb(db);
  return invite;
}

export async function getWorkspacePermissions(workspaceId: string) {
  const db = await readDb();
  const member = db.workspaceMembers.find(
    (item) => item.workspaceId === workspaceId && item.userId === defaultUserId,
  );
  return {
    userId: defaultUserId,
    role: member?.role ?? "Owner",
    permissions: permissionsForRole(member?.role ?? "Owner"),
    assignedProjects: member?.assignedProjects ?? [],
  };
}

export async function getCurrentWorkspaceMember(workspaceId: string, userId = defaultUserId) {
  const db = await readDb();
  return db.workspaceMembers.find(
    (member) => member.workspaceId === workspaceId && member.userId === userId && member.status === "Active",
  ) ?? null;
}

export function permissionsForRole(role: WorkspaceRole) {
  const matrix: Record<WorkspaceRole, string[]> = {
    Owner: ["*"],
    Admin: ["manage_projects", "manage_members", "review", "export", "ai_chat"],
    "QA Lead": ["manage_projects", "review", "export", "ai_chat"],
    "QA Engineer": ["create_requirements", "generate", "submit_review", "ai_chat"],
    Viewer: ["view_approved"],
  };
  return matrix[role];
}

export async function listWorkspaceRoles(workspaceId: string) {
  const roles: WorkspaceRole[] = ["Owner", "Admin", "QA Lead", "QA Engineer", "Viewer"];
  return roles.map((role) => ({
    id: `${workspaceId}_${role.replace(/\s+/g, "_").toLowerCase()}`,
    workspaceId,
    role,
    permissions: permissionsForRole(role),
  }));
}

export async function updateWorkspaceRolePermissions(
  workspaceId: string,
  role: WorkspaceRole,
  permissions: string[],
) {
  const db = await readDb();
  let permission = db.workspacePermissions.find((item) => item.workspaceId === workspaceId && item.role === role);
  if (!permission) {
    permission = { id: createId("permission"), workspaceId, role, permissions };
    db.workspacePermissions.push(permission);
  } else {
    permission.permissions = permissions;
  }
  addActivityLog(db, {
    workspaceId,
    action: "Role permissions updated",
    resourceType: "Permission",
    resourceId: permission.id,
    newValue: { role, permissions },
  });
  await writeDb(db);
  return permission;
}
