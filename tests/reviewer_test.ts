import { assertEquals, assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseReviewerConfig,
  WorktreeManager,
  CodeChecker,
  AIReviewer,
  AutoMerger,
  runReviewerWorkflow,
} from "../src/reviewer/index.ts";

Deno.test("Config - parses default options", () => {
  const config = parseReviewerConfig();
  assertEquals(config.autoMerge, false);
  assertEquals(config.worktreeDir, ".worktrees");
  assertEquals(config.minReviewScore, 70);
});

Deno.test("Config - parses command line arguments and flags", () => {
  const args = [
    "--auto-merge",
    "--pr", "42",
    "--branch", "feat/my-feature",
    "--worktree-dir", ".test-worktrees",
    "--min-score", "85"
  ];
  const config = parseReviewerConfig(args);
  assertEquals(config.autoMerge, true);
  assertEquals(config.prNumber, 42);
  assertEquals(config.branch, "feat/my-feature");
  assertEquals(config.worktreeDir, ".test-worktrees");
  assertEquals(config.minReviewScore, 85);
});

Deno.test("Config - parses environment variables for auto-merge", () => {
  const config = parseReviewerConfig([], { HERKULES_AUTO_MERGE: "true" });
  assertEquals(config.autoMerge, true);
});

Deno.test("WorktreeManager - sets up and cleans up worktree path", async () => {
  const manager = new WorktreeManager(".worktrees");
  const info = await manager.setupWorktree("test-1", "main");
  assert(info.path.includes("pr-test-1"));
  assertEquals(info.branch, "main");
  await info.cleanup();
});

Deno.test("CodeChecker - executes verification commands", async () => {
  const checker = new CodeChecker();
  const res = await checker.runCommand("echo hello", ".");
  assertEquals(res.success, true);
  assertStringIncludes(res.stdout, "hello");
});

Deno.test("AIReviewer - reviews clean diff", async () => {
  const reviewer = new AIReviewer();
  const diff = `
+++ b/src/foo.ts
@@ -1,3 +1,3 @@
+export function add(a: number, b: number): number {
+  return a + b;
+}
`;
  const result = await reviewer.reviewDiff(diff);
  assertEquals(result.passed, true);
  assertEquals(result.score, 100);
  assertEquals(result.inlineComments.length, 0);
});

Deno.test("AIReviewer - detects security risks and code quality warnings", async () => {
  const reviewer = new AIReviewer();
  const diff = `
+++ b/src/unsafe.ts
@@ -1,5 +1,5 @@
+const secret = "supersecret123";
+eval("console.log('unsafe')");
+const x: any = 10;
+// TODO: fix this later
+console.log(x);
`;
  const result = await reviewer.reviewDiff(diff);
  assertEquals(result.passed, false);
  assert(result.score < 70);
  assert(result.categories.security.length > 0);
  assert(result.categories.bugs.length > 0);
  assert(result.categories.style.length > 0);
  assert(result.inlineComments.some((c) => c.severity === "error"));
});

Deno.test("AutoMerger - checks auto merge conditions correctly", () => {
  const merger = new AutoMerger();
  const config = parseReviewerConfig(["--auto-merge"]);

  const passingVerification = { success: true, summary: "OK" };
  const failingVerification = { success: false, summary: "Failed" };

  const passingReview = {
    passed: true,
    score: 90,
    summary: "OK",
    inlineComments: [],
    categories: { security: [], bugs: [], style: [] },
  };
  const failingReview = {
    passed: false,
    score: 50,
    summary: "Issues",
    inlineComments: [],
    categories: { security: ["risk"], bugs: [], style: [] },
  };

  assertEquals(merger.canAutoMerge(passingVerification, passingReview, config), true);
  assertEquals(merger.canAutoMerge(failingVerification, passingReview, config), false);
  assertEquals(merger.canAutoMerge(passingVerification, failingReview, config), false);

  const disabledConfig = parseReviewerConfig();
  assertEquals(merger.canAutoMerge(passingVerification, passingReview, disabledConfig), false);
});

Deno.test("AutoMerger - executes auto merge", async () => {
  const merger = new AutoMerger();
  const result = await merger.executeAutoMerge(42);
  assertEquals(result.merged, true);
});

Deno.test("Workflow - runs end-to-end review workflow with auto-merge", async () => {
  const result = await runReviewerWorkflow({
    args: ["--auto-merge", "--pr", "100"],
    diffOverride: `
+++ b/src/clean.ts
@@ -1,2 +1,2 @@
+export const value = 42;
`,
    verificationOverride: {
      success: true,
      summary: "All tests passed",
    },
  });

  assertEquals(result.success, true);
  assertEquals(result.verification.success, true);
  assertEquals(result.review.passed, true);
  assert(result.autoMerge !== null);
  assertEquals(result.autoMerge?.merged, true);
});
