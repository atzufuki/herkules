/**
 * Proxy NDJSON Streaming Protocol - Local Integration Test
 *
 * NOTE: Gated for local execution only. Skipped in CI environment.
 *
 * @module cli/tests/proxy_streaming_integration_test
 */

import { assert, assertEquals } from "@std/assert";
import { parseNdjsonStream } from "@cli/cli.ts";

Deno.test("Proxy Streaming Integration - Local mock HTTP server NDJSON stream parsing", async () => {
  // Strict CI Guard: Skip integration test when executing in CI environments
  const isCi = Deno.env.get("CI") === "true" || Deno.env.get("GITHUB_ACTIONS") === "true";
  if (isCi) {
    console.log("ℹ️ Skipping proxy streaming integration test in CI environment.");
    return;
  }

  let listenPort = 0;
  let resolvePort: (port: number) => void;
  const portPromise = new Promise<number>((res) => {
    resolvePort = res;
  });
  const controller = new AbortController();

  // Start mock HTTP server streaming NDJSON
  const server = Deno.serve(
    {
      port: 0,
      hostname: "127.0.0.1",
      signal: controller.signal,
      onListen({ port }) {
        listenPort = port;
        resolvePort(port);
      },
    },
    (_req: Request) => {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      (async () => {
        await writer.write(encoder.encode(JSON.stringify({ type: "chunk", text: "🚀 Live chunk 1\n" }) + "\n"));
        await writer.write(encoder.encode(JSON.stringify({ type: "chunk", text: "🧠 Live chunk 2\n" }) + "\n"));
        await writer.write(
          encoder.encode(
            JSON.stringify({
              type: "result",
              success: true,
              files: { "test.txt": "hello world" },
              logs: "Stream complete",
              engine: "antigravity",
            }) + "\n",
          ),
        );
        await writer.close();
      })();

      return new Response(readable, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    },
  );

  try {
    const port = await portPromise;
    const resp = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test" }),
    });
    assertEquals(resp.status, 200);
    assert(resp.body !== null);

    const liveChunks: string[] = [];
    const result = await parseNdjsonStream(resp.body, (chunkText) => {
      liveChunks.push(chunkText);
    });

    assertEquals(liveChunks.length, 2);
    assertEquals(liveChunks[0], "🚀 Live chunk 1\n");
    assertEquals(liveChunks[1], "🧠 Live chunk 2\n");
    assert(result.success);
    assertEquals(result.files["test.txt"], "hello world");
  } finally {
    controller.abort();
    await server.finished.catch(() => {});
  }
});
