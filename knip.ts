import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // Source/package-tooling baseline: script scope covers file and dependency reachability.
  // Export reporting remains staged until existing intentional public/test helper exports are triaged.
  entry: ['src/index.ts'],
  project: [
    'src/**/*.ts',
    '!src/node_modules/**',
    '!src/dist/**',
  ],
  ignore: [
    '.claude/worktrees/**',
    'src/node_modules/**',
    'src/dist/**',
    'dist/**',
  ],
  ignoreDependencies: [
    '@types/uuid',
    'esbuild',
  ],
};

export default config;
