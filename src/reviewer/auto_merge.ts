import { AIReviewResult } from "./ai_reviewer.ts";
import { VerificationResult } from "./checker.ts";

export interface AutoMergeOptions {
  enabled: boolean;
  prId: string | number;
  branch: string;
  targetBranch?: string;
  worktreePath?: string;
  execFn?: (cmd: string, cwd: string) => Promise<{ success: boolean; stdout: string; stderr: string }>;
}

export interface AutoMergeResult {
  merged: boolean;
  reason: string;
  commitHash?: string;
}

export async function evaluateAndAutoMerge(
  verification: VerificationResult,
  review: AIReviewResult,
  options: AutoMergeOptions
): Promise<AutoMergeResult> {
  if (!options.enabled) {
    return {
      merged: false,
      reason: "Auto-merge is disabled (--auto-merge flag not set).",
    };
  }

  if (!verification.passed) {
    return {
      merged: false,
      reason: "Auto-merge skipped: Automated test/lint verification checks failed.",
    };
  }

  if (!review.approved) {
    return {
      merged: false,
      reason: "Auto-merge skipped: AI Code Review found bugs, security risks, or unapproved code changes.",
    };
  }

  const cwd = options.worktreePath || ".";
  const targetBranch = options.targetBranch || "main";

  try {
    if (options.execFn) {
      const res = await options.execFn(`git merge --no-ff ${options.branch} -m "auto-merge: PR #${options.prId}"`, cwd);
      if (res.success) {
        return {
          merged: true,
          reason: `PR #${options.prId} successfully auto-merged into ${targetBranch}.`,
          commitHash: "auto-merged-commit-hash",
        };
      } else {
        return {
          merged: false,
          reason: `Auto-merge git execution failed: ${res.stderr || "Unknown error"}`,
        };
      }
    }

    const cmd = new Deno.Command("git", {
      args: ["merge", "--no-ff", options.branch, "-m", `auto-merge: PR #${options.prId}`],
      cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (output.success) {
      return {
        merged: true,
        reason: `PR #${options.prId} successfully auto-merged into ${targetBranch}.`,
        commitHash: "auto-merged-commit-hash",
      };
    } else {
      const decoder = new TextDecoder();
      return {
        merged: false,
        reason: `Auto-merge git execution failed: ${decoder.decode(output.stderr)}`,
      };
    }
  } catch (err) {
    return {
      merged: false,
      reason: `Auto-merge error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
