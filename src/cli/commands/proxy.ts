/**
 * Alexi Management Command: proxy
 *
 * Starts an Antigravity Execution Proxy HTTP server for Herkules with built-in zero-auth tunneling.
 * Exposes a lightweight Deno HTTP endpoint for GitHub Actions CI.
 * Executes incoming prompts locally using the official `agy` CLI (Google AI Ultra)
 * and returns generated files back to GitHub Actions.
 *
 * Usage:
 *  ./herkules proxy [--port 8000] [--repo owner/repo]
 *
 * @module cli/commands/proxy
 */

import { dirname, join } from "@std/path";
import { BaseCommand } from "@alexi/core/management";
import { AntigravityRunner, applyFallbackFileWrites } from "@herkules/runner.ts";
import { setRepoSecretWithGh } from "@herkules/github_app.ts";
import { getGitHubContext } from "@herkules/github.ts";
import { createWorktree, removeWorktree } from "@herkules/git.ts";
import { handleTokenRelayRequest, TunnelMessage, TunnelResponse } from "@web/relay.ts";

/**
 * Recursively scans directory using git status --porcelain to collect only modified and new text files.
 */
export async function collectModifiedFiles(dirPath: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  try {
    const command = new Deno.Command("git", {
      args: ["status", "--porcelain", "-uall"],
      cwd: dirPath,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();

    if (output.success) {
      const statusText = new TextDecoder().decode(output.stdout);
      const lines = statusText.split("\n").map((l) => l.trim()).filter(Boolean);

      for (const line of lines) {
        // Line format: " M path/to/file" or "?? path/to/file" or "A  path/to/file"
        const relPath = line.substring(3).trim();
        if (!relPath || relPath.startsWith(".git/") || relPath.startsWith(".worktrees/")) {
          continue;
        }

        try {
          const fullPath = join(dirPath, relPath);
          const content = await Deno.readTextFile(fullPath);
          files[relPath] = content;
        } catch {
          // Ignore deleted files or binary files
        }
      }

      // Always return git status results if git was available, never fall back to full tree dump
      return files;
    }
  } catch {
    // Fall back to recursive walk ONLY if git binary command fails to execute
  }

  // Fallback recursive directory walk for non-git temp directories
  async function walkDir(currentDir: string) {
    try {
      for await (const entry of Deno.readDir(currentDir)) {
        if (entry.name === ".git" || entry.name === ".worktrees" || entry.name === "node_modules") {
          continue;
        }
        const fullPath = join(currentDir, entry.name);
        const relPath = fullPath.substring(dirPath.length + 1);

        if (entry.isDirectory) {
          await walkDir(fullPath);
        } else if (entry.isFile) {
          try {
            const content = await Deno.readTextFile(fullPath);
            files[relPath] = content;
          } catch {
            // Ignore binary files or read errors
          }
        }
      }
    } catch {
      // Ignore readDir error
    }
  }

  await walkDir(dirPath);
  return files;
}

export interface ProxyExecuteRequest {
  prompt: string;
  issueNum?: number;
  repoSpec?: string;
  secretToken?: string;
}

export interface ProxyExecuteResponse {
  success: boolean;
  files: Record<string, string>;
  logs: string;
  engine: string;
  error?: string;
}

export function connectNativeTunnel(relayUrl: string, repoSpec: string, localPort: number): WebSocket | undefined {
  try {
    const wsUrl = relayUrl
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:")
      .replace(/\/+$/, "") + `/ws/${repoSpec}`;

    console.log(`🔌 Connecting Native WebSocket Tunnel to ${wsUrl}...`);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log(`✓ Connected to Herkules Native WebSocket Tunnel for ${repoSpec}!`);
    };

    ws.onmessage = async (event) => {
      let reqId = "";
      let heartbeatTimer: any = null;
      try {
        const msg: TunnelMessage = JSON.parse(event.data);
        reqId = msg.id;

        // Send periodic heartbeat every 2 seconds to keep stream alive
        heartbeatTimer = setInterval(() => {
          try {
            ws.send(JSON.stringify({ id: reqId, chunk: `⏳ Agent running on local proxy...\n`, done: false }));
          } catch {
            clearInterval(heartbeatTimer);
          }
        }, 2000);

        // Forward request locally to Deno.serve endpoint on localhost:localPort
        const targetUrl = `http://127.0.0.1:${localPort}${msg.url}`;
        const cleanHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (msg.headers?.["content-type"]) {
          cleanHeaders["Content-Type"] = msg.headers["content-type"];
        }

        const res = await fetch(targetUrl, {
          method: msg.method,
          headers: cleanHeaders,
          body: msg.body,
        });

        if (res.body) {
          const decoder = new TextDecoder();
          for await (const chunkBytes of res.body) {
            const text = decoder.decode(chunkBytes, { stream: true });
            if (text) {
              ws.send(JSON.stringify({ id: reqId, chunk: text, done: false }));
            }
          }
          const remaining = decoder.decode();
          if (remaining) {
            ws.send(JSON.stringify({ id: reqId, chunk: remaining, done: false }));
          }
        }

        clearInterval(heartbeatTimer);

        const tunnelRes: TunnelResponse = {
          id: msg.id,
          status: res.status,
          headers: { "Content-Type": "application/x-ndjson" },
          body: "",
        };

        ws.send(JSON.stringify({ id: reqId, response: tunnelRes, done: true }));
      } catch (err) {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        console.error("❌ Tunnel request processing error:", err);
        if (reqId) {
          try {
            const tunnelRes: TunnelResponse = {
              id: reqId,
              status: 500,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ success: false, error: String(err) }),
            };
            ws.send(JSON.stringify({ id: reqId, response: tunnelRes, done: true }));
          } catch {
            // Ignore
          }
        }
      }
    };

    ws.onerror = (err) => {
      const msg = err instanceof ErrorEvent ? err.message : "";
      if (msg) console.warn("⚠️ WebSocket Tunnel Connection Notice:", msg);
    };

    ws.onclose = () => {
      // Auto-reconnect after 5 seconds
      setTimeout(() => connectNativeTunnel(relayUrl, repoSpec, localPort), 5000);
    };

    return ws;
  } catch {
    return undefined;
  }
}

export class ProxyCommand extends BaseCommand {
  override name = "proxy";
  override help = "Starts local Antigravity (agy) execution proxy server with built-in zero-auth tunnel";

  override async handle(options?: any): Promise<{ exitCode: number }> {
    const port = (typeof options === "object" && options?.port) ? parseInt(options.port, 10) : 8000;
    const secretToken = Deno.env.get("HERKULES_PROXY_SECRET") ?? Deno.env.get("GRAVITY_WORKER_PROXY_SECRET");
    const targetRepoFlag = typeof options === "object" ? options?.repo : undefined;
    const providedUrl = typeof options === "object" ? (options?.url ?? options?.tunnelUrl) : undefined;

    let targetDir = ".";
    let repoSpec: string | undefined;

    if (targetRepoFlag) {
      repoSpec = targetRepoFlag;
    } else {
      try {
        const text = await Deno.readTextFile(`${targetDir}/.herkules.json`);
        const config = JSON.parse(text);
        if (config.targetRepo) {
          repoSpec = config.targetRepo;
        }
      } catch {
        // Ignore
      }

      if (!repoSpec) {
        const ghContext = await getGitHubContext(targetDir);
        if (ghContext.repoOwner && ghContext.repoName) {
          repoSpec = `${ghContext.repoOwner}/${ghContext.repoName}`;
        }
      }
    }

    const HERKULES_VERSION = "0.1.2-strict-diff";

    console.log("=======================================================");
    console.log(`🚀 HERKULES LOCAL ANTIGRAVITY PROXY SERVER STARTED (v${HERKULES_VERSION})`);
    console.log("=======================================================");
    console.log(`- Version:         v${HERKULES_VERSION}`);
    console.log(`- Listening Port:  ${port}`);
    console.log(`- Engine:          ANTIGRAVITY (agy CLI / Google AI Ultra)`);
    console.log(`- Target Repo:     ${repoSpec ?? "Auto-detect"}`);
    console.log(`- Auth Security:   ${secretToken ? "Protected (Secret Token Set)" : "Open Local Endpoint"}`);

    const controller = new AbortController();

    const server = Deno.serve(
      { port, signal: controller.signal },
      async (req: Request): Promise<Response> => {
        const url = new URL(req.url);

        // 1. Health check endpoint for GitHub Actions pre-flight check
        if (req.method === "GET" && (url.pathname === "/health" || url.pathname.endsWith("/health") || url.pathname === "/")) {
          return new Response(
            JSON.stringify({ status: "ok", engine: "antigravity", version: HERKULES_VERSION }),
            { headers: { "Content-Type": "application/json", "Bypass-Tunnel-Remainder": "true" } },
          );
        }

        // 2. Token Relay endpoint for GitHub Actions keyless authentication
        if (url.pathname.endsWith("/api/token") || url.pathname.endsWith("/api/token/")) {
          const res = await handleTokenRelayRequest(req);
          res.headers.set("Bypass-Tunnel-Remainder", "true");
          return res;
        }

        // 3. Execution endpoint /api/execute
        if (req.method === "POST" && (url.pathname.endsWith("/api/execute") || url.pathname.endsWith("/execute"))) {
          try {
            const body: ProxyExecuteRequest = await req.json();

            if (secretToken && body.secretToken !== secretToken) {
              return new Response(
                JSON.stringify({ success: false, error: "Unauthorized: Invalid secretToken" }),
                { status: 401, headers: { "Content-Type": "application/json", "Bypass-Tunnel-Remainder": "true" } },
              );
            }

            if (!body.prompt) {
              return new Response(
                JSON.stringify({ success: false, error: "Bad Request: Missing prompt" }),
                { status: 400, headers: { "Content-Type": "application/json", "Bypass-Tunnel-Remainder": "true" } },
              );
            }

            console.log(`\n🎯 [v${HERKULES_VERSION}] Received proxy execution request for Issue #${body.issueNum ?? "N/A"}`);
            console.log(`  Prompt: "${body.prompt.substring(0, 80)}..."`);

            // 1. Create an isolated Git Worktree for execution
            const taskId = `proxy-${body.issueNum ?? Date.now()}`;
            let worktreePath = "";
            let worktreeObj: any = null;

            try {
              worktreeObj = await createWorktree({ taskId, prompt: body.prompt }, targetDir);
              worktreePath = worktreeObj.worktreePath;
            } catch {
              // Fallback to temp directory if not running inside a git repo
              worktreePath = await Deno.makeTempDir({ prefix: "herkules-proxy-worktree-" });
            }

            const { readable, writable } = new TransformStream();
            const writer = writable.getWriter();
            const encoder = new TextEncoder();

            // Run execution asynchronously and stream NDJSON chunks & result
            (async () => {
              let result: { success: boolean; output: string; durationMs: number; error?: string } = {
                success: false,
                output: "",
                durationMs: 0,
              };

              try {
                const runner = new AntigravityRunner();
                console.log(`\n🧠 [Antigravity Stream] Agent thought stream & execution log:`);
                console.log(`-------------------------------------------------------`);
                result = await runner.run({
                  prompt: body.prompt,
                  worktreePath,
                  onChunk: (chunk) => {
                    Deno.stdout.writeSync(new TextEncoder().encode(chunk));
                    const chunkLine = JSON.stringify({ type: "chunk", text: chunk }) + "\n";
                    writer.write(encoder.encode(chunkLine)).catch(() => {});
                  },
                });
                console.log(`\n-------------------------------------------------------`);
                await applyFallbackFileWrites(body.prompt, result.output, worktreePath);

                // 2. Recursively collect generated/modified files from worktree
                const files = await collectModifiedFiles(worktreePath);

                // Fallback: If agent produced summary output but 0 disk files modified, preserve summary artifact
                if (Object.keys(files).length === 0 && result.output && result.output.trim().length > 0) {
                  const summaryRelPath = ".herkules/summary.md";
                  files[summaryRelPath] = result.output.trim();
                  console.log(`✨ Preserved execution summary artifact in ${summaryRelPath}`);
                }

                // 3. Safely clean up temporary worktree
                if (worktreeObj) {
                  await removeWorktree(worktreeObj, { deleteBranch: true }).catch(() => {});
                } else if (worktreePath) {
                  await Deno.remove(worktreePath, { recursive: true }).catch(() => {});
                }

                console.log(`✓ Proxy execution completed successfully. (${Object.keys(files).length} files generated)`);

                const resultLine = JSON.stringify({
                  type: "result",
                  success: result.success,
                  files,
                  logs: result.output,
                  engine: "antigravity",
                  error: result.error,
                }) + "\n";
                await writer.write(encoder.encode(resultLine)).catch(() => {});
                await writer.close().catch(() => {});
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`❌ Proxy execution error: ${msg}`);
                const errLine = JSON.stringify({
                  type: "result",
                  success: false,
                  files: {},
                  logs: msg,
                  engine: "antigravity",
                  error: msg,
                }) + "\n";
                await writer.write(encoder.encode(errLine)).catch(() => {});
                await writer.close().catch(() => {});
              }
            })();

            return new Response(readable, {
              headers: {
                "Content-Type": "application/x-ndjson",
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "no-cache",
                "Bypass-Tunnel-Remainder": "true",
              },
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`❌ Proxy request processing error: ${msg}`);
            return new Response(
              JSON.stringify({ success: false, files: {}, logs: msg, engine: "antigravity", error: msg }),
              { status: 500, headers: { "Content-Type": "application/json", "Bypass-Tunnel-Remainder": "true" } },
            );
          }
        }

        return new Response("Not Found", { status: 404, headers: { "Bypass-Tunnel-Remainder": "true" } });
      },
    );

    // Initialize Native WebSocket Tunnel
    const relayUrl = Deno.env.get("HERKULES_RELAY_URL") ?? "https://herkules.atzufuki.deno.net";

    if (repoSpec) {
      connectNativeTunnel(relayUrl, repoSpec, port);
      const activeTunnelUrl = `${relayUrl.replace(/\/+$/, "")}/tunnel/${repoSpec}`;
      console.log(`- Native Relay Tunnel: ${activeTunnelUrl}`);
    } else {
      console.warn("⚠️ Warning: Could not determine target repository. Specify repo using: ./herkules proxy --repo owner/repo");
    }

    console.log("-------------------------------------------------------");
    console.log("Waiting for execution requests from GitHub Actions...\n");

    await server.finished;

    return { exitCode: 0 };
  }
}
