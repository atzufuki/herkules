export interface InlineComment {
  path: string;
  line: number;
  comment: string;
  severity: "info" | "warning" | "error";
}

export interface ReviewCategories {
  security: string[];
  bugs: string[];
  style: string[];
}

export interface AIReviewResult {
  passed: boolean;
  score: number;
  summary: string;
  inlineComments: InlineComment[];
  categories: ReviewCategories;
}

export class AIReviewer {
  async getPRDiff(worktreePath: string, targetBranch: string = "main"): Promise<string> {
    try {
      const cmd = new Deno.Command("git", {
        args: ["diff", `${targetBranch}...HEAD`],
        cwd: worktreePath,
        stdout: "piped",
        stderr: "piped",
      });
      const output = await cmd.output();
      if (output.success) {
        const diff = new TextDecoder().decode(output.stdout);
        if (diff.trim()) return diff;
      }

      const fallbackCmd = new Deno.Command("git", {
        args: ["diff", "HEAD~1"],
        cwd: worktreePath,
        stdout: "piped",
        stderr: "piped",
      });
      const fallbackOutput = await fallbackCmd.output();
      return new TextDecoder().decode(fallbackOutput.stdout);
    } catch {
      return "";
    }
  }

  async reviewDiff(
    diff: string,
    options: { minScore?: number; model?: string } = {}
  ): Promise<AIReviewResult> {
    const minScore = options.minScore ?? 70;
    const inlineComments: InlineComment[] = [];
    const categories: ReviewCategories = {
      security: [],
      bugs: [],
      style: [],
    };

    if (!diff.trim()) {
      return {
        passed: true,
        score: 100,
        summary: "🔍 AI Code Review: No changes detected in diff.",
        inlineComments: [],
        categories: { security: [], bugs: [], style: [] },
      };
    }

    const lines = diff.split("\n");
    let currentFile = "";
    let lineNum = 0;

    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        currentFile = line.slice(6);
        lineNum = 0;
        continue;
      }

      if (line.startsWith("@@")) {
        const match = line.match(/\+(\d+)/);
        if (match) {
          lineNum = parseInt(match[1], 10) - 1;
        }
        continue;
      }

      if (line.startsWith("+") && !line.startsWith("+++")) {
        lineNum++;
        const addedContent = line.slice(1);

        if (/eval\(|exec\(|Function\(/.test(addedContent)) {
          categories.security.push(`Avoid code execution functions in ${currentFile}:${lineNum}`);
          inlineComments.push({
            path: currentFile,
            line: lineNum,
            comment: "🔒 Security risk: Dynamic code execution via eval/exec can lead to code injection.",
            severity: "error",
          });
        }
        if (/password\s*=\s*["'][^"']+["']|secret\s*=\s*["'][^"']+["']|api_key\s*=\s*["'][^"']+["']/i.test(addedContent)) {
          categories.security.push(`Possible hardcoded credentials in ${currentFile}:${lineNum}`);
          inlineComments.push({
            path: currentFile,
            line: lineNum,
            comment: "🔒 Security risk: Possible hardcoded secret or API key.",
            severity: "error",
          });
        }

        if (/TODO|FIXME|HACK/.test(addedContent)) {
          categories.bugs.push(`Unresolved TODO/FIXME comment in ${currentFile}:${lineNum}`);
          inlineComments.push({
            path: currentFile,
            line: lineNum,
            comment: "🐛 Potential issue: Unresolved TODO/FIXME comment detected.",
            severity: "warning",
          });
        }
        if (/: any\b/.test(addedContent)) {
          categories.bugs.push(`Explicit 'any' type used in ${currentFile}:${lineNum}`);
          inlineComments.push({
            path: currentFile,
            line: lineNum,
            comment: "⚠️ Type safety: Avoid explicit 'any' type; use a more specific type or 'unknown'.",
            severity: "warning",
          });
        }

        if (/\bconsole\.log\(/.test(addedContent)) {
          categories.style.push(`Leftover console.log in ${currentFile}:${lineNum}`);
          inlineComments.push({
            path: currentFile,
            line: lineNum,
            comment: "🎨 Style improvement: Remove debug console.log statements before merging.",
            severity: "info",
          });
        }
      } else if (!line.startsWith("-")) {
        lineNum++;
      }
    }

    const errorCount = inlineComments.filter((c) => c.severity === "error").length;
    const warningCount = inlineComments.filter((c) => c.severity === "warning").length;
    const infoCount = inlineComments.filter((c) => c.severity === "info").length;

    let score = 100 - errorCount * 25 - warningCount * 10 - infoCount * 2;
    if (score < 0) score = 0;

    const passed = score >= minScore && errorCount === 0;

    const summaryParts = [`### 🤖 AI Code Review Summary (Score: ${score}/100)`];
    if (passed) {
      summaryParts.push("✅ Code quality standards met. Ready for review/merge.");
    } else {
      summaryParts.push("⚠️ Code review identified issues that should be addressed:");
    }

    if (categories.security.length > 0) {
      summaryParts.push(`\n**🔒 Security Risks (${categories.security.length}):**`);
      categories.security.forEach((s) => summaryParts.push(`- ${s}`));
    }
    if (categories.bugs.length > 0) {
      summaryParts.push(`\n**🐛 Logic / Bug Warnings (${categories.bugs.length}):**`);
      categories.bugs.forEach((b) => summaryParts.push(`- ${b}`));
    }
    if (categories.style.length > 0) {
      summaryParts.push(`\n**🎨 Style Improvements (${categories.style.length}):**`);
      categories.style.forEach((st) => summaryParts.push(`- ${st}`));
    }

    return {
      passed,
      score,
      summary: summaryParts.join("\n"),
      inlineComments,
      categories,
    };
  }
}
