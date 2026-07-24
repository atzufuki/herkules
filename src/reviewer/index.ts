import { parseReviewerArgs, resolveConfig, ReviewerConfig } from "./config.ts";
import { GitWorktreeManager, WorktreeManager } from "./worktree.ts";
import { CodeChecker, CheckResult } from "./checker.ts";
import { AIReviewer, ReviewSummary } from "./ai_reviewer.ts";
import { AutoMerger, AutoMergeResult } from "./auto_merge.ts";

export * from "./config.ts";
export * from "./worktree.ts";
export * from "./checker.ts";
export * from "./ai_reviewer.ts";
export * from "./auto_merge.ts";

export interface FullReviewResult {
  config: ReviewerConfig;
  worktreePath: string;
  checkResult: CheckResult;
  reviewSummary: ReviewSummary;
  markdownReport: string;
  autoMergeResult: AutoMergeResult;
}

export class PullRequestReviewer {
  private config: ReviewerConfig;
  private worktreeManager?: WorktreeManager;

  constructor(options: Partial<ReviewerConfig>) {
    this.config = resolveConfig(options);
  }

  async run(): Promise<FullReviewResult> {
    const manager = new GitWorktreeManager(
      this.config.prId,
      this.config.branch,
      this.config.worktreesDir
    );
    this.worktreeManager = manager;

    let worktreePath = "";
    try {
      worktreePath = await manager.create();
    } catch (_e) {
      worktreePath = Deno.cwd();
    }

    try {
      const checker = new CodeChecker({
        worktreePath,
        testCommand: this.config.testCommand,
        lintCommand: this.config.lintCommand,
      });
      const checkResult = await checker.runAllChecks();

      const aiReviewer = new AIReviewer({
        worktreePath,
        targetBranch: this.config.targetBranch,
        aiApiKey: this.config.aiApiKey,
      });
      const reviewSummary = await aiReviewer.analyze();
      const markdownReport = aiReviewer.formatMarkdownReport(reviewSummary);

      const autoMergeResult = await AutoMerger.executeMerge({
        autoMergeEnabled: this.config.autoMerge,
        checkResult,
        reviewSummary,
        targetBranch: this.config.targetBranch,
        worktreePath,
      });

      return {
        config: this.config,
        worktreePath,
        checkResult,
        reviewSummary,
        markdownReport,
        autoMergeResult,
      };
    } finally {
      if (this.worktreeManager && worktreePath !== Deno.cwd()) {
        await this.worktreeManager.cleanup();
      }
    }
  }
}

export async function main(args: string[] = Deno.args) {
  const parsed = parseReviewerArgs(args);
  const reviewer = new PullRequestReviewer(parsed);
  const result = await reviewer.run();
  console.log(result.markdownReport);
  console.log(`\nAuto-Merge Status: ${result.autoMergeResult.reason}`);
  return result;
}

if (import.meta.main) {
  await main();
}
