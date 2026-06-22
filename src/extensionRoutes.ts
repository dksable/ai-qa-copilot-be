import { type RequestHandler, Router } from "express";
import { z } from "zod";

import { generateAIContent } from "./aiProviderRouter.js";
import { generateTestPlanWithGroq } from "./groq.js";
import { listExtensionReports, saveExtensionReport } from "./projectStore.js";
import type { ExtensionPageData, ExtensionReportType } from "./projectTypes.js";

const router = Router();

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

const PageDataSchema = z.object({
  url: z.string().trim().min(1).max(3000),
  title: z.string().trim().max(300).default("Untitled page"),
  headings: z.array(z.string().max(300)).max(80).default([]),
  buttons: z.array(z.string().max(160)).max(120).default([]),
  inputs: z.array(z.object({
    type: z.string().max(80),
    name: z.string().max(160).optional(),
    id: z.string().max(160).optional(),
    placeholder: z.string().max(200).optional(),
    label: z.string().max(200).optional(),
  })).max(160).default([]),
  links: z.array(z.object({
    text: z.string().max(200),
    href: z.string().max(1000),
  })).max(160).default([]),
  forms: z.array(z.object({
    id: z.string().max(160).optional(),
    name: z.string().max(160).optional(),
    action: z.string().max(1000).optional(),
    method: z.string().max(20).optional(),
    inputs: z.number().int().min(0).max(500),
  })).max(80).default([]),
  visibleTextSummary: z.string().max(6000).default(""),
  domStructure: z.array(z.string().max(300)).max(200).default([]),
  capturedAt: z.string().optional(),
});

const PageRequestSchema = z.object({
  pageData: PageDataSchema,
});

const SaveReportSchema = z.object({
  type: z.enum([
    "analysis",
    "test-cases",
    "bug-report",
    "edge-cases",
    "playwright",
    "element-inspection",
    "screenshot-report",
    "chat",
    "console-analysis",
    "network-analysis",
    "accessibility",
    "performance",
    "regression",
    "release-summary",
  ]),
  pageData: PageDataSchema,
  output: z.unknown(),
});

const ElementContextSchema = z.object({
  html: z.string().max(8000),
  tagName: z.string().max(80),
  id: z.string().max(200).optional(),
  classes: z.array(z.string().max(160)).max(80).default([]),
  name: z.string().max(200).optional(),
  text: z.string().max(2000).optional(),
  placeholder: z.string().max(300).optional(),
  attributes: z.record(z.string()).default({}),
  xpath: z.string().max(1000),
  cssSelector: z.string().max(1000),
  parentHierarchy: z.array(z.string().max(300)).max(20).default([]),
  childHierarchy: z.array(z.string().max(300)).max(80).default([]),
  accessibility: z.record(z.string()).default({}),
  position: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
});

const ConsoleLogSchema = z.object({
  level: z.enum(["error", "warning", "exception", "info"]).default("error"),
  message: z.string().max(3000),
  stack: z.string().max(6000).optional(),
  timestamp: z.string().optional(),
});

const NetworkRequestSchema = z.object({
  url: z.string().max(3000),
  method: z.string().max(20).default("GET"),
  status: z.number().optional(),
  responseTime: z.number().optional(),
  requestHeaders: z.record(z.string()).optional(),
  responseHeaders: z.record(z.string()).optional(),
  type: z.string().optional(),
  error: z.string().optional(),
});

const AccessibilityFindingSchema = z.object({
  type: z.string().max(120),
  message: z.string().max(500),
  selector: z.string().max(1000).optional(),
  severity: z.enum(["Low", "Medium", "High"]).default("Medium"),
});

const PerformanceMetricSchema = z.object({
  lcp: z.number().optional(),
  cls: z.number().optional(),
  inp: z.number().optional(),
  fcp: z.number().optional(),
  ttfb: z.number().optional(),
  largeImages: z.array(z.string()).default([]),
  heavyJavaScript: z.array(z.string()).default([]),
  renderBlockingResources: z.array(z.string()).default([]),
  unusedCssCandidates: z.array(z.string()).default([]),
  lazyLoadingOpportunities: z.array(z.string()).default([]),
});

const GenericPageRequestSchema = PageRequestSchema.extend({
  extra: z.unknown().optional(),
});

const ElementInspectionRequestSchema = PageRequestSchema.extend({
  element: ElementContextSchema,
});

const ScreenshotReportRequestSchema = PageRequestSchema.extend({
  screenshotDataUrl: z.string().max(10_000_000),
  annotations: z.array(z.object({
    type: z.enum(["rectangle", "highlight", "arrow", "text"]),
    x: z.number(),
    y: z.number(),
    width: z.number().optional(),
    height: z.number().optional(),
    text: z.string().max(500).optional(),
    color: z.string().max(40).optional(),
  })).max(50).default([]),
  comment: z.string().max(2000).optional(),
});

const ChatRequestSchema = PageRequestSchema.extend({
  message: z.string().trim().min(1).max(3000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(6000),
  })).max(20).default([]),
});

const ConsoleAnalysisRequestSchema = PageRequestSchema.extend({
  logs: z.array(ConsoleLogSchema).max(200).default([]),
});

const NetworkAnalysisRequestSchema = PageRequestSchema.extend({
  requests: z.array(NetworkRequestSchema).max(300).default([]),
});

const AccessibilityRequestSchema = PageRequestSchema.extend({
  findings: z.array(AccessibilityFindingSchema).max(300).default([]),
});

const PerformanceRequestSchema = PageRequestSchema.extend({
  metrics: PerformanceMetricSchema,
});

function pageContext(pageData: ExtensionPageData) {
  return [
    `URL: ${pageData.url}`,
    `Title: ${pageData.title}`,
    `Headings: ${pageData.headings.join(" | ") || "None detected"}`,
    `Buttons: ${pageData.buttons.join(" | ") || "None detected"}`,
    `Inputs: ${pageData.inputs.map((input) => [input.label, input.placeholder, input.type].filter(Boolean).join(" / ")).join(" | ") || "None detected"}`,
    `Forms: ${pageData.forms.map((form) => `${form.method ?? "GET"} ${form.action ?? ""} (${form.inputs} inputs)`).join(" | ") || "None detected"}`,
    `Links: ${pageData.links.slice(0, 30).map((link) => link.text || link.href).join(" | ") || "None detected"}`,
    `DOM Structure: ${pageData.domStructure.slice(0, 80).join(" > ") || "None captured"}`,
    `Visible Text Summary: ${pageData.visibleTextSummary || "No visible text captured"}`,
  ].join("\n");
}

function parseJson(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : { summary: content };
  }
}

async function generateStructuredOutput(input: {
  pageData: ExtensionPageData;
  featureName: string;
  system: string;
  user: string;
  createdBy?: string;
}) {
  const result = await generateAIContent({
    workspaceId: "workspace_default",
    featureName: "test-generation",
    createdBy: input.createdBy,
    responseFormatJson: true,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: `${input.user}\n\nPage context:\n${pageContext(input.pageData)}` },
    ],
  });
  return {
    ...parseJson(result.content),
    aiModelUsed: `${result.providerName} / ${result.modelName}`,
  };
}

function reportResponse(type: ExtensionReportType, pageData: ExtensionPageData, output: unknown) {
  return {
    type,
    pageUrl: pageData.url,
    pageTitle: pageData.title,
    generatedAt: new Date().toISOString(),
    output,
  };
}

router.post("/extension/analyze-page", asyncRoute(async (request, response) => {
  const { pageData } = PageRequestSchema.parse(request.body);
  const output = await generateStructuredOutput({
    pageData,
    featureName: "extension-page-analysis",
    createdBy: request.userId,
    system: "You are a senior QA analyst. Return strict JSON only.",
    user: `Analyze this web page for QA coverage. Return:
{
  "summary": string,
  "pageType": string,
  "keyUserFlows": string[],
  "testableElements": string[],
  "qualityRisks": string[],
  "recommendedNextSteps": string[]
}`,
  });
  response.json(reportResponse("analysis", pageData, output));
}));

router.post("/extension/generate-test-cases", asyncRoute(async (request, response) => {
  const { pageData } = PageRequestSchema.parse(request.body);
  const plan = await generateTestPlanWithGroq({
    requirement: `Generate QA test cases for this live web page.\n\n${pageContext(pageData)}`,
    testType: "ui",
  }, { createdBy: request.userId });
  response.json(reportResponse("test-cases", pageData, plan));
}));

router.post("/extension/generate-edge-cases", asyncRoute(async (request, response) => {
  const { pageData } = PageRequestSchema.parse(request.body);
  const output = await generateStructuredOutput({
    pageData,
    featureName: "extension-edge-cases",
    createdBy: request.userId,
    system: "You are a senior QA architect. Return strict JSON only.",
    user: `Generate focused edge, validation, accessibility, and responsive cases. Return:
{
  "edgeCases": [{ "title": string, "scenario": string, "expectedResult": string, "priority": "High"|"Medium"|"Low" }],
  "validationCases": [{ "title": string, "scenario": string, "expectedResult": string }],
  "accessibilityCases": [{ "title": string, "check": string, "expectedResult": string }],
  "responsiveCases": [{ "title": string, "viewport": string, "expectedResult": string }]
}`,
  });
  response.json(reportResponse("edge-cases", pageData, output));
}));

router.post("/extension/generate-bug-report", asyncRoute(async (request, response) => {
  const { pageData } = PageRequestSchema.parse(request.body);
  const output = await generateStructuredOutput({
    pageData,
    featureName: "extension-bug-report",
    createdBy: request.userId,
    system: "You are a QA lead creating actionable bug report drafts. Return strict JSON only.",
    user: `Create likely bug report drafts based only on visible page structure. Return:
{
  "bugs": [{
    "bugTitle": string,
    "description": string,
    "stepsToReproduce": string[],
    "expectedResult": string,
    "actualResult": string,
    "severity": "Critical"|"High"|"Medium"|"Low",
    "priority": "High"|"Medium"|"Low"
  }]
}`,
  });
  response.json(reportResponse("bug-report", pageData, output));
}));

router.post("/extension/generate-playwright", asyncRoute(async (request, response) => {
  const { pageData } = PageRequestSchema.parse(request.body);
  const plan = await generateTestPlanWithGroq({
    requirement: `Generate a Playwright TypeScript test skeleton for this live page. Include stable locator suggestions and comments where manual update is needed.\n\n${pageContext(pageData)}`,
    testType: "ui",
  }, { createdBy: request.userId });
  response.json(reportResponse("playwright", pageData, {
    playwright: plan.playwright,
    locatorSuggestions: [
      "Prefer getByRole for buttons, links, tabs, and form controls.",
      "Prefer getByLabel for named inputs.",
      "Add data-testid attributes for dynamic or repeated elements.",
    ],
    aiModelUsed: plan.aiModelUsed,
  }));
}));

router.post("/extension/inspect-element", asyncRoute(async (request, response) => {
  const { pageData, element } = ElementInspectionRequestSchema.parse(request.body);
  const output = await generateStructuredOutput({
    pageData,
    featureName: "extension-element-inspector",
    createdBy: request.userId,
    system: "You are a senior QA automation architect inspecting a single DOM element. Return strict JSON only.",
    user: `Inspect this element and generate QA insight.

Element context:
${JSON.stringify(element, null, 2)}

Return:
{
  "summary": string,
  "functionalTestCases": [{ "title": string, "steps": string[], "expectedResult": string }],
  "negativeTestCases": [{ "title": string, "scenario": string, "expectedResult": string }],
  "edgeCases": [{ "title": string, "scenario": string, "expectedResult": string }],
  "validationChecks": string[],
  "accessibilityChecks": string[],
  "stablePlaywrightLocator": string,
  "riskAnalysis": { "riskLevel": "Low"|"Medium"|"High", "reasons": string[] },
  "testingSuggestions": string[]
}`,
  });
  response.json(reportResponse("element-inspection", pageData, output));
}));

router.post("/extension/screenshot-report", asyncRoute(async (request, response) => {
  const { pageData, annotations, comment } = ScreenshotReportRequestSchema.parse(request.body);
  const output = await generateStructuredOutput({
    pageData,
    featureName: "extension-screenshot-report",
    createdBy: request.userId,
    system: "You are a QA lead creating a visual bug report from screenshot annotations. Return strict JSON only.",
    user: `Generate a bug report from this screenshot metadata. Do not claim visual details that are not represented in metadata.

Annotations:
${JSON.stringify(annotations, null, 2)}

User comment:
${comment ?? "No comment provided"}

Return:
{
  "bugTitle": string,
  "description": string,
  "stepsToReproduce": string[],
  "expectedResult": string,
  "actualResult": string,
  "severity": "Critical"|"High"|"Medium"|"Low",
  "priority": "High"|"Medium"|"Low",
  "rootCauseGuess": string,
  "suggestedFix": string
}`,
  });
  response.json(reportResponse("screenshot-report", pageData, output));
}));

router.post("/extension/chat", asyncRoute(async (request, response) => {
  const { pageData, message, history } = ChatRequestSchema.parse(request.body);
  const result = await generateAIContent({
    workspaceId: "workspace_default",
    featureName: "test-generation",
    createdBy: request.userId,
    messages: [
      {
        role: "system",
        content: "You are AI QA Copilot inside a Chrome Extension. Answer based on the current page context. Be concise, practical, and QA-focused.",
      },
      ...history,
      {
        role: "user",
        content: `${message}\n\nCurrent page context:\n${pageContext(pageData)}`,
      },
    ],
  });
  response.json(reportResponse("chat", pageData, {
    message: result.content,
    aiModelUsed: `${result.providerName} / ${result.modelName}`,
  }));
}));

router.post("/extension/console-analysis", asyncRoute(async (request, response) => {
  const { pageData, logs } = ConsoleAnalysisRequestSchema.parse(request.body);
  const output = await generateStructuredOutput({
    pageData,
    featureName: "extension-console-analysis",
    createdBy: request.userId,
    system: "You are a senior frontend QA engineer analyzing browser console issues. Return strict JSON only.",
    user: `Analyze these console logs:
${JSON.stringify(logs, null, 2)}

Return:
{
  "summary": string,
  "issues": [{ "message": string, "rootCause": string, "severity": "Critical"|"High"|"Medium"|"Low", "possibleFix": string, "affectedFunctionality": string }],
  "recommendedTests": string[]
}`,
  });
  response.json(reportResponse("console-analysis", pageData, output));
}));

router.post("/extension/network-analysis", asyncRoute(async (request, response) => {
  const { pageData, requests } = NetworkAnalysisRequestSchema.parse(request.body);
  const output = await generateStructuredOutput({
    pageData,
    featureName: "extension-network-analysis",
    createdBy: request.userId,
    system: "You are a QA engineer analyzing API/network health. Return strict JSON only.",
    user: `Analyze these network requests:
${JSON.stringify(requests, null, 2)}

Highlight 500, 404, 401, timeout, slow API, and CORS risk. Return:
{
  "apiHealthSummary": string,
  "rootCauseAnalysis": string[],
  "failedRequests": [{ "url": string, "status": string, "risk": string }],
  "slowRequests": [{ "url": string, "responseTime": number, "recommendation": string }],
  "testingRecommendations": string[]
}`,
  });
  response.json(reportResponse("network-analysis", pageData, output));
}));

router.post("/extension/accessibility", asyncRoute(async (request, response) => {
  const { pageData, findings } = AccessibilityRequestSchema.parse(request.body);
  const output = await generateStructuredOutput({
    pageData,
    featureName: "extension-accessibility",
    createdBy: request.userId,
    system: "You are an accessibility QA specialist. Return strict JSON only.",
    user: `Analyze these accessibility findings:
${JSON.stringify(findings, null, 2)}

Return:
{
  "accessibilityScore": number,
  "wcagViolations": [{ "title": string, "severity": "Low"|"Medium"|"High", "recommendation": string }],
  "improvementSuggestions": string[],
  "keyboardTestingFocus": string[]
}`,
  });
  response.json(reportResponse("accessibility", pageData, output));
}));

router.post("/extension/performance", asyncRoute(async (request, response) => {
  const { pageData, metrics } = PerformanceRequestSchema.parse(request.body);
  const output = await generateStructuredOutput({
    pageData,
    featureName: "extension-performance",
    createdBy: request.userId,
    system: "You are a web performance QA analyst. Return strict JSON only.",
    user: `Analyze these performance metrics:
${JSON.stringify(metrics, null, 2)}

Return:
{
  "performanceScore": number,
  "coreWebVitalsSummary": string,
  "optimizationRecommendations": string[],
  "testingRecommendations": string[]
}`,
  });
  response.json(reportResponse("performance", pageData, output));
}));

router.post("/extension/regression", asyncRoute(async (request, response) => {
  const { pageData, extra } = GenericPageRequestSchema.parse(request.body);
  const output = await generateStructuredOutput({
    pageData,
    featureName: "extension-regression",
    createdBy: request.userId,
    system: "You are a regression QA lead comparing current page analysis with previous reports. Return strict JSON only.",
    user: `Generate regression insight using current page and previous report context:
${JSON.stringify(extra ?? {}, null, 2)}

Return:
{
  "regressionSummary": string,
  "riskScore": number,
  "newElements": string[],
  "removedElements": string[],
  "changedElements": string[],
  "recommendedRegressionTestCases": [{ "title": string, "scenario": string, "priority": "High"|"Medium"|"Low" }]
}`,
  });
  response.json(reportResponse("regression", pageData, output));
}));

router.post("/extension/playwright", asyncRoute(async (request, response) => {
  const { pageData, extra } = GenericPageRequestSchema.parse(request.body);
  const plan = await generateTestPlanWithGroq({
    requirement: `Generate production-ready Playwright TypeScript code for this page. Include stable locators, assertions, test data placeholders, Page Object suggestions, and comments where manual update is required.\n\nExtra context:\n${JSON.stringify(extra ?? {}, null, 2)}\n\n${pageContext(pageData)}`,
    testType: "ui",
  }, { createdBy: request.userId });
  response.json(reportResponse("playwright", pageData, {
    playwright: plan.playwright,
    pageObjectSuggestions: [
      "Create page object methods for primary user actions.",
      "Centralize selectors for repeated controls.",
      "Keep test data outside the spec file when flows grow.",
    ],
    assertions: plan.positive.slice(0, 4).map((testCase) => testCase.expected),
    aiModelUsed: plan.aiModelUsed,
  }));
}));

router.post("/extension/release-summary", asyncRoute(async (request, response) => {
  const { pageData, extra } = GenericPageRequestSchema.parse(request.body);
  const output = await generateStructuredOutput({
    pageData,
    featureName: "extension-release-summary",
    createdBy: request.userId,
    system: "You are a QA manager creating release readiness summaries. Return strict JSON only.",
    user: `Create a release readiness dashboard from page, accessibility, performance, console, network, and regression context:
${JSON.stringify(extra ?? {}, null, 2)}

Return:
{
  "overallQualityScore": number,
  "decision": "Release Ready"|"Needs Review",
  "testCoverage": number,
  "accessibilityScore": number,
  "performanceScore": number,
  "regressionRisk": "Low"|"Medium"|"High",
  "consoleHealth": "Good"|"Needs Review"|"Critical",
  "apiHealth": "Good"|"Needs Review"|"Critical",
  "reasoning": string,
  "recommendedActions": string[]
}`,
  });
  response.json(reportResponse("release-summary", pageData, output));
}));

router.post("/extension/save-report", asyncRoute(async (request, response) => {
  const input = SaveReportSchema.parse(request.body);
  const report = await saveExtensionReport({
    userId: request.userId,
    type: input.type,
    pageData: input.pageData,
    output: input.output,
  });
  response.status(201).json(report);
}));

router.get("/extension/reports", asyncRoute(async (request, response) => {
  response.json(await listExtensionReports(request.userId));
}));

export { router as extensionRouter };
