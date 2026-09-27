const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const source = app.slice(app.indexOf('async function saveBeforeUpdate()'), app.indexOf('// Only Help → Check for Update…'));

function fixture(write) {
  const calls = [];
  const neo = Object.fromEntries(['writeChapter', 'writeAux', 'writeBookMeta', 'writeJSON', 'writeLibrary'].map((name) => [name, (...args) => {
    calls.push([name, ...args]);
    return write(name, ...args);
  }]));
  const context = vm.createContext({
    window: { neo }, library: { shelves: [] }, book: { id: 'book-1', chapterOrder: ['ch-1', 'ch-2'] },
    chapterHTML: { 'ch-1': 'old', 'ch-2': 'unrendered chapter' },
    currentChapterId: 'ch-1', saveTimers: {}, stickies: [{ text: 'new sticky' }], darlings: [{ text: 'saved paragraph' }],
    clearTimeout, document: { querySelector: (selector) => selector.includes('ch-1') ? {} : null },
    captureBody: () => 'latest words',
    $: (selector) => selector === '#aux-editor' ? { dataset: { kind: 'notes' }, innerHTML: 'latest notes' } : { scrollTop: 123 }
  });
  vm.runInContext(source, context);
  return { context, calls, save: () => vm.runInContext('saveBeforeUpdate()', context) };
}

test('restart save captures current text, notes and metadata and awaits every disk write', async () => {
  const finish = [];
  const f = fixture(() => new Promise((resolve) => finish.push(resolve)));
  let saved = false;
  const pending = f.save().then(() => { saved = true; });
  assert.equal(f.calls.length, 7);
  assert.deepEqual(f.calls[0], ['writeChapter', 'book-1', 'ch-1', 'latest words']);
  assert.deepEqual(f.calls[1], ['writeChapter', 'book-1', 'ch-2', 'unrendered chapter']);
  assert.deepEqual(f.calls[2], ['writeAux', 'book-1', 'notes', 'latest notes']);
  for (const resolve of finish.slice(1)) resolve(true);
  await Promise.resolve();
  assert.equal(saved, false);
  finish[0](true);
  await pending;
  assert.equal(saved, true);
});

test('any failed write rejects the restart save', async () => {
  const f = fixture((name) => name === 'writeChapter' ? Promise.reject(new Error('disk full')) : Promise.resolve(true));
  await assert.rejects(f.save(), /disk full/);
});

test('the bookshelf still awaits the library save', async () => {
  const f = fixture(() => Promise.resolve(true));
  f.context.book = null;
  await f.save();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], 'writeLibrary');
});
