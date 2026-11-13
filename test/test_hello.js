import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/hello.js';

test('greet returns a greeting', () => {
  assert.equal(greet('Suhani'), 'Hello, Suhani!');
});