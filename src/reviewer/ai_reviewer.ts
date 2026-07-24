export type Severity = "bug" | "security" | "style" | "info";

export interface InlineComment {
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
  body: string;
  severity: Severity;
}

export interface ReviewSummary {
  approved: boolean;
  score: number;
  summary: string;
  inlineComments: InlineComment[];
  bugsCount: number;
  securityCount: number;
  styleCount: number;
}

export interface AIReviewerOptions {
  model?: string;
  customAnalyzer?: (diff: string) => Promise<ReviewSummary> | ReviewSummary;
}

export class AIReviewer {
  private model: string;
  private customAnalyzer?: (diff: string) => Promise<ReviewSummary> | ReviewSummary;

  constructor(options?: AIReviewerOptions) {
    this.model = options?.model || "herkules-ai-v1";
    this.customAnalyzer = options?.customAnalyzer;
  }

  async reviewDiff(diffText: string): Promise<ReviewSummary> {
    if (this.customAnalyzer) {
      return await this.customAnalyzer(diffText);
    }

    return this.analyzeDiffHeuristically(diffText);
  }

  private analyzeDiffHeuristically(diffText: string): ReviewSummary {
    const inlineComments: InlineComment[] = [];
    const lines = diffText.split("\n");

    let currentFile = "";
    let currentLine = 0;
    let bugsCount = 0;
    let securityCount = 0;
    let styleCount = 0;

    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        currentFile = line.substring(6);
        currentLine = 0;
        continue;
      }

      if (line.startsWith("@@")) {
        const match = line.match(/\+([0-9]+)/);
        if (match) {
          currentLine = parseInt(match[1], 10) - 1;
        }
        continue;
      }

      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentLine++;
        const content = line.substring(1);

        if (/eval\(|innerHTML\s*=|exec\(|SECRET|API_KEY\s*=\s*['"][^'"]+['"]/i.test(content)) {
          securityCount++;
          inlineComments.push({
            path: currentFile || "unknown",
            line: currentLine,
            side: "RIGHT",
            severity: "security",
            body: "🔒 **Security Risk Detected**: Potential secret leakage or unsafe code execution (eval/innerHTML).",
          });
        }

        if (/TODO|FIXME|ANY|as any|==\s*null/i.test(content)) {
          bugsCount++;
          inlineComments.push({
            path: currentFile || "unknown",
            line: currentLine,
            side: "RIGHT",
            severity: "bug",
            body: "🐛 **Bug / Anti-pattern Risk**: Unhandled TODO/FIXME or weak type/equality check.",
          });
        }

        if (/console\.log\(|var\s+|debugger;/i.test(content)) {
          styleCount++;
          inlineComments.push({
            path: currentFile || "unknown",
            line: currentLine,
            side: "RIGHT",
            severity: "style",
            body: "🎨 **Style Warning**: Avoid `console.log`, `var`, or `debugger` statements in production code.",
          });
        }
      }
    }

    const totalIssues = securityCount * 25 + bugsCount * 15 + styleCount * 5;
    const score = Math.max(0, 100 - totalIssues);
    const approved = securityCount === 0 && bugsCount === 0 && score >= 70;

    const summaryHeader = approved
      ? "✅ **AI Review Passed**: The changes look clean and well-structured."
      : "⚠️ **AI Review Warning**: Found potential issues that should be addressed before merging.";

    const summary = `${summaryHeader}\n\n` +
      `- **Model Used**: ${this.model}\n` +
      `- **Score**: ${score}/100\n` +
      `- **Security Risks**: ${securityCount}\n` +
      `- **Potential Bugs**: ${bugsCount}\n` +
      `- **Style Warnings**: ${styleCount}\n` +
      `- **Inline Comments**: ${inlineComments.length}`;

    return {
      approved,
      score,
      summary,
      inlineComments,
      bugsCount,
      securityCount,
      styleCount,
    };
  }
}
