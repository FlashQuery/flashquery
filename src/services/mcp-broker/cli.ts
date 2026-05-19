import { loadConfig } from '../../config/loader.js';
import { BrokerClient } from './client.js';
import type { BrokerClientConfig, BrokeredTool } from './types.js';

export interface ListToolsStreams {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
}

export interface ListToolsClient {
  readonly stderrText: string;
  listTools(): Promise<BrokeredTool[]>;
  shutdown(): Promise<void>;
}

export type ListToolsClientFactory = (config: BrokerClientConfig) => ListToolsClient;

export interface RunListToolsCommandOptions {
  configPath: string;
  serverId: string;
  stdout?: ListToolsStreams['stdout'];
  stderr?: ListToolsStreams['stderr'];
  clientFactory?: ListToolsClientFactory;
}

export async function runListToolsCommand({
  configPath,
  serverId,
  stdout = process.stdout,
  stderr = process.stderr,
  clientFactory = (config) => new BrokerClient(config),
}: RunListToolsCommandOptions): Promise<number> {
  let client: ListToolsClient | null = null;

  try {
    const config = loadConfig(configPath);
    const serverConfig = config.mcpServers[serverId];
    if (serverConfig === undefined) {
      stderr.write(`Config error: mcp_servers does not define server '${serverId}'.\n`);
      return 1;
    }

    client = clientFactory({ ...serverConfig, serverId });
    const tools = await client.listTools();
    stdout.write(formatToolOverridesYaml(serverId, tools));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const serverStderr = client?.stderrText.trim() ?? '';
    stderr.write(`${message}\n`);
    if (serverStderr !== '' && !message.includes('Server stderr:')) {
      stderr.write(`Server stderr: ${serverStderr}\n`);
    }
    return 1;
  } finally {
    if (client !== null) {
      try {
        await client.shutdown();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr.write(`Failed to shut down MCP server '${serverId}': ${message}\n`);
      }
    }
  }
}

function formatToolOverridesYaml(serverId: string, tools: BrokeredTool[]): string {
  const lines = [`# Discovered ${tools.length} tools from ${serverId} (paste under mcp_servers.${serverId}.tool_overrides:)`, 'tool_overrides:'];
  for (const tool of tools) {
    lines.push(`  ${formatYamlKey(tool.toolName)}:`);
    for (const commentLine of formatDescriptionComment(tool.description ?? tool.upstreamDescription)) {
      lines.push(`    ${commentLine}`);
    }
    lines.push(`    cost_per_call: ${formatCost(tool.costPerCall)}`);
    lines.push('    description_override: ""');
  }
  return `${lines.join('\n')}\n`;
}

function formatDescriptionComment(description: string | undefined): string[] {
  if (description === undefined || description.trim() === '') {
    return ['# No upstream description provided.'];
  }
  return description
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `# ${line.trim()}`);
}

function formatYamlKey(key: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(key)) return key;
  return JSON.stringify(key);
}

function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost < 0) return '0';
  return Number.isInteger(cost) ? String(cost) : String(cost);
}
