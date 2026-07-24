/**
 * Herkules - GitHub REST API Client Module
 *
 * Provides helper utilities for interacting with GitHub REST API:
 * - Parsing event payloads & context from GitHub Actions env vars
 * - Adding reactions (eyes, etc.) to issues/comments
 * - Posting issue comments
 * - Creating Pull Requests (with fallback lookup for existing PRs)
 * - Repository language detection
 *
 * @module herkules/github
 */

export interface GitHubContext {
  repoOwner?: string;
  repoName?: string;
  issueNumber?: number;
  issueTitle?: string;
  issueBody?: string;
  commentId?: number;
  eventName?: string;
  actor?: string;
  sender?: string;
  sha?: string;
  ref?: string;
}

export interface RemoteInfo {
  repoOwner?: string;
  repoName?: string;
}

/**
 * Detects if a given prompt or issue text is in Finnish.
 */
export function isFinnishText(text: string): boolean {
  const lower = text.toLowerCase();
  const finnishWords = ["lisää", "korjaa", "päivitä", "luo", "poista", "muuta", "toteuta", "varmista"];
  return finnishWords.some((word) => lower.includes(word));
}

/**
 * Parses git remote URL from target repo directory to extract repoOwner and repoName.
 */
export async function getRepoFromGitRemote(cwd?: string): Promise<RemoteInfo> {
  try {
    const cmd = new Deno.Command("git", {
      args: ["remote", "get-url", "origin"],
      cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (output.success) {
      const url = new TextDecoder().decode(output.stdout).trim();
      const cleanUrl = url.replace(/\.git$/, "");
      const match = cleanUrl.match(/github\.com[:/]([^/]+)\/(.+)$/);
      if (match) {
        return {
          repoOwner: match[1],
          repoName: match[2],
        };
      }
    }
  } catch {
    // Ignore
  }
  return {};
}

/**
 * Extracts GitHub context from GitHub Actions environment or fallback git remote.
 */
export async function getGitHubContext(cwd?: string): Promise<GitHubContext> {
  const repository = Deno.env.get("GITHUB_REPOSITORY");
  const eventName = Deno.env.get("GITHUB_EVENT_NAME");
  const eventPath = Deno.env.get("GITHUB_EVENT_PATH");
  const actor = Deno.env.get("GITHUB_ACTOR");
  const sha = Deno.env.get("GITHUB_SHA");
  const ref = Deno.env.get("GITHUB_REF");

  let repoOwner: string | undefined;
  let repoName: string | undefined;

  if (repository && repository.includes("/")) {
    const parts = repository.split("/");
    repoOwner = parts[0];
    repoName = parts[1];
  } else {
    const remote = await getRepoFromGitRemote(cwd);
    repoOwner = remote.repoOwner;
    repoName = remote.repoName;
  }

  let issueNumber: number | undefined;
  let issueTitle: string | undefined;
  let issueBody: string | undefined;
  let sender: string | undefined;
  let commentId: number | undefined;

  if (eventPath) {
    try {
      const text = await Deno.readTextFile(eventPath);
      const payload = JSON.parse(text);
      if (payload.issue?.number) {
        issueNumber = payload.issue.number;
        issueTitle = payload.issue.title;
        issueBody = payload.issue.body;
      } else if (payload.pull_request?.number) {
        issueNumber = payload.pull_request.number;
        issueTitle = payload.pull_request.title;
        issueBody = payload.pull_request.body;
      }

      if (payload.sender?.login) {
        sender = payload.sender.login;
      }

      if (payload.comment?.id) {
        commentId = payload.comment.id;
      }
    } catch {
      // Fallback
    }
  }

  return {
    repoOwner,
    repoName,
    issueNumber,
    issueTitle,
    issueBody,
    commentId,
    eventName,
    actor,
    sender,
    sha,
    ref,
  };
}

/**
 * Detects main programming languages in repository using GitHub API or file search.
 */
export async function detectLanguages(cwd?: string): Promise<string[]> {
  const languages: string[] = [];
  const entries: string[] = [];

  try {
    for await (const entry of Deno.readDir(cwd ?? ".")) {
      entries.push(entry.name);
    }
  } catch {
    return ["TypeScript", "JavaScript"];
  }

  if (entries.includes("deno.json") || entries.includes("deno.jsonc")) {
    languages.push("TypeScript", "Deno");
  } else if (entries.includes("package.json")) {
    languages.push("TypeScript", "Node.js");
  }

  if (entries.includes("Cargo.toml")) {
    languages.push("Rust");
  }

  if (entries.includes("go.mod")) {
    languages.push("Go");
  }

  if (entries.includes("pyproject.toml") || entries.includes("requirements.txt")) {
    languages.push("Python");
  }

  return languages.length > 0 ? languages : ["TypeScript", "JavaScript"];
}

/**
 * Adds a label (e.g. 'herkules') to a GitHub issue.
 */
export async function addLabelToIssue(
  options: {
    owner: string;
    repo: string;
    issueNumber: number;
    label: string;
    token: string;
  },
): Promise<boolean> {
  const { owner, repo, issueNumber, label, token } = options;
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Herkules",
      },
      body: JSON.stringify({ labels: [label] }),
    });

    return response.ok;
  } catch (err) {
    console.error(`[GitHub API] Network error adding label '${label}':`, err);
    return false;
  }
}

/**
 * Adds a reaction (eyes, +1, etc.) to an issue or comment on GitHub.
 */
export async function addReactionToIssueOrComment(
  options: {
    owner: string;
    repo: string;
    issueNumber: number;
    commentId?: number;
    reaction: "eyes" | "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket";
    token: string;
  },
): Promise<boolean> {
  const { owner, repo, issueNumber, commentId, reaction, token } = options;

  const url = commentId
    ? `https://api.github.com/repos/${owner}/${repo}/issues/comments/${commentId}/reactions`
    : `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/reactions`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Herkules",
      },
      body: JSON.stringify({ content: reaction }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Posts a comment to a GitHub issue or PR.
 */
export async function postIssueComment(
  options: {
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
    token: string;
  },
): Promise<boolean> {
  const { owner, repo, issueNumber, body, token } = options;
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Herkules",
      },
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[GitHub API] Failed to post comment: HTTP ${response.status} - ${errorText}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`[GitHub API] Network error posting comment:`, err);
    return false;
  }
}

/**
 * Creates a Pull Request on GitHub with fallback lookup for existing PRs.
 */
export async function createPullRequest(
  options: {
    owner: string;
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
    token: string;
  },
): Promise<string | null> {
  const { owner, repo, head, base, title, body, token } = options;
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Herkules",
      },
      body: JSON.stringify({ head, base, title, body }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      // Check if PR already exists for this branch
      try {
        const checkUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${head}&state=all`;
        const checkRes = await fetch(checkUrl, {
          headers: {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": `Bearer ${token}`,
            "User-Agent": "Herkules",
          },
        });
        if (checkRes.ok) {
          const checkPulls = await checkRes.json();
          if (Array.isArray(checkPulls) && checkPulls.length > 0 && checkPulls[0].html_url) {
            console.log(`ℹ️ Reusing existing Pull Request: ${checkPulls[0].html_url}`);
            return checkPulls[0].html_url;
          }
        }
      } catch {
        // Ignore check error
      }

      if (errorText.includes("No commits between")) {
        console.warn(`[GitHub API Notice] No new commits between ${base} and ${head}.`);
        return null;
      }

      console.error(`[GitHub API] Failed to create PR: HTTP ${response.status} - ${errorText}`);
      if (response.status === 403) {
        console.error(
          `💡 Tip: Ensure 'Allow GitHub Actions to create and approve pull requests' is enabled in Repository Settings -> Actions -> General -> Workflow permissions.`,
        );
      }
      return null;
    }

    const data = await response.json();
    return data.html_url ?? null;
  } catch (err) {
    console.error(`[GitHub API] Network error creating PR:`, err);
    return null;
  }
}

export interface IssueCommentItem {
  user: string;
  body: string;
  createdAt: string;
}

/**
 * Fetches issue comments from GitHub REST API.
 */
export async function fetchIssueComments(
  owner: string,
  repo: string,
  issueNumber: number,
  token: string,
): Promise<IssueCommentItem[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`;
  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": "Herkules",
      },
    });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        return data.map((c: any) => ({
          user: c.user?.login ?? "unknown",
          body: c.body ?? "",
          createdAt: c.created_at ?? "",
        }));
      }
    }
  } catch {
    // Ignore fetch errors
  }
  return [];
}

/**
 * Builds a full, context-rich issue prompt string including title, description, and Head & Tail comments.
 */
export function buildFullIssueContext(options: {
  issueNumber?: number;
  issueTitle?: string;
  issueBody?: string;
  comments?: IssueCommentItem[];
  userInstruction?: string;
}): string {
  const { issueNumber, issueTitle, issueBody, comments = [], userInstruction } = options;

  const parts: string[] = [];

  if (issueTitle) {
    parts.push(`Issue #${issueNumber ?? ""}: ${issueTitle}`);
  }

  if (issueBody && issueBody.trim()) {
    parts.push(`--- Issue Description ---\n${issueBody.trim()}`);
  }

  if (comments.length > 0) {
    let selectedComments: IssueCommentItem[] = [];
    if (comments.length <= 6) {
      selectedComments = comments;
    } else {
      const firstTwo = comments.slice(0, 2);
      const lastFour = comments.slice(-4);
      selectedComments = [...firstTwo, ...lastFour];
    }

    const commentsText = selectedComments
      .map((c) => `@${c.user}: ${c.body.trim()}`)
      .join("\n\n");

    parts.push(`--- Recent Conversation Thread ---\n${commentsText}`);
  }

  if (userInstruction && userInstruction.trim()) {
    parts.push(`--- Current User Instruction ---\n${userInstruction.trim()}`);
  }

  return parts.join("\n\n");
}
