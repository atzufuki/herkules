/**
 * Herkules Web App - Native Token Relay & WebSocket Tunnel Engine
 *
 * Django-styled relay subsystem providing keyless GitHub App token minting
 * and zero-auth WebSocket tunnel routing for Herkules local daemons.
 *
 * @module web/relay
 */

import { getAppInstallationToken } from "@herkules/github_app.ts";

export interface TunnelMessage {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface TunnelResponse {
  id: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
}

export interface TunnelChunk {
  id: string;
  chunk?: string;
  done?: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  response?: TunnelResponse;
}

let kvInstance: any = null;
async function getKv(): Promise<any> {
  if (!kvInstance) {
    try {
      kvInstance = await (Deno as any).openKv();
    } catch {
      return null;
    }
  }
  return kvInstance;
}

let tunnelBusInstance: BroadcastChannel | null = null;

function getTunnelBus(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!tunnelBusInstance) {
    tunnelBusInstance = new BroadcastChannel("herkules-tunnel-bus");
  }
  return tunnelBusInstance;
}

/**
 * Closes background BroadcastChannel and DenoKV handles for clean process exit.
 */
export function cleanupRelay() {
  if (tunnelBusInstance) {
    try {
      tunnelBusInstance.close();
    } catch {
      // Ignore
    }
    tunnelBusInstance = null;
  }
  if (kvInstance) {
    try {
      kvInstance.close();
    } catch {
      // Ignore
    }
    kvInstance = null;
  }
}

/**
 * Manages WebSocket tunnel connections indexed by repoSpec ("owner/repo").
 */
export class TunnelRegistry {
  private static connections = new Map<string, WebSocket>();
  private static pendingRequests = new Map<string, (res: TunnelResponse) => void>();
  private static chunkListeners = new Map<string, (chunk: TunnelChunk) => void>();
  private static busInitialized = false;

  private static initBus() {
    if (this.busInitialized) return;
    this.busInitialized = true;
    const bus = getTunnelBus();
    if (!bus) return;

    bus.onmessage = async (event) => {
      try {
        const data = event.data;
        if (data.type === "req") {
          const ws = this.connections.get(data.repoSpec);
          if (ws && ws.readyState === WebSocket.OPEN) {
            const res = await this.sendLocalWsRequest(ws, data.req);
            getTunnelBus()?.postMessage({ type: "res", reqId: data.req.id, res });
          }
        } else if (data.type === "res") {
          const resolver = this.pendingRequests.get(data.reqId);
          if (resolver) {
            resolver(data.res);
            this.pendingRequests.delete(data.reqId);
          }
        } else if (data.type === "chunk") {
          const listener = this.chunkListeners.get(data.reqId);
          if (listener) {
            listener(data.chunkData);
            if (data.chunkData.done || data.chunkData.response) {
              this.chunkListeners.delete(data.reqId);
            }
          }
        }
      } catch (err) {
        console.error("❌ [TunnelRegistry] Bus error:", err);
      }
    };
  }

  static register(repoSpec: string, ws: WebSocket) {
    this.initBus();
    const key = repoSpec.toLowerCase();
    this.connections.set(key, ws);
    console.log(`🔌 [TunnelRegistry] WebSocket tunnel registered for repository: ${key}`);

    const updateKv = async () => {
      try {
        const kv = await getKv();
        if (kv) {
          await kv.set(["tunnels", key], { online: true, updatedAt: Date.now() }, { expireIn: 30000 });
        }
      } catch {
        // Ignore KV errors if unsupported
      }
    };
    updateKv();
    const heartbeat = setInterval(updateKv, 10000);

    // Watch DenoKV for tunnel execution requests sent from other Deno Deploy edge isolates
    const startKvWatcher = async () => {
      try {
        const kv = await getKv();
        if (!kv) return;

        const watcher = kv.watch([["tunnel_req_bus", key]]);
        for await (const entries of watcher) {
          const entry = entries[0];
          if (entry && entry.value) {
            const reqData = entry.value as { id: string; req: TunnelMessage; timestamp: number };
            if (reqData && reqData.req) {
              const currentWs = this.connections.get(key);
              if (currentWs && currentWs.readyState === WebSocket.OPEN) {
                const res = await this.sendLocalWsRequest(currentWs, reqData.req);
                await kv.set(["tunnel_res_bus", reqData.id], res, { expireIn: 120000 });
              }
            }
          }
        }
      } catch {
        // Ignore KV watch errors
      }
    };
    startKvWatcher();

    ws.onmessage = (event) => {
      try {
        const payload: TunnelChunk = JSON.parse(event.data);

        // Notify chunk listeners if present
        const listener = this.chunkListeners.get(payload.id);
        if (listener) {
          listener(payload);
          if (payload.done || payload.response) {
            this.chunkListeners.delete(payload.id);
          }
        }

        // Handle full response if present or standard response
        const resId = payload.id || payload.response?.id;
        if (resId && (payload.done || payload.response)) {
          const resolver = this.pendingRequests.get(resId);
          if (resolver) {
            const resObj: TunnelResponse = payload.response || {
              id: resId,
              status: 200,
              headers: { "Content-Type": "application/x-ndjson" },
              body: "",
            };
            resolver(resObj);
            this.pendingRequests.delete(resId);
          }
        }
      } catch (err) {
        console.error("❌ [TunnelRegistry] Failed to parse tunnel payload:", err);
      }
    };

    ws.onclose = () => {
      clearInterval(heartbeat);
      if (this.connections.get(key) === ws) {
        this.connections.delete(key);
        try {
          getKv().then((kv) => kv?.delete(["tunnels", key])).catch(() => {});
        } catch {
          // Ignore
        }
        console.log(`ℹ️ [TunnelRegistry] WebSocket tunnel closed for repository: ${key}`);
      }
    };
  }

  static async isOnline(repoSpec: string): Promise<boolean> {
    const key = repoSpec.toLowerCase();
    const ws = this.connections.get(key);
    if (ws !== undefined && ws.readyState === WebSocket.OPEN) {
      return true;
    }
    try {
      const kv = await getKv();
      if (kv) {
        const entry = await kv.get(["tunnels", key]);
        return entry?.value?.online === true;
      }
    } catch {
      // Fallback
    }
    return false;
  }

  private static sendLocalWsRequest(ws: WebSocket, req: TunnelMessage, timeoutMs = 300000): Promise<TunnelResponse> {
    return new Promise<TunnelResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(req.id);
        this.chunkListeners.delete(req.id);
        reject(new Error("Tunnel request timed out waiting for local daemon response"));
      }, timeoutMs);

      this.pendingRequests.set(req.id, (res) => {
        clearTimeout(timer);
        this.chunkListeners.delete(req.id);
        resolve(res);
      });

      ws.send(JSON.stringify(req));
    });
  }

  static async sendRequest(repoSpec: string, req: TunnelMessage, timeoutMs = 300000): Promise<TunnelResponse> {
    this.initBus();
    const key = repoSpec.toLowerCase();
    const ws = this.connections.get(key);

    if (ws && ws.readyState === WebSocket.OPEN) {
      return this.sendLocalWsRequest(ws, req, timeoutMs);
    }

    getTunnelBus()?.postMessage({ type: "req", repoSpec: key, req });

    try {
      const kv = await getKv();
      if (kv) {
        // Write request to DenoKV bus for cross-isolate watcher
        await kv.set(["tunnel_req_bus", key], { id: req.id, req, timestamp: Date.now() }, { expireIn: 60000 });

        return new Promise<TunnelResponse>((resolve, reject) => {
          let isDone = false;
          const timer = setTimeout(() => {
            if (!isDone) {
              isDone = true;
              this.pendingRequests.delete(req.id);
              this.chunkListeners.delete(req.id);
              reject(new Error(`No active WebSocket tunnel connection for repository: ${repoSpec}`));
            }
          }, timeoutMs);

          this.pendingRequests.set(req.id, (res) => {
            if (!isDone) {
              isDone = true;
              clearTimeout(timer);
              this.chunkListeners.delete(req.id);
              resolve(res);
            }
          });

          // Watch DenoKV response key for cross-isolate completion
          (async () => {
            try {
              const watcher = kv.watch([["tunnel_res_bus", req.id]]);
              for await (const entries of watcher) {
                if (isDone) break;
                const entry = entries[0];
                if (entry && entry.value) {
                  const res = entry.value as TunnelResponse;
                  if (!isDone) {
                    isDone = true;
                    clearTimeout(timer);
                    this.pendingRequests.delete(req.id);
                    this.chunkListeners.delete(req.id);
                    await kv.delete(["tunnel_res_bus", req.id]).catch(() => {});
                    resolve(res);
                  }
                  break;
                }
              }
            } catch {
              // Ignore KV watch error
            }
          })();
        });
      }
    } catch {
      // Fall back to memory promise if KV unavailable
    }

    return new Promise<TunnelResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(req.id);
        this.chunkListeners.delete(req.id);
        reject(new Error(`No active WebSocket tunnel connection for repository: ${repoSpec}`));
      }, timeoutMs);

      this.pendingRequests.set(req.id, (res) => {
        clearTimeout(timer);
        this.chunkListeners.delete(req.id);
        resolve(res);
      });
    });
  }

  static sendStreamingRequest(
    repoSpec: string,
    req: TunnelMessage,
    onChunk: (chunk: TunnelChunk) => void,
    timeoutMs = 300000,
  ): Promise<TunnelResponse> {
    this.chunkListeners.set(req.id, onChunk);
    return this.sendRequest(repoSpec, req, timeoutMs);
  }
}

/**
 * Handles Token Relay requests (/api/token)
 */
export async function handleTokenRelayRequest(req: Request): Promise<Response> {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405 });
  }

  try {
    const url = new URL(req.url);
    let owner = url.searchParams.get("owner");
    let repo = url.searchParams.get("repo");

    if (req.method === "POST" && (!owner || !repo)) {
      try {
        const body = await req.json();
        owner = owner || body.owner;
        repo = repo || body.repo;
      } catch {
        // Ignore body parsing failure
      }
    }

    if (!owner || !repo) {
      return new Response(JSON.stringify({ error: "Missing required 'owner' and 'repo' parameters" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const appId = Deno.env.get("HERKULES_APP_ID") ?? Deno.env.get("GRAVITY_WORKER_APP_ID") ?? "4375516";
    const privateKey = Deno.env.get("HERKULES_PRIVATE_KEY") ?? Deno.env.get("GRAVITY_WORKER_PRIVATE_KEY");

    if (!privateKey) {
      return new Response(JSON.stringify({ error: "Server missing HERKULES_PRIVATE_KEY configuration" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const token = await getAppInstallationToken(appId, privateKey, owner, repo);
    if (!token) {
      return new Response(JSON.stringify({ error: `Could not mint installation token for ${owner}/${repo}` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, token, botName: "herkules[bot]" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}

export function handleClientWebSocket(ws: WebSocket, repoSpec: string): void {
  ws.onmessage = async (event) => {
    try {
      const msg = typeof event.data === "string" ? JSON.parse(event.data) : {};
      const reqId = msg.id || crypto.randomUUID();
      const tunnelReq: TunnelMessage = {
        id: reqId,
        method: msg.method || "POST",
        url: msg.url || "/api/execute",
        headers: msg.headers || { "Content-Type": "application/json" },
        body: typeof msg.body === "string" ? msg.body : JSON.stringify(msg.body || {}),
      };

      try {
        await TunnelRegistry.sendStreamingRequest(
          repoSpec,
          tunnelReq,
          (chunkData) => {
            if (chunkData.chunk && ws.readyState === 1) {
              ws.send(chunkData.chunk);
            }
          },
          300000,
        );
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "done", success: true }) + "\n");
        }
      } catch (err) {
        if (ws.readyState === 1) {
          const errChunk = JSON.stringify({
            type: "result",
            success: false,
            files: {},
            logs: String(err),
            engine: "antigravity",
            error: String(err),
          }) + "\n";
          ws.send(errChunk);
          ws.send(JSON.stringify({ type: "done", success: false, error: String(err) }) + "\n");
        }
      }
    } catch (err) {
      console.error("❌ [ClientWS] Message processing error:", err);
    }
  };
}
