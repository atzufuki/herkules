export interface ReviewComment {
  file: string;
  line: number;
  comment: string;
  severity: 'info' | 'warning' | 'error';
}

export interface AIReviewResult {
  passed: boolean;
  score: number;
  summary: string;
  comments: ReviewComment[];
  securityIssues: string[];
  bugs: string[];
  styleNotes: string[];
}

export interface AIReviewerOptions {
  apiKey?: string;
  model?: string;
  minScore?: number;
}

export class AIReviewer {
  private minScore: number;

  constructor(options: AIReviewerOptions = {}) {
    this.minScore = options.minScore ?? 70;
  }

  async analyzeDiff(diffText: string): Promise<AIReviewResult> {
    const comments: ReviewComment[] = [];
    const securityIssues: string[] = [];
    const bugs: string[] = [];
    const styleNotes: string[] = [];

    if (!diffText || diffText.trim().length === 0) {
      return {
        passed: true,
        score: 100,
        summary: 'No changes detected in diff.',
        comments: [],
        securityIssues: [],
        bugs: [],
        styleNotes: [],
      };
    }

    const lines = diffText.split('\n');
    let currentFile = '';
    let currentLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('+++ b/')) {
        currentFile = line.slice(6);
        currentLine = 0;
        continue;
      }

      if (line.startsWith('@@')) {
        const match = line.match(/\+(\d+)/);
        if (match) {
          currentLine = parseInt(match[1], 10) - 1;
        }
        continue;
      }

      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentLine++;
        const addedCode = line.slice(1);

        if (
          /eval\(|exec\(|innerHTML\s*=|dangerouslySetInnerHTML|password\s*=\s*['"][^'"]+['"]/i.test(
            addedCode
          )
        ) {
          const issue = `Potential security vulnerability detected in line: "${addedCode.trim()}"`;
          securityIssues.push(issue);
          comments.push({
            file: currentFile || 'unknown',
            line: currentLine,
            comment: '🚨 Security Risk: Avoid using unsafe dynamic evaluation or hardcoded credentials.',
            severity: 'error',
          });
        }

        if (
          /\bdebugger\b|console\.log|TODO|FIXME/i.test(addedCode) &&
          !addedCode.includes('// deno-lint-ignore')
        ) {
          if (/\bdebugger\b/.test(addedCode)) {
            bugs.push(`Debugger statement found in ${currentFile}:${currentLine}`);
            comments.push({
              file: currentFile || 'unknown',
              line: currentLine,
              comment: '🐛 Bug/Quality: Remove leftover `debugger` statements before merging.',
              severity: 'error',
            });
          } else if (/\bconsole\.log\b/.test(addedCode)) {
            styleNotes.push(`Console log statement found in ${currentFile}:${currentLine}`);
            comments.push({
              file: currentFile || 'unknown',
              line: currentLine,
              comment: '💡 Style: Avoid `console.log` statements in production code.',
              severity: 'warning',
            });
          }
        }

        if (addedCode.length > 120) {
          styleNotes.push(`Line exceeds 120 characters in ${currentFile}:${currentLine}`);
          comments.push({
            file: currentFile || 'unknown',
            line: currentLine,
            comment: '📐 Style: Line exceeds 120 characters limit.',
            severity: 'info',
          });
        }
      } else if (!line.startsWith('-')) {
        currentLine++;
      }
    }

    const errorCount = comments.filter((c) => c.severity === 'error').length;
    const warningCount = comments.filter((c) => c.severity === 'warning').length;
    const score = Math.max(0, 100 - errorCount * 25 - warningCount * 10);
    const passed = score >= this.minScore && errorCount === 0;

    const summaryParts: string[] = [];
    summaryParts.push(`### 🤖 AI Code Review Summary`);
    summaryParts.push(`- **Score**: ${score}/100 (${passed ? '✅ Passed' : '❌ Needs Attention'})`);
    summaryParts.push(`- **Security Issues**: ${securityIssues.length}`);
    summaryParts.push(`- **Bugs/Risks**: ${bugs.length}`);
    summaryParts.push(`- **Style Suggestions**: ${styleNotes.length}`);

    if (comments.length > 0) {
      summaryParts.push(`\n#### Key Feedback:`);
      comments.forEach((c) => {
        summaryParts.push(`- [${c.severity.toUpperCase()}] \`${c.file}:${c.line}\`: ${c.comment}`);
      });
    } else {
      summaryParts.push(`\n✨ Code looks clean! No major issues detected.`);
    }

    return {
      passed,
      score,
      summary: summaryParts.join('\n'),
      comments,
      securityIssues,
      bugs,
      styleNotes,
    };
  }

  formatReviewMarkdown(review: AIReviewResult): string {
    return review.summary;
  }
}
