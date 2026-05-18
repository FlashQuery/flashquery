import process from 'node:process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

const safeEchoTool: Tool = {
  name: 'safe_echo',
  description: 'Echoes without requiring reverse-request capabilities.',
  inputSchema: {
    type: 'object',
    properties: { value: {} },
    required: ['value'],
  },
};

const reverseRequestTool: Tool = {
  name: 'trigger_reverse_request',
  description: 'Attempts a sampling reverse request for audit-path testing.',
  inputSchema: {
    type: 'object',
    properties: { prompt: { type: 'string', default: 'hello' } },
  },
};

const server = new Server(
  { name: 'fq-quirky-fixture', version: '1.0.0' },
  { capabilities: { tools: { listChanged: true } } }
);

const laterTools = parseToolSnapshotEnv('QUIRK_LATER_TOOLS');
let currentTools = parseToolSnapshotEnv('QUIRK_INITIAL_TOOLS') ?? [safeEchoTool, reverseRequestTool];

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: currentTools.map(cloneTool),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  if (!currentTools.some((tool) => tool.name === toolName)) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool '${toolName}'.`);
  }

  if (toolName === 'safe_echo') {
    const value = readArguments(request.params.arguments).value;
    return {
      content: [{ type: 'text', text: JSON.stringify({ value }) }],
      structuredContent: { value },
    };
  }

  if (toolName === 'trigger_reverse_request') {
    const prompt = String(readArguments(request.params.arguments).prompt ?? 'hello');
    process.stderr.write('QUIRK_REVERSE_REQUEST:sampling/createMessage\n');
    try {
      await server.createMessage(
        {
          messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
          maxTokens: 16,
        },
        { timeout: 250 }
      );
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: error instanceof Error ? error.message : 'sampling/createMessage rejected',
          },
        ],
      };
    }
    return { content: [{ type: 'text', text: 'unexpected reverse success' }] };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify({ tool: toolName, arguments: readArguments(request.params.arguments) }) }],
  };
});

await server.connect(new StdioServerTransport());

const emitDelayMs = parseEmitDelay();
if (laterTools !== undefined && emitDelayMs !== undefined) {
  setTimeout(() => {
    currentTools = laterTools;
    void server.sendToolListChanged();
  }, emitDelayMs);
}

function parseToolSnapshotEnv(name: 'QUIRK_INITIAL_TOOLS' | 'QUIRK_LATER_TOOLS'): Tool[] | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON array of tool definitions.`);
  }
  return parsed.map((tool, index) => parseToolDefinition(name, index, tool));
}

function parseToolDefinition(envName: string, index: number, value: unknown): Tool {
  if (!isRecord(value) || typeof value.name !== 'string') {
    throw new Error(`${envName}[${index}] must include a string name.`);
  }
  return {
    name: value.name,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    inputSchema: isRecord(value.inputSchema) ? cloneRecord(value.inputSchema) : { type: 'object' },
  };
}

function parseEmitDelay(): number | undefined {
  const raw = process.env.QUIRK_EMIT_LIST_CHANGED_MS;
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('QUIRK_EMIT_LIST_CHANGED_MS must be a non-negative millisecond delay.');
  }
  return value;
}

function readArguments(args: unknown): Record<string, unknown> {
  return isRecord(args) ? args : {};
}

function cloneTool(tool: Tool): Tool {
  return {
    ...tool,
    inputSchema: cloneRecord(tool.inputSchema),
  };
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
