export interface ReviewerConfig {
  prId?: number | string;
  branch?: string;
  baseBranch?: string;
  worktreeDir?: string;
  autoMerge?: boolean;
  runTests?: boolean;
  runLint?: boolean;
  testCommand?: string;
  lintCommand?: string;
  aiProvider?: string;
  apiKey?: string;
  model?: string;
}

export function defaultConfig(): ReviewerConfig {
  return {
    baseBranch: "main",
    worktreeDir: ".worktrees",
    autoMerge: false,
    runTests: true,
    runLint: true,
    testCommand: "deno task test",
    lintCommand: "deno lint",
    aiProvider: "mock",
    model: "gpt-4o",
  };
}

export function parseArgs(args: string[]): ReviewerConfig {
  const config = defaultConfig();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--auto-merge") {
      config.autoMerge = true;
    } else if (arg.startsWith("--auto-merge=")) {
      config.autoMerge = arg.split("=")[1] === "true";
    } else if (arg === "--pr" && args[i + 1]) {
      config.prId = args[++i];
    } else if (arg.startsWith("--pr=")) {
      config.prId = arg.split("=")[1];
    } else if (arg === "--branch" && args[i + 1]) {
      config.branch = args[++i];
    } else if (arg.startsWith("--branch=")) {
      config.branch = arg.split("=")[1];
    } else if (arg === "--base" && args[i + 1]) {
      config.baseBranch = args[++i];
    } else if (arg.startsWith("--base=")) {
      config.baseBranch = arg.split("=")[1];
    } else if (arg === "--worktree-dir" && args[i + 1]) {
      config.worktreeDir = args[++i];
    } else if (arg.startsWith("--worktree-dir=")) {
      config.worktreeDir = arg.split("=")[1];
    } else if (arg === "--no-tests") {
      config.runTests = false;
    } else if (arg === "--no-lint") {
      config.runLint = false;
    } else if (arg === "--test-cmd" && args[i + 1]) {
      config.testCommand = args[++i];
    } else if (arg.startsWith("--test-cmd=")) {
      config.testCommand = arg.split("=")[1];
    }
  }
  return config;
}
