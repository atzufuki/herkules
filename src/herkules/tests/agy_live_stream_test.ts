/**
 * Antigravity Live Log Tailing & Streaming - Execution Test
 *
 * NOTE: Local execution only. Bypassed in CI environments.
 *
 * @module herkules/tests/agy_live_stream_test
 */

import { assert, assertEquals } from "@std/assert";
import { tailLogFile } from "@herkules/runner.ts";

Deno.test("Antigravity Log Tailer - streams log lines in real time as file is appended", async () => {
  const isCi = Deno.env.get("CI") === "true" || Deno.env.get("GITHUB_ACTIONS") === "true";
  if (isCi) {
    console.log("ℹ️ Skipping live log stream test in CI environment.");
    return;
  }

  const tempDir = await Deno.makeTempDir({ prefix: "herkules_tail_test_" });
  const logFile = `${tempDir}/live.log`;
  await Deno.writeTextFile(logFile, "");

  const chunksReceived: string[] = [];
  const stopTailer = { stop: false };

  // Start background log tailer
  const tailPromise = tailLogFile(logFile, (chunk) => {
    chunksReceived.push(chunk);
  }, stopTailer, 50);

  // Simulate active process appending lines to log file over time
  await Deno.writeTextFile(logFile, "🚀 [Antigravity] Initializing workspace...\n", { append: true });
  await new Promise((r) => setTimeout(r, 120));

  await Deno.writeTextFile(logFile, "🧠 [Antigravity] Thinking about issue #3...\n", { append: true });
  await new Promise((r) => setTimeout(r, 120));

  await Deno.writeTextFile(logFile, "✨ [Antigravity] Applied file edits.\n", { append: true });
  await new Promise((r) => setTimeout(r, 120));

  stopTailer.stop = true;
  await tailPromise;

  try {
    assert(chunksReceived.length >= 3);
    assert(chunksReceived.some((c) => c.includes("Initializing workspace")));
    assert(chunksReceived.some((c) => c.includes("Thinking about issue #3")));
    assert(chunksReceived.some((c) => c.includes("Applied file edits")));
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
