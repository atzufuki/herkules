export interface AutoMergeResult {
  merged: boolean;
  reason: string;
}

export interface PRReviewStatus {
  prId: number | string;
  branch: string;
  testPassed: boolean;
  lintPassed: boolean;
  aiPassed: boolean;
  score: number;
}

export class AutoMerger {
  canAutoMerge(status: PRReviewStatus, autoMergeEnabled: boolean): { eligible: boolean; reason: string } {
    if (!autoMergeEnabled) {
      return { eligible: false, reason: "Auto-merge is disabled in configuration." };
    }
    if (!status.testPassed) {
      return { eligible: false, reason: "Automated test suite failed." };
    }
    if (!status.lintPassed) {
      return { eligible: false, reason: "Linter check failed." };
    }
    if (!status.aiPassed) {
      return { eligible: false, reason: "AI code review did not pass (bugs or security issues found)." };
    }
    return { eligible: true, reason: "All automated tests, lint checks, and AI code review passed." };
  }

  async mergePR(
    status: PRReviewStatus,
    autoMergeEnabled: boolean,
    worktreePath?: string
  ): Promise<AutoMergeResult> {
    const check = this.canAutoMerge(status, autoMergeEnabled);
    if (!check.eligible) {
      return { merged: false, reason: check.reason };
    }

    if (worktreePath) {
      try {
        const command = new Deno.Command("git", {
          args: ["merge", "--no-ff", "-m", `Auto-merged PR #${status.prId}`],
          cwd: worktreePath,
          stdout: "piped",
          stderr: "piped",
        });
        const output = await command.output();
        if (!output.success) {
          const stderr = new TextDecoder().decode(output.stderr);
          return { merged: false, reason: `Git merge failed: ${stderr}` };
        }
      } catch (err) {
        return {
          merged: false,
          reason: `Execution failed during merge: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    return {
      merged: true,
      reason: `PR #${status.prId} successfully auto-merged after passing all verification checks.`,
    };
  }
}
