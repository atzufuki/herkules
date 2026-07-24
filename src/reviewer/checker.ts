export interface CheckResult {
  passed: boolean;
  testPassed: boolean;
  lintPassed: boolean;
  testLogs: string;
  lintLogs: string;
}

export interface CheckerOptions {
  worktreePath: string;
  testCommand?: string;
  lintCommand?: string;
}

export class CodeChecker {
  private worktreePath: string;
  private testCommand?: string;
  private lintCommand?: string;

  constructor(options: CheckerOptions) {
    this.worktreePath = options.worktreePath;
    this.testCommand = options.testCommand;
    this.lintCommand = options.lintCommand;
  }

  private parseCommand(cmdStr: string): { cmd: string; args: string[] } {
    const parts = cmdStr.trim().split(/\s+/);
    return { cmd: parts[0], args: parts.slice(1) };
  }

  async runTests(): Promise<{ success: boolean; logs: string }> {
    let cmd = "deno";
    let args = ["task", "test"];

    if (this.testCommand) {
      const parsed = this.parseCommand(this.testCommand);
      cmd = parsed.cmd;
      args = parsed.args;
    } else {
      try {
        const packageJson = await Deno.stat(`${this.worktreePath}/package.json`);
        if (packageJson.isFile) {
          cmd = "npm";
          args = ["test"];
        }
      } catch {
        // Default to deno task test
      }
    }

    try {
      const process = new Deno.Command(cmd, {
        args,
        cwd: this.worktreePath,
        stdout: "piped",
        stderr: "piped",
      });

      const output = await process.output();
      const stdout = new TextDecoder().decode(output.stdout);
      const stderr = new TextDecoder().decode(output.stderr);
      const logs = (stdout + "\n" + stderr).trim();

      return {
        success: output.success,
        logs,
      };
    } catch (err) {
      return {
        success: false,
        logs: `Failed to execute test command "${cmd} ${args.join(" ")}": ${(err as Error).message}`,
      };
    }
  }

  async runLint(): Promise<{ success: boolean; logs: string }> {
    let cmd = "deno";
    let args = ["lint"];

    if (this.lintCommand) {
      const parsed = this.parseCommand(this.lintCommand);
      cmd = parsed.cmd;
      args = parsed.args;
    } else {
      try {
        const packageJson = await Deno.stat(`${this.worktreePath}/package.json`);
        if (packageJson.isFile) {
          cmd = "npm";
          args = ["run", "lint"];
        }
      } catch {
        // Default to deno lint
      }
    }

    try {
      const process = new Deno.Command(cmd, {
        args,
        cwd: this.worktreePath,
        stdout: "piped",
        stderr: "piped",
      });

      const output = await process.output();
      const stdout = new TextDecoder().decode(output.stdout);
      const stderr = new TextDecoder().decode(output.stderr);
      const logs = (stdout + "\n" + stderr).trim();

      return {
        success: output.success,
        logs,
      };
    } catch (err) {
      return {
        success: false,
        logs: `Failed to execute lint command "${cmd} ${args.join(" ")}": ${(err as Error).message}`,
      };
    }
  }

  async runAllChecks(): Promise<CheckResult> {
    const testRes = await this.runTests();
    const lintRes = await this.runLint();

    return {
      passed: testRes.success && lintRes.success,
      testPassed: testRes.success,
      lintPassed: lintRes.success,
      testLogs: testRes.logs,
      lintLogs: lintRes.logs,
    };
  }
}
