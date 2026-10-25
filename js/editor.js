/* Dialog MC — the editor panel: sections for title, body, inputs, buttons and behavior of one dialog,
 * plus mapping of validator issues onto the fields they belong to. */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const U = DMC.util;
  const h = U.h;
  const St = DMC.store;
  const F = DMC.fields;
  const SC = DMC.schema;
  const R = DMC.render;
  const Pick = DMC.pick;
  const E = (DMC.editor = {});
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const P = (base, k) => (base ? base + '.' + k : k);
  const TE = () => DMC.textedit;
  const A = () => DMC.actions;
  const plain = (v) => DMC.text.plain(v, St.version()).replace(/\s+/g, ' ').trim();

  let host = null;
  let pendingFocus = null;

  E.requestFocus = (key) => { pendingFocus = key; };

  /* ------------------------------------------------------------------ *
   * Normalization of hand-written / imported dialogs into the shapes the editor addresses by path
   * ------------------------------------------------------------------ */
  function normalizeDialog(d, depth) {
    if (!isObj(d) || depth > 8) return d;
    if (d.body !== undefined && !Array.isArray(d.body)) d.body = isObj(d.body) ? [d.body] : [];
    if (Array.isArray(d.inputs)) {
      for (const inp of d.inputs) {
        if (isObj(inp) && Array.isArray(inp.options)) inp.options = inp.options.map((o) => (typeof o === 'string' ? { id: o } : o));
      }
    }
    if (d.dialogs !== undefined && !Array.isArray(d.dialogs) && !(typeof d.dialogs === 'string' && d.dialogs.startsWith('#'))) d.dialogs = [d.dialogs];
    const kids = [];
    for (const k of ['action', 'yes', 'no', 'exit_action']) if (isObj(d[k])) kids.push(d[k]);
    if (Array.isArray(d.actions)) for (const b of d.actions) if (isObj(b)) kids.push(b);
    for (const b of kids) if (isObj(b.action) && isObj(b.action.dialog)) normalizeDialog(b.action.dialog, depth + 1);
    if (Array.isArray(d.dialogs)) for (const x of d.dialogs) if (isObj(x)) normalizeDialog(x, depth + 1);
    // inline dialogs in text click events
    const walkText = (v) => {
      if (Array.isArray(v)) return v.forEach(walkText);
      if (!isObj(v)) return;
      if (isObj(v.click_event) && isObj(v.click_event.dialog)) normalizeDialog(v.click_event.dialog, depth + 1);
      if (Array.isArray(v.extra)) v.extra.forEach(walkText);
    };
    walkText(d.title);
    return d;
  }
  E.normalize = normalizeDialog;

  /* ------------------------------------------------------------------ *
   * Render
   * ------------------------------------------------------------------ */
  function focusSignature() {
    const a = document.activeElement;
    if (!a || !host || !host.contains(a) || a === document.body) return null;
    const fk = a.getAttribute && a.getAttribute('data-fk');
    if (fk) return { fk };
    const owner = a.closest('[data-path]');
    if (!owner) return null;
    const list = Array.from(owner.querySelectorAll('input,textarea,select,button'));
    return { path: owner.dataset.path, idx: list.indexOf(a), tag: a.tagName, label: a.getAttribute('aria-label') };
  }
  function restoreFocus(sig) {
    let target = null;
    if (pendingFocus) {
      target = host.querySelector('[data-fk="' + CSS.escape(pendingFocus) + '"]');
      pendingFocus = null;
    } else if (sig) {
      if (sig.fk) target = host.querySelector('[data-fk="' + CSS.escape(sig.fk) + '"]');
      else {
        const owner = Array.from(host.querySelectorAll('[data-path]')).find((el) => el.dataset.path === sig.path);
        if (owner) {
          const list = Array.from(owner.querySelectorAll('input,textarea,select,button'));
          target = list.find((x) => x.tagName === sig.tag && sig.label && x.getAttribute('aria-label') === sig.label) || list[sig.idx] || null;
        }
      }
    }
    if (target) {
      try { target.focus({ preventScroll: false }); } catch (e) { /* ignore */ }
    }
  }

  E.render = function (container) {
    host = container || host;
    if (!host) return;
    const sig = focusSignature();
    const top = host.scrollTop;
    host.textContent = '';
    const entry = St.cur();
    const d = entry.dialog;
    const inner = h('div', { class: 'editor-inner' });
    const title = plain(d.title) || entry.id;
    inner.appendChild(h('div', { class: 'doc-head' }, h('h1', null, title), h('span', { class: 'idpill' }, St.fullId(entry))));
    inner.appendChild(h('div', { class: 'fld', 'data-path': '', style: 'margin-bottom:6px' }, h('div', { class: 'fld-msgs' })));
    for (const s of dialogSections('', 0)) inner.appendChild(s);
    host.appendChild(inner);
    host.scrollTop = top;
    E.applyIssues();
    restoreFocus(sig);
  };

  E.refreshSummaries = function () {
    if (!host) return;
    host.querySelectorAll('[data-entry]').forEach((el) => { if (el._refresh) el._refresh(); });
    const entry = St.cur();
    const h1 = host.querySelector('.doc-head h1');
    if (h1) h1.textContent = plain(entry.dialog.title) || entry.id;
  };

  /** Editor for a dialog embedded at `base` (inline dialogs). */
  E.inlineDialog = function (base) {
    const d = St.get(base);
    const wrap = h('div', { class: 'stack inline-dialog', 'data-path': base });
    const depth = (base.match(/\bdialogs?\b/g) || []).length;
    if (!isObj(d)) { wrap.appendChild(h('div', { class: 'msg warn' }, 'This isn’t a dialog object.')); return wrap; }
    if (depth > 5) { wrap.appendChild(h('div', { class: 'msg warn' }, 'Nested too deeply to edit here — use JSON import for this one.')); return wrap; }
    for (const s of dialogSections(base, depth)) wrap.appendChild(s);
    return wrap;
  };

  function dialogSections(base, depth) {
    const d = St.get(base);
    const type = SC.bare(d.type);
    const out = [typeSection(base), titleSection(base), bodySection(base), inputsSection(base)];
    switch (type) {
      case 'notice': out.push(noticeSection(base)); break;
      case 'confirmation': out.push(confirmationSection(base)); break;
      case 'multi_action': out.push(multiActionSection(base)); break;
      case 'server_links': out.push(serverLinksSection(base)); break;
      case 'dialog_list': out.push(dialogListSection(base)); break;
      default: break;
    }
    out.push(behaviorSection(base));
    void depth;
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Type
   * ------------------------------------------------------------------ */
  function convertTo(base, newType) {
    const d = St.get(base);
    if (SC.bare(d.type) === newType) return;
    const { dialog, lost } = St.convert(d, newType);
    St.commit((root) => {
      if (base) St.setPath(root, base, dialog);
      else St.cur().dialog = dialog;
    }, { structural: true, reason: 'type' });
    const label = SC.dialogTypes.find((x) => x.id === newType).label;
    F.toast('Changed to ' + label.toLowerCase() + (lost.length ? ' — removed: ' + lost.join(', ') : ''), lost.length ? { action: { label: 'Undo', onClick: () => St.undo() } } : { kind: 'ok' });
  }

  function typeSection(base) {
    const d = St.get(base);
    const t = SC.bare(d.type);
    const def = SC.dialogTypes.find((x) => x.id === t);
    const seg = F.seg(SC.dialogTypes.map((x) => ({ id: x.id, label: x.label, icon: x.icon, title: x.desc })), t, (id) => convertTo(base, id), { label: 'Dialog type', wrap: true });
    const body = h('div', { class: 'stack-s', 'data-path': P(base, 'type') }, seg, h('div', { class: 'hint' }, def ? def.desc : 'Unknown dialog type “' + d.type + '”.'), h('div', { class: 'fld-msgs' }));
    return F.section('Type', { body });
  }

  /* ------------------------------------------------------------------ *
   * Title
   * ------------------------------------------------------------------ */
  function titleSection(base) {
    const tb = F.bind(P(base, 'title'));
    const body = [
      F.field('Title', TE().build({ bind: tb, placeholder: 'Dialog title' }), { path: P(base, 'title'), noFor: true, hint: 'Shown at the top' }),
      F.optional(F.bind(P(base, 'external_title')), 'List button text', () => 'Open', () => TE().build({ bind: F.bind(P(base, 'external_title')), placeholder: 'Text on the button that opens this dialog' }), { path: P(base, 'external_title'), noFor: true, hint: 'Used when this dialog appears in a dialog list, the pause menu or quick actions', empty: 'The title is used.' }),
    ];
    return F.section('Title', { body });
  }

  /* ------------------------------------------------------------------ *
   * Body
   * ------------------------------------------------------------------ */
  function bodySection(base) {
    const bp = P(base, 'body');
    const list = Array.isArray(St.get(bp)) ? St.get(bp) : [];
    const entries = h('div', { class: 'entries' });
    list.forEach((b, i) => entries.appendChild(bodyEntry(bp + '.' + i, i, list.length, bp, b)));
    const body = [entries];
    if (!list.length) body.unshift(h('div', { class: 'sec-empty' }, 'No text or items yet — the dialog shows only its title and buttons.'));
    body.push(F.addRow([
      { label: 'Text', icon: 'type', onclick: () => St.insert(bp, null, { type: 'minecraft:plain_message', contents: '' }, { reason: 'add-body' }) },
      { label: 'Item', icon: 'box', onclick: () => St.insert(bp, null, { type: 'minecraft:item', item: { id: 'minecraft:diamond' } }, { reason: 'add-body' }) },
    ]));
    return F.section('Body', { note: list.length ? U.plural(list.length, 'element') : null, body });
  }

  function bodyEntry(path, i, len, listPath, b) {
    const t = isObj(b) ? SC.bare(b.type) : '';
    if (t === 'item') {
      return F.entry({
        path, icon: 'box', kind: 'Item', defaultOpen: len <= 2, listPath, index: i, len,
        summary: () => { const x = St.get(path); return x ? DMC.items.summary(x.item) : ''; },
        body: () => h('div', { class: 'stack' }, itemBody(path)),
      });
    }
    return F.entry({
      path, icon: 'type', kind: 'Text', defaultOpen: len <= 2, listPath, index: i, len,
      summary: () => { const x = St.get(path); return x ? plain(x.contents) : ''; },
      body: () => h('div', { class: 'stack' },
        F.field('Text', TE().build({ bind: F.bind(path + '.contents'), multiline: true, rows: 3, placeholder: 'Write your message' }), { path: path + '.contents', noFor: true }),
        F.optNum(path + '.width', 'Width', SC.defaults.plainWidth, { int: true, min: 1, max: 1024, empty: 'Default width (' + SC.defaults.plainWidth + ' px) — long text wraps.' })),
    });
  }

  function itemBody(path) {
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(DMC.items.field(path + '.item'));
    const dBind = F.bind(path + '.description');
    const descBody = () => {
      const v = dBind.get();
      const wide = isObj(v) && 'contents' in v;
      const box = h('div', { class: 'stack-s' });
      box.appendChild(F.seg([{ id: 'text', label: 'Text' }, { id: 'wide', label: 'Text with width' }], wide ? 'wide' : 'text', (id) => {
        const cur = dBind.get();
        if (id === 'wide') dBind.set({ contents: isObj(cur) && 'contents' in cur ? cur.contents : cur }, true);
        else dBind.set(isObj(cur) && 'contents' in cur ? cur.contents : cur, true);
      }, { label: 'Description layout' }));
      if (wide) {
        box.appendChild(TE().build({ bind: F.bind(path + '.description.contents'), multiline: true, placeholder: 'Description' }));
        box.appendChild(F.optNum(path + '.description.width', 'Width', SC.defaults.plainWidth, { int: true, min: 1, max: 1024 }));
      } else box.appendChild(TE().build({ bind: dBind, multiline: true, placeholder: 'Description beside the item' }));
      return box;
    };
    wrap.appendChild(F.optional(dBind, 'Description', () => 'Description', descBody, { path: path + '.description', noFor: true, hint: 'Text shown next to the item', empty: 'No text beside the item.' }));
    wrap.appendChild(h('div', { class: 'grid2' },
      h('label', { class: 'sw-row' }, F.bool(path + '.show_decorations', { dflt: true, label: 'Show count and durability' }), h('span', null, 'Show count and durability')),
      h('label', { class: 'sw-row' }, F.bool(path + '.show_tooltip', { dflt: true, label: 'Show tooltip on hover' }), h('span', null, 'Show tooltip on hover'))));
    wrap.appendChild(h('div', { class: 'grid2' },
      F.optNum(path + '.width', 'Width', SC.defaults.itemSize, { int: true, min: 1, max: 256, empty: 'Default 16 px.' }),
      F.optNum(path + '.height', 'Height', SC.defaults.itemSize, { int: true, min: 1, max: 256, empty: 'Default 16 px.' })));
    return wrap;
  }

  /* ------------------------------------------------------------------ *
   * Inputs
   * ------------------------------------------------------------------ */
  const INPUT_ICON = { text: 'type', boolean: 'toggle', single_option: 'select', number_range: 'sliders' };
  const INPUT_LABEL = { text: 'Text field', boolean: 'Toggle', single_option: 'Option picker', number_range: 'Slider' };
  const INPUT_SENDS = {
    text: 'Sends the typed text.', boolean: 'Sends “true” / “false” (or your own words).', single_option: 'Sends the id of the chosen option.', number_range: 'Sends the number.',
  };

  function newInput(type, existing) {
    const used = new Set(existing.filter(isObj).map((i) => i.key));
    const uniq = (k) => { let x = k; let n = 2; while (used.has(x)) x = k + n++; return x; };
    switch (type) {
      case 'text': return { type: 'minecraft:text', key: uniq('message'), label: 'Message' };
      case 'boolean': return { type: 'minecraft:boolean', key: uniq('enabled'), label: 'Enabled', initial: false };
      case 'single_option': return { type: 'minecraft:single_option', key: uniq('choice'), label: 'Choice', options: [{ id: 'one', display: 'One', initial: true }, { id: 'two', display: 'Two' }] };
      default: return { type: 'minecraft:number_range', key: uniq('amount'), label: 'Amount', start: 1, end: 10, step: 1, initial: 1 };
    }
  }

  function inputsSection(base) {
    const ip = P(base, 'inputs');
    const list = Array.isArray(St.get(ip)) ? St.get(ip) : [];
    const entries = h('div', { class: 'entries' });
    list.forEach((inp, i) => entries.appendChild(inputEntry(ip + '.' + i, i, list.length, ip, base)));
    const body = [];
    if (!list.length) body.push(h('div', { class: 'sec-empty' }, 'Inputs let players type, toggle or slide a value. A “Run command with inputs” button then uses them as $(key).'));
    body.push(entries);
    body.push(F.addRow(SC.inputTypes.map((t) => ({
      label: t.label, icon: t.icon, title: t.desc,
      onclick: () => St.insert(ip, null, newInput(t.id, list), { reason: 'add-input' }),
    }))));
    return F.section('Inputs', { note: list.length ? U.plural(list.length, 'input') : 'optional', body });
  }

  function convertInput(old, newType) {
    const o = newInput(newType, []);
    o.key = old.key || o.key;
    if (old.label !== undefined) o.label = old.label;
    return o;
  }

  function inputEntry(path, i, len, listPath, base) {
    const inp = St.get(path);
    const t = isObj(inp) ? SC.bare(inp.type) : 'text';
    return F.entry({
      path, icon: INPUT_ICON[t] || 'help', kind: INPUT_LABEL[t] || 'Input', defaultOpen: len <= 2, listPath, index: i, len,
      summary: () => { const x = St.get(path); return x ? (x.key ? x.key : '') + (x.label !== undefined ? ' — ' + plain(x.label) : '') : ''; },
      body: () => inputBody(path, t, base),
    });
  }

  function inputBody(path, t, base) {
    void base;
    const wrap = h('div', { class: 'stack' });
    const typeSel = h('select', { class: 'inp', 'aria-label': 'Input type' });
    for (const x of SC.inputTypes) typeSel.appendChild(h('option', { value: x.id }, x.label));
    typeSel.value = t;
    typeSel.addEventListener('change', () => St.set(path, convertInput(St.get(path), typeSel.value), { structural: true, coalesce: null }));
    const keyIn = F.str(path + '.key', { mono: true, placeholder: 'key', aria: 'Key' });
    const copy = h('button', { type: 'button', class: 'btn sm', title: 'Copy $(key) to use in a command', onclick: async () => { const k = (St.get(path) || {}).key || ''; const ok = await U.copy('$(' + k + ')'); F.toast(ok ? 'Copied $(' + k + ')' : 'Could not copy', { kind: ok ? 'ok' : 'err' }); } }, U.icon('copy', 14), '$( )');
    wrap.appendChild(h('div', { class: 'grid2' },
      F.field('Type', typeSel, { path: path + '.type' }),
      F.field('Key', h('div', { class: 'inp-row' }, keyIn, copy), { path: path + '.key', noFor: true, hint: 'Used as $(key)' })));
    wrap.appendChild(F.field('Label', TE().build({ bind: F.bind(path + '.label'), placeholder: 'What the player sees' }), { path: path + '.label', noFor: true }));
    wrap.appendChild(h('div', { class: 'hint', style: 'margin-top:-6px' }, INPUT_SENDS[t]));
    switch (t) {
      case 'text': {
        wrap.appendChild(h('div', { class: 'grid2' },
          F.optNum(path + '.width', 'Width', SC.defaults.inputWidth, { int: true, min: 1, max: 1024, empty: 'Default ' + SC.defaults.inputWidth + ' px.' }),
          F.optNum(path + '.max_length', 'Max length', SC.defaults.maxLength, { int: true, min: 1, empty: 'Default ' + SC.defaults.maxLength + ' characters.' })));
        wrap.appendChild(F.field('Starting text', F.str(path + '.initial', { delEmpty: true, placeholder: 'Empty', aria: 'Starting text' }), { path: path + '.initial' }));
        const mb = F.bind(path + '.multiline');
        wrap.appendChild(F.optional(mb, 'Multiple lines', () => ({}), () => h('div', { class: 'grid2' },
          F.optNum(path + '.multiline.max_lines', 'Max lines', 4, { int: true, min: 1, empty: 'No limit.' }),
          F.optNum(path + '.multiline.height', 'Height', 64, { int: true, min: 1, max: 512, empty: 'Automatic.' })), { path: path + '.multiline', noFor: true, hint: 'Turns it into a text box', empty: 'A single line.' }));
        wrap.appendChild(h('label', { class: 'sw-row' }, F.bool(path + '.label_visible', { dflt: true, label: 'Show the label' }), h('span', null, 'Show the label above the field')));
        break;
      }
      case 'boolean': {
        wrap.appendChild(h('label', { class: 'sw-row' }, F.bool(path + '.initial', { dflt: false, label: 'Starts checked' }), h('span', null, 'Starts checked')));
        wrap.appendChild(h('div', { class: 'grid2' },
          F.optional(F.bind(path + '.on_true'), 'Sends when checked', () => 'true', () => F.str(path + '.on_true', { mono: true, aria: 'Value when checked' }), { path: path + '.on_true', empty: 'Sends “true”.' }),
          F.optional(F.bind(path + '.on_false'), 'Sends when unchecked', () => 'false', () => F.str(path + '.on_false', { mono: true, aria: 'Value when unchecked' }), { path: path + '.on_false', empty: 'Sends “false”.' })));
        break;
      }
      case 'single_option': {
        wrap.appendChild(h('div', { class: 'grid2' },
          F.optNum(path + '.width', 'Width', SC.defaults.inputWidth, { int: true, min: 1, max: 1024, empty: 'Default ' + SC.defaults.inputWidth + ' px.' }),
          h('label', { class: 'sw-row', style: 'align-self:end' }, F.bool(path + '.label_visible', { dflt: true, label: 'Show the label' }), h('span', null, 'Show the label'))));
        wrap.appendChild(optionsEditor(path));
        break;
      }
      case 'number_range': {
        wrap.appendChild(h('div', { class: 'grid3' },
          F.field('From', F.num(path + '.start', { delEmpty: false, placeholder: '0', aria: 'Start' }), { path: path + '.start' }),
          F.field('To', F.num(path + '.end', { delEmpty: false, placeholder: '10', aria: 'End' }), { path: path + '.end' }),
          F.optNum(path + '.step', 'Step', 1, { min: 0, empty: 'Smooth.' })));
        wrap.appendChild(h('div', { class: 'grid2' },
          F.optNum(path + '.initial', 'Starts at', 0, { empty: 'The middle.' }),
          F.optNum(path + '.width', 'Width', SC.defaults.inputWidth, { int: true, min: 1, max: 1024, empty: 'Default ' + SC.defaults.inputWidth + ' px.' })));
        const lf = F.bind(path + '.label_format');
        wrap.appendChild(F.optional(lf, 'Value format', () => 'options.generic_value', () => {
          const inp = F.str(lf, { mono: true, aria: 'Label format translation key' });
          return h('div', { class: 'inp-row' }, inp, h('button', { type: 'button', class: 'btn icon sm', 'aria-label': 'Browse translations', onclick: (e) => Pick.lang(e.currentTarget, { onPick: (k) => lf.set(k, true) }) }, U.icon('search', 15)));
        }, { path: path + '.label_format', noFor: true, hint: 'Translation key with “label: value”', empty: 'Default “Label: value”.' }));
        break;
      }
      default: break;
    }
    return wrap;
  }

  function optionsEditor(path) {
    const op = path + '.options';
    const opts = Array.isArray(St.get(op)) ? St.get(op) : [];
    const wrap = h('div', { class: 'stack-s', 'data-path': op });
    wrap.appendChild(h('div', { class: 'fld-head' }, h('span', { class: 'fld-label' }, 'Options'), h('span', { class: 'hint' }, 'The button cycles through these')));
    const rows = h('div', { class: 'stack-s' });
    opts.forEach((o, i) => {
      const p = op + '.' + i;
      const initial = isObj(o) && o.initial === true;
      const idIn = F.str(p + '.id', { mono: true, placeholder: 'value sent', aria: 'Option value' });
      const row = h('div', { class: 'part', 'data-path': p },
        h('div', { class: 'part-h' },
          h('div', { class: 'part-main', style: 'flex:1 1 140px;max-width:220px' }, idIn),
          h('div', { style: 'flex:2 1 160px;min-width:0' }, TE().build({ bind: F.bind(p + '.display'), placeholder: 'Shown to the player (optional)', preview: false, nested: true })),
          h('div', { class: 'part-tools' },
            h('button', { type: 'button', class: 'btn sm' + (initial ? ' on' : ' ghost'), title: 'The option selected when the dialog opens', 'aria-pressed': String(initial), onclick: () => {
              St.commit((d) => { (U.getPath(d, op) || []).forEach((x, j) => { if (isObj(x)) { if (j === i && !initial) x.initial = true; else delete x.initial; } }); }, { structural: true });
            } }, initial ? 'Default ✓' : 'Default'),
            F.iconBtn('arrow-up', 'Move up', () => St.move(op, i, i - 1), { disabled: i === 0 }),
            F.iconBtn('arrow-down', 'Move down', () => St.move(op, i, i + 1), { disabled: i >= opts.length - 1 }),
            F.iconBtn('trash', 'Remove option', () => St.remove(op, i), { danger: true }))),
        h('div', { class: 'fld-msgs' }));
      rows.appendChild(row);
    });
    wrap.appendChild(rows);
    wrap.appendChild(F.addRow([
      { label: 'Option', icon: 'plus', onclick: () => St.insert(op, null, { id: 'option' + (opts.length + 1), display: 'Option ' + (opts.length + 1) }) },
      { label: 'Item…', icon: 'box', onclick: (e) => Pick.registry(e.currentTarget, { kind: 'items', onPick: (id) => St.insert(op, null, { id, display: R.itemName(id, St.version()) }) }) },
      { label: 'Entity…', icon: 'user', onclick: (e) => Pick.registry(e.currentTarget, { kind: 'entities', onPick: (id) => St.insert(op, null, { id, display: R.entityName(id, St.version()) }) }) },
      { label: 'Effect…', icon: 'zap', onclick: (e) => Pick.registry(e.currentTarget, { kind: 'effects', onPick: (id) => St.insert(op, null, { id, display: DMC.lang.get('effect.minecraft.' + DMC.rl.bare(id), St.version()) || U.prettyId(id) }) }) },
    ]));
    return wrap;
  }

  /* ------------------------------------------------------------------ *
   * Buttons per dialog type
   * ------------------------------------------------------------------ */
  function buttonEntry(path, o) {
    return F.entry(Object.assign({
      path, icon: 'zap', kind: 'Button', defaultOpen: false,
      summary: () => { const b = St.get(path); if (!isObj(b)) return ''; const l = A().buttonSummary(b); const a = b.action ? A().summary(b.action, 'dialog') : ''; return l + (a ? ' · ' + a : ''); },
      body: () => A().buildButton(path, { base: o.base, optionalLabel: o.optionalLabel, actionHint: o.actionHint }),
    }, o));
  }

  function singleButtonSection(title, note, base, defs) {
    const entries = h('div', { class: 'entries' });
    for (const def of defs) {
      const path = P(base, def.key);
      if (def.optional && St.get(path) === undefined) {
        entries.appendChild(F.field(def.label, h('div', { class: 'hint' }, def.empty), { path, tools: F.sw(false, () => St.set(path, def.make(), { structural: true }), { label: 'Add ' + def.label.toLowerCase() }), noFor: true }));
        continue;
      }
      const tools = def.optional ? [F.iconBtn('trash', 'Remove', () => St.del(path), { danger: true })] : null;
      entries.appendChild(buttonEntry(path, { kind: def.label, icon: def.icon || 'zap', defaultOpen: def.open !== false, extraTools: tools, base, optionalLabel: def.optionalLabel, actionHint: def.actionHint }));
    }
    return F.section(title, { note, body: [entries] });
  }

  function noticeSection(base) {
    return singleButtonSection('Button', null, base, [{ key: 'action', label: 'Button', icon: 'zap', optional: true, optionalLabel: true, make: () => ({ label: 'OK' }), empty: 'No button set — the game adds a default “OK” that just closes the dialog.' }]);
  }
  function confirmationSection(base) {
    return singleButtonSection('Buttons', 'yes and no', base, [
      { key: 'yes', label: 'Yes button', icon: 'check-square' },
      { key: 'no', label: 'No button', icon: 'x', actionHint: 'No action — clicking just closes the dialog (ESC does the same).' },
    ]);
  }

  function columnsField(base) {
    return F.field('Columns', F.num(P(base, 'columns'), { int: true, min: 1, placeholder: String(SC.defaults.columns), aria: 'Columns' }), { path: P(base, 'columns'), row: true, hint: 'Buttons per row' });
  }

  function exitSection(base, hint) {
    const path = P(base, 'exit_action');
    if (St.get(path) === undefined) {
      return F.field('Exit button', h('div', { class: 'hint' }, hint), { path, tools: F.sw(false, () => St.set(path, { label: { translate: 'gui.back' } }, { structural: true }), { label: 'Add exit button' }), noFor: true });
    }
    return h('div', { class: 'entries' }, buttonEntry(path, { kind: 'Exit button', icon: 'arrow-left', extraTools: [F.iconBtn('trash', 'Remove', () => St.del(path), { danger: true })], base, defaultOpen: false }));
  }

  function multiActionSection(base) {
    const ap = P(base, 'actions');
    const list = Array.isArray(St.get(ap)) ? St.get(ap) : [];
    const entries = h('div', { class: 'entries' });
    list.forEach((b, i) => entries.appendChild(buttonEntry(ap + '.' + i, { listPath: ap, index: i, len: list.length, base, defaultOpen: list.length <= 2 })));
    const body = [];
    if (!list.length) body.push(h('div', { class: 'sec-empty' }, 'Add at least one button.'));
    body.push(entries);
    body.push(F.addRow([{ label: 'Button', icon: 'plus', primary: !list.length, onclick: () => St.insert(ap, null, { label: 'Button ' + (list.length + 1) }, { reason: 'add-button' }) }]));
    body.push(h('div', { class: 'divider' }));
    body.push(columnsField(base));
    body.push(exitSection(base, 'No exit button — players close the dialog with ESC (if allowed).'));
    return F.section('Buttons', { note: list.length ? U.plural(list.length, 'button') : null, body });
  }

  function serverLinksSection(base) {
    return F.section('Server links', { body: [
      h('div', { class: 'msg info' }, U.icon('info', 14), h('div', { class: 'm-body' }, 'The buttons come from the links the server provides (server.properties “bug report” link, plugins or mods). On a vanilla server the list is empty.')),
      columnsField(base),
      F.optNum(P(base, 'button_width'), 'Button width', SC.defaults.buttonWidth, { int: true, min: 1, max: 1024, row: true, empty: 'Default ' + SC.defaults.buttonWidth + ' px.' }),
      exitSection(base, 'No exit button.'),
    ] });
  }

  /* dialog list */
  function dialogListSection(base) {
    const dp = P(base, 'dialogs');
    const v = St.get(dp);
    const tagMode = typeof v === 'string' && v.startsWith('#');
    const body = [];
    body.push(F.seg([{ id: 'list', label: 'Chosen dialogs', icon: 'list' }, { id: 'tag', label: 'Everything in a tag', icon: 'tag' }], tagMode ? 'tag' : 'list', (id) => {
      if (id === 'tag') St.set(dp, '#' + St.project().pack.namespace + ':menu', { structural: true });
      else St.set(dp, [], { structural: true });
    }, { label: 'Where the buttons come from' }));
    if (tagMode) body.push(tagEditor(dp, v));
    else body.push(listEditor(dp, base, Array.isArray(v) ? v : []));
    body.push(h('div', { class: 'divider' }));
    body.push(columnsField(base));
    body.push(F.optNum(P(base, 'button_width'), 'Button width', SC.defaults.buttonWidth, { int: true, min: 1, max: 1024, row: true, empty: 'Default ' + SC.defaults.buttonWidth + ' px.' }));
    body.push(exitSection(base, 'No exit button.'));
    return F.section('Dialogs', { note: 'each becomes a button', body });
  }

  function tagEditor(dp, v) {
    const wrap = h('div', { class: 'stack-s' });
    const input = h('input', { class: 'inp mono', value: v, placeholder: '#' + St.project().pack.namespace + ':menu', spellcheck: 'false', 'aria-label': 'Dialog tag' });
    input.addEventListener('input', () => St.set(dp, input.value, { coalesce: 'tag' }));
    input.addEventListener('change', () => { E.render(); });
    wrap.appendChild(F.field('Tag', h('div', { class: 'inp-row' }, input, h('button', { type: 'button', class: 'btn sm', onclick: (e) => Pick.dialogId(e.currentTarget, { tags: true, onPick: (id) => { if (id.startsWith('#')) St.set(dp, id, { structural: true }); else St.set(dp, '#' + id.replace(/^#/, ''), { structural: true }); }, footer: 'Pick a built-in tag, or type your own like #my_pack:menu.' }) }, U.icon('tag', 14), 'Tags')), { path: dp, noFor: true, hint: 'A dialog tag lists many dialogs at once' }));
    const tag = DMC.rl.norm(String(v).replace(/^#/, ''));
    const entries = St.project().dialogs;
    const memberOf = (e) => {
      const t = e.tags || {};
      if (tag === 'minecraft:pause_screen_additions') return !!t.pause;
      if (tag === 'minecraft:quick_actions') return !!t.quick;
      return (t.extra || []).map(DMC.rl.norm).includes(tag);
    };
    const toggleMember = (i, on) => {
      const e = entries[i];
      if (tag === 'minecraft:pause_screen_additions') St.setTags(i, { pause: on });
      else if (tag === 'minecraft:quick_actions') St.setTags(i, { quick: on });
      else {
        const ex = (e.tags.extra || []).filter((x) => DMC.rl.norm(x) !== tag);
        if (on) ex.push(tag);
        St.setTags(i, { extra: ex });
      }
    };
    const grid = h('div', { class: 'stack-s' });
    entries.forEach((e, i) => {
      if (e === St.cur()) return;
      grid.appendChild(h('label', { class: 'sw-row' }, F.sw(memberOf(e), (on) => toggleMember(i, on), { label: 'Include ' + e.id }), h('span', { class: 'mono' }, St.fullId(e)), h('span', { class: 'hint' }, plain(e.dialog.title))));
    });
    wrap.appendChild(h('div', { class: 'fld-head' }, h('span', { class: 'fld-label' }, 'Members of this tag in your pack'), h('span', { class: 'hint' }, 'Written to the data pack’s tag file')));
    wrap.appendChild(entries.length > 1 ? grid : h('div', { class: 'hint' }, 'Add more dialogs to your project to put them in this tag.'));
    if (tag.startsWith('minecraft:') && !DMC.vanillaDialogTags.includes('#' + tag)) wrap.appendChild(h('div', { class: 'msg warn' }, U.icon('warn', 14), h('div', { class: 'm-body' }, 'Only a tag in your own namespace (or the two built-in tags) makes sense here.')));
    return wrap;
  }

  function listEditor(dp, base, list) {
    const wrap = h('div', { class: 'stack-s' });
    const entries = h('div', { class: 'entries' });
    list.forEach((x, i) => {
      const path = dp + '.' + i;
      const inline = isObj(x);
      entries.appendChild(F.entry({
        path, icon: 'layers', kind: inline ? 'Inline dialog' : 'Dialog', defaultOpen: false, listPath: dp, index: i, len: list.length,
        summary: () => { const y = St.get(path); return typeof y === 'string' ? y : isObj(y) ? plain(y.title) : ''; },
        body: () => {
          const w = h('div', { class: 'stack' });
          if (inline) {
            w.appendChild(E.inlineDialog(path));
          } else {
            const input = h('input', { class: 'inp mono', value: typeof x === 'string' ? x : '', placeholder: St.project().pack.namespace + ':rules', spellcheck: 'false', 'aria-label': 'Dialog id' });
            input.addEventListener('input', () => St.set(path, input.value));
            const pick = h('button', { type: 'button', class: 'btn sm', onclick: (e) => Pick.dialogId(e.currentTarget, { exclude: St.fullId(St.cur()), onPick: (id) => St.set(path, id, { structural: true }) }) }, U.icon('layers', 14), 'Choose');
            w.appendChild(F.field('Dialog id', h('div', { class: 'inp-row' }, input, pick), { path, noFor: true }));
            const idx = St.project().dialogs.findIndex((e) => St.fullId(e) === DMC.rl.norm(String(x)));
            if (idx >= 0) w.appendChild(h('div', { class: 'cluster' }, h('button', { type: 'button', class: 'btn xs', onclick: () => St.select(idx) }, U.icon('external', 12), 'Edit this dialog')));
          }
          return w;
        },
      }));
    });
    wrap.appendChild(entries);
    const existing = new Set(list.filter((x) => typeof x === 'string').map(DMC.rl.norm));
    const others = St.project().dialogs.filter((e) => e !== St.cur() && !existing.has(St.fullId(e)));
    wrap.appendChild(F.addRow([
      { label: 'Add dialog', icon: 'plus', onclick: (e) => Pick.dialogId(e.currentTarget, { exclude: St.fullId(St.cur()), onPick: (id) => St.insert(dp, null, id) }) },
      { label: 'Inline dialog', icon: 'layers', onclick: () => St.insert(dp, null, Object.assign(SC.newDialog('notice'), { title: 'Inline dialog' })) },
      { label: 'Add all others (' + others.length + ')', icon: 'list', disabled: !others.length, onclick: () => St.commit((d) => { let arr = U.getPath(d, dp); if (!Array.isArray(arr)) { St.setPath(d, dp, []); arr = U.getPath(d, dp); } for (const e of others) arr.push(St.fullId(e)); }, { structural: true }) },
    ]));
    if (!list.length) wrap.appendChild(h('div', { class: 'sec-empty' }, 'Each dialog you add becomes a button that opens it.'));
    return wrap;
  }

  /* ------------------------------------------------------------------ *
   * Behavior
   * ------------------------------------------------------------------ */
  function behaviorSection(base) {
    const after = St.get(P(base, 'after_action')) || 'close';
    const afterSeg = F.seg(SC.afterActions.map((x) => ({ id: x.id, label: x.label, title: x.desc })), after, (id) => {
      const pausePath = P(base, 'pause');
      St.commit((root) => {
        if (id === 'close') St.setPath(root, P(base, 'after_action'), undefined); else St.setPath(root, P(base, 'after_action'), id);
        if (id === 'none' && St.getPath(root, pausePath) !== false) St.setPath(root, pausePath, false);
      }, { structural: true, reason: 'after-action' });
      if (id === 'none' && St.get(pausePath) === false) F.toast('Pause turned off — “stay open” needs it off.', { kind: 'ok' });
    }, { label: 'After a button is clicked', wrap: true });
    const afterDef = SC.afterActions.find((x) => x.id === after);
    const body = [
      F.field('After a button is clicked', afterSeg, { path: P(base, 'after_action'), noFor: true, hint: afterDef ? afterDef.desc : '' }),
      h('div', { class: 'grid2' },
        F.field('Close with ESC', h('label', { class: 'sw-row' }, F.bool(P(base, 'can_close_with_escape'), { dflt: true, label: 'Close with ESC' }), h('span', null, 'Players can press ESC to close it')), { path: P(base, 'can_close_with_escape'), noFor: true }),
        F.field('Pause the game', h('label', { class: 'sw-row' }, F.bool(P(base, 'pause'), { dflt: true, label: 'Pause the game', onChange: () => { /* after_action none requires this off */ } }), h('span', null, 'Pauses single-player while open')), { path: P(base, 'pause'), noFor: true })),
    ];
    return F.section('Behavior', { body });
  }

  /* ------------------------------------------------------------------ *
   * Issue mapping
   * ------------------------------------------------------------------ */
  function findMsgs(el) {
    let m = el.querySelector(':scope > .fld-msgs');
    if (m) return m;
    if (el.classList.contains('te')) {
      m = el.querySelector(':scope > .te-parts > .part > .fld-msgs');
      if (m) return m;
    }
    if (el.classList.contains('entry')) {
      m = el.querySelector(':scope > .entry-b > .fld-msgs');
      if (m) return m;
    }
    m = el.querySelector('.fld-msgs');
    return m;
  }

  E.applyIssues = function () {
    if (!host) return;
    const issues = St.issues || [];
    host.querySelectorAll('.fld-msgs').forEach((el) => { if (el.firstChild) el.textContent = ''; });
    host.querySelectorAll('.i-err,.i-warn').forEach((el) => el.classList.remove('i-err', 'i-warn'));
    host.querySelectorAll('.entry.has-error,.entry.has-warn').forEach((el) => el.classList.remove('has-error', 'has-warn'));
    const map = new Map();
    host.querySelectorAll('[data-path]').forEach((el) => { if (!map.has(el.dataset.path)) map.set(el.dataset.path, el); });
    const entryCounts = new Map();
    const entries = Array.from(host.querySelectorAll('[data-entry]'));
    for (const it of issues) {
      let p = it.path || '';
      let el = null;
      for (;;) {
        if (map.has(p)) { el = map.get(p); break; }
        if (p === '') break;
        const i = p.lastIndexOf('.');
        p = i < 0 ? '' : p.slice(0, i);
      }
      if (!el) continue;
      const msgs = findMsgs(el);
      if (msgs) msgs.appendChild(F.msgEl(it));
      if (p === (it.path || '') && it.level !== 'info') {
        const ctl = el.matches('.inp') ? el : el.querySelector('.inp');
        if (ctl) ctl.classList.add(it.level === 'error' ? 'i-err' : 'i-warn');
      }
    }
    // entry badges
    for (const en of entries) {
      const ep = en.dataset.path;
      let err = 0;
      let warn = 0;
      for (const it of issues) {
        const ip = it.path || '';
        if (ip === ep || ip.startsWith(ep + '.')) { if (it.level === 'error') err++; else if (it.level === 'warn') warn++; }
      }
      entryCounts.set(en, { err, warn });
      en.classList.toggle('has-error', err > 0);
      en.classList.toggle('has-warn', !err && warn > 0);
      const head = en.querySelector(':scope > .entry-h');
      let bd = head.querySelector(':scope > .e-badge');
      if (!err && !warn) { if (bd) bd.remove(); continue; }
      if (!bd) { bd = h('span', { class: 'e-badge' }); head.insertBefore(bd, head.querySelector(':scope > .e-tools')); }
      bd.textContent = '';
      if (err) bd.appendChild(h('span', { class: 'count err', title: U.plural(err, 'error') }, err));
      if (warn) bd.appendChild(h('span', { class: 'count warn', title: U.plural(warn, 'warning') }, warn));
    }
  };

  /** Scroll to and flash the field an issue belongs to. */
  E.reveal = function (path) {
    if (!host) return;
    const parts = path.split('.');
    // open any collapsed entries on the way
    const entries = Array.from(host.querySelectorAll('[data-entry]'));
    for (const en of entries) {
      const ep = en.dataset.path;
      if ((path === ep || path.startsWith(ep + '.')) && en._setOpen && en.classList.contains('collapsed')) en._setOpen(true);
    }
    let p = path;
    let el = null;
    for (;;) {
      el = Array.from(host.querySelectorAll('[data-path]')).find((x) => x.dataset.path === p);
      if (el || p === '') break;
      const i = p.lastIndexOf('.');
      p = i < 0 ? '' : p.slice(0, i);
    }
    void parts;
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1400);
      const f = el.querySelector('input,textarea,select,button');
      if (f) f.focus({ preventScroll: true });
    }
  };
})();
