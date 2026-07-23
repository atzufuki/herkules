/**
 * Alexi Management Command: setup_app
 *
 * Automated 100% Zero-Touch GitHub Setup for GravityWorker.
 * Creates GitHub App via auto-submitted manifest POST form, configures workflow permissions,
 * injects secrets, and generates workflow file.
 *
 * @module gravity-worker/commands/setup_app
 */

import { BaseCommand } from "@alexi/core/management";
import {
  createWorkflowFile,
  enableRepoWorkflowPermissions,
  listenForManifestCallback,
  setRepoSecretWithGh,
} from "@gravity-worker/github_app.ts";
import { getGitHubContext, getRepoFromGitRemote } from "@gravity-worker/github.ts";

export class SetupAppCommand extends BaseCommand {
  override name = "setup_app";
  override help = "100% Zero-Touch Automated Setup of GravityWorker for GitHub";

  override async handle(options?: any): Promise<{ exitCode: number }> {
    const targetRepoFlag = typeof options === "string" ? options : options?.repo;

    console.log("🤖 Starting 100% Automated Zero-Touch GravityWorker Setup...\n");

    let repoSpec: string | undefined;
    let targetDir = ".";

    if (targetRepoFlag) {
      // Check if targetRepoFlag is a local directory path
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
        // Not a local directory, assume it's owner/repo format
        if (targetRepoFlag.includes("/")) {
          repoSpec = targetRepoFlag;
        }
      }
    }

    if (!repoSpec) {
      const ghContext = await getGitHubContext();
      if (ghContext.repoOwner && ghContext.repoName) {
        repoSpec = `${ghContext.repoOwner}/${ghContext.repoName}`;
      }
    }

    if (repoSpec) {
      console.log(`📌 Target repository detected: ${repoSpec}`);
      console.log(`📂 Target directory: ${targetDir}\n`);
    } else {
      console.log(`📌 Target directory: ${targetDir}\n`);
    }

    const manifestAppName = repoSpec ? `gravity-worker-${repoSpec.split("/")[1] ?? "app"}` : "gravity-worker";
    const localUrl = "http://localhost:3000";

    console.log("1️⃣ Starting local setup server and opening browser...");
    console.log(`   URL: ${localUrl}\n`);

    // Start local server to handle POST form auto-submit & OAuth callback
    const callbackPromise = listenForManifestCallback({ appName: manifestAppName });

    // Open browser to local server
    try {
      setTimeout(() => {
        if (Deno.build.os === "linux") {
          new Deno.Command("xdg-open", { args: [localUrl] }).spawn();
        } else if (Deno.build.os === "darwin") {
          new Deno.Command("open", { args: [localUrl] }).spawn();
        } else if (Deno.build.os === "windows") {
          new Deno.Command("cmd", { args: ["/c", "start", localUrl] }).spawn();
        }
      }, 300);
    } catch {
      // Ignore if browser launch fails
    }

    console.log("2️⃣ Waiting for single-click GitHub App creation...");

    try {
      const creds = await callbackPromise;
      console.log("\n🎉 GitHub App Created!");
      console.log(`- App Name: ${creds.slug}`);
      console.log(`- App ID:   ${creds.appId}`);

      // 2. Automate .github/workflows/gravity-worker.yml file generation
      console.log(`\n3️⃣ Generating .github/workflows/gravity-worker.yml in ${targetDir}...`);
      const workflowPath = await createWorkflowFile(targetDir);
      console.log(`✓ Workflow file generated at: ${workflowPath}`);

      // 3. Automate Secret Injection via gh CLI
      console.log(`\n4️⃣ Injecting repository secrets to ${repoSpec ?? "current repository"}...`);
      const appSaved = await setRepoSecretWithGh("GRAVITY_WORKER_APP_ID", creds.appId, repoSpec);
      const keySaved = await setRepoSecretWithGh("GRAVITY_WORKER_PRIVATE_KEY", creds.privateKey, repoSpec);

      const geminiEnvKey = Deno.env.get("GEMINI_API_KEY");
      if (geminiEnvKey) {
        await setRepoSecretWithGh("GEMINI_API_KEY", geminiEnvKey, repoSpec);
        console.log("✓ Injected GEMINI_API_KEY from local environment.");
      }

      if (appSaved && keySaved) {
        console.log("✓ GitHub Secrets configured automatically via gh CLI!");
      } else {
        console.log("⚠️ Note: Run 'gh auth login' to enable automatic secret injection, or add secrets manually.");
      }

      // 4. Automate Workflow Permissions via API / gh CLI
      if (repoSpec) {
        const [owner, repo] = repoSpec.split("/");
        if (owner && repo) {
          console.log(`\n5️⃣ Enabling PR creation permissions for ${owner}/${repo}...`);
          const token = Deno.env.get("GITHUB_TOKEN");
          if (token) {
            const permOk = await enableRepoWorkflowPermissions(owner, repo, token);
            if (permOk) {
              console.log("✓ Repository workflow permissions updated automatically!");
            }
          }
        }
      }

      console.log("\n=======================================================");
      console.log("✨ 100% ZERO-TOUCH SETUP COMPLETE!");
      console.log("=======================================================");
      console.log(`GravityWorker is ready to process issues on ${repoSpec ?? "your repository"}.`);
      console.log("Add the 'gravity-fix' label to any issue to begin!\n");

      return { exitCode: 0 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ Setup failed: ${msg}`);
      return { exitCode: 1 };
    }
  }
}
