import { describe, expect, it } from 'vitest';
import { __testing as testEnvTesting } from '../helpers/test-env.js';

describe('test advisory-lock database capability detection', () => {
  it('treats any Supabase pooler endpoint as not session-capable for Tier 2 integration assertions', () => {
    expect(
      testEnvTesting.isLikelyTransactionPoolerUrl(
        'postgresql://postgres.example:secret@aws-1-us-west-2.pooler.supabase.com:5432/postgres'
      )
    ).toBe(true);
    expect(
      testEnvTesting.isLikelyTransactionPoolerUrl(
        'postgresql://postgres.example:secret@aws-1-us-west-2.pooler.supabase.com:6543/postgres'
      )
    ).toBe(true);
  });

  it('allows direct and local Postgres endpoints to run session advisory-lock integration tests', () => {
    expect(
      testEnvTesting.isLikelyTransactionPoolerUrl(
        'postgresql://postgres:secret@db.example.supabase.co:5432/postgres'
      )
    ).toBe(false);
    expect(testEnvTesting.isLikelyTransactionPoolerUrl('postgresql://postgres:postgres@127.0.0.1:54322/postgres')).toBe(false);
  });
});
