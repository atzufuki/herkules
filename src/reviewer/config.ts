export interface ReviewerConfig {
  autoMerge: boolean;
  worktreeDir: string;
  testCommand?: string;
  lintCommand?: string;
  aiModel?: string;
  githubToken?: string;
}

export function parseConfig(
  args: string[] = [],
  env: Record<string, string> = Deno.env.toObject()
): ReviewerConfig {
  const autoMerge = args.includes("--auto-merge") || env["AUTO_MERGE"] === "true";
  const worktreeDir = env["WORKTREE_DIR"] || ".worktrees";
  const testCommand = env["TEST_COMMAND"] || "deno task test";
  const lintCommand = env["LINT_COMMAND"] || "deno lint";
  const aiModel = env["AI_MODEL"] || "gpt-4o";
  const githubToken = env["GITHUB_TOKEN"] || "";

  return {
    autoMerge,
    worktreeDir,
    testCommand,
    lintCommand,
    aiModel,
    githubToken,
  };
}
