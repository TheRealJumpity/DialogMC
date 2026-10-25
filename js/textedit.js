/* Dialog MC — rich text composer. Edits any Minecraft text component as a list of parts:
 * plain text, translations, keybinds, item/block icons, player heads, selectors, scores, NBT — each with
 * colors, formats, fonts, click/hover events and children. Works on any binding (store path or virtual). */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const U = DMC.util;
  const h = U.h;
  const T = DMC.text;
  const St = DMC.store;
  const F = DMC.fields;
  const R = DMC.render;
  const Pick = DMC.pick;
  const TE = (DMC.textedit = {});
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  St.ui.teJson = St.ui.teJson || new Set();
  St.ui.partOpen = St.ui.partOpen || new Set();

  const KIND_ICON = { text: 'type', translatable: 'globe', keybind: 'command', sprite: 'box', head: 'user', score: 'hash', selector: 'user', nbt: 'code', unknown: 'help' };
  const INSERT_ITEMS = [
    { id: 'text', label: 'Text', desc: 'Words you type', icon: 'type', group: 'Content' },
    { id: 'translatable', label: 'Translation', desc: 'Vanilla text in the player’s language', icon: 'globe', group: 'Content' },
    { id: 'keybind', label: 'Keybind', desc: 'The key the player uses, e.g. “Space”', icon: 'command', group: 'Content' },
    { id: 'sprite', label: 'Item or block icon', desc: 'A small picture inside the text', icon: 'box', group: 'Pictures' },
    { id: 'head', label: 'Player head', desc: 'A player’s face', icon: 'user', group: 'Pictures' },
    { id: 'selector', label: 'Player or entity name', desc: 'A selector like @p', icon: 'user', group: 'Filled in by the game, not by dialogs', tag: 'not resolved' },
    { id: 'score', label: 'Scoreboard value', icon: 'hash', group: 'Filled in by the game, not by dialogs', tag: 'not resolved' },
    { id: 'nbt', label: 'NBT data', icon: 'code', group: 'Filled in by the game, not by dialogs', tag: 'not resolved' },
  ];
  const FONTS = [
    { id: '', label: 'Default' },
    { id: 'minecraft:uniform', label: 'Uniform (Unicode)' },
    { id: 'minecraft:alt', label: 'Alt (enchanting table)' },
    { id: 'minecraft:illageralt', label: 'Illager alt' },
  ];
  const FLAG_LABEL = { bold: 'Bold', italic: 'Italic', underlined: 'Underline', strikethrough: 'Strikethrough', obfuscated: 'Obfuscated (scrambled)' };
  const FLAG_GLYPH = { bold: 'B', italic: 'I', underlined: 'U', strikethrough: 'S', obfuscated: '?' };

  function uuidv4() {
    const b = new Uint8Array(16);
    (window.crypto || { getRandomValues: (a) => a.forEach((_, i) => { a[i] = (Math.random() * 256) | 0; }) }).getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /** Deep copy of a part without undefined values and with simplified children. */
  function cleanPart(p) {
    const o = {};
    for (const k of Object.keys(p)) {
      const v = p[k];
      if (v === undefined) continue;
      if (k === 'extra') {
        if (Array.isArray(v) && v.length) o.extra = v.map((c) => (isObj(c) ? T.simplifyPart(cleanPart(c)) : c));
        continue;
      }
      o[k] = v;
    }
    return o;
  }
  const finalize = (parts) => T.fromParts(parts.map(cleanPart));

  function convertKind(part, kind) {
    const keep = {};
    for (const k of T.STYLE_KEYS.concat(['extra'])) if (part[k] !== undefined) keep[k] = part[k];
    return Object.assign(T.make(kind), keep);
  }

  const isCompactPart = (part) => T.kindOf(part) === 'text';

  /* ------------------------------------------------------------------ *
   * Build
   * cfg: {bind, label?, multiline?, placeholder?, rows?, key?, nested?, depth?, required?, preview?}
   * ------------------------------------------------------------------ */
  TE.build = function (cfg) {
    const b = F.toBinding(cfg.bind);
    const key = cfg.key || b.path || 'te' + U.uid();
    const depth0 = cfg.depth || 0;
    const root = h('div', { class: 'te' + (cfg.nested ? ' nested' : ''), 'data-path': b.path != null ? b.path : null });
    const ver = () => St.version();

    function content() {
      root.textContent = '';
      if (St.ui.teJson.has(key)) { root.appendChild(jsonView()); return; }
      const value = b.get();
      let parts = U.clone(T.toParts(value));
      if (!parts.length) parts = [{ text: '' }];
      const shape = Array.isArray(value) && value.length && !(value[0] === '' || (isObj(value[0]) && Object.keys(value[0]).length === 1 && value[0].text === '')) ? 'merged' : Array.isArray(value) ? 'list' : 'single';
      const rootPath = b.path;
      const pathOf = (i) => (rootPath == null ? null : shape === 'list' ? rootPath + '.' + (i + 1) : rootPath);
      const kidPath = (partPath, j) => (partPath == null ? null : shape === 'merged' && partPath === rootPath ? partPath + '.' + (j + 1) : partPath + '.extra.' + j);

      let previewEl = null;
      const updatePreview = (v) => {
        if (!previewEl) return;
        previewEl.textContent = '';
        if (T.isEmpty(v)) previewEl.appendChild(h('span', { style: 'color:var(--faint);font-family:var(--sans);font-size:12.5px;text-shadow:none' }, 'Empty'));
        else previewEl.appendChild(R.runs(v, ver(), { interactive: false }));
      };
      const commit = (structural) => {
        const v = finalize(parts);
        b.set(v, structural);
        if (!structural) updatePreview(v);
      };

      const listCtx = {
        parts, depth: depth0, onChange: commit, multiline: !!cfg.multiline, placeholder: cfg.placeholder, rows: cfg.rows,
        pathOf, kidPath, key, requireFocusAfter: (i) => DMC.editor && DMC.editor.requestFocus(key + '#' + i),
      };
      root.appendChild(renderList(listCtx));

      const compact = parts.length === 1 && isCompactPart(parts[0]);
      const rich = !(typeof value === 'string' || value === undefined);
      if (!compact || rich) {
        if (cfg.preview !== false) {
          previewEl = h('div', { class: 'te-preview', 'aria-label': 'Preview' });
          updatePreview(value);
          root.appendChild(previewEl);
        }
      }
      if (!compact) {
        root.appendChild(h('div', { class: 'te-add' },
          h('button', { type: 'button', class: 'btn sm', onclick: (e) => insertMenu(e.currentTarget, parts, commit, listCtx) }, U.icon('plus', 14), 'Add'),
          h('span', { class: 'grow', style: 'flex:1' }),
          h('button', { type: 'button', class: 'btn sm ghost', onclick: () => { St.ui.teJson.add(key); content(); } }, U.icon('code', 14), 'JSON')));
      }
    }

    function jsonView() {
      const wrap = h('div', { class: 'stack-s' });
      const v = b.get();
      const ta = h('textarea', { class: 'inp mono', rows: 6, spellcheck: 'false', 'aria-label': 'Text component as JSON' });
      ta.value = v === undefined ? '""' : JSON.stringify(v, null, 2);
      const err = h('div', { class: 'msg error', hidden: true });
      ta.addEventListener('input', () => {
        const r = DMC.snbt.parseLoose(ta.value);
        if (!r.ok) {
          err.hidden = false;
          err.textContent = 'Not valid JSON yet: ' + r.error.message + ' (character ' + (r.error.pos + 1) + ')';
          ta.classList.add('bad');
          return;
        }
        err.hidden = true;
        ta.classList.remove('bad');
        b.set(r.value, false);
      });
      wrap.appendChild(ta);
      wrap.appendChild(err);
      wrap.appendChild(h('div', { class: 'te-add' }, h('button', { type: 'button', class: 'btn sm', onclick: () => { St.ui.teJson.delete(key); b.set(b.get(), true); } }, U.icon('type', 14), 'Back to the editor')));
      return wrap;
    }

    content();
    root._rebuild = content;
    return root;
  };

  /* ------------------------------------------------------------------ *
   * Insert menu (adds a part of the chosen kind at the end of a parts list)
   * ------------------------------------------------------------------ */
  function insertMenu(anchor, parts, commit, ctx, after) {
    Pick.menu(anchor, INSERT_ITEMS, {
      width: 330,
      onPick: (it) => {
        const part = T.make(it.id);
        const idx = after == null ? parts.length : after + 1;
        parts.splice(idx, 0, part);
        if (it.id === 'sprite') part.sprite = 'item/diamond';
        if (ctx.requireFocusAfter) ctx.requireFocusAfter(idx);
        commit(true);
      },
    });
  }

  /* ------------------------------------------------------------------ *
   * Parts list
   * ------------------------------------------------------------------ */
  function renderList(ctx) {
    const wrap = h('div', { class: 'te-parts' });
    const { parts } = ctx;
    const compactMode = ctx.depth === 0 && parts.length === 1 && isCompactPart(parts[0]) && !(parts[0].extra && parts[0].extra.length);
    parts.forEach((part, i) => {
      wrap.appendChild(partCard(part, Object.assign({}, ctx, { index: i, compact: compactMode, path: ctx.pathOf(i), fk: ctx.key + '#' + i })));
    });
    return wrap;
  }

  /* ------------------------------------------------------------------ *
   * One part
   * ------------------------------------------------------------------ */
  function partCard(part, ctx) {
    const kind = T.kindOf(part);
    const pkey = (ctx.path || ctx.fk) + '|adv';
    const card = h('div', { class: 'part' + (ctx.compact ? ' compact' : ''), 'data-path': ctx.path != null ? ctx.path : null });
    const head = h('div', { class: 'part-h' });
    const onChange = ctx.onChange;

    // kind selector (list mode)
    if (!ctx.compact) {
      const sel = h('select', { class: 'inp kind', 'aria-label': 'Type of this part' });
      for (const k of T.KINDS) sel.appendChild(h('option', { value: k.id }, k.label));
      if (kind === 'unknown') sel.appendChild(h('option', { value: 'unknown' }, 'Unrecognized'));
      sel.value = kind;
      sel.addEventListener('change', () => {
        ctx.parts[ctx.index] = convertKind(part, sel.value);
        onChange(true);
      });
      head.appendChild(sel);
    }

    head.appendChild(mainControls(part, kind, ctx));

    const tools = h('div', { class: 'part-tools' });
    const fmt = fmtButtons(part, ctx, ctx.compact ? ['bold', 'italic'] : T.FLAGS);
    const colorBtn = colorButton(part, ctx);
    tools.appendChild(fmt);
    tools.appendChild(colorBtn);

    const advBtn = h('button', { type: 'button', class: 'btn icon sm ghost', 'aria-label': 'More options for this part', title: 'Font, shadow, click and hover actions, children', 'aria-expanded': String(St.ui.partOpen.has(pkey)) }, U.icon('sliders', 15));
    tools.appendChild(advBtn);
    if (ctx.compact) {
      tools.appendChild(h('button', { type: 'button', class: 'btn icon sm ghost', 'aria-label': 'Insert something after this text', title: 'Insert translation, keybind, icon, player head…', onclick: (e) => insertMenu(e.currentTarget, ctx.parts, onChange, ctx, ctx.index) }, U.icon('plus', 15)));
    } else {
      const i = ctx.index;
      const len = ctx.parts.length;
      tools.appendChild(F.iconBtn('arrow-up', 'Move up', () => { const [x] = ctx.parts.splice(i, 1); ctx.parts.splice(i - 1, 0, x); onChange(true); }, { disabled: i === 0 }));
      tools.appendChild(F.iconBtn('arrow-down', 'Move down', () => { const [x] = ctx.parts.splice(i, 1); ctx.parts.splice(i + 1, 0, x); onChange(true); }, { disabled: i >= len - 1 }));
      tools.appendChild(F.iconBtn('copy', 'Duplicate', () => { ctx.parts.splice(i + 1, 0, U.clone(part)); onChange(true); }));
      tools.appendChild(F.iconBtn('trash', 'Remove', () => { ctx.parts.splice(i, 1); onChange(true); }, { danger: true }));
    }
    head.appendChild(tools);
    card.appendChild(head);

    // translation arguments
    if (kind === 'translatable') card.appendChild(translationArgs(part, ctx));

    // advanced
    let advEl = null;
    const toggleAdv = (open) => {
      if (open) St.ui.partOpen.add(pkey); else St.ui.partOpen.delete(pkey);
      advBtn.setAttribute('aria-expanded', String(open));
      advBtn.classList.toggle('on', open);
      if (open && !advEl) { advEl = advancedPanel(part, kind, ctx); card.insertBefore(advEl, kidsEl || null); }
      if (advEl) advEl.hidden = !open;
      if (open && DMC.editor) DMC.editor.applyIssues();
    };
    let kidsEl = null;
    if (Array.isArray(part.extra) && part.extra.length) {
      part.extra = part.extra.map(T.normPart);
      kidsEl = h('div', { class: 'part-children' }, renderList({
        parts: part.extra, depth: ctx.depth + 1, onChange, multiline: ctx.multiline,
        pathOf: (j) => (ctx.path == null ? null : ctx.kidPath(ctx.path, j)), kidPath: ctx.kidPath, key: ctx.fk + '>', requireFocusAfter: ctx.requireFocusAfter,
      }));
      card.appendChild(kidsEl);
      kidsEl.appendChild(h('div', { class: 'te-add' }, h('button', { type: 'button', class: 'btn xs', onclick: (e) => insertMenu(e.currentTarget, part.extra, onChange, ctx) }, U.icon('plus', 12), 'Add to this group')));
    }
    advBtn.addEventListener('click', () => toggleAdv(advBtn.getAttribute('aria-expanded') !== 'true'));
    if (St.ui.partOpen.has(pkey)) { advBtn.classList.add('on'); toggleAdv(true); }
    card.appendChild(h('div', { class: 'fld-msgs' }));
    return card;
  }

  /* ------------------------------------------------------------------ *
   * Format buttons and color
   * ------------------------------------------------------------------ */
  function fmtButtons(part, ctx, flags) {
    const wrap = h('div', { class: 'fmt', role: 'group', 'aria-label': 'Text style' });
    for (const f of flags) {
      const btn = h('button', { type: 'button', title: FLAG_LABEL[f], 'aria-label': FLAG_LABEL[f] });
      const paint = () => {
        const v = part[f];
        btn.setAttribute('aria-pressed', String(v === true));
        btn.classList.toggle('tri-false', v === false);
        btn.title = FLAG_LABEL[f] + (v === false ? ' (forced off)' : '');
      };
      btn.textContent = FLAG_GLYPH[f];
      btn.style.fontStyle = f === 'italic' ? 'italic' : '';
      btn.style.textDecoration = f === 'underlined' ? 'underline' : f === 'strikethrough' ? 'line-through' : '';
      btn.style.fontWeight = f === 'bold' ? '700' : '';
      paint();
      btn.addEventListener('click', () => {
        const nested = ctx.depth > 0;
        const cur = part[f];
        if (cur === undefined) part[f] = true;
        else if (cur === true) { if (nested) part[f] = false; else delete part[f]; } else delete part[f];
        paint();
        ctx.onChange(false);
      });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function colorButton(part, ctx) {
    const sw = h('span', { class: 'swatch' + (part.color ? '' : ' none') });
    const paint = () => {
      const css = T.colorToCss(part.color);
      sw.classList.toggle('none', !css);
      sw.style.setProperty('--sw', css || 'transparent');
      btn.title = part.color ? 'Color: ' + part.color.replace(/_/g, ' ') : 'Color (inherits)';
    };
    const btn = h('button', { type: 'button', class: 'btn icon sm ghost', 'aria-label': 'Text color', onclick: (e) => {
      Pick.color(e.currentTarget, { value: part.color, onPick: (c) => { if (c === undefined) delete part.color; else part.color = c; paint(); ctx.onChange(false); } });
    } }, sw);
    paint();
    return btn;
  }

  /* ------------------------------------------------------------------ *
   * Main controls per kind
   * ------------------------------------------------------------------ */
  function textInput(part, key, ctx, o) {
    o = o || {};
    const multi = o.multiline;
    const el = h(multi ? 'textarea' : 'input', {
      class: 'inp' + (o.mono ? ' mono' : ''), type: multi ? null : 'text', rows: multi ? (ctx.rows || 1) : null, placeholder: o.placeholder || '',
      spellcheck: 'false', autocomplete: 'off', 'aria-label': o.aria || 'Value', 'data-fk': o.fk || null,
    });
    el.value = part[key] == null ? '' : String(part[key]);
    el.addEventListener('input', () => {
      if (el.value === '' && o.del) delete part[key];
      else part[key] = el.value;
      ctx.onChange(false);
      if (o.after) o.after(el.value);
    });
    if (multi) F.autosize(el, 8);
    return el;
  }
  function iconBtn(icon, label, onclick) {
    return h('button', { type: 'button', class: 'btn icon sm', 'aria-label': label, title: label, onclick }, U.icon(icon, 15));
  }

  function mainControls(part, kind, ctx) {
    const wrap = h('div', { class: 'part-main', style: 'flex-wrap:wrap' });
    const ver = St.version();
    switch (kind) {
      case 'text': {
        wrap.appendChild(textInput(part, 'text', ctx, { multiline: ctx.multiline, placeholder: ctx.placeholder || 'Type text…', fk: ctx.fk, aria: 'Text' }));
        break;
      }
      case 'translatable': {
        const hint = h('div', { class: 'hint', style: 'flex-basis:100%;margin-top:-2px' });
        const refresh = () => {
          const t = DMC.lang.get(part.translate, ver);
          hint.textContent = t != null ? '→ ' + t : part.translate ? 'Not a vanilla key — add a fallback text or a resource pack.' : '';
          hint.style.color = t != null || !part.translate ? '' : 'var(--warn)';
        };
        const input = textInput(part, 'translate', ctx, { mono: true, placeholder: 'e.g. gui.back', fk: ctx.fk, aria: 'Translation key', after: refresh });
        wrap.appendChild(input);
        wrap.appendChild(iconBtn('search', 'Browse vanilla translations', (e) => Pick.lang(e.currentTarget, { onPick: (k) => { part.translate = k; input.value = k; refresh(); ctx.onChange(true); } })));
        refresh();
        wrap.appendChild(hint);
        break;
      }
      case 'keybind': {
        const hint = h('div', { class: 'hint', style: 'flex-basis:100%;margin-top:-2px' });
        const refresh = () => {
          const d = DMC.keys.defaults[part.keybind];
          hint.textContent = d ? 'Shows “' + d + '” with default controls — the player’s own key if they changed it.' : 'Shows the player’s key for this action.';
        };
        const input = textInput(part, 'keybind', ctx, { mono: true, placeholder: 'key.jump', fk: ctx.fk, aria: 'Keybind id', after: refresh });
        wrap.appendChild(input);
        wrap.appendChild(iconBtn('search', 'Pick a control', (e) => Pick.keybind(e.currentTarget, { onPick: (k) => { part.keybind = k; input.value = k; refresh(); ctx.onChange(true); } })));
        refresh();
        wrap.appendChild(hint);
        break;
      }
      case 'sprite': {
        const input = textInput(part, 'sprite', ctx, { mono: true, placeholder: 'item/diamond', fk: ctx.fk, aria: 'Sprite id' });
        wrap.appendChild(input);
        const pickBtn = h('button', { type: 'button', class: 'btn sm', onclick: (e) => {
          Pick.menu(e.currentTarget, [
            { id: 'item', label: 'Pick an item…', icon: 'box' },
            { id: 'block', label: 'Pick a block…', icon: 'cube' },
            { id: 'effect', label: 'Pick an effect icon…', icon: 'zap' },
          ], { width: 240, onPick: (it) => {
            const anchor = e.currentTarget;
            if (it.id === 'effect') {
              Pick.registry(anchor, { kind: 'effects', custom: false, onPick: (id) => { part.atlas = 'minecraft:mob_effects'; part.sprite = DMC.rl.bare(id); ctx.onChange(true); } });
            } else {
              Pick.registry(anchor, { kind: it.id === 'item' ? 'items' : 'blocks', custom: false, onPick: (id) => {
                const bare = DMC.rl.bare(id);
                part.sprite = (it.id === 'block' || R.isBlockItem(bare) ? 'block/' : 'item/') + bare;
                delete part.atlas;
                ctx.onChange(true);
              } });
            }
          } });
        } }, U.icon('box', 14), 'Pick');
        wrap.appendChild(pickBtn);
        break;
      }
      case 'head': {
        const getName = () => (typeof part.player === 'string' ? part.player : isObj(part.player) ? part.player.name || '' : '');
        const input = h('input', { class: 'inp', type: 'text', value: getName(), placeholder: 'Player name, e.g. Steve', spellcheck: 'false', 'aria-label': 'Player name', 'data-fk': ctx.fk });
        input.addEventListener('input', () => {
          if (isObj(part.player)) { if (input.value) part.player.name = input.value; else delete part.player.name; } else part.player = input.value;
          ctx.onChange(false);
        });
        wrap.appendChild(input);
        const hat = h('label', { class: 'sw-row', style: 'gap:6px;min-height:28px' }, F.sw(part.hat !== false, (on) => { if (on) delete part.hat; else part.hat = false; ctx.onChange(false); }, { label: 'Show hat layer' }), h('span', { class: 'hint' }, 'Hat layer'));
        wrap.appendChild(hat);
        break;
      }
      case 'score': {
        const sc = isObj(part.score) ? part.score : (part.score = { name: '', objective: '' });
        const n = h('input', { class: 'inp mono', value: sc.name || '', placeholder: 'Player or @p', 'aria-label': 'Score holder', spellcheck: 'false', 'data-fk': ctx.fk });
        const o = h('input', { class: 'inp mono', value: sc.objective || '', placeholder: 'objective', 'aria-label': 'Objective', spellcheck: 'false' });
        n.addEventListener('input', () => { sc.name = n.value; ctx.onChange(false); });
        o.addEventListener('input', () => { sc.objective = o.value; ctx.onChange(false); });
        wrap.appendChild(n);
        wrap.appendChild(o);
        break;
      }
      case 'selector': {
        const input = textInput(part, 'selector', ctx, { mono: true, placeholder: '@p', fk: ctx.fk, aria: 'Selector' });
        wrap.appendChild(input);
        const chips = h('div', { class: 'cluster', style: 'flex-basis:100%;gap:4px' });
        for (const s of ['@p', '@a', '@r', '@s', '@e', '@n']) chips.appendChild(h('button', { type: 'button', class: 'btn xs', onclick: () => { part.selector = s; input.value = s; ctx.onChange(false); } }, s));
        wrap.appendChild(chips);
        break;
      }
      case 'nbt': {
        wrap.appendChild(textInput(part, 'nbt', ctx, { mono: true, placeholder: 'NBT path, e.g. Pos[0]', fk: ctx.fk, aria: 'NBT path' }));
        const src = part.source || (part.block !== undefined ? 'block' : part.entity !== undefined ? 'entity' : 'storage');
        const sel = h('select', { class: 'inp', style: 'width:auto', 'aria-label': 'Data source' }, h('option', { value: 'storage' }, 'Storage'), h('option', { value: 'entity' }, 'Entity'), h('option', { value: 'block' }, 'Block'));
        sel.value = src;
        const srcInput = h('input', { class: 'inp mono', placeholder: src === 'storage' ? 'minecraft:example' : src === 'entity' ? '@s' : '~ ~ ~', 'aria-label': 'Source', spellcheck: 'false' });
        srcInput.value = part[src] || '';
        sel.addEventListener('change', () => {
          delete part.block; delete part.entity; delete part.storage;
          part.source = sel.value;
          part[sel.value] = sel.value === 'storage' ? 'minecraft:example' : sel.value === 'entity' ? '@s' : '~ ~ ~';
          ctx.onChange(true);
        });
        srcInput.addEventListener('input', () => { part[sel.value] = srcInput.value; ctx.onChange(false); });
        wrap.appendChild(sel);
        wrap.appendChild(srcInput);
        break;
      }
      default:
        wrap.appendChild(h('div', { class: 'msg warn', style: 'flex:1' }, 'This component isn’t recognized. Edit it as JSON.'));
    }
    return wrap;
  }

  /** `with` arguments of a translation */
  function translationArgs(part, ctx) {
    const ver = St.version();
    const tpl = DMC.lang.get(part.translate, ver);
    const need = tpl ? (tpl.match(/%(?:\d+\$)?s/g) || []).length : 0;
    const have = Array.isArray(part.with) ? part.with.length : 0;
    const box = h('div', { class: 'part-adv' });
    if (!need && !have) {
      box.appendChild(h('div', { class: 'cluster' }, h('button', { type: 'button', class: 'btn xs', onclick: () => { part.with = ['']; ctx.onChange(true); } }, U.icon('plus', 12), 'Add argument'), h('span', { class: 'hint' }, 'Only needed when the text contains %s')));
      return box;
    }
    const n = Math.max(need, have);
    if (!Array.isArray(part.with)) part.with = [];
    while (part.with.length < n) part.with.push('');
    const pre = ctx.path != null ? ctx.path + '.with.' : null;
    const rows = h('div', { class: 'stack-s' });
    part.with.forEach((a, i) => {
      const slot = tpl && tpl.includes('%' + (i + 1) + '$s') ? '%' + (i + 1) + '$s' : '%s';
      const te = TE.build({
        bind: F.objBind(part.with, i, ctx.onChange, pre ? pre + i : null),
        key: ctx.fk + '.with' + i, nested: true, depth: ctx.depth + 1, placeholder: 'Argument ' + (i + 1), preview: false,
      });
      rows.appendChild(h('div', { class: 'te-line' },
        h('span', { class: 'hint mono', style: 'min-width:34px;padding-top:7px' }, slot),
        h('div', { style: 'flex:1;min-width:0' }, te),
        i >= need ? F.iconBtn('x', 'Remove argument', () => { part.with.splice(i, 1); if (!part.with.length) delete part.with; ctx.onChange(true); }) : null));
    });
    box.appendChild(rows);
    box.appendChild(h('div', { class: 'cluster' }, h('button', { type: 'button', class: 'btn xs', onclick: () => { part.with.push(''); ctx.onChange(true); } }, U.icon('plus', 12), 'Add argument')));
    return box;
  }

  /* ------------------------------------------------------------------ *
   * Advanced panel
   * ------------------------------------------------------------------ */
  function advancedPanel(part, kind, ctx) {
    const box = h('div', { class: 'part-adv' });
    const onChange = ctx.onChange;
    const pp = ctx.path;

    if (ctx.compact) {
      box.appendChild(F.field('Style', fmtButtons(part, ctx, T.FLAGS), { hint: 'Bold, italic, underline, strikethrough, scrambled' }));
    }

    // font + shadow + insertion
    const fontSel = h('select', { class: 'inp', 'aria-label': 'Font' });
    const known = FONTS.some((f) => f.id === (part.font || ''));
    for (const f of FONTS) fontSel.appendChild(h('option', { value: f.id }, f.label));
    if (!known) fontSel.appendChild(h('option', { value: part.font }, part.font));
    fontSel.value = part.font || '';
    fontSel.addEventListener('change', () => { if (fontSel.value) part.font = fontSel.value; else delete part.font; onChange(false); });
    box.appendChild(h('div', { class: 'grid2' },
      F.field('Font', fontSel, { hint: 'Resource packs can add more' }),
      F.field('Shadow', shadowControl(part, onChange))));

    const ins = h('input', { class: 'inp', type: 'text', value: part.insertion || '', placeholder: 'Text added to the chat box on shift-click', 'aria-label': 'Insertion text', spellcheck: 'false' });
    ins.addEventListener('input', () => { if (ins.value) part.insertion = ins.value; else delete part.insertion; onChange(false); });
    box.appendChild(F.field('Insertion', ins, { hint: 'Chat only' }));

    // kind specific
    if (kind === 'translatable') {
      const fb = h('input', { class: 'inp', type: 'text', value: typeof part.fallback === 'string' ? part.fallback : '', placeholder: 'Shown when the key is missing', 'aria-label': 'Fallback text', spellcheck: 'false' });
      fb.addEventListener('input', () => { if (fb.value) part.fallback = fb.value; else delete part.fallback; onChange(false); });
      box.appendChild(F.field('Fallback', fb, { hint: 'Used when the key isn’t in the language files' }));
    }
    if (kind === 'sprite') {
      const sel = h('select', { class: 'inp', 'aria-label': 'Atlas' });
      const atlases = ['minecraft:blocks', 'minecraft:gui', 'minecraft:mob_effects', 'minecraft:paintings', 'minecraft:particles', 'minecraft:items'];
      const cur = part.atlas || 'minecraft:blocks';
      for (const a of atlases) sel.appendChild(h('option', { value: a }, a.replace('minecraft:', '')));
      if (!atlases.includes(cur)) sel.appendChild(h('option', { value: cur }, cur));
      sel.value = cur;
      sel.addEventListener('change', () => { if (sel.value === 'minecraft:blocks') delete part.atlas; else part.atlas = sel.value; onChange(false); });
      box.appendChild(F.field('Texture atlas', sel, { hint: 'Where the sprite id is looked up. Resource-pack textures work too.' }));
    }
    if ((kind === 'sprite' || kind === 'head') && DMC.ver.has.objectFallback(St.version())) {
      box.appendChild(F.field('Fallback text', TE.build({ bind: F.objBind(part, 'fallback', onChange, pp ? pp + '.fallback' : null), key: ctx.fk + '.fallback', nested: true, depth: ctx.depth + 1, preview: false, placeholder: 'Shown if the sprite can’t be drawn' }), { hint: 'New in 26.1' }));
    }
    if (kind === 'head') box.appendChild(profileEditor(part, onChange));
    if (kind === 'selector' || kind === 'nbt' || kind === 'score') {
      if (kind !== 'score') box.appendChild(F.field('Separator', TE.build({ bind: F.objBind(part, 'separator', onChange, pp ? pp + '.separator' : null), key: ctx.fk + '.sep', nested: true, depth: ctx.depth + 1, preview: false, placeholder: 'Between several results, default “, ”' }), {}));
    }
    if (kind === 'nbt') {
      const row = h('div', { class: 'cluster' },
        h('label', { class: 'sw-row' }, F.sw(part.interpret === true, (on) => { if (on) part.interpret = true; else delete part.interpret; onChange(true); }, { label: 'Interpret as text component' }), h('span', null, 'Treat the data as a text component')));
      if (DMC.ver.has.nbtPlain(St.version())) row.appendChild(h('label', { class: 'sw-row' }, F.sw(part.plain === true, (on) => { if (on) part.plain = true; else delete part.plain; onChange(true); }, { label: 'Plain' }), h('span', null, 'Plain text'), h('span', { class: 'hint' }, 'New in 26.1')));
      box.appendChild(row);
    }

    // click
    box.appendChild(F.field('When clicked', DMC.actions.buildClick(F.objBind(part, 'click_event', onChange, pp ? pp + '.click_event' : null)), { path: pp ? pp + '.click_event' : null, hint: 'Makes the text a link' }));
    // hover
    box.appendChild(F.field('When hovered', hoverEditor(part, ctx), { path: pp ? pp + '.hover_event' : null }));

    // group + JSON
    const foot = h('div', { class: 'cluster' });
    foot.appendChild(h('button', { type: 'button', class: 'btn sm', onclick: () => {
      const n = (part.extra || []).length;
      part.extra = (part.extra || []).concat([{ text: '' }]);
      if (DMC.editor) DMC.editor.requestFocus(ctx.fk + '>#' + n);
      onChange(true);
    } }, U.icon('plus', 14), 'Add text that inherits this style'));
    foot.appendChild(h('button', { type: 'button', class: 'btn sm ghost', onclick: () => {
      St.ui.teJson.add(ctx.key.replace(/#.*$/, ''));
      onChange(true);
    } }, U.icon('code', 14), 'Edit all as JSON'));
    box.appendChild(foot);
    return box;
  }

  function shadowControl(part, onChange) {
    const has = part.shadow_color !== undefined;
    const sw = h('span', { class: 'swatch' + (has ? '' : ' none') });
    const label = h('span', null);
    const paint = () => {
      const css = T.argbToCss(part.shadow_color);
      sw.classList.toggle('none', !css);
      sw.style.setProperty('--sw', css || 'transparent');
      const dec = T.argbDecode(part.shadow_color);
      label.textContent = part.shadow_color === undefined ? 'Default (darker text color)' : dec && dec.a === 0 ? 'No shadow' : dec ? 'Custom · ' + Math.round(dec.a * 100) + '% opacity' : 'Custom';
    };
    paint();
    return h('button', { type: 'button', class: 'btn', style: 'justify-content:flex-start;width:100%', onclick: (e) => Pick.argb(e.currentTarget, { value: part.shadow_color, onPick: (v) => { if (v === undefined) delete part.shadow_color; else part.shadow_color = v; paint(); onChange(false); } }) }, sw, label);
  }

  function profileEditor(part, onChange) {
    const p = isObj(part.player) ? part.player : null;
    const box = h('div', { class: 'stack-s' });
    const toggle = h('label', { class: 'sw-row' }, F.sw(!!p, (on) => {
      if (on) part.player = { name: typeof part.player === 'string' ? part.player : '' };
      else part.player = isObj(part.player) && part.player.name ? part.player.name : '';
      onChange(true);
    }, { label: 'Use full skin profile' }), h('span', null, 'Use a full profile (UUID, texture…)'));
    box.appendChild(toggle);
    if (p) {
      const uuid = h('div', { class: 'inp-row' });
      const uin = h('input', { class: 'inp mono', placeholder: '00000000-0000-0000-0000-000000000000', value: typeof p.id === 'string' ? p.id : '', 'aria-label': 'Player UUID', spellcheck: 'false' });
      uin.addEventListener('input', () => { if (uin.value) p.id = uin.value; else delete p.id; onChange(false); });
      uuid.appendChild(uin);
      const tex = h('input', { class: 'inp mono', placeholder: 'minecraft:entity/player/wide/steve', value: p.texture || '', 'aria-label': 'Skin texture', spellcheck: 'false' });
      tex.addEventListener('input', () => { if (tex.value) p.texture = tex.value; else delete p.texture; onChange(false); });
      const model = h('select', { class: 'inp', 'aria-label': 'Model' }, h('option', { value: '' }, 'Default'), h('option', { value: 'wide' }, 'Wide'), h('option', { value: 'slim' }, 'Slim'));
      model.value = p.model || '';
      model.addEventListener('change', () => { if (model.value) p.model = model.value; else delete p.model; onChange(false); });
      box.appendChild(h('div', { class: 'grid2' }, F.field('UUID', uuid), F.field('Skin texture', tex)));
      box.appendChild(F.field('Arm model', model));
    }
    return box;
  }

  /* ------------------------------------------------------------------ *
   * Hover event
   * ------------------------------------------------------------------ */
  function makeHover(action) {
    if (action === 'show_text') return { action, value: 'Tooltip text' };
    if (action === 'show_item') return { action, id: 'minecraft:diamond' };
    return { action: 'show_entity', id: 'minecraft:pig', uuid: uuidv4() };
  }

  function hoverEditor(part, ctx) {
    const hv = part.hover_event;
    const wrap = h('div', { class: 'stack-s' });
    const onChange = ctx.onChange;
    const pp = ctx.path;
    wrap.appendChild(F.seg([
      { id: '', label: 'Nothing' }, { id: 'show_text', label: 'Text' }, { id: 'show_item', label: 'Item' }, { id: 'show_entity', label: 'Entity' },
    ], hv && hv.action ? hv.action : '', (id) => {
      if (!id) delete part.hover_event; else part.hover_event = makeHover(id);
      onChange(true);
    }, { label: 'Hover action' }));
    if (!isObj(hv)) return wrap;
    if (hv.action === 'show_text') {
      wrap.appendChild(TE.build({ bind: F.objBind(hv, 'value', onChange, pp ? pp + '.hover_event.value' : null), key: ctx.fk + '.hv', nested: true, depth: ctx.depth + 1, multiline: true, placeholder: 'Tooltip text', preview: false }));
    } else if (hv.action === 'show_item') {
      const id = h('input', { class: 'inp mono', value: hv.id || '', placeholder: 'minecraft:diamond', 'aria-label': 'Item id', spellcheck: 'false' });
      id.addEventListener('input', () => { hv.id = id.value; onChange(false); });
      const pick = iconBtn('search', 'Pick an item', (e) => Pick.registry(e.currentTarget, { kind: 'items', onPick: (v) => { hv.id = v; id.value = v; onChange(true); } }));
      const count = h('input', { class: 'inp num', type: 'number', min: 1, max: 99, value: hv.count == null ? '' : hv.count, placeholder: 'Count (1)', 'aria-label': 'Count' });
      count.addEventListener('input', () => { if (count.value === '') delete hv.count; else hv.count = Number(count.value); onChange(false); });
      wrap.appendChild(h('div', { class: 'grid2' }, F.field('Item', h('div', { class: 'inp-row' }, id, pick), { path: pp ? pp + '.hover_event.id' : null }), F.field('Count', count, { path: pp ? pp + '.hover_event.count' : null })));
    } else if (hv.action === 'show_entity') {
      const id = h('input', { class: 'inp mono', value: hv.id || '', placeholder: 'minecraft:pig', 'aria-label': 'Entity type', spellcheck: 'false' });
      id.addEventListener('input', () => { hv.id = id.value; onChange(false); });
      const pick = iconBtn('search', 'Pick an entity', (e) => Pick.registry(e.currentTarget, { kind: 'entities', onPick: (v) => { hv.id = v; id.value = v; onChange(true); } }));
      const uu = h('input', { class: 'inp mono', value: typeof hv.uuid === 'string' ? hv.uuid : Array.isArray(hv.uuid) ? JSON.stringify(hv.uuid) : '', placeholder: 'UUID', 'aria-label': 'Entity UUID', spellcheck: 'false' });
      uu.addEventListener('input', () => { hv.uuid = uu.value; onChange(false); });
      const gen = iconBtn('refresh', 'Generate a random UUID', () => { hv.uuid = uuidv4(); uu.value = hv.uuid; onChange(false); });
      wrap.appendChild(h('div', { class: 'grid2' }, F.field('Entity type', h('div', { class: 'inp-row' }, id, pick), { path: pp ? pp + '.hover_event.id' : null }), F.field('UUID', h('div', { class: 'inp-row' }, uu, gen), { path: pp ? pp + '.hover_event.uuid' : null })));
      wrap.appendChild(F.optional(F.objBind(hv, 'name', onChange, pp ? pp + '.hover_event.name' : null), 'Name', () => 'Name', () => TE.build({ bind: F.objBind(hv, 'name', onChange, pp ? pp + '.hover_event.name' : null), key: ctx.fk + '.hvn', nested: true, depth: ctx.depth + 1, preview: false }), { empty: 'The entity’s own name is used.' }));
    }
    return wrap;
  }

  /* ------------------------------------------------------------------ *
   * Convenience: a labelled text field bound to a dialog path
   * ------------------------------------------------------------------ */
  TE.field = function (label, path, o) {
    o = o || {};
    const te = TE.build(Object.assign({ bind: F.bind(path) }, o));
    return F.field(label, te, { path: null, hint: o.hint, noFor: true, className: o.className });
  };
})();
