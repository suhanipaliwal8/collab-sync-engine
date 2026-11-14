import { RgaDocument } from './crdt/rga-document.js';
import {
  diffText,
  applyChangeToDocument,
  adjustCaret,
  utf16ToCodePointIndex,
  codePointToUtf16Index,
} from './client/text-diff.js';
import { createSiteId } from './client/site-id.js';

const textarea = document.querySelector('#editor');
const statusLabel = document.querySelector('#status');

// On a phone there are no developer tools, so show unexpected errors on the page.
window.addEventListener('error', (event) => setStatus(`Error: ${event.message}`, 'bad'));
window.addEventListener('unhandledrejection', (event) => setStatus(`Error: ${event.reason}`, 'bad'));

const historyOpen = document.querySelector('#history-open');
const historyPanel = document.querySelector('#history-panel');
const historySlider = document.querySelector('#history-slider');
const historyLabel = document.querySelector('#history-label');
const historyPreview = document.querySelector('#history-preview');
const historyRestore = document.querySelector('#history-restore');
const historyClose = document.querySelector('#history-close');

// Every browser tab is its own "site" with its own unique ID.
const siteId = createSiteId();
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
    historyOpen.disabled = false;
    textarea.focus();
    setStatus('Connected', 'ok');
  } else if (message.type === 'op') {
    doc.applyRemote(message.op);
    render();
  } else if (message.type === 'reverted') {
    setStatus(
      message.operations === 0
        ? `Already at version ${message.version}`
        : `Restored version ${message.version}`,
      'ok',
    );
    setTimeout(() => setStatus('Connected', 'ok'), 3000);
  } else if (message.type === 'error') {
    console.warn('Server error:', message.message);
    setStatus(`Server: ${message.message}`, 'bad');
  }
});

socket.addEventListener('close', () => {
  textarea.readOnly = true; // reconnect support arrives in Phase 8
  historyOpen.disabled = true;
  setStatus('Disconnected. Reload the page.', 'bad');
});

// The user typed, pasted or deleted something.
textarea.addEventListener('input', () => {
  const change = diffText(doc.getText(), textarea.value);
  for (const op of applyChangeToDocument(doc, change)) {
    socket.send(JSON.stringify({ type: 'op', op }));
  }
});

// ---------- History panel (time travel) ----------

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`request failed (${response.status})`);
  return response.json();
}

async function showVersion(version) {
  historyLabel.textContent = `${version} of ${historySlider.max}`;
  try {
    const data = await fetchJson(`/api/history/${version}`);
    if (Number(historySlider.value) !== data.version) return; // an older answer arrived late
    historyPreview.textContent = data.text; // textContent, never innerHTML: the text came from other people
  } catch (error) {
    historyPreview.textContent = `Could not load this version: ${error.message}`;
  }
}

historyOpen.addEventListener('click', async () => {
  try {
    const data = await fetchJson('/api/history?limit=1');
    historySlider.max = data.count;
    historySlider.value = data.count;
    historyPanel.hidden = false;
    await showVersion(data.count);
  } catch (error) {
    setStatus(`History unavailable: ${error.message}`, 'bad');
  }
});

let sliderTimer = null;
historySlider.addEventListener('input', () => {
  historyLabel.textContent = `${historySlider.value} of ${historySlider.max}`;
  clearTimeout(sliderTimer);
  // Wait until the slider settles so we don't send a request for every pixel.
  sliderTimer = setTimeout(() => showVersion(Number(historySlider.value)), 150);
});

historyRestore.addEventListener('click', () => {
  socket.send(JSON.stringify({ type: 'revert', version: Number(historySlider.value) }));
  historyPanel.hidden = true;
});

historyClose.addEventListener('click', () => {
  historyPanel.hidden = true;
});