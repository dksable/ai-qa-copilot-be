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
  | "coverage-score"
  | "repository-impact"
  | "repository-test-update"
  | "playwright-validation-failure"
  | "repository-fix-suggestion";
export type AIProviderRequestFormat = "OpenAI Compatible";
export type AIProviderUsageStatus = "Success" | "Failed";
export type AutomationRepositoryProvider = "github";
export type ApplicationRepositoryType = "frontend" | "backend";
export type ApplicationRepositoryStatus = "Connected" | "Failed" | "Pending";
export type RepositoryAnalysisLanguage = "TypeScript" | "JavaScript" | "Java" | "Unknown";
export type RepositoryAnalysisFramework =
  | "Playwright"
  | "Playwright Test Runner"
  | "Java Playwright"
  | "Custom Playwright setup"
  | "Unknown";
export type RepositoryAnalysisBuildTool = "npm" | "Maven" | "Gradle" | "Unknown";
export type RepositoryAnalysisPattern = "Page Object Model" | "Fixtures" | "Direct Playwright" | "Custom";
export type RepositorySyncStatus = "Pending" | "Completed" | "Failed";
export type RepositoryChangeType = "Added" | "Modified" | "Deleted";
export type RepositoryRiskLevel = "Low" | "Medium" | "High";
export type RepositorySuggestedAction = "Update" | "Add" | "Review" | "No Action";
export type RepositoryActivityStatus = "New" | "Reviewed" | "Ignored";
export type RepositoryImpactAnalysisStatus = "Pending" | "Completed" | "Failed" | "Reviewed";
export type RepositoryImpactSuggestedAction = "Update Test" | "Add New Test" | "Review Manually" | "No Action";
export type RepositoryImpactSuggestionCategory =
  | "Automation"
  | "Manual Testing"
  | "Regression"
  | "Data"
  | "API"
  | "UI";
export type RepositoryGeneratedTestUpdateStatus = "Pending" | "Approved" | "Rejected" | "Edited";
export type RepositoryValidationRunStatus = "Pending" | "Running" | "Passed" | "Failed" | "Completed";
export type RepositoryUpdatePullRequestStatus = "Created" | "Failed";
export type PlaywrightValidationStatus = "Queued" | "Running" | "Passed" | "Failed" | "Warning" | "Error";
export type PlaywrightValidationSeverity = "Info" | "Warning" | "Error";

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
  videoUrl?: string;
  logUrl?: string;
  bugId?: string;
  jiraBugId?: string;
  jiraBugUrl?: string;
  executionTime?: number;
  browser?: "Chrome" | "Firefox" | "Safari" | "Edge";
  operatingSystem?: "Windows" | "macOS" | "Linux" | "Android" | "iOS";
  buildNumber?: string;
  environment?: TestRunEnvironment;
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
  jiraBugId?: string;
  jiraBugUrl?: string;
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

export interface AutomationRepositoryConfig {
  id: string;
  workspaceId: string;
  provider: AutomationRepositoryProvider;
  tokenEncrypted: string;
  tokenMasked: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  testFolderPath: string;
  createdBy: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationRepositoryConfig {
  id: string;
  workspaceId: string;
  projectId?: string;
  repositoryType: ApplicationRepositoryType;
  provider: AutomationRepositoryProvider;
  tokenEncrypted: string;
  tokenMasked: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  webhookSecretEncrypted: string;
  webhookSecretMasked: string;
  webhookUrl: string;
  webhookId?: number;
  webhookStatus: ApplicationRepositoryStatus;
  webhookError?: string;
  lastEventReceivedAt?: string;
  lastSyncedAt?: string;
  createdBy: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryActivityChangedFile {
  filePath: string;
  changeType: RepositoryChangeType | "Renamed";
  additions?: number;
  deletions?: number;
  patch?: string;
  possibleModule?: string;
  riskLevel?: RepositoryRiskLevel;
}

export interface RepositoryActivity {
  id: string;
  workspaceId: string;
  projectId?: string;
  repositoryConfigId: string;
  repositoryType: ApplicationRepositoryType | "automation";
  provider: AutomationRepositoryProvider;
  eventType: "push" | "pull_request";
  action?: string;
  repoOwner: string;
  repoName: string;
  branch?: string;
  commitSha?: string;
  previousCommitSha?: string;
  pullRequestNumber?: number;
  pullRequestTitle?: string;
  pullRequestUrl?: string;
  author?: string;
  message?: string;
  changedFiles: RepositoryActivityChangedFile[];
  fileCount: number;
  status: RepositoryActivityStatus;
  deliveryId?: string;
  rawMetadata?: unknown;
  createdAt: string;
}

export interface RepositoryImpactAnalysisTest {
  testFilePath: string;
  relatedChangedFile: string;
  impactReason: string;
  suggestedAction: RepositoryImpactSuggestedAction;
  riskLevel: RepositoryRiskLevel;
  confidenceScore: number;
}

export interface RepositoryImpactAnalysisSuggestion {
  title: string;
  description: string;
  category: RepositoryImpactSuggestionCategory;
  priority: RepositoryRiskLevel;
  relatedTestFile?: string;
  relatedChangedFile?: string;
}

export interface RepositoryImpactAnalysis {
  id: string;
  workspaceId: string;
  projectId?: string;
  repositoryActivityId: string;
  applicationRepositoryId: string;
  automationRepositoryId?: string;
  provider: AutomationRepositoryProvider;
  repoOwner: string;
  repoName: string;
  branch?: string;
  commitSha?: string;
  changedFiles: RepositoryActivityChangedFile[];
  impactedModules: string[];
  impactedTests: RepositoryImpactAnalysisTest[];
  suggestions: RepositoryImpactAnalysisSuggestion[];
  riskLevel: RepositoryRiskLevel;
  confidenceScore: number;
  recommendation: string;
  status: RepositoryImpactAnalysisStatus;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryGeneratedTestUpdate {
  id: string;
  workspaceId: string;
  projectId?: string;
  impactAnalysisId: string;
  testFilePath: string;
  oldCode: string;
  newCode: string;
  updateSummary: string;
  impactReason: string;
  confidenceScore: number;
  riskLevel: RepositoryRiskLevel;
  suggestedAction: RepositoryImpactSuggestedAction;
  status: RepositoryGeneratedTestUpdateStatus;
  aiProvider: string;
  aiModel: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryValidationRun {
  id: string;
  workspaceId: string;
  projectId?: string;
  impactAnalysisId: string;
  status: RepositoryValidationRunStatus;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  browser: string;
  environment: string;
  logs: string;
  stdout?: string;
  stderr?: string;
  failedTestNames?: string[];
  validationWorkspacePath?: string;
  errorDetails?: string;
  failureExplanation?: string;
  screenshots: string[];
  videos: string[];
  reportUrl?: string;
  createdBy?: string;
  createdAt: string;
  completedAt?: string;
}

export interface RepositoryUpdatePullRequest {
  id: string;
  workspaceId: string;
  projectId?: string;
  impactAnalysisId: string;
  branchName: string;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
  updatedFiles: string[];
  validationRunId?: string;
  status: RepositoryUpdatePullRequestStatus;
  createdBy?: string;
  createdAt: string;
}

export interface RepositoryAnalysis {
  id: string;
  workspaceId: string;
  integrationId: string;
  provider: AutomationRepositoryProvider;
  repoOwner: string;
  repoName: string;
  branch: string;
  framework: RepositoryAnalysisFramework;
  language: RepositoryAnalysisLanguage;
  buildTool: RepositoryAnalysisBuildTool;
  testFolderPath: string;
  pageObjectFolderPath?: string;
  usesPageObjectModel: boolean;
  usesFixtures: boolean;
  namingConvention: string;
  importStyle: string;
  pattern: RepositoryAnalysisPattern;
  confidenceScore: number;
  scannedFiles: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryChangedFile {
  filePath: string;
  changeType: RepositoryChangeType;
  relatedModule: string;
  riskLevel: RepositoryRiskLevel;
  possibleTestImpact: string;
}

export interface RepositoryImpactedTest {
  testFile: string;
  relatedChangedFile: string;
  impactReason: string;
  suggestedAction: RepositorySuggestedAction;
  confidenceScore: number;
}

export interface RepositoryAISuggestion {
  summary: string;
  impactedTests: string[];
  suggestedUpdates: string[];
  riskLevel: RepositoryRiskLevel;
  recommendedPrAction: string;
}

export interface RepositorySync {
  id: string;
  workspaceId: string;
  integrationId: string;
  provider: AutomationRepositoryProvider;
  repoOwner: string;
  repoName: string;
  branch: string;
  previousCommitSha?: string;
  latestCommitSha: string;
  changedFiles: RepositoryChangedFile[];
  impactedTests: RepositoryImpactedTest[];
  aiSuggestions: RepositoryAISuggestion[];
  generatedUpdates?: RepositoryGeneratedUpdate[];
  prPreview?: RepositoryPrPreview;
  updatedFiles?: string[];
  branchName?: string;
  riskLevel: RepositoryRiskLevel;
  status: RepositorySyncStatus;
  prUrl?: string;
  prStatus?: "Not Created" | "Preview Ready" | "Created" | "Failed";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryGeneratedUpdate {
  id: string;
  syncId: string;
  testFilePath: string;
  oldCode: string;
  newCode: string;
  impactReason: string;
  changedLocatorOrFlow: string;
  confidenceScore: number;
  riskLevel: RepositoryRiskLevel;
  suggestedAction: "Update" | "Add" | "Review" | "No Action" | "Needs Manual Review";
  createdAt: string;
}

export interface RepositoryPrPreview {
  filesToAdd: string[];
  filesToUpdate: string[];
  branchName: string;
  title: string;
  description: string;
  riskLevel: RepositoryRiskLevel;
  confidenceScore: number;
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

export interface PlaywrightValidationIssue {
  id: string;
  severity: PlaywrightValidationSeverity;
  category: string;
  message: string;
  recommendation: string;
  line?: number;
}

export interface PlaywrightValidationResult {
  score: number;
  status: PlaywrightValidationStatus;
  summary: string;
  issues: PlaywrightValidationIssue[];
  recommendations: string[];
  checkedAt: string;
  durationMs: number;
}

export interface PlaywrightValidationJob {
  id: string;
  workspaceId?: string;
  projectId?: string;
  moduleId?: string;
  requirementId?: string;
  requirementTitle?: string;
  fileName: string;
  playwrightCode: string;
  status: PlaywrightValidationStatus;
  result?: PlaywrightValidationResult;
  errorMessage?: string;
  createdBy?: string;
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
  automationRepositoryConfigs: AutomationRepositoryConfig[];
  applicationRepositoryConfigs: ApplicationRepositoryConfig[];
  repositoryActivities: RepositoryActivity[];
  repositoryImpactAnalyses: RepositoryImpactAnalysis[];
  repositoryGeneratedTestUpdates: RepositoryGeneratedTestUpdate[];
  repositoryValidationRuns: RepositoryValidationRun[];
  repositoryUpdatePullRequests: RepositoryUpdatePullRequest[];
  repositoryAnalyses: RepositoryAnalysis[];
  repositorySyncs: RepositorySync[];
  playwrightValidations: PlaywrightValidationJob[];
  testRuns: TestRun[];
  testExecutions: TestExecution[];
  testExecutionHistories: TestExecutionHistory[];
  reviewComments: ReviewComment[];
  reviewAuditTrail: ReviewAuditTrail[];
}
