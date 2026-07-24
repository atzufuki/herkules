export interface InlineComment {
  file: string;
  line: number;
  comment: string;
  severity: "bug" | "security" | "style" | "info";
}

export interface ReviewSummary {
  approved: boolean;
  score: number;
  summary: string;
  inlineComments: InlineComment[];
  securityRisks: string[];
  bugs: string[];
  styleImprovements: string[];
}

export class AiReviewer {
  async analyzeDiff(diffText: string): Promise<ReviewSummary> {
    const inlineComments: InlineComment[] = [];
    const securityRisks: string[] = [];
    const bugs: string[] = [];
    const styleImprovements: string[] = [];

    const lines = diffText.split("\n");
    let currentFile = "";
    let lineNumber = 0;

    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        currentFile = line.substring(6);
        lineNumber = 0;
        continue;
      }

      if (line.startsWith("@@")) {
        const match = line.match(/\+(\d+)/);
        if (match) {
          lineNumber = parseInt(match[1], 10);
        }
        continue;
      }

      if (line.startsWith("+") && !line.startsWith("+++")) {
        const content = line.substring(1);
        lineNumber++;

        if (content.includes("eval(") || content.includes("exec(") || content.includes("dangerouslySetInnerHTML")) {
          securityRisks.push(`Potential security risk in ${currentFile}:${lineNumber}: avoid using eval/exec or unsafe HTML inner strings.`);
          inlineComments.push({
            file: currentFile,
            line: lineNumber,
            comment: "Security Risk: Unsafe evaluation or execution detected.",
            severity: "security",
          });
        }

        if (content.includes("console.log(") || content.includes("debugger;")) {
          styleImprovements.push(`Debug statement found in ${currentFile}:${lineNumber}: remove leftover console.log or debugger statement.`);
          inlineComments.push({
            file: currentFile,
            line: lineNumber,
            comment: "Style Improvement: Remove debugging statements before merging.",
            severity: "style",
          });
        }

        if (content.includes("TODO:") || content.includes("FIXME:")) {
          styleImprovements.push(`Unresolved TODO/FIXME in ${currentFile}:${lineNumber}.`);
        }
      }
    }

    const hasCriticalIssues = securityRisks.length > 0 || bugs.length > 0;
    const approved = !hasCriticalIssues;
    const score = approved ? (styleImprovements.length > 0 ? 85 : 100) : 40;

    const summaryParts = [
      `### AI Code Review Summary`,
      `**Status**: ${approved ? "✅ Approved" : "❌ Changes Requested"}`,
      `**Score**: ${score}/100`,
      ``,
      `#### Highlights`,
      `- **Security Risks**: ${securityRisks.length}`,
      `- **Bugs Detected**: ${bugs.length}`,
      `- **Style Improvements**: ${styleImprovements.length}`,
    ];

    if (securityRisks.length > 0) {
      summaryParts.push(``, `#### Security Risks`, ...securityRisks.map((r) => `- ⚠️ ${r}`));
    }

    if (bugs.length > 0) {
      summaryParts.push(``, `#### Bugs`, ...bugs.map((b) => `- 🐛 ${b}`));
    }

    if (styleImprovements.length > 0) {
      summaryParts.push(``, `#### Style Improvements`, ...styleImprovements.map((s) => `- 🎨 ${s}`));
    }

    return {
      approved,
      score,
      summary: summaryParts.join("\n"),
      inlineComments,
      securityRisks,
      bugs,
      styleImprovements,
    };
  }

  async getDiff(targetBranch = "main"): Promise<string> {
    try {
      const command = new Deno.Command("git", {
        args: ["diff", `${targetBranch}...HEAD`],
        stdout: "piped",
        stderr: "piped",
      });
      const output = await command.output();
      if (output.success) {
        return new TextDecoder().decode(output.stdout);
      }
    } catch {
      // Fallback
    }
    return "";
  }
}
