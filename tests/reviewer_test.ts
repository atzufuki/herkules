import { assertEquals, assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseArgs,
  defaultConfig,
  runVerification,
  generateAIReview,
  evaluateAutoMergeEligibility,
  runReviewer,
} from "../src/reviewer/index.ts";

Deno.test("Config - parses default config and command-line flags", () => {
  const defaults = defaultConfig();
  assertEquals(defaults.autoMerge, false);
  assertEquals(defaults.baseBranch, "main");

  const parsed = parseArgs(["--auto-merge", "--pr=42", "--branch=feat/test", "--base=main"]);
  assertEquals(parsed.autoMerge, true);
  assertEquals(parsed.prId, "42");
  assertEquals(parsed.branch, "feat/test");
  assertEquals(parsed.baseBranch, "main");
});

Deno.test("Checker - executes verification checks", async () => {
  const result = await runVerification({
    worktreePath: ".",
    testCommand: "deno --version",
    lintCommand: "deno --version",
    runTests: true,
    runLint: true,
  });

  assertEquals(result.passed, true);
  assertEquals(result.checks.length, 2);
  assert(result.summary.includes("2/2 checks passed"));
});

Deno.test("AI Reviewer - flags security issues and generates inline comments", async () => {
  const sampleDiff = `
+ function executeInput(input: string) {
+   eval(input);
+ }
  `;

  const review = await generateAIReview({ diff: sampleDiff });
  assertEquals(review.passed, false);
  assert(review.highlights.securityRisks.length > 0);
  assert(review.inlineComments.some((c) => c.category === "security"));
  assertStringIncludes(review.summary, "AI Code Review Summary");
});

Deno.test("AI Reviewer - passes clean diff", async () => {
  const cleanDiff = `
+ export function add(a: number, b: number): number {
+   return a + b;
+ }
  `;

  const review = await generateAIReview({ diff: cleanDiff });
  assertEquals(review.passed, true);
  assertEquals(review.highlights.securityRisks.length, 0);
  assertEquals(review.highlights.bugs.length, 0);
});

Deno.test("Auto Merge - evaluates eligibility correctly", () => {
  const passingVerification = {
    passed: true,
    checks: [],
    summary: "All passed",
  };
  const failingVerification = {
    passed: false,
    checks: [],
    summary: "Failed",
  };

  const passingReview = {
    passed: true,
    overallScore: 90,
    summary: "Good",
    highlights: { bugs: [], securityRisks: [], styleImprovements: [] },
    inlineComments: [],
  };

  let result = evaluateAutoMergeEligibility({ autoMerge: false }, passingVerification, passingReview);
  assertEquals(result.eligible, false);

  result = evaluateAutoMergeEligibility({ autoMerge: true }, passingVerification, passingReview);
  assertEquals(result.eligible, true);

  result = evaluateAutoMergeEligibility({ autoMerge: true }, failingVerification, passingReview);
  assertEquals(result.eligible, false);
});

Deno.test("Orchestrator - runs full reviewer workflow", async () => {
  const result = await runReviewer({
    prId: "123",
    branch: "main",
    autoMerge: false,
    testCommand: "deno --version",
    lintCommand: "deno --version",
  });

  assert(result !== null);
  assertEquals(result.prId, "123");
  assertEquals(result.verification.passed, true);
  assertEquals(result.autoMerge.merged, false);
});
