export interface ToolSnapshotDiffInput {
  serverId: string;
  toolName: string;
  tofuHash: string;
  description?: string;
  upstreamDescription?: string;
  inputSchema?: unknown;
}

export interface ToolSnapshotDiff<TTool extends ToolSnapshotDiffInput> {
  added: TTool[];
  changed: TTool[];
  removed: TTool[];
  unchanged: TTool[];
}

export function diffToolSnapshots<TTool extends ToolSnapshotDiffInput>(
  oldTools: TTool[],
  newTools: TTool[]
): ToolSnapshotDiff<TTool> {
  const oldByIdentity = new Map(oldTools.map((tool) => [toolIdentity(tool), tool]));
  const newByIdentity = new Map(newTools.map((tool) => [toolIdentity(tool), tool]));
  const identities = [...new Set([...oldByIdentity.keys(), ...newByIdentity.keys()])].sort();
  const diff: ToolSnapshotDiff<TTool> = {
    added: [],
    changed: [],
    removed: [],
    unchanged: [],
  };

  for (const identity of identities) {
    const oldTool = oldByIdentity.get(identity);
    const newTool = newByIdentity.get(identity);

    if (oldTool === undefined && newTool !== undefined) {
      diff.added.push(newTool);
      continue;
    }

    if (oldTool !== undefined && newTool === undefined) {
      diff.removed.push(oldTool);
      continue;
    }

    if (oldTool !== undefined && newTool !== undefined) {
      if (oldTool.tofuHash === newTool.tofuHash) {
        diff.unchanged.push(newTool);
      } else {
        diff.changed.push(newTool);
      }
    }
  }

  return diff;
}

function toolIdentity(tool: Pick<ToolSnapshotDiffInput, 'serverId' | 'toolName'>): string {
  return `${tool.serverId}:${tool.toolName}`;
}
