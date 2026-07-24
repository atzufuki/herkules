/**
 * Herkules - Interactive Comment Commands Module
 *
 * Parses and handles interactive comment commands (@herkules plan, update, review, retry).
 *
 * @module herkules/commands
 */

export type CommentCommandType = "plan" | "update" | "review" | "retry" | "run";

export interface ParsedCommentCommand {
  /** The parsed command type */
  command: CommentCommandType;
  /** Instructions or prompt after the command keyword */
  prompt: string;
  /** Unmodified text */
  rawText: string;
  /** Whether @herkules was mentioned or command keyword prefix was used */
  isMentioned: boolean;
}

export interface CommandResponse {
  command: CommentCommandType;
  title: string;
  body: string;
  success: boolean;
  artifactIdentifier?: string;
}

/**
 * Returns a list of all supported interactive comment commands.
 */
export function getSupportedCommands(): CommentCommandType[] {
  return ["plan", "update", "review", "retry", "run"];
}

/**
 * Returns a summary description for a given interactive comment command.
 */
export function getCommandHelp(command?: CommentCommandType): string {
  switch (command) {
    case "plan":
      return "Generates an implementation plan artifact (.herkules/implementation_plan.md) without applying changes.";
    case "update":
      return "Updates the existing worktree branch and Pull Request with new user requirements.";
    case "review":
      return "Inspects the git diff and PR code changes and posts an automated code review report.";
    case "retry":
      return "Cleans worktree state and re-runs the task execution from scratch.";
    case "run":
    default:
      return "Executes the AI agent task in an isolated Git worktree.";
  }
}

/**
 * Supported interactive comment commands:
 * - `@herkules plan [prompt]`: Generates implementation plan artifact & comment.
 * - `@herkules update [prompt]`: Updates existing worktree branch & PR with new requirements.
 * - `@herkules review [prompt]`: Inspects diff/PR and posts automated code review.
 * - `@herkules retry [prompt]`: Re-runs task execution with fresh worktree / clean state.
 * - `@herkules [prompt]`: Default task execution ('run').
 */
export function parseCommentCommand(text: string): ParsedCommentCommand {
  const rawText = text.trim();

  // Check for slash commands directly at start (e.g. /plan, /update, /review, /retry)
  const slashCmdMatch = rawText.match(/^\/(plan|update|review|retry)\b\s*:?\s*(.*)/i);
  if (slashCmdMatch) {
    const command = slashCmdMatch[1].toLowerCase() as CommentCommandType;
    const prompt = slashCmdMatch[2].trim();
    return {
      command,
      prompt,
      rawText,
      isMentioned: true,
    };
  }

  // Check if @herkules or /herkules mention exists
  const mentionRegex = /(?:@|\/)?herkules(?:-bot|\[bot\])?/i;
  const match = rawText.match(mentionRegex);

  if (!match) {
    // Fallback: check if prompt starts directly with a command keyword (for direct CLI usage)
    const directMatch = rawText.match(/^(plan|update|review|retry)\b\s*:?\s*(.*)/i);
    if (directMatch) {
      const command = directMatch[1].toLowerCase() as CommentCommandType;
      const prompt = directMatch[2].trim();
      return {
        command,
        prompt,
        rawText,
        isMentioned: false,
      };
    }

    return {
      command: "run",
      prompt: rawText,
      rawText,
      isMentioned: false,
    };
  }

  // Extract text after @herkules mention
  const mentionEndIndex = (match.index ?? 0) + match[0].length;
  let afterMention = rawText.slice(mentionEndIndex).trim();

  // Strip leading symbols like colons, commas, or dashes
  afterMention = afterMention.replace(/^[:,\-\s]+/, "").trim();

  // Check if text starts with one of the interactive sub-commands
  const commandMatch = afterMention.match(/^(plan|update|review|retry)\b\s*:?\s*(.*)/i);

  if (commandMatch) {
    const command = commandMatch[1].toLowerCase() as CommentCommandType;
    const prompt = commandMatch[2].trim();

    return {
      command,
      prompt,
      rawText,
      isMentioned: true,
    };
  }

  // Default to run if no specific command keyword is present
  return {
    command: "run",
    prompt: afterMention || rawText,
    rawText,
    isMentioned: true,
  };
}

/**
 * Formats a GitHub comment or output message for a specific command execution.
 */
export function formatCommandResponse(
  command: CommentCommandType,
  details: {
    prompt?: string;
    content?: string;
    issueNumber?: number;
    prUrl?: string;
    success?: boolean;
    error?: string;
  },
): CommandResponse {
  const { prompt = "", content = "", prUrl, success = true, error } = details;

  if (!success && error) {
    return {
      command,
      title: `❌ Command @herkules-bot ${command} failed`,
      body: `⚠️ **Herkules Command Failed** (\`${command}\`)\n\n**Error:** ${error}`,
      success: false,
    };
  }

  switch (command) {
    case "plan": {
      const header = `📋 **Herkules Implementation Plan**`;
      const promptSection = prompt ? `\n\n**Task:** ${prompt}` : "";
      const body = `${header}${promptSection}\n\n${content}`;
      return {
        command: "plan",
        title: "Implementation Plan",
        body,
        success: true,
        artifactIdentifier: ".herkules/implementation_plan.md",
      };
    }
    case "update": {
      const header = `🔄 **Herkules Worktree & PR Update**`;
      const promptSection = prompt ? `\n\n**Update Instructions:** ${prompt}` : "";
      const prSection = prUrl ? `\n\n**Pull Request:** ${prUrl}` : "";
      const body = `${header}${promptSection}${prSection}\n\n${content}`;
      return {
        command: "update",
        title: "Worktree Updated",
        body,
        success: true,
      };
    }
    case "review": {
      const header = `🔍 **Herkules Automated Code Review**`;
      const promptSection = prompt ? `\n\n**Review Scope:** ${prompt}` : "";
      const body = `${header}${promptSection}\n\n${content}`;
      return {
        command: "review",
        title: "Code Review Report",
        body,
        success: true,
        artifactIdentifier: ".herkules/review.md",
      };
    }
    case "retry": {
      const header = `🔁 **Herkules Task Retry**`;
      const promptSection = prompt ? `\n\n**Retry Prompt:** ${prompt}` : "";
      const prSection = prUrl ? `\n\n**Pull Request:** ${prUrl}` : "";
      const body = `${header}${promptSection}${prSection}\n\n${content}`;
      return {
        command: "retry",
        title: "Task Retried",
        body,
        success: true,
      };
    }
    case "run":
    default: {
      const header = `🚀 **Herkules Execution Report**`;
      const body = `${header}\n\n${content}`;
      return {
        command: "run",
        title: "Task Execution",
        body,
        success: true,
      };
    }
  }
}
