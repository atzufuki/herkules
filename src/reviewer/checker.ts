export interface CheckResult {
  name: string;
  passed: boolean;
  output: string;
  exitCode: number;
  durationMs: number;
}

export interface VerificationResult {
  passed: boolean;
  checks: CheckResult[];
  summary: string;
}

export interface CheckerOptions {
  worktreePath: string;
  testCommand?: string;
  lintCommand?: string;
  runTests?: boolean;
  runLint?: boolean;
}

export async function runCommand(
  cmdStr: string,
  cwd: string
): Promise<{ passed: boolean; output: string; exitCode: number }> {
  const parts = cmdStr.split(" ");
  const executable = parts[0];
  const args = parts.slice(1);

  try {
    const command = new Deno.Command(executable, {
      args,
      cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const output = await command.output();
    const stdoutStr = new TextDecoder().decode(output.stdout);
    const stderrStr = new TextDecoder().decode(output.stderr);
    const combinedOutput = stdoutStr + (stderrStr ? `\n${stderrStr}` : "");

    return {
      passed: output.success,
      output: combinedOutput.trim(),
      exitCode: output.code,
    };
  } catch (err) {
    return {
      passed: false,
      output: err instanceof Error ? err.message : String(err),
      exitCode: 1,
    };
  }
}

export async function runVerification(options: CheckerOptions): Promise<VerificationResult> {
  const checks: CheckResult[] = [];
  let allPassed = true;

  if (options.runTests !== false && options.testCommand) {
    const startTime = Date.now();
    const res = await runCommand(options.testCommand, options.worktreePath);
    const durationMs = Date.now() - startTime;
    checks.push({
      name: "tests",
      passed: res.passed,
      output: res.output,
      exitCode: res.exitCode,
      durationMs,
    });
    if (!res.passed) allPassed = false;
  }

  if (options.runLint !== false && options.lintCommand) {
    const startTime = Date.now();
    const res = await runCommand(options.lintCommand, options.worktreePath);
    const durationMs = Date.now() - startTime;
    checks.push({
      name: "lint",
      passed: res.passed,
      output: res.output,
      exitCode: res.exitCode,
      durationMs,
    });
    if (!res.passed) allPassed = false;
  }

  const passedCount = checks.filter((c) => c.passed).length;
  const summary = `Verification completed: ${passedCount}/${checks.length} checks passed.`;

  return {
    passed: allPassed,
    checks,
    summary,
  };
}
