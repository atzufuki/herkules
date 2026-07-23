/**
 * GravityWorker - Artifact Generator Module
 *
 * Generates Antigravity-native implementation_plan.md and walkthrough.md artifacts.
 *
 * @module gravity-worker/artifacts
 */

import { dirname, join } from "@std/path";

export interface PlanArtifactOptions {
  taskId: string;
  prompt: string;
  agentName: string;
  proposedChanges?: string[];
}

export interface WalkthroughArtifactOptions {
  taskId: string;
  prompt: string;
  agentName: string;
  output: string;
  diff?: string;
  durationMs: number;
}

/**
 * Generates an implementation_plan.md artifact content.
 */
export function generateImplementationPlan(options: PlanArtifactOptions): string {
  const { taskId, prompt, agentName, proposedChanges = [] } = options;
  const timestamp = new Date().toISOString();

  const changesList = proposedChanges.length > 0
    ? proposedChanges.map((c) => `- ${c}`).join("\n")
    : "- Automated code inspection and refactoring in isolated worktree.";

  return `# Implementation Plan - Task #${taskId}

> [!NOTE]
> Generated automatically by **GravityWorker** (${agentName}) at ${timestamp}.

## Task Summary
${prompt}

## User Review Required
> [!IMPORTANT]
> This task is executed automatically in background worktree \`gravity-worker/${taskId}\`.

## Proposed Changes
${changesList}

## Verification Plan
- [x] Automated unit test suite (\`deno task test\`)
- [x] Syntax & type-check verification
`;
}

/**
 * Generates a walkthrough.md artifact content.
 */
export function generateWalkthrough(options: WalkthroughArtifactOptions): string {
  const { taskId, prompt, agentName, output, diff, durationMs } = options;
  const timestamp = new Date().toISOString();

  const diffSection = diff && diff.trim().length > 0
    ? `\n## Code Changes (Diff)\n\`\`\`diff\n${diff}\n\`\`\`\n`
    : "";

  return `# Walkthrough - Task #${taskId}

> [!NOTE]
> Execution completed in ${(durationMs / 1000).toFixed(2)}s using **GravityWorker** (${agentName}) at ${timestamp}.

## Original Prompt
${prompt}

## Execution Logs
\`\`\`text
${output}
\`\`\`
${diffSection}
## Next Steps
To inspect or take over this task in your active Antigravity session, run:
\`\`\`bash
git checkout gravity-worker/${taskId}
\`\`\`
`;
}

/**
 * Saves an artifact file to the specified target directory, ensuring parent directories exist.
 */
export async function saveArtifact(
  targetDir: string,
  filename: string,
  content: string,
): Promise<string> {
  const filePath = join(targetDir, filename);
  const parentDir = dirname(filePath);
  await Deno.mkdir(parentDir, { recursive: true });
  await Deno.writeTextFile(filePath, content);
  return filePath;
}
