import type { AIProviderFeatureName, AIProviderType } from "./projectTypes.js";
import {
  createAIProviderUsageLog,
  resolveAIProviderForFeature,
} from "./projectStore.js";

export type AIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatOptions = {
  workspaceId: string;
  featureName: AIProviderFeatureName;
  messages: AIMessage[];
  responseFormatJson?: boolean;
  createdBy?: string;
};

type ChatResult = {
  content: string;
  providerType: AIProviderType;
  providerName: string;
  modelName: string;
};

type RuntimeProvider = Awaited<ReturnType<typeof resolveAIProviderForFeature>>;

function defaultModel() {
  return process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
}

function withoutTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function defaultOpenAICompatibleUrl(providerType: AIProviderType, baseUrl?: string) {
  if (baseUrl) return `${withoutTrailingSlash(baseUrl)}/chat/completions`;
  if (providerType === "openai") return "https://api.openai.com/v1/chat/completions";
  if (providerType === "openrouter") return "https://openrouter.ai/api/v1/chat/completions";
  if (providerType === "groq") return "https://api.groq.com/openai/v1/chat/completions";
  return "https://api.openai.com/v1/chat/completions";
}

async function callOpenAICompatible(provider: NonNullable<RuntimeProvider>, options: ChatOptions) {
  const apiKey = provider.apiKey || process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("AI provider API key is not configured.");
  const response = await fetch(defaultOpenAICompatibleUrl(provider.providerType, provider.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(provider.providerType === "openrouter"
        ? {
            "HTTP-Referer": "https://ai-qa-copilot.local",
            "X-Title": "AI QA Copilot",
          }
        : {}),
    },
    body: JSON.stringify({
      model: provider.modelName || defaultModel(),
      messages: options.messages,
      ...(options.responseFormatJson ? { response_format: { type: "json_object" } } : {}),
      temperature: provider.temperature ?? 0.2,
      max_tokens: provider.maxTokens ?? 4000,
    }),
  });
  if (!response.ok) throw new Error(`AI provider request failed with status ${response.status}.`);
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }>; usage?: { total_tokens?: number } };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI provider did not return message content.");
  return { content, tokenUsage: json.usage?.total_tokens };
}

async function callAzureOpenAI(provider: NonNullable<RuntimeProvider>, options: ChatOptions) {
  const apiKey = provider.apiKey;
  if (!apiKey || !provider.endpointUrl || !provider.deploymentName) {
    throw new Error("Azure OpenAI endpoint, deployment, and API key are required.");
  }
  const endpoint = withoutTrailingSlash(provider.endpointUrl);
  const apiVersion = provider.apiVersion || "2024-02-15-preview";
  const response = await fetch(
    `${endpoint}/openai/deployments/${encodeURIComponent(provider.deploymentName)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
    {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: options.messages,
        temperature: provider.temperature ?? 0.2,
        max_tokens: provider.maxTokens ?? 4000,
      }),
    },
  );
  if (!response.ok) throw new Error(`Azure OpenAI request failed with status ${response.status}.`);
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }>; usage?: { total_tokens?: number } };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Azure OpenAI did not return message content.");
  return { content, tokenUsage: json.usage?.total_tokens };
}

async function callAnthropic(provider: NonNullable<RuntimeProvider>, options: ChatOptions) {
  const apiKey = provider.apiKey;
  if (!apiKey) throw new Error("Anthropic API key is required.");
  const system = options.messages.find((message) => message.role === "system")?.content;
  const messages = options.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content }));
  const response = await fetch(`${withoutTrailingSlash(provider.baseUrl || "https://api.anthropic.com")}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.modelName,
      system,
      messages,
      temperature: provider.temperature ?? 0.2,
      max_tokens: provider.maxTokens ?? 4000,
    }),
  });
  if (!response.ok) throw new Error(`Claude request failed with status ${response.status}.`);
  const json = (await response.json()) as { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
  const content = json.content?.find((part) => part.type === "text")?.text;
  if (!content) throw new Error("Claude did not return text content.");
  return { content, tokenUsage: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0) };
}

async function callGemini(provider: NonNullable<RuntimeProvider>, options: ChatOptions) {
  const apiKey = provider.apiKey;
  if (!apiKey) throw new Error("Gemini API key is required.");
  const prompt = options.messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n");
  const baseUrl = withoutTrailingSlash(provider.baseUrl || "https://generativelanguage.googleapis.com/v1beta");
  const response = await fetch(
    `${baseUrl}/models/${encodeURIComponent(provider.modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: provider.temperature ?? 0.2,
          maxOutputTokens: provider.maxTokens ?? 4000,
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`Gemini request failed with status ${response.status}.`);
  const json = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { totalTokenCount?: number } };
  const content = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!content) throw new Error("Gemini did not return text content.");
  return { content, tokenUsage: json.usageMetadata?.totalTokenCount };
}

async function callProvider(provider: NonNullable<RuntimeProvider>, options: ChatOptions) {
  if (provider.providerType === "anthropic") return callAnthropic(provider, options);
  if (provider.providerType === "gemini") return callGemini(provider, options);
  if (provider.providerType === "azure-openai") return callAzureOpenAI(provider, options);
  return callOpenAICompatible(provider, options);
}

function defaultProvider() {
  const timestamp = new Date().toISOString();
  return {
    id: "default-ai-provider",
    workspaceId: "",
    providerType: "groq" as AIProviderType,
    providerName: "AI QA Copilot Default AI",
    modelName: defaultModel(),
    apiKey: process.env.GROQ_API_KEY || "",
    temperature: 0.2,
    maxTokens: 4000,
    isDefault: true,
    isActive: true,
    fallbackToDefault: true,
    createdBy: "AI QA Copilot",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function generateAIContent(options: ChatOptions): Promise<ChatResult> {
  const configured = await resolveAIProviderForFeature(options.workspaceId, options.featureName);
  const provider = configured ?? defaultProvider();
  try {
    const result = await callProvider(provider, options);
    await createAIProviderUsageLog({
      workspaceId: options.workspaceId,
      providerType: provider.providerType,
      providerName: provider.providerName,
      modelName: provider.modelName,
      featureName: options.featureName,
      tokenUsage: result.tokenUsage,
      status: "Success",
      createdBy: options.createdBy,
    });
    return {
      content: result.content,
      providerType: provider.providerType,
      providerName: provider.providerName,
      modelName: provider.modelName,
    };
  } catch (error) {
    await createAIProviderUsageLog({
      workspaceId: options.workspaceId,
      providerType: provider.providerType,
      providerName: provider.providerName,
      modelName: provider.modelName,
      featureName: options.featureName,
      status: "Failed",
      errorMessage: error instanceof Error ? error.message : "AI provider request failed.",
      createdBy: options.createdBy,
    });
    if (configured?.fallbackToDefault) {
      const fallback = defaultProvider();
      const result = await callProvider(fallback, options);
      await createAIProviderUsageLog({
        workspaceId: options.workspaceId,
        providerType: fallback.providerType,
        providerName: fallback.providerName,
        modelName: fallback.modelName,
        featureName: options.featureName,
        tokenUsage: result.tokenUsage,
        status: "Success",
        createdBy: options.createdBy,
      });
      return {
        content: result.content,
        providerType: fallback.providerType,
        providerName: fallback.providerName,
        modelName: fallback.modelName,
      };
    }
    throw error;
  }
}

export async function testAIProvider(provider: NonNullable<RuntimeProvider>, workspaceId: string, createdBy?: string) {
  const result = await callProvider(provider, {
    workspaceId,
    featureName: "ai-chat",
    createdBy,
    messages: [
      { role: "system", content: "You are testing an AI provider connection. Reply briefly." },
      { role: "user", content: "Reply with: AI provider connection successful." },
    ],
  });
  return result.content;
}
