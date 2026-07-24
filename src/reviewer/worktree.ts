import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

export interface WorktreeInfo {
  path: string;
  branch: string;
  prId: string | number;
  cleanup: () => Promise<void>;
}

export class WorktreeManager {
  private baseDir: string;

  constructor(baseDir: string = ".worktrees") {
    this.baseDir = baseDir;
  }

  async setupWorktree(prId: string | number, branch: string): Promise<WorktreeInfo> {
    const worktreePath = join(this.baseDir, `pr-${prId}`);

    try {
      await Deno.mkdir(this.baseDir, { recursive: true });
    } catch {
      // Directory already exists
    }

    const cmd = new Deno.Command("git", {
      args: ["worktree", "add", "-f", worktreePath, branch],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();
    if (!output.success) {
      try {
        await Deno.mkdir(worktreePath, { recursive: true });
      } catch {
        // Fallback directory creation
      }
    }

    const cleanup = async () => {
      await this.cleanupWorktree(worktreePath);
    };

    return {
      path: worktreePath,
      branch,
      prId,
      cleanup,
    };
  }

  async cleanupWorktree(worktreePath: string): Promise<void> {
    const cmd = new Deno.Command("git", {
      args: ["worktree", "remove", "--force", worktreePath],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await cmd.output();
    if (!output.success) {
      const pruneCmd = new Deno.Command("git", {
        args: ["worktree", "prune"],
        stdout: "piped",
        stderr: "piped",
      });
      await pruneCmd.output();

      try {
        await Deno.remove(worktreePath, { recursive: true });
      } catch {
        // Directory removed
      }
    }
  }
}
