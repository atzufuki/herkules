import { CheckResult } from "./checker.ts";
import { ReviewSummary } from "./ai_reviewer.ts";

export interface AutoMergeResult {
  merged: boolean;
  reason: string;
  commitHash?: string;
}

export interface AutoMergeOptions {
  autoMergeEnabled: boolean;
  checkResult: CheckResult;
  reviewSummary: ReviewSummary;
  targetBranch: string;
  worktreePath: string;
}

export class AutoMerger {
  static canMerge(enabled: boolean, checkResult: CheckResult, reviewSummary: ReviewSummary): { allowed: boolean; reason: string } {
    if (!enabled) {
      return { allowed: false, reason: "Auto-merge is disabled in configuration (--auto-merge not set)." };
    }

    if (!checkResult.passed) {
      const details = [];
      if (!checkResult.testPassed) details.push("test suite failed");
      if (!checkResult.lintPassed) details.push("lint checks failed");
      return { allowed: false, reason: `Automated checks failed (${details.join(", ")}).` };
    }

    if (!reviewSummary.approved) {
      return { allowed: false, reason: "AI review flagged blocking issues (bugs or security risks)." };
    }

    return { allowed: true, reason: "All automated tests, lint checks, and AI code review criteria passed." };
  }

  static async executeMerge(options: AutoMergeOptions): Promise<AutoMergeResult> {
    const check = this.canMerge(options.autoMergeEnabled, options.checkResult, options.reviewSummary);
    if (!check.allowed) {
      return {
        merged: false,
        reason: check.reason,
      };
    }

    try {
      const command = new Deno.Command("git", {
        args: ["merge", "--no-ff", "-m", `Merge PR automatically via Herkules AI Reviewer`],
        cwd: options.worktreePath,
        stdout: "piped",
        stderr: "piped",
      });

      const output = await command.output();
      if (output.success) {
        const revParse = new Deno.Command("git", {
          args: ["rev-parse", "HEAD"],
          cwd: options.worktreePath,
          stdout: "piped",
          stderr: "piped",
        });
        const revOutput = await revParse.output();
        const commitHash = new TextDecoder().decode(revOutput.stdout).trim();

        return {
          merged: true,
          reason: "PR successfully merged automatically.",
          commitHash,
        };
      } else {
        const error = new TextDecoder().decode(output.stderr);
        return {
          merged: false,
          reason: `Git merge command failed: ${error}`,
        };
      }
    } catch (err) {
      return {
        merged: false,
        reason: `Auto-merge execution error: ${(err as Error).message}`,
      };
    }
  }
}
