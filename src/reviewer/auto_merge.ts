import { VerificationResult } from "./checker.ts";
import { ReviewSummary } from "./ai_reviewer.ts";
import { ReviewerConfig } from "./config.ts";

export interface AutoMergeResult {
  merged: boolean;
  reason: string;
  commitHash?: string;
}

export function canAutoMerge(
  verification: VerificationResult,
  review: ReviewSummary,
  config: ReviewerConfig
): { allowed: boolean; reason: string } {
  if (!config.autoMerge) {
    return { allowed: false, reason: "Auto-merge is disabled by configuration (--auto-merge not set)." };
  }

  if (!verification.success) {
    return {
      allowed: false,
      reason: `Automated verification checks failed: ${verification.errors.join("; ")}`,
    };
  }

  if (!review.approved) {
    return {
      allowed: false,
      reason: `AI review did not approve PR (Score: ${review.score}/${config.minScoreToMerge ?? 80}).`,
    };
  }

  if (review.score < (config.minScoreToMerge ?? 80)) {
    return {
      allowed: false,
      reason: `AI review score (${review.score}) is below minimum threshold (${config.minScoreToMerge ?? 80}).`,
    };
  }

  return { allowed: true, reason: "All tests, lint checks, and AI review passed." };
}

export async function executeAutoMerge(
  prNumber: number,
  branch: string,
  _config: ReviewerConfig
): Promise<AutoMergeResult> {
  try {
    const cmd = new Deno.Command("git", {
      args: ["merge", "--no-ff", branch, "-m", `Auto-merge PR #${prNumber} via @herkules/reviewer`],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (output.success) {
      const stdout = new TextDecoder().decode(output.stdout);
      return {
        merged: true,
        reason: "PR branch successfully merged into target branch.",
        commitHash: stdout.trim(),
      };
    } else {
      const stderr = new TextDecoder().decode(output.stderr);
      return {
        merged: false,
        reason: `Git merge failed: ${stderr}`,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      merged: false,
      reason: `Merge execution error: ${msg}`,
    };
  }
}
