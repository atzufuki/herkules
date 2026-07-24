/**
 * Herkules Web Views
 *
 * Django-style view handlers for health checks, token minting relay, and WebSocket tunnel endpoints.
 *
 * @module web/views
 */

import { handleClientWebSocket, handleTokenRelayRequest, TunnelRegistry } from "./relay.ts";

/** Health check endpoint — returns JSON status. */
export function healthView(_request: Request): Response {
  return Response.json({
    status: "ok",
    app: "herkules",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  });
}

/** Token Relay View — mints installation access tokens keylessly for GitHub Actions. */
export async function tokenRelayView(request: Request): Promise<Response> {
  return await handleTokenRelayRequest(request);
}

/** WebSocket & Tunnel Routing View for Local Daemons. */
export async function tunnelView(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const repoMatch =
    url.pathname.match(/\/ws\/client\/([^\/]+)\/([^\/]+)/) ||
    url.pathname.match(/\/tunnel\/([^\/]+)\/([^\/]+)/) ||
    url.pathname.match(/\/ws\/([^\/]+)\/([^\/]+)/);

  if (!repoMatch) {
    return Response.json({ error: "Invalid tunnel URL format. Expected /tunnel/owner/repo" }, { status: 400 });
  }

  const [, owner, repo] = repoMatch;
  const repoSpec = `${owner}/${repo}`;

  // 1. WebSocket Upgrade Request for Local Proxy Client or Runner Client
  const upgradeHeader = request.headers.get("upgrade");
  if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
    const isRunnerClient = url.pathname.startsWith("/ws/client/") || request.headers.get("x-client-role") === "runner";
    const { socket, response } = Deno.upgradeWebSocket(request);
    if (isRunnerClient) {
      handleClientWebSocket(socket, repoSpec);
    } else {
      TunnelRegistry.register(repoSpec, socket);
    }
    return response;
  }

  // 2. Health Ping for Tunnel Status
  if (url.pathname.endsWith("/health")) {
    const online = await TunnelRegistry.isOnline(repoSpec);
    return Response.json({
      status: online ? "ok" : "offline",
      repo: repoSpec,
      engine: "antigravity",
    }, { status: online ? 200 : 503 });
  }

  // 3. HTTP Execution Request Forwarding to Local Proxy via Tunnel
  try {
    const bodyText = await request.text();
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => {
      headers[k] = v;
    });

    const relativeUrl = url.pathname.replace(new RegExp(`^/tunnel/${owner}/${repo}`, "i"), "") || "/";

    const tunnelReq = {
      id: crypto.randomUUID(),
      method: request.method,
      url: relativeUrl,
      headers,
      body: bodyText || undefined,
    };

    // Return a streaming ReadableStream Response immediately to avoid Deno Deploy 503 gateway timeouts
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    TunnelRegistry.sendStreamingRequest(
      repoSpec,
      tunnelReq,
      (chunkData) => {
        if (chunkData.chunk) {
          writer.write(encoder.encode(chunkData.chunk)).catch(() => {});
        }
      },
      300000,
    ).then(async () => {
      await writer.close().catch(() => {});
    }).catch(async (err) => {
      const errLine = JSON.stringify({
        type: "result",
        success: false,
        files: {},
        logs: String(err),
        engine: "antigravity",
        error: String(err),
      }) + "\n";
      await writer.write(encoder.encode(errLine)).catch(() => {});
      await writer.close().catch(() => {});
    });

    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 502 });
  }
}
