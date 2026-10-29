import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderConcurrencyProof } from '../lib/lazy-router/provider-concurrency-proof.js';

test('proof requires all simultaneously active requests to finish successfully', () => {
  const events = [];
  const proof = new ProviderConcurrencyProof({ onProof: e => events.push(e) });
  const model = 'mistral-vibe/deepseek-v4-1-flash-1017';
  const a = proof.begin(model);
  const b = proof.begin(model);
  const c = proof.begin(model);
  b.finish(true);
  c.finish(true);
  expect(proof.max(model)).toBe(0);
  a.finish(true);
  expect(proof.max(model)).toBe(3);
  expect(events.at(-1)).toMatchObject({provider: 'mistral-vibe', model, verifiedMaxConcurrency: 3});
});

test('failures invalidate an overlapping witness, but other models stay independent', () => {
  const proof = new ProviderConcurrencyProof();
  const a = proof.begin('mistral-vibe/deepseek-v4-1-flash-1017');
  const b = proof.begin('mistral-vibe/deepseek-v4-1-flash-1017');
  a.finish(false);
  b.finish(true);
  expect(proof.max('mistral-vibe/deepseek-v4-1-flash-1017')).toBe(0);
  const c = proof.begin('mistral-vibe/mistral-small-latest');
  c.finish(true);
  expect(proof.max('mistral-vibe/mistral-small-latest')).toBe(1);
});

test('key identity never enters the model-level proof key', () => {
  const proof = new ProviderConcurrencyProof();
  const a = proof.begin('mistral-vibe/deepseek-v4-1-flash-1017');
  const b = proof.begin('mistral-vibe/deepseek-v4-1-flash-1017');
  a.finish(true);
  b.finish(true);
  expect(proof.max('mistral-vibe/deepseek-v4-1-flash-1017')).toBe(2);
});

test('verified high-water marks persist across restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'provider-proof-'));
  try {
    const file = join(dir, 'proof.json');
    const original = new ProviderConcurrencyProof({ statePath: file });
    const a = original.begin('provider/model');
    a.finish(true);
    a.finish(false);
    const restored = new ProviderConcurrencyProof({ statePath: file });
    expect(restored.max('provider/model')).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
