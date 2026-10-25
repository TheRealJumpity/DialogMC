/* Dialog MC — popovers and pickers (registry lists, translation keys, keybinds, colors, menus, commands). */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const U = DMC.util;
  const h = U.h;
  const T = DMC.text;
  const Pop = (DMC.pop = {});
  const Pick = (DMC.pick = {});

  /* ------------------------------------------------------------------ *
   * Popover shell
   * ------------------------------------------------------------------ */
  let cur = null;

  function place(pop, anchor) {
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = r.left;
    if (left + pw > vw - 8) left = Math.max(8, r.right - pw);
    let top = r.bottom + 6;
    if (top + ph > vh - 8) {
      const above = r.top - ph - 6;
      top = above >= 8 ? above : Math.max(8, vh - ph - 8);
    }
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  Pop.close = function (restoreFocus) {
    if (!cur) return;
    const c = cur;
    cur = null;
    document.removeEventListener('pointerdown', c.onDown, true);
    document.removeEventListener('keydown', c.onKey, true);
    window.removeEventListener('resize', c.onResize);
    window.removeEventListener('scroll', c.onResize, true);
    c.el.remove();
    if (c.opts.onClose) c.opts.onClose();
    if (restoreFocus !== false && c.anchor && document.contains(c.anchor)) {
      try { c.anchor.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
  };

  /** Show `content` in a popover anchored to `anchor`. opts: {width, onClose, className} */
  Pop.open = function (anchor, content, opts) {
    opts = opts || {};
    if (cur && cur.anchor === anchor && !opts.force) { Pop.close(); return null; } // toggle
    Pop.close(false);
    const el = h('div', { class: 'pop' + (opts.className ? ' ' + opts.className : ''), role: opts.role || 'dialog' }, content);
    if (opts.width) el.style.width = opts.width + 'px';
    document.body.appendChild(el);
    place(el, anchor);
    const onDown = (e) => {
      if (el.contains(e.target) || anchor.contains(e.target)) return;
      // nested popovers (e.g. native color input) shouldn't close us
      Pop.close(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        Pop.close();
      }
    };
    const onResize = (e) => {
      if (e && e.target && el.contains(e.target)) return;
      if (!document.contains(anchor)) { Pop.close(false); return; }
      place(el, anchor);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    cur = { el, anchor, opts, onDown, onKey, onResize };
    const focusTarget = el.querySelector('[data-autofocus]') || el.querySelector('input,button');
    if (focusTarget) setTimeout(() => { try { focusTarget.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 0);
    return el;
  };
  Pop.isOpen = () => !!cur;
  Pop.reposition = () => { if (cur) place(cur.el, cur.anchor); };

  /* ------------------------------------------------------------------ *
   * Searchable list
   * cfg: {placeholder, items | search(q)->items, row(item)->{main, sub?, tag?, icon?, title?}, onPick,
   *       custom(q)->item|null, limit, footer, emptyText, width, group(item)->label}
   * ------------------------------------------------------------------ */
  Pick.list = function (anchor, cfg) {
    const limit = cfg.limit || 80;
    let active = 0;
    let shown = [];
    const input = h('input', { class: 'inp', type: 'search', placeholder: cfg.placeholder || 'Search…', 'data-autofocus': '', autocomplete: 'off', spellcheck: 'false', 'aria-label': cfg.placeholder || 'Search' });
    const list = h('div', { class: 'pop-list', role: 'listbox' });
    const foot = cfg.footer ? h('div', { class: 'pop-foot' }, cfg.footer) : null;
    const root = h('div', { style: 'display:flex;flex-direction:column;min-height:0' }, h('div', { class: 'pop-search' }, input), list, foot);

    function query(q) {
      if (cfg.search) return cfg.search(q);
      const items = typeof cfg.items === 'function' ? cfg.items() : cfg.items;
      if (!q) return items;
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      return items.filter((it) => {
        const hay = (cfg.hay ? cfg.hay(it) : cfg.row(it).main + ' ' + (cfg.row(it).sub || '')).toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }

    function render() {
      const q = input.value.trim();
      let items = query(q);
      const total = items.length;
      items = items.slice(0, limit);
      const custom = cfg.custom ? cfg.custom(q) : null;
      shown = (custom ? [custom] : []).concat(items);
      list.textContent = '';
      if (!shown.length) {
        list.appendChild(h('div', { class: 'pop-empty' }, cfg.emptyText || 'Nothing matches.'));
        return;
      }
      let lastGroup = null;
      shown.forEach((it, i) => {
        if (cfg.group && !(custom && i === 0)) {
          const g = cfg.group(it);
          if (g !== lastGroup) { list.appendChild(h('div', { class: 'pop-group' }, g)); lastGroup = g; }
        }
        const row = cfg.row(it);
        const isCustom = custom && i === 0;
        const btn = h('button', {
          type: 'button', role: 'option', class: 'pop-item' + (i === active ? ' active' : ''), title: row.title || '',
          onclick: () => pick(it),
          onmousemove: () => { if (active !== i) { setActive(i, false); } },
        },
        row.icon ? row.icon : null,
        h('span', { class: 'pi-main' }, isCustom ? row.main : row.main),
        row.sub ? h('span', { class: 'pi-sub mono' }, row.sub) : null,
        row.tag ? h('span', { class: 'pi-tag' }, row.tag) : null);
        btn.dataset.i = i;
        list.appendChild(btn);
      });
      if (total > limit) list.appendChild(h('div', { class: 'pop-foot' }, 'Showing ' + limit + ' of ' + total + ' — type to narrow it down.'));
    }
    function setActive(i, scroll) {
      const rows = list.querySelectorAll('.pop-item');
      if (!rows.length) return;
      active = (i + rows.length) % rows.length;
      rows.forEach((r, k) => r.classList.toggle('active', k === active));
      if (scroll !== false) rows[active].scrollIntoView({ block: 'nearest' });
    }
    function pick(it) {
      Pop.close();
      cfg.onPick(it);
    }
    input.addEventListener('input', () => { active = 0; render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active]); }
    });
    render();
    return Pop.open(anchor, root, { width: cfg.width || 380, className: 'pop-lister' });
  };

  /* ------------------------------------------------------------------ *
   * Registry picker (items, blocks, entities, effects, ...)
   * ------------------------------------------------------------------ */
  const NAME_PREFIX = {
    items: ['item.minecraft.', 'block.minecraft.'], blocks: ['block.minecraft.'], entities: ['entity.minecraft.'],
    effects: ['effect.minecraft.'], enchantments: ['enchantment.minecraft.'], attributes: ['attribute.name.'], particles: [],
  };
  const regCache = {};
  function regRows(kind, ver) {
    const key = kind + '@' + ver;
    if (!regCache[key]) {
      const prefixes = NAME_PREFIX[kind] || [];
      regCache[key] = DMC.reg.list(kind, ver).map((id) => {
        let name = null;
        for (const p of prefixes) {
          const v = DMC.lang.get(p + id, ver);
          if (v) { name = v; break; }
        }
        name = name || U.prettyId(id);
        return { id, name, hay: (id + ' ' + name).toLowerCase() };
      });
    }
    return regCache[key];
  }
  const KIND_LABEL = { items: 'item', blocks: 'block', entities: 'entity', effects: 'effect', enchantments: 'enchantment', attributes: 'attribute', particles: 'particle' };

  /** cfg: {kind, ver, onPick(id with minecraft: prefix), current, title} */
  Pick.registry = function (anchor, cfg) {
    const ver = cfg.ver || DMC.store.version();
    const rows = regRows(cfg.kind, ver);
    return Pick.list(anchor, {
      placeholder: 'Search ' + (KIND_LABEL[cfg.kind] || cfg.kind) + 's…',
      search: (q) => {
        if (!q) return rows;
        const terms = q.toLowerCase().replace(/^minecraft:/, '').split(/\s+/);
        const hits = rows.filter((r) => terms.every((t) => r.hay.includes(t)));
        // exact / prefix matches first
        const t0 = terms[0];
        return hits.sort((a, b) => (a.id === t0 ? -1 : b.id === t0 ? 1 : (a.id.startsWith(t0) ? 0 : 1) - (b.id.startsWith(t0) ? 0 : 1)));
      },
      row: (r) => {
        const added = DMC.reg.addedIn(cfg.kind, r.id);
        return {
          main: r.name,
          sub: r.id,
          tag: added ? 'new in ' + added : null,
          icon: cfg.kind === 'items' || cfg.kind === 'blocks' ? h('span', { class: 'mc-slot', style: 'width:22px;height:22px;flex:none' }, DMC.render.itemIcon(r.id)) : null,
        };
      },
      custom: cfg.custom === false ? null : (q) => {
        const id = q.trim();
        if (!id || !/^[a-z0-9_.-]+:[a-z0-9_.\-/]+$/.test(id) || id.startsWith('minecraft:')) return null;
        return { id, name: id, custom: true, hay: id };
      },
      onPick: (r) => cfg.onPick(r.custom ? r.id : 'minecraft:' + r.id),
      footer: 'Type namespace:id to use something from a mod or data pack.',
      width: 400,
    });
  };

  /* ------------------------------------------------------------------ *
   * Translation keys
   * ------------------------------------------------------------------ */
  Pick.lang = function (anchor, cfg) {
    const ver = cfg.ver || DMC.store.version();
    return Pick.list(anchor, {
      placeholder: 'Search text or key (e.g. gui.back, Cancel)',
      search: (q) => DMC.lang.search(q, ver, 400).filter((x) => !/^(death|advancements|subtitles|biome|painting|block\.|item\.|entity\.|jukebox|trim|instrument|color)/.test(x.key) || q.length >= 3),
      row: (x) => ({ main: x.value, sub: x.key, title: x.key }),
      hay: (x) => x.key + ' ' + x.value,
      onPick: (x) => cfg.onPick(x.key),
      custom: (q) => (/^[a-z0-9_.-]+(\.[a-zA-Z0-9_.-]+)+$/.test(q.trim()) && !DMC.lang.has(q.trim(), ver) ? { key: q.trim(), value: 'Use “' + q.trim() + '” as typed (from a resource pack)' } : null),
      footer: 'Vanilla English text shown here — players see their own language.',
      width: 440,
      limit: 60,
    });
  };

  /* ------------------------------------------------------------------ *
   * Keybinds
   * ------------------------------------------------------------------ */
  Pick.keybind = function (anchor, cfg) {
    const ver = cfg.ver || DMC.store.version();
    const items = DMC.keys.list(ver).map((id) => {
      const name = DMC.lang.get(id, ver) || U.prettyId(id.replace(/^key\./, ''));
      return { id, name, def: DMC.keys.defaults[id] || '' };
    });
    return Pick.list(anchor, {
      placeholder: 'Search controls (e.g. jump, inventory)',
      items,
      row: (x) => {
        const added = DMC.keys.addedIn(x.id);
        return { main: x.name, sub: x.def ? x.def + ' · ' + x.id : x.id, tag: added ? 'new in ' + added : null };
      },
      hay: (x) => x.id + ' ' + x.name + ' ' + x.def,
      onPick: (x) => cfg.onPick(x.id),
      width: 400,
      limit: 100,
    });
  };

  /* ------------------------------------------------------------------ *
   * Menus (insert menus, kind pickers, ...)
   * items: [{id,label,desc?,icon?,group?,tag?,disabled?,danger?}] ; cfg: {onPick, width}
   * ------------------------------------------------------------------ */
  Pick.menu = function (anchor, items, cfg) {
    cfg = cfg || {};
    const root = h('div', { class: 'pop-list pop-menu', role: 'menu' });
    let lastGroup = null;
    let first = true;
    for (const it of items) {
      if (it.group && it.group !== lastGroup) {
        root.appendChild(h('div', { class: 'pop-group' }, it.group));
        lastGroup = it.group;
      }
      const btn = h('button', {
        type: 'button', role: 'menuitem', class: 'pop-item', disabled: !!it.disabled, title: it.title || '',
        onclick: () => { Pop.close(); cfg.onPick(it); },
      },
      it.icon ? U.icon(it.icon, 16) : null,
      h('span', { class: 'pi-main' }, it.label, it.desc ? h('span', { class: 'hint', style: 'display:block;font-size:12px;white-space:normal' }, it.desc) : null),
      it.tag ? h('span', { class: 'pi-tag' }, it.tag) : null);
      if (first) { btn.setAttribute('data-autofocus', ''); first = false; }
      if (it.current) btn.classList.add('active');
      root.appendChild(btn);
    }
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const btns = Array.from(root.querySelectorAll('button:not([disabled])'));
      const i = btns.indexOf(document.activeElement);
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length].focus();
    });
    return Pop.open(anchor, root, { width: cfg.width || 300 });
  };

  /* ------------------------------------------------------------------ *
   * Colors
   * cfg: {value, onPick(color|undefined), allowNone, alpha: bool (ARGB mode: value is int/array)}
   * ------------------------------------------------------------------ */
  Pick.color = function (anchor, cfg) {
    const cur = typeof cfg.value === 'string' ? cfg.value : undefined;
    const curCss = T.colorToCss(cur);
    const swatches = h('div', { class: 'swatches' });
    for (const name of T.COLOR_NAMES) {
      swatches.appendChild(h('button', {
        type: 'button', class: '', style: '--sw:' + T.COLORS[name], title: name.replace(/_/g, ' '), 'aria-pressed': String(cur === name), 'aria-label': name.replace(/_/g, ' '),
        onclick: () => { Pop.close(); cfg.onPick(name); },
      }));
    }
    const hexVal = curCss || '#FFFFFF';
    const native = h('input', { type: 'color', value: hexVal.toLowerCase(), 'aria-label': 'Custom color', style: 'width:34px;height:30px;padding:0;border:1px solid var(--line);background:var(--ctrl);border-radius:5px;flex:none' });
    const hex = h('input', { class: 'inp mono', value: curCss && !T.COLORS[cur] ? curCss : '', placeholder: '#RRGGBB', maxlength: 7, 'aria-label': 'Hex color', style: 'height:30px' });
    const apply = () => {
      let v = hex.value.trim();
      if (/^[0-9a-fA-F]{6}$/.test(v)) v = '#' + v;
      if (T.HEX_RE.test(v)) { Pop.close(); cfg.onPick(v.toUpperCase()); } else hex.classList.add('bad');
    };
    native.addEventListener('input', () => { hex.value = native.value.toUpperCase(); hex.classList.remove('bad'); });
    native.addEventListener('change', apply);
    hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    const body = h('div', { class: 'pop-pad' },
      swatches,
      h('div', { class: 'inp-row' }, native, hex, h('button', { type: 'button', class: 'btn sm', onclick: apply }, 'Use')),
      cfg.allowNone === false ? null : h('button', { type: 'button', class: 'btn sm ghost', onclick: () => { Pop.close(); cfg.onPick(undefined); } }, U.icon('x', 14), cfg.noneLabel || 'No color (inherit)'));
    return Pop.open(anchor, body, { width: 280 });
  };

  /* ARGB (shadow color): color + opacity */
  Pick.argb = function (anchor, cfg) {
    const dec = T.argbDecode(cfg.value) || { r: 0, g: 0, b: 0, a: 1 };
    let hexV = T.rgbToHex(dec.r, dec.g, dec.b);
    let alpha = dec.a;
    const native = h('input', { type: 'color', value: hexV.toLowerCase(), 'aria-label': 'Shadow color', style: 'width:40px;height:32px;padding:0;border:1px solid var(--line);background:var(--ctrl);border-radius:5px' });
    const aval = h('span', { class: 'mono', style: 'min-width:44px;text-align:right' }, Math.round(alpha * 100) + '%');
    const range = h('input', { type: 'range', min: 0, max: 100, value: Math.round(alpha * 100), 'aria-label': 'Opacity', style: 'flex:1;accent-color:var(--accent)' });
    range.addEventListener('input', () => { alpha = range.value / 100; aval.textContent = range.value + '%'; });
    native.addEventListener('input', () => { hexV = native.value.toUpperCase(); });
    const body = h('div', { class: 'pop-pad' },
      h('div', { class: 'inp-row' }, native, range, aval),
      h('div', { class: 'cluster' },
        h('button', { type: 'button', class: 'btn sm primary', onclick: () => { Pop.close(); cfg.onPick(T.argbEncode(hexV, alpha)); } }, 'Apply'),
        h('button', { type: 'button', class: 'btn sm', onclick: () => { Pop.close(); cfg.onPick(T.argbEncode('#000000', 0)); } }, 'No shadow'),
        h('button', { type: 'button', class: 'btn sm ghost', onclick: () => { Pop.close(); cfg.onPick(undefined); } }, 'Default')));
    return Pop.open(anchor, body, { width: 300 });
  };

  /* ------------------------------------------------------------------ *
   * Dialog ids (project dialogs + vanilla + custom)
   * ------------------------------------------------------------------ */
  Pick.dialogId = function (anchor, cfg) {
    const St = DMC.store;
    const proj = St.project().dialogs.map((e) => ({ id: St.fullId(e), name: DMC.text.plain(e.dialog.title, St.version()) || e.id, group: 'In this project' }));
    const vanilla = DMC.vanillaDialogs.map((id) => ({ id, name: U.prettyId(id), group: 'Built into the game' }));
    const tags = cfg.tags ? DMC.vanillaDialogTags.map((id) => ({ id, name: 'Tag ' + id, group: 'Tags', tag: true })) : [];
    const all = proj.concat(vanilla, tags).filter((x) => !(cfg.exclude && cfg.exclude === x.id));
    return Pick.list(anchor, {
      placeholder: 'Find a dialog or type an id',
      items: all,
      row: (x) => ({ main: x.name, sub: x.id }),
      group: (x) => x.group,
      custom: (q) => {
        q = q.trim();
        if (!q) return null;
        const ok = cfg.tags && q.startsWith('#') ? DMC.rl.isValid(q.slice(1)) : DMC.rl.isValid(q);
        if (!ok || all.some((x) => x.id === q)) return null;
        return { id: q, name: 'Use “' + q + '”', group: 'Custom' };
      },
      onPick: (x) => cfg.onPick(x.id),
      footer: cfg.footer || 'Ids look like namespace:name — a dialog from another data pack works too.',
      width: 400,
    });
  };

  /* ------------------------------------------------------------------ *
   * Command snippets (permission level is computed by the real validator)
   * ------------------------------------------------------------------ */
  const SNIPPETS = [
    ['Show to the player', [
      ['Chat message', 'tellraw @s {"text":"Hello!","color":"green"}'],
      ['Big title', 'title @s title {"text":"Welcome"}'],
      ['Action bar', 'title @s actionbar {"text":"Saved"}'],
      ['Sound', 'playsound minecraft:ui.button.click master @s'],
    ]],
    ['Works for everyone', [
      ['Set a trigger (needs a trigger objective)', 'trigger my_trigger set 1'],
      ['Add to a trigger', 'trigger my_trigger'],
    ]],
    ['Items and effects', [
      ['Give an item', 'give @s minecraft:diamond 1'],
      ['Give an effect', 'effect give @s minecraft:speed 30 1'],
      ['Clear an effect', 'effect clear @s'],
      ['Enchanted item', 'give @s minecraft:diamond_sword[enchantments={"minecraft:sharpness":3}] 1'],
    ]],
    ['World and player', [
      ['Teleport', 'tp @s 0 100 0'],
      ['Game mode', 'gamemode survival @s'],
      ['Set time', 'time set day'],
      ['Set weather', 'weather clear'],
      ['Set spawn', 'spawnpoint @s ~ ~ ~'],
    ]],
    ['Run your own logic', [
      ['Run a function', 'function my_pack:my_function'],
      ['Run as the player', 'execute as @s at @s run function my_pack:my_function'],
      ['Open another dialog', 'dialog show @s my_pack:other'],
      ['Close the dialog', 'dialog clear @s'],
    ]],
  ];
  Pick.commands = function (anchor, cfg) {
    const ver = cfg.ver || DMC.store.version();
    const items = [];
    for (const [group, list] of SNIPPETS) {
      for (const [label, cmd] of list) {
        const r = DMC.cmd.validate(cmd, ver);
        items.push({ group, label, cmd, level: r.ok ? r.level : -1, ok: r.ok });
      }
    }
    return Pick.list(anchor, {
      placeholder: 'Search command ideas',
      items,
      row: (x) => ({ main: x.label, sub: x.cmd.length > 34 ? x.cmd.slice(0, 33) + '…' : x.cmd, tag: x.ok ? (x.level > 0 ? 'op level ' + x.level : null) : null, title: x.cmd }),
      hay: (x) => x.label + ' ' + x.cmd,
      group: (x) => x.group,
      onPick: (x) => cfg.onPick(x.cmd),
      width: 440,
      footer: 'Players need permission for most commands — see the notes under the field.',
      limit: 40,
    });
  };

  /* ------------------------------------------------------------------ *
   * Small generic prompt popover (single value)
   * ------------------------------------------------------------------ */
  Pick.prompt = function (anchor, cfg) {
    const input = h('input', { class: 'inp', value: cfg.value || '', placeholder: cfg.placeholder || '', 'data-autofocus': '', 'aria-label': cfg.label || 'Value' });
    const go = () => { const v = input.value; Pop.close(); cfg.onPick(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    const body = h('div', { class: 'pop-pad' }, cfg.label ? h('label', { class: 'fld-label' }, cfg.label) : null, input, h('div', { class: 'cluster' }, h('button', { type: 'button', class: 'btn sm primary', onclick: go }, cfg.button || 'Done')));
    return Pop.open(anchor, body, { width: 300 });
  };
})();
