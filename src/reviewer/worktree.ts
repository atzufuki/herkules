export interface WorktreeInfo {
  prId: number | string;
  branch: string;
  path: string;
  createdAt: Date;
}

export interface CommandExecutor {
  run(cmd: string[], options?: { cwd?: string }): Promise<{ success: boolean; stdout: string; stderr: string; code: number }>;
}

export class DefaultCommandExecutor implements CommandExecutor {
  async run(cmd: string[], options?: { cwd?: string }): Promise<{ success: boolean; stdout: string; stderr: string; code: number }> {
    const command = new Deno.Command(cmd[0], {
      args: cmd.slice(1),
      cwd: options?.cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    const decoder = new TextDecoder();
    return {
      success: output.success,
      code: output.code,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  }
}

export class WorktreeManager {
  private baseDir: string;
  private executor: CommandExecutor;

  constructor(baseDir = ".worktrees", executor?: CommandExecutor) {
    this.baseDir = baseDir;
    this.executor = executor || new DefaultCommandExecutor();
  }

  getWorktreePath(prId: number | string): string {
    return `${this.baseDir}/pr-${prId}`;
  }

  async createWorktree(prId: number | string, branch: string): Promise<WorktreeInfo> {
    const path = this.getWorktreePath(prId);

    try {
      await Deno.mkdir(this.baseDir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    const result = await this.executor.run(["git", "worktree", "add", "-B", branch, path, branch]);
    if (!result.success) {
      const fallbackResult = await this.executor.run(["git", "worktree", "add", path, branch]);
      if (!fallbackResult.success) {
        throw new Error(`Failed to create worktree at ${path}: ${result.stderr || fallbackResult.stderr}`);
      }
    }

    return {
      prId,
      branch,
      path,
      createdAt: new Date(),
    };
  }

  async removeWorktree(path: string): Promise<void> {
    const result = await this.executor.run(["git", "worktree", "remove", "--force", path]);
    if (!result.success) {
      try {
        await Deno.remove(path, { recursive: true });
      } catch {
        // Ignored if non-existent
      }
    }
    await this.executor.run(["git", "worktree", "prune"]);
  }

  async listWorktrees(): Promise<string[]> {
    const result = await this.executor.run(["git", "worktree", "list"]);
    if (!result.success) {
      return [];
    }
    return result.stdout.split("\n").filter((line) => line.trim().length > 0);
  }
}
