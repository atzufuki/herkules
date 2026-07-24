export interface WorktreeInfo {
  prId: string | number;
  path: string;
  branch: string;
}

export class WorktreeManager {
  private baseDir: string;

  constructor(baseDir = ".worktrees") {
    this.baseDir = baseDir;
  }

  getWorktreePath(prId: string | number): string {
    return `${this.baseDir}/pr-${prId}`;
  }

  async createWorktree(prId: string | number, branch: string): Promise<WorktreeInfo> {
    const targetPath = this.getWorktreePath(prId);

    try {
      await Deno.mkdir(this.baseDir, { recursive: true });
    } catch {
      // ignore if exists
    }

    const command = new Deno.Command("git", {
      args: ["worktree", "add", "-f", targetPath, branch],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await command.output();
    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(`Failed to create worktree at ${targetPath}: ${stderr}`);
    }

    return {
      prId,
      path: targetPath,
      branch,
    };
  }

  async removeWorktree(path: string): Promise<boolean> {
    const command = new Deno.Command("git", {
      args: ["worktree", "remove", "--force", path],
      stdout: "piped",
      stderr: "piped",
    });

    const output = await command.output();
    if (!output.success) {
      try {
        await Deno.remove(path, { recursive: true });
      } catch {
        return false;
      }
    }
    return true;
  }
}
