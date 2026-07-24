export interface VerificationResult {
  passed: boolean;
  testPassed: boolean;
  lintPassed: boolean;
  testOutput: string;
  lintOutput: string;
  errors: string[];
}

export class CodeChecker {
  async runVerification(worktreePath: string, testCmd?: string, lintCmd?: string): Promise<VerificationResult> {
    const result: VerificationResult = {
      passed: true,
      testPassed: true,
      lintPassed: true,
      testOutput: "",
      lintOutput: "",
      errors: [],
    };

    const defaultTestCmd = testCmd || "deno task test";
    const [testBin, ...testArgs] = defaultTestCmd.split(" ");

    try {
      const testProcess = new Deno.Command(testBin, {
        args: testArgs,
        cwd: worktreePath,
        stdout: "piped",
        stderr: "piped",
      });
      const testOut = await testProcess.output();
      result.testOutput = new TextDecoder().decode(testOut.stdout) + "\n" + new TextDecoder().decode(testOut.stderr);
      result.testPassed = testOut.success;
    } catch (err) {
      result.testPassed = false;
      result.testOutput = `Test execution error: ${err instanceof Error ? err.message : String(err)}`;
    }

    const defaultLintCmd = lintCmd || "deno lint";
    const [lintBin, ...lintArgs] = defaultLintCmd.split(" ");

    try {
      const lintProcess = new Deno.Command(lintBin, {
        args: lintArgs,
        cwd: worktreePath,
        stdout: "piped",
        stderr: "piped",
      });
      const lintOut = await lintProcess.output();
      result.lintOutput = new TextDecoder().decode(lintOut.stdout) + "\n" + new TextDecoder().decode(lintOut.stderr);
      result.lintPassed = lintOut.success;
    } catch (err) {
      result.lintPassed = false;
      result.lintOutput = `Lint execution error: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (!result.testPassed) {
      result.errors.push("Automated test suite failed.");
    }
    if (!result.lintPassed) {
      result.errors.push("Linter checks failed.");
    }

    result.passed = result.testPassed && result.lintPassed;
    return result;
  }
}
