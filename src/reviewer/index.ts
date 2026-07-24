import { parseReviewerConfig, ReviewerConfig } from "./config.ts";
import { WorktreeManager, WorktreeInfo } from "./worktree.ts";
import { CodeChecker, VerificationResult } from "./checker.ts";
import { AIReviewer, AIReviewResult } from "./ai_reviewer.ts";
import { AutoMerger, AutoMergeResult } from "./auto_merge.ts";

export * from "./config.ts";
export * from "./worktree.ts";
export * from "./checker.ts";
export * from "./ai_reviewer.ts";
export * from "./auto_merge.ts";

export interface WorkflowOptions {
  args?: string[];
  env?: Record<string, string>;
  config?: Partial<ReviewerConfig>;
  diffOverride?: string;
  verificationOverride?: VerificationResult;
}

export interface ReviewWorkflowResult {
  config: ReviewerConfig;
  worktree?: WorktreeInfo;
  verification: VerificationResult;
  review: AIReviewResult;
  autoMerge: AutoMergeResult | null;
  success: boolean;
}

export async function runReviewerWorkflow(
  options: WorkflowOptions = {}
): Promise<ReviewWorkflowResult> {
  const parsedConfig = parseReviewerConfig(options.args || [], options.env || {});
  const config: ReviewerConfig = { ...parsedConfig, ...options.config };

  const prId = config.prNumber || "latest";
  const worktreeManager = new WorktreeManager(config.worktreeDir);
  const checker = new CodeChecker();
  const aiReviewer = new AIReviewer();
  const autoMerger = new AutoMerger();

  let worktree: WorktreeInfo | undefined;
  let verification: VerificationResult;
  let review: AIReviewResult;
  let autoMergeResult: AutoMergeResult | null = null;

  try {
    worktree = await worktreeManager.setupWorktree(prId, config.branch);

    if (options.verificationOverride) {
      verification = options.verificationOverride;
    } else {
      verification = await checker.runVerification(worktree.path, config);
    }

    const diff = options.diffOverride ?? (await aiReviewer.getPRDiff(worktree.path, config.targetBranch));
    review = await aiReviewer.reviewDiff(diff, {
      minScore: config.minReviewScore,
      model: config.aiModel,
    });

    const canMerge = autoMerger.canAutoMerge(verification, review, config);
    if (canMerge) {
      autoMergeResult = await autoMerger.executeAutoMerge(prId, {
        worktreePath: worktree.path,
        targetBranch: config.targetBranch,
        sourceBranch: config.branch,
        githubToken: config.githubToken,
        repo: config.repo,
      });
    }

    const overallSuccess = verification.success && review.passed;

    return {
      config,
      worktree,
      verification,
      review,
      autoMerge: autoMergeResult,
      success: overallSuccess,
    };
  } finally {
    if (worktree) {
      await worktree.cleanup();
    }
  }
}
