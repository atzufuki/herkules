#!/usr/bin/env -S deno run -A
/**
 * Herkules CLI Entrypoint
 *
 * Universal AI Agent Runner & Orchestrator for Git Worktrees & CI environments.
 *
 * @module cli/cli
 */

import { join } from "@std/path";
import { parseArgs } from "@std/cli/parse-args";
import {
  commitWorktreeChanges,
  createWorktree,
  getWorktreeDiff,
  hasChanges,
  isGitRepository,
  pushWorktreeBranch,
  removeWorktree,
} from "@herkules/git.ts";
import { AgentRunnerFactory, applyFallbackFileWrites, generateAiMessage } from "@herkules/runner.ts";
import { generateCodeReview, generateImplementationPlan, generateWalkthrough, saveArtifact } from "@herkules/artifacts.ts";
import { addLabelToIssue, addReactionToIssueOrComment, buildFullIssueContext, createPullRequest, fetchIssueComments, getGitHubContext, getRepoFromGitRemote, isFinnishText, IssueCommentItem, postIssueComment } from "@herkules/github.ts";
import { getAppInstallationToken, loadEnvFiles } from "@herkules/github_app.ts";
import { generateConventionalMetadata } from "@herkules/conventional.ts";
import { formatCommandResponse, parseCommentCommand } from "@herkules/commands.ts";

const VERSION = "0.1.0";

export interface NdjsonStreamResult {
  success: boolean;
  files: Record<string, string>;
  logs: string;
  engine: string;
  error?: string;
}

/**
 * Parses an NDJSON stream line-by-line via TextDecoderStream.
 * Invokes onChunk for live text chunks and resolves with final result object.
 */
export async function parseNdjsonStream(
  stream: ReadableStream<Uint8Array>,
  onChunk?: (text: string) => void,
): Promise<NdjsonStreamResult> {
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: NdjsonStreamResult = {
    success: false,
    files: {},
    logs: "",
    engine: "antigravity",
    error: "No result received from stream",
  };

  let hasResult = false;

  try {
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const item = JSON.parse(trimmed);
          if (item.type === "chunk" && typeof item.text === "string") {
            onChunk?.(item.text);
          } else if (item.type === "result" || item.success !== undefined) {
            hasResult = true;
            finalResult = {
              success: item.success ?? true,
              files: item.files ?? {},
              logs: item.logs ?? "",
              engine: item.engine ?? "antigravity",
              error: item.error,
            };
          }
        } catch {
          onChunk?.(trimmed + "\n");
        }
      }
    }
  } catch (err) {
    if (!hasResult) {
      console.warn(`⚠️ [Stream Notice] Stream closed before result: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    try {
      const item = JSON.parse(buffer.trim());
      if (item.type === "chunk" && typeof item.text === "string") {
        onChunk?.(item.text);
      } else if (item.type === "result" || item.success !== undefined) {
        hasResult = true;
        finalResult = {
          success: item.success ?? true,
          files: item.files ?? {},
          logs: item.logs ?? "",
          engine: item.engine ?? "antigravity",
          error: item.error,
        };
      }
    } catch {
      onChunk?.(buffer.trim() + "\n");
    }
  }

  if (hasResult && !finalResult.error) {
    finalResult.success = true;
  }

  return finalResult;
}

export async function fetchProxyExecutionViaWebSocket(
  proxyUrl: string,
  fullContextPrompt: string,
  issueNum: number | string | undefined,
  repoSpec: string | undefined,
  worktreePath: string,
): Promise<{ success: boolean; output: string; durationMs: number; error?: string }> {
  const startTime = Date.now();
  let wsUrl = proxyUrl;

  // Convert HTTP tunnel URL to WebSocket client URL if needed
  if (wsUrl.startsWith("http://")) {
    wsUrl = wsUrl.replace("http://", "ws://");
  } else if (wsUrl.startsWith("https://")) {
    wsUrl = wsUrl.replace("https://", "wss://");
  }

  // Ensure wsUrl points to client endpoint /ws/client/owner/repo
  if (!wsUrl.includes("/ws/client/")) {
    const tunnelMatch = wsUrl.match(/\/tunnel\/([^/]+)\/([^/]+)/);
    if (tunnelMatch) {
      wsUrl = wsUrl.replace(/\/tunnel\/([^/]+)\/([^/]+).*/, `/ws/client/${tunnelMatch[1]}/${tunnelMatch[2]}`);
    } else {
      wsUrl = wsUrl.replace(/\/+$/, "") + `/ws/client/${repoSpec}`;
    }
  }

  console.log(`🔌 Connecting Native WebSocket Runner Client to ${wsUrl}...`);

  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    let isCompleted = false;
    let finalResult: NdjsonStreamResult = {
      success: false,
      files: {},
      logs: "",
      engine: "antigravity",
      error: "No result received from WebSocket stream",
    };

    const timeoutTimer = setTimeout(() => {
      if (!isCompleted) {
        isCompleted = true;
        try { ws.close(); } catch {}
        reject(new Error("WebSocket proxy execution timed out after 5 minutes"));
      }
    }, 300000);

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      clearTimeout(timeoutTimer);
      return reject(err);
    }

    ws.onopen = () => {
      console.log(`✓ Connected to Native WebSocket Runner Client! Requesting proxy execution...`);
      const reqPayload = {
        id: crypto.randomUUID(),
        method: "POST",
        url: "/api/execute",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: fullContextPrompt,
          issueNum,
          repoSpec,
        }),
      };
      ws.send(JSON.stringify(reqPayload));
    };

    let buffer = "";

    ws.onmessage = async (event) => {
      const dataStr = String(event.data);
      buffer += dataStr;
      const rawLines = buffer.split("\n");
      buffer = rawLines.pop() ?? "";

      for (const rawLine of rawLines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        let payloadStr = trimmed;
        let isDoneMessage = false;

        try {
          const wrapper = JSON.parse(trimmed);
          if (typeof wrapper.chunk === "string") {
            payloadStr = wrapper.chunk;
          }
          if (wrapper.done === true) {
            isDoneMessage = true;
          }
        } catch {
          // Plain string chunk
        }

        // Process inner NDJSON lines inside payloadStr
        const innerLines = payloadStr.split("\n");
        for (const innerLine of innerLines) {
          const cleanLine = innerLine.trim();
          if (!cleanLine) continue;

          try {
            const item = JSON.parse(cleanLine);
            if (item.type === "chunk" && typeof item.text === "string") {
              Deno.stdout.writeSync(new TextEncoder().encode(item.text));
            } else if (item.type === "result" || item.success !== undefined) {
              finalResult = {
                success: item.success ?? true,
                files: item.files ?? {},
                logs: item.logs ?? "",
                engine: item.engine ?? "antigravity",
                error: item.error,
              };
            } else if (item.type === "done") {
              isDoneMessage = true;
            }
          } catch {
            Deno.stdout.writeSync(new TextEncoder().encode(cleanLine + "\n"));
          }
        }

        if (isDoneMessage && !isCompleted) {
          isCompleted = true;
          clearTimeout(timeoutTimer);
          try { ws.close(); } catch {}

          // Save generated files to worktree
          if (finalResult.files && typeof finalResult.files === "object") {
            for (const [filename, content] of Object.entries(finalResult.files)) {
              console.log(`✨ Received generated file from proxy: ${filename}`);
              await Deno.writeTextFile(`${worktreePath}/${filename}`, String(content));
            }
          }

          return resolve({
            success: finalResult.success ?? true,
            output: finalResult.logs ?? "Proxy execution completed.",
            durationMs: Date.now() - startTime,
            error: finalResult.error,
          });
        }
      }
    };

    ws.onerror = (err) => {
      console.error(`❌ WebSocket Runner Client Error:`, err);
    };

    ws.onclose = () => {
      clearTimeout(timeoutTimer);
      if (!isCompleted) {
        isCompleted = true;
        // If files or result were already captured before close
        if (finalResult.success || Object.keys(finalResult.files).length > 0) {
          return resolve({
            success: finalResult.success ?? true,
            output: finalResult.logs ?? "Proxy execution completed.",
            durationMs: Date.now() - startTime,
            error: finalResult.error,
          });
        }
        reject(new Error(finalResult.error || "WebSocket connection closed unexpectedly"));
      }
    };
  });
}

function printHelp() {
  console.log(`
Herkules v${VERSION}
Universal AI Agent Runner & Orchestrator for Git Worktrees & CI.

USAGE:
  herkules <command> [options]

COMMANDS:
  proxy        Start local Antigravity (agy) execution proxy server for GitHub Actions CI
  server       Alias for 'proxy' (starts execution proxy server)
  run          Execute a single agent task locally or in CI
  review       Automated AI PR code reviewer with configurable auto-merge
  install      Setup Herkules for GitHub Actions CI or Local Workstations
  uninstall    Remove Herkules workflow & secrets from target repository
  status       Check status of current worker / worktrees
  version      Print version information
  help         Print this help message

OPTIONS:
  -p, --prompt <text>    Instructions for the AI agent
  -a, --agent <name>     AI agent engine to use (default: "antigravity")
  -i, --issue <number>   GitHub / Git issue ID to process
  -r, --repo <spec/dir>  Target GitHub repository (owner/repo or local directory)
  -k, --key <api_key>    GEMINI_API_KEY to inject into GitHub secrets
      --proxy <url>      Delegate execution to local Antigravity proxy server
  -w, --worktree [name]  Run in an isolated Git worktree (default: true)
      --auto-merge       Automatically merge PR when verification & AI review pass
      --keep-worktree    Keep worktree directory after execution
      --dry-run          Simulate execution without making changes
  -h, --help             Show help for command
  -v, --version          Show version

EXAMPLES:
  # Start local Antigravity agy execution proxy for GitHub Actions CI
  herkules proxy

  # Automated Installation Wizard (GitHub Actions CI or Local Workstation)
  herkules install

  # Run automated AI code review on PR #42 with auto-merge enabled
  herkules review --pr 42 --auto-merge

  # Run a prompt locally in an isolated worktree
  herkules run --prompt "Fix bug in auth middleware"
`);
}

export async function main(args: string[] = Deno.args) {
  await loadEnvFiles();

  const flags = parseArgs(args, {
    alias: {
      h: "help",
      v: "version",
      p: "prompt",
      a: "agent",
      i: "issue",
      w: "worktree",
      r: "repo",
      k: "key",
      m: "auto-merge",
    },
    boolean: ["help", "version", "dry-run", "keep-worktree", "auto-merge", "mock"],
    string: ["prompt", "agent", "issue", "worktree", "repo", "key", "proxy", "pr", "branch", "test-cmd", "lint-cmd", "base-branch"],
    default: {
      agent: "antigravity",
    },
  });

  const command = flags._[0]?.toString() ?? (flags.prompt || flags.issue ? "run" : "help");

  if (flags.version || command === "version") {
    console.log(`Herkules v${VERSION}`);
    return;
  }

  if (flags.help || command === "help") {
    printHelp();
    return;
  }

  switch (command) {
    case "proxy":
    case "server": {
      const { ProxyCommand } = await import("@cli/commands/proxy.ts");
      const cmd = new ProxyCommand();
      const res = await cmd.handle(flags);
      Deno.exit(res.exitCode);
      break;
    }
    case "review": {
      const { ReviewerCommand } = await import("@cli/commands/reviewer.ts");
      const cmd = new ReviewerCommand();
      const res = await cmd.handle(flags);
      Deno.exit(res.exitCode);
      break;
    }
    case "install": {
      const { InstallCommand } = await import("@cli/commands/install.ts");
      const cmd = new InstallCommand();
      const res = await cmd.handle(flags);
      Deno.exit(res.exitCode);
      break;
    }
    case "uninstall": {
      const { UninstallCommand } = await import("@cli/commands/uninstall.ts");
      const cmd = new UninstallCommand();
      const res = await cmd.handle(flags);
      Deno.exit(res.exitCode);
      break;
    }
    case "run": {
      const taskId = flags.issue ? `issue-${flags.issue}` : `task-${Date.now()}`;
      const prompt = flags.prompt ?? (flags.issue ? `Fix GitHub issue #${flags.issue}` : "Default task");

      let targetDir = ".";
      let repoSpec: string | undefined;
      const targetRepoFlag = flags.repo;

      if (targetRepoFlag) {
        try {
          const stat = await Deno.stat(targetRepoFlag);
          if (stat.isDirectory) {
            targetDir = targetRepoFlag;
            const remoteInfo = await getRepoFromGitRemote(targetDir);
            if (remoteInfo.repoOwner && remoteInfo.repoName) {
              repoSpec = `${remoteInfo.repoOwner}/${remoteInfo.repoName}`;
            }
          }
        } catch {
          if (targetRepoFlag.includes("/")) {
            repoSpec = targetRepoFlag;
            const [_, repoName] = targetRepoFlag.split("/");
            const possibleDirs = [
              join(Deno.cwd(), "..", repoName),
              join(Deno.env.get("HOME") ?? "", "Code", repoName),
              join(Deno.cwd(), repoName),
            ];
            for (const dir of possibleDirs) {
              try {
                const stat = await Deno.stat(dir);
                if (stat.isDirectory) {
                  targetDir = dir;
                  break;
                }
              } catch {
                // Continue
              }
            }
          }
        }
      }

      await loadEnvFiles(targetDir);

      console.log(`\n🚀 Herkules v${VERSION} starting task #${taskId}...`);
      console.log(`- Agent Engine: ${flags.agent}`);
      console.log(`- Prompt: "${prompt}"`);
      if (targetDir !== ".") console.log(`- Target Dir: ${targetDir}`);

      // 1. Verify Git repo
      if (!await isGitRepository(targetDir)) {
        console.error(`❌ Error: ${targetDir} must be a Git repository.`);
        Deno.exit(1);
      }

      // 2. Resolve GitHub token & context
      let githubToken = Deno.env.get("GITHUB_TOKEN");
      const ghContext = await getGitHubContext(targetDir);
      if (repoSpec) {
        const [owner, repo] = repoSpec.split("/");
        ghContext.repoOwner = owner;
        ghContext.repoName = repo;
      }

      const appId = Deno.env.get("HERKULES_APP_ID") ?? Deno.env.get("GRAVITY_WORKER_APP_ID") ?? "4375516";
      const privateKey = Deno.env.get("HERKULES_PRIVATE_KEY") ?? Deno.env.get("GRAVITY_WORKER_PRIVATE_KEY");

      if (appId && privateKey && ghContext.repoOwner && ghContext.repoName) {
        const botToken = await getAppInstallationToken(appId, privateKey, ghContext.repoOwner, ghContext.repoName);
        if (botToken) {
          githubToken = botToken;
          console.log("🤖 Authenticated as dedicated @herkules[bot] (via local key)");
        }
      }

      // Keyless Token Relay fallback for GitHub Actions
      if (!privateKey && ghContext.repoOwner && ghContext.repoName) {
        const relayUrl = Deno.env.get("HERKULES_RELAY_URL") || Deno.env.get("HERKULES_LOCAL_URL") || Deno.env.get("GRAVITY_WORKER_LOCAL_URL") || "https://gw-atzufuki-siht-io.loca.lt";
        try {
          const relayRes = await fetch(`${relayUrl}/api/token?owner=${ghContext.repoOwner}&repo=${ghContext.repoName}`, {
            headers: { "Bypass-Tunnel-Remainder": "true", "User-Agent": "Herkules" }
          });
          if (relayRes.ok) {
            const data = await relayRes.json();
            if (data.token) {
              githubToken = data.token;
              console.log("🤖 Authenticated as dedicated @herkules[bot] (via Keyless Token Relay)");
            }
          }
        } catch {
          // Fall back to default githubToken
        }
      }

      // Safety guard: ignore execution if triggered by a bot user's own comment
      if (ghContext.sender && (ghContext.sender.endsWith("[bot]") || ghContext.sender === "herkules-bot" || ghContext.sender === "herkules")) {
        console.log(`ℹ️ Ignoring execution trigger initiated by bot user: @${ghContext.sender}`);
        return;
      }

      const issueNum = ghContext.issueNumber ?? (flags.issue ? parseInt(flags.issue, 10) : undefined);

      // Fetch issue comments for full conversation context (Head & Tail strategy)
      let comments: IssueCommentItem[] = [];
      if (githubToken && ghContext.repoOwner && ghContext.repoName && issueNum) {
        console.log(`💬 Fetching conversation thread for GitHub Issue #${issueNum}...`);
        comments = await fetchIssueComments(ghContext.repoOwner, ghContext.repoName, issueNum, githubToken);
      }

      // Parse interactive comment commands (@herkules plan, update, review, retry)
      const parsedCmd = parseCommentCommand(prompt);
      const userInstruction = parsedCmd.prompt || prompt;
      const effectivePrompt = userInstruction || ghContext.issueTitle || prompt;

      const fullContextPrompt = buildFullIssueContext({
        issueNumber: issueNum,
        issueTitle: ghContext.issueTitle,
        issueBody: ghContext.issueBody,
        comments,
        userInstruction: userInstruction !== prompt ? userInstruction : undefined,
      });

      if (parsedCmd.isMentioned) {
        console.log(`- Interactive Comment Command: @herkules-bot ${parsedCmd.command}`);
      }

      // Generate Conventional Commits metadata (feat/fix branch, commit msg, PR title)
      const conventional = generateConventionalMetadata(effectivePrompt, issueNum);

      // 3. React with 👀 (eyes emoji) immediately & post AI-generated start acknowledgement comment for full executions
      if (githubToken && ghContext.repoOwner && ghContext.repoName && issueNum) {
        console.log(`👀 Reacting with eyes emoji to GitHub Issue #${issueNum}...`);
        await addReactionToIssueOrComment({
          owner: ghContext.repoOwner,
          repo: ghContext.repoName,
          issueNumber: issueNum,
          commentId: ghContext.commentId,
          reaction: "eyes",
          token: githubToken,
        }).catch(() => {});

        // Only post "I'm starting work" comment & add 'herkules' label for implementation tasks (run, update, retry), NOT plan/review
        if (parsedCmd.command === "run" || parsedCmd.command === "update" || parsedCmd.command === "retry") {
          console.log(`🏷️ Adding 'herkules' label to GitHub Issue #${issueNum}...`);
          await addLabelToIssue({
            owner: ghContext.repoOwner,
            repo: ghContext.repoName,
            issueNumber: issueNum,
            label: "herkules",
            token: githubToken,
          }).catch(() => {});

          console.log(`💬 Generating & posting start acknowledgement comment to GitHub Issue #${issueNum}...`);
          const startBody = await generateAiMessage(effectivePrompt, "start");

          await postIssueComment({
            owner: ghContext.repoOwner,
            repo: ghContext.repoName,
            issueNumber: issueNum,
            body: startBody,
            token: githubToken,
          }).catch((e) => console.warn(`[GitHub API Notice] Could not post start comment: ${e.message}`));
        }
      }

      // 4. Create isolated Worktree inside targetDir using Conventional Branch Naming (e.g. feat/48-slug)
      console.log(`\n🌿 Creating Git Worktree for task #${taskId}...`);
      const reuseBranch = parsedCmd.command === "update";
      const worktree = await createWorktree(
        { taskId, prompt: effectivePrompt, issueNumber: issueNum, reuseBranch },
        targetDir,
      );
      console.log(`✓ Worktree ready at: ${worktree.worktreePath} (branch: ${worktree.branchName})`);

      try {
        // 5. Save Implementation Plan Artifact in hidden .herkules/ (isolated from target repo commits)
        console.log(`\n📝 Generating implementation_plan.md artifact...`);
        const planContent = generateImplementationPlan({
          taskId,
          prompt: effectivePrompt,
          agentName: flags.agent,
        });
        await saveArtifact(worktree.worktreePath, ".herkules/implementation_plan.md", planContent);

        // Handle @herkules-bot plan command early exit (plan-only generation)
        if (parsedCmd.command === "plan") {
          console.log(`📋 Generating AI Implementation Plan for @herkules-bot plan...`);
          const isFinnish = isFinnishText(effectivePrompt);
          const planIntro = await generateAiMessage(effectivePrompt, "plan");

          const planPrompt = isFinnish
            ? `Olet Herkules, innokas ja ystävällinen tekoälyassistentti. Laadi tiivis, inhimillinen ja ihmisymmärrettävä toteutussuunnitelma (suomeksi) seuraavan Issuen pohjalta:

${fullContextPrompt}

Aloita teksti tästä tervehdyksestä: "${planIntro}"
Kuvaa tiiviisti 3 selkeässä osiossa:
1. Tiedostomuutokset (käytä TypeScript/Deno -muotoa: src/...)
2. Ydinlogiikka & ominaisuudet
3. Uudet testit & verifiointi (täsmennä uusien unit/integraatiotestien luonti ominaisuudelle ja deno task test -ajo)
ÄLÄ käytä robottimaisia lauseita kuten "An implementation plan has been prepared and documented at...". ÄLÄkä käytä python-tiedostoja (.py). Pidä teksti innokkaana, tiiviinä ja ihmiselle miellyttävänä lukea.`
            : `You are Herkules, an enthusiastic and friendly AI coding assistant. Create a concise, warm, human-readable implementation plan based on this issue:

${fullContextPrompt}

Start with this greeting: "${planIntro}"
Summarize clearly in 3 concise sections:
1. Architecture & Files (use TypeScript/Deno layout: src/...)
2. Core Logic & Features
3. New Tests & Verification (explicitly specify writing new unit/integration tests for the feature and running deno task test)
Do NOT use stiff robotic statements like "An implementation plan has been prepared and documented at...". Do NOT use python files (.py). Keep it energetic, concise, and natural to read.`;

          let planResultContent = "";
          const proxyUrl = flags.proxy ?? Deno.env.get("HERKULES_PROXY_URL") ?? Deno.env.get("GRAVITY_WORKER_PROXY_URL");

          if (proxyUrl) {
            try {
              const resp = await fetch(`${proxyUrl}/api/execute`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Bypass-Tunnel-Remainder": "true", "User-Agent": "Herkules" },
                signal: AbortSignal.timeout(60000),
                body: JSON.stringify({ prompt: planPrompt, issueNum, repoSpec: ghContext.repoOwner && ghContext.repoName ? `${ghContext.repoOwner}/${ghContext.repoName}` : undefined }),
              });
              if (resp.ok) {
                const data = await resp.json();
                planResultContent = data.logs || data.output || "";
              }
            } catch (err) {
              console.warn(`⚠️ Proxy execution failed for plan: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          if (!planResultContent || planResultContent.length < 30) {
            console.log("⚡ Executing native AI runner for implementation plan generation...");
            try {
              const runner = AgentRunnerFactory.getRunner(flags.agent);
              const planRunResult = await runner.run({
                prompt: planPrompt,
                worktreePath: worktree.worktreePath,
                dryRun: true,
              });
              if (planRunResult.output && planRunResult.output.length >= 30) {
                planResultContent = planRunResult.output;
              }
            } catch (err) {
              console.warn(`⚠️ Native AI execution failed for plan: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          if (!planResultContent || planResultContent.length < 30) {
            console.error("❌ Implementation plan generation failed: AI Agent was unreachable or failed to respond.");
            const errorMsg = isFinnish
              ? "Toteutussuunnitelman luonti epäonnistui: Tekoälyagenttiin (Antigravity/Proxy) ei saatu yhteyttä suunnitelman laatimiseksi. Varmista että lokaali proxy (`./herkules proxy`) tai GEMINI_API_KEY on aktiivinen."
              : "Implementation plan generation failed: Could not connect to the AI agent (Antigravity/Proxy) to analyze the codebase. Please ensure the local proxy (`./herkules proxy`) or GEMINI_API_KEY is active.";

            const failRes = formatCommandResponse("plan", {
              prompt: effectivePrompt,
              success: false,
              error: errorMsg,
              issueNumber: issueNum,
            });

            if (githubToken && ghContext.repoOwner && ghContext.repoName && issueNum) {
              await postIssueComment({
                owner: ghContext.repoOwner,
                repo: ghContext.repoName,
                issueNumber: issueNum,
                body: failRes.body,
                token: githubToken,
              }).catch(() => {});
            }

            if (!flags["keep-worktree"]) {
              await removeWorktree(worktree, { deleteBranch: true });
            }
            return;
          }

          await saveArtifact(worktree.worktreePath, ".herkules/implementation_plan.md", planResultContent);

          const planCmdRes = formatCommandResponse("plan", {
            prompt: effectivePrompt,
            content: planResultContent,
            issueNumber: issueNum,
          });

          if (githubToken && ghContext.repoOwner && ghContext.repoName && issueNum) {
            await postIssueComment({
              owner: ghContext.repoOwner,
              repo: ghContext.repoName,
              issueNumber: issueNum,
              body: planCmdRes.body,
              token: githubToken,
            }).catch(() => {});
          }

          console.log(`\n✨ Plan generation COMPLETED.`);
          if (!flags["keep-worktree"]) {
            await removeWorktree(worktree, { deleteBranch: true });
          }
          return;
        }

        // 6. Run Agent (either via Proxy or natively)
        const proxyUrl = flags.proxy ?? Deno.env.get("HERKULES_PROXY_URL") ?? Deno.env.get("GRAVITY_WORKER_PROXY_URL");
        let result: { success: boolean; output: string; durationMs: number; error?: string };

        if (proxyUrl) {
          console.log(`\n🔗 Delegating execution to Local Antigravity Proxy (${proxyUrl})...`);
          try {
            result = await fetchProxyExecutionViaWebSocket(
              proxyUrl,
              fullContextPrompt,
              issueNum,
              repoSpec,
              worktree.worktreePath,
            );
          } catch (err) {
            const errMsg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
            console.warn(`⚠️ Proxy execution failed: ${err instanceof Error ? err.message : String(err)}`);
            console.error(`🔍 [Proxy Diagnostic Log] Detailed error trace:\n${errMsg}`);
            console.log("⚡ Falling back to native agent execution in CI...");
            const runner = AgentRunnerFactory.getRunner(flags.agent);
            result = await runner.run({
              prompt: fullContextPrompt,
              worktreePath: worktree.worktreePath,
              dryRun: flags["dry-run"],
            });
          }
        } else {
          console.log(`\n🤖 Executing agent (${flags.agent})...`);
          const runner = AgentRunnerFactory.getRunner(flags.agent);
          result = await runner.run({
            prompt: fullContextPrompt,
            worktreePath: worktree.worktreePath,
            dryRun: flags["dry-run"],
          });
        }

        // Verify if files were edited; if not, apply fallback file extraction from output
        let codeChangesExist = await hasChanges(worktree.worktreePath);
        if (!codeChangesExist && result.output) {
          await applyFallbackFileWrites(effectivePrompt, result.output, worktree.worktreePath);
        }

        // 7. Get Diff before committing
        const diff = await getWorktreeDiff(worktree.worktreePath).catch(() => "");

        // 8. Save Artifacts (.herkules/walkthrough.md & .herkules/review.md)
        console.log(`📝 Generating artifacts...`);
        const walkthroughContent = generateWalkthrough({
          taskId,
          prompt: effectivePrompt,
          agentName: flags.agent,
          output: result.output || (result.success ? "Execution completed successfully." : "Execution failed."),
          diff,
          durationMs: result.durationMs,
        });
        await saveArtifact(worktree.worktreePath, ".herkules/walkthrough.md", walkthroughContent);

        const reviewContent = generateCodeReview({
          taskId,
          prompt: effectivePrompt,
          agentName: flags.agent,
          diff,
          output: result.output,
        });
        await saveArtifact(worktree.worktreePath, ".herkules/review.md", reviewContent);

        // Handle @herkules-bot review command
        if (parsedCmd.command === "review") {
          console.log(`🔍 Processed @herkules-bot review command.`);
          const reviewCmdRes = formatCommandResponse("review", {
            prompt: effectivePrompt,
            content: reviewContent,
            issueNumber: issueNum,
          });

          if (githubToken && ghContext.repoOwner && ghContext.repoName && issueNum) {
            await postIssueComment({
              owner: ghContext.repoOwner,
              repo: ghContext.repoName,
              issueNumber: issueNum,
              body: reviewCmdRes.body,
              token: githubToken,
            }).catch(() => {});
          }

          console.log(`\n✨ Code review COMPLETED.`);
          if (!flags["keep-worktree"]) {
            await removeWorktree(worktree, { deleteBranch: true });
          }
          return;
        }

        // 9. Commit & Push Worktree Changes using Conventional Commits format
        if (result.success && !flags["dry-run"]) {
          console.log(`\n📤 Committing & pushing branch ${worktree.branchName}...`);
          const committed = await commitWorktreeChanges(worktree.worktreePath, conventional.commitMessage);
          let pushedSuccess = false;
          if (committed) {
            try {
              await pushWorktreeBranch(worktree.worktreePath, worktree.branchName, "origin", true, githubToken);
              pushedSuccess = true;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.error(`❌ Git Push Failed: ${msg}`);
            }
          }

          // 10. Create GitHub Pull Request using Conventional PR Title if push succeeded
          if (pushedSuccess && githubToken && ghContext.repoOwner && ghContext.repoName) {
            console.log(`\n🔀 Creating GitHub Pull Request...`);
            const prTitle = conventional.prTitle;

            const closesHeader = issueNum ? `Closes #${issueNum}\n\n` : "";
            const prBody = `${closesHeader}${walkthroughContent}`;

            const prUrl = await createPullRequest({
              owner: ghContext.repoOwner,
              repo: ghContext.repoName,
              head: worktree.branchName,
              base: "main",
              title: prTitle,
              body: prBody,
              token: githubToken,
            }).catch((e) => {
              console.warn(`[GitHub API PR Warning] ${e.message}`);
              return undefined;
            });

            if (prUrl) {
              console.log(`✓ Pull Request created: ${prUrl}`);

              if (issueNum) {
                console.log(`💬 Generating & posting completion comment to GitHub Issue #${issueNum}...`);
                const completionGreeting = await generateAiMessage(effectivePrompt, "completion");

                const cmdRes = formatCommandResponse(parsedCmd.command, {
                  prompt: effectivePrompt,
                  content: walkthroughContent,
                  prUrl,
                  issueNumber: issueNum,
                });

                const commentBody = `${completionGreeting}\n\n${cmdRes.body}`;

                await postIssueComment({
                  owner: ghContext.repoOwner,
                  repo: ghContext.repoName,
                  issueNumber: issueNum,
                  body: commentBody,
                  token: githubToken,
                }).catch(() => {});
              }
            }
          }
        }

        // 11. Result Summary
        console.log(`\n✨ Task #${taskId} ${result.success ? "COMPLETED" : "FAILED"} in ${(result.durationMs / 1000).toFixed(2)}s`);
        console.log(`- Branch: ${worktree.branchName}`);
        console.log(`- Worktree: ${worktree.worktreePath}`);

        if (result.error) {
          console.error(`⚠️ Agent Error: ${result.error}`);
        }

        if (!flags["keep-worktree"] && flags["dry-run"]) {
          console.log(`🧹 Cleaning up dry-run worktree...`);
          await removeWorktree(worktree, { deleteBranch: true });
        }

        if (!result.success) {
          Deno.exit(1);
        }
      } catch (err) {
        console.error(`❌ Task execution failed:`, err);
        Deno.exit(1);
      }
      break;
    }
    case "status": {
      console.log(`Herkules Status: Ready`);
      break;
    }
    default: {
      console.error(`Unknown command: ${command}`);
      printHelp();
      Deno.exit(1);
    }
  }
}

if (import.meta.main) {
  await main();
}
