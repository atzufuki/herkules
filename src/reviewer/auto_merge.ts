import { VerificationResult } from "./checker.ts";
import { ReviewSummary } from "./ai_reviewer.ts";

export interface AutoMergeOptions {
  enabled: boolean;
  prId: number | string;
  branch: string;
  baseBranch?: string;
}

export interface AutoMergeResult {
  merged: boolean;
  reason: string;
  timestamp: string;
}

export function evaluateAutoMergeEligibility(
  config: { autoMerge?: boolean },
  verificationResult: VerificationResult,
  aiReviewResult: ReviewSummary
): { eligible: boolean; reason: string } {
  if (!config.autoMerge) {
    return { eligible: false, reason: "Auto-merge is disabled in configuration." };
  }

  if (!verificationResult.passed) {
    return { eligible: false, reason: "Automated verification checks (tests/lint) failed." };
  }

  if (!aiReviewResult.passed) {
    return { eligible: false, reason: "AI review failed with unresolved issues." };
  }

  return { eligible: true, reason: "All automated verification checks and AI code reviews passed." };
}

export async function attemptAutoMerge(
  options: AutoMergeOptions,
  verificationResult: VerificationResult,
  aiReviewResult: ReviewSummary
): Promise<AutoMergeResult> {
  const timestamp = new Date().toISOString();
  const eligibility = evaluateAutoMergeEligibility(
    { autoMerge: options.enabled },
    verificationResult,
    aiReviewResult
  );

  if (!eligibility.eligible) {
    return {
      merged: false,
      reason: eligibility.reason,
      timestamp,
    };
  }

  try {
    const base = options.baseBranch || "main";
    const command = new Deno.Command("git", {
      args: ["merge", "--no-ff", options.branch, "-m", `Auto-merged PR #${options.prId}`],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await command.output();
    if (output.success) {
      return {
        merged: true,
        reason: `Successfully auto-merged PR #${options.prId} into ${base}.`,
        timestamp,
      };
    } else {
      const stderr = new TextDecoder().decode(output.stderr);
      return {
        merged: false,
        reason: `Git merge execution failed: ${stderr.trim()}`,
        timestamp,
      };
    }
  } catch (err) {
    return {
      merged: false,
      reason: `Auto-merge error: ${err instanceof Error ? err.message : String(err)}`,
      timestamp,
    };
  }
}
