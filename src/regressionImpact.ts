import type { RegressionImpactAnalysis } from "./types.js";

const containsAny = (source: string, keywords: string[]) =>
  keywords.some((keyword) => source.includes(keyword));

export function generateRegressionImpactAnalysis(requirement: string): RegressionImpactAnalysis {
  const normalizedRequirement = requirement.toLowerCase();

  if (
    containsAny(normalizedRequirement, [
      "login",
      "otp",
      "authentication",
      "auth",
      "password",
      "session",
      "signin",
      "sign in",
      "access token",
    ])
  ) {
    return {
      riskLevel: "High",
      riskScore: 85,
      impactedModules: [
        "Login",
        "Registration",
        "Forgot Password",
        "Session Management",
        "Dashboard Access",
        "Authentication API",
      ],
      regressionAreas: [
        {
          area: "Existing email/password login",
          priority: "High",
          coverage: "Verify existing login flow still works.",
        },
        {
          area: "Forgot password flow",
          priority: "Medium",
          coverage: "Verify reset password request, reset link handling, and password update.",
        },
        {
          area: "Session timeout",
          priority: "High",
          coverage: "Verify session expiry, auto logout, and re-authentication behavior.",
        },
        {
          area: "Dashboard access",
          priority: "High",
          coverage: "Verify authenticated users can access dashboard pages after login.",
        },
      ],
      riskReason:
        "Authentication changes impact multiple user access, session, and dashboard-related workflows.",
      qaFocusAreas: [
        "Login validation",
        "OTP validation",
        "Session management",
        "Authentication API",
        "Dashboard authorization",
        "Error handling",
        "Expired OTP handling",
        "Resend OTP flow",
      ],
      releaseRecommendation: {
        status: "Full Regression Testing Required",
        reason:
          "This requirement affects authentication and session-related flows, so full regression testing is required before release.",
      },
    };
  }

  if (
    containsAny(normalizedRequirement, [
      "profile",
      "user details",
      "user detail",
      "account details",
      "personal information",
      "avatar",
      "preferences",
    ])
  ) {
    return {
      riskLevel: "Medium",
      riskScore: 58,
      impactedModules: [
        "User Profile",
        "Account Settings",
        "User Details API",
        "Dashboard Header",
        "Profile Validation",
      ],
      regressionAreas: [
        {
          area: "Profile update flow",
          priority: "High",
          coverage: "Verify users can update and save profile details successfully.",
        },
        {
          area: "Profile data validation",
          priority: "Medium",
          coverage: "Verify required, invalid, and boundary profile field values.",
        },
        {
          area: "Dashboard profile display",
          priority: "Medium",
          coverage: "Verify updated user details appear correctly across dashboard surfaces.",
        },
      ],
      riskReason:
        "Profile changes usually affect account data, validation, and profile displays across several user-facing screens.",
      qaFocusAreas: [
        "Profile form validation",
        "User details persistence",
        "Avatar or display name rendering",
        "Account settings compatibility",
        "Dashboard profile display",
      ],
      releaseRecommendation: {
        status: "Release with Caution",
        reason:
          "Profile and account detail flows are impacted, so targeted regression testing is recommended before release.",
      },
    };
  }

  if (
    containsAny(normalizedRequirement, [
      "ui text",
      "label",
      "color",
      "minor copy",
      "copy",
      "text change",
      "wording",
      "style",
    ])
  ) {
    return {
      riskLevel: "Low",
      riskScore: 24,
      impactedModules: ["UI Components", "Content Labels", "Visual Styling"],
      regressionAreas: [
        {
          area: "Updated UI text or labels",
          priority: "Low",
          coverage: "Verify copy, labels, and helper text render correctly.",
        },
        {
          area: "Visual style consistency",
          priority: "Low",
          coverage: "Verify color, spacing, and component states remain visually consistent.",
        },
        {
          area: "Responsive layout",
          priority: "Medium",
          coverage: "Verify the updated UI remains readable on mobile and desktop.",
        },
      ],
      riskReason:
        "The change appears limited to presentation or copy updates with low functional impact.",
      qaFocusAreas: [
        "Copy review",
        "Visual regression check",
        "Responsive layout",
        "Accessibility labels",
      ],
      releaseRecommendation: {
        status: "Safe to Release",
        reason:
          "The requirement appears UI-only, so a focused smoke test and visual check should be sufficient.",
      },
    };
  }

  return {
    riskLevel: "Medium",
    riskScore: 50,
    impactedModules: ["Core Workflow", "Validation", "API Contract", "User Navigation"],
    regressionAreas: [
      {
        area: "Primary user workflow",
        priority: "High",
        coverage: "Verify the main happy path still works end to end.",
      },
      {
        area: "Validation and error handling",
        priority: "Medium",
        coverage: "Verify invalid input, missing data, and recoverable errors.",
      },
      {
        area: "Existing navigation paths",
        priority: "Medium",
        coverage: "Verify users can access related screens without broken transitions.",
      },
    ],
    riskReason:
      "The requirement may affect shared workflow behavior, validation, or related user journeys.",
    qaFocusAreas: [
      "Primary workflow",
      "Validation rules",
      "Error handling",
      "Related navigation",
      "Data persistence",
    ],
    releaseRecommendation: {
      status: "Release with Caution",
      reason:
        "The impacted area is not fully isolated, so targeted regression testing should be completed before release.",
    },
  };
}
