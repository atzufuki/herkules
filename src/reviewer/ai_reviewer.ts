export interface InlineComment {
  path: string;
  line: number;
  comment: string;
  severity: "bug" | "security" | "style" | "info";
}

export interface ReviewResult {
  passed: boolean;
  score: number;
  summary: string;
  inlineComments: InlineComment[];
}

export class AIReviewer {
  private modelName: string;

  constructor(modelName = "gpt-4o") {
    this.modelName = modelName;
  }

  async reviewDiff(diffText: string): Promise<ReviewResult> {
    if (!diffText || diffText.trim().length === 0) {
      return {
        passed: true,
        score: 100,
        summary: "No changes detected in diff.",
        inlineComments: [],
      };
    }

    const inlineComments: InlineComment[] = [];
    const lines = diffText.split("\n");

    let currentFile = "";
    let currentLineNumber = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("diff --git")) {
        const match = line.match(/b\/(.+)$/);
        if (match) {
          currentFile = match[1];
        }
      } else if (line.startsWith("@@")) {
        const match = line.match(/\+([0-9]+)/);
        if (match) {
          currentLineNumber = parseInt(match[1], 10) - 1;
        }
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        currentLineNumber++;
        const addedCode = line.substring(1);

        if (/eval\(|exec\(|innerHTML\s*=/i.test(addedCode)) {
          inlineComments.push({
            path: currentFile,
            line: currentLineNumber,
            comment: "🔒 **Security Risk**: Avoid unsafe code execution or direct innerHTML injection.",
            severity: "security",
          });
        }

        if (/console\.log\(|debugger;/i.test(addedCode)) {
          inlineComments.push({
            path: currentFile,
            line: currentLineNumber,
            comment: "🐛 **Bug / Cleanup**: Debugging statement detected.",
            severity: "bug",
          });
        }

        if (/\s+$/.test(addedCode)) {
          inlineComments.push({
            path: currentFile,
            line: currentLineNumber,
            comment: "🎨 **Style Improvement**: Trailing whitespace detected.",
            severity: "style",
          });
        }
      } else if (!line.startsWith("-")) {
        currentLineNumber++;
      }
    }

    const hasSecurity = inlineComments.some((c) => c.severity === "security");
    const hasBugs = inlineComments.some((c) => c.severity === "bug");
    const passed = !hasSecurity && !hasBugs;

    let score = 100 - inlineComments.length * 10;
    if (score < 0) score = 0;

    const summaryParts: string[] = [];
    summaryParts.push("### 🤖 AI Code Review Summary");
    summaryParts.push(`**Status**: ${passed ? "✅ Approved" : "❌ Changes Requested"}`);
    summaryParts.push(`**Quality Score**: ${score}/100`);
    summaryParts.push(`**AI Model**: ${this.modelName}`);
    summaryParts.push("");

    if (inlineComments.length > 0) {
      summaryParts.push(`Found ${inlineComments.length} actionable item(s):`);
      const secCount = inlineComments.filter((c) => c.severity === "security").length;
      const bugCount = inlineComments.filter((c) => c.severity === "bug").length;
      const styleCount = inlineComments.filter((c) => c.severity === "style").length;
      if (secCount > 0) summaryParts.push(`- 🔒 Security risks: ${secCount}`);
      if (bugCount > 0) summaryParts.push(`- 🐛 Bugs / issues: ${bugCount}`);
      if (styleCount > 0) summaryParts.push(`- 🎨 Style improvements: ${styleCount}`);
    } else {
      summaryParts.push("✨ Code looks great! No bugs, security risks, or style issues found.");
    }

    return {
      passed,
      score,
      summary: summaryParts.join("\n"),
      inlineComments,
    };
  }

  async getDiff(worktreePath: string, baseBranch = "main"): Promise<string> {
    try {
      const command = new Deno.Command("git", {
        args: ["diff", `${baseBranch}...HEAD`],
        cwd: worktreePath,
        stdout: "piped",
        stderr: "piped",
      });
      const output = await command.output();
      if (output.success) {
        return new TextDecoder().decode(output.stdout);
      }
      return "";
    } catch {
      return "";
    }
  }
}
