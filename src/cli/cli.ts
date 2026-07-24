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
      --keep-worktree    Keep worktree directory after execution
      --dry-run          Simulate execution without making changes
  -h, --help             Show help for command
  -v, --version          Show version

EXAMPLES:
  # Start local Antigravity agy execution proxy for GitHub Actions CI
  herkules proxy

  # Automated Installation Wizard (GitHub Actions CI or Local Workstation)
  herkules install

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
    },
    boolean: ["help", "version", "dry-run", "keep-worktree"],
    string: ["prompt", "agent", "issue", "worktree", "repo", "key", "proxy"],
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
2. Ydinlogiikka
3. Verifiointi & testaus (deno task test)
ÄLÄ käytä robottimaisia lauseita kuten "An implementation plan has been prepared and documented at...". ÄLÄkä käytä python-tiedostoja (.py). Pidä teksti innokkaana, tiiviinä ja ihmiselle miellyttävänä lukea.`
            : `You are Herkules, an enthusiastic and friendly AI coding assistant. Create a concise, warm, human-readable implementation plan based on this issue:

${fullContextPrompt}

Start with this greeting: "${planIntro}"
Summarize clearly in 3 concise sections:
1. Architecture & Files (use TypeScript/Deno layout: src/...)
2. Core Logic & Features
3. Verification (deno task test)
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
            } catch {
              // Fallback to static helper
            }
          }

          if (!planResultContent || planResultContent.length < 30) {
            planResultContent = `${planIntro}\n\n${generateImplementationPlan({ taskId, prompt: effectivePrompt, agentName: flags.agent })}`;
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
          const startTime = Date.now();
          try {
            const resp = await fetch(`${proxyUrl}/api/execute`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Bypass-Tunnel-Remainder": "true",
                "User-Agent": "Herkules",
              },
              signal: AbortSignal.timeout(300000),
              body: JSON.stringify({
                prompt: fullContextPrompt,
                issueNum,
                repoSpec,
              }),
            });

            if (!resp.ok) {
              throw new Error(`Proxy returned HTTP ${resp.status} ${resp.statusText}`);
            }

            const data = await resp.json();
            if (data.files && typeof data.files === "object") {
              for (const [filename, content] of Object.entries(data.files)) {
                console.log(`✨ Received generated file from proxy: ${filename}`);
                await Deno.writeTextFile(`${worktree.worktreePath}/${filename}`, String(content));
              }
            }

            result = {
              success: data.success ?? true,
              output: data.logs ?? "Proxy execution completed.",
              durationMs: Date.now() - startTime,
              error: data.error,
            };
          } catch (err) {
            console.warn(`⚠️ Proxy execution failed: ${err instanceof Error ? err.message : String(err)}`);
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
