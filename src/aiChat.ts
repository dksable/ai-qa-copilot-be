import type { AIChatMessage, Project, ProjectModule, Requirement, TestCaseHistoryRecord } from "./projectTypes.js";
import { generateAIContent } from "./aiProviderRouter.js";

export interface AIChatContext {
  project: Project;
  module: ProjectModule;
  requirement: Requirement;
  history?: TestCaseHistoryRecord;
  previousMessages: AIChatMessage[];
}

function buildContextBlock(context: AIChatContext) {
  const history = context.history;
  return `Project: ${context.project.name}
Module: ${context.module.name}
Requirement Title: ${context.requirement.title}
Requirement Description:
${context.requirement.description}

Acceptance Criteria:
${context.requirement.acceptanceCriteria || history?.output.acceptanceCriteria.join("\n") || "Not provided"}

Existing Positive Test Cases:
${history?.output.positive.map((testCase) => `${testCase.id}: ${testCase.title} - ${testCase.expected}`).join("\n") || "Not available"}

Existing Negative Test Cases:
${history?.output.negative.map((testCase) => `${testCase.id}: ${testCase.title} - ${testCase.expected}`).join("\n") || "Not available"}

Existing Edge Cases:
${history?.output.edge.map((testCase) => `${testCase.id}: ${testCase.title} - ${testCase.expected}`).join("\n") || "Not available"}

Test Data Suggestions:
${history?.output.testData.map((item) => `${item.field}: valid=${item.valid.join(", ")}; invalid=${item.invalid.join(", ")}; boundary=${item.boundary.join(", ")}`).join("\n") || "Not available"}

Coverage Score:
${history ? `${history.coverageScore}%` : "Not available"}

Playwright Skeleton:
${history?.output.playwright || "Not available"}`;
}

function isPlaywrightRequest(message: string) {
  return /\b(playwright|playwrite|e2e|automation|automated test|browser test)\b/i.test(message);
}

function includesPlaywrightCode(content: string) {
  return /@playwright\/test|import\s+\{\s*test\s*,\s*expect\s*\}|test\.describe|page\.goto/i.test(content);
}

function safeTestName(value: string) {
  return value.replace(/\s+/g, " ").replace(/"/g, "'").trim();
}

function buildFallbackPlaywright(context: AIChatContext) {
  if (context.history?.output.playwright) return context.history.output.playwright;

  const requirementTitle = safeTestName(context.requirement.title || "Selected requirement");
  const requirementText = context.requirement.description || context.requirement.title;
  const preview = requirementText.split(/\s+/).slice(0, 18).join(" ");

  return `import { test, expect } from "@playwright/test";

test.describe(${JSON.stringify(requirementTitle)}, () => {
  test("validates the primary requirement flow", async ({ page }) => {
    await page.goto("/");

    await page.getByLabel(/requirement|user story|description/i).fill(${JSON.stringify(preview)});
    await page.getByRole("button", { name: /generate|submit|save/i }).click();

    await expect(page.getByText(/success|generated|saved|completed/i)).toBeVisible();
  });

  test("shows validation for missing required input", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /generate|submit|save/i }).click();

    await expect(page.getByText(/required|invalid|at least/i)).toBeVisible();
  });
});`;
}

function ensurePlaywrightResponse(context: AIChatContext, userMessage: string, aiResponse: string) {
  if (!isPlaywrightRequest(userMessage) || includesPlaywrightCode(aiResponse)) return aiResponse;

  const skeleton = buildFallbackPlaywright(context);
  return `${aiResponse.trim()}

### Playwright Test Skeleton

\`\`\`ts
${skeleton}
\`\`\``;
}

export async function generateAIChatResponse(context: AIChatContext, userMessage: string, createdBy?: string) {
  const messages = [
    {
      role: "system",
      content:
        "You are AI QA Copilot, a senior QA assistant. Answer only using the selected requirement context. If context is missing, clearly state what is missing. Provide concise, actionable QA guidance. Use markdown tables or code blocks when helpful. When the user asks for Playwright tests, include a valid TypeScript code block using @playwright/test with import { test, expect } from \"@playwright/test\". Do not claim to update stored test cases unless the user explicitly saves a new version.",
    },
    {
      role: "user",
      content: `Selected requirement context:\n\n${buildContextBlock(context)}`,
    },
    ...context.previousMessages.slice(-10).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    {
      role: "user",
      content: userMessage,
    },
  ] satisfies Array<{ role: "system" | "user" | "assistant"; content: string }>;

  const result = await generateAIContent({
    workspaceId: context.project.workspaceId,
    featureName: isPlaywrightRequest(userMessage) ? "playwright-generation" : "ai-chat",
    createdBy,
    messages,
  });
  return ensurePlaywrightResponse(context, userMessage, result.content);
}
