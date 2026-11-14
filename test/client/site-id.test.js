import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSiteId } from '../../src/client/site-id.js';

test('creates ids shaped like u- plus 12 hex characters', () => {
  assert.match(createSiteId(), /^u-[0-9a-f]{12}$/);
});

test('creates a different id each time', () => {
  const ids = new Set(Array.from({ length: 100 }, () => createSiteId()));
  assert.equal(ids.size, 100);
});

test('only needs getRandomValues, so it works on plain http pages', () => {
  const insecurePage = { getRandomValues: (array) => array.fill(171) }; // no randomUUID here
  assert.equal(createSiteId(insecurePage), 'u-abababababab');
});