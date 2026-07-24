import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

export interface WorktreeInfo {
  path: string;
  prNumber: number;
  branch: string;
  created: boolean;
}

export class WorktreeManager {
  private baseDir: string;

  constructor(baseDir = ".worktrees") {
    this.baseDir = baseDir;
  }

  async createWorktree(prNumber: number, branch: string): Promise<WorktreeInfo> {
    const worktreePath = join(this.baseDir, `pr-${prNumber}`);

    try {
      await Deno.mkdir(this.baseDir, { recursive: true });
    } catch {
      // dir exists
    }

    const cmd = new Deno.Command("git", {
      args: ["worktree", "add", "-f", worktreePath, branch],
      stdout: "piped",
      stderr: "piped",
    });

    let success = false;
    try {
      const output = await cmd.output();
      success = output.success;
      if (!success) {
        const stderr = new TextDecoder().decode(output.stderr);
        console.warn(`Git worktree warning: ${stderr}`);
      }
    } catch (e) {
      console.warn("Failed to invoke git worktree command:", e);
    }

    return {
      path: worktreePath,
      prNumber,
      branch,
      created: success,
    };
  }

  async removeWorktree(worktreePath: string): Promise<boolean> {
    try {
      const cmd = new Deno.Command("git", {
        args: ["worktree", "remove", "-f", worktreePath],
        stdout: "piped",
        stderr: "piped",
      });
      const output = await cmd.output();
      if (!output.success) {
        await Deno.remove(worktreePath, { recursive: true });
      }
    } catch {
      try {
        await Deno.remove(worktreePath, { recursive: true });
      } catch {
        // ignore
      }
    }

    return true;
  }
}
