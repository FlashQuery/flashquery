import { defineConfig } from 'tsup';
import type { Plugin } from 'esbuild';

/**
 * esbuild plugin that marks dynamic plugin skill imports as external.
 *
 * When esbuild encounters a dynamic import with a non-analyzable path
 * (variable, not template literal), it may strip the import code entirely.
 * This plugin intercepts resolve attempts for paths containing "plugins"
 * and marks them external so the import expression is preserved in the output.
 */
const externalPluginImports: Plugin = {
  name: 'external-plugin-imports',
  setup(build) {
    // Intercept any resolve for paths containing "plugins" and "skills"
    build.onResolve({ filter: /plugins\/.*\/skills\// }, (args) => {
      return { path: args.path, external: true };
    });
  },
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  /**
   * Mark all node_modules packages as external so they are resolved
   * at runtime via Node's module system rather than bundled.
   *
   * This prevents CJS packages (express, pg, etc.) from being
   * converted to ESM shims that fail with "Dynamic require of
   * 'events' is not supported" errors.
   *
   * Node built-in modules (events, buffer, fs, etc.) are also
   * excluded since they must be loaded from the Node runtime.
   */
  external: [
    /^node:/,
    'express',
    'pg',
    'events',
    'buffer',
    'stream',
    'http',
    'https',
    'net',
    'tls',
    'crypto',
    'fs',
    'path',
    'os',
    'url',
    'util',
    'querystring',
    'zlib',
    'child_process',
    'assert',
    'string_decoder',
    'dns',
    'dgram',
    'cluster',
    'worker_threads',
    'perf_hooks',
  ],
  noExternal: [],
  esbuildPlugins: [externalPluginImports],
});
