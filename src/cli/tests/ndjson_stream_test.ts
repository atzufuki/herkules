/**
 * NDJSON Streaming Protocol - Unit Test
 *
 * @module cli/tests/ndjson_stream_test
 */

import { assert, assertEquals } from "@std/assert";
import { parseNdjsonStream } from "@cli/cli.ts";

Deno.test("NDJSON Stream Parser - parses chunks live and extracts final result", async () => {
  const chunksReceived: string[] = [];

  const streamLines = [
    JSON.stringify({ type: "chunk", text: "🚀 Executing Antigravity agent...\n" }),
    JSON.stringify({ type: "chunk", text: "🧠 Agent thought process line 1...\n" }),
    JSON.stringify({
      type: "result",
      success: true,
      files: { "main.ts": "console.log('hello');" },
      logs: "Task completed successfully.",
      engine: "antigravity",
    }),
  ];

  const streamText = streamLines.join("\n") + "\n";
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(streamText));
      controller.close();
    },
  });

  const result = await parseNdjsonStream(readable, (text) => {
    chunksReceived.push(text);
  });

  assertEquals(chunksReceived.length, 2);
  assertEquals(chunksReceived[0], "🚀 Executing Antigravity agent...\n");
  assertEquals(chunksReceived[1], "🧠 Agent thought process line 1...\n");

  assert(result.success);
  assertEquals(result.files["main.ts"], "console.log('hello');");
  assertEquals(result.logs, "Task completed successfully.");
  assertEquals(result.engine, "antigravity");
});
