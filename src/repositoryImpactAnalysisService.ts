import type {
  RepositoryActivity,
  RepositoryImpactAnalysis,
  RepositoryImpactAnalysisSuggestion,
  RepositoryImpactAnalysisTest,
  RepositoryRiskLevel,
  RepositoryAnalysis,
} from "./projectTypes.js";

function titleCase(value: string) {
  return value
    .replace(/[-_.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function moduleFromPath(filePath: string) {
  const lower = filePath.toLowerCase();
  const known = ["auth", "login", "checkout", "payment", "dashboard", "registration", "profile", "settings", "api", "search"];
  const found = known.find((item) => lower.includes(item));
  if (found) return titleCase(found);
  const parts = filePath.split("/").filter(Boolean);
  const filename = parts.at(-1)?.replace(/\.[^.]+$/, "") ?? filePath;
  if (parts.includes("pages") || parts.includes("routes")) return titleCase(filename);
  if (parts.includes("components") && parts.length > 1) return titleCase(filename.replace(/(Form|View|Page|Component)$/i, ""));
  return titleCase(parts.at(-2) ?? filename);
}

function riskRank(risk: RepositoryRiskLevel) {
  return risk === "High" ? 3 : risk === "Medium" ? 2 : 1;
}

function highestRisk(risks: RepositoryRiskLevel[]) {
  return risks.sort((a, b) => riskRank(b) - riskRank(a))[0] ?? "Low";
}

function riskFromChangedFile(filePath: string, patch?: string): RepositoryRiskLevel {
  const value = `${filePath}\n${patch ?? ""}`;
  if (/auth|login|permission|checkout|payment|routing|route|api|config|token|security|role/i.test(value)) return "High";
  if (/components?|pages?|forms?|validation|state|store|hook|service/i.test(value)) return "Medium";
  return "Low";
}

function suggestedActionForRisk(risk: RepositoryRiskLevel): RepositoryImpactAnalysisTest["suggestedAction"] {
  if (risk === "High") return "Update Test";
  if (risk === "Medium") return "Review Manually";
  return "No Action";
}

function testFileForModule(moduleName: string, analysis: RepositoryAnalysis | null, automationConfig: { testFolderPath: string } | null) {
  const folder = analysis?.testFolderPath || automationConfig?.testFolderPath || "tests/e2e";
  const extension = analysis?.language === "JavaScript" ? "js" : "ts";
  const slug = moduleName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "generated";
  return `${folder.replace(/^\/+|\/+$/g, "")}/${slug}.spec.${extension}`;
}

function confidenceForMapping(filePath: string, moduleName: string, analysis: RepositoryAnalysis | null) {
  let confidence = 62;
  const pathToken = normalizeToken(filePath);
  const moduleToken = normalizeToken(moduleName);
  if (pathToken.includes(moduleToken)) confidence += 18;
  if (analysis?.confidenceScore) confidence += Math.min(15, Math.round(analysis.confidenceScore / 8));
  if (/pages?|routes?|api|components?/i.test(filePath)) confidence += 8;
  return Math.min(96, confidence);
}

function buildSuggestion(input: {
  title: string;
  description: string;
  category: RepositoryImpactAnalysisSuggestion["category"];
  priority: RepositoryRiskLevel;
  relatedTestFile?: string;
  relatedChangedFile?: string;
}): RepositoryImpactAnalysisSuggestion {
  return input;
}

export function analyzeRepositoryImpact(input: {
  activity: RepositoryActivity;
  automationConfig: { id: string; testFolderPath: string } | null;
  repositoryAnalysis: RepositoryAnalysis | null;
  createdBy?: string;
}): Omit<RepositoryImpactAnalysis, "id" | "createdAt" | "updatedAt"> {
  const changedFiles = input.activity.changedFiles.map((file) => ({
    ...file,
    riskLevel: file.riskLevel ?? riskFromChangedFile(file.filePath, file.patch),
    possibleModule: file.possibleModule ?? moduleFromPath(file.filePath),
  }));
  const impactedModules = Array.from(new Set(changedFiles.map((file) => file.possibleModule || moduleFromPath(file.filePath))));
  const impactedTests: RepositoryImpactAnalysisTest[] = changedFiles.map((file) => {
    const moduleName = file.possibleModule || moduleFromPath(file.filePath);
    const riskLevel = file.riskLevel ?? riskFromChangedFile(file.filePath, file.patch);
    const testFilePath = testFileForModule(moduleName, input.repositoryAnalysis, input.automationConfig);
    const confidenceScore = confidenceForMapping(file.filePath, moduleName, input.repositoryAnalysis);
    return {
      testFilePath,
      relatedChangedFile: file.filePath,
      impactReason: `${moduleName} changed in ${file.filePath}; related regression coverage should be reviewed.`,
      suggestedAction: suggestedActionForRisk(riskLevel),
      riskLevel,
      confidenceScore,
    };
  });

  const suggestions: RepositoryImpactAnalysisSuggestion[] = [];
  changedFiles.forEach((file) => {
    const riskLevel = file.riskLevel ?? "Low";
    const moduleName = file.possibleModule || moduleFromPath(file.filePath);
    const testFile = testFileForModule(moduleName, input.repositoryAnalysis, input.automationConfig);
    if (/api|service|endpoint/i.test(file.filePath)) {
      suggestions.push(buildSuggestion({
        title: "Validate API response coverage",
        description: `Review API assertions and error handling around ${moduleName}.`,
        category: "API",
        priority: riskLevel,
        relatedTestFile: testFile,
        relatedChangedFile: file.filePath,
      }));
    } else if (/form|input|component|page|view|tsx|jsx/i.test(file.filePath)) {
      suggestions.push(buildSuggestion({
        title: "Review UI automation flow",
        description: `Check locators, visible text, and expected results for ${moduleName}.`,
        category: "UI",
        priority: riskLevel,
        relatedTestFile: testFile,
        relatedChangedFile: file.filePath,
      }));
    }
    if (/auth|login|checkout|payment|role|permission/i.test(file.filePath)) {
      suggestions.push(buildSuggestion({
        title: "Add regression coverage for high-risk flow",
        description: `${moduleName} is a high-impact area. Add or update positive, negative, and edge regression tests.`,
        category: "Regression",
        priority: "High",
        relatedTestFile: testFile,
        relatedChangedFile: file.filePath,
      }));
    }
    if (/fixture|seed|data|schema|model/i.test(file.filePath)) {
      suggestions.push(buildSuggestion({
        title: "Update fixture and test data",
        description: `Review test data dependencies for ${moduleName}.`,
        category: "Data",
        priority: riskLevel,
        relatedTestFile: testFile,
        relatedChangedFile: file.filePath,
      }));
    }
  });
  if (!suggestions.length && changedFiles.length) {
    suggestions.push(buildSuggestion({
      title: "Review impacted manual test coverage",
      description: "Changed files were detected. Review related manual test cases before release.",
      category: "Manual Testing",
      priority: highestRisk(changedFiles.map((file) => file.riskLevel ?? "Low")),
      relatedChangedFile: changedFiles[0].filePath,
    }));
  }

  const riskLevel = highestRisk(changedFiles.map((file) => file.riskLevel ?? "Low"));
  const averageConfidence = impactedTests.length
    ? Math.round(impactedTests.reduce((sum, test) => sum + test.confidenceScore, 0) / impactedTests.length)
    : 55;
  const recommendation = riskLevel === "High"
    ? "Update impacted Playwright tests before the next release."
    : riskLevel === "Medium"
      ? "Review impacted tests and add targeted regression coverage where needed."
      : "Review changes during normal QA regression planning.";

  return {
    workspaceId: input.activity.workspaceId,
    projectId: input.activity.projectId,
    repositoryActivityId: input.activity.id,
    applicationRepositoryId: input.activity.repositoryConfigId,
    automationRepositoryId: input.automationConfig?.id,
    provider: "github",
    repoOwner: input.activity.repoOwner,
    repoName: input.activity.repoName,
    branch: input.activity.branch,
    commitSha: input.activity.commitSha,
    changedFiles,
    impactedModules,
    impactedTests,
    suggestions,
    riskLevel,
    confidenceScore: averageConfidence,
    recommendation,
    status: "Completed",
    createdBy: input.createdBy,
  };
}
