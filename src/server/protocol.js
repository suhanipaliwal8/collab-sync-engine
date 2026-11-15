// Validates and cleans messages coming from clients.
// Never trust network input: check the shape, copy only the fields we expect.

function isId(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    Number.isSafeInteger(value.counter) &&
    value.counter >= 0 &&
    typeof value.siteId === 'string' &&
    value.siteId.length > 0 &&
    value.siteId.length <= 64
  );
}

function pickId(id) {
  return { counter: id.counter, siteId: id.siteId };
}

// Display names: plain text, no control characters, at most 24 characters.
function cleanName(name) {
  if (name === undefined || name === null) return null; // null means "unchanged"
  if (typeof name !== 'string') throw new Error('Invalid presence');
  const cleaned = Array.from(name.replace(/\p{Cc}/gu, '').trim()).slice(0, 24).join('');
  return cleaned.length > 0 ? cleaned : null;
}

function cleanCursor(cursor) {
  if (cursor === undefined || cursor === null) return null;
  if (typeof cursor !== 'object' || !isId(cursor.start) || !isId(cursor.end)) {
    throw new Error('Invalid presence');
  }
  return { start: pickId(cursor.start), end: pickId(cursor.end) };
}

// Returns a cleaned copy of the operation, or null if it is invalid.
function cleanOperation(op) {
  if (typeof op !== 'object' || op === null) return null;

  if (op.type === 'insert') {
    const validValue = typeof op.value === 'string' && [...op.value].length === 1;
    // counter 0 is reserved for the invisible ROOT marker
    if (!isId(op.id) || op.id.counter < 1 || !isId(op.parentId) || !validValue) return null;
    return { type: 'insert', id: pickId(op.id), parentId: pickId(op.parentId), value: op.value };
  }

  if (op.type === 'delete') {
    if (!isId(op.targetId)) return null;
    return { type: 'delete', targetId: pickId(op.targetId) };
  }

  return null;
}

// Parses a raw text message. Returns { type: 'op', op } or { type: 'revert', version },
// or throws an Error whose message is safe to send back to the client.
export function parseClientMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    throw new Error('Message is not valid JSON');
  }

  if (typeof message !== 'object' || message === null) {
    throw new Error('Unknown message type');
  }

  if (message.type === 'revert') {
    if (!Number.isSafeInteger(message.version) || message.version < 0) {
      throw new Error('Invalid version');
    }
    return { type: 'revert', version: message.version };
  }

  if (message.type === 'presence') {
    return { type: 'presence', name: cleanName(message.name), cursor: cleanCursor(message.cursor) };
  }

  if (message.type !== 'op') {
    throw new Error('Unknown message type');
  }

  const op = cleanOperation(message.op);
  if (!op) throw new Error('Invalid operation');
  return { type: 'op', op };
}