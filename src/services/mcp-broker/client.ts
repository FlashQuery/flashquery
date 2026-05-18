import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../logging/logger.js';
import { formatToolError, toThrowableToolError, type FormatToolErrorContext } from './errors.js';
import { hashToolSchema } from './tofu.js';
import type { BrokerAuditEvent, BrokerClientConfig, BrokerConnectionOptions, BrokeredTool, ConsumerContext } from './types.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 250;
const DEFAULT_SHUTDOWN_GRACE_MS = 5_000;
const STDERR_LIMIT_BYTES = 4 * 1024;

type SdkClient = Client & {
  fallbackRequestHandler?: (request: { method: string }) => Promise<never>;
};

export class BrokerClient {
  readonly #config: BrokerClientConfig;
  #client: SdkClient | null = null;
  #transport: StdioClientTransport | null = null;
  #connectPromise: Promise<void> | null = null;
  #tools: BrokeredTool[] = [];
  #stderr = '';
  #closed = false;
  #restartAttempted = false;
  #needsRestart = false;
  #lastContext: ConsumerContext | null = null;
  #spawnCount = 0;
  #restartCount = 0;

  constructor(config: BrokerClientConfig) {
    this.#config = config;
  }

  get pid(): number | null {
    return this.#transport?.pid ?? null;
  }

  get stderrText(): string {
    return this.#stderr;
  }

  get spawnCount(): number {
    return this.#spawnCount;
  }

  get restartCount(): number {
    return this.#restartCount;
  }

  get clientCapabilities(): Record<string, never> {
    return {};
  }

  async ensureConnected(): Promise<void> {
    if (this.#client !== null && this.#transport?.pid !== null && isProcessAlive(this.#transport.pid)) return;
    if (this.#connectPromise !== null) return this.#connectPromise;

    if (this.#needsRestart && !this.#restartAttempted) {
      this.#restartAttempted = true;
      this.#restartCount += 1;
    }
    this.#closed = false;
    this.#connectPromise = this.#connect().finally(() => {
      this.#connectPromise = null;
    });
    return this.#connectPromise;
  }

  async listTools(): Promise<BrokeredTool[]> {
    await this.ensureConnected();
    return this.#tools.map((tool) => ({ ...tool }));
  }

  async callTool(toolName: string, args: unknown, ctx: ConsumerContext): Promise<CallToolResult> {
    this.#lastContext = ctx;
    await this.ensureConnected();
    const client = this.#requireClient();

    try {
      const result = await client.callTool(
        { name: toolName, arguments: args as Record<string, unknown> },
        undefined,
        { timeout: this.#config.perCallTimeoutMs }
      );
      return result;
    } catch (error) {
      const normalized = formatToolError(error, this.#errorContext(toolName));
      if (this.#closed || this.#client === null || this.#transport === null) {
        throw toThrowableToolError({
          ...normalized,
          kind: 'transport_closed',
          message: normalized.message === '' ? 'transport closed during broker shutdown' : normalized.message,
        });
      }
      if (normalized.kind === 'transport_closed' && !this.#restartAttempted && !this.#closed) {
        this.#restartAttempted = true;
        await this.#resetConnection();
        await this.ensureConnected();
        this.#restartCount += 1;
        return this.#requireClient().callTool(
          { name: toolName, arguments: args as Record<string, unknown> },
          undefined,
          { timeout: this.#config.perCallTimeoutMs }
        );
      }
      throw toThrowableToolError(normalized);
    }
  }

  async isConnected(opts: BrokerConnectionOptions = {}): Promise<boolean> {
    const deepProbe = opts.deepProbe ?? true;
    if (this.#transport?.pid === null || this.#transport === null) return false;
    if (!deepProbe) return isProcessAlive(this.#transport.pid);

    try {
      await this.#requireClient().listTools(undefined, { timeout: opts.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS });
      return true;
    } catch {
      return false;
    }
  }

  async shutdown(graceMs = DEFAULT_SHUTDOWN_GRACE_MS): Promise<void> {
    this.#closed = true;
    const pid = this.pid;
    const client = this.#client;
    this.#client = null;
    this.#transport = null;
    this.#connectPromise = null;

    if (client === null) return;

    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        if (pid !== null && isProcessAlive(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Process already exited.
          }
        }
        resolve();
      }, graceMs);
    });

    try {
      await Promise.race([client.close(), timeout]);
    } catch (error) {
      throw toThrowableToolError(formatToolError(error, { serverId: this.#config.serverId }));
    }
  }

  async #connect(): Promise<void> {
    const client: SdkClient = new Client(
      { name: `flashquery-broker:${this.#config.serverId}`, version: '1.0.0' },
      { capabilities: {} }
    );
    const transport = new StdioClientTransport({
      command: this.#config.command,
      args: this.#config.args,
      env: this.#resolveEnv(),
      stderr: 'pipe',
    });
    this.#bindStderr(transport);
    this.#bindUnsupportedRequestAudit(client);

    client.onclose = () => {
      if (!this.#closed) this.#needsRestart = true;
      this.#client = null;
      this.#transport = null;
    };

    try {
      this.#spawnCount += 1;
      this.#client = client;
      this.#transport = transport;
      await client.connect(transport, { timeout: DEFAULT_CONNECT_TIMEOUT_MS });
      await this.#discoverTools(client);
    } catch (error) {
      this.#client = null;
      this.#transport = null;
      this.#needsRestart = false;
      try {
        await client.close();
      } catch {
        // Failed connects can also fail close; the original error is more useful.
      }
      const normalized = formatToolError(error, { serverId: this.#config.serverId });
      throw toThrowableToolError({
        ...normalized,
        kind: normalized.kind === 'unknown' || normalized.kind === 'transport_closed' ? 'server_crashed' : normalized.kind,
        message: this.#stderr === '' ? normalized.message : `${normalized.message}\nServer stderr: "${this.#stderr.trim()}"`,
      });
    }
  }

  async #discoverTools(client: Client): Promise<void> {
    const result = await client.listTools(undefined, { timeout: this.#config.perCallTimeoutMs });
    this.#tools = result.tools.map((tool) => ({
      serverId: this.#config.serverId,
      toolName: tool.name,
      registryKey: `${this.#config.serverId}__${tool.name}`,
      ...(tool.description === undefined ? {} : { description: tool.description, upstreamDescription: tool.description }),
      inputSchema: tool.inputSchema,
      tofuHash: hashToolSchema({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }),
      costPerCall: this.#config.toolOverrides[tool.name]?.costPerCall ?? this.#config.costPerCall,
    }));
  }

  async #resetConnection(): Promise<void> {
    const client = this.#client;
    this.#client = null;
    this.#transport = null;
    this.#connectPromise = null;
    if (client !== null) {
      try {
        await client.close();
      } catch {
        // Restart path tolerates already-closed transports.
      }
    }
  }

  #bindStderr(transport: StdioClientTransport): void {
    transport.stderr?.on('data', (chunk) => {
      this.#appendStderr(String(chunk));
    });
  }

  #appendStderr(text: string): void {
    this.#stderr = `${this.#stderr}${text}`;
    if (Buffer.byteLength(this.#stderr, 'utf8') > STDERR_LIMIT_BYTES) {
      this.#stderr = this.#stderr.slice(-STDERR_LIMIT_BYTES);
    }
  }

  #bindUnsupportedRequestAudit(client: SdkClient): void {
    client.fallbackRequestHandler = (request) => {
      this.#emitAudit({
        type: 'mcp_broker_reverse_request_rejected',
        serverId: this.#config.serverId,
        method: request.method,
        status: 'rejected_unsupported',
        ...(this.#lastContext?.traceId === undefined ? {} : { traceId: this.#lastContext.traceId }),
        ...(this.#lastContext?.kind === 'purpose' ? { purposeId: this.#lastContext.purposeId } : {}),
      });
      return Promise.reject(new McpError(ErrorCode.MethodNotFound, `${request.method} rejected_unsupported`));
    };
  }

  #emitAudit(event: BrokerAuditEvent): void {
    this.#config.onAudit?.(event);
    logger?.warn(
      `mcp_broker_reverse_request_rejected server=${event.serverId} method=${event.method} status=${event.status}${
        event.traceId === undefined ? '' : ` trace_id=${event.traceId}`
      }`
    );
  }

  #resolveEnv(): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    for (const [key, value] of Object.entries(this.#config.env)) {
      env[key] = value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, name: string) => process.env[name] ?? '');
    }
    return env;
  }

  #requireClient(): Client {
    if (this.#client === null) {
      throw toThrowableToolError({
        kind: this.#closed ? 'transport_closed' : 'unknown',
        message: this.#closed ? 'transport closed during broker shutdown' : 'Broker client is not connected.',
        serverId: this.#config.serverId,
      });
    }
    return this.#client;
  }

  #errorContext(toolName?: string): FormatToolErrorContext {
    return { serverId: this.#config.serverId, ...(toolName === undefined ? {} : { toolName }) };
  }
}

function isProcessAlive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
