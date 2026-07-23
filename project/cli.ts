#!/usr/bin/env -S deno run -A
/**
 * GravityWorker CLI Entrypoint
 *
 * Universal AI Agent Runner & Orchestrator for Git Worktrees & CI environments.
 *
 * @module project/cli
 */

import { parseArgs } from "@std/cli/parse-args";
import {
  commitWorktreeChanges,
  createWorktree,
  getWorktreeDiff,
  hasChanges,
  isGitRepository,
  pushWorktreeBranch,
  removeWorktree,
} from "@gravity-worker/git.ts";
import { AgentRunnerFactory, generateAiMessage } from "@gravity-worker/runner.ts";
import { generateImplementationPlan, generateWalkthrough, saveArtifact } from "@gravity-worker/artifacts.ts";
import { addReactionToIssueOrComment, createPullRequest, getGitHubContext, postIssueComment } from "@gravity-worker/github.ts";
import { getAppInstallationToken } from "@gravity-worker/github_app.ts";

const VERSION = "0.1.0";

function printHelp() {
  console.log(`
GravityWorker v${VERSION}
Universal AI Agent Runner & Orchestrator for Git Worktrees & CI.

USAGE:
  gravity-worker <command> [options]

COMMANDS:
  run          Execute an agent task (default)
  install      Automated installation & setup of @gravity-worker[bot] GitHub App
  uninstall    Remove GravityWorker workflow & secrets from target repository
  status       Check status of current worker / worktrees
  version      Print version information
  help         Print this help message

OPTIONS:
  -p, --prompt <text>    Instructions for the AI agent
  -a, --agent <name>     AI agent engine to use (default: "antigravity")
  -i, --issue <number>   GitHub / Git issue ID to process
  -r, --repo <spec/dir>  Target GitHub repository (owner/repo or local directory)
  -k, --key <api_key>    GEMINI_API_KEY to inject into GitHub secrets
  -w, --worktree [name]  Run in an isolated Git worktree (default: true)
      --keep-worktree    Keep worktree directory after execution
      --dry-run          Simulate execution without making changes
  -h, --help             Show help for command
  -v, --version          Show version

EXAMPLES:
  # Automated 100% Zero-Touch Installation for current repository
  gravity-worker install

  # Automated Installation with custom GEMINI_API_KEY
  gravity-worker install --repo atzufuki/siht.io --key YOUR_GEMINI_API_KEY

  # Uninstall GravityWorker from target repository
  gravity-worker uninstall --repo /var/home/atzufuki/Code/siht.io

  # Run a prompt locally in an isolated worktree
  gravity-worker run --prompt "Fix bug in auth middleware"

  # Process a specific GitHub issue with custom agent
  gravity-worker run --issue 42 --agent agy
`);
}

export async function main(args: string[] = Deno.args) {
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
    string: ["prompt", "agent", "issue", "worktree", "repo", "key"],
    default: {
      agent: "antigravity",
    },
  });

  const command = flags._[0]?.toString() ?? (flags.prompt || flags.issue ? "run" : "help");

  if (flags.version || command === "version") {
    console.log(`GravityWorker v${VERSION}`);
    return;
  }

  if (flags.help || command === "help") {
    printHelp();
    return;
  }

  switch (command) {
    case "install": {
      const { InstallCommand } = await import("@gravity-worker/commands/install.ts");
      const cmd = new InstallCommand();
      const res = await cmd.handle(flags);
      Deno.exit(res.exitCode);
      break;
    }
    case "uninstall": {
      const { UninstallCommand } = await import("@gravity-worker/commands/uninstall.ts");
      const cmd = new UninstallCommand();
      const res = await cmd.handle(flags);
      Deno.exit(res.exitCode);
      break;
    }
    case "run": {
      const taskId = flags.issue ? `issue-${flags.issue}` : `task-${Date.now()}`;
      const prompt = flags.prompt ?? (flags.issue ? `Fix GitHub issue #${flags.issue}` : "Default task");

      console.log(`\n🚀 GravityWorker v${VERSION} starting task #${taskId}...`);
      console.log(`- Agent Engine: ${flags.agent}`);
      console.log(`- Prompt: "${prompt}"`);

      // 1. Verify Git repo
      if (!await isGitRepository()) {
        console.error("❌ Error: Must be executed inside a Git repository.");
        Deno.exit(1);
      }

      // 2. Resolve GitHub token & context (Attempt @gravity-worker[bot] identity if App credentials exist)
      let githubToken = Deno.env.get("GITHUB_TOKEN");
      const ghContext = await getGitHubContext();

      const appId = Deno.env.get("GRAVITY_WORKER_APP_ID");
      const privateKey = Deno.env.get("GRAVITY_WORKER_PRIVATE_KEY");

      if (appId && privateKey && ghContext.repoOwner && ghContext.repoName) {
        const botToken = await getAppInstallationToken(appId, privateKey, ghContext.repoOwner, ghContext.repoName);
        if (botToken) {
          githubToken = botToken;
          console.log("🤖 Authenticated as dedicated @gravity-worker[bot]");
        }
      }

      const issueNum = ghContext.issueNumber ?? (flags.issue ? parseInt(flags.issue, 10) : undefined);

      // 3. React with 👀 (eyes emoji) immediately & post AI-generated start acknowledgement comment
      if (githubToken && ghContext.repoOwner && ghContext.repoName && ghContext.issueNumber) {
        console.log(`👀 Reacting with eyes emoji to GitHub Issue #${ghContext.issueNumber}...`);
        await addReactionToIssueOrComment({
          owner: ghContext.repoOwner,
          repo: ghContext.repoName,
          issueNumber: ghContext.issueNumber,
          commentId: ghContext.commentId,
          reaction: "eyes",
          token: githubToken,
        });

        console.log(`💬 Generating & posting start acknowledgement comment to GitHub Issue #${ghContext.issueNumber}...`);
        const startBody = await generateAiMessage(prompt, "start");

        await postIssueComment({
          owner: ghContext.repoOwner,
          repo: ghContext.repoName,
          issueNumber: ghContext.issueNumber,
          body: startBody,
          token: githubToken,
        });
      }

      // 4. Create isolated Worktree using standard fix/ID-task branch naming
      console.log(`\n🌿 Creating Git Worktree for task #${taskId}...`);
      const worktree = await createWorktree({ taskId, issueNumber: issueNum });
      console.log(`✓ Worktree ready at: ${worktree.worktreePath} (branch: ${worktree.branchName})`);

      try {
        // 5. Save Implementation Plan Artifact in hidden .gravity-worker/ (isolated from target repo commits)
        console.log(`\n📝 Generating implementation_plan.md artifact...`);
        const planContent = generateImplementationPlan({
          taskId,
          prompt,
          agentName: flags.agent,
        });
        await saveArtifact(worktree.worktreePath, ".gravity-worker/implementation_plan.md", planContent);

        // 6. Run Agent
        console.log(`\n🤖 Executing agent (${flags.agent})...`);
        const runner = AgentRunnerFactory.getRunner(flags.agent);
        const result = await runner.run({
          prompt,
          worktreePath: worktree.worktreePath,
          dryRun: flags["dry-run"],
        });

        // 7. Get Diff before committing
        const diff = await getWorktreeDiff(worktree.worktreePath).catch(() => "");

        // 8. Save Walkthrough Artifact in hidden .gravity-worker/ (isolated from target repo commits)
        console.log(`📝 Generating walkthrough.md artifact...`);
        const walkthroughContent = generateWalkthrough({
          taskId,
          prompt,
          agentName: flags.agent,
          output: result.output || (result.success ? "Execution completed successfully." : "Execution failed."),
          diff,
          durationMs: result.durationMs,
        });
        await saveArtifact(worktree.worktreePath, ".gravity-worker/walkthrough.md", walkthroughContent);

        // 9. Commit & Push Worktree Changes if modified & success (artifacts in .gravity-worker/ are strictly excluded from commit)
        if (result.success && !flags["dry-run"] && await hasChanges(worktree.worktreePath)) {
          console.log(`\n📤 Committing & pushing branch ${worktree.branchName}...`);
          await commitWorktreeChanges(worktree.worktreePath, `Fix #${taskId}: ${prompt}`);
          await pushWorktreeBranch(worktree.worktreePath, worktree.branchName).catch((e) => {
            console.warn(`[Git Push Warning] ${e.message}`);
          });

          // 10. Create GitHub Pull Request linked with "Closes #issue" & Comment
          if (githubToken && ghContext.repoOwner && ghContext.repoName) {
            console.log(`\n🔀 Creating GitHub Pull Request...`);
            const prTitle = issueNum
              ? `Fix #${issueNum}: ${prompt}`
              : `[GravityWorker] ${prompt}`;

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
            });

            if (prUrl) {
              console.log(`✓ Pull Request created: ${prUrl}`);

              if (ghContext.issueNumber) {
                console.log(`💬 Generating & posting completion comment to GitHub Issue #${ghContext.issueNumber}...`);
                const completionGreeting = await generateAiMessage(prompt, "completion");

                await postIssueComment({
                  owner: ghContext.repoOwner,
                  repo: ghContext.repoName,
                  issueNumber: ghContext.issueNumber,
                  body: `${completionGreeting}\n\n**Pull Request:** ${prUrl}\n\n${walkthroughContent}`,
                  token: githubToken,
                });
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
      console.log(`GravityWorker Status: Ready`);
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
