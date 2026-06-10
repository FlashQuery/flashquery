export interface FlashQueryConfig {
  instance: {
    name: string;
    id: string;
    vault: {
      path: string;
      markdownExtensions: string[];
    };
  };
  server: { host: string; port: number; url?: string };
  supabase: { url: string; serviceRoleKey: string; databaseUrl: string; skipDdl: boolean };
  git: { autoCommit: boolean; autoPush: boolean; remote: string; branch: string };
  mcp: { transport: 'stdio' | 'streamable-http'; host?: string; port?: number; authSecret?: string; tokenLifetime?: number };
  locking: { enabled: boolean; lockTimeoutSeconds: number };
  trashFolder: { enabled: boolean; path: string; collisionStrategy: 'suffix' | 'timestamp' };
  hostMcpTools?: { tools?: string[]; excludedTools?: string[] };
  mcpServers: Record<string, {
    transport: 'stdio';
    command: string;
    args: string[];
    env: Record<string, string>;
    costPerCall: number;
    perCallTimeoutMs: number;
    toolOverrides: Record<string, {
      costPerCall?: number;
      descriptionOverride?: string;
    }>;
  }>;
  host: { mcpServers: string[]; toolSearch: 'enabled' | 'disabled' };
  templates?: {
    defaultAccess: 'permissive' | 'restrictive';
    hostAccess: 'permissive' | 'restrictive';
    hostTemplates: string[];
  };
  macro: { defaultTimeoutMs: number };
  llm?: {
    providers: Array<{ name: string; type: 'openai-compatible' | 'ollama'; endpoint: string; apiKey?: string; local?: boolean; timeoutMs?: number }>;
    models: Array<{
      name: string;
      providerName: string;
      model: string;
      type: 'language' | 'reasoning' | 'embedding' | 'vision' | 'code' | 'audio' | 'guardian';
      dimensions?: number;
      costPerMillion: { input: number; output: number };
      description?: string;
      contextWindow?: number;
      tags?: string[];
      capabilities?: {
        tool_calling?: boolean;
        usage_on_tool_calls?: boolean;
        strict_tools?: boolean;
        parallel_tool_calls?: boolean;
        structured_outputs_with_tools?: boolean;
      };
    }>;
    purposes: Array<{
      name: string;
      description: string;
      models: string[];
      defaults?: Record<string, unknown>;
      tools?: string[];
      excludedTools?: string[];
      templates?: string[];
      mcpServers?: string[];
      toolSearch: 'enabled' | 'disabled';
    }>;
  };
  embeddings?: Array<{
    name: string;
    dimensions: number;
    endpoints: Array<{
      providerName: string;
      model: string;
      rateLimit?: { minDelayMs?: number };
      maxInputChars?: number;
    }>;
  }>;
  embedding?: {
    provider: string;
    model: string;
    apiKey?: string;
    endpoint?: string;
    dimensions: number;
  };
  logging: { level: 'debug' | 'info' | 'warn' | 'error'; output: 'stdout' | 'file'; file?: string };
}
