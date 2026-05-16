export const MACRO_SAFE_POINTS = {
  betweenStatements: 'between_statements',
  beforeStatement: 'before_statement',
  forLoopIteration: 'for_loop_iteration',
  whileLoopIteration: 'while_loop_iteration',
  betweenPipelineStages: 'between_pipeline_stages',
  beforeCall: (name: string): `before_call:${string}` => `before_call:${name}`,
  beforeToolCall: (server: string, tool: string): `before_tool_call:${string}.${string}` =>
    `before_tool_call:${server}.${tool}`,
  insideSleep: 'inside_sleep',
  insideSlowOp: 'inside_slow_op',
} as const;

export type MacroSafePoint =
  | typeof MACRO_SAFE_POINTS.betweenStatements
  | typeof MACRO_SAFE_POINTS.beforeStatement
  | typeof MACRO_SAFE_POINTS.forLoopIteration
  | typeof MACRO_SAFE_POINTS.whileLoopIteration
  | typeof MACRO_SAFE_POINTS.betweenPipelineStages
  | ReturnType<typeof MACRO_SAFE_POINTS.beforeCall>
  | ReturnType<typeof MACRO_SAFE_POINTS.beforeToolCall>
  | typeof MACRO_SAFE_POINTS.insideSleep
  | typeof MACRO_SAFE_POINTS.insideSlowOp;
