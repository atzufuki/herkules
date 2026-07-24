export interface ReviewerConfig {
  autoMerge: boolean;
  worktreeDir: string;
  testCommand: string;
  lintCommand: string;
  prNumber?: number;
  branch?: string;
  repo?: string;
  githubToken?: string;
  aiModel?: string;
  minScoreToMerge?: number;
}

export function parseReviewerConfig(
  args: string[] | Record<string, unknown> = {}
): ReviewerConfig {
  if (Array.isArray(args)) {
    const flags: Record<string, unknown> = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--auto-merge") {
        flags.autoMerge = true;
      } else if (arg.startsWith("--auto-merge=")) {
        flags.autoMerge = arg.split("=")[1] === "true";
      } else if (arg.startsWith("--pr=")) {
        flags.prNumber = parseInt(arg.split("=")[1], 10);
      } else if (arg.startsWith("--worktree-dir=")) {
        flags.worktreeDir = arg.split("=")[1];
      } else if (arg.startsWith("--test-cmd=")) {
        flags.testCommand = arg.split("=")[1];
      } else if (arg.startsWith("--lint-cmd=")) {
        flags.lintCommand = arg.split("=")[1];
      } else if (arg.startsWith("--branch=")) {
        flags.branch = arg.split("=")[1];
      }
    }
    return parseReviewerConfig(flags);
  }

  return {
    autoMerge: Boolean(args.autoMerge ?? false),
    worktreeDir: String(args.worktreeDir || ".worktrees"),
    testCommand: String(args.testCommand || "deno task test"),
    lintCommand: String(args.lintCommand || "deno lint"),
    prNumber: args.prNumber ? Number(args.prNumber) : undefined,
    branch: args.branch ? String(args.branch) : undefined,
    repo: args.repo ? String(args.repo) : undefined,
    githubToken: args.githubToken ? String(args.githubToken) : Deno.env.get("GITHUB_TOKEN"),
    aiModel: args.aiModel ? String(args.aiModel) : "herkules-ai-v1",
    minScoreToMerge: args.minScoreToMerge ? Number(args.minScoreToMerge) : 80,
  };
}
