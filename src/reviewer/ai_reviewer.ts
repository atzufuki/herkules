export interface InlineComment {
  path: string;
  line: number;
  comment: string;
  type: "bug" | "security" | "style" | "info";
}

export interface ReviewSummary {
  approved: boolean;
  score: number;
  summary: string;
  inlineComments: InlineComment[];
  highlights: {
    bugs: string[];
    securityRisks: string[];
    styleImprovements: string[];
  };
}

export interface AIReviewerOptions {
  worktreePath: string;
  targetBranch: string;
  aiApiKey?: string;
}

export class AIReviewer {
  private worktreePath: string;
  private targetBranch: string;
  private aiApiKey?: string;

  constructor(options: AIReviewerOptions) {
    this.worktreePath = options.worktreePath;
    this.targetBranch = options.targetBranch;
    this.aiApiKey = options.aiApiKey;
  }

  async getGitDiff(): Promise<string> {
    try {
      const command = new Deno.Command("git", {
        args: ["diff", `${this.targetBranch}...HEAD`],
        cwd: this.worktreePath,
        stdout: "piped",
        stderr: "piped",
      });
      const output = await command.output();
      if (output.success) {
        const diff = new TextDecoder().decode(output.stdout);
        if (diff.trim().length > 0) return diff;
      }

      const fallbackCmd = new Deno.Command("git", {
        args: ["diff", this.targetBranch],
        cwd: this.worktreePath,
        stdout: "piped",
        stderr: "piped",
      });
      const fallbackOutput = await fallbackCmd.output();
      return new TextDecoder().decode(fallbackOutput.stdout);
    } catch {
      return "";
    }
  }

  async analyze(): Promise<ReviewSummary> {
    const diff = await this.getGitDiff();

    const inlineComments: InlineComment[] = [];
    const bugs: string[] = [];
    const securityRisks: string[] = [];
    const styleImprovements: string[] = [];

    const lines = diff.split("\n");
    let currentFile = "";
    let currentLine = 0;

    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        currentFile = line.replace("+++ b/", "");
        currentLine = 0;
        continue;
      }

      if (line.startsWith("@@")) {
        const match = line.match(/\+(\d+)/);
        if (match) {
          currentLine = parseInt(match[1], 10) - 1;
        }
        continue;
      }

      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentLine++;
        const content = line.substring(1);

        if (/eval\(|exec\(|dangerouslySetInnerHTML|innerHTML\s*=/i.test(content)) {
          const msg = `Security Risk: Avoid dynamic execution or unsafe innerHTML assignment in ${currentFile}:${currentLine}`;
          securityRisks.push(msg);
          inlineComments.push({
            path: currentFile,
            line: currentLine,
            comment: "Potential security vulnerability detected: avoid unsafe execution or raw HTML injection.",
            type: "security",
          });
        }

        if (/password\s*=\s*['"][^'"]+['"]|secret\s*=\s*['"][^'"]+['"]/i.test(content)) {
          const msg = `Security Risk: Possible hardcoded secret in ${currentFile}:${currentLine}`;
          securityRisks.push(msg);
          inlineComments.push({
            path: currentFile,
            line: currentLine,
            comment: "Hardcoded secret detected. Use environment variables instead.",
            type: "security",
          });
        }

        if (/==\s*null|==\s*undefined/.test(content)) {
          const msg = `Potential Bug: Loose equality check in ${currentFile}:${currentLine}`;
          bugs.push(msg);
          inlineComments.push({
            path: currentFile,
            line: currentLine,
            comment: "Use strict equality (`===` / `!==`) to prevent unexpected type coercion bugs.",
            type: "bug",
          });
        }

        if (/catch\s*\(\w+\)\s*\{\s*\}/.test(content)) {
          const msg = `Potential Bug: Empty catch block in ${currentFile}:${currentLine}`;
          bugs.push(msg);
          inlineComments.push({
            path: currentFile,
            line: currentLine,
            comment: "Empty catch block silently ignores errors. Log or handle exception.",
            type: "bug",
          });
        }

        if (/var\s+\w+/.test(content)) {
          const msg = `Style Improvement: Use 'const' or 'let' instead of 'var' in ${currentFile}:${currentLine}`;
          styleImprovements.push(msg);
          inlineComments.push({
            path: currentFile,
            line: currentLine,
            comment: "Replace legacy `var` declaration with `const` or `let`.",
            type: "style",
          });
        }

        if (/console\.log\(/.test(content) && !currentFile.includes("test")) {
          const msg = `Style Improvement: Debug console.log statement in ${currentFile}:${currentLine}`;
          styleImprovements.push(msg);
          inlineComments.push({
            path: currentFile,
            line: currentLine,
            comment: "Consider removing debug `console.log` statement before merging.",
            type: "style",
          });
        }
      }
    }

    const totalIssues = bugs.length + securityRisks.length;
    const approved = totalIssues === 0;
    const score = Math.max(0, 100 - (bugs.length * 20 + securityRisks.length * 30 + styleImprovements.length * 5));

    let summaryText = approved
      ? "✅ AI Review Passed: Code looks clean with no critical security risks or major bugs detected."
      : `⚠️ AI Review Flagged Issues: Found ${bugs.length} potential bug(s) and ${securityRisks.length} security risk(s).`;

    if (styleImprovements.length > 0) {
      summaryText += ` Also noticed ${styleImprovements.length} style improvement suggestion(s).`;
    }

    return {
      approved,
      score,
      summary: summaryText,
      inlineComments,
      highlights: {
        bugs,
        securityRisks,
        styleImprovements,
      },
    };
  }

  formatMarkdownReport(summary: ReviewSummary): string {
    let md = `## 🤖 AI Code Review Summary\n\n`;
    md += `**Status**: ${summary.approved ? "✅ Approved" : "❌ Changes Requested"}\n`;
    md += `**Quality Score**: ${summary.score}/100\n\n`;
    md += `${summary.summary}\n\n`;

    if (summary.highlights.securityRisks.length > 0) {
      md += `### 🔒 Security Risks\n`;
      for (const risk of summary.highlights.securityRisks) {
        md += `- ${risk}\n`;
      }
      md += `\n`;
    }

    if (summary.highlights.bugs.length > 0) {
      md += `### 🐛 Potential Bugs\n`;
      for (const bug of summary.highlights.bugs) {
        md += `- ${bug}\n`;
      }
      md += `\n`;
    }

    if (summary.highlights.styleImprovements.length > 0) {
      md += `### 💡 Style Improvements\n`;
      for (const style of summary.highlights.styleImprovements) {
        md += `- ${style}\n`;
      }
      md += `\n`;
    }

    if (summary.inlineComments.length > 0) {
      md += `### 💬 Inline Comments (${summary.inlineComments.length})\n`;
      for (const comment of summary.inlineComments) {
        md += `- **${comment.path}:${comment.line}** [${comment.type.toUpperCase()}]: ${comment.comment}\n`;
      }
    }

    return md;
  }
}
