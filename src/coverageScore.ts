import type { TestCase, TestDataItem, TestCoverageScoreAnalysis } from "./types.js";

type CoverageStatus = "Covered" | "Partial" | "Missing";

const containsAny = (source: string, keywords: string[]) =>
  keywords.some((keyword) => source.includes(keyword));

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function getCoverageStatus(score: number) {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 50) return "Fair";
  return "Poor";
}

function getCoverageStatusFromPercentage(percentage: number): CoverageStatus {
  if (percentage >= 85) return "Covered";
  if (percentage > 0) return "Partial";
  return "Missing";
}

export function generateTestCoverageScoreAnalysis({
  requirement,
  positive,
  negative,
  edge,
  testData,
}: {
  requirement: string;
  positive: TestCase[];
  negative: TestCase[];
  edge: TestCase[];
  testData: TestDataItem[];
}): TestCoverageScoreAnalysis {
  const normalizedRequirement = requirement.toLowerCase();
  const allText = [
    requirement,
    ...positive.flatMap((item) => [item.title, item.expected, ...item.steps]),
    ...negative.flatMap((item) => [item.title, item.expected, ...item.steps]),
    ...edge.flatMap((item) => [item.title, item.expected, ...item.steps]),
    ...testData.flatMap((item) => [item.field, ...item.valid, ...item.invalid, ...item.boundary]),
  ]
    .join(" ")
    .toLowerCase();

  const totalGeneratedTestCases = positive.length + negative.length + edge.length;
  const isAuthRequirement = containsAny(normalizedRequirement, [
    "login",
    "otp",
    "authentication",
    "password",
    "session",
    "token",
  ]);
  const isApiRequirement = containsAny(normalizedRequirement, ["api", "endpoint", "response"]);

  const happyPath = positive.length >= 4 ? 100 : positive.length >= 2 ? 80 : 50;
  const validation =
    negative.length >= 4 || containsAny(allText, ["invalid", "validation", "required"]) ? 95 : 65;
  const errorHandling = containsAny(allText, ["error", "failure", "invalid", "unauthorized"])
    ? 90
    : 55;
  const edgeCases = edge.length >= 4 ? 85 : edge.length >= 2 ? 70 : 35;
  const security = isAuthRequirement
    ? containsAny(allText, ["session", "otp", "password", "token", "lock", "unauthorized"])
      ? 70
      : 45
    : 50;
  const apiValidation =
    isApiRequirement || containsAny(allText, ["api", "response", "request"]) ? 75 : 45;
  const accessibility = containsAny(allText, ["accessibility", "aria", "keyboard", "screen reader"])
    ? 70
    : 0;
  const performance = containsAny(allText, ["performance", "timeout", "latency", "load"]) ? 60 : 0;
  const browserCompatibility = containsAny(allText, ["browser", "chrome", "firefox", "safari"])
    ? 70
    : 0;
  const concurrency = containsAny(allText, ["concurrent", "multiple users", "parallel"]) ? 65 : 0;

  const breakdown = [
    {
      category: "Happy Path",
      percentage: happyPath,
      status: getCoverageStatusFromPercentage(happyPath),
    },
    {
      category: "Validation",
      percentage: validation,
      status: getCoverageStatusFromPercentage(validation),
    },
    {
      category: "Error Handling",
      percentage: errorHandling,
      status: getCoverageStatusFromPercentage(errorHandling),
    },
    {
      category: "Edge Cases",
      percentage: edgeCases,
      status: getCoverageStatusFromPercentage(edgeCases),
    },
    {
      category: "Security",
      percentage: security,
      status: getCoverageStatusFromPercentage(security),
    },
    {
      category: "API Response Validation",
      percentage: apiValidation,
      status: getCoverageStatusFromPercentage(apiValidation),
    },
    {
      category: "Accessibility",
      percentage: accessibility,
      status: getCoverageStatusFromPercentage(accessibility),
    },
    {
      category: "Performance",
      percentage: performance,
      status: getCoverageStatusFromPercentage(performance),
    },
    {
      category: "Browser Compatibility",
      percentage: browserCompatibility,
      status: getCoverageStatusFromPercentage(browserCompatibility),
    },
    {
      category: "Concurrent User Actions",
      percentage: concurrency,
      status: getCoverageStatusFromPercentage(concurrency),
    },
  ];

  const coveredAreas = breakdown
    .filter((item) => item.status === "Covered")
    .map((item) => item.category);
  const missingAreas = breakdown
    .filter((item) => item.status === "Missing")
    .map((item) => item.category);
  const partialAreas = breakdown
    .filter((item) => item.status === "Partial")
    .map((item) => item.category);
  const coverageScore = clamp(
    (happyPath * 1.3 +
      validation * 1.2 +
      errorHandling * 1.1 +
      edgeCases +
      security +
      apiValidation +
      accessibility * 0.7 +
      performance * 0.7 +
      browserCompatibility * 0.7 +
      concurrency * 0.7) /
      8.6,
  );
  const recommendations = [
    ...(missingAreas.includes("Accessibility")
      ? [
          "Add accessibility validation scenarios for keyboard navigation, ARIA labels, and screen reader behavior.",
        ]
      : []),
    ...(missingAreas.includes("Performance")
      ? ["Add performance and timeout test cases for slow responses and large payloads."]
      : []),
    ...(missingAreas.includes("Browser Compatibility")
      ? [
          "Add browser compatibility coverage for Chrome, Firefox, Safari, and responsive device sizes.",
        ]
      : []),
    ...(missingAreas.includes("Concurrent User Actions")
      ? ["Add concurrent user action scenarios to verify duplicate submits and race conditions."]
      : []),
    ...(partialAreas.includes("Security")
      ? ["Add session expiry, authorization, and security validation test cases."]
      : []),
    ...(partialAreas.includes("API Response Validation")
      ? ["Add API timeout, failed response, and schema validation test cases."]
      : []),
    ...(partialAreas.includes("Edge Cases")
      ? ["Add more boundary condition and unusual input scenarios."]
      : []),
  ];

  if (!recommendations.length) {
    recommendations.push(
      "Review business-critical workflows with QA before release to confirm no domain-specific scenarios are missing.",
    );
  }

  return {
    coverageScore,
    coverageStatus: getCoverageStatus(coverageScore),
    totalGeneratedTestCases,
    coveredAreas,
    missingAreas,
    breakdown,
    recommendations,
  };
}
