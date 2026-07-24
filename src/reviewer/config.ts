export interface ReviewerConfig {
  prId?: number | string;
  branch?: string;
  autoMerge?: boolean;
  worktreeDir?: string;
  testCommand?: string;
  lintCommand?: string;
  enableAiReview?: boolean;
}

export function parseReviewerConfig(args: string[] = []): ReviewerConfig {
  const config: ReviewerConfig = {
    autoMerge: false,
    worktreeDir: ".worktrees",
    enableAiReview: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--auto-merge") {
      config.autoMerge = true;
    } else if (arg.startsWith("--pr=")) {
      config.prId = arg.split("=")[1];
    } else if (arg === "--pr" && i + 1 < args.length) {
      config.prId = args[++i];
    } else if (arg.startsWith("--branch=")) {
      config.branch = arg.split("=")[1];
    } else if (arg === "--branch" && i + 1 < args.length) {
      config.branch = args[++i];
    } else if (arg.startsWith("--worktree-dir=")) {
      config.worktreeDir = arg.split("=")[1];
    } else if (arg.startsWith("--test-cmd=")) {
      config.testCommand = arg.split("=")[1];
    }
  }

  return config;
}
