import { parseReviewerConfig, ReviewerConfig } from "./config.ts";
import { WorktreeManager, WorktreeInfo } from "./worktree.ts";
import { runVerification, VerificationResult } from "./checker.ts";
import { analyzeDiff, ReviewSummary } from "./ai_reviewer.ts";
import { canAutoMerge, executeAutoMerge, AutoMergeResult } from "./auto_merge.ts";

export interface ReviewerOutput {
  prNumber: number;
  worktree: WorktreeInfo;
  verification: VerificationResult;
  review: ReviewSummary;
  autoMerge: AutoMergeResult;
}

export async function runReviewer(
  rawConfig: ReviewerConfig | string[] | Record<string, unknown> = {}
): Promise<ReviewerOutput> {
  const config = Array.isArray(rawConfig) || !("worktreeDir" in rawConfig)
    ? parseReviewerConfig(rawConfig as any)
    : (rawConfig as ReviewerConfig);

  const prNumber = config.prNumber ?? 1;
  const branch = config.branch ?? `feature/pr-${prNumber}`;

  const worktreeManager = new WorktreeManager(config.worktreeDir);
  const worktree = await worktreeManager.createWorktree(prNumber, branch);

  let verification: VerificationResult;
  let diffText = "";

  try {
    verification = await runVerification(
      worktree.path,
      config.testCommand,
      config.lintCommand
    );

    try {
      const diffCmd = new Deno.Command("git", {
        args: ["diff", "HEAD~1...HEAD"],
        cwd: worktree.path,
        stdout: "piped",
        stderr: "piped",
      });
      const diffOutput = await diffCmd.output();
      if (diffOutput.success) {
        diffText = new TextDecoder().decode(diffOutput.stdout);
      }
    } catch {
      diffText = "";
    }
  } finally {
    await worktreeManager.removeWorktree(worktree.path);
  }

  const review = analyzeDiff(diffText);

  const autoMergeEvaluation = canAutoMerge(verification, review, config);
  let autoMergeResult: AutoMergeResult;

  if (autoMergeEvaluation.allowed) {
    autoMergeResult = await executeAutoMerge(prNumber, branch, config);
  } else {
    autoMergeResult = {
      merged: false,
      reason: autoMergeEvaluation.reason,
    };
  }

  return {
    prNumber,
    worktree,
    verification,
    review,
    autoMerge: autoMergeResult,
  };
}

export {
  parseReviewerConfig,
  WorktreeManager,
  runVerification,
  analyzeDiff,
  canAutoMerge,
  executeAutoMerge,
};
export type { ReviewerConfig, VerificationResult, ReviewSummary, AutoMergeResult };
