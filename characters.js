// Only a completed, explicit [[reference]] at the caret becomes a character.
// Ordinary names, @mentions and email addresses always remain ordinary text.
(function (root) {
  'use strict';
  function endingToken(text) {
    const match = /(?<![\[\\])\[\[(\p{L}[\p{L}\p{M}\p{N} _.'’-]{0,79})\]\]$/u.exec(text);
    if (!match) return null;
    return { handle: match[1].trim(), start: match.index, end: text.length };
  }
  const api = { endingToken };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NeoCharacters = api;
})(typeof window !== 'undefined' ? window : globalThis);
