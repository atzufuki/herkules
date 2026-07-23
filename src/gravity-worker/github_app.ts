/**
 * GravityWorker - GitHub App Manifest Flow & Automated Repository Setup Module
 *
 * Automated GitHub App registration via POST form auto-submission, workflow permissions configuration,
 * secret management, and workflow file generation for 100% zero-config deployment.
 *
 * @module gravity-worker/github_app
 */

export interface GitHubAppCredentials {
  appId: string;
  privateKey: string;
  slug: string;
  htmlUrl: string;
}

export interface ManifestOptions {
  appName?: string;
  redirectUrl?: string;
}

/**
 * Builds the GitHub App Manifest JSON object.
 */
export function buildAppManifest(options: ManifestOptions = {}): Record<string, unknown> {
  const { appName = "gravity-worker", redirectUrl = "http://localhost:3000/callback" } = options;

  return {
    name: appName,
    url: "https://github.com/atzufuki/gravity-worker",
    redirect_url: redirectUrl,
    public: false,
    default_permissions: {
      issues: "write",
      pull_requests: "write",
      contents: "write",
      metadata: "read",
    },
    default_events: [
      "issues",
      "issue_comment",
      "pull_request",
    ],
  };
}

/**
 * Exchanges the code from the manifest callback URL for App ID and Private Key.
 */
export async function exchangeManifestCode(code: string): Promise<GitHubAppCredentials> {
  const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "GravityWorker",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to exchange GitHub App code: HTTP ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return {
    appId: String(data.id),
    privateKey: data.pem,
    slug: data.slug,
    htmlUrl: data.html_url,
  };
}

/**
 * Starts a temporary local HTTP server on http://localhost:3000 to auto-submit the GitHub App
 * manifest POST form (pre-filling 100% of fields) and receive the callback.
 */
export async function listenForManifestCallback(
  manifestOptions: ManifestOptions = {},
  port = 3000,
  timeoutMs = 120000,
): Promise<GitHubAppCredentials> {
  const controller = new AbortController();
  const { signal } = controller;
  const manifest = buildAppManifest(manifestOptions);
  const manifestJsonStr = JSON.stringify(manifest);

  let credentialsResolver: (value: GitHubAppCredentials) => void;
  let credentialsRejecter: (reason: Error) => void;

  const promise = new Promise<GitHubAppCredentials>((resolve, reject) => {
    credentialsResolver = resolve;
    credentialsRejecter = reject;
  });

  const server = Deno.serve(
    { port, signal, onListen: () => {} },
    async (req: Request) => {
      const url = new URL(req.url);
      const code = url.searchParams.get("code");

      // Step 2: Receive OAuth callback from GitHub after App creation
      if (code) {
        try {
          const credentials = await exchangeManifestCode(code);
          credentialsResolver(credentials);
          setTimeout(() => controller.abort(), 500);

          return new Response(
            `<!DOCTYPE html>
            <html><body style="font-family:system-ui,sans-serif;text-align:center;padding:50px;background:#0d1117;color:#c9d1d9;">
              <h2 style="color:#58a6ff;">🎉 GitHub App Created Successfully!</h2>
              <p>GravityWorker is setting up your repository...</p>
            </body></html>`,
            { headers: { "content-type": "text/html; charset=utf-8" } },
          );
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          credentialsRejecter(new Error(errorMsg));
          setTimeout(() => controller.abort(), 500);
          return new Response(`Error: ${errorMsg}`, { status: 500 });
        }
      }

      // Step 1: Auto-submit POST form to GitHub to pre-fill 100% of form fields
      const escapedManifest = manifestJsonStr.replace(/'/g, "&apos;").replace(/"/g, "&quot;");
      const html = `<!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Register GravityWorker GitHub App</title>
      </head>
      <body style="font-family:system-ui,sans-serif;text-align:center;padding:50px;background:#0d1117;color:#c9d1d9;">
        <h2 style="color:#58a6ff;">🚀 Registering GravityWorker GitHub App...</h2>
        <p>Redirecting to GitHub with 100% pre-filled fields & permissions...</p>
        <form id="manifestForm" action="https://github.com/settings/apps/new" method="post">
          <input type="hidden" name="manifest" value="${escapedManifest}">
        </form>
        <script>
          document.getElementById('manifestForm').submit();
        </script>
      </body>
      </html>`;

      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  );

  const timeoutId = setTimeout(() => {
    controller.abort();
    credentialsRejecter(new Error("Timeout waiting for GitHub App callback"));
  }, timeoutMs);

  try {
    const creds = await promise;
    clearTimeout(timeoutId);
    return creds;
  } catch (err) {
    clearTimeout(timeoutId);
    await server.finished.catch(() => {});
    throw err;
  }
}

/**
 * Enables PR creation and write permissions on a GitHub repository via API.
 */
export async function enableRepoWorkflowPermissions(
  owner: string,
  repo: string,
  token: string,
): Promise<boolean> {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/permissions/workflow`;
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "GravityWorker",
      },
      body: JSON.stringify({
        default_workflow_permissions: "write",
        can_approve_pull_request_reviews: true,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Automatically sets a repository secret using GitHub CLI (gh secret set).
 */
export async function setRepoSecretWithGh(
  secretName: string,
  secretValue: string,
  repoSpec?: string,
): Promise<boolean> {
  try {
    const args = ["secret", "set", secretName, "-b", secretValue];
    if (repoSpec) {
      args.push("--repo", repoSpec);
    }
    const command = new Deno.Command("gh", {
      args,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    return output.success;
  } catch {
    return false;
  }
}

/**
 * Creates or updates the GravityWorker workflow file in a repository directory.
 */
export async function createWorkflowFile(repoDir = "."): Promise<string> {
  const workflowDir = `${repoDir}/.github/workflows`;
  await Deno.mkdir(workflowDir, { recursive: true });
  const workflowPath = `${workflowDir}/gravity-worker.yml`;

  const content = `name: GravityWorker Agent Automation

on:
  issues:
    types: [labeled]
  issue_comment:
    types: [created]
  workflow_dispatch:
    inputs:
      prompt:
        description: 'Task instructions for GravityWorker'
        required: true
      agent:
        description: 'Agent engine (default: antigravity)'
        required: false
        default: 'antigravity'

jobs:
  gravity-worker:
    if: >-
      (github.event_name == 'issues' && github.event.label.name == 'gravity-fix') ||
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@gravity-worker')) ||
      (github.event_name == 'workflow_dispatch')
    runs-on: ubuntu-latest

    permissions:
      contents: write
      issues: write
      pull-requests: write

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run GravityWorker Agent
        uses: atzufuki/gravity-worker@main
        with:
          prompt: \${{ github.event.inputs.prompt || github.event.issue.title || github.event.comment.body }}
          agent: \${{ github.event.inputs.agent || 'antigravity' }}
          issue-id: \${{ github.event.issue.number }}
          github-token: \${{ secrets.GITHUB_TOKEN }}
          gemini-api-key: \${{ secrets.GEMINI_API_KEY }}
`;

  await Deno.writeTextFile(workflowPath, content);
  return workflowPath;
}
