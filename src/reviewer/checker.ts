export interface CheckResult {
  step: "test" | "lint";
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface VerificationResult {
  passed: boolean;
  results: CheckResult[];
}

export interface CheckerOptions {
  testCommand?: string;
  lintCommand?: string;
  execFn?: (cmd: string, cwd: string) => Promise<{ success: boolean; stdout: string; stderr: string }>;
}

async function defaultExec(
  command: string,
  cwd: string
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const parts = command.split(" ");
  const executable = parts[0];
  const args = parts.slice(1);

  try {
    const cmd = new Deno.Command(executable, {
      args,
      cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    const decoder = new TextDecoder();
    return {
      success: output.success,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  } catch (err) {
    return {
      success: false,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runChecks(
  worktreePath: string,
  options: CheckerOptions = {}
): Promise<VerificationResult> {
  const testCmd = options.testCommand || "deno task test";
  const lintCmd = options.lintCommand || "deno lint";
  const exec = options.execFn || defaultExec;

  const results: CheckResult[] = [];

  // Test suite execution
  const testStart = Date.now();
  const testRes = await exec(testCmd, worktreePath);
  const testDuration = Date.now() - testStart;
  results.push({
    step: "test",
    success: testRes.success,
    command: testCmd,
    stdout: testRes.stdout,
    stderr: testRes.stderr,
    durationMs: testDuration,
  });

  // Lint suite execution
  const lintStart = Date.now();
  const lintRes = await exec(lintCmd, worktreePath);
  const lintDuration = Date.now() - lintStart;
  results.push({
    step: "lint",
    success: lintRes.success,
    command: lintCmd,
    stdout: lintRes.stdout,
    stderr: lintRes.stderr,
    durationMs: lintDuration,
  });

  const passed = results.every((r) => r.success);

  return {
    passed,
    results,
  };
}
