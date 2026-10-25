'use strict';
const assert = require('assert');
const DMC = require('./load')('data-registry.js', 'data-lang.js', 'util.js', 'snbt.js', 'versions.js', 'text.js');
const T = DMC.text;
let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL', name, '\n', e.stack); process.exitCode = 1; } }

t('kindOf', () => {
  assert.strictEqual(T.kindOf('x'), 'text');
  assert.strictEqual(T.kindOf({ translate: 'gui.ok' }), 'translatable');
  assert.strictEqual(T.kindOf({ keybind: 'key.jump' }), 'keybind');
  assert.strictEqual(T.kindOf({ type: 'object', sprite: 'item/diamond' }), 'sprite');
  assert.strictEqual(T.kindOf({ type: 'object', object: 'player', player: { name: 'x' } }), 'head');
  assert.strictEqual(T.kindOf({ nbt: 'a', entity: '@s' }), 'nbt');
  assert.strictEqual(T.kindOf({ score: { name: 'a', objective: 'b' } }), 'score');
});
t('parts round trip', () => {
  assert.deepStrictEqual(T.toParts('hi'), [{ text: 'hi' }]);
  assert.strictEqual(T.fromParts(T.toParts('hi')), 'hi');
  const v = ['', { text: 'a', color: 'red' }, 'b'];
  assert.deepStrictEqual(T.fromParts(T.toParts(v)), ['', { text: 'a', color: 'red' }, 'b']);
  // list with styled first element: first becomes parent, rest are extras (inherit style)
  const p = T.toParts([{ text: 'a', color: 'red' }, 'b']);
  assert.strictEqual(p.length, 1); assert.deepStrictEqual(p[0].extra, ['b']);
  // wrapper unwrap
  assert.strictEqual(T.toParts({ text: '', extra: ['x', 'y'] }).length, 2);
});
t('flatten inherits style', () => {
  const runs = T.flatten([{ text: 'a', color: 'red', bold: true }, 'b', { text: 'c', bold: false }], '26.2');
  assert.deepStrictEqual(runs.map((r) => [r.text, r.style.color, r.style.bold]), [['a', 'red', true], ['b', 'red', true], ['c', 'red', false]]);
});
t('translatable', () => {
  assert.strictEqual(T.plain({ translate: 'gui.ok' }, '26.2'), 'Ok');
  assert.strictEqual(T.plain({ translate: 'options.generic_value', with: ['Volume', 50] }, '26.2'), 'Volume: 50');
  assert.strictEqual(T.plain({ translate: 'no.such.key', fallback: 'Hello %s', with: ['W'] }, '26.2'), 'Hello W');
  assert.strictEqual(T.plain({ translate: 'no.such.key' }, '26.2'), 'no.such.key');
  assert.strictEqual(T.plain({ translate: 'gui.ok', color: 'red', extra: [' !'] }, '26.2'), 'Ok !');
});
t('keybind default names', () => assert.strictEqual(T.plain({ keybind: 'key.jump' }, '26.2'), 'Space'));
t('colors', () => {
  assert.strictEqual(T.colorToCss('gold'), '#FFAA00');
  assert.strictEqual(T.colorToCss('#12abCD'), '#12abCD');
  assert.strictEqual(T.colorToCss('nope'), null);
  assert.strictEqual(T.shadowOf('white'), '#3F3F3F');
  const v = T.argbEncode('#FF0000', 0.5);
  assert.strictEqual(v, (0x80FF0000 | 0));
  const d = T.argbDecode(v); assert.strictEqual(d.r, 255); assert.ok(Math.abs(d.a - 0.502) < 0.01);
  assert.ok(T.argbDecode([1, 0, 0, 1]).r === 255);
});
t('walk visits nested', () => {
  const seen = [];
  T.walk({ text: 'a', extra: [{ text: 'b', hover_event: { action: 'show_text', value: 'c' } }], }, (c, p) => seen.push(p));
  assert.deepStrictEqual(seen, ['', 'extra.0', 'extra.0.hover_event.value']);
});
t('isEmpty', () => { assert.ok(T.isEmpty('')); assert.ok(T.isEmpty({ text: '' })); assert.ok(!T.isEmpty('x')); assert.ok(!T.isEmpty({ translate: 'a' })); });
console.log('text tests passed:', n);
