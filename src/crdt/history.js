import { RgaDocument } from './rga-document.js';

// Rebuilds a document by applying operations in the given order.
export function buildDocument(ops, siteId = 'history') {
  const doc = new RgaDocument(siteId);
  for (const op of ops) doc.applyRemote(op);
  return doc;
}

// The text after the first `version` operations (0 = empty document).
export function textAtVersion(ops, version) {
  if (!Number.isInteger(version) || version < 0 || version > ops.length) {
    throw new RangeError(`Unknown version ${version} (valid: 0 to ${ops.length})`);
  }
  return buildDocument(ops.slice(0, version)).getText();
}