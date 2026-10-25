'use strict';
const assert = require('assert');
const DMC = require('./load')('data-registry.js', 'data-commands.js', 'data-lang.js', 'util.js', 'snbt.js', 'versions.js', 'text.js', 'schema.js', 'commands.js', 'validate.js');
const V = DMC.validate;
let n = 0, failed = 0;
function run(d, ver = '26.2', opts) { return V.dialog(d, Object.assign({ ver, dialogIds: ['mypack:main', 'mypack:menu/sub'], tagIds: ['#mypack:menus'] }, opts || {})).issues; }
function find(issues, level, pathRe, msgRe) {
  return issues.filter((i) => i.level === level && (!pathRe || pathRe.test(i.path)) && (!msgRe || msgRe.test(i.msg)));
}
function t(name, fn) { try { fn(); n++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', e.message); process.exitCode = 1; } }
function noErrors(issues, what) {
  const errs = issues.filter((i) => i.level === 'error');
  assert.strictEqual(errs.length, 0, (what || '') + ' unexpected errors: ' + JSON.stringify(errs.map((e) => e.path + ': ' + e.msg)));
}
function noWarns(issues, what) {
  const w = issues.filter((i) => i.level !== 'info');
  assert.strictEqual(w.length, 0, (what || '') + ' unexpected issues: ' + JSON.stringify(w.map((e) => e.level + ' ' + e.path + ': ' + e.msg)));
}
const notice = (extra) => Object.assign({ type: 'minecraft:notice', title: 'Hi', body: [{ type: 'minecraft:plain_message', contents: 'Hello' }] }, extra || {});

t('minimal notice is clean', () => noWarns(run(notice())));
t('type without namespace accepted', () => noErrors(run(notice({ type: 'notice' }))));
t('missing title', () => { const i = run({ type: 'minecraft:notice' }); assert.ok(find(i, 'error', /^title$/).length); });
t('missing type', () => { const i = run({ title: 'x' }); assert.ok(find(i, 'error', /^type$/).length); });
t('unknown type has suggestion', () => { const i = run({ type: 'minecraft:notise', title: 'x' }); assert.ok(find(i, 'error', /^type$/, /notice/).length); });
t('unknown field warns with suggestion', () => { const i = run(notice({ can_close_with_esc: false })); assert.ok(find(i, 'warn', /can_close_with_esc/, /can_close_with_escape/).length); });
t('after_action none needs pause false', () => {
  const i = run(notice({ after_action: 'none' })); assert.ok(find(i, 'error', /after_action/, /pause/).length);
  noErrors(run(notice({ after_action: 'none', pause: false })));
});
t('esc trap', () => { const i = run(notice({ after_action: 'none', pause: false, can_close_with_escape: false })); assert.ok(find(i, 'warn', /can_close/).length); });
t('confirmation needs yes/no', () => {
  const i = run({ type: 'minecraft:confirmation', title: 'x' });
  assert.ok(find(i, 'error', /^yes$/).length && find(i, 'error', /^no$/).length);
  noErrors(run({ type: 'minecraft:confirmation', title: 'x', yes: { label: 'Y' }, no: { label: 'N' } }));
});
t('multi_action needs actions', () => {
  assert.ok(find(run({ type: 'minecraft:multi_action', title: 'x', actions: [] }), 'error', /^actions$/).length);
  const i = run({ type: 'minecraft:multi_action', title: 'x', actions: [{ label: 'a' }], columns: 0 });
  assert.ok(find(i, 'error', /^columns$/).length);
});
t('button width range', () => {
  const i = run({ type: 'minecraft:multi_action', title: 'x', actions: [{ label: 'a', width: 5000 }] });
  assert.ok(find(i, 'error', /actions\.0\.width/).length);
});
t('dialog_list forms', () => {
  noErrors(run({ type: 'minecraft:dialog_list', title: 'x', dialogs: '#minecraft:pause_screen_additions' }));
  noErrors(run({ type: 'minecraft:dialog_list', title: 'x', dialogs: ['mypack:main', { type: 'minecraft:notice', title: 'inline' }] }));
  assert.ok(find(run({ type: 'minecraft:dialog_list', title: 'x', dialogs: ['#mypack:menus'] }), 'error', /dialogs\.0/, /Tags can only/).length);
  assert.ok(find(run({ type: 'minecraft:dialog_list', title: 'x' }), 'error', /dialogs/).length);
  assert.ok(find(run({ type: 'minecraft:dialog_list', title: 'x', dialogs: 'other:thing' }), 'warn', /dialogs/, /isn't in this project/).length);
});
t('server_links info', () => { const i = run({ type: 'minecraft:server_links', title: 'x' }); noErrors(i); assert.ok(find(i, 'info', null, /vanilla server/).length); });

// actions
const withAction = (action, ver) => run({ type: 'minecraft:multi_action', title: 'x', actions: [{ label: 'b', action }] }, ver);
t('run_command signed', () => { const i = withAction({ type: 'minecraft:run_command', command: 'say hi' }); assert.ok(find(i, 'error', /command$/, /chat message/).length); });
t('run_command invalid', () => { const i = withAction({ type: 'minecraft:run_command', command: 'gve @s diamond' }); assert.ok(find(i, 'error', /command$/, /Invalid command.*give/).length); });
t('run_command level warn', () => { const i = withAction({ type: 'minecraft:run_command', command: 'give @s diamond' }); noErrors(i); assert.ok(find(i, 'warn', /command$/, /level 2/).length); });
t('run_command trigger is clean', () => { const i = withAction({ type: 'minecraft:run_command', command: 'trigger open' }); noErrors(i); assert.strictEqual(find(i, 'warn').length, 0); });
t('run_command leading slash ok', () => noErrors(withAction({ type: 'minecraft:run_command', command: '/trigger open' })));
t('run_command newline', () => assert.ok(find(withAction({ type: 'minecraft:run_command', command: 'trigger a\nb' }), 'error', /command$/, /line break/).length));
t('suggest_command', () => {
  noErrors(withAction({ type: 'minecraft:suggest_command', command: '/msg ' }));
  assert.ok(find(withAction({ type: 'minecraft:suggest_command', command: '/nope x' }), 'warn', /command$/).length);
  assert.ok(find(withAction({ type: 'minecraft:suggest_command', command: 'hello' }), 'info', /command$/, /chat message/).length);
});
t('open_url', () => {
  noErrors(withAction({ type: 'minecraft:open_url', url: 'https://example.com/a?b=1' }));
  const i = withAction({ type: 'minecraft:open_url', url: 'example.com' }); assert.ok(find(i, 'error', /url$/).length); assert.ok(i.find((x) => x.fix));
  assert.ok(find(withAction({ type: 'minecraft:open_url', url: 'ftp://example.com' }), 'error', /url$/).length);
});
t('show_dialog', () => {
  noErrors(withAction({ type: 'minecraft:show_dialog', dialog: 'mypack:main' }));
  assert.ok(find(withAction({ type: 'minecraft:show_dialog', dialog: 'mypack:missing' }), 'warn', /dialog$/).length);
  assert.ok(find(withAction({ type: 'minecraft:show_dialog', dialog: '#mypack:menus' }), 'error', /dialog$/).length);
  const inline = withAction({ type: 'minecraft:show_dialog', dialog: { type: 'minecraft:notice' } });
  assert.ok(find(inline, 'error', /actions\.0\.action\.dialog\.title/).length);
});
t('custom actions warn', () => {
  const i = withAction({ type: 'minecraft:custom', id: 'mypack:evt', payload: { a: 1 } }); noErrors(i); assert.ok(find(i, 'warn', null, /vanilla servers/).length);
  assert.ok(find(withAction({ type: 'minecraft:custom' }), 'error', /id$/).length);
});
t('change_page warns', () => assert.ok(find(withAction({ type: 'minecraft:change_page', page: 1 }), 'warn', null, /written books/).length));
t('unknown action', () => assert.ok(find(withAction({ type: 'minecraft:run_comand', command: 'x' }), 'error', /type$/, /run_command/).length));
t('copy_to_clipboard', () => { noErrors(withAction({ type: 'minecraft:copy_to_clipboard', value: 'x' })); assert.ok(find(withAction({ type: 'minecraft:copy_to_clipboard' }), 'error', /value$/).length); });

// inputs & templates
const inputsDialog = (inputs, action) => ({ type: 'minecraft:multi_action', title: 'x', inputs, actions: [{ label: 'go', action }] });
t('template with slider ok (level warn)', () => {
  const d = inputsDialog([{ type: 'minecraft:number_range', key: 'amount', label: 'Amount', start: 1, end: 64, step: 1, initial: 5 }], { type: 'minecraft:dynamic/run_command', template: 'give @s diamond $(amount)' });
  const i = run(d); noErrors(i); assert.ok(find(i, 'warn', /template/, /level 2/).length);
});
t('template unknown key', () => {
  const d = inputsDialog([{ type: 'minecraft:text', key: 'a', label: 'A' }], { type: 'minecraft:dynamic/run_command', template: 'trigger $(b)' });
  assert.ok(find(run(d), 'error', /template/, /\$\(b\)/).length);
});
t('template bad macro', () => {
  const d = inputsDialog([{ type: 'minecraft:text', key: 'a', label: 'A' }], { type: 'minecraft:dynamic/run_command', template: 'trigger $(a' });
  assert.ok(find(run(d), 'error', /template/, /closing/).length);
});
t('template with text in numeric slot -> warn', () => {
  const d = inputsDialog([{ type: 'minecraft:text', key: 'n', label: 'N' }], { type: 'minecraft:dynamic/run_command', template: 'give @s diamond $(n)' });
  const i = run(d); assert.ok(find(i, 'warn', /template/, /Expected integer|Invalid integer/).length, JSON.stringify(i));
});
t('template with options simulated', () => {
  const d = inputsDialog([{ type: 'minecraft:single_option', key: 'm', label: 'Mode', options: ['survival', 'creative', 'flying'] }], { type: 'minecraft:dynamic/run_command', template: 'gamemode $(m)' });
  assert.ok(find(run(d), 'error', /template/, /flying/).length);
});
t('boolean toggle template', () => {
  const d = inputsDialog([{ type: 'minecraft:boolean', key: 'v', label: 'V', on_true: 'true', on_false: 'false' }], { type: 'minecraft:dynamic/run_command', template: 'gamerule keep_inventory $(v)' });
  noErrors(run(d));
});
t('signed template', () => {
  const d = inputsDialog([{ type: 'minecraft:text', key: 'msg', label: 'M' }], { type: 'minecraft:dynamic/run_command', template: 'say $(msg)' });
  assert.ok(find(run(d), 'error', /template/, /chat message/).length);
});
t('inputs never sent', () => {
  const d = inputsDialog([{ type: 'minecraft:text', key: 'a', label: 'A' }], { type: 'minecraft:run_command', command: 'trigger x' });
  assert.ok(find(run(d), 'warn', /^inputs$/, /never sent/).length);
});
t('dynamic without inputs', () => {
  const d = { type: 'minecraft:notice', title: 'x', action: { label: 'go', action: { type: 'minecraft:dynamic/custom', id: 'a:b' } } };
  assert.ok(find(run(d), 'warn', null, /no inputs/).length);
});
t('input key rules', () => {
  const d = inputsDialog([{ type: 'minecraft:text', key: 'bad key', label: 'A' }, { type: 'minecraft:text', key: 'a', label: 'A' }, { type: 'minecraft:text', key: 'a', label: 'B' }], { type: 'minecraft:dynamic/custom', id: 'a:b' });
  const i = run(d);
  assert.ok(find(i, 'error', /inputs\.0\.key/).length); assert.ok(find(i, 'error', /inputs\.2\.key/, /Duplicate/).length);
});
t('number_range rules', () => {
  const d = (x) => inputsDialog([Object.assign({ type: 'minecraft:number_range', key: 'a', label: 'A', start: 0, end: 10 }, x)], { type: 'minecraft:dynamic/custom', id: 'a:b' });
  assert.ok(find(run(d({ initial: 50 })), 'error', /initial/).length);
  assert.ok(find(run(d({ step: 0 })), 'error', /step/).length);
  assert.ok(find(run(d({ start: undefined })), 'error', /start/).length);
  assert.ok(find(run(d({ label_format: 'my.fmt' })), 'warn', /label_format/).length);
  noErrors(run(d({ initial: 5, step: 1, label_format: 'options.generic_value' })));
});
t('single_option rules', () => {
  const d = (options) => inputsDialog([{ type: 'minecraft:single_option', key: 'a', label: 'A', options }], { type: 'minecraft:dynamic/custom', id: 'a:b' });
  assert.ok(find(run(d([])), 'error', /options/).length);
  assert.ok(find(run(d([{ id: 'a', initial: true }, { id: 'b', initial: true }])), 'error', /options/, /initial/).length);
  noErrors(run(d(['a', { id: 'b', display: 'B' }])));
});
t('text input rules', () => {
  const d = (x) => inputsDialog([Object.assign({ type: 'minecraft:text', key: 'a', label: 'A' }, x)], { type: 'minecraft:dynamic/custom', id: 'a:b' });
  assert.ok(find(run(d({ max_length: 0 })), 'error', /max_length/).length);
  assert.ok(find(run(d({ initial: 'a'.repeat(40) })), 'warn', /initial/).length);
  assert.ok(find(run(d({ multiline: { height: 9999 } })), 'error', /multiline\.height/).length);
});

// body items
const itemDialog = (item, ver) => run({ type: 'minecraft:notice', title: 'x', body: [{ type: 'minecraft:item', item }] }, ver);
t('item ok', () => noErrors(itemDialog({ id: 'minecraft:diamond', count: 3, components: { 'minecraft:custom_name': 'Hi', 'minecraft:enchantment_glint_override': true } })));
t('item unknown id', () => { const i = itemDialog({ id: 'minecraft:diamnd' }); assert.ok(find(i, 'error', /item\.id/, /Unknown item/).length); assert.ok(i.find((x) => x.fix)); });
t('item air', () => assert.ok(find(itemDialog({ id: 'minecraft:air' }), 'error', /item\.id/).length));
t('item count over stack size', () => assert.ok(find(itemDialog({ id: 'minecraft:ender_pearl', count: 20 }), 'error', /count/, /maximum stack size \(16\)/).length));
t('item count range', () => assert.ok(find(itemDialog({ id: 'minecraft:stone', count: 100 }), 'error', /count/).length));
t('item string form by version', () => {
  assert.ok(find(itemDialog('minecraft:diamond', '1.21.11'), 'error', /^body\.0\.item$/, /object/).length);
  noErrors(itemDialog('minecraft:diamond', '26.2'));
});
t('item newer than version', () => assert.ok(find(itemDialog({ id: 'minecraft:cinnabar' }, '1.21.11'), 'error', /item\.id/, /added in 26\.2/).length));
t('item components', () => {
  assert.ok(find(itemDialog({ id: 'minecraft:stone', components: { 'minecraft:nope': 1 } }), 'error', /components/).length);
  assert.ok(find(itemDialog({ id: 'minecraft:stone', components: { 'minecraft:damage': -1 } }), 'error', /damage/).length);
  noErrors(itemDialog({ id: 'minecraft:stone', components: { '!minecraft:lore': {} } }));
});
t('item body options', () => {
  const i = run({ type: 'minecraft:notice', title: 'x', body: { type: 'minecraft:item', item: { id: 'minecraft:stone' }, width: 999, show_decoration: false } });
  assert.ok(find(i, 'error', /width/).length); assert.ok(find(i, 'warn', /show_decoration/).length);
});
t('plain message', () => {
  assert.ok(find(run({ type: 'minecraft:notice', title: 'x', body: [{ type: 'minecraft:plain_message' }] }), 'error', /contents/).length);
  assert.ok(find(run({ type: 'minecraft:notice', title: 'x', body: [{ type: 'minecraft:nope' }] }), 'error', /type/).length);
  assert.ok(find(run({ type: 'minecraft:notice', title: 'x', body: [{ type: 'minecraft:plain_message', contents: 'a', width: 0 }] }), 'error', /width/).length);
});

// text components
const titled = (title, ver) => run({ type: 'minecraft:notice', title }, ver);
t('text ok variants', () => {
  noErrors(titled({ text: 'Hello', color: 'gold', bold: true, extra: [{ text: 'x', color: '#ff00aa' }] }));
  noErrors(titled(['', { text: 'a' }, { translate: 'gui.ok' }]));
  noErrors(titled({ translate: 'options.generic_value', with: ['a', 'b'] }));
});
t('text invalid color', () => { const i = titled({ text: 'x', color: 'golden' }); assert.ok(find(i, 'error', /title\.color/, /gold/).length); });
t('text empty extra / list', () => {
  assert.ok(find(titled({ text: 'x', extra: [] }), 'error', /extra/).length);
  assert.ok(find(titled([]), 'error', /^title$/).length);
});
t('text unknown component', () => assert.ok(find(titled({ colour: 'red' }), 'error', /^title$/, /Unrecognized/).length));
t('translate unknown key warns', () => {
  assert.ok(find(titled({ translate: 'my.custom.key' }), 'warn', /translate/).length);
  assert.strictEqual(find(titled({ translate: 'my.custom.key', fallback: 'Hi' }), 'warn', /translate/).length, 0);
});
t('translate arg count', () => assert.ok(find(titled({ translate: 'options.generic_value', with: ['a'] }), 'warn', /with/).length));
t('keybind version', () => {
  noErrors(titled({ keybind: 'key.jump' }));
  assert.ok(find(titled({ keybind: 'key.friends' }, '1.21.11'), 'warn', /keybind/, /added in 26\.2/).length);
  assert.strictEqual(find(titled({ keybind: 'key.friends' }, '26.2'), 'warn', /keybind/).length, 0);
  assert.ok(find(titled({ keybind: 'key.jumpp' }), 'warn', /keybind/, /key\.jump/).length);
});
t('unresolved components warn', () => {
  assert.ok(find(titled({ score: { name: '@p', objective: 'x' } }), 'warn', /score/, /aren't resolved/).length);
  assert.ok(find(titled({ selector: '@p' }), 'warn', /selector/).length);
  assert.ok(find(titled({ nbt: 'Health', entity: '@s' }), 'warn', /nbt/).length);
  assert.ok(find(titled({ selector: '@x' }), 'error', /selector/).length);
  assert.ok(find(titled({ nbt: 'a..b', entity: '@s' }), 'error', /nbt/).length);
});
t('sprite and head', () => {
  noErrors(titled(['', { type: 'object', object: 'atlas', sprite: 'item/diamond' }, { type: 'object', object: 'player', player: { name: 'Steve' }, hat: true }]));
  assert.ok(find(titled({ type: 'object', object: 'atlas' }), 'error', /sprite/).length);
  assert.ok(find(titled({ type: 'object', object: 'player', player: { name: 'Way Too Long Player Name' } }), 'error', /player\.name/).length);
  assert.ok(find(titled({ type: 'object', object: 'atlas', sprite: 'item/diamond', fallback: 'x' }, '1.21.11'), 'warn', /fallback/, /26\.1/).length);
  assert.strictEqual(find(titled({ type: 'object', object: 'atlas', sprite: 'item/diamond', fallback: 'x' }, '26.2'), 'warn', /fallback/).length, 0);
});
t('nbt plain version', () => {
  assert.ok(find(titled({ nbt: 'a', storage: 'a:b', plain: true }, '1.21.11'), 'warn', /plain/, /26\.1/).length);
});
t('font + shadow + insertion', () => {
  assert.ok(find(titled({ text: 'x', font: 'minecraft:nope' }), 'warn', /font/).length);
  noErrors(titled({ text: 'x', font: 'minecraft:uniform', shadow_color: -16777216 }));
  assert.ok(find(titled({ text: 'x', shadow_color: 'red' }), 'error', /shadow_color/).length);
  assert.ok(find(titled({ text: 'x', insertion: 'y' }), 'info', /insertion/).length);
});
t('click/hover in text', () => {
  noErrors(titled({ text: 'x', click_event: { action: 'run_command', command: 'trigger a' }, hover_event: { action: 'show_text', value: 'tip' } }));
  assert.ok(find(titled({ text: 'x', click_event: { action: 'run_command', command: 'say hi' } }), 'error', /click_event\.command/).length);
  assert.ok(find(titled({ text: 'x', click_event: { action: 'minecraft:open_url', url: 'https://a.bc' } }), 'error', /click_event\.action/, /namespace/).length);
  assert.ok(find(titled({ text: 'x', click_event: { action: 'dynamic/run_command', template: 'x' } }), 'error', /click_event\.action/).length);
  assert.ok(find(titled({ text: 'x', clickEvent: { action: 'open_url', value: 'x' } }), 'warn', /clickEvent/, /click_event/).length);
  noErrors(titled({ text: 'x', hover_event: { action: 'show_item', id: 'minecraft:diamond', count: 2 } }));
  assert.ok(find(titled({ text: 'x', hover_event: { action: 'show_item', id: 'minecraft:nope' } }), 'error', /hover_event\.id/).length);
  assert.ok(find(titled({ text: 'x', hover_event: { action: 'show_entity', id: 'minecraft:pig' } }), 'error', /uuid/).length);
  noErrors(titled({ text: 'x', hover_event: { action: 'show_entity', id: 'minecraft:pig', uuid: [1, 2, 3, 4], name: 'Pig' } }));
});
t('empty title warns', () => assert.ok(find(titled(''), 'warn', /^title$/, /empty/).length));
t('version compatibility of whole dialog', () => {
  const d = { type: 'minecraft:notice', title: ['', { keybind: 'key.friends' }, { type: 'object', object: 'atlas', sprite: 'item/diamond', fallback: 'd' }], body: [{ type: 'minecraft:item', item: 'minecraft:cinnabar' }] };
  const a = run(d, '1.21.11'), b = run(d, '26.2');
  assert.ok(a.filter((i) => i.level !== 'info').length > b.filter((i) => i.level !== 'info').length);
  noErrors(b);
});
console.log(`validate tests passed: ${n}, failed: ${failed}`);
