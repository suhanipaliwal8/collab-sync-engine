import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/server/logger.js';

function capture(level) {
  const lines = [];
  const logger = createLogger({ level, write: (line) => lines.push(line) });
  return { lines, logger };
}

test('writes the time, a padded level and the message', () => {
  const { lines, logger } = capture('info');
  logger.info('hello');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\d{2}:\d{2}:\d{2} INFO  hello$/);
});

test('hides messages below the configured level', () => {
  const { lines, logger } = capture('info');
  logger.debug('too chatty');
  logger.warn('shown');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /WARN {2}shown$/);
});

test('an unknown level falls back to info', () => {
  const { lines, logger } = capture('loud');
  logger.debug('hidden');
  logger.info('shown');
  assert.equal(lines.length, 1);
});