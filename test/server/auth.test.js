import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthChecker, extractToken } from '../../src/server/auth.js';

test('without a configured token everything is allowed', () => {
  const auth = createAuthChecker(null);
  assert.equal(auth.enabled, false);
  assert.equal(auth.isAllowed(undefined), true);
  assert.equal(createAuthChecker('').enabled, false);
});

test('with a token, only the exact token is accepted', () => {
  const auth = createAuthChecker('s3cret');
  assert.equal(auth.enabled, true);
  assert.equal(auth.isAllowed('s3cret'), true);
  for (const bad of ['', 's3cre', 's3cret!', 'S3CRET', null, undefined, 42, ['s3cret']]) {
    assert.equal(auth.isAllowed(bad), false, `${String(bad)} must be refused`);
  }
});

test('extractToken reads the Authorization header first, then the query string', () => {
  const query = new URLSearchParams('token=fromquery');
  assert.equal(extractToken({ authorization: 'Bearer fromheader' }, query), 'fromheader');
  assert.equal(extractToken({}, query), 'fromquery');
  assert.equal(extractToken({ authorization: 'Basic abc' }, new URLSearchParams()), null);
});