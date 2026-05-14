import type { NativeToolHandler } from '../llm/tool-registry.js';

export interface McpBroker {
  isConnected(serverId: string): Promise<boolean>;
  getToolHandler(serverId: string, toolName: string): NativeToolHandler | null;
}

export class NullMcpBroker implements McpBroker {
  async isConnected(_serverId: string): Promise<boolean> {
    return false;
  }

  getToolHandler(_serverId: string, _toolName: string): NativeToolHandler | null {
    return null;
  }
}
