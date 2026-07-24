export interface InlineComment {
  path: string;
  line: number;
  comment: string;
  category: "bug" | "security" | "style" | "performance" | "info";
  severity: "low" | "medium" | "high" | "critical";
}

export interface ReviewSummary {
  passed: boolean;
  overallScore: number;
  summary: string;
  highlights: {
    bugs: string[];
    securityRisks: string[];
    styleImprovements: string[];
  };
  inlineComments: InlineComment[];
}

export interface AIReviewerOptions {
  diff?: string;
  filesChanged?: Array<{ path: string; content: string }>;
  apiKey?: string;
  model?: string;
  prompt?: string;
}

export async function generateAIReview(options: AIReviewerOptions): Promise<ReviewSummary> {
  const diff = options.diff || "";
  const inlineComments: InlineComment[] = [];
  const bugs: string[] = [];
  const securityRisks: string[] = [];
  const styleImprovements: string[] = [];

  if (diff.includes("eval(") || diff.includes("exec(")) {
    securityRisks.push("Potential unsafe code execution detected via eval/exec.");
    inlineComments.push({
      path: "src/unknown.ts",
      line: 1,
      comment: "Avoid using eval() or exec() due to code injection risks.",
      category: "security",
      severity: "high",
    });
  }

  if (diff.includes("catch (") && (diff.includes("catch (e) {}") || diff.includes("catch {}"))) {
    bugs.push("Empty catch block detected without error logging or handling.");
    inlineComments.push({
      path: "src/unknown.ts",
      line: 1,
      comment: "Empty catch block suppresses errors silently.",
      category: "bug",
      severity: "medium",
    });
  }

  if (diff.includes("var ")) {
    styleImprovements.push("Use `let` or `const` instead of `var`.");
    inlineComments.push({
      path: "src/unknown.ts",
      line: 1,
      comment: "Prefer `const` or `let` over `var` for block scoping.",
      category: "style",
      severity: "low",
    });
  }

  const hasCritical = inlineComments.some((c) => c.severity === "critical" || c.severity === "high");
  const passed = !hasCritical && bugs.length === 0;
  const score = passed ? (securityRisks.length > 0 ? 80 : 95) : 50;

  const summaryLines = [
    `### AI Code Review Summary (Score: ${score}/100)`,
    passed ? "✅ **Status: PASSED**" : "❌ **Status: NEEDS_CHANGES**",
    "",
    "#### Highlights:",
    `- **Bugs Found**: ${bugs.length}`,
    `- **Security Risks**: ${securityRisks.length}`,
    `- **Style Improvements**: ${styleImprovements.length}`,
  ];

  if (bugs.length > 0) {
    summaryLines.push("", "#### Bugs:", ...bugs.map((b) => `- 🐛 ${b}`));
  }
  if (securityRisks.length > 0) {
    summaryLines.push("", "#### Security Risks:", ...securityRisks.map((s) => `- 🔒 ${s}`));
  }
  if (styleImprovements.length > 0) {
    summaryLines.push("", "#### Style Suggestions:", ...styleImprovements.map((s) => `- 🎨 ${s}`));
  }

  return {
    passed,
    overallScore: score,
    summary: summaryLines.join("\n"),
    highlights: {
      bugs,
      securityRisks,
      styleImprovements,
    },
    inlineComments,
  };
}
