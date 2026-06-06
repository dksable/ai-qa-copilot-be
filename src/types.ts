export type TestFocus = "functional" | "api" | "ui" | "integration";
export type Priority = "High" | "Medium" | "Low";
export type RiskLevel = "Low" | "Medium" | "High";
export type ReleaseRecommendationStatus =
  | "Safe to Release"
  | "Release with Caution"
  | "Full Regression Testing Required";

export interface GenerateTestCasesInput {
  requirement: string;
  testType: TestFocus;
}

export interface TestCase {
  id: string;
  title: string;
  steps: string[];
  expected: string;
  priority: Priority;
}

export interface TestDataItem {
  field: string;
  valid: string[];
  invalid: string[];
  boundary: string[];
}

export interface RegressionArea {
  area: string;
  priority: Priority;
  coverage: string;
}

export interface RegressionImpactAnalysis {
  riskLevel: RiskLevel;
  riskScore: number;
  impactedModules: string[];
  regressionAreas: RegressionArea[];
  riskReason: string;
  qaFocusAreas: string[];
  releaseRecommendation: {
    status: ReleaseRecommendationStatus;
    reason: string;
  };
}

export type CoverageStatus = "Covered" | "Partial" | "Missing";
export type OverallCoverageStatus = "Excellent" | "Good" | "Fair" | "Poor";

export interface CoverageBreakdownItem {
  category: string;
  status: CoverageStatus;
  percentage: number;
}

export interface TestCoverageScoreAnalysis {
  coverageScore: number;
  coverageStatus: OverallCoverageStatus;
  totalGeneratedTestCases: number;
  coveredAreas: string[];
  missingAreas: string[];
  breakdown: CoverageBreakdownItem[];
  recommendations: string[];
}

export interface TestPlan {
  summary: string;
  acceptanceCriteria: string[];
  positive: TestCase[];
  negative: TestCase[];
  edge: TestCase[];
  testData: TestDataItem[];
  playwright: string;
  regressionImpact: RegressionImpactAnalysis;
  coverageAnalysis: TestCoverageScoreAnalysis;
}
