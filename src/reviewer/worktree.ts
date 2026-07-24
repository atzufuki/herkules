export interface WorktreeInfo {
  path: string;
  branch: string;
  prNumber: number | string;
  cleanup: () => Promise<void>;
}

export class WorktreeManager {
  private baseDir: string;

  constructor(baseDir = '.worktrees') {
    this.baseDir = baseDir;
  }

  async createWorktree(prNumber: number | string, branch: string): Promise<WorktreeInfo> {
    const worktreePath = `${this.baseDir}/pr-${prNumber}`;

    await Deno.mkdir(this.baseDir, { recursive: true }).catch(() => {});

    const command = new Deno.Command('git', {
      args: ['worktree', 'add', '-f', worktreePath, branch],
      stdout: 'piped',
      stderr: 'piped',
    });

    const { success } = await command.output();
    if (!success) {
      const checkoutCmd = new Deno.Command('git', {
        args: ['worktree', 'add', '-f', '-b', `pr-${prNumber}-branch`, worktreePath, branch],
        stdout: 'piped',
        stderr: 'piped',
      });
      const res = await checkoutCmd.output();
      if (!res.success) {
        await Deno.mkdir(worktreePath, { recursive: true });
      }
    }

    const cleanup = async () => {
      await this.removeWorktree(worktreePath);
    };

    return {
      path: worktreePath,
      branch,
      prNumber,
      cleanup,
    };
  }

  async removeWorktree(path: string): Promise<void> {
    try {
      const command = new Deno.Command('git', {
        args: ['worktree', 'remove', '--force', path],
        stdout: 'piped',
        stderr: 'piped',
      });
      await command.output();
    } catch {
      // Ignore errors if path is not a valid git worktree
    }

    try {
      await Deno.remove(path, { recursive: true });
    } catch {
      // Directory already removed
    }
  }
}
