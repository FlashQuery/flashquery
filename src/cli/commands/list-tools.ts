import { Command } from 'commander';
import { resolveConfigPath } from '../../config/loader.js';
import { runListToolsCommand } from '../../services/mcp-broker/cli.js';

export const listToolsCommand = new Command('list-tools')
  .description('Discover tools from a configured MCP server and print paste-ready tool override YAML')
  .argument('<server>', 'MCP server id from mcp_servers')
  .option('--config <path>', 'explicit config file path')
  .action(async (serverId: string, options: { config?: string }) => {
    const configPath = resolveConfigPath(options.config);
    const exitCode = await runListToolsCommand({ configPath, serverId });
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  });
