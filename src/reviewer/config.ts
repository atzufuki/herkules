export interface ReviewerConfig {
  prId: string | number;
  branch: string;
  targetBranch: string;
  autoMerge: boolean;
  worktreeDir: string;
  testCommand: string;
  lintCommand: string;
  aiModel: string;
  repoPath: string;
}

export const DEFAULT_CONFIG: ReviewerConfig = {
  prId: "1",
  branch: "feature/pr-branch",
  targetBranch: "main",
  autoMerge: false,
  worktreeDir: ".worktrees",
  testCommand: "deno task test",
  lintCommand: "deno lint",
  aiModel: "herkules-review-v1",
  repoPath: ".",
};

export function parseConfig(
  input?: string[] | Partial<ReviewerConfig>
): ReviewerConfig {
  if (!input) {
    return { ...DEFAULT_CONFIG };
  }

  if (Array.isArray(input)) {
    const config: ReviewerConfig = { ...DEFAULT_CONFIG };
    for (let i = 0; i < input.length; i++) {
      const arg = input[i];
      if (arg === "--auto-merge" || arg === "-m") {
        config.autoMerge = true;
      } else if (arg.startsWith("--auto-merge=")) {
        config.autoMerge = arg.split("=")[1] === "true";
      } else if (arg === "--pr" || arg === "--pr-id") {
        config.prId = input[++i] || config.prId;
      } else if (arg.startsWith("--pr=")) {
        config.prId = arg.split("=")[1];
      } else if (arg === "--branch" || arg === "-b") {
        config.branch = input[++i] || config.branch;
      } else if (arg.startsWith("--branch=")) {
        config.branch = arg.split("=")[1];
      } else if (arg === "--target-branch" || arg === "-t") {
        config.targetBranch = input[++i] || config.targetBranch;
      } else if (arg.startsWith("--target-branch=")) {
        config.targetBranch = arg.split("=")[1];
      } else if (arg === "--test-cmd") {
        config.testCommand = input[++i] || config.testCommand;
      } else if (arg.startsWith("--test-cmd=")) {
        config.testCommand = arg.split("=")[1];
      } else if (arg === "--lint-cmd") {
        config.lintCommand = input[++i] || config.lintCommand;
      } else if (arg.startsWith("--lint-cmd=")) {
        config.lintCommand = arg.split("=")[1];
      } else if (arg === "--worktree-dir") {
        config.worktreeDir = input[++i] || config.worktreeDir;
      } else if (arg.startsWith("--worktree-dir=")) {
        config.worktreeDir = arg.split("=")[1];
      }
    }
    return config;
  }

  return {
    ...DEFAULT_CONFIG,
    ...input,
  };
}
