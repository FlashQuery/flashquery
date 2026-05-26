import {
  getDelegatedHardExcludedTools,
  getToolNamesByTier,
} from '../mcp/tool-metadata.js';

export const TOOL_TIERS = {
  'tier:read-only': getToolNamesByTier('tier:read-only'),
  'tier:read-write': getToolNamesByTier('tier:read-write'),
} as const satisfies Record<string, readonly string[]>;

export type ToolTierName = keyof typeof TOOL_TIERS;

const DELEGATED_HARD_EXCLUDED_TOOLS = getDelegatedHardExcludedTools();

export const HARD_EXCLUDED_NATIVE_TOOLS = DELEGATED_HARD_EXCLUDED_TOOLS.map((entry) => entry.tool);

export const HARD_EXCLUDED_REASON_BY_TOOL = new Map(
  DELEGATED_HARD_EXCLUDED_TOOLS.map((entry) => [entry.tool, entry.reason])
);
