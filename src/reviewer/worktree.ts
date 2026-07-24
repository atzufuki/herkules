export interface WorktreeInfo {
  path: string;
  branch: string;
  prId: number | string;
}

export class WorktreeManager {
  private baseDir: string;

  constructor(baseDir = ".worktrees") {
    this.baseDir = baseDir;
  }

  async createWorktree(prId: number | string, branch: string): Promise<WorktreeInfo> {
    const worktreePath = `${this.baseDir}/pr-${prId}`;

    try {
      await Deno.mkdir(this.baseDir, { recursive: true });
    } catch {
      // Ignore error if directory exists
    }

    const command = new Deno.Command("git", {
      args: ["worktree", "add", "-f", worktreePath, branch],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await command.output();
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(`Failed to create worktree at ${worktreePath}: ${stderr}`);
    }

    return {
      path: worktreePath,
      branch,
      prId,
    };
  }

  async removeWorktree(worktreePath: string): Promise<void> {
    const command = new Deno.Command("git", {
      args: ["worktree", "remove", "-f", worktreePath],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await command.output();
    if (!output.success) {
      try {
        await Deno.remove(worktreePath, { recursive: true });
      } catch {
        // Fallback directory removal cleanup
      }
    }
  }
}
