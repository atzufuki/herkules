import { loadConfig, parseArgs, ReviewerConfig } from "./config.ts";
import { WorktreeManager, CommandExecutor } from "./worktree.ts";
import { Checker, CheckResult } from "./checker.ts";
import { AIReviewer, ReviewSummary } from "./ai_reviewer.ts";
import { AutoMerger, AutoMergeResult, AutoMergeExecutor } from "./auto_merge.ts";

export * from "./config.ts";
export * from "./worktree.ts";
export * from "./checker.ts";
export * from "./ai_reviewer.ts";
export * from "./auto_merge.ts";

export interface PRInfo {
  id: number | string;
  branch: string;
  diff: string;
  title?: string;
}

export interface PRReviewResult {
  prId: number | string;
  checkResult: CheckResult;
  reviewSummary: ReviewSummary;
  autoMergeResult: AutoMergeResult;
  worktreePath: string;
}

export interface CodeReviewerOptions {
  config?: ReviewerConfig;
  executor?: CommandExecutor;
  autoMergeExecutor?: AutoMergeExecutor;
  aiAnalyzer?: (diff: string) => Promise<ReviewSummary> | ReviewSummary;
}

export class CodeReviewer {
  private config: ReviewerConfig;
  private worktreeManager: WorktreeManager;
  private checker: Checker;
  private aiReviewer: AIReviewer;
  private autoMerger: AutoMerger;

  constructor(options?: CodeReviewerOptions) {
    this.config = options?.config || loadConfig();
    this.worktreeManager = new WorktreeManager(this.config.worktreeDir, options?.executor);
    this.checker = new Checker(options?.executor);
    this.aiReviewer = new AIReviewer({
      model: this.config.aiModel,
      customAnalyzer: options?.aiAnalyzer,
    });
    this.autoMerger = new AutoMerger(options?.autoMergeExecutor);
  }

  async reviewPR(pr: PRInfo, configOverrides?: Partial<ReviewerConfig>): Promise<PRReviewResult> {
    const effectiveConfig = { ...this.config, ...configOverrides };
    const worktreeInfo = await this.worktreeManager.createWorktree(pr.id, pr.branch);

    try {
      const checkResult = await this.checker.runChecks(worktreeInfo.path, {
        testCommand: effectiveConfig.testCommand,
        lintCommand: effectiveConfig.lintCommand,
      });

      const reviewSummary = await this.aiReviewer.reviewDiff(pr.diff);

      const autoMergeResult = await this.autoMerger.executeAutoMerge(
        pr.id,
        checkResult,
        reviewSummary,
        effectiveConfig
      );

      return {
        prId: pr.id,
        checkResult,
        reviewSummary,
        autoMergeResult,
        worktreePath: worktreeInfo.path,
      };
    } finally {
      await this.worktreeManager.removeWorktree(worktreeInfo.path);
    }
  }
}
