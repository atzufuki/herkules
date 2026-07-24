import { ReviewerConfig, parseReviewerConfig } from "./config.ts";
import { WorktreeManager, WorktreeInfo } from "./worktree.ts";
import { CodeChecker, VerificationResult } from "./checker.ts";
import { AiReviewer, ReviewSummary } from "./ai_reviewer.ts";
import { AutoMerger, AutoMergeResult } from "./auto_merge.ts";

export interface ReviewerRunResult {
  prId: string | number;
  worktree: WorktreeInfo;
  verification: VerificationResult;
  review: ReviewSummary;
  autoMergeResult?: AutoMergeResult;
  success: boolean;
}

export class PrReviewer {
  private config: ReviewerConfig;
  private worktreeMgr: WorktreeManager;
  private checker: CodeChecker;
  private aiReviewer: AiReviewer;
  private autoMerger: AutoMerger;

  constructor(config: ReviewerConfig) {
    this.config = config;
    this.worktreeMgr = new WorktreeManager(config.worktreeDir || ".worktrees");
    this.checker = new CodeChecker();
    this.aiReviewer = new AiReviewer();
    this.autoMerger = new AutoMerger();
  }

  async run(): Promise<ReviewerRunResult> {
    const prId = this.config.prId || "current";
    const branch = this.config.branch || "HEAD";

    const worktree = await this.worktreeMgr.createWorktree(prId, branch);

    try {
      const verification = await this.checker.runVerification(
        worktree.path,
        this.config.testCommand,
        this.config.lintCommand
      );

      const diff = await this.aiReviewer.getDiff();
      const review = await this.aiReviewer.analyzeDiff(diff);

      let autoMergeResult: AutoMergeResult | undefined;
      if (this.config.autoMerge) {
        if (this.autoMerger.shouldAutoMerge(true, verification, review)) {
          autoMergeResult = await this.autoMerger.executeMerge(branch);
        } else {
          autoMergeResult = {
            merged: false,
            reason: "Auto-merge skipped because automated checks or AI review failed.",
          };
        }
      }

      const success = verification.passed && review.approved && (!this.config.autoMerge || autoMergeResult?.merged === true);

      return {
        prId,
        worktree,
        verification,
        review,
        autoMergeResult,
        success,
      };
    } finally {
      await this.worktreeMgr.removeWorktree(worktree.path);
    }
  }
}

export { parseReviewerConfig, WorktreeManager, CodeChecker, AiReviewer, AutoMerger };
