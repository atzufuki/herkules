import { parseConfig, ReviewerConfig } from "./config.ts";
import { createWorktree, WorktreeInfo } from "./worktree.ts";
import { runChecks, VerificationResult, CheckerOptions } from "./checker.ts";
import { analyzeDiff, AIReviewResult, ReviewerAIConfig } from "./ai_reviewer.ts";
import { evaluateAndAutoMerge, AutoMergeResult } from "./auto_merge.ts";

export * from "./config.ts";
export * from "./worktree.ts";
export * from "./checker.ts";
export * from "./ai_reviewer.ts";
export * from "./auto_merge.ts";

export interface ReviewReport {
  prId: string | number;
  branch: string;
  targetBranch: string;
  worktreePath: string;
  verification: VerificationResult;
  review: AIReviewResult;
  autoMerge: AutoMergeResult;
  completedAt: string;
}

export interface ReviewerOptions {
  config?: Partial<ReviewerConfig> | string[];
  checkerOptions?: CheckerOptions;
  aiConfig?: ReviewerAIConfig;
}

export async function runReviewer(
  options: ReviewerOptions | Partial<ReviewerConfig> | string[] = {}
): Promise<ReviewReport> {
  let configInput: Partial<ReviewerConfig> | string[] | undefined;
  let checkerOptions: CheckerOptions | undefined;
  let aiConfig: ReviewerAIConfig | undefined;

  if (
    typeof options === "object" &&
    !Array.isArray(options) &&
    ("config" in options || "checkerOptions" in options || "aiConfig" in options)
  ) {
    const opts = options as ReviewerOptions;
    configInput = opts.config;
    checkerOptions = opts.checkerOptions;
    aiConfig = opts.aiConfig;
  } else {
    configInput = options as Partial<ReviewerConfig> | string[];
  }

  const config = parseConfig(configInput);

  let worktree: WorktreeInfo | null = null;
  let worktreePath = "";

  try {
    // 1. Prepare isolated worktree
    worktree = await createWorktree(config.prId, config.branch, config.worktreeDir);
    worktreePath = worktree.path;

    // 2. Automated test and lint checks
    const verification = await runChecks(worktreePath, {
      testCommand: config.testCommand,
      lintCommand: config.lintCommand,
      ...checkerOptions,
    });

    // 3. AI Code Review
    const review = await analyzeDiff(worktreePath, config.targetBranch, aiConfig);

    // 4. Configurable auto-merge evaluation
    const autoMerge = await evaluateAndAutoMerge(verification, review, {
      enabled: config.autoMerge,
      prId: config.prId,
      branch: config.branch,
      targetBranch: config.targetBranch,
      worktreePath: worktreePath,
      execFn: checkerOptions?.execFn,
    });

    return {
      prId: config.prId,
      branch: config.branch,
      targetBranch: config.targetBranch,
      worktreePath,
      verification,
      review,
      autoMerge,
      completedAt: new Date().toISOString(),
    };
  } finally {
    if (worktree) {
      await worktree.cleanup();
    }
  }
}
