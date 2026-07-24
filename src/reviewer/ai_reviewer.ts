export interface InlineComment {
  path: string;
  line: number;
  body: string;
  type: "bug" | "security" | "style" | "info";
  severity: "low" | "medium" | "high" | "critical";
}

export interface ReviewSummary {
  summary: string;
  score: number;
  approved: boolean;
  inlineComments: InlineComment[];
  highlights: {
    bugs: string[];
    securityRisks: string[];
    styleImprovements: string[];
  };
}

export function analyzeDiff(diffText: string): ReviewSummary {
  const inlineComments: InlineComment[] = [];
  const bugs: string[] = [];
  const securityRisks: string[] = [];
  const styleImprovements: string[] = [];

  const lines = diffText.split("\n");
  let currentFile = "";
  let currentLineNum = 0;

  for (const line of lines) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.substring(6);
      currentLineNum = 0;
      continue;
    }

    if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+)/);
      if (match) {
        currentLineNum = parseInt(match[1], 10) - 1;
      }
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentLineNum++;
      const addedCode = line.substring(1);

      if (/eval\(|exec\(|dangerouslySetInnerHTML|password\s*=\s*['"][^'"]+['"]/i.test(addedCode)) {
        const msg = "Potential security risk identified: avoid unsafe execution or hardcoded credentials.";
        securityRisks.push(`${currentFile}:${currentLineNum} - ${msg}`);
        inlineComments.push({
          path: currentFile,
          line: currentLineNum,
          body: `⚠️ **Security Alert**: ${msg}`,
          type: "security",
          severity: "high",
        });
      }

      if (/\b(TODO|FIXME|HACK)\b/i.test(addedCode)) {
        const msg = "Unresolved FIXME/TODO comment detected.";
        styleImprovements.push(`${currentFile}:${currentLineNum} - ${msg}`);
        inlineComments.push({
          path: currentFile,
          line: currentLineNum,
          body: `💡 **Style/Maintainability**: ${msg}`,
          type: "style",
          severity: "low",
        });
      }

      if (/==\s*null|!=\s*null/.test(addedCode)) {
        const msg = "Consider using strict equality checks (=== or !==).";
        bugs.push(`${currentFile}:${currentLineNum} - ${msg}`);
        inlineComments.push({
          path: currentFile,
          line: currentLineNum,
          body: `🐛 **Bug Risk**: ${msg}`,
          type: "bug",
          severity: "medium",
        });
      }

      if (/\bvar\s+\w+/.test(addedCode)) {
        const msg = "Avoid using 'var'. Use 'const' or 'let' instead.";
        styleImprovements.push(`${currentFile}:${currentLineNum} - ${msg}`);
        inlineComments.push({
          path: currentFile,
          line: currentLineNum,
          body: `🎨 **Style**: ${msg}`,
          type: "style",
          severity: "low",
        });
      }
    }
  }

  let score = 100;
  score -= securityRisks.length * 25;
  score -= bugs.length * 15;
  score -= styleImprovements.length * 5;
  if (score < 0) score = 0;

  const approved = score >= 75 && securityRisks.length === 0;

  let summary = `### AI Code Review Summary\n\n`;
  summary += `- **Overall Score**: ${score}/100\n`;
  summary += `- **Status**: ${approved ? "✅ Approved" : "❌ Changes Requested"}\n\n`;

  if (securityRisks.length > 0) {
    summary += `#### 🛡️ Security Risks (${securityRisks.length})\n`;
    securityRisks.forEach((s) => (summary += `- ${s}\n`));
    summary += `\n`;
  }

  if (bugs.length > 0) {
    summary += `#### 🐛 Logic Bugs / Issues (${bugs.length})\n`;
    bugs.forEach((b) => (summary += `- ${b}\n`));
    summary += `\n`;
  }

  if (styleImprovements.length > 0) {
    summary += `#### 🎨 Style & Readability (${styleImprovements.length})\n`;
    styleImprovements.forEach((st) => (summary += `- ${st}\n`));
    summary += `\n`;
  }

  if (inlineComments.length === 0) {
    summary += `✨ Code looks clean and ready for merge!\n`;
  }

  return {
    summary,
    score,
    approved,
    inlineComments,
    highlights: {
      bugs,
      securityRisks,
      styleImprovements,
    },
  };
}
