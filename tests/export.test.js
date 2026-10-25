'use strict';
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const DMC = require('./load')('data-registry.js', 'data-commands.js', 'data-lang.js', 'util.js', 'snbt.js', 'versions.js', 'text.js', 'schema.js', 'commands.js', 'validate.js', 'export.js');
const X = DMC.exp;
let n = 0, failed = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.stack); process.exitCode = 1; } }

const d = {
  after_action: 'close', pause: true, actions: [{ action: { command: 'trigger a', type: 'run_command' }, label: 'Go', width: 100 }, { label: { color: 'red', text: 'No' } }],
  title: { color: 'gold', text: 'Shop', extra: ['x'] }, type: 'multi_action', exit_action: { label: { translate: 'gui.back' } },
  body: [{ contents: 'Hello', type: 'plain_message' }],
  inputs: [],
};
t('canonical ordering + prefixes', () => {
  const c = X.canonical(d);
  assert.deepStrictEqual(Object.keys(c), ['type', 'title', 'body', 'pause', 'after_action', 'actions', 'exit_action']);
  assert.strictEqual(c.type, 'minecraft:multi_action');
  assert.strictEqual(c.body.type, 'minecraft:plain_message');       // single body -> object
  assert.strictEqual(c.actions[0].action.type, 'minecraft:run_command');
  assert.deepStrictEqual(Object.keys(c.actions[0]), ['label', 'width', 'action']);
  assert.deepStrictEqual(Object.keys(c.title), ['text', 'color', 'extra']);
  assert.ok(!('inputs' in c));
});
t('click_event actions stay unprefixed', () => {
  const c = X.canonical({ type: 'notice', title: { text: 'x', click_event: { command: 'a', action: 'run_command' } } });
  assert.deepStrictEqual(c.title.click_event, { action: 'run_command', command: 'a' });
});
t('json round trip', () => {
  const c = X.canonical(d);
  assert.deepStrictEqual(JSON.parse(X.json(d)), c);
});
t('snbt command', () => {
  const cmd = X.command({ type: 'notice', title: 'Hi' }, '@s');
  assert.strictEqual(cmd, '/dialog show @s {type:"minecraft:notice",title:"Hi"}');
  assert.strictEqual(X.command({ type: 'notice', title: 'Hi' }, '@a', { slash: false }), 'dialog show @a {type:"minecraft:notice",title:"Hi"}');
  // the generated command must pass the command validator
  const full = X.command(d, '@s');
  const r = DMC.cmd.validate(full, '26.2'); assert.ok(r.ok, JSON.stringify(r.errors));
  assert.strictEqual(r.level, 2);
  // snbt parses back to the same structure
  const body = full.replace(/^\/dialog show @s /, '');
  assert.deepStrictEqual(DMC.snbt.parse(body).value, X.canonical(d));
});
t('tellraw opener validates', () => {
  const c = X.tellraw('mypack:main', '[Menu]');
  assert.ok(DMC.cmd.validate(c, '26.2').ok, c);
});
const project = {
  version: '26.2', pack: { namespace: 'mypack', description: 'Test pack' },
  dialogs: [
    { id: 'main', dialog: { type: 'notice', title: 'A' }, tags: { pause: true, quick: false, extra: ['mypack:menus'] } },
    { id: 'menu/sub', dialog: { type: 'notice', title: 'B' }, tags: { quick: true } },
  ],
};
t('datapack files', () => {
  const files = X.datapackFiles(project, { functions: true });
  const paths = files.map((f) => f.path).sort();
  assert.deepStrictEqual(paths, [
    'data/minecraft/tags/dialog/pause_screen_additions.json', 'data/minecraft/tags/dialog/quick_actions.json',
    'data/mypack/dialog/main.json', 'data/mypack/dialog/menu/sub.json',
    'data/mypack/function/show/main.mcfunction', 'data/mypack/function/show/menu/sub.mcfunction',
    'data/mypack/tags/dialog/menus.json', 'pack.mcmeta',
  ].sort());
  const mc = JSON.parse(files.find((f) => f.path === 'pack.mcmeta').data);
  assert.deepStrictEqual(mc.pack.min_format, [107, 1]); assert.deepStrictEqual(mc.pack.max_format, [107, 1]);
  const p2 = Object.assign({}, project, { version: '1.21.11' });
  const mc2 = JSON.parse(X.datapackFiles(p2).find((f) => f.path === 'pack.mcmeta').data);
  assert.deepStrictEqual(mc2.pack.min_format, [94, 1]);
  const p3 = Object.assign({}, project, { pack: Object.assign({}, project.pack, { range: true }) });
  const mc3 = JSON.parse(X.datapackFiles(p3).find((f) => f.path === 'pack.mcmeta').data);
  assert.deepStrictEqual([mc3.pack.min_format, mc3.pack.max_format], [[94, 1], [107, 1]]);
  const tag = JSON.parse(files.find((f) => f.path.endsWith('pause_screen_additions.json')).data);
  assert.deepStrictEqual(tag, { values: ['mypack:main'] });
});
t('zip is valid (python zipfile + unzip -t)', () => {
  const files = X.datapackFiles(project).concat([{ path: 'unicode/ünï.txt', data: 'héllo ✓' }]);
  const zip = X.zip(files);
  const f = path.join(os.tmpdir(), 'dmc-test.zip');
  fs.writeFileSync(f, Buffer.from(zip));
  const out = execFileSync('python3', ['-c', `
import zipfile,sys
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
names=sorted(z.namelist()); print('|'.join(names))
assert z.read('data/mypack/dialog/main.json').decode().strip().startswith('{')
assert z.read('unicode/ünï.txt').decode()=='héllo ✓'
`, f]).toString().trim();
  assert.ok(out.includes('pack.mcmeta') && out.includes('data/mypack/dialog/menu/sub.json'));
  try { execFileSync('unzip', ['-tq', f]); } catch (e) { if (e.code !== 'ENOENT') throw e; }
});
t('import', () => {
  let r = X.importText('{"type":"minecraft:notice","title":"x"}'); assert.ok(r.ok && r.dialog.title === 'x' && r.source === 'json');
  r = X.importText('/dialog show @s {type:"minecraft:notice",title:"x"}'); assert.ok(r.ok && r.dialog.type === 'minecraft:notice' && r.source === 'command');
  r = X.importText('dialog show @a[limit=1,sort=nearest] {type:"minecraft:notice",title:"x"}'); assert.ok(r.ok && r.dialog.title === 'x');
  r = X.importText('/dialog show @s mypack:main'); assert.ok(r.ok && r.id === 'mypack:main');
  r = X.importText('{type:"minecraft:notice",title:"x"}'); assert.ok(r.ok && r.source === 'snbt');
  r = X.importText('{oops'); assert.ok(!r.ok);
  r = X.importText('[1,2]'); assert.ok(!r.ok);
});
console.log(`export tests passed: ${n}, failed: ${failed}`);
