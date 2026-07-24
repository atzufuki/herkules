import { assertEquals, assert } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { parseReviewerConfig } from "../src/reviewer/config.ts";
import { WorktreeManager } from "../src/reviewer/worktree.ts";
import { AiReviewer } from "../src/reviewer/ai_reviewer.ts";
import { AutoMerger } from "../src/reviewer/auto_merge.ts";

Deno.test("Config Parser - parses CLI flags correctly", () => {
  const config = parseReviewerConfig(["--auto-merge", "--pr=123", "--branch=feat/reviewer"]);
  assertEquals(config.autoMerge, true);
  assertEquals(config.prId, "123");
  assertEquals(config.branch, "feat/reviewer");
});

Deno.test("WorktreeManager - returns correct path structure", () => {
  const mgr = new WorktreeManager(".worktrees");
  const path = mgr.getWorktreePath(42);
  assertEquals(path, ".worktrees/pr-42");
});

Deno.test("AiReviewer - analyzes diff for security risks and style", async () => {
  const reviewer = new AiReviewer();
  const sampleDiff = `
diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,3 +10,5 @@
+console.log("debug message");
+eval("unsafeCode()");
`;

  const summary = await reviewer.analyzeDiff(sampleDiff);
  assertEquals(summary.approved, false);
  assert(summary.securityRisks.length > 0);
  assert(summary.styleImprovements.length > 0);
  assertEquals(summary.inlineComments.length, 2);
});

Deno.test("AiReviewer - approves clean diff", async () => {
  const reviewer = new AiReviewer();
  const sampleDiff = `
diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,3 +10,3 @@
+const sum = (a: number, b: number): number => a + b;
`;

  const summary = await reviewer.analyzeDiff(sampleDiff);
  assertEquals(summary.approved, true);
  assertEquals(summary.securityRisks.length, 0);
  assertEquals(summary.score, 100);
});

Deno.test("AutoMerger - evaluates auto-merge condition correctly", () => {
  const merger = new AutoMerger();

  const passingVerification = {
    passed: true,
    testPassed: true,
    lintPassed: true,
    testOutput: "",
    lintOutput: "",
    errors: [],
  };

  const failingVerification = {
    ...passingVerification,
    passed: false,
    testPassed: false,
  };

  const approvedReview = {
    approved: true,
    score: 100,
    summary: "",
    inlineComments: [],
    securityRisks: [],
    bugs: [],
    styleImprovements: [],
  };

  const unapprovedReview = {
    ...approvedReview,
    approved: false,
  };

  assertEquals(merger.shouldAutoMerge(true, passingVerification, approvedReview), true);
  assertEquals(merger.shouldAutoMerge(false, passingVerification, approvedReview), false);
  assertEquals(merger.shouldAutoMerge(true, failingVerification, approvedReview), false);
  assertEquals(merger.shouldAutoMerge(true, passingVerification, unapprovedReview), false);
});
