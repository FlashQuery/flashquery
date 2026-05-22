// tsup.config.ts
import { defineConfig } from "tsup";
var externalPluginImports = {
  name: "external-plugin-imports",
  setup(build) {
    build.onResolve({ filter: /plugins\/.*\/skills\// }, (args) => {
      return { path: args.path, external: true };
    });
  }
};
var tsup_config_default = defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
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
    "express",
    "pg",
    "events",
    "buffer",
    "stream",
    "http",
    "https",
    "net",
    "tls",
    "crypto",
    "fs",
    "path",
    "os",
    "url",
    "util",
    "querystring",
    "zlib",
    "child_process",
    "assert",
    "string_decoder",
    "dns",
    "dgram",
    "cluster",
    "worker_threads",
    "perf_hooks"
  ],
  noExternal: [],
  esbuildPlugins: [externalPluginImports],
  onSuccess: "mkdir -p dist/mcp/tool-help && cp src/mcp/tool-help/*.tool.md dist/mcp/tool-help/"
});
export {
  tsup_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidHN1cC5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9faW5qZWN0ZWRfZmlsZW5hbWVfXyA9IFwiL3Nlc3Npb25zL2xhdWdoaW5nLXlvdXRoZnVsLXRlc2xhL21udC9GbGFzaFF1ZXJ5L2ZsYXNocXVlcnkvdHN1cC5jb25maWcudHNcIjtjb25zdCBfX2luamVjdGVkX2Rpcm5hbWVfXyA9IFwiL3Nlc3Npb25zL2xhdWdoaW5nLXlvdXRoZnVsLXRlc2xhL21udC9GbGFzaFF1ZXJ5L2ZsYXNocXVlcnlcIjtjb25zdCBfX2luamVjdGVkX2ltcG9ydF9tZXRhX3VybF9fID0gXCJmaWxlOi8vL3Nlc3Npb25zL2xhdWdoaW5nLXlvdXRoZnVsLXRlc2xhL21udC9GbGFzaFF1ZXJ5L2ZsYXNocXVlcnkvdHN1cC5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd0c3VwJztcbmltcG9ydCB0eXBlIHsgUGx1Z2luIH0gZnJvbSAnZXNidWlsZCc7XG5cbi8qKlxuICogZXNidWlsZCBwbHVnaW4gdGhhdCBtYXJrcyBkeW5hbWljIHBsdWdpbiBza2lsbCBpbXBvcnRzIGFzIGV4dGVybmFsLlxuICpcbiAqIFdoZW4gZXNidWlsZCBlbmNvdW50ZXJzIGEgZHluYW1pYyBpbXBvcnQgd2l0aCBhIG5vbi1hbmFseXphYmxlIHBhdGhcbiAqICh2YXJpYWJsZSwgbm90IHRlbXBsYXRlIGxpdGVyYWwpLCBpdCBtYXkgc3RyaXAgdGhlIGltcG9ydCBjb2RlIGVudGlyZWx5LlxuICogVGhpcyBwbHVnaW4gaW50ZXJjZXB0cyByZXNvbHZlIGF0dGVtcHRzIGZvciBwYXRocyBjb250YWluaW5nIFwicGx1Z2luc1wiXG4gKiBhbmQgbWFya3MgdGhlbSBleHRlcm5hbCBzbyB0aGUgaW1wb3J0IGV4cHJlc3Npb24gaXMgcHJlc2VydmVkIGluIHRoZSBvdXRwdXQuXG4gKi9cbmNvbnN0IGV4dGVybmFsUGx1Z2luSW1wb3J0czogUGx1Z2luID0ge1xuICBuYW1lOiAnZXh0ZXJuYWwtcGx1Z2luLWltcG9ydHMnLFxuICBzZXR1cChidWlsZCkge1xuICAgIC8vIEludGVyY2VwdCBhbnkgcmVzb2x2ZSBmb3IgcGF0aHMgY29udGFpbmluZyBcInBsdWdpbnNcIiBhbmQgXCJza2lsbHNcIlxuICAgIGJ1aWxkLm9uUmVzb2x2ZSh7IGZpbHRlcjogL3BsdWdpbnNcXC8uKlxcL3NraWxsc1xcLy8gfSwgKGFyZ3MpID0+IHtcbiAgICAgIHJldHVybiB7IHBhdGg6IGFyZ3MucGF0aCwgZXh0ZXJuYWw6IHRydWUgfTtcbiAgICB9KTtcbiAgfSxcbn07XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIGVudHJ5OiBbJ3NyYy9pbmRleC50cyddLFxuICBmb3JtYXQ6IFsnZXNtJ10sXG4gIGR0czogdHJ1ZSxcbiAgc291cmNlbWFwOiB0cnVlLFxuICBjbGVhbjogdHJ1ZSxcbiAgLyoqXG4gICAqIE1hcmsgYWxsIG5vZGVfbW9kdWxlcyBwYWNrYWdlcyBhcyBleHRlcm5hbCBzbyB0aGV5IGFyZSByZXNvbHZlZFxuICAgKiBhdCBydW50aW1lIHZpYSBOb2RlJ3MgbW9kdWxlIHN5c3RlbSByYXRoZXIgdGhhbiBidW5kbGVkLlxuICAgKlxuICAgKiBUaGlzIHByZXZlbnRzIENKUyBwYWNrYWdlcyAoZXhwcmVzcywgcGcsIGV0Yy4pIGZyb20gYmVpbmdcbiAgICogY29udmVydGVkIHRvIEVTTSBzaGltcyB0aGF0IGZhaWwgd2l0aCBcIkR5bmFtaWMgcmVxdWlyZSBvZlxuICAgKiAnZXZlbnRzJyBpcyBub3Qgc3VwcG9ydGVkXCIgZXJyb3JzLlxuICAgKlxuICAgKiBOb2RlIGJ1aWx0LWluIG1vZHVsZXMgKGV2ZW50cywgYnVmZmVyLCBmcywgZXRjLikgYXJlIGFsc29cbiAgICogZXhjbHVkZWQgc2luY2UgdGhleSBtdXN0IGJlIGxvYWRlZCBmcm9tIHRoZSBOb2RlIHJ1bnRpbWUuXG4gICAqL1xuICBleHRlcm5hbDogW1xuICAgIC9ebm9kZTovLFxuICAgICdleHByZXNzJyxcbiAgICAncGcnLFxuICAgICdldmVudHMnLFxuICAgICdidWZmZXInLFxuICAgICdzdHJlYW0nLFxuICAgICdodHRwJyxcbiAgICAnaHR0cHMnLFxuICAgICduZXQnLFxuICAgICd0bHMnLFxuICAgICdjcnlwdG8nLFxuICAgICdmcycsXG4gICAgJ3BhdGgnLFxuICAgICdvcycsXG4gICAgJ3VybCcsXG4gICAgJ3V0aWwnLFxuICAgICdxdWVyeXN0cmluZycsXG4gICAgJ3psaWInLFxuICAgICdjaGlsZF9wcm9jZXNzJyxcbiAgICAnYXNzZXJ0JyxcbiAgICAnc3RyaW5nX2RlY29kZXInLFxuICAgICdkbnMnLFxuICAgICdkZ3JhbScsXG4gICAgJ2NsdXN0ZXInLFxuICAgICd3b3JrZXJfdGhyZWFkcycsXG4gICAgJ3BlcmZfaG9va3MnLFxuICBdLFxuICBub0V4dGVybmFsOiBbXSxcbiAgZXNidWlsZFBsdWdpbnM6IFtleHRlcm5hbFBsdWdpbkltcG9ydHNdLFxuICBvblN1Y2Nlc3M6ICdta2RpciAtcCBkaXN0L21jcC90b29scyAmJiBjcCBzcmMvbWNwL3Rvb2xzLyoudG9vbC5tZCBkaXN0L21jcC90b29scy8nLFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQStULFNBQVMsb0JBQW9CO0FBVzVWLElBQU0sd0JBQWdDO0FBQUEsRUFDcEMsTUFBTTtBQUFBLEVBQ04sTUFBTSxPQUFPO0FBRVgsVUFBTSxVQUFVLEVBQUUsUUFBUSx3QkFBd0IsR0FBRyxDQUFDLFNBQVM7QUFDN0QsYUFBTyxFQUFFLE1BQU0sS0FBSyxNQUFNLFVBQVUsS0FBSztBQUFBLElBQzNDLENBQUM7QUFBQSxFQUNIO0FBQ0Y7QUFFQSxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixPQUFPLENBQUMsY0FBYztBQUFBLEVBQ3RCLFFBQVEsQ0FBQyxLQUFLO0FBQUEsRUFDZCxLQUFLO0FBQUEsRUFDTCxXQUFXO0FBQUEsRUFDWCxPQUFPO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBWVAsVUFBVTtBQUFBLElBQ1I7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsRUFDRjtBQUFBLEVBQ0EsWUFBWSxDQUFDO0FBQUEsRUFDYixnQkFBZ0IsQ0FBQyxxQkFBcUI7QUFBQSxFQUN0QyxXQUFXO0FBQ2IsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
