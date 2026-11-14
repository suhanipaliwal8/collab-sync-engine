import { RgaDocument } from './crdt/rga-document.js';
import {
  diffText,
  applyChangeToDocument,
  adjustCaret,
  utf16ToCodePointIndex,
  codePointToUtf16Index,
} from './client/text-diff.js';

const textarea = document.querySelector('#editor');
const statusLabel = document.querySelector('#status');

// Every browser tab is its own "site" with its own unique ID.
const siteId = `u-${crypto.randomUUID().slice(0, 8)}`;
const doc = new RgaDocument(siteId);
document.querySelector('#site-id').textContent = siteId;

function setStatus(text, kind) {
  statusLabel.textContent = text;
  statusLabel.className = kind;
}

// Show the document's text in the textarea, keeping the user's caret in place.
function render() {
  const oldText = textarea.value;
  const newText = doc.getText();
  if (newText === oldText) return;

  const change = diffText(oldText, newText);
  const start = adjustCaret(utf16ToCodePointIndex(oldText, textarea.selectionStart), change);
  const end = adjustCaret(utf16ToCodePointIndex(oldText, textarea.selectionEnd), change);

  textarea.value = newText;
  textarea.setSelectionRange(
    codePointToUtf16Index(newText, start),
    codePointToUtf16Index(newText, end),
  );
}

const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
const socket = new WebSocket(`${scheme}://${location.host}`);

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);

  if (message.type === 'sync') {
    message.ops.forEach((op) => doc.applyRemote(op));
    render();
    textarea.disabled = false; // we have the history; editing is safe now
    textarea.focus();
    setStatus('Connected', 'ok');
  } else if (message.type === 'op') {
    doc.applyRemote(message.op);
    render();
  } else if (message.type === 'error') {
    console.warn('Server error:', message.message);
  }
});

socket.addEventListener('close', () => {
  textarea.readOnly = true; // reconnect support arrives in Phase 8
  setStatus('Disconnected. Reload the page.', 'bad');
});

// The user typed, pasted or deleted something.
textarea.addEventListener('input', () => {
  const change = diffText(doc.getText(), textarea.value);
  for (const op of applyChangeToDocument(doc, change)) {
    socket.send(JSON.stringify({ type: 'op', op }));
  }
});