export interface ReviewerConfig {
  autoMerge: boolean;
  autoMergeMethod: 'squash' | 'merge' | 'rebase';
  worktreeDir: string;
  testCommand: string;
  lintCommand: string;
  aiModel?: string;
  minApprovalScore: number;
}

export const defaultConfig: ReviewerConfig = {
  autoMerge: false,
  autoMergeMethod: 'squash',
  worktreeDir: '.worktrees',
  testCommand: 'deno task test',
  lintCommand: 'deno task lint',
  minApprovalScore: 70,
};

export function parseConfig(
  cliArgs: string[] = [],
  overrides: Partial<ReviewerConfig> = {}
): ReviewerConfig {
  const config = { ...defaultConfig, ...overrides };

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];
    if (arg === '--auto-merge') {
      config.autoMerge = true;
    } else if (arg.startsWith('--auto-merge=')) {
      config.autoMerge = arg.split('=')[1] === 'true';
    } else if (arg === '--merge-method' && i + 1 < cliArgs.length) {
      const method = cliArgs[++i] as 'squash' | 'merge' | 'rebase';
      if (['squash', 'merge', 'rebase'].includes(method)) {
        config.autoMergeMethod = method;
      }
    } else if (arg.startsWith('--merge-method=')) {
      const method = arg.split('=')[1] as 'squash' | 'merge' | 'rebase';
      if (['squash', 'merge', 'rebase'].includes(method)) {
        config.autoMergeMethod = method;
      }
    } else if (arg === '--worktree-dir' && i + 1 < cliArgs.length) {
      config.worktreeDir = cliArgs[++i];
    } else if (arg === '--test-cmd' && i + 1 < cliArgs.length) {
      config.testCommand = cliArgs[++i];
    } else if (arg === '--lint-cmd' && i + 1 < cliArgs.length) {
      config.lintCommand = cliArgs[++i];
    } else if (arg === '--min-score' && i + 1 < cliArgs.length) {
      config.minApprovalScore = Number(cliArgs[++i]);
    }
  }

  return config;
}
