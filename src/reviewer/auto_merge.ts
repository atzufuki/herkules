import { ReviewerConfig } from "./config.ts";
import { CheckResult } from "./checker.ts";
import { ReviewSummary } from "./ai_reviewer.ts";

export interface AutoMergeResult {
  merged: boolean;
  method?: "merge" | "squash" | "rebase";
  message: string;
}

export interface AutoMergeExecutor {
  merge(prId: number | string, method: "merge" | "squash" | "rebase"): Promise<boolean>;
}

export class DefaultAutoMergeExecutor implements AutoMergeExecutor {
  async merge(_prId: number | string, _method: "merge" | "squash" | "rebase"): Promise<boolean> {
    return true;
  }
}

export class AutoMerger {
  private executor: AutoMergeExecutor;

  constructor(executor?: AutoMergeExecutor) {
    this.executor = executor || new DefaultAutoMergeExecutor();
  }

  canAutoMerge(checkResult: CheckResult, reviewSummary: ReviewSummary, config: ReviewerConfig): boolean {
    if (!config.autoMerge) {
      return false;
    }

    if (!checkResult.success) {
      return false;
    }

    if (!reviewSummary.approved) {
      return false;
    }

    if (reviewSummary.score < config.autoMergeThresholdScore) {
      return false;
    }

    if (reviewSummary.securityCount > 0) {
      return false;
    }

    return true;
  }

  async executeAutoMerge(
    prId: number | string,
    checkResult: CheckResult,
    reviewSummary: ReviewSummary,
    config: ReviewerConfig,
    method: "merge" | "squash" | "rebase" = "squash"
  ): Promise<AutoMergeResult> {
    const eligible = this.canAutoMerge(checkResult, reviewSummary, config);

    if (!eligible) {
      if (!config.autoMerge) {
        return {
          merged: false,
          message: "Auto-merge is disabled by configuration.",
        };
      }
      return {
        merged: false,
        message: "PR did not meet auto-merge requirements (failed tests or review score too low).",
      };
    }

    const success = await this.executor.merge(prId, method);
    if (success) {
      return {
        merged: true,
        method,
        message: `Successfully auto-merged PR #${prId} via ${method}.`,
      };
    } else {
      return {
        merged: false,
        message: `Failed to execute auto-merge API for PR #${prId}.`,
      };
    }
  }
}
