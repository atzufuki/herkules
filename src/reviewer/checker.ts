export interface CheckResult {
  success: boolean;
  testSuccess: boolean;
  testOutput: string;
  lintSuccess: boolean;
  lintOutput: string;
  errors: string[];
}

export class CodeChecker {
  private parseCommandStr(cmdStr: string): { cmd: string; args: string[] } {
    const parts = cmdStr.trim().split(/\s+/);
    return {
      cmd: parts[0],
      args: parts.slice(1),
    };
  }

  private async runCommand(
    commandStr: string,
    cwd: string
  ): Promise<{ success: boolean; output: string }> {
    if (!commandStr) {
      return { success: true, output: 'Command skipped' };
    }

    const { cmd, args } = this.parseCommandStr(commandStr);

    try {
      const command = new Deno.Command(cmd, {
        args,
        cwd,
        stdout: 'piped',
        stderr: 'piped',
      });

      const { success, stdout, stderr } = await command.output();
      const stdoutText = new TextDecoder().decode(stdout);
      const stderrText = new TextDecoder().decode(stderr);
      const output = (stdoutText + '\n' + stderrText).trim();

      return { success, output };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Execution error: ${errorMsg}` };
    }
  }

  async runVerification(
    worktreePath: string,
    testCommand = 'deno task test',
    lintCommand?: string
  ): Promise<CheckResult> {
    const errors: string[] = [];

    const testRes = await this.runCommand(testCommand, worktreePath);
    if (!testRes.success) {
      errors.push(`Test suite failed: ${testCommand}`);
    }

    let lintRes = { success: true, output: 'Lint check skipped' };
    if (lintCommand) {
      lintRes = await this.runCommand(lintCommand, worktreePath);
      if (!lintRes.success) {
        errors.push(`Lint check failed: ${lintCommand}`);
      }
    }

    const overallSuccess = testRes.success && lintRes.success;

    return {
      success: overallSuccess,
      testSuccess: testRes.success,
      testOutput: testRes.output,
      lintSuccess: lintRes.success,
      lintOutput: lintRes.output,
      errors,
    };
  }
}
