export interface CheckResult {
  passed: boolean;
  testPassed: boolean;
  lintPassed: boolean;
  testOutput: string;
  lintOutput: string;
}

export class CodeChecker {
  async runChecks(
    worktreePath: string,
    options: { testCommand?: string; lintCommand?: string } = {}
  ): Promise<CheckResult> {
    const testCmd = options.testCommand || "deno task test";
    const lintCmd = options.lintCommand || "deno lint";

    const testRes = await this.execCommand(testCmd, worktreePath);
    const lintRes = await this.execCommand(lintCmd, worktreePath);

    return {
      passed: testRes.success && lintRes.success,
      testPassed: testRes.success,
      lintPassed: lintRes.success,
      testOutput: testRes.output,
      lintOutput: lintRes.output,
    };
  }

  private async execCommand(
    commandStr: string,
    cwd: string
  ): Promise<{ success: boolean; output: string }> {
    const parts = commandStr.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    try {
      const command = new Deno.Command(cmd, {
        args,
        cwd,
        stdout: "piped",
        stderr: "piped",
      });

      const output = await command.output();
      const stdoutStr = new TextDecoder().decode(output.stdout);
      const stderrStr = new TextDecoder().decode(output.stderr);
      const fullOutput = (stdoutStr + "\n" + stderrStr).trim();

      return {
        success: output.success,
        output: fullOutput,
      };
    } catch (err) {
      return {
        success: false,
        output: `Command failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
