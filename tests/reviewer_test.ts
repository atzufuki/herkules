import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseConfig,
  createWorktree,
  runChecks,
  parseDiffAndAnalyze,
  evaluateAndAutoMerge,
  runReviewer,
} from "../src/reviewer/index.ts";

Deno.test("Config - default settings and CLI flags", () => {
  const defaultConfig = parseConfig();
  assertEquals(defaultConfig.autoMerge, false);
  assertEquals(defaultConfig.targetBranch, "main");
  assertEquals(defaultConfig.worktreeDir, ".worktrees");

  const parsedFlags = parseConfig(["--auto-merge", "--pr", "42", "--branch", "feature/awesome"]);
  assertEquals(parsedFlags.autoMerge, true);
  assertEquals(parsedFlags.prId, "42");
  assertEquals(parsedFlags.branch, "feature/awesome");
});

Deno.test("Worktree Isolation - create and cleanup worktree", async () => {
  const worktree = await createWorktree("test-101", "main", ".worktrees-test");
  assertExists(worktree.path);
  assertEquals(worktree.path.includes("pr-test-101"), true);

  await worktree.cleanup();
});

Deno.test("Checker - execution and verification results", async () => {
  const mockExec = async (cmd: string) => {
    if (cmd.includes("failing-test")) {
      return { success: false, stdout: "", stderr: "Test failed" };
    }
    return { success: true, stdout: "OK", stderr: "" };
  };

  const passResult = await runChecks(".worktrees/test", {
    testCommand: "deno task test",
    lintCommand: "deno lint",
    execFn: mockExec,
  });
  assertEquals(passResult.passed, true);
  assertEquals(passResult.results.length, 2);

  const failResult = await runChecks(".worktrees/test", {
    testCommand: "failing-test",
    lintCommand: "deno lint",
    execFn: mockExec,
  });
  assertEquals(failResult.passed, false);
});

Deno.test("AI Reviewer - diff analysis and security detection", () => {
  const cleanDiff = `
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,3 @@
-const x = 1;
+const x = 2;
  `;
  const cleanReview = parseDiffAndAnalyze(cleanDiff);
  assertEquals(cleanReview.approved, true);
  assertEquals(cleanReview.categories.bugs, 0);
  assertEquals(cleanReview.categories.security, 0);

  const riskyDiff = `
diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,3 @@
-function login() {}
+function login() { eval("secret"); const password = "123"; console.log(password); }
  `;
  const riskyReview = parseDiffAndAnalyze(riskyDiff);
  assertEquals(riskyReview.approved, false);
  assertEquals(riskyReview.categories.security > 0, true);
  assertEquals(riskyReview.inlineComments.length > 0, true);
});

Deno.test("Auto-Merge - conditions evaluation", async () => {
  const mockVerificationPass = { passed: true, results: [] };
  const mockVerificationFail = { passed: false, results: [] };
  const mockReviewPass = {
    approved: true,
    summary: "Pass",
    inlineComments: [],
    score: 100,
    categories: { bugs: 0, security: 0, style: 0 },
  };
  const mockReviewFail = {
    approved: false,
    summary: "Fail",
    inlineComments: [],
    score: 50,
    categories: { bugs: 1, security: 1, style: 0 },
  };

  const mockExec = async () => ({ success: true, stdout: "", stderr: "" });

  // Disabled auto-merge
  const resDisabled = await evaluateAndAutoMerge(mockVerificationPass, mockReviewPass, {
    enabled: false,
    prId: 1,
    branch: "feat",
    execFn: mockExec,
  });
  assertEquals(resDisabled.merged, false);

  // Enabled, all pass
  const resPass = await evaluateAndAutoMerge(mockVerificationPass, mockReviewPass, {
    enabled: true,
    prId: 1,
    branch: "feat",
    execFn: mockExec,
  });
  assertEquals(resPass.merged, true);

  // Enabled, verification fails
  const resVerificationFail = await evaluateAndAutoMerge(mockVerificationFail, mockReviewPass, {
    enabled: true,
    prId: 1,
    branch: "feat",
    execFn: mockExec,
  });
  assertEquals(resVerificationFail.merged, false);

  // Enabled, review fails
  const resReviewFail = await evaluateAndAutoMerge(mockVerificationPass, mockReviewFail, {
    enabled: true,
    prId: 1,
    branch: "feat",
    execFn: mockExec,
  });
  assertEquals(resReviewFail.merged, false);
});

Deno.test("Orchestrator - full reviewer workflow", async () => {
  const mockExec = async () => ({ success: true, stdout: "OK", stderr: "" });
  const mockAnalyzer = async () => ({
    approved: true,
    summary: "Great PR!",
    inlineComments: [],
    score: 100,
    categories: { bugs: 0, security: 0, style: 0 },
  });

  const report = await runReviewer({
    config: {
      prId: "99",
      branch: "feature/test",
      autoMerge: true,
      worktreeDir: ".worktrees-test",
    },
    checkerOptions: { execFn: mockExec },
    aiConfig: { customAnalyzer: mockAnalyzer },
  });

  assertEquals(report.prId, "99");
  assertEquals(report.verification.passed, true);
  assertEquals(report.review.approved, true);
  assertEquals(report.autoMerge.merged, true);
});
