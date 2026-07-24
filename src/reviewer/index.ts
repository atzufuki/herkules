import { parseConfig, ReviewerConfig } from './config.ts';
import { WorktreeManager, WorktreeInfo } from './worktree.ts';
import { CodeChecker, CheckResult } from './checker.ts';
import { AIReviewer, AIReviewResult } from './ai_reviewer.ts';
import { AutoMerger, AutoMergeResult } from './auto_merge.ts';

export * from './config.ts';
export * from './worktree.ts';
export * from './checker.ts';
export * from './ai_reviewer.ts';
export * from './auto_merge.ts';

export interface ReviewOptions {
  prNumber: number | string;
  branch: string;
  diffText?: string;
  cliArgs?: string[];
  config?: Partial<ReviewerConfig>;
}

export interface ReviewWorkflowResult {
  prNumber: number | string;
  branch: string;
  config: ReviewerConfig;
  worktree: WorktreeInfo;
  checks: CheckResult;
  aiReview: AIReviewResult;
  autoMerge: AutoMergeResult;
  summary: string;
}

export class ReviewerPipeline {
  private worktreeManager: WorktreeManager;
  private codeChecker: CodeChecker;
  private aiReviewer: AIReviewer;
  private autoMerger: AutoMerger;

  constructor() {
    this.worktreeManager = new WorktreeManager();
    this.codeChecker = new CodeChecker();
    this.aiReviewer = new AIReviewer();
    this.autoMerger = new AutoMerger();
  }

  async runReview(options: ReviewOptions): Promise<ReviewWorkflowResult> {
    const config = parseConfig(options.cliArgs, options.config);

    const worktree = await this.worktreeManager.createWorktree(options.prNumber, options.branch);

    try {
      const checks = await this.codeChecker.runVerification(
        worktree.path,
        config.testCommand,
        config.lintCommand
      );

      const diffText = options.diffText ?? (await this.fetchDiff(options.branch));
      const aiReviewer = new AIReviewer({ minScore: config.minApprovalScore });
      const aiReview = await aiReviewer.analyzeDiff(diffText);

      let autoMerge: AutoMergeResult = {
        attempted: false,
        merged: false,
        reason: 'Auto-merge not enabled or criteria not met',
      };

      if (this.autoMerger.canAutoMerge(checks, aiReview, config)) {
        autoMerge = await this.autoMerger.executeAutoMerge(options.prNumber, 'main', config);
      }

      const summary = this.buildSummary(options.prNumber, checks, aiReview, autoMerge);

      return {
        prNumber: options.prNumber,
        branch: options.branch,
        config,
        worktree,
        checks,
        aiReview,
        autoMerge,
        summary,
      };
    } finally {
      await worktree.cleanup();
    }
  }

  private async fetchDiff(branch: string): Promise<string> {
    try {
      const command = new Deno.Command('git', {
        args: ['diff', `main...${branch}`],
        stdout: 'piped',
        stderr: 'piped',
      });
      const { success, stdout } = await command.output();
      if (success) {
        return new TextDecoder().decode(stdout);
      }
    } catch {
      // Diff fetch failed
    }
    return '';
  }

  private buildSummary(
    prNumber: number | string,
    checks: CheckResult,
    aiReview: AIReviewResult,
    autoMerge: AutoMergeResult
  ): string {
    const lines: string[] = [];
    lines.push(`## 🔍 Herkules PR Review Summary for #${prNumber}`);
    lines.push(
      `**Automated Checks:** ${checks.success ? '✅ PASSED' : '❌ FAILED'}`
    );
    lines.push(
      `**AI Review Status:** ${aiReview.passed ? '✅ APPROVED' : '⚠️ CHANGES REQUESTED'} (Score: ${aiReview.score}/100)`
    );
    lines.push(
      `**Auto-Merge Status:** ${autoMerge.merged ? '🚀 MERGED' : autoMerge.attempted ? '❌ ATTEMPTED BUT FAILED' : '⏸️ SKIPPED'}`
    );
    lines.push(`\n${aiReview.summary}`);
    return lines.join('\n');
  }
}
