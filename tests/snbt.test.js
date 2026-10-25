'use strict';
const assert = require('assert');
const DMC = require('./load')('snbt.js');
const S = DMC.snbt;
let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL', name, '\n', e.message); process.exitCode = 1; } }

t('stringify basics', () => {
  assert.strictEqual(S.stringify({ type: 'minecraft:notice', title: 'Hi', n: 3, f: 1.5, b: true, a: [1, 'x'] }),
    '{type:"minecraft:notice",title:"Hi",n:3,f:1.5,b:true,a:[1,"x"]}');
});
t('stringify quotes keys with colon', () => {
  assert.strictEqual(S.stringify({ 'minecraft:custom_name': 'a' }), '{"minecraft:custom_name":"a"}');
});
t('quote choice', () => {
  assert.strictEqual(S.quote('say "hi"'), `'say "hi"'`);
  assert.strictEqual(S.quote("it's"), `"it's"`);
  assert.strictEqual(S.quote('a\\b\n'), '"a\\\\b\\n"');
});
t('long ints get L', () => assert.strictEqual(S.stringify(3000000000), '3000000000L'));
t('parse compound', () => {
  const r = S.parse('{a:1,b:"x",c:[1,2,3],d:{e:true}, f:1.5f, g:3b, h:\'q"q\'}');
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(r.value, { a: 1, b: 'x', c: [1, 2, 3], d: { e: true }, f: 1.5, g: 3, h: 'q"q' });
});
t('parse json', () => {
  const r = S.parseLoose('{"type":"minecraft:notice","title":{"text":"x"}}');
  assert.ok(r.ok); assert.strictEqual(r.format, 'json');
});
t('parse typed arrays', () => {
  const r = S.parse('{u:[I;1,-2,3,4], b:[B;1b,2b]}');
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(r.value, { u: [1, -2, 3, 4], b: [1, 2] });
});
t('parse errors have positions', () => {
  const r = S.parse('{a:1,,}');
  assert.ok(!r.ok); assert.ok(typeof r.error.pos === 'number');
  assert.ok(!S.parse('{a:minecraft:stone}').ok);
  assert.ok(!S.parse('{a:1').ok);
  assert.ok(!S.parse('"abc').ok);
  assert.ok(!S.parse('[1,2').ok);
});
t('parse trailing comma tolerated', () => assert.ok(S.parse('[1,2,]').ok && S.parse('{a:1,}').ok));
t('numbers', () => {
  assert.strictEqual(S.parse('0x1F').value, 31);
  assert.strictEqual(S.parse('1e3').value, 1000);
  assert.strictEqual(S.parse('-5s').value, -5);
  assert.strictEqual(S.parse('1_000').value, 1000);
  assert.strictEqual(S.parse('.5').value, 0.5);
  assert.strictEqual(S.parse('1.21.11').value, '1.21.11');
});
t('roundtrip', () => {
  const o = { a: [{ text: 'hi', color: 'red', extra: ['x', { text: 'y' }] }], 'b:c': "it's \"q\"", n: -3.25 };
  const r = S.parse(S.stringify(o));
  assert.ok(r.ok, JSON.stringify(r)); assert.deepStrictEqual(r.value, o);
});
t('partial', () => {
  const r = S.parse('{a:1} rest', { partial: true });
  assert.ok(r.ok); assert.strictEqual(r.end, 5);
});
console.log('snbt tests passed:', n);
