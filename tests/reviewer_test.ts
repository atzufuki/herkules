import { assertEquals, assert, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { parseConfig, defaultConfig } from '../src/reviewer/config.ts';
import { WorktreeManager } from '../src/reviewer/worktree.ts';
import { CodeChecker } from '../src/reviewer/checker.ts';
import { AIReviewer } from '../src/reviewer/ai_reviewer.ts';
import { AutoMerger } from '../src/reviewer/auto_merge.ts';
import { ReviewerPipeline } from '../src/reviewer/index.ts';

Deno.test('Reviewer Config - Parses CLI flags correctly', () => {
  const config = parseConfig(['--auto-merge', '--merge-method=squash', '--worktree-dir=.test-worktrees']);
  assertEquals(config.autoMerge, true);
  assertEquals(config.autoMergeMethod, 'squash');
  assertEquals(config.worktreeDir, '.test-worktrees');
});

Deno.test('Reviewer Config - Respects defaults and overrides', () => {
  const config = parseConfig([], { autoMerge: true, minApprovalScore: 85 });
  assertEquals(config.autoMerge, true);
  assertEquals(config.minApprovalScore, 85);
  assertEquals(config.testCommand, defaultConfig.testCommand);
});

Deno.test('WorktreeManager - Creates and cleans up worktree directory', async () => {
  const manager = new WorktreeManager('.test-worktrees');
  const info = await manager.createWorktree('test-1', 'main');

  assert(info.path.includes('.test-worktrees/pr-test-1'));
  assertEquals(info.prNumber, 'test-1');

  await info.cleanup();

  let exists = true;
  try {
    await Deno.stat(info.path);
  } catch {
    exists = false;
  }
  assertEquals(exists, false);
});

Deno.test('CodeChecker - Executes verification commands', async () => {
  const checker = new CodeChecker();
  const testDir = await Deno.makeTempDir();

  try {
    const result = await checker.runVerification(testDir, 'echo "test ok"', 'echo "lint ok"');
    assertEquals(result.success, true);
    assertEquals(result.testSuccess, true);
    assertEquals(result.lintSuccess, true);
    assertStringIncludes(result.testOutput, 'test ok');
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test('AIReviewer - Detects security risks and debugger statements in diff', async () => {
  const ai = new AIReviewer();
  const sampleDiff = `
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
+const pass = "secret123"; eval(pass);
+debugger;
+console.log("hello");
`;

  const review = await ai.analyzeDiff(sampleDiff);
  assertEquals(review.passed, false);
  assert(review.securityIssues.length > 0);
  assert(review.bugs.length > 0);
  assert(review.comments.length >= 2);
});

Deno.test('AIReviewer - Approves clean code diffs', async () => {
  const ai = new AIReviewer();
  const cleanDiff = `
diff --git a/src/math.ts b/src/math.ts
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,2 +1,4 @@
 export function add(a: number, b: number): number {
+  return a + b;
 }
`;

  const review = await ai.analyzeDiff(cleanDiff);
  assertEquals(review.passed, true);
  assertEquals(review.score, 100);
});

Deno.test('AutoMerger - Evaluates auto-merge readiness correctly', () => {
  const autoMerger = new AutoMerger();
  const config = parseConfig(['--auto-merge']);

  const checksPass = {
    success: true,
    testSuccess: true,
    testOutput: '',
    lintSuccess: true,
    lintOutput: '',
    errors: [],
  };

  const aiPass = {
    passed: true,
    score: 90,
    summary: '',
    comments: [],
    securityIssues: [],
    bugs: [],
    styleNotes: [],
  };

  assertEquals(autoMerger.canAutoMerge(checksPass, aiPass, config), true);

  const configDisabled = parseConfig([]);
  assertEquals(autoMerger.canAutoMerge(checksPass, aiPass, configDisabled), false);
});

Deno.test('ReviewerPipeline - End-to-end review execution', async () => {
  const pipeline = new ReviewerPipeline();
  const result = await pipeline.runReview({
    prNumber: '99',
    branch: 'main',
    diffText: 'diff --git a/README.md b/README.md\n+++ b/README.md\n@@ -1 +1 @@\n+# Docs update',
    cliArgs: ['--auto-merge', '--test-cmd=echo test', '--lint-cmd=echo lint'],
  });

  assertEquals(result.prNumber, '99');
  assertEquals(result.checks.success, true);
  assertEquals(result.aiReview.passed, true);
  assertStringIncludes(result.summary, 'Herkules PR Review Summary');
});
