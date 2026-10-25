/* Dialog MC — dialog validator. Produces issues {level, path, msg, hint?, fix?} for a dialog JSON value.
 *
 * level: 'error' = the game rejects it / the button can't work, 'warn' = works but probably not as intended,
 *        'info' = good to know. `path` is dot-separated and relative to the dialog root (e.g. "actions.0.action.command").
 * Everything is version aware (ctx.ver = '1.21.11' | '26.2').
 */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const V = (DMC.validate = {});
  const T = DMC.text;
  const S = DMC.schema;
  const C = DMC.cmd;
  const R = DMC.reg;
  const RLu = DMC.rl;
  const U = DMC.util;

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isStr = (v) => typeof v === 'string';
  const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const isBool = (v) => typeof v === 'boolean';
  const join = (a, b) => (a === '' || a == null ? String(b) : a + '.' + b);
  const q = (s) => '"' + s + '"';
  const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const KEY_RE = /^[A-Za-z0-9_]+$/;

  /* ------------------------------------------------------------------ *
   * Context
   * ------------------------------------------------------------------ */
  function makeCx(opts) {
    const cx = {
      ver: opts.ver,
      issues: [],
      known: {
        dialogs: new Set((opts.dialogIds || []).concat(DMC.vanillaDialogs)),
        tags: new Set((opts.tagIds || []).concat(DMC.vanillaDialogTags)),
      },
      st: null,
      add(level, path, msg, extra) {
        const it = Object.assign({ level, path: path || '', msg }, extra || {});
        // de-duplicate identical issues
        if (!cx.issues.some((x) => x.level === it.level && x.path === it.path && x.msg === it.msg)) cx.issues.push(it);
      },
    };
    return cx;
  }
  const E = (cx, p, m, x) => cx.add('error', p, m, x);
  const W = (cx, p, m, x) => cx.add('warn', p, m, x);
  const I = (cx, p, m, x) => cx.add('info', p, m, x);

  /* ------------------------------------------------------------------ *
   * Small checkers
   * ------------------------------------------------------------------ */
  function intField(cx, obj, key, path, min, max, label) {
    const v = obj[key];
    if (v === undefined) return undefined;
    const p = join(path, key);
    if (!isInt(v)) {
      E(cx, p, (label || key) + ' must be a whole number.');
      return undefined;
    }
    if (min != null && v < min) E(cx, p, (label || key) + ' must be at least ' + min + '.', { fix: { label: 'Set to ' + min, set: [{ path: p, value: min }] } });
    else if (max != null && v > max) E(cx, p, (label || key) + ' can be at most ' + max + '.', { fix: { label: 'Set to ' + max, set: [{ path: p, value: max }] } });
    return v;
  }
  function boolField(cx, obj, key, path) {
    if (obj[key] === undefined) return undefined;
    if (!isBool(obj[key])) E(cx, join(path, key), key + ' must be true or false.');
    return obj[key];
  }
  function unknownKeys(cx, obj, allowed, path, what) {
    for (const k of Object.keys(obj)) {
      if (allowed.includes(k)) continue;
      const sug = U.closest(k, allowed);
      W(cx, join(path, k), 'Unknown field ' + q(k) + (what ? ' for ' + what : '') + ' — the game ignores it' + (sug ? '; did you mean ' + q(sug) + '?' : '.'));
    }
  }
  function checkRL(cx, path, value, what, opts) {
    opts = opts || {};
    if (!isStr(value)) { E(cx, path, what + ' must be a string.'); return false; }
    if (!RLu.isValid(value)) {
      E(cx, path, q(value) + ' is not a valid ' + what + ' — use lowercase letters, digits, _ . - / and one optional "namespace:" prefix.');
      return false;
    }
    return true;
  }
  /** Registry lookup with helpful messages. Returns the status. */
  function checkRegistry(cx, path, kind, value, what) {
    if (!checkRL(cx, path, value, what)) return 'invalid';
    const res = R.check(kind, value, cx.ver);
    if (res.status === 'missing') {
      const sug = R.suggest(kind, value, cx.ver, 3);
      E(cx, path, 'Unknown ' + what + ' ' + q(value) + '.', sug.length ? { hint: 'Did you mean ' + sug.map((s) => 'minecraft:' + s).join(', ') + '?', fix: sug.length ? { label: 'Use minecraft:' + sug[0], set: [{ path, value: 'minecraft:' + sug[0] }] } : undefined } : null);
    } else if (res.status === 'newer') {
      E(cx, path, q(value) + ' doesn\'t exist in ' + cx.ver + ' — it was added in ' + res.since + '.');
    } else if (res.status === 'unknown-ns') {
      I(cx, path, q(value) + ' is from another namespace, so it can\'t be verified here. It must exist in the world\'s data packs/mods.');
    }
    return res.status;
  }
  function checkUuid(cx, path, v) {
    if (Array.isArray(v)) {
      if (v.length !== 4 || !v.every(isInt)) E(cx, path, 'A UUID given as a list needs exactly 4 whole numbers.');
    } else if (!(isStr(v) && UUID_RE.test(v))) E(cx, path, 'Not a valid UUID — use the form 00000000-0000-0000-0000-000000000000.');
  }

  /* ------------------------------------------------------------------ *
   * Commands (run_command / suggest_command / templates)
   * ------------------------------------------------------------------ */
  const TRIGGER_HINT = 'Tip: /trigger needs a "trigger" scoreboard objective that is enabled for the player (scoreboard players enable).';

  function checkRunCommand(cx, path, command, ctxLabel) {
    if (!isStr(command)) { E(cx, path, 'The command must be a string.'); return null; }
    if (!command.trim()) { E(cx, path, 'The command is empty.'); return null; }
    const res = C.validate(command, cx.ver);
    if (!res.ok) {
      const e = res.errors[0];
      E(cx, path, (ctxLabel ? ctxLabel + ' ' : '') + 'Invalid command: ' + e.message + (e.pos != null ? ' (at character ' + (e.pos + 1) + ')' : '') + '.', {
        hint: 'Players get a "Confirm Command Execution – unrecognized or invalid command" prompt, and the server then rejects it.',
        fix: e.suggestion && e.pos === (command.startsWith('/') ? 1 : 0) ? { label: 'Use "' + e.suggestion + '"', set: [{ path, value: (command.startsWith('/') ? '/' : '') + e.suggestion + command.slice((command.startsWith('/') ? 1 : 0) + command.replace(/^\//, '').split(' ')[0].length) }] } : undefined,
      });
      return res;
    }
    if (res.signed) {
      E(cx, path, '/' + res.root + ' sends a chat message under the player\'s name, so Minecraft won\'t run it from a click ("can only be run from the chat screen").', {
        hint: 'Use /tellraw, /title or similar for output, or use "Suggest command" so the player sends it themselves.',
      });
    } else if (res.level > 0) {
      W(cx, path, '/' + res.root + (res.path.includes('execute') && res.root !== 'execute' ? '' : '') + ' needs ' + C.levelName(res.level) + '. Players below that can\'t run it, and operators see a "Confirm Command Execution – requires elevated permissions" prompt first.', {
        hint: 'For regular players use /trigger (no permission needed), or send a "custom" event for a plugin/mod to handle.',
      });
    }
    if (res.path[0] === 'trigger') I(cx, path, TRIGGER_HINT);
    return res;
  }

  function checkSuggestCommand(cx, path, command) {
    if (!isStr(command)) { E(cx, path, 'The text must be a string.'); return; }
    if (/[\n\r§]/.test(command)) E(cx, path, 'Chat suggestions can\'t contain line breaks or the § character.');
    if (command.length > 256) W(cx, path, 'The chat box holds at most 256 characters — the rest is cut off.');
    if (command.startsWith('/')) {
      const res = C.validate(command, cx.ver);
      if (!res.ok && !/^Incomplete/.test(res.errors[0].message)) {
        W(cx, path, 'This command has a problem: ' + res.errors[0].message + '.', { hint: 'Suggestions may be incomplete, but they should start correctly.' });
      }
    } else if (command.length) {
      I(cx, path, 'Without a leading "/" this is inserted as a normal chat message, not a command.');
    }
  }

  /* ------------------------------------------------------------------ *
   * Text components
   * ------------------------------------------------------------------ */
  const OBJECT_ATLASES_HINT = 'Texture must exist in that atlas (resource pack textures work too).';

  function validateText(cx, value, path, opts) {
    opts = opts || {};
    if (value === undefined) {
      if (opts.required) E(cx, path, (opts.name || 'This') + ' is required.');
      return;
    }
    if (isStr(value)) {
      if (opts.warnEmpty && value === '') W(cx, path, (opts.name || 'Text') + ' is empty.');
      return;
    }
    if (Array.isArray(value)) {
      if (!value.length) { E(cx, path, 'An empty list is not a valid text component.'); return; }
      value.forEach((v, i) => validateText(cx, v, join(path, i), { nested: true }));
      return;
    }
    if (isNum(value) || isBool(value)) {
      I(cx, path, 'Numbers and booleans are converted to text.');
      return;
    }
    if (!isObj(value)) { E(cx, path, 'This is not a valid text component (use a string, an object or a list).'); return; }
    validateComponent(cx, value, path);
    if (opts.warnEmpty && T.isEmpty(value)) W(cx, path, (opts.name || 'Text') + ' is empty.');
  }

  function validateComponent(cx, c, path) {
    const ver = cx.ver;
    const kind = T.kindOf(c);
    if (kind === 'unknown') {
      E(cx, path, 'Unrecognized text component — it needs one of: text, translate, keybind, score, selector, nbt, sprite or player.');
      return;
    }
    if (c.type !== undefined) {
      const ok = ['text', 'translatable', 'score', 'selector', 'keybind', 'nbt', 'object'];
      if (!ok.includes(c.type)) E(cx, join(path, 'type'), 'Unknown component type ' + q(String(c.type)) + '.');
    }
    // content
    switch (kind) {
      case 'text':
        if (!isStr(c.text)) E(cx, join(path, 'text'), '"text" must be a string.');
        break;
      case 'translatable': {
        if (!isStr(c.translate) || !c.translate) { E(cx, join(path, 'translate'), 'A translation key is required.'); break; }
        const known = DMC.lang.has(c.translate, ver);
        if (!known) {
          if (c.fallback === undefined) {
            W(cx, join(path, 'translate'), 'Translation key ' + q(c.translate) + ' isn\'t in vanilla ' + ver + '. Without a resource pack it shows the raw key.', { hint: 'Add a "fallback" text to show when the key is missing.' });
          }
        }
        if (c.fallback !== undefined && !isStr(c.fallback)) E(cx, join(path, 'fallback'), '"fallback" must be a string.');
        if (c.with !== undefined) {
          if (!Array.isArray(c.with)) E(cx, join(path, 'with'), '"with" must be a list of arguments.');
          else if (!c.with.length) E(cx, join(path, 'with'), '"with" can\'t be an empty list — remove it.');
          else c.with.forEach((a, i) => {
            if (isStr(a) || isNum(a) || isBool(a)) return;
            validateText(cx, a, join(join(path, 'with'), i), { nested: true });
          });
        }
        if (known && isStr(c.translate)) {
          const tpl = DMC.lang.get(c.translate, ver);
          const need = (tpl.match(/%(?:\d+\$)?s/g) || []).length;
          const have = Array.isArray(c.with) ? c.with.length : 0;
          if (need > have && have >= 0) W(cx, join(path, 'with'), 'This translation expects ' + need + ' argument' + (need === 1 ? '' : 's') + ' but ' + have + ' ' + (have === 1 ? 'is' : 'are') + ' given.');
        }
        break;
      }
      case 'keybind':
        if (!isStr(c.keybind)) E(cx, join(path, 'keybind'), 'A keybind id is required, e.g. "key.jump".');
        else if (!DMC.keys.has(c.keybind, ver)) {
          const added = DMC.keys.addedIn(c.keybind);
          const sug = U.closest(c.keybind, DMC.keys.list(ver));
          W(cx, join(path, 'keybind'), added ? q(c.keybind) + ' doesn\'t exist in ' + ver + ' (added in ' + added + ') — it would show the raw id.' : 'Unknown keybind ' + q(c.keybind) + ' — it would show the raw id' + (sug ? '. Did you mean ' + q(sug) + '?' : '.'));
        }
        break;
      case 'score': {
        const sc = c.score;
        if (!isObj(sc)) { E(cx, join(path, 'score'), 'Score needs {"name": …, "objective": …}.'); break; }
        if (!isStr(sc.name) || !sc.name) E(cx, join(path, 'score.name'), 'A score holder (player name, selector or *) is required.');
        else {
          const r = C.checkArgument('minecraft:score_holder', sc.name, { amount: 'single' }, ver);
          if (!r.ok) W(cx, join(path, 'score.name'), 'Score holder problem: ' + r.message + '.');
        }
        if (!isStr(sc.objective) || !sc.objective) E(cx, join(path, 'score.objective'), 'An objective name is required.');
        W(cx, join(path, 'score'), 'Score components aren\'t resolved inside dialogs — they are not replaced by the value.', { hint: 'Dialogs are plain screens, not chat. Show scores with /tellraw or /title instead.' });
        break;
      }
      case 'selector': {
        if (!isStr(c.selector) || !c.selector) { E(cx, join(path, 'selector'), 'A selector is required, e.g. "@p".'); break; }
        const r = C.checkArgument('minecraft:entity', c.selector, { amount: 'multiple', type: 'entities' }, ver);
        if (!r.ok) E(cx, join(path, 'selector'), 'Invalid selector: ' + r.message + '.');
        W(cx, join(path, 'selector'), 'Selector components aren\'t resolved inside dialogs — the name isn\'t filled in.', { hint: 'Dialogs have no command source. Use /tellraw to address players by name.' });
        break;
      }
      case 'nbt': {
        if (!isStr(c.nbt) || !c.nbt) E(cx, join(path, 'nbt'), 'An NBT path is required.');
        else {
          const r = C.checkArgument('minecraft:nbt_path', c.nbt, {}, ver);
          if (!r.ok) E(cx, join(path, 'nbt'), 'Invalid NBT path: ' + r.message + '.');
        }
        const src = c.source || (c.block !== undefined ? 'block' : c.entity !== undefined ? 'entity' : c.storage !== undefined ? 'storage' : null);
        if (!src) E(cx, join(path, 'source'), 'NBT components need a source: block, entity or storage.');
        else if (src === 'block') {
          if (!isStr(c.block)) E(cx, join(path, 'block'), 'A block position is required, e.g. "~ ~ ~".');
          else if (!C.checkArgument('minecraft:block_pos', c.block, {}, ver).ok) E(cx, join(path, 'block'), 'Invalid block position.');
        } else if (src === 'entity') {
          if (!isStr(c.entity)) E(cx, join(path, 'entity'), 'An entity selector is required, e.g. "@s".');
          else {
            const r = C.checkArgument('minecraft:entity', c.entity, { amount: 'multiple', type: 'entities' }, ver);
            if (!r.ok) E(cx, join(path, 'entity'), 'Invalid selector: ' + r.message + '.');
          }
        } else if (src === 'storage') {
          if (!isStr(c.storage) || !RLu.isValid(c.storage)) E(cx, join(path, 'storage'), 'A storage id like "minecraft:example" is required.');
        } else E(cx, join(path, 'source'), 'Unknown NBT source ' + q(String(src)) + ' (block, entity or storage).');
        if (c.interpret !== undefined && !isBool(c.interpret)) E(cx, join(path, 'interpret'), '"interpret" must be true or false.');
        if (c.plain !== undefined) {
          if (!DMC.ver.has.nbtPlain(ver)) W(cx, join(path, 'plain'), '"plain" was added in 26.1 — it is ignored in ' + ver + '.');
          else if (!isBool(c.plain)) E(cx, join(path, 'plain'), '"plain" must be true or false.');
          else if (c.plain && c.interpret) E(cx, join(path, 'plain'), '"plain" can\'t be true while "interpret" is true.');
        }
        W(cx, join(path, 'nbt'), 'NBT components aren\'t resolved inside dialogs — the data isn\'t shown.', { hint: 'Use /tellraw or /title to display NBT values.' });
        break;
      }
      case 'sprite': {
        if (!isStr(c.sprite) || !c.sprite) E(cx, join(path, 'sprite'), 'A sprite texture id is required, e.g. "item/diamond".');
        else if (!RLu.isValid(c.sprite)) E(cx, join(path, 'sprite'), q(c.sprite) + ' is not a valid texture id.');
        if (c.atlas !== undefined && (!isStr(c.atlas) || !RLu.isValid(c.atlas))) E(cx, join(path, 'atlas'), 'The atlas must be an id like "minecraft:blocks".');
        if (c.fallback !== undefined && !DMC.ver.has.objectFallback(ver)) W(cx, join(path, 'fallback'), '"fallback" for sprites was added in 26.1 — it is ignored in ' + ver + '.');
        else if (c.fallback !== undefined) validateText(cx, c.fallback, join(path, 'fallback'), { nested: true });
        break;
      }
      case 'head': {
        const p = c.player;
        if (p === undefined) { E(cx, join(path, 'player'), 'A player is required — a name, or an object with name / id / textures.'); break; }
        validateProfile(cx, p, join(path, 'player'));
        if (c.hat !== undefined && !isBool(c.hat)) E(cx, join(path, 'hat'), '"hat" must be true or false.');
        if (c.fallback !== undefined && !DMC.ver.has.objectFallback(ver)) W(cx, join(path, 'fallback'), '"fallback" for player heads was added in 26.1 — it is ignored in ' + ver + '.');
        else if (c.fallback !== undefined) validateText(cx, c.fallback, join(path, 'fallback'), { nested: true });
        break;
      }
      default: break;
    }
    // style
    if (c.color !== undefined) {
      if (!isStr(c.color) || !T.colorToCss(c.color)) {
        const sug = isStr(c.color) ? U.closest(c.color.toLowerCase(), T.COLOR_NAMES) : null;
        E(cx, join(path, 'color'), 'Invalid color ' + q(String(c.color)) + ' — use a color name or #RRGGBB.' + (sug ? ' Did you mean ' + q(sug) + '?' : ''));
      }
    }
    for (const f of T.FLAGS) if (c[f] !== undefined && !isBool(c[f])) E(cx, join(path, f), q(f) + ' must be true or false.');
    if (c.font !== undefined) {
      if (!isStr(c.font) || !RLu.isValid(c.font)) E(cx, join(path, 'font'), 'The font must be an id like "minecraft:uniform".');
      else if (RLu.split(c.font)[0] === 'minecraft' && !DMC_DATA.registry.fonts.includes(RLu.norm(c.font))) {
        W(cx, join(path, 'font'), q(c.font) + ' isn\'t a vanilla font (' + DMC_DATA.registry.fonts.map((f) => f.replace('minecraft:', '')).join(', ') + ').');
      } else if (RLu.split(c.font)[0] !== 'minecraft') I(cx, join(path, 'font'), 'Custom fonts must be supplied by a resource pack.');
    }
    if (c.shadow_color !== undefined && !T.argbDecode(c.shadow_color)) {
      E(cx, join(path, 'shadow_color'), '"shadow_color" must be a whole ARGB number or a list of 4 numbers between 0 and 1.');
    }
    if (c.insertion !== undefined) {
      if (!isStr(c.insertion)) E(cx, join(path, 'insertion'), '"insertion" must be a string.');
      else I(cx, join(path, 'insertion'), 'Insertion (shift-click) only works in chat — it does nothing in dialogs.');
    }
    if (c.extra !== undefined) {
      if (!Array.isArray(c.extra)) E(cx, join(path, 'extra'), '"extra" must be a list of text components.');
      else if (!c.extra.length) E(cx, join(path, 'extra'), '"extra" can\'t be an empty list — remove it.');
      else c.extra.forEach((e, i) => validateText(cx, e, join(join(path, 'extra'), i), { nested: true }));
    }
    for (const legacy of ['clickEvent', 'hoverEvent']) {
      if (c[legacy] !== undefined) W(cx, join(path, legacy), q(legacy) + ' is the pre-1.21.5 name — use ' + q(legacy === 'clickEvent' ? 'click_event' : 'hover_event') + '.');
    }
    if (c.click_event !== undefined) validateAction(cx, c.click_event, join(path, 'click_event'), 'text');
    if (c.hover_event !== undefined) validateHover(cx, c.hover_event, join(path, 'hover_event'));
  }

  function validateProfile(cx, p, path) {
    if (isStr(p)) {
      if (p.length > 16 || /[^!-~]/.test(p) || !p.length) E(cx, path, 'A player name is 1–16 visible characters with no spaces.');
      return;
    }
    if (!isObj(p)) { E(cx, path, 'The player must be a name or an object.'); return; }
    if (p.name === undefined && p.id === undefined && p.properties === undefined && p.texture === undefined) {
      W(cx, path, 'This profile has no name, id or texture — the head will use the default skin.');
    }
    if (p.name !== undefined) {
      if (!isStr(p.name) || p.name.length > 16 || /[^!-~]/.test(p.name)) E(cx, join(path, 'name'), 'A player name is up to 16 visible characters with no spaces.');
    }
    if (p.id !== undefined) checkUuid(cx, join(path, 'id'), p.id);
    for (const k of ['texture', 'cape', 'elytra']) if (p[k] !== undefined && (!isStr(p[k]) || !RLu.isValid(p[k]))) E(cx, join(path, k), q(k) + ' must be a texture id like "minecraft:entity/player/wide/steve".');
    if (p.model !== undefined && !['wide', 'slim'].includes(p.model)) E(cx, join(path, 'model'), '"model" must be "wide" or "slim".');
    if (p.properties !== undefined && !Array.isArray(p.properties) && !isObj(p.properties)) E(cx, join(path, 'properties'), '"properties" must be a list of {name, value, signature?}.');
    if (Array.isArray(p.properties)) {
      if (p.properties.length > 16 && DMC.ver.since(cx.ver, '1.21.11')) E(cx, join(path, 'properties'), 'At most 16 properties are allowed.');
      p.properties.forEach((pr, i) => {
        if (!isObj(pr) || !isStr(pr.name) || !isStr(pr.value)) E(cx, join(join(path, 'properties'), i), 'A profile property needs string "name" and "value".');
      });
    }
    unknownKeys(cx, p, ['name', 'id', 'properties', 'texture', 'cape', 'elytra', 'model'], path, 'a player profile');
  }

  function validateHover(cx, h, path) {
    if (!isObj(h)) { E(cx, path, 'A hover event must be an object.'); return; }
    const a = h.action;
    if (!isStr(a)) { E(cx, join(path, 'action'), 'A hover event needs an "action": show_text, show_item or show_entity.'); return; }
    switch (a) {
      case 'show_text':
        validateText(cx, h.value, join(path, 'value'), { required: true, name: '"value"', nested: true });
        unknownKeys(cx, h, ['action', 'value'], path, 'show_text');
        break;
      case 'show_item':
        validateItemStack(cx, h, path, { flat: true });
        unknownKeys(cx, h, ['action', 'id', 'count', 'components'], path, 'show_item');
        break;
      case 'show_entity':
        if (h.id === undefined) E(cx, join(path, 'id'), 'An entity type is required, e.g. "minecraft:pig".');
        else checkRegistry(cx, join(path, 'id'), 'entities', h.id, 'entity type');
        if (h.uuid === undefined) E(cx, join(path, 'uuid'), 'An entity UUID is required.');
        else checkUuid(cx, join(path, 'uuid'), h.uuid);
        if (h.name !== undefined) validateText(cx, h.name, join(path, 'name'), { nested: true });
        unknownKeys(cx, h, ['action', 'id', 'uuid', 'name'], path, 'show_entity');
        break;
      default:
        E(cx, join(path, 'action'), 'Unknown hover action ' + q(a) + ' (show_text, show_item, show_entity).');
    }
  }

  /* ------------------------------------------------------------------ *
   * Item stacks
   * ------------------------------------------------------------------ */
  const TRANSIENT_COMPONENTS = ['additional_trade_cost', 'creative_slot_lock', 'map_post_processing'];

  function validateItemStack(cx, it, path, opts) {
    opts = opts || {};
    const ver = cx.ver;
    let id;
    let obj = it;
    if (isStr(it) && !opts.flat) {
      if (!DMC.ver.has.itemStringForm(ver)) {
        E(cx, path, 'In ' + ver + ' the item must be an object like {"id": "minecraft:diamond"} — a bare id string works from 26.1.', {
          fix: { label: 'Convert to object', set: [{ path, value: { id: it } }] },
        });
      }
      id = it;
      obj = { id: it };
    } else if (!isObj(it)) {
      E(cx, path, 'The item must be an object like {"id": "minecraft:diamond", "count": 1}.');
      return;
    } else id = it.id;
    const idPath = isStr(it) ? path : join(path, 'id');
    if (id === undefined) { E(cx, idPath, 'An item id is required.'); }
    else {
      const st = checkRegistry(cx, idPath, 'items', id, 'item');
      if (st !== 'invalid' && isStr(id) && RLu.bare(id) === 'air' && RLu.norm(id) === 'minecraft:air') E(cx, idPath, '"air" isn\'t a valid item here — pick a real item.');
    }
    const count = intField(cx, obj, 'count', path, 1, 99, 'count');
    if (count !== undefined && isStr(id) && RLu.isValid(id) && RLu.split(id)[0] === 'minecraft') {
      let max = R.maxStack(id);
      if (isObj(obj.components) && isInt(obj.components['minecraft:max_stack_size'] !== undefined ? obj.components['minecraft:max_stack_size'] : obj.components.max_stack_size)) {
        max = obj.components['minecraft:max_stack_size'] !== undefined ? obj.components['minecraft:max_stack_size'] : obj.components.max_stack_size;
      }
      if (count > max) E(cx, join(path, 'count'), 'Count ' + count + ' is above this item\'s maximum stack size (' + max + ').', { fix: { label: 'Set to ' + max, set: [{ path: join(path, 'count'), value: max }] } });
    }
    if (obj.components !== undefined) validateComponents(cx, obj.components, join(path, 'components'));
    if (!opts.flat && isObj(it)) unknownKeys(cx, it, ['id', 'count', 'components'], path, 'an item');
  }

  const COMP_CHECK = {
    custom_name: (cx, v, p) => validateText(cx, v, p, { nested: true }),
    item_name: (cx, v, p) => validateText(cx, v, p, { nested: true }),
    lore: (cx, v, p) => {
      if (!Array.isArray(v)) return E(cx, p, 'Lore must be a list of text lines.');
      if (v.length > 256) E(cx, p, 'Lore can have at most 256 lines.');
      v.forEach((l, i) => validateText(cx, l, join(p, i), { nested: true }));
    },
    damage: (cx, v, p) => { if (!isInt(v) || v < 0) E(cx, p, '"damage" must be a whole number ≥ 0.'); },
    max_damage: (cx, v, p) => { if (!isInt(v) || v < 1) E(cx, p, '"max_damage" must be a whole number ≥ 1.'); },
    max_stack_size: (cx, v, p) => { if (!isInt(v) || v < 1 || v > 99) E(cx, p, '"max_stack_size" must be between 1 and 99.'); },
    repair_cost: (cx, v, p) => { if (!isInt(v) || v < 0) E(cx, p, '"repair_cost" must be a whole number ≥ 0.'); },
    enchantment_glint_override: (cx, v, p) => { if (!isBool(v)) E(cx, p, 'This must be true or false.'); },
    rarity: (cx, v, p) => { if (!S.rarities.includes(v)) E(cx, p, '"rarity" must be one of ' + S.rarities.join(', ') + '.'); },
    item_model: (cx, v, p) => checkRL(cx, p, v, 'model id'),
    enchantments: (cx, v, p) => {
      if (!isObj(v)) return E(cx, p, 'Enchantments are a map like {"minecraft:sharpness": 3}.');
      for (const [k, lv] of Object.entries(v)) {
        checkRegistry(cx, join(p, k), 'enchantments', k, 'enchantment');
        if (!isInt(lv) || lv < 1 || lv > 255) E(cx, join(p, k), 'The level must be between 1 and 255.');
      }
    },
    unbreakable: (cx, v, p) => { if (!isObj(v)) E(cx, p, '"unbreakable" must be an object — use {}.'); },
    custom_data: (cx, v, p) => { if (!isObj(v) && !isStr(v)) E(cx, p, '"custom_data" must be an object.'); },
  };

  function validateComponents(cx, comps, path) {
    if (!isObj(comps)) { E(cx, path, '"components" must be an object like {"minecraft:custom_name": "Hi"}.'); return; }
    const ver = cx.ver;
    const list = new Set(R.components(ver));
    for (const [rawKey, value] of Object.entries(comps)) {
      const removal = rawKey.startsWith('!');
      const key = removal ? rawKey.slice(1) : rawKey;
      const p = join(path, rawKey);
      if (!RLu.isValid(key)) { E(cx, p, q(rawKey) + ' isn\'t a valid component id.'); continue; }
      const [ns, name] = RLu.split(key);
      if (ns === 'minecraft') {
        if (!list.has(name)) {
          const added = R.addedIn('components', name);
          const sug = R.suggest('components', name, ver, 1)[0];
          E(cx, p, added ? 'Component ' + q(name) + ' doesn\'t exist in ' + ver + ' (added in ' + added + ').' : 'Unknown item component ' + q(name) + '.', sug && !added ? { hint: 'Did you mean minecraft:' + sug + '?' } : null);
          continue;
        }
        if (TRANSIENT_COMPONENTS.includes(name)) { E(cx, p, q(name) + ' can\'t be set in data (it isn\'t saved).'); continue; }
        if (removal) { if (!(isObj(value) && !Object.keys(value).length)) E(cx, p, 'Component removals use an empty object: ' + q(rawKey) + ': {}.'); continue; }
        if (COMP_CHECK[name]) COMP_CHECK[name](cx, value, p);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Actions (dialog buttons + text click events)
   * ------------------------------------------------------------------ */
  function validateAction(cx, a, path, mode) {
    if (!isObj(a)) { E(cx, path, 'An action must be an object.'); return; }
    const key = mode === 'text' ? 'action' : 'type';
    const raw = a[key];
    if (raw === undefined) { E(cx, join(path, key), 'The action needs a "' + key + '" (e.g. run_command).'); return; }
    if (!isStr(raw)) { E(cx, join(path, key), '"' + key + '" must be a string.'); return; }
    const t = S.bare(raw);
    const def = S.actionById[t];
    if (!def) {
      const sug = U.closest(t, S.actionTypes.filter((x) => mode !== 'text' || x.text).map((x) => x.id));
      E(cx, join(path, key), 'Unknown action ' + q(raw) + '.' + (sug ? ' Did you mean ' + q(sug) + '?' : ''));
      return;
    }
    if (mode === 'text' && !def.text) { E(cx, join(path, key), q(t) + ' only works on dialog buttons, not in text click events.'); return; }
    if (mode === 'text' && raw !== t) E(cx, join(path, key), 'Click event actions are written without a namespace — use ' + q(t) + '.', { fix: { label: 'Use "' + t + '"', set: [{ path: join(path, key), value: t }] } });
    const fieldsFor = {
      run_command: ['command'], suggest_command: ['command'], open_url: ['url'], copy_to_clipboard: ['value'],
      show_dialog: ['dialog'], change_page: ['page'], custom: ['id', 'payload'],
      'dynamic/run_command': ['template'], 'dynamic/custom': ['id', 'additions'],
    };
    unknownKeys(cx, a, [key].concat(fieldsFor[t]), path, q(t));
    const sub = (k) => join(path, k);
    switch (t) {
      case 'run_command':
        if (a.command === undefined) E(cx, sub('command'), 'A command is required.');
        else checkRunCommand(cx, sub('command'), a.command);
        break;
      case 'suggest_command':
        if (a.command === undefined) E(cx, sub('command'), 'Some text to suggest is required.');
        else checkSuggestCommand(cx, sub('command'), a.command);
        break;
      case 'open_url': {
        if (a.url === undefined) { E(cx, sub('url'), 'A URL is required.'); break; }
        if (!isStr(a.url)) { E(cx, sub('url'), 'The URL must be a string.'); break; }
        let ok = true;
        try {
          const u = new URL(a.url);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') ok = false;
        } catch (e) { ok = false; }
        if (/\s/.test(a.url)) ok = false;
        if (!ok) E(cx, sub('url'), 'Not a valid web link — it must start with http:// or https:// and contain no spaces.', /^[a-z0-9.-]+\.[a-z]{2,}/i.test(a.url) ? { fix: { label: 'Add https://', set: [{ path: sub('url'), value: 'https://' + a.url }] } } : null);
        else I(cx, sub('url'), 'Players see a confirmation prompt before the link opens.');
        break;
      }
      case 'copy_to_clipboard':
        if (a.value === undefined) E(cx, sub('value'), 'The text to copy is required.');
        else if (!isStr(a.value)) E(cx, sub('value'), 'The value must be a string.');
        break;
      case 'show_dialog': {
        const d = a.dialog;
        if (d === undefined) { E(cx, sub('dialog'), 'Pick the dialog to open (an id, or an inline dialog).'); break; }
        if (isStr(d)) {
          if (d.startsWith('#')) { E(cx, sub('dialog'), 'Tags can\'t be used here — name one dialog (tags only work in a dialog list).'); break; }
          if (!checkRL(cx, sub('dialog'), d, 'dialog id')) break;
          const full = RLu.norm(d);
          if (!cx.known.dialogs.has(full)) W(cx, sub('dialog'), 'Dialog ' + q(full) + ' isn\'t in this project. Make sure a data pack provides it, or the button does nothing.');
        } else if (isObj(d)) {
          validateDialog(cx, d, sub('dialog'), (cx.depth || 0) + 1);
        } else E(cx, sub('dialog'), 'A dialog id (string) or an inline dialog object is required.');
        break;
      }
      case 'change_page':
        if (!isInt(a.page) || a.page < 1) E(cx, sub('page'), 'The page must be a whole number ≥ 1.');
        W(cx, path, '"change_page" only works inside written books — it does nothing in dialogs.');
        break;
      case 'custom':
      case 'dynamic/custom':
        if (a.id === undefined) E(cx, sub('id'), 'A custom action id is required, e.g. "mypack:my_event".');
        else if (checkRL(cx, sub('id'), a.id, 'custom action id') && RLu.split(a.id)[0] === 'minecraft' && !a.id.includes(':')) {
          I(cx, sub('id'), 'Use your own namespace (e.g. "mypack:' + a.id + '") to avoid clashing with vanilla ids.');
        }
        W(cx, path, 'Custom actions have no effect on vanilla servers — a plugin or mod must listen for ' + q(isStr(a.id) ? a.id : 'the id') + '.', { hint: 'For plain vanilla use "Run command" with /trigger or a function.' });
        if (t === 'dynamic/custom') {
          cx.st.usesDynamic = true;
          cx.st.dynCustom = true;
          if (a.additions !== undefined && !isObj(a.additions)) E(cx, sub('additions'), '"additions" must be an object of extra fields.');
        }
        break;
      case 'dynamic/run_command':
        validateTemplate(cx, a, path);
        break;
      default: break;
    }
  }

  /* ------------------------------------------------------------------ *
   * dynamic/run_command templates
   * ------------------------------------------------------------------ */
  function fmtNum(n) {
    if (Number.isInteger(n)) return String(n);
    return String(+n.toFixed(6));
  }

  function sampleValuesFor(inp) {
    const type = S.bare(inp.type);
    if (type === 'text') return [inp.initial != null ? String(inp.initial) : 'text'];
    if (type === 'boolean') return [inp.on_true != null ? String(inp.on_true) : 'true', inp.on_false != null ? String(inp.on_false) : 'false'];
    if (type === 'single_option') {
      const ids = (Array.isArray(inp.options) ? inp.options : []).map((o) => (isStr(o) ? o : isObj(o) && o.id != null ? String(o.id) : null)).filter((x) => x !== null);
      return ids.slice(0, 6);
    }
    if (type === 'number_range') {
      const s = isNum(inp.start) ? inp.start : 0;
      const e = isNum(inp.end) ? inp.end : 1;
      const init = isNum(inp.initial) ? inp.initial : (s + e) / 2;
      let vals = [init, s, e];
      if (isNum(inp.step) && inp.step > 0) {
        // values the slider can actually produce: start + n*step (clamped); the middle default snaps down to a step
        vals = vals.map((v) => Math.min(e, Math.max(s, s + Math.round((v - s) / inp.step) * inp.step)));
      }
      return Array.from(new Set(vals.map(fmtNum)));
    }
    return ['value'];
  }

  function validateTemplate(cx, a, path) {
    const p = join(path, 'template');
    cx.st.usesDynamic = true;
    if (a.template === undefined) { E(cx, p, 'A command template is required, e.g. "give @s diamond $(amount)".'); return; }
    if (!isStr(a.template) || !a.template.trim()) { E(cx, p, 'The command template is empty.'); return; }
    const tpl = a.template;
    const opens = (tpl.match(/\$\(/g) || []).length;
    const closed = (tpl.match(/\$\([^)]*\)/g) || []).length;
    if (opens !== closed) { E(cx, p, 'A macro "$(" is missing its closing ")".'); return; }
    const keys = C.templateKeys(tpl);
    for (const k of keys) {
      if (!KEY_RE.test(k) || !k) { E(cx, p, 'Macro ' + q('$(' + k + ')') + ' has an invalid name — use letters, digits and _ only.'); return; }
    }
    keys.forEach((k) => cx.st.usedKeys.add(k));
    const inputs = cx.st.inputs;
    // Note: inputs may be declared after this action in the JSON, so unknown keys are resolved in the post-pass.
    cx.st.templates.push({ path: p, tpl, keys });
    if (!keys.length) {
      I(cx, p, 'This template uses no $(…) macros — a normal "Run command" action does the same.');
    }
    void inputs;
  }

  function checkTemplates(cx) {
    for (const t of cx.st.templates) {
      const unknown = t.keys.filter((k) => !cx.st.inputs.has(k));
      if (unknown.length) {
        E(cx, t.path, 'Template uses ' + unknown.map((k) => q('$(' + k + ')')).join(', ') + ' but no input has that key.', {
          hint: cx.st.inputs.size ? 'Defined input keys: ' + Array.from(cx.st.inputs.keys()).join(', ') + '.' : 'Add an input to this dialog first.',
        });
        continue;
      }
      // Simulate: base sample + one alternative per input
      const base = {};
      const alts = {};
      for (const k of new Set(t.keys)) {
        const vals = sampleValuesFor(cx.st.inputs.get(k).def);
        alts[k] = vals;
        base[k] = vals.length ? vals[0] : '';
      }
      const variants = [{ vals: base, note: null }];
      for (const k of Object.keys(alts)) for (const v of alts[k].slice(1)) variants.push({ vals: Object.assign({}, base, { [k]: v }), note: k });
      const seen = new Set();
      let reported = 0;
      for (const v of variants.slice(0, 24)) {
        const cmd = C.expand(t.tpl, v.vals);
        const res = C.validate(cmd, cx.ver);
        const key = !res.ok ? res.errors[0].message : res.signed ? 'signed' : 'level' + res.level;
        if (seen.has(key)) continue;
        seen.add(key);
        const which = Object.keys(v.vals).map((k) => '$(' + k + ') = ' + q(v.vals[k])).join(', ');
        if (!res.ok) {
          if (reported >= 2) continue;
          reported++;
          const textInput = Object.keys(v.vals).some((k) => S.bare(cx.st.inputs.get(k).def.type) === 'text');
          const msg = 'With ' + (which || 'the sample values') + ' the command becomes ' + q(cmd) + ' → ' + res.errors[0].message + '.';
          const extra = textInput ? { hint: 'Text fields can contain anything. If this must be a number or a fixed word, use a slider or option picker instead.' } : null;
          (textInput ? W : E)(cx, t.path, msg, extra);
        } else if (variants[0] === v || v === variants[0]) {
          if (res.signed) E(cx, t.path, '/' + res.root + ' sends a chat message under the player\'s name, so Minecraft won\'t run it from a click ("can only be run from the chat screen").');
          else if (res.level > 0) W(cx, t.path, '/' + res.root + ' needs ' + C.levelName(res.level) + '. Players below that can\'t run it, and operators see a confirmation prompt first.', { hint: 'For regular players use /trigger, or a "custom" event handled by a plugin/mod.' });
          if (res.path[0] === 'trigger') I(cx, t.path, TRIGGER_HINT);
        }
      }
      if (t.keys.some((k) => S.bare(cx.st.inputs.get(k).def.type) === 'text')) {
        I(cx, t.path, 'Text input is inserted as typed (quotes and backslashes are escaped), so players can type anything into it.');
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Buttons, inputs, body
   * ------------------------------------------------------------------ */
  function validateButton(cx, b, path, o) {
    o = o || {};
    if (!isObj(b)) { E(cx, path, 'A button must be an object like {"label": "OK"}.'); return; }
    if (b.label === undefined) {
      if (!o.optionalLabel) E(cx, join(path, 'label'), 'The button needs a label.');
    } else validateText(cx, b.label, join(path, 'label'), { warnEmpty: true, name: 'The button label' });
    if (b.tooltip !== undefined) validateText(cx, b.tooltip, join(path, 'tooltip'), {});
    intField(cx, b, 'width', path, 1, 1024, 'width');
    if (b.action !== undefined) validateAction(cx, b.action, join(path, 'action'), 'dialog');
    else if (o.hintNoAction) I(cx, path, 'No action — clicking only ' + (o.closeText || 'closes the dialog') + '.');
    unknownKeys(cx, b, ['label', 'tooltip', 'width', 'action'], path, 'a button');
  }

  function validateBody(cx, b, path) {
    if (!isObj(b)) { E(cx, path, 'A body element must be an object.'); return; }
    if (!isStr(b.type)) { E(cx, join(path, 'type'), 'A body element needs a "type": plain_message or item.'); return; }
    const t = S.bare(b.type);
    if (t === 'plain_message') {
      if (b.contents === undefined) E(cx, join(path, 'contents'), 'The message needs "contents" (the text).');
      else validateText(cx, b.contents, join(path, 'contents'), {});
      intField(cx, b, 'width', path, 1, 1024, 'width');
      unknownKeys(cx, b, ['type', 'contents', 'width'], path, 'a text body');
    } else if (t === 'item') {
      if (b.item === undefined) E(cx, join(path, 'item'), 'An item is required.');
      else validateItemStack(cx, b.item, join(path, 'item'), {});
      if (b.description !== undefined) {
        const d = b.description;
        if (isObj(d) && 'contents' in d) {
          validateText(cx, d.contents, join(join(path, 'description'), 'contents'), {});
          intField(cx, d, 'width', join(path, 'description'), 1, 1024, 'width');
        } else validateText(cx, d, join(path, 'description'), {});
      }
      boolField(cx, b, 'show_decorations', path);
      boolField(cx, b, 'show_tooltip', path);
      intField(cx, b, 'width', path, 1, 256, 'width');
      intField(cx, b, 'height', path, 1, 256, 'height');
      if (b.show_decoration !== undefined) W(cx, join(path, 'show_decoration'), 'The field is called "show_decorations" (plural).', { fix: { label: 'Rename', move: { from: join(path, 'show_decoration'), to: join(path, 'show_decorations') } } });
      unknownKeys(cx, b, ['type', 'item', 'description', 'show_decorations', 'show_tooltip', 'width', 'height', 'show_decoration'], path, 'an item body');
    } else {
      const sug = U.closest(t, ['plain_message', 'item']);
      E(cx, join(path, 'type'), 'Unknown body type ' + q(b.type) + ' (plain_message or item).' + (sug ? ' Did you mean ' + q(sug) + '?' : ''));
    }
  }

  function validateInput(cx, inp, path) {
    if (!isObj(inp)) { E(cx, path, 'An input must be an object.'); return; }
    if (!isStr(inp.type)) { E(cx, join(path, 'type'), 'An input needs a "type": text, boolean, single_option or number_range.'); return; }
    const t = S.bare(inp.type);
    if (!S.inputTypes.some((x) => x.id === t)) {
      const sug = U.closest(t, S.inputTypes.map((x) => x.id));
      E(cx, join(path, 'type'), 'Unknown input type ' + q(inp.type) + '.' + (sug ? ' Did you mean ' + q(sug) + '?' : ''));
      return;
    }
    // key
    if (inp.key === undefined) E(cx, join(path, 'key'), 'Every input needs a "key" — the name used as $(key) in commands.');
    else if (!isStr(inp.key) || !inp.key) E(cx, join(path, 'key'), 'The key must be a non-empty string.');
    else if (!KEY_RE.test(inp.key)) E(cx, join(path, 'key'), 'The key may only contain letters, digits and _ .', { fix: { label: 'Clean up', set: [{ path: join(path, 'key'), value: inp.key.replace(/[^A-Za-z0-9_]+/g, '_') || 'value' }] } });
    else {
      if (cx.st.inputs.has(inp.key)) E(cx, join(path, 'key'), 'Duplicate key ' + q(inp.key) + ' — each input needs its own key.');
      else cx.st.inputs.set(inp.key, { def: inp, path });
    }
    if (inp.label === undefined) E(cx, join(path, 'label'), 'The input needs a label.');
    else validateText(cx, inp.label, join(path, 'label'), { warnEmpty: t !== 'boolean', name: 'The label' });
    const w = (k) => intField(cx, inp, k, path, 1, 1024, k);
    switch (t) {
      case 'text': {
        w('width');
        boolField(cx, inp, 'label_visible', path);
        if (inp.initial !== undefined && !isStr(inp.initial)) E(cx, join(path, 'initial'), '"initial" must be a string.');
        const ml = intField(cx, inp, 'max_length', path, 1, null, 'max_length');
        if (isStr(inp.initial) && inp.initial.length > (ml || S.defaults.maxLength)) {
          W(cx, join(path, 'initial'), 'The initial text is longer than max_length (' + (ml || S.defaults.maxLength) + ') — it gets cut off.', { fix: { label: 'Raise max_length', set: [{ path: join(path, 'max_length'), value: inp.initial.length }] } });
        }
        if (inp.multiline !== undefined) {
          if (!isObj(inp.multiline)) E(cx, join(path, 'multiline'), '"multiline" must be an object (it can be empty: {}).');
          else {
            intField(cx, inp.multiline, 'max_lines', join(path, 'multiline'), 1, null, 'max_lines');
            intField(cx, inp.multiline, 'height', join(path, 'multiline'), 1, 512, 'height');
            unknownKeys(cx, inp.multiline, ['max_lines', 'height'], join(path, 'multiline'), 'multiline');
          }
        }
        unknownKeys(cx, inp, ['type', 'key', 'label', 'width', 'label_visible', 'initial', 'max_length', 'multiline'], path, 'a text input');
        break;
      }
      case 'boolean': {
        boolField(cx, inp, 'initial', path);
        for (const k of ['on_true', 'on_false']) if (inp[k] !== undefined && !isStr(inp[k])) E(cx, join(path, k), q(k) + ' must be a string.');
        const a = inp.on_true !== undefined ? inp.on_true : 'true';
        const b = inp.on_false !== undefined ? inp.on_false : 'false';
        if (a === b) W(cx, join(path, 'on_true'), 'on_true and on_false send the same text, so the toggle has no effect.');
        unknownKeys(cx, inp, ['type', 'key', 'label', 'initial', 'on_true', 'on_false'], path, 'a toggle');
        break;
      }
      case 'single_option': {
        w('width');
        boolField(cx, inp, 'label_visible', path);
        const opts = inp.options;
        if (!Array.isArray(opts) || !opts.length) E(cx, join(path, 'options'), 'Add at least one option.');
        else {
          const ids = new Set();
          let initials = 0;
          opts.forEach((o, i) => {
            const op = join(join(path, 'options'), i);
            if (isStr(o)) {
              if (ids.has(o)) W(cx, op, 'Duplicate option ' + q(o) + '.');
              ids.add(o);
              return;
            }
            if (!isObj(o)) { E(cx, op, 'An option is a string or an object {"id": …}.'); return; }
            if (!isStr(o.id)) E(cx, join(op, 'id'), 'The option needs a string "id" (the value that is sent).');
            else {
              if (ids.has(o.id)) W(cx, join(op, 'id'), 'Duplicate option id ' + q(o.id) + '.');
              ids.add(o.id);
            }
            if (o.display !== undefined) validateText(cx, o.display, join(op, 'display'), {});
            if (o.initial !== undefined) { if (!isBool(o.initial)) E(cx, join(op, 'initial'), '"initial" must be true or false.'); else if (o.initial) initials++; }
            unknownKeys(cx, o, ['id', 'display', 'initial'], op, 'an option');
          });
          if (initials > 1) E(cx, join(path, 'options'), 'Only one option may be marked "initial".');
        }
        unknownKeys(cx, inp, ['type', 'key', 'label', 'width', 'label_visible', 'options'], path, 'an option picker');
        break;
      }
      case 'number_range': {
        w('width');
        let start = inp.start;
        let end = inp.end;
        if (start === undefined) E(cx, join(path, 'start'), 'The slider needs a "start" value.');
        else if (!isNum(start)) { E(cx, join(path, 'start'), '"start" must be a number.'); start = undefined; }
        if (end === undefined) E(cx, join(path, 'end'), 'The slider needs an "end" value.');
        else if (!isNum(end)) { E(cx, join(path, 'end'), '"end" must be a number.'); end = undefined; }
        if (start !== undefined && end !== undefined && start >= end) W(cx, join(path, 'end'), '"end" should be larger than "start" — otherwise the slider can\'t move.');
        if (inp.step !== undefined) {
          if (!isNum(inp.step) || inp.step <= 0) E(cx, join(path, 'step'), '"step" must be a number greater than 0.');
          else if (start !== undefined && end !== undefined && end > start && inp.step > end - start) W(cx, join(path, 'step'), '"step" is larger than the whole range.');
        }
        if (inp.initial !== undefined) {
          if (!isNum(inp.initial)) E(cx, join(path, 'initial'), '"initial" must be a number.');
          else if (start !== undefined && end !== undefined && (inp.initial < Math.min(start, end) || inp.initial > Math.max(start, end))) {
            E(cx, join(path, 'initial'), '"initial" (' + inp.initial + ') is outside the range ' + start + '…' + end + '.', { fix: { label: 'Clear it', del: [join(path, 'initial')] } });
          }
        }
        if (inp.label_format !== undefined) {
          if (!isStr(inp.label_format)) E(cx, join(path, 'label_format'), '"label_format" must be a translation key.');
          else if (!DMC.lang.has(inp.label_format, cx.ver)) {
            W(cx, join(path, 'label_format'), q(inp.label_format) + ' isn\'t a vanilla translation key — without a resource pack the label shows the raw key.', { hint: 'The default is options.generic_value ("%1$s: %2$s").' });
          } else {
            const tpl = DMC.lang.get(inp.label_format, cx.ver);
            if (!/%(?:2\$)?s/.test(tpl) && !/%2\$s/.test(tpl)) W(cx, join(path, 'label_format'), 'That text has no value placeholder, so the current number is never shown.');
          }
        }
        unknownKeys(cx, inp, ['type', 'key', 'label', 'width', 'label_format', 'start', 'end', 'step', 'initial'], path, 'a slider');
        break;
      }
      default: break;
    }
  }

  /* ------------------------------------------------------------------ *
   * Dialog
   * ------------------------------------------------------------------ */
  function validateDialog(cx, d, path, depth) {
    if (!isObj(d)) { E(cx, path, 'A dialog must be an object.'); return; }
    const savedSt = cx.st;
    const savedDepth = cx.depth;
    cx.depth = depth || 0;
    cx.st = { inputs: new Map(), usesDynamic: false, dynCustom: false, usedKeys: new Set(), templates: [] };
    if (depth > 4) W(cx, path, 'Inline dialogs are nested very deeply — consider moving some into their own files.');
    const P = (k) => join(path, k);

    // type
    let type = null;
    if (d.type === undefined) E(cx, P('type'), 'The dialog needs a "type": ' + S.dialogTypes.map((x) => x.id).join(', ') + '.');
    else if (!isStr(d.type)) E(cx, P('type'), '"type" must be a string.');
    else {
      type = S.bare(d.type);
      if (!S.typeKeys[type]) {
        const sug = U.closest(type, Object.keys(S.typeKeys));
        E(cx, P('type'), 'Unknown dialog type ' + q(d.type) + '.' + (sug ? ' Did you mean ' + q('minecraft:' + sug) + '?' : ''));
        type = null;
      } else if (d.type !== type && d.type !== 'minecraft:' + type) {
        E(cx, P('type'), 'Unknown dialog type ' + q(d.type) + ' — dialog types are in the minecraft namespace.');
        type = null;
      }
    }
    if (type) unknownKeys(cx, d, S.allowedKeys(type), path, type + ' dialogs');

    // title
    validateText(cx, d.title, P('title'), { required: true, name: 'The title', warnEmpty: true });
    if (d.external_title !== undefined) validateText(cx, d.external_title, P('external_title'), {});

    // body
    if (d.body !== undefined) {
      if (Array.isArray(d.body)) d.body.forEach((b, i) => validateBody(cx, b, P('body.' + i)));
      else validateBody(cx, d.body, P('body'));
    }
    // inputs
    if (d.inputs !== undefined) {
      if (!Array.isArray(d.inputs)) E(cx, P('inputs'), '"inputs" must be a list.');
      else d.inputs.forEach((inp, i) => validateInput(cx, inp, P('inputs.' + i)));
    }
    // common behaviour
    boolField(cx, d, 'can_close_with_escape', path);
    boolField(cx, d, 'pause', path);
    let after = 'close';
    if (d.after_action !== undefined) {
      if (!isStr(d.after_action) || !S.afterActions.some((x) => x.id === d.after_action)) {
        E(cx, P('after_action'), 'after_action must be close, none or wait_for_response.');
      } else after = d.after_action;
    }
    if (after === 'none' && d.pause !== false) {
      E(cx, P('after_action'), '"none" (stay open) requires "pause" to be false.', {
        hint: 'Otherwise the game would be paused with no way for the dialog to close in single-player.',
        fix: { label: 'Turn pause off', set: [{ path: P('pause'), value: false }] },
      });
    }
    if (after === 'wait_for_response') I(cx, P('after_action'), 'After a click a "Waiting for Response" screen replaces the dialog until the server replies. In single-player it unpauses the game.');
    if (d.pause === undefined || d.pause === true) {
      // Only a hint, shown once under the toggle
      I(cx, P('pause'), 'Pausing only happens in single-player (and LAN host). On servers it has no effect.');
    }
    if (d.can_close_with_escape === false && after === 'none') {
      W(cx, P('can_close_with_escape'), 'Players can\'t close this dialog: ESC is disabled and buttons keep it open. Only /dialog clear (or another dialog) will close it.');
    }

    // type specific
    const needColumns = () => intField(cx, d, 'columns', path, 1, null, 'columns');
    switch (type) {
      case 'notice':
        if (d.action !== undefined) validateButton(cx, d.action, P('action'), { optionalLabel: true });
        else I(cx, P('action'), 'No action button set — the game shows a default "OK" button that just closes the dialog.');
        break;
      case 'confirmation':
        for (const k of ['yes', 'no']) {
          if (d[k] === undefined) E(cx, P(k), 'A confirmation dialog needs a "' + k + '" button.');
          else validateButton(cx, d[k], P(k), {});
        }
        break;
      case 'multi_action':
        if (!Array.isArray(d.actions) || !d.actions.length) E(cx, P('actions'), 'Add at least one button to "actions".');
        else d.actions.forEach((b, i) => validateButton(cx, b, P('actions.' + i), { hintNoAction: true }));
        if (d.exit_action !== undefined) validateButton(cx, d.exit_action, P('exit_action'), {});
        else I(cx, P('exit_action'), 'No exit button — the dialog has no footer and players close it with ESC (if allowed).');
        needColumns();
        break;
      case 'server_links':
        if (d.exit_action !== undefined) validateButton(cx, d.exit_action, P('exit_action'), {});
        needColumns();
        {
          const bw = intField(cx, d, 'button_width', path, 1, null, 'button_width');
          if (bw > 1024) W(cx, P('button_width'), 'Widths above 1024 may be rejected.');
        }
        I(cx, path, 'A server-links dialog lists the links the server provides (via a plugin/mod or server config). On a vanilla server it is empty.');
        break;
      case 'dialog_list': {
        const dl = d.dialogs;
        const dp = P('dialogs');
        const refString = (s, p, inList) => {
          if (!isStr(s)) return E(cx, p, 'A dialog reference must be an id string' + (inList ? ' or an inline dialog' : '') + '.');
          if (s.startsWith('#')) {
            if (inList) return E(cx, p, 'Tags can only be used as the whole value of "dialogs", not inside a list.');
            const tag = RLu.norm(s.slice(1));
            if (!RLu.isValid(s.slice(1))) return E(cx, p, q(s) + ' is not a valid tag id.');
            if (!cx.known.tags.has('#' + tag)) W(cx, p, 'Tag ' + q('#' + tag) + ' isn\'t defined in this project. Make sure a data pack provides it.');
            return undefined;
          }
          if (!checkRL(cx, p, s, 'dialog id')) return undefined;
          const full = RLu.norm(s);
          if (!cx.known.dialogs.has(full)) W(cx, p, 'Dialog ' + q(full) + ' isn\'t in this project. Make sure a data pack provides it.');
          return undefined;
        };
        if (dl === undefined) E(cx, dp, 'A dialog list needs "dialogs" — an id, a #tag, an inline dialog, or a list of them.');
        else if (isStr(dl)) refString(dl, dp, false);
        else if (isObj(dl)) validateDialog(cx, dl, dp, (depth || 0) + 1);
        else if (Array.isArray(dl)) {
          if (!dl.length) W(cx, dp, 'The list is empty, so this dialog has no buttons.');
          dl.forEach((e, i) => {
            if (isObj(e)) validateDialog(cx, e, join(dp, i), (depth || 0) + 1);
            else refString(e, join(dp, i), true);
          });
        } else E(cx, dp, '"dialogs" must be an id, a #tag, an inline dialog, or a list.');
        if (d.exit_action !== undefined) validateButton(cx, d.exit_action, P('exit_action'), {});
        needColumns();
        intField(cx, d, 'button_width', path, 1, 1024, 'button_width');
        I(cx, dp, 'Each button is labelled with the target dialog\'s "external_title" (or its title).');
        break;
      }
      default: break;
    }

    // post pass: template keys + input usage
    checkTemplates(cx);
    const st = cx.st;
    if (st.inputs.size) {
      if (!st.usesDynamic) {
        W(cx, P('inputs'), 'These inputs are never sent anywhere — only "Run command with inputs" (dynamic/run_command) and "Custom event with inputs" (dynamic/custom) buttons submit them.', {
          hint: 'Change a button\'s action to one of those, or remove the inputs.',
        });
      } else if (!st.dynCustom) {
        for (const [k, v] of st.inputs) {
          if (!st.usedKeys.has(k)) I(cx, join(v.path, 'key'), 'Nothing uses $(' + k + ') — the value is collected but never sent.');
        }
      }
    } else if (st.usesDynamic && !st.templates.length) {
      W(cx, path, 'A "with inputs" action is used but the dialog has no inputs.');
    } else if (st.templates.length) {
      // templates referencing keys without any inputs are reported by checkTemplates
    }

    cx.st = savedSt;
    cx.depth = savedDepth;
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */
  function summarize(issues) {
    const counts = { error: 0, warn: 0, info: 0 };
    for (const i of issues) counts[i.level]++;
    return counts;
  }

  /**
   * @param {object} dialog dialog JSON value
   * @param {{ver:string, dialogIds?:string[], tagIds?:string[]}} opts
   */
  V.dialog = function (dialog, opts) {
    const cx = makeCx(opts);
    cx.st = { inputs: new Map(), usesDynamic: false, dynCustom: false, usedKeys: new Set(), templates: [] };
    validateDialog(cx, dialog, '', 0);
    return { issues: cx.issues, counts: summarize(cx.issues) };
  };

  /** Validate a single Text value (used for raw-JSON fields in the editor). */
  V.text = function (value, opts) {
    const cx = makeCx(opts);
    cx.st = { inputs: new Map(), usesDynamic: false, dynCustom: false, usedKeys: new Set(), templates: [] };
    validateText(cx, value, '', { required: true });
    return { issues: cx.issues, counts: summarize(cx.issues) };
  };

  /** Validate an item stack object (used for raw item editors). */
  V.item = function (value, opts) {
    const cx = makeCx(opts);
    validateItemStack(cx, value, '', {});
    return { issues: cx.issues, counts: summarize(cx.issues) };
  };

  /** Dialog / tag id sanity for a project. */
  V.id = function (ns, path) {
    const out = [];
    if (!ns || !RLu.NS_RE.test(ns)) out.push('Namespace must use only lowercase letters, digits, _ . -');
    if (!path || !RLu.PATH_RE.test(path)) out.push('Dialog name must use only lowercase letters, digits, _ . - and /');
    return out;
  };

  V.summarize = summarize;
})();
