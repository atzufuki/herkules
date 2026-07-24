import { parseConfig, ReviewerConfig } from "./config.ts";
import { WorktreeManager, WorktreeInfo } from "./worktree.ts";
import { CodeChecker, CheckResult } from "./checker.ts";
import { AIReviewer, ReviewResult } from "./ai_reviewer.ts";
import { AutoMerger, AutoMergeResult, PRReviewStatus } from "./auto_merge.ts";

export interface ReviewPipelineResult {
  prId: number | string;
  branch: string;
  worktree: WorktreeInfo;
  checkResult: CheckResult;
  aiResult: ReviewResult;
  autoMergeResult: AutoMergeResult;
  overallPassed: boolean;
}

export class PRReviewer {
  private config: ReviewerConfig;
  private worktreeMgr: WorktreeManager;
  private checker: CodeChecker;
  private aiReviewer: AIReviewer;
  private autoMerger: AutoMerger;

  constructor(config?: Partial<ReviewerConfig>) {
    this.config = {
      ...parseConfig(),
      ...config,
    };
    this.worktreeMgr = new WorktreeManager(this.config.worktreeDir);
    this.checker = new CodeChecker();
    this.aiReviewer = new AIReviewer(this.config.aiModel);
    this.autoMerger = new AutoMerger();
  }

  async reviewPR(prId: number | string, branch: string): Promise<ReviewPipelineResult> {
    let worktreeInfo: WorktreeInfo | null = null;
    try {
      worktreeInfo = await this.worktreeMgr.createWorktree(prId, branch);

      const checkResult = await this.checker.runChecks(worktreeInfo.path, {
        testCommand: this.config.testCommand,
        lintCommand: this.config.lintCommand,
      });

      const diffText = await this.aiReviewer.getDiff(worktreeInfo.path);
      const aiResult = await this.aiReviewer.reviewDiff(diffText);

      const status: PRReviewStatus = {
        prId,
        branch,
        testPassed: checkResult.testPassed,
        lintPassed: checkResult.lintPassed,
        aiPassed: aiResult.passed,
        score: aiResult.score,
      };

      const autoMergeResult = await this.autoMerger.mergePR(
        status,
        this.config.autoMerge,
        worktreeInfo.path
      );

      const overallPassed = checkResult.passed && aiResult.passed;

      return {
        prId,
        branch,
        worktree: worktreeInfo,
        checkResult,
        aiResult,
        autoMergeResult,
        overallPassed,
      };
    } finally {
      if (worktreeInfo) {
        await this.worktreeMgr.removeWorktree(worktreeInfo.path);
      }
    }
  }
}

export * from "./config.ts";
export * from "./worktree.ts";
export * from "./checker.ts";
export * from "./ai_reviewer.ts";
export * from "./auto_merge.ts";
