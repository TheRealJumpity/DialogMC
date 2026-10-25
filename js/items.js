/* Dialog MC — item stack editor (id, count, data components) used by item bodies. */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const U = DMC.util;
  const h = U.h;
  const St = DMC.store;
  const F = DMC.fields;
  const R = DMC.render;
  const Pick = DMC.pick;
  const SC = DMC.schema;
  const I = (DMC.items = {});
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /** Binding that always presents the item as an object (the 26.1+ bare-id string form is read as {id}). */
  function itemBinding(path) {
    const b = F.bind(path);
    return {
      path,
      get: () => { const v = b.get(); return typeof v === 'string' ? { id: v } : v; },
      set: (v, s) => b.set(v, s),
      del: (s) => b.del(s),
    };
  }
  I.binding = itemBinding;

  /** Binding for one data component ("minecraft:" prefix is written; bare keys in old data are read too). */
  function compBinding(compBind, k) {
    const read = (o) => (isObj(o) ? (o['minecraft:' + k] !== undefined ? o['minecraft:' + k] : o[k]) : undefined);
    return {
      path: compBind.path != null ? compBind.path + '.minecraft:' + k : null,
      get: () => read(compBind.get()),
      set: (v, s) => { const o = U.clone(compBind.get()); const n = isObj(o) ? o : {}; delete n[k]; n['minecraft:' + k] = v; compBind.set(n, s); },
      del: (s) => {
        const o = U.clone(compBind.get());
        if (!isObj(o)) return;
        delete o[k];
        delete o['minecraft:' + k];
        if (Object.keys(o).length) compBind.set(o, s); else compBind.del(s);
      },
    };
  }

  const HANDLED = ['custom_name', 'item_name', 'lore', 'rarity', 'enchantments', 'enchantment_glint_override', 'max_stack_size', 'damage', 'max_damage', 'unbreakable', 'item_model', 'profile'];
  const bareKey = (k) => String(k).replace(/^!?minecraft:/, '').replace(/^!/, '');

  /* ------------------------------------------------------------------ *
   * Item field: icon, id, picker, count
   * ------------------------------------------------------------------ */
  I.field = function (path, o) {
    o = o || {};
    const ib = itemBinding(path);
    const idBind = F.subBind(ib, 'id');
    const wrap = h('div', { class: 'stack' }, null);
    const cur = ib.get();
    const id = isObj(cur) ? cur.id : undefined;
    const icon = h('span', { class: 'mc-slot', style: 'width:40px;height:40px;flex:none;background:#0f1217;border:1px solid var(--line);border-radius:6px;padding:5px' }, R.itemIcon(id || 'air'));
    const nameEl = h('div', { class: 'hint', style: 'margin-top:4px' }, id ? R.itemName(id, St.version()) : 'Pick an item');
    const input = h('input', { class: 'inp mono', type: 'text', value: typeof id === 'string' ? id : '', placeholder: 'minecraft:diamond', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Item id' });
    const refreshPreview = () => {
      const v = input.value.trim();
      icon.textContent = '';
      icon.appendChild(R.itemIcon(v || 'air'));
      nameEl.textContent = v ? R.itemName(v, St.version()) : 'Pick an item';
    };
    input.addEventListener('input', () => { idBind.set(input.value, false); refreshPreview(); });
    const pick = h('button', { type: 'button', class: 'btn sm', onclick: (e) => Pick.registry(e.currentTarget, { kind: 'items', onPick: (v) => { idBind.set(v, true); } }) }, U.icon('search', 14), 'Pick');
    const idField = F.field('Item', h('div', { class: 'inp-row' }, input, pick), { path: path + '.id', noFor: true });
    const countB = F.subBind(ib, 'count');
    const count = F.num(countB, { int: true, min: 1, max: 99, placeholder: '1', aria: 'Count' });
    const countField = F.field('Count', count, { path: path + '.count' });
    countField.style.maxWidth = '130px';
    const row = h('div', { style: 'display:flex;gap:12px;align-items:flex-start' },
      h('div', null, icon),
      h('div', { style: 'flex:1;min-width:0' }, idField, nameEl),
      countField);
    wrap.appendChild(row);
    if (o.components !== false) wrap.appendChild(I.componentsEditor(path, ib));
    wrap.setAttribute('data-path', path);
    return wrap;
  };

  /* ------------------------------------------------------------------ *
   * Components
   * ------------------------------------------------------------------ */
  I.componentsEditor = function (path, ib) {
    const compBind = F.subBind(ib, 'components');
    const comps = compBind.get();
    const keys = isObj(comps) ? Object.keys(comps) : [];
    const summary = [];
    const has = (k) => keys.some((x) => bareKey(x) === k);
    if (has('custom_name') || has('item_name')) summary.push('name');
    if (has('lore')) summary.push('lore');
    if (has('enchantments')) summary.push('enchantments');
    const extra = keys.filter((x) => !HANDLED.includes(bareKey(x))).length;
    if (extra) summary.push(extra + ' other');
    const okey = path + '.components';
    let open = St.isOpen(okey, false);
    const body = h('div', { class: 'stack', style: 'padding-top:6px' });
    let built = false;
    const wrap = h('div', { class: 'stack-s' });
    const btn = h('button', { type: 'button', class: 'btn sm', 'aria-expanded': String(open), onclick: () => toggle(!open) },
      U.icon(open ? 'chevron-down' : 'chevron-right', 14), 'Item details', h('span', { class: 'hint' }, summary.length ? summary.join(', ') : 'name, lore, enchantments, rarity…'));
    function toggle(v) {
      open = v;
      St.setOpen(okey, v);
      btn.setAttribute('aria-expanded', String(v));
      btn.firstChild.replaceWith(U.icon(v ? 'chevron-down' : 'chevron-right', 14));
      body.hidden = !v;
      if (v && !built) { built = true; build(); if (DMC.editor) DMC.editor.applyIssues(); }
    }
    function build() {
      const TE = DMC.textedit;
      const cb = (k) => compBinding(compBind, k);
      const dp = (k) => (compBind.path != null ? compBind.path + '.minecraft:' + k : null);

      body.appendChild(F.optional(cb('custom_name'), 'Custom name', () => 'My item', () => TE.build({ bind: cb('custom_name'), placeholder: 'Name' }), { path: dp('custom_name'), noFor: true, hint: 'Italic by default, like a renamed item', empty: 'The item’s normal name is used.' }));
      body.appendChild(F.optional(cb('item_name'), 'Item name', () => 'My item', () => TE.build({ bind: cb('item_name'), placeholder: 'Name' }), { path: dp('item_name'), noFor: true, hint: 'Replaces the base name without italics', empty: 'The item’s normal name is used.' }));

      // lore
      const loreB = cb('lore');
      const lore = loreB.get();
      const loreBody = () => {
        const w = h('div', { class: 'stack-s' });
        (Array.isArray(lore) ? lore : []).forEach((line, i) => {
          const lb = { path: dp('lore') + '.' + i, get: () => (loreB.get() || [])[i], set: (v, s) => { const a = U.clone(loreB.get()) || []; a[i] = v; loreB.set(a, s); }, del: (s) => { const a = U.clone(loreB.get()) || []; a.splice(i, 1); if (a.length) loreB.set(a, s); else loreB.del(s); } };
          w.appendChild(h('div', { class: 'te-line' }, h('div', { style: 'flex:1;min-width:0' }, TE.build({ bind: lb, placeholder: 'Lore line ' + (i + 1), key: 'lore' + i + path, preview: false })), F.iconBtn('trash', 'Remove line', () => lb.del(true), { danger: true })));
        });
        w.appendChild(F.addRow([{ label: 'Add line', icon: 'plus', onclick: () => { const a = U.clone(loreB.get()) || []; a.push(''); loreB.set(a, true); } }]));
        return w;
      };
      body.appendChild(F.optional(loreB, 'Lore', () => [''], loreBody, { path: dp('lore'), noFor: true, hint: 'Extra tooltip lines (dark purple italic by default)', empty: 'No extra lines.' }));

      // rarity
      body.appendChild(F.optional(cb('rarity'), 'Rarity', () => 'rare', () => F.seg(SC.rarities.map((r) => ({ id: r, label: U.cap(r) })), cb('rarity').get(), (id) => cb('rarity').set(id, false), { label: 'Rarity' }), { path: dp('rarity'), noFor: true, hint: 'Colors the name', empty: 'Based on the item.' }));

      // enchantments
      const enB = cb('enchantments');
      const enBody = () => {
        const w = h('div', { class: 'stack-s' });
        const map = enB.get();
        for (const [k, lv] of Object.entries(isObj(map) ? map : {})) {
          const lvl = h('input', { class: 'inp num', type: 'number', min: 1, max: 255, value: lv, style: 'width:84px', 'aria-label': 'Level of ' + k });
          lvl.addEventListener('input', () => { if (lvl.value === '') return; const o = U.clone(enB.get()); o[k] = Number(lvl.value); enB.set(o, false); });
          const nm = DMC.lang.get('enchantment.minecraft.' + DMC.rl.bare(k), St.version()) || k;
          w.appendChild(h('div', { class: 'inp-row' },
            h('div', { class: 'inp mono', style: 'display:flex;align-items:center;height:32px;color:var(--text)' }, nm, h('span', { class: 'hint', style: 'margin-left:8px' }, k)),
            lvl,
            F.iconBtn('trash', 'Remove enchantment', () => { const o = U.clone(enB.get()); delete o[k]; if (Object.keys(o).length) enB.set(o, true); else enB.del(true); }, { danger: true })));
        }
        w.appendChild(F.addRow([{ label: 'Add enchantment', icon: 'plus', onclick: (e) => Pick.registry(e.currentTarget, { kind: 'enchantments', onPick: (id) => { const o = U.clone(enB.get()) || {}; o[id] = 1; enB.set(o, true); } }) }]));
        return w;
      };
      body.appendChild(F.optional(enB, 'Enchantments', () => ({}), enBody, { path: dp('enchantments'), noFor: true, hint: 'Also makes the item shimmer', empty: 'None.' }));

      // glint
      const glint = cb('enchantment_glint_override');
      const gv = glint.get();
      body.appendChild(F.field('Shimmer', F.seg([{ id: 'default', label: 'Default' }, { id: 'on', label: 'Always' }, { id: 'off', label: 'Never' }], gv === true ? 'on' : gv === false ? 'off' : 'default', (id) => {
        if (id === 'default') glint.del(false); else glint.set(id === 'on', false);
      }, { label: 'Shimmer' }), { path: dp('enchantment_glint_override'), noFor: true, hint: 'The enchantment glint' }));

      // numbers
      const nums = h('div', { class: 'grid3' },
        F.field('Max stack size', F.num(cb('max_stack_size'), { int: true, min: 1, max: 99, placeholder: 'default' }), { path: dp('max_stack_size') }),
        F.field('Damage', F.num(cb('damage'), { int: true, min: 0, placeholder: '0' }), { path: dp('damage'), hint: 'Shows a durability bar' }),
        F.field('Max damage', F.num(cb('max_damage'), { int: true, min: 1, placeholder: 'default' }), { path: dp('max_damage') }));
      body.appendChild(nums);
      body.appendChild(h('div', { class: 'cluster' },
        h('label', { class: 'sw-row' }, F.sw(cb('unbreakable').get() !== undefined, (on) => { if (on) cb('unbreakable').set({}, false); else cb('unbreakable').del(false); }, { label: 'Unbreakable' }), h('span', null, 'Unbreakable'))));
      body.appendChild(F.field('Model override', F.str(cb('item_model'), { mono: true, delEmpty: true, placeholder: 'minecraft:diamond', aria: 'Item model' }), { path: dp('item_model'), hint: 'Draws a different item model' }));
      if (/player_head$/.test(String((ib.get() || {}).id || ''))) {
        const pb = cb('profile');
        const pv = pb.get();
        body.appendChild(F.field('Head owner', F.str({ path: dp('profile'), get: () => (typeof pb.get() === 'string' ? pb.get() : isObj(pb.get()) ? pb.get().name : ''), set: (v, s) => pb.set(v, s), del: (s) => pb.del(s) }, { delEmpty: true, placeholder: 'Player name', aria: 'Head owner' }), { path: dp('profile'), hint: typeof pv === 'object' ? 'Full profile — edit in the JSON box below' : '' }));
      }

      // other
      const other = {};
      const all = compBind.get();
      for (const [k, v] of Object.entries(isObj(all) ? all : {})) if (!HANDLED.includes(bareKey(k)) || k.startsWith('!')) other[k] = v;
      const jb = h('div', { class: 'stack-s', style: 'gap:6px' });
      const ta = h('textarea', { class: 'inp mono', rows: 3, spellcheck: 'false', 'aria-label': 'Other components as JSON', placeholder: '{ "minecraft:custom_model_data": { "strings": ["menu"] } }' });
      ta.value = Object.keys(other).length ? JSON.stringify(other, null, 2) : '';
      const err = h('div', { class: 'msg error', hidden: true });
      ta.addEventListener('input', () => {
        let parsed = {};
        if (ta.value.trim()) {
          const r = DMC.snbt.parseLoose(ta.value);
          if (!r.ok) { err.hidden = false; err.textContent = 'Not valid yet: ' + r.error.message; ta.classList.add('bad'); return; }
          if (!isObj(r.value)) { err.hidden = false; err.textContent = 'Components are an object { "minecraft:…": … }.'; ta.classList.add('bad'); return; }
          parsed = r.value;
        }
        err.hidden = true;
        ta.classList.remove('bad');
        const cur = U.clone(compBind.get());
        const next = {};
        for (const [k, v] of Object.entries(isObj(cur) ? cur : {})) if (HANDLED.includes(bareKey(k)) && !k.startsWith('!')) next[k] = v;
        Object.assign(next, parsed);
        if (Object.keys(next).length) compBind.set(next, false); else compBind.del(false);
      });
      jb.appendChild(ta);
      jb.appendChild(err);
      body.appendChild(F.field('Other components', jb, { path: compBind.path, noFor: true, hint: 'Any data component, as JSON' }));
    }
    body.hidden = !open;
    if (open) { built = true; build(); }
    wrap.appendChild(btn);
    wrap.appendChild(body);
    return wrap;
  };

  /** Summary text for an item stack. */
  I.summary = function (item) {
    const id = typeof item === 'string' ? item : isObj(item) ? item.id : '';
    if (!id) return '';
    const c = isObj(item) && item.count > 1 ? item.count + ' × ' : '';
    return c + R.itemName(id, St.version());
  };
})();
