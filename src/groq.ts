import { z } from "zod";

import { generateAIContent } from "./aiProviderRouter.js";
import { generateTestCoverageScoreAnalysis } from "./coverageScore.js";
import { generateRegressionImpactAnalysis } from "./regressionImpact.js";
import type { GenerateTestCasesInput, TestCase, TestPlan } from "./types.js";

const PrioritySchema = z.enum(["High", "Medium", "Low"]);

const TestCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  steps: z.array(z.string()).min(1),
  expected: z.string(),
  priority: PrioritySchema,
});

const TestDataItemSchema = z.object({
  field: z.string(),
  valid: z.array(z.string()),
  invalid: z.array(z.string()),
  boundary: z.array(z.string()),
});

const AiTestPlanSchema = z.object({
  summary: z.string(),
  acceptanceCriteria: z.array(z.string()).min(1),
  positive: z.array(TestCaseSchema).min(1),
  negative: z.array(TestCaseSchema).min(1),
  edge: z.array(TestCaseSchema).min(1),
  testData: z.array(TestDataItemSchema),
  playwright: z.string().optional(),
});

const SYSTEM_PROMPT = `You are a senior QA architect. Given a user story, requirement, or acceptance criteria, generate a comprehensive, professional test plan.

Return STRICT JSON only with this exact shape:
{
  "summary": string,
  "acceptanceCriteria": string[],
  "positive": [{ "id": "TC-P-01", "title": string, "steps": string[], "expected": string, "priority": "High"|"Medium"|"Low" }],
  "negative": [{ "id": "TC-N-01", "title": string, "steps": string[], "expected": string, "priority": "High"|"Medium"|"Low" }],
  "edge": [{ "id": "TC-E-01", "title": string, "steps": string[], "expected": string, "priority": "High"|"Medium"|"Low" }],
  "testData": [{ "field": string, "valid": string[], "invalid": string[], "boundary": string[] }],
  "playwright": string
}

Rules:
- Create 4-6 positive cases, 4-6 negative cases, and 3-5 edge cases.
- Steps should be tester-friendly numbered actions.
- Playwright code must be valid TypeScript using @playwright/test with imports and expect assertions.
- Do not include markdown fences, comments outside JSON, or backticks around the JSON.`;

function sanitizeForTestName(value: string) {
  return value.replace(/\s+/g, " ").replace(/"/g, "'").trim();
}

function buildPlaywrightSkeleton(input: GenerateTestCasesInput, cases: TestCase[]) {
  const selectedCases = cases.slice(0, 3);
  const requirementPreview = input.requirement.split(/\s+/).slice(0, 14).join(" ");
  const testBlocks = selectedCases
    .map((testCase, index) => {
      const title = sanitizeForTestName(testCase.title || `Generated flow ${index + 1}`);
      return `  test(${JSON.stringify(title)}, async ({ page }) => {
    await page.goto("/");
    await page.getByLabel(/requirement|user story/i).fill(${JSON.stringify(requirementPreview)});
    await page.getByRole("button", { name: /generate/i }).click();

    await expect(page.getByText(/Generated Test Plan/i)).toBeVisible();
    await expect(page.getByText(${JSON.stringify(testCase.id)})).toBeVisible();
  });`;
    })
    .join("\n\n");

  return `import { test, expect } from "@playwright/test";

test.describe(${JSON.stringify(`${input.testType} generated test plan`)}, () => {
${testBlocks}

  test("shows validation when requirement is missing", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /generate/i }).click();

    await expect(page.getByText(/at least 10 characters/i)).toBeVisible();
  });
});`;
}

function parseJsonContent(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("AI returned malformed JSON.");
    }
    return JSON.parse(match[0]);
  }
}

export async function generateTestPlanWithGroq(
  input: GenerateTestCasesInput,
  options: { workspaceId?: string; createdBy?: string } = {},
): Promise<TestPlan & { aiModelUsed?: string }> {
  const userPrompt = `Test focus: ${input.testType}

Requirement / User Story:
${input.requirement}`;

  const result = await generateAIContent({
    workspaceId: options.workspaceId ?? "workspace_default",
    featureName: "test-generation",
    createdBy: options.createdBy,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    responseFormatJson: true,
  });

  const parsed = AiTestPlanSchema.parse(parseJsonContent(result.content));
  return {
    ...parsed,
    aiModelUsed: `${result.providerName} / ${result.modelName}`,
    playwright: buildPlaywrightSkeleton(input, [...parsed.positive, ...parsed.negative]),
    regressionImpact: generateRegressionImpactAnalysis(input.requirement),
    coverageAnalysis: generateTestCoverageScoreAnalysis({
      requirement: input.requirement,
      positive: parsed.positive,
      negative: parsed.negative,
      edge: parsed.edge,
      testData: parsed.testData,
    }),
  };
}
