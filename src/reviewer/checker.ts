import { CommandExecutor, DefaultCommandExecutor } from "./worktree.ts";

export interface StepResult {
  success: boolean;
  output: string;
  exitCode: number;
}

export interface CheckResult {
  success: boolean;
  testResult: StepResult;
  lintResult?: StepResult;
}

export interface CheckerOptions {
  testCommand?: string;
  lintCommand?: string;
  executor?: CommandExecutor;
}

export class Checker {
  private executor: CommandExecutor;

  constructor(executor?: CommandExecutor) {
    this.executor = executor || new DefaultCommandExecutor();
  }

  private parseCommand(cmdString: string): string[] {
    return cmdString.trim().split(/\s+/);
  }

  async runChecks(worktreePath: string, options?: CheckerOptions): Promise<CheckResult> {
    const exec = options?.executor || this.executor;
    const testCmd = options?.testCommand || "deno task test";
    const lintCmd = options?.lintCommand;

    const testArgs = this.parseCommand(testCmd);
    const testExecResult = await exec.run(testArgs, { cwd: worktreePath });
    const testResult: StepResult = {
      success: testExecResult.success,
      output: testExecResult.stdout + (testExecResult.stderr ? `\nStderr:\n${testExecResult.stderr}` : ""),
      exitCode: testExecResult.code,
    };

    let lintResult: StepResult | undefined;
    let allPassed = testResult.success;

    if (lintCmd) {
      const lintArgs = this.parseCommand(lintCmd);
      const lintExecResult = await exec.run(lintArgs, { cwd: worktreePath });
      lintResult = {
        success: lintExecResult.success,
        output: lintExecResult.stdout + (lintExecResult.stderr ? `\nStderr:\n${lintExecResult.stderr}` : ""),
        exitCode: lintExecResult.code,
      };
      if (!lintResult.success) {
        allPassed = false;
      }
    }

    return {
      success: allPassed,
      testResult,
      lintResult,
    };
  }
}
