import { ReviewerConfig } from "./config.ts";

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
}

export interface VerificationResult {
  success: boolean;
  testResult?: CommandResult;
  lintResult?: CommandResult;
  summary: string;
}

export class CodeChecker {
  async runCommand(commandStr: string, cwd: string): Promise<CommandResult> {
    const parts = commandStr.trim().split(/\s+/);
    const cmdName = parts[0];
    const args = parts.slice(1);

    try {
      const cmd = new Deno.Command(cmdName, {
        args,
        cwd,
        stdout: "piped",
        stderr: "piped",
      });

      const output = await cmd.output();
      const stdout = new TextDecoder().decode(output.stdout);
      const stderr = new TextDecoder().decode(output.stderr);

      return {
        success: output.success,
        stdout,
        stderr,
        exitCode: output.code,
        command: commandStr,
      };
    } catch (err) {
      return {
        success: false,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: 1,
        command: commandStr,
      };
    }
  }

  async runVerification(
    worktreePath: string,
    config: Partial<ReviewerConfig> = {}
  ): Promise<VerificationResult> {
    const testCmd = config.testCommand || "deno task test";
    const lintCmd = config.lintCommand || "deno lint";

    const testResult = await this.runCommand(testCmd, worktreePath);
    let lintResult: CommandResult | undefined;

    if (lintCmd) {
      lintResult = await this.runCommand(lintCmd, worktreePath);
    }

    const testPassed = testResult.success;
    const lintPassed = lintResult ? lintResult.success : true;
    const success = testPassed && lintPassed;

    let summary = "";
    if (success) {
      summary = "✅ All automated checks passed (tests and linter).";
    } else {
      const failures: string[] = [];
      if (!testPassed) failures.push(`Tests failed (${testCmd})`);
      if (lintResult && !lintPassed) failures.push(`Lint failed (${lintCmd})`);
      summary = `❌ Verification failed: ${failures.join(", ")}`;
    }

    return {
      success,
      testResult,
      lintResult,
      summary,
    };
  }
}
