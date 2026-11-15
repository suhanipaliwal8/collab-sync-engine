import { SyncClient } from './client/sync-client.js';
import {
  diffText,
  adjustCaret,
  utf16ToCodePointIndex,
  codePointToUtf16Index,
} from './client/text-diff.js';
import { createSiteId } from './client/site-id.js';
import { lineAndColumn, peerColor } from './client/presence.js';
import { throttle } from './client/throttle.js';

const textarea = document.querySelector('#editor');
const statusLabel = document.querySelector('#status');
const offlineToggle = document.querySelector('#offline-toggle');
const peerList = document.querySelector('#peer-list');
const displayNameInput = document.querySelector('#display-name');

// Which document to open, and the optional access token, come from the page URL:
//   http://localhost:8080/?doc=notes&token=secret
const pageParams = new URLSearchParams(location.search);
const documentId = pageParams.get('doc') || 'default';
const accessToken = pageParams.get('token');

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
  statusLabel.className = kind ? `pill ${kind}` : 'pill';
}

function safeStorage(kind) {
  try {
    return window[kind];
  } catch {
    return null; // storage can be blocked by browser privacy settings
  }
}

// ---------- Your display name ----------

const siteId = createSiteId(); // a fresh site ID per page load, so IDs can never collide
const savedName = safeStorage('localStorage')?.getItem('collab-name');
displayNameInput.value = savedName || `Guest-${siteId.slice(2, 6)}`;

function currentName() {
  return displayNameInput.value.trim() || `Guest-${siteId.slice(2, 6)}`;
}

// ---------- The document ----------

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

// ---------- Who is here ----------

function renderPeers() {
  peerList.replaceChildren();

  const addNote = (text) => {
    const item = document.createElement('li');
    item.className = 'empty';
    item.textContent = text;
    peerList.append(item);
  };

  if (client.status !== 'online') {
    addNote('Presence is unavailable while offline');
    return;
  }

  const peers = client.peers;
  if (peers.length === 0) {
    addNote('Nobody else is here');
    return;
  }

  const text = client.text;
  for (const peer of peers) {
    let where = 'no cursor yet';
    if (peer.start !== null) {
      const { line, column } = lineAndColumn(text, peer.start);
      const selected = peer.end === null ? 0 : Math.abs(peer.end - peer.start);
      where = selected > 0 ? `selecting ${selected} characters (line ${line})` : `line ${line}, column ${column}`;
    }

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = peerColor(peer.id);

    const label = document.createElement('span');
    label.textContent = `${peer.name} · ${where}`; // textContent: names come from other people

    const item = document.createElement('li');
    item.append(dot, label);
    peerList.append(item);
  }
}

// Tell the others where our cursor is (at most 10 times per second).
function sendMyPresence() {
  const start = utf16ToCodePointIndex(textarea.value, textarea.selectionStart);
  const end = utf16ToCodePointIndex(textarea.value, textarea.selectionEnd);
  client.updatePresence({ name: currentName(), start, end });
}
const sendMyPresenceSoon = throttle(sendMyPresence, 100);

// ---------- Connection status ----------

let wasReady = false;

function showStatus({ status, unsent }) {
  const pending = unsent > 0 ? ` · ${unsent} unsent edit${unsent === 1 ? '' : 's'}` : '';
  if (status === 'online') setStatus('Connected', 'ok');
  else if (status === 'connecting') setStatus(`Connecting…${pending}`, '');
  else if (!client.hasSynced) {
    setStatus('Cannot connect. Is the server running? If access control is on, add ?token=… to the URL', 'bad');
  } else {
    setStatus(`Offline${pending}. Edits are kept and will sync when you reconnect`, 'bad');
  }

  const ready = client.hasSynced; // editing is safe once we have received the history once
  textarea.disabled = !ready;
  offlineToggle.disabled = !ready;
  historyOpen.disabled = status !== 'online';
  offlineToggle.textContent = client.paused ? 'Go online' : 'Simulate offline';
  offlineToggle.classList.toggle('warn', client.paused);
  if (ready && !wasReady) textarea.focus();
  wasReady = ready;

  renderPeers();
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
  siteId,
  createSocket: () => {
    const query = new URLSearchParams({ doc: documentId });
    if (accessToken) query.set('token', accessToken);
    return new WebSocket(`${scheme}://${location.host}/?${query}`);
  },
  storage: safeStorage('sessionStorage'),
  storageKey: `collab-outbox:${documentId}`, // one outbox per document
  onChange: () => {
    render();
    renderPeers(); // remote cursors move when the text changes
  },
  onStatus: showStatus,
  onNotice: showNotice,
  onPresence: renderPeers,
});
document.querySelector('#site-id').textContent = siteId;
client.connect();

// ---------- Typing, cursor and name ----------

// The user typed, pasted or deleted something.
textarea.addEventListener('input', () => {
  client.edit(diffText(client.text, textarea.value));
  sendMyPresenceSoon();
});

for (const eventName of ['keyup', 'click', 'focus']) {
  textarea.addEventListener(eventName, sendMyPresenceSoon);
}
document.addEventListener('selectionchange', () => {
  if (document.activeElement === textarea) sendMyPresenceSoon();
});

displayNameInput.addEventListener('change', () => {
  safeStorage('localStorage')?.setItem('collab-name', currentName());
  sendMyPresence();
});

offlineToggle.addEventListener('click', () => {
  if (client.paused) client.goOnline();
  else client.goOffline();
  showStatus({ status: client.status, unsent: client.unsentCount });
});

// ---------- History panel (time travel) ----------

async function fetchJson(path) {
  const url = new URL(path, location.origin);
  url.searchParams.set('doc', documentId);
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const response = await fetch(url, { headers });
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

// ---------- Switching documents ----------

document.querySelector('#doc-name').value = documentId;
document.querySelector('#doc-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const next = new URLSearchParams(location.search);
  next.set('doc', document.querySelector('#doc-name').value);
  location.search = next.toString(); // reloads the page on the other document (token is kept)
});