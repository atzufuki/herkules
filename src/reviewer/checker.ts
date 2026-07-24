export interface VerificationResult {
  success: boolean;
  testsPassed: boolean;
  lintPassed: boolean;
  testOutput: string;
  lintOutput: string;
  errors: string[];
}

export async function runVerification(
  worktreePath: string,
  testCmd = "deno task test",
  lintCmd?: string
): Promise<VerificationResult> {
  const errors: string[] = [];
  let testsPassed = false;
  let lintPassed = true;
  let testOutput = "";
  let lintOutput = "";

  if (testCmd) {
    const parts = testCmd.split(" ");
    const exe = parts[0];
    const args = parts.slice(1);

    try {
      const command = new Deno.Command(exe, {
        args,
        cwd: worktreePath,
        stdout: "piped",
        stderr: "piped",
      });
      const output = await command.output();
      testOutput = new TextDecoder().decode(output.stdout) + "\n" + new TextDecoder().decode(output.stderr);
      testsPassed = output.success;
      if (!testsPassed) {
        errors.push(`Test suite failed (${testCmd})`);
      }
    } catch (err) {
      testsPassed = false;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to execute test command: ${msg}`);
      testOutput = msg;
    }
  } else {
    testsPassed = true;
  }

  if (lintCmd) {
    const parts = lintCmd.split(" ");
    const exe = parts[0];
    const args = parts.slice(1);

    try {
      const command = new Deno.Command(exe, {
        args,
        cwd: worktreePath,
        stdout: "piped",
        stderr: "piped",
      });
      const output = await command.output();
      lintOutput = new TextDecoder().decode(output.stdout) + "\n" + new TextDecoder().decode(output.stderr);
      lintPassed = output.success;
      if (!lintPassed) {
        errors.push(`Linter failed (${lintCmd})`);
      }
    } catch (err) {
      lintPassed = false;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to execute lint command: ${msg}`);
      lintOutput = msg;
    }
  }

  return {
    success: testsPassed && lintPassed,
    testsPassed,
    lintPassed,
    testOutput,
    lintOutput,
    errors,
  };
}
