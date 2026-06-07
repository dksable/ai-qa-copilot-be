import { z } from "zod";

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

export const TestPlanSchema = z.object({
  summary: z.string(),
  acceptanceCriteria: z.array(z.string()),
  positive: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      steps: z.array(z.string()),
      expected: z.string(),
      priority: z.enum(["High", "Medium", "Low"]),
    }),
  ),
  negative: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      steps: z.array(z.string()),
      expected: z.string(),
      priority: z.enum(["High", "Medium", "Low"]),
    }),
  ),
  edge: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      steps: z.array(z.string()),
      expected: z.string(),
      priority: z.enum(["High", "Medium", "Low"]),
    }),
  ),
  testData: z.array(
    z.object({
      field: z.string(),
      valid: z.array(z.string()),
      invalid: z.array(z.string()),
      boundary: z.array(z.string()),
    }),
  ),
  playwright: z.string(),
  regressionImpact: z.object({
    riskLevel: z.enum(["Low", "Medium", "High"]),
    riskScore: z.number(),
    impactedModules: z.array(z.string()),
    regressionAreas: z.array(
      z.object({
        area: z.string(),
        priority: z.enum(["High", "Medium", "Low"]),
        coverage: z.string(),
      }),
    ),
    riskReason: z.string(),
    qaFocusAreas: z.array(z.string()),
    releaseRecommendation: z.object({
      status: z.enum(["Safe to Release", "Release with Caution", "Full Regression Testing Required"]),
      reason: z.string(),
    }),
  }),
  coverageAnalysis: z.object({
    coverageScore: z.number(),
    coverageStatus: z.enum(["Excellent", "Good", "Fair", "Poor"]),
    totalGeneratedTestCases: z.number(),
    coveredAreas: z.array(z.string()),
    missingAreas: z.array(z.string()),
    breakdown: z.array(
      z.object({
        category: z.string(),
        status: z.enum(["Covered", "Partial", "Missing"]),
        percentage: z.number(),
      }),
    ),
    recommendations: z.array(z.string()),
  }),
});
