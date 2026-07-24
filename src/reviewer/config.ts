export interface ReviewerConfig {
  prNumber?: number;
  branch: string;
  targetBranch: string;
  autoMerge: boolean;
  worktreeDir: string;
  testCommand: string;
  lintCommand: string;
  aiModel: string;
  githubToken?: string;
  repo?: string;
  minReviewScore: number;
}

export function parseReviewerConfig(
  args: string[] = [],
  env: Record<string, string> = {}
): ReviewerConfig {
  const config: ReviewerConfig = {
    prNumber: undefined,
    branch: "main",
    targetBranch: "main",
    autoMerge: false,
    worktreeDir: ".worktrees",
    testCommand: "deno task test",
    lintCommand: "deno lint",
    aiModel: env.AI_MODEL || "gpt-4o",
    githubToken: env.GITHUB_TOKEN || env.GH_TOKEN,
    repo: env.GITHUB_REPOSITORY,
    minReviewScore: 70,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--auto-merge" || arg === "--autoMerge") {
      config.autoMerge = true;
    } else if (arg.startsWith("--auto-merge=")) {
      config.autoMerge = arg.split("=")[1] === "true";
    } else if (arg === "--pr" || arg === "--pr-number") {
      config.prNumber = parseInt(args[++i], 10);
    } else if (arg.startsWith("--pr=")) {
      config.prNumber = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--branch") {
      config.branch = args[++i];
    } else if (arg.startsWith("--branch=")) {
      config.branch = arg.split("=")[1];
    } else if (arg === "--target-branch") {
      config.targetBranch = args[++i];
    } else if (arg.startsWith("--target-branch=")) {
      config.targetBranch = arg.split("=")[1];
    } else if (arg === "--worktree-dir") {
      config.worktreeDir = args[++i];
    } else if (arg.startsWith("--worktree-dir=")) {
      config.worktreeDir = arg.split("=")[1];
    } else if (arg === "--test-cmd") {
      config.testCommand = args[++i];
    } else if (arg.startsWith("--test-cmd=")) {
      config.testCommand = arg.split("=")[1];
    } else if (arg === "--lint-cmd") {
      config.lintCommand = args[++i];
    } else if (arg.startsWith("--lint-cmd=")) {
      config.lintCommand = arg.split("=")[1];
    } else if (arg === "--min-score") {
      config.minReviewScore = parseInt(args[++i], 10);
    } else if (arg.startsWith("--min-score=")) {
      config.minReviewScore = parseInt(arg.split("=")[1], 10);
    }
  }

  if (env.HERKULES_AUTO_MERGE === "true" || env.AUTO_MERGE === "true") {
    config.autoMerge = true;
  }

  return config;
}
