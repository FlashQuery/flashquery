import { describe, expect, it } from 'vitest';
import type { PluginTableSpec } from '../../src/plugins/manager.js';
import {
  GENERATED_RECORD_FIELDS,
  validateWriteRecordInput,
} from '../../src/mcp/utils/record-validation.js';
import {
  buildRecordResult,
  parseRecordInclude,
  stripGeneratedRecordData,
} from '../../src/mcp/utils/record-output.js';

const contactsTable: PluginTableSpec = {
  name: 'contacts',
  columns: [
    { name: 'name', type: 'text', required: true },
    { name: 'email', type: 'text' },
    { name: 'active', type: 'boolean' },
  ],
};

describe('write_record validation', () => {
  it('rejects missing mode', () => {
    expect(validateWriteRecordInput({ plugin_id: 'crm', table: 'contacts', data: {} }, contactsTable)).toEqual({
      error: 'invalid_input',
      message: 'mode is required; use mode: "create" or mode: "update"',
    });
  });

  it('rejects unknown mode with field details', () => {
    expect(validateWriteRecordInput({ mode: 'upsert', plugin_id: 'crm', table: 'contacts', data: {} }, contactsTable)).toMatchObject({
      error: 'invalid_input',
      details: { field: 'mode', value: 'upsert' },
    });
  });

  it('requires scope and schema-required fields on create while allowing optional omissions', () => {
    expect(validateWriteRecordInput({ mode: 'create', table: 'contacts', data: { name: 'Ada' } }, contactsTable)).toMatchObject({
      error: 'invalid_input',
      details: { field: 'plugin_id' },
    });

    expect(validateWriteRecordInput({ mode: 'create', plugin_id: 'crm', table: 'contacts', data: {} }, contactsTable)).toMatchObject({
      error: 'invalid_input',
      details: { missing_fields: ['name'] },
    });

    expect(validateWriteRecordInput({ mode: 'create', plugin_id: 'crm', table: 'contacts', data: { name: 'Ada' } }, contactsTable)).toBeNull();
  });

  it('rejects top-level id and generated data fields on create', () => {
    expect(validateWriteRecordInput({ mode: 'create', plugin_id: 'crm', table: 'contacts', id: 'rec-1', data: { name: 'Ada' } }, contactsTable)).toMatchObject({
      error: 'invalid_input',
      details: { field: 'id' },
    });

    for (const generatedField of GENERATED_RECORD_FIELDS) {
      expect(
        validateWriteRecordInput(
          { mode: 'create', plugin_id: 'crm', table: 'contacts', data: { name: 'Ada', [generatedField]: 'x' } },
          contactsTable
        )
      ).toMatchObject({
        error: 'invalid_input',
        details: { field: generatedField, plugin_id: 'crm', table: 'contacts' },
      });
    }
  });

  it('rejects unknown data fields with plugin/table details', () => {
    expect(validateWriteRecordInput({ mode: 'create', plugin_id: 'crm', table: 'contacts', data: { name: 'Ada', nickname: 'Ace' } }, contactsTable)).toMatchObject({
      error: 'invalid_input',
      details: { field: 'nickname', plugin_id: 'crm', table: 'contacts' },
    });
  });

  it('validates update compound key and partial mutable data', () => {
    expect(validateWriteRecordInput({ mode: 'update', plugin_id: 'crm', table: 'contacts', data: { email: 'a@example.test' } }, contactsTable)).toMatchObject({
      error: 'invalid_input',
      details: { field: 'id' },
    });

    expect(validateWriteRecordInput({ mode: 'update', plugin_id: 'crm', table: 'contacts', id: 'rec-1', data: {} }, contactsTable)).toMatchObject({
      error: 'invalid_input',
      details: { reason: 'no_mutable_fields' },
    });

    expect(validateWriteRecordInput({ mode: 'update', plugin_id: 'crm', table: 'contacts', id: 'rec-1', data: { active: true } }, contactsTable)).toBeNull();
  });

  it('rejects array-like multi-target payloads', () => {
    expect(validateWriteRecordInput({ mode: 'create', plugin_id: ['crm'], table: 'contacts', data: { name: 'Ada' } }, contactsTable)).toMatchObject({
      error: 'invalid_input',
      details: { field: 'plugin_id', reason: 'single_target_only' },
    });

    expect(validateWriteRecordInput({ mode: 'create', plugin_id: 'crm', table: 'contacts', data: [{ name: 'Ada' }] }, contactsTable)).toMatchObject({
      error: 'invalid_input',
      details: { field: 'data', reason: 'single_target_only' },
    });
  });
});

describe('record output helpers', () => {
  const row = {
    id: 'rec-1',
    created_at: '2026-05-12T00:00:00.000Z',
    updated_at: '2026-05-12T01:00:00.000Z',
    instance_id: 'local',
    name: 'Ada',
    email: 'a@example.test',
  };

  it('parses default include by operation scope', () => {
    expect(parseRecordInclude(undefined, 'write')).toEqual([]);
    expect(parseRecordInclude(undefined, 'get')).toEqual(['data']);
    expect(parseRecordInclude([], 'get')).toEqual([]);
  });

  it('builds identification-only write confirmations by default', () => {
    expect(buildRecordResult(row, { plugin_id: 'crm', table: 'contacts', tableSpec: contactsTable }, parseRecordInclude(undefined, 'write'))).toEqual({
      id: 'rec-1',
      plugin_id: 'crm',
      table: 'contacts',
      created_at: '2026-05-12T00:00:00.000Z',
      updated_at: '2026-05-12T01:00:00.000Z',
    });
  });

  it('gates data and schema metadata behind include', () => {
    expect(buildRecordResult(row, { plugin_id: 'crm', table: 'contacts', tableSpec: contactsTable }, ['data', 'schema_metadata'])).toEqual({
      id: 'rec-1',
      plugin_id: 'crm',
      table: 'contacts',
      created_at: '2026-05-12T00:00:00.000Z',
      updated_at: '2026-05-12T01:00:00.000Z',
      data: {
        name: 'Ada',
        email: 'a@example.test',
      },
      schema_metadata: {
        required_fields: ['name'],
      },
    });
  });

  it('strips generated fields from included data', () => {
    expect(stripGeneratedRecordData(row)).toEqual({
      name: 'Ada',
      email: 'a@example.test',
    });
  });
});
