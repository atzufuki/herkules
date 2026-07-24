import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseReviewerConfig } from "../src/reviewer/config.ts";
import { WorktreeManager } from "../src/reviewer/worktree.ts";
import { runVerification } from "../src/reviewer/checker.ts";
import { analyzeDiff } from "../src/reviewer/ai_reviewer.ts";
import { canAutoMerge } from "../src/reviewer/auto_merge.ts";
import { runReviewer } from "../src/reviewer/index.ts";

Deno.test("Reviewer - Config Parsing", () => {
  const config = parseReviewerConfig(["--auto-merge", "--pr=42", "--branch=feat/test"]);
  assertEquals(config.autoMerge, true);
  assertEquals(config.prNumber, 42);
  assertEquals(config.branch, "feat/test");
  assertEquals(config.worktreeDir, ".worktrees");
});

Deno.test("Reviewer - Worktree Manager", async () => {
  const manager = new WorktreeManager(".worktrees/test-tmp");
  const info = await manager.createWorktree(999, "main");
  assert(info.path.includes("pr-999"));

  const removed = await manager.removeWorktree(info.path);
  assertEquals(removed, true);
});

Deno.test("Reviewer - Verification Runner", async () => {
  const result = await runVerification(".", "echo 'tests passed'", "echo 'lint passed'");
  assertEquals(result.testsPassed, true);
  assertEquals(result.lintPassed, true);
  assertEquals(result.success, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("Reviewer - Verification Runner Failure", async () => {
  const result = await runVerification(".", "deno eval 'Deno.exit(1)'");
  assertEquals(result.testsPassed, false);
  assertEquals(result.success, false);
  assert(result.errors.length > 0);
});

Deno.test("Reviewer - AI Code Reviewer Analysis", () => {
  const diff = `
diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,5 @@
+const pass = "12345"; eval(pass);
+if (x == null) return;
+var oldVar = true;
`;
  const review = analyzeDiff(diff);
  assert(review.score < 100);
  assertEquals(review.approved, false);
  assert(review.highlights.securityRisks.length > 0);
  assert(review.highlights.bugs.length > 0);
  assert(review.highlights.styleImprovements.length > 0);
});

Deno.test("Reviewer - Auto-Merge Decision Logic", () => {
  const verificationSuccess = {
    success: true,
    testsPassed: true,
    lintPassed: true,
    testOutput: "ok",
    lintOutput: "ok",
    errors: [],
  };

  const reviewApproved = {
    summary: "Looks good!",
    score: 95,
    approved: true,
    inlineComments: [],
    highlights: { bugs: [], securityRisks: [], styleImprovements: [] },
  };

  const reviewRejected = {
    summary: "Security risk",
    score: 50,
    approved: false,
    inlineComments: [],
    highlights: { bugs: [], securityRisks: ["sec issue"], styleImprovements: [] },
  };

  const res1 = canAutoMerge(verificationSuccess, reviewApproved, { autoMerge: false, worktreeDir: "", testCommand: "", lintCommand: "" });
  assertEquals(res1.allowed, false);

  const res2 = canAutoMerge(verificationSuccess, reviewApproved, { autoMerge: true, worktreeDir: "", testCommand: "", lintCommand: "" });
  assertEquals(res2.allowed, true);

  const res3 = canAutoMerge(verificationSuccess, reviewRejected, { autoMerge: true, worktreeDir: "", testCommand: "", lintCommand: "" });
  assertEquals(res3.allowed, false);
});

Deno.test("Reviewer - Complete Orchestration Flow", async () => {
  const output = await runReviewer({
    autoMerge: false,
    prNumber: 3,
    testCommand: "echo 'all tests pass'",
    lintCommand: "echo 'lint ok'",
  });

  assertEquals(output.prNumber, 3);
  assertEquals(output.verification.success, true);
  assertEquals(output.autoMerge.merged, false);
});
