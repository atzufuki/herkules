import { assertEquals, assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseReviewerArgs, resolveConfig } from "../src/reviewer/config.ts";
import { GitWorktreeManager } from "../src/reviewer/worktree.ts";
import { AIReviewer } from "../src/reviewer/ai_reviewer.ts";
import { AutoMerger } from "../src/reviewer/auto_merge.ts";
import { PullRequestReviewer } from "../src/reviewer/index.ts";

Deno.test("Config - parses --auto-merge and CLI args correctly", () => {
  const args = ["--auto-merge", "--pr=123", "--branch=feat/reviewer", "--target=main"];
  const parsed = parseReviewerArgs(args);
  assertEquals(parsed.autoMerge, true);
  assertEquals(parsed.prId, "123");
  assertEquals(parsed.branch, "feat/reviewer");
  assertEquals(parsed.targetBranch, "main");

  const resolved = resolveConfig(parsed);
  assertEquals(resolved.autoMerge, true);
  assertEquals(resolved.prId, "123");
  assertEquals(resolved.worktreesDir, ".worktrees");
});

Deno.test("WorktreeManager - generates correct worktree path", () => {
  const manager = new GitWorktreeManager(45, "feature-test", ".worktrees");
  assertEquals(manager.path, ".worktrees/pr-45");
});

Deno.test("AIReviewer - detects security risks and bugs from diff logic", async () => {
  const reviewer = new AIReviewer({
    worktreePath: ".",
    targetBranch: "main",
  });

  reviewer.getGitDiff = async () => `
+++ b/src/vulnerable.ts
@@ -1,3 +1,5 @@
+const password = "supersecretpassword123";
+eval("console.log('unsafe')");
+if (x == null) { return; }
+var legacyVar = 42;
`;

  const summary = await reviewer.analyze();
  assertEquals(summary.approved, false);
  assert(summary.highlights.securityRisks.length >= 2);
  assert(summary.highlights.bugs.length >= 1);
  assert(summary.highlights.styleImprovements.length >= 1);

  const markdown = reviewer.formatMarkdownReport(summary);
  assertStringIncludes(markdown, "Security Risks");
  assertStringIncludes(markdown, "Potential Bugs");
});

Deno.test("AutoMerger - checks conditions correctly", () => {
  const passCheck = { passed: true, testPassed: true, lintPassed: true, testLogs: "", lintLogs: "" };
  const failCheck = { passed: false, testPassed: false, lintPassed: true, testLogs: "Error", lintLogs: "" };

  const passReview = {
    approved: true,
    score: 100,
    summary: "LGTM",
    inlineComments: [],
    highlights: { bugs: [], securityRisks: [], styleImprovements: [] },
  };

  const failReview = {
    approved: false,
    score: 40,
    summary: "Bugs found",
    inlineComments: [],
    highlights: { bugs: ["Bug"], securityRisks: [], styleImprovements: [] },
  };

  const res1 = AutoMerger.canMerge(false, passCheck, passReview);
  assertEquals(res1.allowed, false);
  assertStringIncludes(res1.reason, "disabled");

  const res2 = AutoMerger.canMerge(true, failCheck, passReview);
  assertEquals(res2.allowed, false);
  assertStringIncludes(res2.reason, "Automated checks failed");

  const res3 = AutoMerger.canMerge(true, passCheck, failReview);
  assertEquals(res3.allowed, false);
  assertStringIncludes(res3.reason, "AI review flagged blocking issues");

  const res4 = AutoMerger.canMerge(true, passCheck, passReview);
  assertEquals(res4.allowed, true);
});

Deno.test("PullRequestReviewer - orchestrates end-to-end flow", async () => {
  const prReviewer = new PullRequestReviewer({
    prId: "99",
    branch: "test-branch",
    autoMerge: false,
  });

  const result = await prReviewer.run();
  assert(result.config !== undefined);
  assert(result.checkResult !== undefined);
  assert(result.reviewSummary !== undefined);
  assert(result.markdownReport.length > 0);
  assertEquals(result.autoMergeResult.merged, false);
});
