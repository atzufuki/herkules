export interface InlineComment {
  path: string;
  line: number;
  body: string;
  severity: "bug" | "security" | "style" | "info";
}

export interface AIReviewResult {
  approved: boolean;
  summary: string;
  inlineComments: InlineComment[];
  score: number;
  categories: {
    bugs: number;
    security: number;
    style: number;
  };
}

export interface ReviewerAIConfig {
  aiModel?: string;
  targetBranch?: string;
  customAnalyzer?: (diff: string) => Promise<AIReviewResult>;
}

export async function getWorktreeDiff(
  worktreePath: string,
  targetBranch: string = "main"
): Promise<string> {
  try {
    const cmd = new Deno.Command("git", {
      args: ["diff", `${targetBranch}...HEAD`],
      cwd: worktreePath,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    const decoder = new TextDecoder();
    return decoder.decode(output.stdout);
  } catch (_e) {
    return "";
  }
}

export function parseDiffAndAnalyze(diffContent: string): AIReviewResult {
  const inlineComments: InlineComment[] = [];
  let bugsCount = 0;
  let securityCount = 0;
  let styleCount = 0;

  const lines = diffContent.split("\n");
  let currentFile = "";
  let currentLineNum = 0;

  for (const line of lines) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.substring(6);
      currentLineNum = 0;
      continue;
    }

    if (line.startsWith("@@")) {
      const match = line.match(/\+([0-9]+)/);
      if (match) {
        currentLineNum = parseInt(match[1], 10) - 1;
      }
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentLineNum++;
      const code = line.substring(1);

      if (
        code.includes("eval(") ||
        code.includes("innerHTML =") ||
        code.includes("exec(") ||
        /password\s*=\s*['"][^'"]+['"]/i.test(code)
      ) {
        securityCount++;
        inlineComments.push({
          path: currentFile || "unknown",
          line: currentLineNum,
          body: "🔒 **Security Risk Detected**: Potential security flaw (unsafe evaluation or hardcoded credentials).",
          severity: "security",
        });
      }

      if (
        code.includes("TODO:") ||
        code.includes("FIXME:") ||
        code.includes("undefined.") ||
        code.includes("== null")
      ) {
        bugsCount++;
        inlineComments.push({
          path: currentFile || "unknown",
          line: currentLineNum,
          body: "🐛 **Bug / Vulnerability**: Unresolved TODO or unsafe property access.",
          severity: "bug",
        });
      }

      if (
        code.includes("console.log(") ||
        code.length > 120 ||
        code.includes("var ")
      ) {
        styleCount++;
        inlineComments.push({
          path: currentFile || "unknown",
          line: currentLineNum,
          body: "🎨 **Style Recommendation**: Avoid `var` / `console.log` or keep line length under 120 characters.",
          severity: "style",
        });
      }
    }
  }

  const totalIssues = bugsCount * 25 + securityCount * 30 + styleCount * 5;
  const score = Math.max(0, 100 - totalIssues);
  const approved = bugsCount === 0 && securityCount === 0 && score >= 70;

  let summaryStatus = "✅ **Review Status: Approved**";
  if (!approved) {
    summaryStatus = "❌ **Review Status: Changes Requested**";
  }

  const summary = `
## 🤖 Herkules AI Code Review Summary

${summaryStatus}

- **Overall Score**: ${score}/100
- **Security Risks**: ${securityCount}
- **Potential Bugs**: ${bugsCount}
- **Style Suggestions**: ${styleCount}

### Summary Notes
${
  approved
    ? "The code changes meet quality and security standards. Great job!"
    : "Critical issues or potential bugs were detected during review. Please address the inline comments."
}
`.trim();

  return {
    approved,
    summary,
    inlineComments,
    score,
    categories: {
      bugs: bugsCount,
      security: securityCount,
      style: styleCount,
    },
  };
}

export async function analyzeDiff(
  worktreePath: string,
  targetBranch: string = "main",
  config: ReviewerAIConfig = {}
): Promise<AIReviewResult> {
  const diff = await getWorktreeDiff(worktreePath, targetBranch);

  if (config.customAnalyzer) {
    return await config.customAnalyzer(diff);
  }

  return parseDiffAndAnalyze(diff);
}
