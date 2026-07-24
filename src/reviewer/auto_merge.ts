import { CheckResult } from './checker.ts';
import { AIReviewResult } from './ai_reviewer.ts';
import { ReviewerConfig } from './config.ts';

export interface AutoMergeResult {
  attempted: boolean;
  merged: boolean;
  method?: string;
  reason: string;
}

export class AutoMerger {
  canAutoMerge(
    checkResult: CheckResult,
    aiResult: AIReviewResult,
    config: ReviewerConfig
  ): boolean {
    if (!config.autoMerge) {
      return false;
    }

    const testPassed = checkResult.success;
    const aiPassed = aiResult.passed && aiResult.score >= config.minApprovalScore;

    return testPassed && aiPassed;
  }

  async executeAutoMerge(
    prNumber: number | string,
    targetBranch = 'main',
    config: ReviewerConfig
  ): Promise<AutoMergeResult> {
    if (!config.autoMerge) {
      return {
        attempted: false,
        merged: false,
        reason: 'Auto-merge is disabled in configuration.',
      };
    }

    try {
      const ghCmd = new Deno.Command('gh', {
        args: ['pr', 'merge', String(prNumber), `--${config.autoMergeMethod}`, '--auto'],
        stdout: 'piped',
        stderr: 'piped',
      });

      const ghRes = await ghCmd.output();
      if (ghRes.success) {
        return {
          attempted: true,
          merged: true,
          method: config.autoMergeMethod,
          reason: `Successfully scheduled/executed auto-merge via GitHub CLI using ${config.autoMergeMethod}`,
        };
      }
    } catch {
      // GitHub CLI unavailable
    }

    try {
      const gitCmd = new Deno.Command('git', {
        args: ['merge', '--no-ff', `pr-${prNumber}`, '-m', `Auto-merge PR #${prNumber}`],
        stdout: 'piped',
        stderr: 'piped',
      });

      const gitRes = await gitCmd.output();
      if (gitRes.success) {
        return {
          attempted: true,
          merged: true,
          method: 'git-merge',
          reason: `Merged PR #${prNumber} into ${targetBranch} via git merge`,
        };
      }
    } catch {
      // Git command execution failed
    }

    return {
      attempted: true,
      merged: false,
      reason: `Failed to auto-merge PR #${prNumber}. Manual merge required.`,
    };
  }
}
