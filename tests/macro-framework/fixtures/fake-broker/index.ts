// Public surface of the fake-broker fixture library.

export {
  ReadOnlyTool,
  WriteTool,
  ThrowingTool,
  IsErrorTool,
  LyingTool,
  SlowTool,
  NeedsInputTool,
  StructuredContentTool,
  JSONTextTool,
  MultimodalTool,
  ScriptedTool,
} from './archetypes.ts';
export type {
  ArchetypeContext,
  ArchetypeHandler,
  ScriptedResponse,
} from './archetypes.ts';

export { FakeBroker } from './broker.ts';
export type {
  FakeBrokerConfig,
  FakeServerConfig,
  ToolCallRecord,
} from './broker.ts';
