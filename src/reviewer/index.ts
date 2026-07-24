import { ReviewerConfig, defaultConfig } from "./config.ts";
import { createWorktree, cleanupWorktree, WorktreeInfo } from "./worktree.ts";
import { runVerification, VerificationResult } from "./checker.ts";
import { generateAIReview, ReviewSummary } from "./ai_reviewer.ts";
import { attemptAutoMerge, AutoMergeResult, evaluateAutoMergeEligibility } from "./auto_merge.ts";

export * from "./config.ts";
export * from "./worktree.ts";
export * from "./checker.ts";
export * from "./ai_reviewer.ts";
export * from "./auto_merge.ts";

export interface ReviewResult {
  prId: number | string;
  branch: string;
  worktree: WorktreeInfo | null;
  verification: VerificationResult;
  aiReview: ReviewSummary;
  autoMerge: AutoMergeResult;
  success: boolean;
}

export async function getGitDiff(branch: string, baseBranch: string = "main"): Promise<string> {
  try {
    const command = new Deno.Command("git", {
      args: ["diff", `${baseBranch}...${branch}`],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    if (output.success) {
      return new TextDecoder().decode(output.stdout);
    }
  } catch {
    // Git diff fallback
  }
  return "";
}

export async function runReviewer(options: Partial<ReviewerConfig> = {}): Promise<ReviewResult> {
  const config: ReviewerConfig = { ...defaultConfig(), ...options };
  const prId = config.prId ?? "0";
  const branch = config.branch ?? "HEAD";
  const baseBranch = config.baseBranch ?? "main";

  let worktree: WorktreeInfo | null = null;
  let verification: VerificationResult = {
    passed: true,
    checks: [],
    summary: "No verification checks executed.",
  };
  let aiReview: ReviewSummary = {
    passed: true,
    overallScore: 100,
    summary: "No AI review executed.",
    highlights: { bugs: [], securityRisks: [], styleImprovements: [] },
    inlineComments: [],
  };
  let autoMerge: AutoMergeResult = {
    merged: false,
    reason: "Auto-merge not evaluated.",
    timestamp: new Date().toISOString(),
  };

  try {
    if (config.prId && config.branch) {
      try {
        worktree = await createWorktree({
          prId,
          branch,
          baseDir: config.worktreeDir,
        });
      } catch (err) {
        console.warn(`Worktree setup skipped or failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const worktreePath = worktree ? worktree.path : ".";

    verification = await runVerification({
      worktreePath,
      testCommand: config.testCommand,
      lintCommand: config.lintCommand,
      runTests: config.runTests,
      runLint: config.runLint,
    });

    const diff = await getGitDiff(branch, baseBranch);
    aiReview = await generateAIReview({
      diff,
      apiKey: config.apiKey,
      model: config.model,
    });

    if (config.autoMerge) {
      autoMerge = await attemptAutoMerge(
        {
          enabled: true,
          prId,
          branch,
          baseBranch,
        },
        verification,
        aiReview
      );
    } else {
      const eligibility = evaluateAutoMergeEligibility(config, verification, aiReview);
      autoMerge = {
        merged: false,
        reason: eligibility.reason,
        timestamp: new Date().toISOString(),
      };
    }
  } finally {
    if (worktree) {
      await cleanupWorktree(worktree);
    }
  }

  const success = verification.passed && aiReview.passed;

  return {
    prId,
    branch,
    worktree,
    verification,
    aiReview,
    autoMerge,
    success,
  };
}
