import type { NativeToolHandler } from '../llm/tool-registry.js';

export interface McpBroker {
  isConnected(serverId: string): Promise<boolean>;
  getToolHandler(serverId: string, toolName: string): NativeToolHandler | null;
}

export class NullMcpBroker implements McpBroker {
  isConnected(_serverId: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  getToolHandler(_serverId: string, _toolName: string): NativeToolHandler | null {
    return null;
  }
}
