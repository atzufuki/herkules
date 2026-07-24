import { VerificationResult } from "./checker.ts";
import { ReviewSummary } from "./ai_reviewer.ts";

export interface AutoMergeResult {
  merged: boolean;
  reason: string;
}

export class AutoMerger {
  shouldAutoMerge(autoMergeConfig: boolean, verification: VerificationResult, review: ReviewSummary): boolean {
    if (!autoMergeConfig) {
      return false;
    }
    if (!verification.passed) {
      return false;
    }
    if (!review.approved) {
      return false;
    }
    return true;
  }

  async executeMerge(branch: string, targetBranch = "main"): Promise<AutoMergeResult> {
    try {
      const checkoutCmd = new Deno.Command("git", {
        args: ["checkout", targetBranch],
        stdout: "piped",
        stderr: "piped",
      });
      const checkoutOut = await checkoutCmd.output();
      if (!checkoutOut.success) {
        return {
          merged: false,
          reason: `Failed to checkout target branch ${targetBranch}: ${new TextDecoder().decode(checkoutOut.stderr)}`,
        };
      }

      const mergeCmd = new Deno.Command("git", {
        args: ["merge", "--no-ff", branch, "-m", `Auto-merge PR branch ${branch}`],
        stdout: "piped",
        stderr: "piped",
      });
      const mergeOut = await mergeCmd.output();
      if (!mergeOut.success) {
        return {
          merged: false,
          reason: `Merge conflict or failure: ${new TextDecoder().decode(mergeOut.stderr)}`,
        };
      }

      return {
        merged: true,
        reason: `Successfully merged ${branch} into ${targetBranch}.`,
      };
    } catch (err) {
      return {
        merged: false,
        reason: `Auto-merge execution error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
