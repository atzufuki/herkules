import { assertEquals, assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseArgs, loadConfig } from "../src/reviewer/config.ts";
import { WorktreeManager, CommandExecutor } from "../src/reviewer/worktree.ts";
import { Checker } from "../src/reviewer/checker.ts";
import { AIReviewer } from "../src/reviewer/ai_reviewer.ts";
import { AutoMerger } from "../src/reviewer/auto_merge.ts";
import { CodeReviewer } from "../src/reviewer/index.ts";

class MockCommandExecutor implements CommandExecutor {
  public executedCommands: { cmd: string[]; cwd?: string }[] = [];
  public shouldFail = false;

  async run(cmd: string[], options?: { cwd?: string }) {
    this.executedCommands.push({ cmd, cwd: options?.cwd });

    if (this.shouldFail) {
      return {
        success: false,
        code: 1,
        stdout: "Command failed",
        stderr: "Error logs",
      };
    }

    return {
      success: true,
      code: 0,
      stdout: "Command output OK\n",
      stderr: "",
    };
  }
}

Deno.test("Config - parses flags correctly", () => {
  const config = parseArgs(["--auto-merge", "--worktree-dir=.test-worktrees", "--test-cmd=deno test"]);
  assertEquals(config.autoMerge, true);
  assertEquals(config.worktreeDir, ".test-worktrees");
  assertEquals(config.testCommand, "deno test");
});

Deno.test("WorktreeManager - creates and removes worktree", async () => {
  const executor = new MockCommandExecutor();
  const manager = new WorktreeManager(".worktrees-test", executor);

  const info = await manager.createWorktree(123, "feature/test-branch");
  assertEquals(info.prId, 123);
  assertEquals(info.branch, "feature/test-branch");
  assertEquals(info.path, ".worktrees-test/pr-123");
  assertEquals(executor.executedCommands.length, 1);
  assertEquals(executor.executedCommands[0].cmd[0], "git");

  await manager.removeWorktree(info.path);
  assertEquals(executor.executedCommands.length, 3);
});

Deno.test("Checker - runs tests and lint successfully", async () => {
  const executor = new MockCommandExecutor();
  const checker = new Checker(executor);

  const result = await checker.runChecks(".worktrees-test/pr-1", {
    testCommand: "deno task test",
    lintCommand: "deno lint",
  });

  assertEquals(result.success, true);
  assertEquals(result.testResult.success, true);
  assertEquals(result.lintResult?.success, true);
  assertEquals(executor.executedCommands.length, 2);
});

Deno.test("Checker - handles failing test suite", async () => {
  const executor = new MockCommandExecutor();
  executor.shouldFail = true;
  const checker = new Checker(executor);

  const result = await checker.runChecks(".worktrees-test/pr-1", {
    testCommand: "deno task test",
  });

  assertEquals(result.success, false);
  assertEquals(result.testResult.success, false);
});

Deno.test("AIReviewer - detects security and bug risks in diff", async () => {
  const reviewer = new AIReviewer();
  const sampleDiff = `
diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,6 +10,8 @@
+ const apiKey = "API_KEY = 'secret123'";
+ eval("console.log('unsafe')");
+ // TODO: fix logic
+ var legacy = 1;
`;

  const review = await reviewer.reviewDiff(sampleDiff);
  assertEquals(review.approved, false);
  assert(review.securityCount > 0);
  assert(review.bugsCount > 0);
  assert(review.styleCount > 0);
  assert(review.inlineComments.length > 0);
  assertStringIncludes(review.summary, "Security Risks");
});

Deno.test("AIReviewer - approves clean code diff", async () => {
  const reviewer = new AIReviewer();
  const sampleDiff = `
diff --git a/src/math.ts b/src/math.ts
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,3 +1,5 @@
+ export function add(a: number, b: number): number {
+   return a + b;
+ }
`;

  const review = await reviewer.reviewDiff(sampleDiff);
  assertEquals(review.approved, true);
  assertEquals(review.securityCount, 0);
  assertEquals(review.bugsCount, 0);
  assert(review.score >= 80);
});

Deno.test("AutoMerger - checks eligibility and executes auto-merge", async () => {
  const autoMerger = new AutoMerger();
  const config = loadConfig({ autoMerge: true });

  const passedCheck = {
    success: true,
    testResult: { success: true, output: "OK", exitCode: 0 },
  };

  const approvedReview = {
    approved: true,
    score: 95,
    summary: "Looks good",
    inlineComments: [],
    bugsCount: 0,
    securityCount: 0,
    styleCount: 0,
  };

  const canMerge = autoMerger.canAutoMerge(passedCheck, approvedReview, config);
  assertEquals(canMerge, true);

  const result = await autoMerger.executeAutoMerge(45, passedCheck, approvedReview, config);
  assertEquals(result.merged, true);
  assertStringIncludes(result.message, "Successfully auto-merged PR #45");
});

Deno.test("AutoMerger - rejects merge if autoMerge flag is false", async () => {
  const autoMerger = new AutoMerger();
  const config = loadConfig({ autoMerge: false });

  const passedCheck = {
    success: true,
    testResult: { success: true, output: "OK", exitCode: 0 },
  };

  const approvedReview = {
    approved: true,
    score: 95,
    summary: "Looks good",
    inlineComments: [],
    bugsCount: 0,
    securityCount: 0,
    styleCount: 0,
  };

  const canMerge = autoMerger.canAutoMerge(passedCheck, approvedReview, config);
  assertEquals(canMerge, false);

  const result = await autoMerger.executeAutoMerge(45, passedCheck, approvedReview, config);
  assertEquals(result.merged, false);
});

Deno.test("CodeReviewer - orchestrates end-to-end PR review workflow", async () => {
  const executor = new MockCommandExecutor();
  const reviewer = new CodeReviewer({
    config: loadConfig({ autoMerge: true, worktreeDir: ".worktrees-test" }),
    executor,
  });

  const pr = {
    id: 99,
    branch: "feature/awesome-feature",
    diff: `
diff --git a/src/index.ts b/src/index.ts
+++ b/src/index.ts
@@ -1,1 +1,3 @@
+ export const hello = () => "world";
`,
  };

  const reviewResult = await reviewer.reviewPR(pr);
  assertEquals(reviewResult.prId, 99);
  assertEquals(reviewResult.checkResult.success, true);
  assertEquals(reviewResult.reviewSummary.approved, true);
  assertEquals(reviewResult.autoMergeResult.merged, true);
});
