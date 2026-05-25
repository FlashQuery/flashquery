export {
  AmbiguousDocumentIdentifierError,
  DocumentNotFoundError,
  DocumentReadError,
  getFileMutex,
  resolveDocumentIdentifier,
  targetedScan,
} from './document-resolver-primitives.js';

export type {
  FrontmatterSnapshot,
  ResolvedDocument,
} from './document-resolver-primitives.js';
