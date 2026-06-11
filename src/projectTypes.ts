import type { Priority, TestFocus, TestPlan } from "./types.js";

export type ProjectDomain = "Banking" | "Healthcare" | "E-commerce" | "SaaS" | "Education" | "Custom";
export type EntityStatus = "Active" | "Archived";
export type ModulePriority = Priority | "Critical";
export type HistoryStatus =
  | "Draft"
  | "Submitted for Review"
  | "Changes Requested"
  | "Approved"
  | "Rejected";
export type ExportFormat = "excel" | "pdf";
export type ExportType = "version" | "versions" | "requirement" | "project" | "filtered";
export type UserRole = "Admin" | "QA Lead" | "QA Engineer" | "Viewer";
export type WorkspaceRole = "Owner" | "Admin" | "QA Lead" | "QA Engineer" | "Viewer";
export type ProjectPermissionLevel = "Full Access" | "Edit Access" | "Review Access" | "View Only";
export type MemberStatus = "Active" | "Inactive" | "Removed";
export type InviteStatus = "Pending" | "Accepted" | "Expired" | "Revoked";
export type PlanId = "free" | "pro" | "enterprise";
export type BillingCycle = "monthly" | "yearly";
export type SubscriptionStatus = "Trialing" | "Active" | "Canceled" | "Past Due";
export type TrialStatus = "Active" | "Expired" | "Converted";
export type ReviewAction =
  | "Submitted for Review"
  | "Approved"
  | "Changes Requested"
  | "Rejected"
  | "Comment Added"
  | "Exported Approved Version";
export type TestRunEnvironment = "QA" | "UAT" | "Staging" | "Production";
export type TestRunStatus = "Not Started" | "In Progress" | "Completed";
export type TestExecutionStatus = "Not Executed" | "Passed" | "Failed" | "Blocked" | "Skipped";
export type AIProviderType =
  | "default"
  | "openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "azure-openai"
  | "openrouter"
  | "custom-openai-compatible";
export type AIProviderFeatureName =
  | "test-generation"
  | "ai-chat"
  | "playwright-generation"
  | "requirement-impact"
  | "coverage-score";
export type AIProviderRequestFormat = "OpenAI Compatible";
export type AIProviderUsageStatus = "Success" | "Failed";

export interface User {
  id: string;
  fullName: string;
  name: string;
  email: string;
  passwordHash?: string;
  avatar?: string;
  authProvider: "email";
  role: WorkspaceRole;
  status: "Active" | "Inactive" | "Suspended";
  emailVerified: boolean;
  lastLoginAt?: string;
  resetToken?: string;
  resetTokenExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  workspaceName: string;
  description: string;
  logo?: string;
  ownerId: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  status: MemberStatus;
  assignedProjects: Array<{
    projectId: string;
    permission: ProjectPermissionLevel;
  }>;
  joinedAt: string;
  lastActiveAt: string;
}

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  assignedProjects: Array<{
    projectId: string;
    permission: ProjectPermissionLevel;
  }>;
  message?: string;
  token: string;
  status: InviteStatus;
  invitedBy: string;
  expiresAt: string;
  createdAt: string;
}

export interface WorkspacePermission {
  id: string;
  workspaceId: string;
  role: WorkspaceRole;
  permissions: string[];
}

export interface ActivityLog {
  id: string;
  workspaceId: string;
  actorId: string;
  actorName: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  createdAt: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  userId: string;
  name: string;
  description: string;
  domain: ProjectDomain;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectModule {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  description: string;
  priority: ModulePriority;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Requirement {
  id: string;
  workspaceId: string;
  projectId: string;
  moduleId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  priority: ModulePriority;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TestCaseGenerationHistory {
  id: string;
  userId: string;
  workspaceId: string;
  projectId: string;
  moduleId: string;
  requirementId: string;
  version: number;
  requirementInput: string;
  generatedAt: string;
  generatedBy: string;
  aiModelUsed: string;
  testType: TestFocus;
  coverageScore: number;
  status: HistoryStatus;
  reviewStatus: HistoryStatus;
  submittedBy?: string;
  submittedAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  isLocked: boolean;
  updatedAt: string;
  output: TestPlan;
}

export interface TestCaseHistoryRecord extends TestCaseGenerationHistory {
  projectName: string;
  moduleName: string;
  requirementTitle: string;
}

export interface TestCaseHistoryCompare {
  from: TestCaseHistoryRecord;
  to: TestCaseHistoryRecord;
  coverageDifference: number;
  addedTestCases: string[];
  removedTestCases: string[];
  updatedTestCases: string[];
}

export interface ExportHistory {
  id: string;
  userId: string;
  workspaceId: string;
  exportType: ExportType;
  exportFormat: ExportFormat;
  projectId?: string;
  requirementId?: string;
  totalRecords: number;
  createdAt: string;
}

export interface ReviewComment {
  id: string;
  historyId: string;
  userId: string;
  userName: string;
  role: UserRole;
  message: string;
  actionType: ReviewAction;
  createdAt: string;
}

export interface ReviewAuditTrail {
  id: string;
  historyId: string;
  action: ReviewAction;
  userId: string;
  userName: string;
  role: UserRole;
  oldStatus?: HistoryStatus;
  newStatus?: HistoryStatus;
  timestamp: string;
  comment?: string;
}

export interface AIChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AIChat {
  id: string;
  userId: string;
  workspaceId: string;
  projectId: string;
  moduleId: string;
  requirementId: string;
  historyVersionId?: string;
  title: string;
  messages: AIChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface AIChatSummary {
  id: string;
  projectId: string;
  moduleId: string;
  requirementId: string;
  historyVersionId?: string;
  title: string;
  projectName: string;
  requirementTitle: string;
  lastMessage: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestRun {
  id: string;
  workspaceId: string;
  projectId: string;
  moduleId: string;
  requirementId?: string;
  name: string;
  environment: TestRunEnvironment;
  buildVersion: string;
  assignedTester: string;
  status: TestRunStatus;
  startDate: string;
  endDate: string;
  description: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestExecution {
  id: string;
  testRunId: string;
  testCaseId: string;
  sourceHistoryId: string;
  sourceCategory: "Positive" | "Negative" | "Edge";
  title: string;
  description: string;
  expectedResult: string;
  priority: Priority;
  status: TestExecutionStatus;
  actualResult: string;
  comments: string;
  screenshotUrl?: string;
  bugId?: string;
  executedBy?: string;
  executedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestExecutionHistory {
  id: string;
  testRunId: string;
  testExecutionId: string;
  testCaseId: string;
  oldStatus: TestExecutionStatus;
  newStatus: TestExecutionStatus;
  updatedBy: string;
  comment?: string;
  actualResult?: string;
  bugId?: string;
  createdAt: string;
}

export interface AIProviderConfig {
  id: string;
  workspaceId: string;
  providerType: AIProviderType;
  providerName: string;
  apiKeyEncrypted?: string;
  apiKeyMasked?: string;
  baseUrl?: string;
  modelName: string;
  endpointUrl?: string;
  deploymentName?: string;
  apiVersion?: string;
  requestFormat?: AIProviderRequestFormat;
  temperature: number;
  maxTokens: number;
  isDefault: boolean;
  isActive: boolean;
  fallbackToDefault: boolean;
  lastTestedAt?: string;
  lastTestStatus?: AIProviderUsageStatus;
  createdBy: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIProviderFeatureMapping {
  id: string;
  workspaceId: string;
  featureName: AIProviderFeatureName;
  providerId: string;
  modelName: string;
  isActive: boolean;
  updatedAt: string;
  updatedBy?: string;
}

export interface AIProviderUsageLog {
  id: string;
  workspaceId: string;
  providerType: AIProviderType;
  providerName: string;
  modelName: string;
  featureName: AIProviderFeatureName;
  tokenUsage?: number;
  status: AIProviderUsageStatus;
  errorMessage?: string;
  createdBy?: string;
  createdAt: string;
}

export interface ProjectSummary extends Project {
  totalModules: number;
  totalRequirements: number;
  totalTestCases: number;
  lastUpdatedAt: string;
}

export interface PlanLimit {
  label: string;
  value: number | "unlimited" | string;
}

export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  monthlyPrice: number | null;
  yearlyPrice: number | null;
  recommended?: boolean;
  trialDays?: number;
  features: string[];
  limits: {
    workspaces: number | "unlimited";
    teamMembers: number | "unlimited";
    projects: number | "unlimited";
    requirementsPerMonth: number | "unlimited";
    aiGenerationsPerMonth: number | "unlimited";
    aiChatMessagesPerMonth: number | "unlimited";
    exportsPerMonth: number | "unlimited";
    storageMb: number | "unlimited";
    exports: string;
    analytics: boolean;
    reviewWorkflow: boolean;
    jiraIntegration: boolean;
    prioritySupport: boolean;
    customLimits: boolean;
  };
}

export interface Subscription {
  id: string;
  workspaceId: string;
  planId: PlanId;
  billingCycle: BillingCycle;
  status: SubscriptionStatus;
  trialStartsAt?: string;
  trialEndsAt?: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  createdAt: string;
  updatedAt: string;
}

export interface Trial {
  id: string;
  workspaceId: string;
  userId: string;
  subscriptionId: string;
  planId: PlanId;
  status: TrialStatus;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardStats {
  totalProjects: number;
  activeProjects: number;
  totalModules: number;
  totalRequirements: number;
  totalTestCases: number;
  averageTestCoverageScore: number;
  pendingReviews: number;
  approvedTestCases: number;
  changesRequested: number;
  rejectedItems: number;
  averageApprovalTimeHours: number;
  recentlyUpdatedProjects: ProjectSummary[];
}

export interface ProjectDatabase {
  plans: Plan[];
  subscriptions: Subscription[];
  trials: Trial[];
  workspaces: Workspace[];
  workspaceMembers: WorkspaceMember[];
  workspaceInvites: WorkspaceInvite[];
  workspacePermissions: WorkspacePermission[];
  activityLogs: ActivityLog[];
  users: User[];
  projects: Project[];
  modules: ProjectModule[];
  requirements: Requirement[];
  histories: TestCaseGenerationHistory[];
  exportHistories: ExportHistory[];
  aiChats: AIChat[];
  aiProviderConfigs: AIProviderConfig[];
  aiProviderFeatureMappings: AIProviderFeatureMapping[];
  aiProviderUsageLogs: AIProviderUsageLog[];
  testRuns: TestRun[];
  testExecutions: TestExecution[];
  testExecutionHistories: TestExecutionHistory[];
  reviewComments: ReviewComment[];
  reviewAuditTrail: ReviewAuditTrail[];
}
