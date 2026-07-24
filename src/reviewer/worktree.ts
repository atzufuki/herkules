import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

export interface WorktreeOptions {
  prId: number | string;
  branch: string;
  baseDir?: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  prId: number | string;
}

export async function createWorktree(options: WorktreeOptions): Promise<WorktreeInfo> {
  const baseDir = options.baseDir || ".worktrees";
  const worktreePath = join(baseDir, `pr-${options.prId}`);

  try {
    await Deno.mkdir(baseDir, { recursive: true });
  } catch {
    // Directory already exists
  }

  const command = new Deno.Command("git", {
    args: ["worktree", "add", "-f", worktreePath, options.branch],
    stdout: "piped",
    stderr: "piped",
  });

  const output = await command.output();
  if (!output.success) {
    const errorText = new TextDecoder().decode(output.stderr);
    throw new Error(`Failed to create worktree at ${worktreePath}: ${errorText}`);
  }

  return {
    path: worktreePath,
    branch: options.branch,
    prId: options.prId,
  };
}

export async function cleanupWorktree(worktreeInfo: WorktreeInfo): Promise<boolean> {
  try {
    const command = new Deno.Command("git", {
      args: ["worktree", "remove", "-f", worktreeInfo.path],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    if (!output.success) {
      await Deno.remove(worktreeInfo.path, { recursive: true });
    }
    return true;
  } catch (_e) {
    try {
      await Deno.remove(worktreeInfo.path, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}
