import type { AIChatMessage, Project, ProjectModule, Requirement, TestCaseHistoryRecord } from "./projectTypes.js";

type GroqChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

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

export async function generateAIChatResponse(context: AIChatContext, userMessage: string) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured on the backend.");
  }

  const model = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
  const messages = [
    {
      role: "system",
      content:
        "You are AI QA Copilot, a senior QA assistant. Answer only using the selected requirement context. If context is missing, clearly state what is missing. Provide concise, actionable QA guidance. Use markdown tables or code blocks when helpful. Do not claim to update stored test cases unless the user explicitly saves a new version.",
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
  ];

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Groq chat error:", response.status, errorBody);
    throw new Error("AI chat response failed.");
  }

  const json = (await response.json()) as GroqChatCompletionResponse;
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("AI chat response did not include message content.");
  }
  return content;
}
