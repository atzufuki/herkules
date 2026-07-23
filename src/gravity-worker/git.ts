/**
 * GravityWorker - Git & Worktree Management
 *
 * Provides isolated Git worktree management for background agent execution.
 *
 * @module gravity-worker/git
 */

import { join } from "@std/path";

export interface WorktreeInfo {
  worktreePath: string;
  branchName: string;
  taskId: string;
}

export interface CreateWorktreeOptions {
  taskId: string;
  issueNumber?: number;
  baseBranch?: string;
  worktreeRootDir?: string;
}

/**
 * Executes a Git command and returns trimmed stdout.
 */
async function runGit(args: string[], cwd?: string): Promise<string> {
  const command = new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  });

  const output = await command.output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  const stderr = new TextDecoder().decode(output.stderr).trim();

  if (!output.success) {
    throw new Error(`Git command failed [git ${args.join(" ")}]: ${stderr || stdout}`);
  }

  return stdout;
}

/**
 * Checks if current directory is inside a Git repository.
 */
export async function isGitRepository(cwd?: string): Promise<boolean> {
  try {
    const res = await runGit(["rev-parse", "--is-inside-work-tree"], cwd);
    return res === "true";
  } catch {
    return false;
  }
}

/**
 * Gets current branch name.
 */
export async function getCurrentBranch(cwd?: string): Promise<string> {
  return await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

/**
 * Creates an isolated Git worktree for a task using standard branch naming (e.g. fix/48-task).
 */
export async function createWorktree(
  options: CreateWorktreeOptions,
  cwd?: string,
): Promise<WorktreeInfo> {
  const { taskId, issueNumber, baseBranch, worktreeRootDir = ".worktrees" } = options;
  const branchName = issueNumber ? `fix/${issueNumber}-${taskId}` : `gravity-worker/${taskId}`;
  const targetDir = join(worktreeRootDir, taskId);

  // Ensure root worktree dir exists
  await Deno.mkdir(worktreeRootDir, { recursive: true });

  const currentBranch = baseBranch ?? await getCurrentBranch(cwd);

  // Create new branch and worktree
  await runGit(["worktree", "add", "-b", branchName, targetDir, currentBranch], cwd);

  return {
    worktreePath: targetDir,
    branchName,
    taskId,
  };
}

/**
 * Removes a Git worktree and optionally deletes its branch.
 */
export async function removeWorktree(
  worktreeInfo: WorktreeInfo,
  options: { deleteBranch?: boolean } = {},
  cwd?: string,
): Promise<void> {
  const { worktreePath, branchName } = worktreeInfo;

  try {
    await runGit(["worktree", "remove", "--force", worktreePath], cwd);
  } catch {
    // Fallback if worktree dir exists without git registration
    await Deno.remove(worktreePath, { recursive: true }).catch(() => {});
    await runGit(["worktree", "prune"], cwd).catch(() => {});
  }

  if (options.deleteBranch) {
    await runGit(["branch", "-D", branchName], cwd).catch(() => {});
  }
}

/**
 * Gets git diff for changes inside a worktree.
 */
export async function getWorktreeDiff(worktreePath: string): Promise<string> {
  return await runGit(["diff", "HEAD"], worktreePath);
}

/**
 * Checks if worktree has uncommitted or untracked changes.
 */
export async function hasChanges(worktreePath: string): Promise<boolean> {
  const status = await runGit(["status", "--porcelain"], worktreePath);
  return status.length > 0;
}

/**
 * Commits code changes in a worktree, strictly excluding GravityWorker artifact reports.
 */
export async function commitWorktreeChanges(
  worktreePath: string,
  message: string,
  botName = "gravity-worker[bot]",
  botEmail = "gravity-worker[bot]@users.noreply.github.com",
): Promise<void> {
  await runGit(["config", "user.name", botName], worktreePath);
  await runGit(["config", "user.email", botEmail], worktreePath);
  await runGit(["add", "-A"], worktreePath);
  // Remove .gravity-worker/ directory and artifact files from git staging area
  await runGit(["reset", "HEAD", "--", ".gravity-worker", "implementation_plan.md", "walkthrough.md"], worktreePath).catch(() => {});
  await runGit(["rm", "-rf", "--cached", ".gravity-worker", "implementation_plan.md", "walkthrough.md"], worktreePath).catch(() => {});
  await runGit(["commit", "-m", message], worktreePath);
}

/**
 * Pushes worktree branch to remote repository.
 */
export async function pushWorktreeBranch(
  worktreePath: string,
  branchName: string,
  remote = "origin",
): Promise<void> {
  await runGit(["push", "-u", remote, branchName], worktreePath);
}
