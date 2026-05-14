import { jsonExpectedError, type ToolResult } from '../mcp/utils/response-formats.js';
import type {
  Call,
  Expr,
  Pipeline,
  Program,
  Statement,
  ToolCall,
  ToolReference,
  ToolRegistry,
  MacroCallerContext,
} from './types.js';

export interface PreScanToolReferencesOptions {
  program: Program;
  registry: ToolRegistry;
  allowlist: ReadonlySet<string>;
  allowlistSource?: 'resolveHostToolExposure' | 'assembleNativeToolRegistry' | string;
  callerContext?: MacroCallerContext;
  templateToolNames?: ReadonlySet<string> | readonly string[];
  hardExcludedReasons?: ReadonlyMap<string, string>;
}

interface UnknownToolReference extends ToolReference {
  available: string[];
}

export function collectToolReferences(program: Program): ToolReference[] {
  const references: ToolReference[] = [];
  program.statements.forEach((statement) => collectStatementToolReferences(statement, references));
  return references;
}

export function preScanToolReferences(options: PreScanToolReferencesOptions): ToolResult | undefined {
  const references = collectToolReferences(options.program);
  const templateToolNames = toStringSet(options.templateToolNames);
  const templateReference = references.find((reference) =>
    templateToolNames.has(formatToolReference(reference))
  );
  if (templateReference) {
    return jsonExpectedError({
      error: 'template_masquerade_tools_not_callable_from_macro',
      message: `Template tool '${formatToolReference(templateReference)}' is not callable from macros.`,
      details: {
        server: templateReference.server,
        tool: templateReference.tool,
        ...(templateReference.line === undefined ? {} : { line: templateReference.line }),
      },
    });
  }

  const unknownServers = uniqueByReference(
    references.filter((reference) => options.registry[reference.server] === undefined)
  );
  if (unknownServers.length > 0) {
    const first = unknownServers[0];
    return jsonExpectedError({
      error: 'unknown_server',
      message: `Unknown tool server '${first.server}'.`,
      details: {
        server: first.server,
        unknown: unknownServers.map(formatToolReference),
      },
    });
  }

  const unknownTools = uniqueUnknownTools(
    references
      .map((reference): UnknownToolReference | undefined => {
        const serverEntry = options.registry[reference.server];
        if (serverEntry.tools[reference.tool] !== undefined) return undefined;
        return {
          ...reference,
          available: Object.keys(serverEntry.tools).sort(),
        };
      })
      .filter((reference): reference is UnknownToolReference => reference !== undefined)
  );
  if (unknownTools.length > 0) {
    const first = unknownTools[0];
    return jsonExpectedError({
      error: 'unknown_tool',
      message: `Unknown tool '${formatToolReference(first)}'.`,
      details: {
        server: first.server,
        tool: first.tool,
        available: first.available,
        unknown: unknownTools.map(formatToolReference),
      },
    });
  }

  const hardExcluded = uniqueByReference(
    references.filter((reference) => options.hardExcludedReasons?.has(formatToolReference(reference)))
  );
  if (hardExcluded.length > 0) {
    const reason = options.hardExcludedReasons?.get(formatToolReference(hardExcluded[0]));
    return forbiddenToolsResult(hardExcluded, options.allowlist, reason);
  }

  const forbidden = uniqueByReference(
    references.filter((reference) => !options.allowlist.has(formatToolReference(reference)))
  );
  if (forbidden.length > 0) {
    return forbiddenToolsResult(forbidden, options.allowlist);
  }

  return undefined;
}

function collectStatementToolReferences(statement: Statement, references: ToolReference[]): void {
  switch (statement.kind) {
    case 'Binding':
      collectExprToolReferences(statement.value, references);
      return;
    case 'Pipeline':
      collectPipelineToolReferences(statement, references);
      return;
    case 'ToolCall':
      collectToolCallReference(statement, references);
      return;
    case 'ToolExistsCall':
      return;
    case 'ForLoop':
      collectExprToolReferences(statement.iterable, references);
      statement.body.forEach((child) => collectStatementToolReferences(child, references));
      return;
    case 'WhileLoop':
      collectExprToolReferences(statement.condition, references);
      statement.body.forEach((child) => collectStatementToolReferences(child, references));
      return;
    case 'IfStmt':
      collectExprToolReferences(statement.condition, references);
      statement.thenBody.forEach((child) => collectStatementToolReferences(child, references));
      statement.elseBody?.forEach((child) => collectStatementToolReferences(child, references));
      return;
  }
}

function collectExprToolReferences(expr: Expr, references: ToolReference[]): void {
  switch (expr.kind) {
    case 'StringLit':
    case 'NumLit':
    case 'NullLit':
    case 'VarRef':
    case 'ToolExistsCall':
      return;
    case 'ListLit':
      expr.items.forEach((item) => collectExprToolReferences(item, references));
      return;
    case 'ObjectLit':
      expr.entries.forEach((entry) => collectExprToolReferences(entry.value, references));
      return;
    case 'FieldAccess':
      collectExprToolReferences(expr.target, references);
      return;
    case 'RangeExpr':
      collectExprToolReferences(expr.start, references);
      collectExprToolReferences(expr.end, references);
      return;
    case 'BinaryExpr':
      collectExprToolReferences(expr.left, references);
      collectExprToolReferences(expr.right, references);
      return;
    case 'UnaryExpr':
      collectExprToolReferences(expr.expr, references);
      return;
    case 'Call':
      collectCallToolReferences(expr, references);
      return;
    case 'Pipeline':
      collectPipelineToolReferences(expr, references);
      return;
    case 'ToolCall':
      collectToolCallReference(expr, references);
      return;
  }
}

function collectPipelineToolReferences(pipeline: Pipeline, references: ToolReference[]): void {
  pipeline.stages.forEach((stage) => collectCallToolReferences(stage, references));
}

function collectCallToolReferences(call: Call, references: ToolReference[]): void {
  call.args.forEach((arg) => collectExprToolReferences(arg.value, references));
}

function collectToolCallReference(call: ToolCall, references: ToolReference[]): void {
  references.push({
    server: call.server,
    tool: call.tool,
    line: call.line,
  });
  if (call.arg) {
    collectExprToolReferences(call.arg, references);
  }
}

function forbiddenToolsResult(
  references: ToolReference[],
  allowlist: ReadonlySet<string>,
  reason?: string
): ToolResult {
  return jsonExpectedError({
    error: 'forbidden_tools',
    message: 'Macro references tools not in this invocation allowlist.',
    details: {
      forbidden: references.map(formatToolReference),
      allowed: [...allowlist].sort(),
      ...(reason === undefined ? {} : { reason }),
    },
  });
}

function toStringSet(values: ReadonlySet<string> | readonly string[] | undefined): Set<string> {
  if (values === undefined) return new Set();
  return values instanceof Set ? new Set(values) : new Set(values);
}

function uniqueByReference<T extends ToolReference>(references: T[]): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const reference of references) {
    const key = formatToolReference(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(reference);
  }
  return output;
}

function uniqueUnknownTools(references: UnknownToolReference[]): UnknownToolReference[] {
  return uniqueByReference(references);
}

function formatToolReference(reference: ToolReference): string {
  return `${reference.server}.${reference.tool}`;
}
