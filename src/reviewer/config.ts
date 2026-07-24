export interface ReviewerConfig {
  prId: string | number;
  branch: string;
  targetBranch: string;
  autoMerge: boolean;
  worktreesDir: string;
  testCommand?: string;
  lintCommand?: string;
  aiApiKey?: string;
}

export function parseReviewerArgs(args: string[]): Partial<ReviewerConfig> {
  const config: Partial<ReviewerConfig> = {
    autoMerge: false,
    worktreesDir: ".worktrees",
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
    } else if (arg.startsWith("--target=")) {
      config.targetBranch = arg.split("=")[1];
    } else if (arg === "--target" && i + 1 < args.length) {
      config.targetBranch = args[++i];
    } else if (arg.startsWith("--worktrees-dir=")) {
      config.worktreesDir = arg.split("=")[1];
    } else if (arg === "--test-cmd" && i + 1 < args.length) {
      config.testCommand = args[++i];
    } else if (arg === "--lint-cmd" && i + 1 < args.length) {
      config.lintCommand = args[++i];
    }
  }

  return config;
}

export function resolveConfig(options: Partial<ReviewerConfig>): ReviewerConfig {
  return {
    prId: options.prId ?? "1",
    branch: options.branch ?? "feature-branch",
    targetBranch: options.targetBranch ?? "main",
    autoMerge: options.autoMerge ?? false,
    worktreesDir: options.worktreesDir ?? ".worktrees",
    testCommand: options.testCommand,
    lintCommand: options.lintCommand,
    aiApiKey: options.aiApiKey ?? Deno.env.get("OPENAI_API_KEY") ?? Deno.env.get("HERKULES_AI_KEY"),
  };
}
