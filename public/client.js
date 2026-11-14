import { SyncClient } from './client/sync-client.js';
import {
  diffText,
  adjustCaret,
  utf16ToCodePointIndex,
  codePointToUtf16Index,
} from './client/text-diff.js';
import { createSiteId } from './client/site-id.js';

const textarea = document.querySelector('#editor');
const statusLabel = document.querySelector('#status');
const offlineToggle = document.querySelector('#offline-toggle');

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

function setStatus(text, kind) {
  statusLabel.textContent = text;
  statusLabel.className = kind;
}

function safeSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null; // storage can be blocked by browser privacy settings
  }
}

// Show the document's text in the textarea, keeping the user's caret in place.
function render() {
  const oldText = textarea.value;
  const newText = client.text;
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

let wasReady = false;

function showStatus({ status, unsent }) {
  const pending = unsent > 0 ? ` · ${unsent} unsent edit${unsent === 1 ? '' : 's'}` : '';
  if (status === 'online') setStatus('Connected', 'ok');
  else if (status === 'connecting') setStatus(`Connecting…${pending}`, '');
  else setStatus(`Offline${pending}. Edits are kept and will sync when you reconnect`, 'bad');

  const ready = client.hasSynced; // editing is safe once we have received the history once
  textarea.disabled = !ready;
  offlineToggle.disabled = !ready;
  historyOpen.disabled = status !== 'online';
  offlineToggle.textContent = client.paused ? 'Go online' : 'Simulate offline';
  if (ready && !wasReady) textarea.focus();
  wasReady = ready;
}

function showNotice(message) {
  if (message.type === 'reverted') {
    setStatus(
      message.operations === 0
        ? `Already at version ${message.version}`
        : `Restored version ${message.version}`,
      'ok',
    );
    setTimeout(() => showStatus({ status: client.status, unsent: client.unsentCount }), 3000);
  } else if (message.type === 'error') {
    console.warn('Server error:', message.message);
    setStatus(`Server: ${message.message}`, 'bad');
  }
}

const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
const client = new SyncClient({
  siteId: createSiteId(), // a fresh site ID per page load, so IDs can never collide
  createSocket: () => new WebSocket(`${scheme}://${location.host}`),
  storage: safeSessionStorage(),
  onChange: render,
  onStatus: showStatus,
  onNotice: showNotice,
});
document.querySelector('#site-id').textContent = client.doc.siteId;
client.connect();

// The user typed, pasted or deleted something.
textarea.addEventListener('input', () => {
  client.edit(diffText(client.text, textarea.value));
});

offlineToggle.addEventListener('click', () => {
  if (client.paused) client.goOnline();
  else client.goOffline();
  showStatus({ status: client.status, unsent: client.unsentCount });
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
  if (!client.revert(Number(historySlider.value))) {
    setStatus('Go online to restore a version', 'bad');
  }
  historyPanel.hidden = true;
});

historyClose.addEventListener('click', () => {
  historyPanel.hidden = true;
});