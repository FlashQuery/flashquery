import { z } from 'zod';

export const batchIdentifierObjectSchema = z.strictObject({
  identifier: z.string(),
  version_token: z.string(),
});

export const batchIdentifierItemSchema = z.union([
  z.string(),
  batchIdentifierObjectSchema,
]);

export const batchIdentifiersSchema = z.union([
  z.string(),
  z.array(batchIdentifierItemSchema),
]);

export interface NormalizedBatchIdentifier {
  identifier: string;
  version_token?: string;
  index: number;
}

export type BatchIdentifiersInput = z.infer<typeof batchIdentifiersSchema>;

export function normalizeBatchIdentifiers(input: BatchIdentifiersInput): NormalizedBatchIdentifier[] {
  const items = Array.isArray(input) ? input : [input];

  return items.map((item, index) => {
    if (typeof item === 'string') {
      return { identifier: item, index };
    }

    return {
      identifier: item.identifier,
      version_token: item.version_token,
      index,
    };
  });
}
