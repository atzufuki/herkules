export interface ReviewerConfig {
  autoMerge: boolean;
  worktreeDir: string;
  testCommand: string;
  lintCommand?: string;
  aiModel: string;
  githubToken?: string;
  autoMergeThresholdScore: number;
}

export const defaultConfig: ReviewerConfig = {
  autoMerge: false,
  worktreeDir: ".worktrees",
  testCommand: "deno task test",
  lintCommand: "deno lint",
  aiModel: "herkules-ai-v1",
  autoMergeThresholdScore: 80,
};

export function parseArgs(args: string[]): ReviewerConfig {
  const config: ReviewerConfig = { ...defaultConfig };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--auto-merge") {
      config.autoMerge = true;
    } else if (arg.startsWith("--auto-merge=")) {
      config.autoMerge = arg.split("=")[1] === "true";
    } else if (arg === "--worktree-dir" && i + 1 < args.length) {
      config.worktreeDir = args[++i];
    } else if (arg.startsWith("--worktree-dir=")) {
      config.worktreeDir = arg.split("=")[1];
    } else if (arg === "--test-cmd" && i + 1 < args.length) {
      config.testCommand = args[++i];
    } else if (arg.startsWith("--test-cmd=")) {
      config.testCommand = arg.split("=")[1];
    } else if (arg === "--lint-cmd" && i + 1 < args.length) {
      config.lintCommand = args[++i];
    } else if (arg.startsWith("--lint-cmd=")) {
      config.lintCommand = arg.split("=")[1];
    } else if (arg === "--ai-model" && i + 1 < args.length) {
      config.aiModel = args[++i];
    } else if (arg.startsWith("--ai-model=")) {
      config.aiModel = arg.split("=")[1];
    }
  }

  return config;
}

export function loadConfig(overrides?: Partial<ReviewerConfig>): ReviewerConfig {
  return {
    ...defaultConfig,
    ...overrides,
  };
}
