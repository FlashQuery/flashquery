import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/loader.js';
import { runListToolsCommand, type ListToolsClientFactory } from '../../src/services/mcp-broker/cli.js';

interface CapturedStreams {
  stdout: string;
  stderr: string;
}

async function writeBrokerConfig(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fq-list-tools-'));
  const configPath = join(root, 'flashquery.yml');
  await writeFile(
    configPath,
    [
      'instance:',
      '  id: unit-test',
      '  vault:',
      '    path: ./vault',
      'supabase:',
      '  url: http://localhost:54321',
      '  service_role_key: test-service-role',
      '  database_url: postgres://postgres:postgres@localhost:54322/postgres',
      'mcp_servers:',
      '  basic:',
      '    command: node',
      '    args: ["server-basic.js"]',
      '    cost_per_call: 0.005',
      '',
    ].join('\n')
  );
  return configPath;
}

function captureStreams(): CapturedStreams & {
  streams: {
    stdout: { write: (chunk: string) => void };
    stderr: { write: (chunk: string) => void };
  };
} {
  const captured: CapturedStreams = { stdout: '', stderr: '' };
  return {
    ...captured,
    streams: {
      stdout: { write: (chunk: string) => void (captured.stdout += chunk) },
      stderr: { write: (chunk: string) => void (captured.stderr += chunk) },
    },
    get stdout() {
      return captured.stdout;
    },
    get stderr() {
      return captured.stderr;
    },
  };
}

describe('list-tools diagnostic CLI', () => {
  it('T-U-143-CLI-071 discovers configured server tools and emits paste-ready override scaffolds', async () => {
    const configPath = await writeBrokerConfig();
    const captured = captureStreams();
    const clientFactory: ListToolsClientFactory = () => ({
      stderrText: '',
      async listTools() {
        return [
          {
            serverId: 'basic',
            toolName: 'echo',
            registryKey: 'basic__echo',
            description: 'Echo a message back to the caller.',
            inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
            tofuHash: 'hash-echo',
            costPerCall: 0.005,
          },
          {
            serverId: 'basic',
            toolName: 'weather',
            registryKey: 'basic__weather',
            description: 'Look up weather by city.',
            inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
            tofuHash: 'hash-weather',
            costPerCall: 0.005,
          },
        ];
      },
      async shutdown() {},
    });

    const exitCode = await runListToolsCommand({
      configPath,
      serverId: 'basic',
      stdout: captured.streams.stdout,
      stderr: captured.streams.stderr,
      clientFactory,
    });

    expect(exitCode).toBe(0);
    expect(captured.stderr).toBe('');
    expect(captured.stdout).toContain('tool_overrides:');
    expect(captured.stdout).toContain('echo:');
    expect(captured.stdout).toContain('weather:');
    expect(captured.stdout).toContain('# cost_per_call: 0.005');
    expect(captured.stdout).toContain('# description_override: "Echo a message back to the caller."');
    expect(captured.stdout).not.toContain('\n    cost_per_call:');
    expect(captured.stdout).not.toContain('\n    description_override:');
    expect(captured.stdout).toContain('# Echo a message back to the caller.');
    expect(captured.stdout).not.toMatch(/FlashQuery ready|STARTUP|Server stderr:/);
  });

  it('T-U-143-CLI-072 emits YAML that reparses when wrapped under mcp_servers.basic', async () => {
    // Unit analogue for T-S-019 and T-Y-014: stdout should paste directly below
    // mcp_servers.<server> without logs or stderr mixed into the YAML stream.
    const configPath = await writeBrokerConfig();
    const captured = captureStreams();
    const clientFactory: ListToolsClientFactory = () => ({
      stderrText: '',
      async listTools() {
        return [
          {
            serverId: 'basic',
            toolName: 'search',
            registryKey: 'basic__search',
            description: 'Search upstream content.',
            inputSchema: { type: 'object' },
            tofuHash: 'hash-search',
            costPerCall: 0.005,
          },
        ];
      },
      async shutdown() {},
    });

    await runListToolsCommand({
      configPath,
      serverId: 'basic',
      stdout: captured.streams.stdout,
      stderr: captured.streams.stderr,
      clientFactory,
    });

    const parsed = yaml.load(['mcp_servers:', '  basic:', indent(captured.stdout, 4)].join('\n')) as {
      mcp_servers?: { basic?: { tool_overrides?: Record<string, unknown> } };
    };
    expect(parsed.mcp_servers?.basic?.tool_overrides).toHaveProperty('search');
    expect(parsed.mcp_servers?.basic?.tool_overrides?.search).toBeNull();

    const root = await mkdtemp(join(tmpdir(), 'fq-list-tools-validated-'));
    const pastedConfigPath = join(root, 'flashquery.yml');
    await writeFile(
      pastedConfigPath,
      [
        'instance:',
        '  id: unit-test',
        '  vault:',
        '    path: ./vault',
        'supabase:',
        '  url: http://localhost:54321',
        '  service_role_key: test-service-role',
        '  database_url: postgres://postgres:postgres@localhost:54322/postgres',
        'mcp_servers:',
        '  basic:',
        '    command: node',
        '    args: ["server-basic.js"]',
        indent(captured.stdout, 4),
        '',
      ].join('\n')
    );
    expect(loadConfig(pastedConfigPath).mcpServers.basic?.toolOverrides.search).toEqual({});
    expect(captured.stdout).not.toMatch(/FlashQuery ready|STARTUP|Server stderr:/);
    expect(captured.stderr).toBe('');
  });

  it('T-U-143-CLI-072 keeps commented paste-back overrides semantically inert', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fq-list-tools-inert-'));
    const configPath = join(root, 'flashquery.yml');
    await writeFile(
      configPath,
      [
        'instance:',
        '  id: unit-test',
        '  vault:',
        '    path: ./vault',
        'supabase:',
        '  url: http://localhost:54321',
        '  service_role_key: test-service-role',
        '  database_url: postgres://postgres:postgres@localhost:54322/postgres',
        'mcp_servers:',
        '  basic:',
        '    command: node',
        '    args: ["server-basic.js"]',
        '    cost_per_call: 0.25',
        '    tool_overrides:',
        '      echo:',
        '        # Echoes the provided value without mutation.',
        '        # cost_per_call: 0.005             # uncomment + set',
        '        # description_override: "Echoes the provided value without mutation." # uncomment + set',
        '',
      ].join('\n')
    );

    const config = loadConfig(configPath);

    expect(config.mcpServers.basic?.costPerCall).toBe(0.25);
    expect(config.mcpServers.basic?.toolOverrides.echo).toEqual({});
  });

  it('T-U-143-CLI-073 returns non-zero, surfaces captured server stderr, and emits no YAML on discovery failure', async () => {
    // Unit analogue for T-S-020 / MCB-20.
    const configPath = await writeBrokerConfig();
    const captured = captureStreams();
    const clientFactory: ListToolsClientFactory = () => ({
      stderrText: 'fixture server failed during startup',
      async listTools() {
        throw new Error('tools/list failed');
      },
      async shutdown() {},
    });

    const exitCode = await runListToolsCommand({
      configPath,
      serverId: 'basic',
      stdout: captured.streams.stdout,
      stderr: captured.streams.stderr,
      clientFactory,
    });

    expect(exitCode).toBe(1);
    expect(captured.stdout).toBe('');
    expect(captured.stderr).toContain('tools/list failed');
    expect(captured.stderr).toContain('Server stderr: fixture server failed during startup');
    expect(captured.stderr).not.toContain('tool_overrides:');
  });
});

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value
    .trimEnd()
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}
