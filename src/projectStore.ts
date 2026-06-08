import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { TestFocus, TestPlan } from "./types.js";
import type {
  AIChat,
  AIChatSummary,
  ActivityLog,
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
  ProjectPermissionLevel,
  Project,
  ProjectDatabase,
  ProjectDomain,
  ProjectModule,
  ProjectSummary,
  Requirement,
  ReviewAction,
  ReviewComment,
  Subscription,
  TestCaseGenerationHistory,
  TestCaseHistoryCompare,
  TestCaseHistoryRecord,
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
const defaultUserId = "demo-user";
const defaultWorkspaceId = "workspace_default";
const demoTimestamp = "2026-06-08T09:00:00.000Z";
const demoEmail = "demo@aiqacopilot.local";
const demoPasswordHash =
  "scrypt:demo-aiqa-salt-2026:5db2a0d89de2b4fc506a01ca83b2b01c92a884833ff230d54f8fcb6341b0584a1aa705d10c1e90bf6ff968174cf3ae9c956c75c786a1ed6c08b81dadadfb1856";
const scrypt = promisify(scryptCallback);
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
      exports: "Excel + PDF",
      analytics: true,
      reviewWorkflow: true,
      jiraIntegration: true,
      prioritySupport: true,
      customLimits: true,
    },
  },
];
const demoTestPlan: TestPlan = {
  summary: "Password reset coverage for email link expiry, secure password policy, and confirmation messaging.",
  acceptanceCriteria: [
    "User can request a password reset email from the login page.",
    "Reset link expires after 30 minutes.",
    "New password requires at least 8 characters, one number, and one symbol.",
    "User receives a confirmation after reset succeeds.",
  ],
  positive: [
    {
      id: "POS-001",
      title: "Registered user resets password with a valid email link",
      steps: ["Open login page", "Request password reset", "Open valid reset link", "Submit compliant password"],
      expected: "Password is updated and confirmation message is displayed.",
      priority: "High",
    },
    {
      id: "POS-002",
      title: "Confirmation email is sent after successful reset",
      steps: ["Complete password reset", "Check registered mailbox"],
      expected: "User receives reset confirmation email.",
      priority: "Medium",
    },
  ],
  negative: [
    {
      id: "NEG-001",
      title: "Expired reset link is rejected",
      steps: ["Request reset link", "Wait longer than 30 minutes", "Open link"],
      expected: "System blocks the link and prompts user to request a new one.",
      priority: "High",
    },
    {
      id: "NEG-002",
      title: "Weak password is rejected",
      steps: ["Open valid reset link", "Enter password without number or symbol"],
      expected: "Validation error explains password policy.",
      priority: "High",
    },
  ],
  edge: [
    {
      id: "EDGE-001",
      title: "Multiple reset requests invalidate older links",
      steps: ["Request reset link twice", "Open the first link"],
      expected: "Older link is rejected and latest link remains valid.",
      priority: "Medium",
    },
  ],
  testData: [
    {
      field: "email",
      valid: ["customer@example.com"],
      invalid: ["unknown@example.com", "bad-email"],
      boundary: ["64-character local part email"],
    },
    {
      field: "password",
      valid: ["Secure@123"],
      invalid: ["password", "short1!"],
      boundary: ["8 characters exactly with number and symbol"],
    },
  ],
  playwright: "import { test, expect } from '@playwright/test';\n\ntest('registered user can reset password', async ({ page }) => {\n  await page.goto('/login');\n  await page.getByRole('link', { name: /forgot password/i }).click();\n  await page.getByLabel(/email/i).fill('customer@example.com');\n  await page.getByRole('button', { name: /send reset link/i }).click();\n  await expect(page.getByText(/reset link sent/i)).toBeVisible();\n});",
  regressionImpact: {
    riskLevel: "Medium",
    riskScore: 64,
    impactedModules: ["Login", "Notifications"],
    regressionAreas: [{ area: "Authentication recovery", priority: "High", coverage: "Functional and negative paths" }],
    riskReason: "Password reset affects account access and security controls.",
    qaFocusAreas: ["Expired links", "Weak password validation", "Email delivery"],
    releaseRecommendation: {
      status: "Release with Caution",
      reason: "Add API and rate-limit coverage before high-volume release.",
    },
  },
  coverageAnalysis: {
    coverageScore: 86,
    coverageStatus: "Good",
    totalGeneratedTestCases: 5,
    coveredAreas: ["Happy path reset", "Expired links", "Password policy", "Email confirmation"],
    missingAreas: ["Rate limiting", "Localization"],
    breakdown: [
      { category: "Functional", status: "Covered", percentage: 92 },
      { category: "Negative", status: "Covered", percentage: 84 },
      { category: "Security", status: "Partial", percentage: 68 },
    ],
    recommendations: ["Add brute-force throttling scenarios.", "Add API-level reset token validation tests."],
  },
};

const initialDb: ProjectDatabase = {
  plans: planCatalog,
  subscriptions: [
    {
      id: "subscription_default",
      workspaceId: defaultWorkspaceId,
      planId: "pro",
      billingCycle: "monthly",
      status: "Trialing",
      trialEndsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  workspaces: [
    {
      id: defaultWorkspaceId,
      workspaceName: "Successive Digital QA Team",
      description: "Demo workspace with realistic QA assets for management walkthroughs.",
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
      name: "Current User",
      email: "demo@aiqacopilot.local",
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
      fullName: "Demo User",
      name: "Demo User",
      email: demoEmail,
      passwordHash: demoPasswordHash,
      authProvider: "email",
      role: "Owner",
      status: "Active",
      emailVerified: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  projects: [
    {
      id: "project_demo_banking",
      workspaceId: defaultWorkspaceId,
      userId: defaultUserId,
      name: "Banking Customer Portal",
      description: "Customer login, registration, payment, and account servicing quality workspace.",
      domain: "Banking",
      status: "Active",
      createdAt: demoTimestamp,
      updatedAt: demoTimestamp,
    },
  ],
  modules: [
    {
      id: "module_demo_login",
      workspaceId: defaultWorkspaceId,
      projectId: "project_demo_banking",
      name: "Login & Access Recovery",
      description: "Authentication, password reset, and user access recovery.",
      priority: "Critical",
      status: "Active",
      createdAt: demoTimestamp,
      updatedAt: demoTimestamp,
    },
    {
      id: "module_demo_payment",
      workspaceId: defaultWorkspaceId,
      projectId: "project_demo_banking",
      name: "Payment",
      description: "Bill payment and confirmation flows.",
      priority: "High",
      status: "Active",
      createdAt: demoTimestamp,
      updatedAt: demoTimestamp,
    },
  ],
  requirements: [
    {
      id: "requirement_demo_reset",
      workspaceId: defaultWorkspaceId,
      projectId: "project_demo_banking",
      moduleId: "module_demo_login",
      title: "Reset password via email",
      description: "As a registered user, I want to reset my password via email so that I can regain access to my account.",
      acceptanceCriteria: demoTestPlan.acceptanceCriteria.join("\n"),
      priority: "High",
      status: "Active",
      createdAt: demoTimestamp,
      updatedAt: demoTimestamp,
    },
  ],
  histories: [
    {
      id: "history_demo_reset_v1",
      userId: defaultUserId,
      workspaceId: defaultWorkspaceId,
      projectId: "project_demo_banking",
      moduleId: "module_demo_login",
      requirementId: "requirement_demo_reset",
      version: 1,
      requirementInput: "As a registered user, I want to reset my password via email so that I can regain access to my account.",
      generatedAt: demoTimestamp,
      generatedBy: "Demo User",
      aiModelUsed: "llama-3.3-70b-versatile",
      testType: "functional",
      coverageScore: 86,
      status: "Submitted for Review",
      reviewStatus: "Submitted for Review",
      submittedBy: "Demo User",
      submittedAt: demoTimestamp,
      isLocked: false,
      updatedAt: demoTimestamp,
      output: demoTestPlan,
    },
  ],
  exportHistories: [
    {
      id: "export_demo_1",
      userId: defaultUserId,
      workspaceId: defaultWorkspaceId,
      exportType: "version",
      exportFormat: "pdf",
      projectId: "project_demo_banking",
      requirementId: "requirement_demo_reset",
      totalRecords: 1,
      createdAt: demoTimestamp,
    },
  ],
  aiChats: [
    {
      id: "chat_demo_1",
      userId: defaultUserId,
      workspaceId: defaultWorkspaceId,
      projectId: "project_demo_banking",
      moduleId: "module_demo_login",
      requirementId: "requirement_demo_reset",
      historyVersionId: "history_demo_reset_v1",
      title: "Improve password reset coverage",
      messages: [
        { role: "user", content: "What security test cases are missing?", createdAt: demoTimestamp },
        { role: "assistant", content: "Add rate limiting, token reuse, token tampering, and account enumeration checks before approval.", createdAt: demoTimestamp },
      ],
      createdAt: demoTimestamp,
      updatedAt: demoTimestamp,
    },
  ],
  reviewComments: [],
  reviewAuditTrail: [],
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
  const workspaces = db.workspaces?.length ? db.workspaces : initialDb.workspaces;
  const workspaceMembers = db.workspaceMembers?.length ? db.workspaceMembers : initialDb.workspaceMembers;
  return {
    ...db,
    plans: db.plans?.length ? db.plans : planCatalog,
    subscriptions: db.subscriptions?.length ? db.subscriptions : initialDb.subscriptions,
    workspaces,
    workspaceMembers,
    workspaceInvites: db.workspaceInvites ?? [],
    workspacePermissions: db.workspacePermissions ?? [],
    activityLogs: db.activityLogs ?? [],
    exportHistories: db.exportHistories ?? [],
    aiChats: (db.aiChats ?? []).map(normalizeChat),
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
  writeQueue = writeQueue.then(() => writeFile(dbFile, JSON.stringify(db, null, 2)));
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

function normalizeUser(user: ProjectDatabase["users"][number]): ProjectDatabase["users"][number] {
  const timestamp = user.createdAt ?? now();
  const isDemoUser = user.id === defaultUserId || user.email?.toLowerCase() === demoEmail;
  return {
    ...user,
    fullName: user.fullName ?? user.name ?? "Current User",
    name: user.name ?? user.fullName ?? "Current User",
    passwordHash: user.passwordHash ?? (isDemoUser ? demoPasswordHash : undefined),
    authProvider: user.authProvider ?? "email",
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
}) {
  const db = await readDb();
  const timestamp = now();
  const project: Project = {
    id: createId("project"),
    workspaceId: defaultWorkspaceId,
    userId: defaultUserId,
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
    workspaceId: defaultWorkspaceId,
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
    workspaceId: defaultWorkspaceId,
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
      workspaceId: defaultWorkspaceId,
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
    workspaceId: defaultWorkspaceId,
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
    workspaceId: input.projectId
      ? db.projects.find((project) => project.id === input.projectId)?.workspaceId ?? defaultWorkspaceId
      : defaultWorkspaceId,
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
      workspaceId: defaultWorkspaceId,
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
    workspaceId: defaultWorkspaceId,
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
    subscription = {
      id: createId("subscription"),
      workspaceId,
      planId: "free",
      billingCycle: "monthly",
      status: "Trialing",
      trialEndsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      currentPeriodStart: timestamp,
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.subscriptions.push(subscription);
  }
  return subscription;
}

export async function listPlans() {
  const db = await readDb();
  return db.plans?.length ? db.plans : planCatalog;
}

export async function getWorkspaceSubscription(workspaceId: string) {
  const db = await readDb();
  const subscription = ensureWorkspaceSubscription(db, workspaceId);
  const plan = (db.plans?.length ? db.plans : planCatalog).find((item) => item.id === subscription.planId) ?? planCatalog[0];
  await writeDb(db);
  return { subscription, plan };
}

export async function updateWorkspaceSubscription(
  workspaceId: string,
  input: { planId: PlanId; billingCycle?: BillingCycle },
) {
  const db = await readDb();
  const plan = (db.plans?.length ? db.plans : planCatalog).find((item) => item.id === input.planId);
  if (!plan) return null;
  const subscription = ensureWorkspaceSubscription(db, workspaceId);
  const oldValue = { ...subscription };
  subscription.planId = input.planId;
  subscription.billingCycle = input.billingCycle ?? subscription.billingCycle;
  subscription.status = input.planId === "free" ? "Trialing" : "Active";
  subscription.trialEndsAt = input.planId === "free" ? subscription.trialEndsAt ?? new Date(Date.now() + 14 * 86_400_000).toISOString() : undefined;
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
  return { subscription, plan };
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
    throw new Error("An account already exists for this email.");
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
    throw new Error("Invalid email or password.");
  }
  user.lastLoginAt = now();
  user.updatedAt = user.lastLoginAt;
  const member = db.workspaceMembers.find((item) => item.userId === user.id && item.status === "Active");
  if (member) member.lastActiveAt = user.lastLoginAt;
  await writeDb(db);
  return authContext(db, user.id)!;
}

export async function googleLoginUser(input: { googleId?: string; email: string; fullName: string; avatar?: string }) {
  const db = await readDb();
  const email = input.email.trim().toLowerCase();
  const timestamp = now();
  let user = db.users.find((item) => item.email.toLowerCase() === email);
  if (!user) {
    user = {
      id: createId("user"),
      fullName: input.fullName,
      name: input.fullName,
      email,
      googleId: input.googleId,
      avatar: input.avatar,
      authProvider: "google",
      role: "Owner",
      status: "Active",
      emailVerified: true,
      lastLoginAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const workspace: Workspace = {
      id: createId("workspace"),
      workspaceName: defaultWorkspaceName(user.fullName),
      description: "Default workspace created from Google login.",
      ownerId: user.id,
      status: "Active",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.users.push(user);
    db.workspaces.push(workspace);
    db.workspaceMembers.push({
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
    });
  } else {
    user.googleId = input.googleId ?? user.googleId;
    user.avatar = input.avatar ?? user.avatar;
    user.lastLoginAt = timestamp;
    user.updatedAt = timestamp;
  }
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

export async function createWorkspace(input: { workspaceName: string; description: string; logo?: string }) {
  const db = await readDb();
  const timestamp = now();
  const workspace: Workspace = {
    id: createId("workspace"),
    workspaceName: input.workspaceName,
    description: input.description,
    logo: input.logo,
    ownerId: defaultUserId,
    status: "Active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const member: WorkspaceMember = {
    id: createId("member"),
    workspaceId: workspace.id,
    userId: defaultUserId,
    name: "Current User",
    email: "demo@aiqacopilot.local",
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
}) {
  const db = await readDb();
  const workspace = db.workspaces.find((item) => item.id === input.workspaceId);
  if (!workspace) return null;
  const invite: WorkspaceInvite = {
    id: createId("invite"),
    workspaceId: input.workspaceId,
    email: input.email,
    role: input.role,
    assignedProjects: input.assignedProjects,
    message: input.message,
    token: crypto.randomUUID(),
    status: "Pending",
    invitedBy: defaultUserId,
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
