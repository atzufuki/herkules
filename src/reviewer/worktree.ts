export interface WorktreeManager {
  path: string;
  prId: string | number;
  branch: string;
  create(): Promise<string>;
  cleanup(): Promise<void>;
}

export class GitWorktreeManager implements WorktreeManager {
  path: string;
  prId: string | number;
  branch: string;
  worktreesDir: string;

  constructor(prId: string | number, branch: string, worktreesDir = ".worktrees") {
    this.prId = prId;
    this.branch = branch;
    this.worktreesDir = worktreesDir;
    this.path = `${worktreesDir}/pr-${prId}`;
  }

  async create(): Promise<string> {
    await Deno.mkdir(this.worktreesDir, { recursive: true });

    const command = new Deno.Command("git", {
      args: ["worktree", "add", "--force", this.path, this.branch],
      stdout: "piped",
      stderr: "piped",
    });

    const process = await command.output();
    if (!process.success) {
      const errorMsg = new TextDecoder().decode(process.stderr);
      const fallbackCommand = new Deno.Command("git", {
        args: ["worktree", "add", "-b", `pr-${this.prId}-worktree`, this.path, this.branch],
        stdout: "piped",
        stderr: "piped",
      });
      const fallbackOutput = await fallbackCommand.output();
      if (!fallbackOutput.success) {
        throw new Error(`Failed to create git worktree at ${this.path}: ${errorMsg}`);
      }
    }

    return this.path;
  }

  async cleanup(): Promise<void> {
    try {
      const command = new Deno.Command("git", {
        args: ["worktree", "remove", "--force", this.path],
        stdout: "piped",
        stderr: "piped",
      });
      await command.output();
    } catch {
      // Ignore error if already removed
    }

    try {
      await Deno.remove(this.path, { recursive: true });
    } catch {
      // Ignore error
    }
  }
}
