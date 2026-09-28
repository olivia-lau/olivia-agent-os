import test from 'node:test';
import assert from 'node:assert/strict';
import { imagesFromClipboard } from '../public/clipboard-images.js';

test('clipboard images become uniquely named local attachments without including text items', () => {
  const png = { type: 'image/png', size: 10 };
  const jpg = { type: 'image/jpeg', size: 20 };
  const clipboard = { items: [
    { kind: 'string', type: 'text/plain' },
    { kind: 'file', type: 'image/png', getAsFile: () => png },
    { kind: 'file', type: 'image/jpeg', getAsFile: () => jpg }
  ] };
  const images = imagesFromClipboard(clipboard, Date.UTC(2026, 8, 28));
  assert.equal(images.length, 2);
  assert.equal(images[0].file, png);
  assert.match(images[0].relativePath, /^Pasted-image-2026-09-28T00-00-00-000Z-1\.png$/);
  assert.match(images[1].relativePath, /-2\.jpg$/);
});

test('non-image clipboard content is left to normal text paste', () => {
  assert.deepEqual(imagesFromClipboard({ items: [{ kind: 'string', type: 'text/plain' }] }), []);
});
