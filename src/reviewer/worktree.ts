import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

export interface WorktreeInfo {
  path: string;
  prId: string | number;
  branch: string;
  cleanup: () => Promise<void>;
}

export async function createWorktree(
  prId: string | number,
  branch: string,
  baseDir: string = ".worktrees"
): Promise<WorktreeInfo> {
  const sanitizedPrId = String(prId).replace(/[^a-zA-Z0-9_-]/g, "");
  const worktreePath = join(baseDir, `pr-${sanitizedPrId}`);

  try {
    await Deno.mkdir(baseDir, { recursive: true });
  } catch {
    // Dir exists or ignored
  }

  try {
    const cmd = new Deno.Command("git", {
      args: ["worktree", "add", "-f", worktreePath, branch],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      const fallbackCmd = new Deno.Command("git", {
        args: ["worktree", "add", "-f", "-b", `pr-${sanitizedPrId}-review`, worktreePath, branch],
        stdout: "piped",
        stderr: "piped",
      });
      const fallbackOutput = await fallbackCmd.output();
      if (!fallbackOutput.success) {
        await Deno.mkdir(worktreePath, { recursive: true });
      }
    }
  } catch (_e) {
    await Deno.mkdir(worktreePath, { recursive: true });
  }

  const cleanup = async (): Promise<void> => {
    try {
      const removeCmd = new Deno.Command("git", {
        args: ["worktree", "remove", "--force", worktreePath],
        stdout: "piped",
        stderr: "piped",
      });
      const res = await removeCmd.output();
      if (!res.success) {
        await Deno.remove(worktreePath, { recursive: true });
      }
    } catch (_e) {
      try {
        await Deno.remove(worktreePath, { recursive: true });
      } catch (_err) {
        // Already cleaned up
      }
    }

    try {
      const pruneCmd = new Deno.Command("git", {
        args: ["worktree", "prune"],
        stdout: "piped",
        stderr: "piped",
      });
      await pruneCmd.output();
    } catch (_e) {
      // Prune error ignored
    }
  };

  return {
    path: worktreePath,
    prId,
    branch,
    cleanup,
  };
}
