import { idToString } from './id.js';

// A stable identity for an operation, used to detect duplicates and to match acknowledgements.
export function operationKey(op) {
  return op.type === 'insert'
    ? `ins:${idToString(op.id)}`
    : `del:${idToString(op.targetId)}`;
}