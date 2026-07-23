/**
 * Alexi Management Command: server
 *
 * Local Daemon & Issue Listener for GravityWorker.
 * Continuously watches target GitHub repository for issues labeled with 'gravity-fix',
 * automatically executing tasks locally using Antigravity (agy) / Google AI Ultra subscription.
 *
 * @module gravity-worker/commands/server
 */

import { BaseCommand } from "@alexi/core/management";
import { getGitHubContext, getRepoFromGitRemote } from "@gravity-worker/github.ts";

export interface ServerOptions {
  repo?: string;
  intervalMs?: number;
  agent?: string;
}

export class ServerCommand extends BaseCommand {
  override name = "server";
  override help = "Listen for GitHub issue 'gravity-fix' labels and execute tasks automatically on local workstation";

  override async handle(options?: any): Promise<{ exitCode: number }> {
    const targetRepoFlag = typeof options === "string" ? options : options?.repo;
    const agentEngine = (typeof options === "object" && options?.agent) ? options.agent : "antigravity";
    const pollInterval = (typeof options === "object" && options?.interval) ? parseInt(options.interval, 10) * 1000 : 10000;

    let targetDir = ".";
    let repoSpec: string | undefined;

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
        }
      }
    }

    if (!repoSpec) {
      const ghContext = await getGitHubContext(targetDir);
      if (ghContext.repoOwner && ghContext.repoName) {
        repoSpec = `${ghContext.repoOwner}/${ghContext.repoName}`;
      }
    }

    if (!repoSpec) {
      console.error("❌ Error: Could not determine target GitHub repository owner/name.");
      console.error("   Specify target repo using: ./gravity-worker server --repo owner/repo");
      return { exitCode: 1 };
    }

    const token = Deno.env.get("GITHUB_TOKEN");
    const [owner, repo] = repoSpec.split("/");

    console.log("=======================================================");
    console.log("📡 GRAVITYWORKER LOCAL DAEMON & ISSUE WATCHER STARTED");
    console.log("=======================================================");
    console.log(`- Target Repository: ${owner}/${repo}`);
    console.log(`- Agent Engine:      ${agentEngine.toUpperCase()} (Local Machine)`);
    console.log(`- Watch Label:       gravity-fix`);
    console.log(`- Polling Interval:  ${pollInterval / 1000}s`);
    console.log("-------------------------------------------------------");
    console.log("Listening for labeled issues on GitHub... Press Ctrl+C to stop.\n");

    const processedIssues = new Set<number>();
    const stateFile = `${targetDir}/.gravity-worker-processed.json`;

    try {
      const text = await Deno.readTextFile(stateFile);
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) {
        arr.forEach((id) => processedIssues.add(id));
      }
    } catch {
      // Ignore if state file doesn't exist yet
    }

    const saveState = async () => {
      try {
        await Deno.writeTextFile(stateFile, JSON.stringify(Array.from(processedIssues), null, 2));
      } catch {
        // Ignore
      }
    };

    while (true) {
      try {
        // Query GitHub API for open issues labeled with 'gravity-fix'
        const headers: Record<string, string> = {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "GravityWorker-Local-Daemon",
        };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?labels=gravity-fix&state=open`, {
          headers,
        });

        if (res.ok) {
          const issues = await res.json();
          if (Array.isArray(issues)) {
            for (const issue of issues) {
              const issueNum = issue.number;
              const issueTitle = issue.title;

              if (!processedIssues.has(issueNum)) {
                console.log(`\n🎯 New task detected: GitHub Issue #${issueNum} ("${issueTitle}")`);
                processedIssues.add(issueNum);
                await saveState();

                // Determine execution binary path dynamically
                const execPath = Deno.execPath();
                const runArgs = execPath.endsWith("deno")
                  ? ["run", "-A", `${Deno.cwd()}/project/cli.ts`, "run", "--issue", String(issueNum), "--prompt", issueTitle, "--agent", agentEngine]
                  : ["run", "--issue", String(issueNum), "--prompt", issueTitle, "--agent", agentEngine];

                const runCmd = new Deno.Command(execPath, {
                  args: runArgs,
                  cwd: targetDir,
                  env: Deno.env.toObject(),
                  stdout: "inherit",
                  stderr: "inherit",
                });

                console.log(`🚀 Triggering local execution for Issue #${issueNum} using ${agentEngine}...`);
                const process = runCmd.spawn();
                await process.status;
                console.log(`✓ Completed local processing for Issue #${issueNum}.\n`);
              }
            }
          }
        }
      } catch (e) {
        console.warn(`[Daemon Watcher Warning] Error checking GitHub issues:`, e);
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }
  }
}
