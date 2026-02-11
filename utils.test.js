import test from 'node:test';
import assert from 'node:assert/strict';

import { extractInlineImageData, resolveApiKey } from './utils.js';

test('resolveApiKey: manual key overrides env key', () => {
  assert.equal(resolveApiKey('manual-key', 'env-key'), 'manual-key');
});

test('resolveApiKey: falls back to trimmed env key', () => {
  assert.equal(resolveApiKey('   ', '  env-key  '), 'env-key');
});

test('extractInlineImageData: keeps MIME type from data URL', () => {
  assert.deepEqual(extractInlineImageData('data:image/png;base64,abc123'), {
    data: 'abc123',
    mimeType: 'image/png',
  });
});

test('extractInlineImageData: falls back to default MIME type for malformed URLs', () => {
  assert.deepEqual(extractInlineImageData('not-a-data-url', 'image/jpeg'), {
    data: '',
    mimeType: 'image/jpeg',
  });
});
