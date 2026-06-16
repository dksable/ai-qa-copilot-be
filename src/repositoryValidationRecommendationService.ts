import { generateAIContent } from "./aiProviderRouter.js";
import type {
  RepositoryGeneratedTestUpdate,
  RepositoryImpactAnalysis,
  RepositoryValidationRecommendation,
  RepositoryValidationRun,
} from "./projectTypes.js";

type RecommendationInput = {
  impactAnalysis: RepositoryImpactAnalysis;
  validationRun: RepositoryValidationRun;
  updates: RepositoryGeneratedTestUpdate[];
  status: "Generated" | "Regenerated";
  createdBy?: string;
};

const releaseRecommendations = ["Safe to Merge", "Merge with Caution", "Do Not Merge"] as const;
const mergeDecisions = ["Approved", "Warning", "Blocked"] as const;
const riskLevels = ["Low", "Medium", "High"] as const;

export async function generateValidationRecommendation(input: RecommendationInput): Promise<Omit<RepositoryValidationRecommendation, "id" | "createdAt" | "updatedAt">> {
  const fallback = buildRuleBasedRecommendation(input);
  try {
    const result = await generateAIContent({
      workspaceId: input.impactAnalysis.workspaceId,
      featureName: "ai-validation-recommendation",
      responseFormatJson: true,
      createdBy: input.createdBy,
      messages: [
        {
          role: "system",
          content: [
            "You are AI QA Copilot's enterprise QA validation advisor.",
            "Return only valid JSON.",
            "Base the recommendation only on the provided Playwright validation result and impact analysis context.",
            "Allowed releaseRecommendation values: Safe to Merge, Merge with Caution, Do Not Merge.",
            "Allowed mergeDecision values: Approved, Warning, Blocked.",
            "Allowed riskLevel values: Low, Medium, High.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify(buildRecommendationContext(input), null, 2),
        },
      ],
    });
    return {
      ...fallback,
      ...normalizeAIRecommendation(result.content, fallback),
      aiProvider: result.providerName,
      aiModel: result.modelName,
      status: input.status,
      createdBy: input.createdBy,
    };
  } catch {
    return {
      ...fallback,
      summary: "AI recommendation could not be generated. Validation result is still available.",
      reasons: [
        "The AI provider did not return a usable recommendation.",
        ...fallback.reasons,
      ].slice(0, 6),
      recommendedActions: [
        "Review the validation result manually before creating a pull request.",
        ...fallback.recommendedActions,
      ].slice(0, 6),
      status: "Failed",
      createdBy: input.createdBy,
    };
  }
}

function buildRecommendationContext(input: RecommendationInput) {
  return {
    expectedOutput: {
      confidenceScore: "number 0-100",
      releaseRecommendation: releaseRecommendations,
      riskLevel: riskLevels,
      summary: "short decision summary",
      reasons: ["specific validation or impact reason"],
      recommendedActions: ["actionable QA or automation action"],
      mergeDecision: mergeDecisions,
      qaOwnerAction: "single next best action for QA owner",
    },
    validation: {
      status: input.validationRun.status,
      totalTests: input.validationRun.totalTests,
      passed: input.validationRun.passed,
      failed: input.validationRun.failed,
      skipped: input.validationRun.skipped,
      duration: input.validationRun.duration,
      failedTestNames: input.validationRun.failedTestNames ?? [],
      failedTests: input.validationRun.failedTests ?? [],
      errorDetails: input.validationRun.errorDetails,
      stackTrace: input.validationRun.stackTrace,
      stdoutSummary: summarize(input.validationRun.stdout),
      stderrSummary: summarize(input.validationRun.stderr),
    },
    impactAnalysis: {
      changedFiles: input.impactAnalysis.changedFiles,
      impactedModules: input.impactAnalysis.impactedModules,
      impactedTests: input.impactAnalysis.impactedTests,
      riskLevel: input.impactAnalysis.riskLevel,
      confidenceScore: input.impactAnalysis.confidenceScore,
      recommendation: input.impactAnalysis.recommendation,
      repository: `${input.impactAnalysis.repoOwner}/${input.impactAnalysis.repoName}`,
      branch: input.impactAnalysis.branch,
      commitSha: input.impactAnalysis.commitSha,
    },
    generatedUpdates: input.updates.map((update) => ({
      testFilePath: update.testFilePath,
      status: update.status,
      updateSummary: update.updateSummary,
      impactReason: update.impactReason,
      confidenceScore: update.confidenceScore,
      riskLevel: update.riskLevel,
      suggestedAction: update.suggestedAction,
    })),
  };
}

function buildRuleBasedRecommendation(input: RecommendationInput): Omit<RepositoryValidationRecommendation, "id" | "createdAt" | "updatedAt"> {
  const failed = input.validationRun.failed > 0 || input.validationRun.status === "Failed" || input.validationRun.status === "Error";
  const skipped = input.validationRun.skipped > 0;
  const highRisk = input.impactAnalysis.riskLevel === "High" || input.impactAnalysis.impactedTests.some((test) => test.riskLevel === "High");
  const releaseRecommendation = failed ? "Do Not Merge" : skipped || highRisk ? "Merge with Caution" : "Safe to Merge";
  const mergeDecision = releaseRecommendation === "Safe to Merge" ? "Approved" : releaseRecommendation === "Merge with Caution" ? "Warning" : "Blocked";
  const riskLevel = failed || highRisk ? "High" : skipped ? "Medium" : "Low";
  return {
    workspaceId: input.impactAnalysis.workspaceId,
    projectId: input.impactAnalysis.projectId,
    impactAnalysisId: input.impactAnalysis.id,
    validationRunId: input.validationRun.id,
    confidenceScore: failed ? 92 : skipped || highRisk ? 84 : 94,
    releaseRecommendation,
    riskLevel,
    summary: failed
      ? "Validation failed for one or more impacted Playwright tests. Review failures before creating or merging a pull request."
      : releaseRecommendation === "Merge with Caution"
        ? "Validation passed, but the impacted area still carries risk and should receive focused QA review."
        : "Validation passed and the approved updates appear safe for pull request review.",
    reasons: [
      failed ? `${input.validationRun.failed} Playwright validation test(s) failed.` : "No Playwright validation failures were reported.",
      `${input.impactAnalysis.impactedTests.length} impacted Playwright test(s) were identified.`,
      `Impact analysis risk level is ${input.impactAnalysis.riskLevel}.`,
    ],
    recommendedActions: failed
      ? ["Review failed tests and error details.", "Regenerate or edit impacted updates.", "Run validation again before creating the PR."]
      : releaseRecommendation === "Merge with Caution"
        ? ["Review high-risk impacted tests.", "Confirm skipped tests are expected.", "Create PR for QA review after owner approval."]
        : ["Create the pull request.", "Ask QA reviewer to verify the generated changes.", "Merge only after normal repository review."],
    mergeDecision,
    qaOwnerAction: failed
      ? "Review failed tests and regenerate updates before creating PR."
      : releaseRecommendation === "Merge with Caution"
        ? "Review risk areas and approve PR creation if the skipped or high-risk items are acceptable."
        : "Proceed with PR creation and standard QA review.",
    aiProvider: "Rule-Based Fallback",
    aiModel: "validation-recommendation-rules",
    status: input.status,
    createdBy: input.createdBy,
  };
}

function normalizeAIRecommendation(content: string, fallback: ReturnType<typeof buildRuleBasedRecommendation>) {
  const parsed = parseJsonObject(content);
  return {
    confidenceScore: clampNumber(parsed.confidenceScore, fallback.confidenceScore),
    releaseRecommendation: oneOf(parsed.releaseRecommendation, releaseRecommendations, fallback.releaseRecommendation),
    riskLevel: oneOf(parsed.riskLevel, riskLevels, fallback.riskLevel),
    summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : fallback.summary,
    reasons: stringArray(parsed.reasons, fallback.reasons),
    recommendedActions: stringArray(parsed.recommendedActions, fallback.recommendedActions),
    mergeDecision: oneOf(parsed.mergeDecision, mergeDecisions, fallback.mergeDecision),
    qaOwnerAction: typeof parsed.qaOwnerAction === "string" && parsed.qaOwnerAction.trim() ? parsed.qaOwnerAction.trim() : fallback.qaOwnerAction,
  };
}

function parseJsonObject(content: string): Record<string, unknown> {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
    }
    return {};
  }
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function stringArray(value: unknown, fallback: string[]) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 8)
    : fallback;
}

function clampNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : fallback;
}

function summarize(value?: string) {
  if (!value) return "";
  return value.split(/\r?\n/).slice(0, 20).join("\n").slice(0, 4000);
}
