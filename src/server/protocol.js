// Validates and cleans messages coming from clients.
// Never trust network input: check the shape, copy only the fields we expect.

function isId(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    Number.isSafeInteger(value.counter) &&
    value.counter >= 0 &&
    typeof value.siteId === 'string' &&
    value.siteId.length > 0
  );
}

function pickId(id) {
  return { counter: id.counter, siteId: id.siteId };
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

  if (message.type !== 'op') {
    throw new Error('Unknown message type');
  }

  const op = cleanOperation(message.op);
  if (!op) throw new Error('Invalid operation');
  return { type: 'op', op };
}