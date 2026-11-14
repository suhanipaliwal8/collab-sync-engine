// Pure functions (no browser needed) that connect a text box to the CRDT.
// All indexes are in code points (whole characters; an emoji counts as 1).

// Describes what changed between two texts:
// { index, removed: [chars], inserted: [chars] }
export function diffText(oldText, newText) {
  const a = Array.from(oldText);
  const b = Array.from(newText);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  return { index: start, removed: a.slice(start, endA), inserted: b.slice(start, endB) };
}

// Turns a text change into CRDT operations on the document.
// Returns the operations so the caller can send them to the server.
export function applyChangeToDocument(doc, { index, removed, inserted }) {
  const ops = [];
  for (let i = 0; i < removed.length; i++) {
    ops.push(doc.localDelete(index)); // the text shifts left, so the index stays the same
  }
  inserted.forEach((char, i) => {
    ops.push(doc.localInsert(index + i, char));
  });
  return ops;
}

// Where should the caret go after the text changed underneath it?
export function adjustCaret(caret, change) {
  const removedEnd = change.index + change.removed.length;
  if (caret <= change.index) return caret;
  if (caret >= removedEnd) return caret + change.inserted.length - change.removed.length;
  return change.index + change.inserted.length; // caret was inside replaced text
}

// Browsers report positions in UTF-16 units; the document counts code points.
export function utf16ToCodePointIndex(text, utf16Index) {
  return Array.from(text.slice(0, utf16Index)).length;
}

export function codePointToUtf16Index(text, codePointIndex) {
  return Array.from(text).slice(0, codePointIndex).join('').length;
}