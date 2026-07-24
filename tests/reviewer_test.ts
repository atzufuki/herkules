import { assertEquals, assert } from "jsr:@std/assert";
import { parseConfig } from "../src/reviewer/config.ts";
import { AIReviewer } from "../src/reviewer/ai_reviewer.ts";
import { AutoMerger } from "../src/reviewer/auto_merge.ts";
import { CodeChecker } from "../src/reviewer/checker.ts";

Deno.test("parseConfig parses --auto-merge flag and defaults", () => {
  const config = parseConfig(["--auto-merge"], {});
  assertEquals(config.autoMerge, true);
  assertEquals(config.worktreeDir, ".worktrees");
});

Deno.test("AIReviewer detects bugs and security issues in diff", async () => {
  const reviewer = new AIReviewer("gpt-4o");
  const mockDiff = `
diff --git a/src/index.ts b/src/index.ts
index 123..456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
+console.log("debug line");
+eval("unsafeCode()");
`;

  const review = await reviewer.reviewDiff(mockDiff);
  assertEquals(review.passed, false);
  assert(review.score < 100);
  assertEquals(review.inlineComments.length, 2);
  assertEquals(review.inlineComments[0].severity, "bug");
  assertEquals(review.inlineComments[1].severity, "security");
});

Deno.test("AIReviewer passes clean diff", async () => {
  const reviewer = new AIReviewer("gpt-4o");
  const cleanDiff = `
diff --git a/src/math.ts b/src/math.ts
index 123..456 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,1 +1,2 @@
+export function add(a: number, b: number) { return a + b; }
`;

  const review = await reviewer.reviewDiff(cleanDiff);
  assertEquals(review.passed, true);
  assertEquals(review.score, 100);
  assertEquals(review.inlineComments.length, 0);
});

Deno.test("AutoMerger respects auto-merge configuration and test/AI status", () => {
  const autoMerger = new AutoMerger();

  const disabledCheck = autoMerger.canAutoMerge(
    { prId: 1, branch: "feat", testPassed: true, lintPassed: true, aiPassed: true, score: 100 },
    false
  );
  assertEquals(disabledCheck.eligible, false);

  const testFailedCheck = autoMerger.canAutoMerge(
    { prId: 1, branch: "feat", testPassed: false, lintPassed: true, aiPassed: true, score: 100 },
    true
  );
  assertEquals(testFailedCheck.eligible, false);

  const passedCheck = autoMerger.canAutoMerge(
    { prId: 1, branch: "feat", testPassed: true, lintPassed: true, aiPassed: true, score: 100 },
    true
  );
  assertEquals(passedCheck.eligible, true);
});

Deno.test("CodeChecker executes command and returns pass/fail", async () => {
  const checker = new CodeChecker();
  const res = await checker.runChecks(".", {
    testCommand: "echo test-passed",
    lintCommand: "echo lint-passed",
  });
  assertEquals(res.passed, true);
  assertEquals(res.testPassed, true);
  assertEquals(res.lintPassed, true);
});
