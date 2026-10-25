/* Dialog MC — action editor (what a click does) and the button editor. Live command checking happens here. */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const U = DMC.util;
  const h = U.h;
  const St = DMC.store;
  const F = DMC.fields;
  const SC = DMC.schema;
  const C = DMC.cmd;
  const Pick = DMC.pick;
  const A = (DMC.actions = {});
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  const GROUPS = {
    run_command: 'Do something', suggest_command: 'Do something', 'dynamic/run_command': 'Do something', copy_to_clipboard: 'Do something',
    open_url: 'Open something', show_dialog: 'Open something', change_page: 'Open something',
    custom: 'Tell a plugin or mod', 'dynamic/custom': 'Tell a plugin or mod',
  };
  const ORDER = ['run_command', 'dynamic/run_command', 'suggest_command', 'copy_to_clipboard', 'open_url', 'show_dialog', 'custom', 'dynamic/custom', 'change_page'];

  const typeKey = (mode) => (mode === 'text' ? 'action' : 'type');
  const typeOf = (a, mode) => (isObj(a) && typeof a[typeKey(mode)] === 'string' ? SC.bare(a[typeKey(mode)]) : null);

  /** Short human summary for list headers. */
  A.summary = function (a, mode) {
    const t = typeOf(a, mode);
    if (!t) return 'No action';
    const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
    switch (t) {
      case 'run_command': return 'Runs ' + clip('/' + C.stripSlash(String(a.command || '')), 44);
      case 'suggest_command': return 'Suggests ' + clip(String(a.command || ''), 44);
      case 'dynamic/run_command': return 'Runs ' + clip('/' + C.stripSlash(String(a.template || '')), 44);
      case 'open_url': return 'Opens ' + clip(String(a.url || ''), 44);
      case 'copy_to_clipboard': return 'Copies ' + clip(String(a.value || ''), 40);
      case 'show_dialog': return 'Opens ' + (typeof a.dialog === 'string' ? a.dialog : a.dialog ? 'an inline dialog' : '…');
      case 'custom': case 'dynamic/custom': return 'Sends ' + clip(String(a.id || ''), 40);
      case 'change_page': return 'Changes page';
      default: return t;
    }
  };

  function convertAction(old, newType, mode) {
    const key = typeKey(mode);
    const out = { [key]: mode === 'text' ? newType : 'minecraft:' + newType };
    const cmd = isObj(old) ? old.command || old.template || '' : '';
    const ns = St.project().pack.namespace;
    switch (newType) {
      case 'run_command': out.command = cmd || 'help'; break;
      case 'suggest_command': out.command = cmd || '/help'; break;
      case 'dynamic/run_command': out.template = cmd || 'help'; break;
      case 'open_url': out.url = isObj(old) && old.url ? old.url : 'https://www.minecraft.net'; break;
      case 'copy_to_clipboard': out.value = isObj(old) && old.value ? old.value : 'Copied text'; break;
      case 'show_dialog': {
        const others = St.project().dialogs.filter((e) => e !== St.cur());
        out.dialog = isObj(old) && old.dialog ? old.dialog : others.length ? St.fullId(others[0]) : ns + ':other';
        break;
      }
      case 'custom': out.id = isObj(old) && old.id ? old.id : ns + ':my_event'; break;
      case 'dynamic/custom': out.id = isObj(old) && old.id ? old.id : ns + ':my_event'; break;
      case 'change_page': out.page = 1; break;
      default: break;
    }
    return out;
  }
  A.convert = convertAction;

  /* ------------------------------------------------------------------ *
   * Command field with live status
   * ------------------------------------------------------------------ */
  function commandField(bind, key, o) {
    o = o || {};
    const b = F.subBind(bind, key);
    const wrap = h('div', { class: 'stack-s', style: 'gap:6px' });
    const input = h(o.multiline ? 'textarea' : 'input', {
      class: 'inp mono', type: o.multiline ? null : 'text', rows: o.multiline ? 2 : null, spellcheck: 'false', autocomplete: 'off',
      placeholder: o.placeholder || 'give @s minecraft:diamond 1', 'aria-label': o.aria || 'Command',
    });
    const cur = (bind.get() || {})[key];
    input.value = typeof cur === 'string' ? cur : '';
    const status = h('div', { class: 'cmd-status', 'aria-live': 'polite' });
    const row = h('div', { class: 'inp-row' }, input);
    if (o.ideas) {
      row.appendChild(h('button', { type: 'button', class: 'btn sm', title: 'Command ideas', onclick: (e) => Pick.commands(e.currentTarget, { onPick: (cmd) => { input.value = cmd; b.set(cmd, false); refresh(); input.focus(); } }) }, U.icon('terminal', 14), 'Ideas'));
    }
    if (o.insert) row.appendChild(o.insert(input, refresh));
    wrap.appendChild(row);
    wrap.appendChild(status);

    function expandedCmd() {
      const v = input.value;
      return o.expand ? o.expand(v) : v;
    }
    function refresh() {
      status.textContent = '';
      const raw = input.value;
      if (!raw.trim()) return;
      const cmd = expandedCmd();
      if (o.expand && cmd !== raw) {
        status.appendChild(h('div', { class: 'cmd-became' }, h('span', { class: 'hint' }, 'With sample values:'), h('code', null, cmd)));
      }
      const r = C.validate(cmd, St.version());
      if (!r.ok) {
        const e = r.errors[0];
        let pos = e.pos == null ? cmd.length : e.pos;
        let end = e.end == null ? pos + 1 : e.end;
        if (end <= pos + 1 && pos < cmd.length) {
          const m = /^\S+/.exec(cmd.slice(pos));
          if (m) end = pos + m[0].length;
        }
        const echo = h('code', { class: 'cmd-echo' },
          cmd.slice(0, pos),
          h('span', { class: 'bad' }, cmd.slice(pos, end) || '␣'),
          cmd.slice(end));
        status.appendChild(h('div', { class: 'cmd-line bad' }, U.icon('error', 13), echo));
      } else if (!r.signed && r.level === 0) {
        status.appendChild(h('div', { class: 'cmd-line ok' }, U.icon('check', 13), h('span', null, 'Valid command — anyone can run it')));
      }
    }
    input.addEventListener('input', () => { b.set(input.value, false); refresh(); });
    if (o.multiline) F.autosize(input, 6);
    refresh();
    wrap.refresh = refresh;
    wrap.input = input;
    return wrap;
  }

  /* ------------------------------------------------------------------ *
   * Template inputs ($(key))
   * ------------------------------------------------------------------ */
  const INPUT_PRESETS = [
    { id: 'player', label: 'Player name', desc: 'Text field — the player types a name', icon: 'user', make: () => ({ type: 'minecraft:text', key: 'player', label: 'Player name', max_length: 16 }) },
    { id: 'text', label: 'Text or message', desc: 'Free text field', icon: 'type', make: () => ({ type: 'minecraft:text', key: 'message', label: 'Message' }) },
    { id: 'item', label: 'Item', desc: 'Option picker — you choose which items it offers', icon: 'box', make: () => ({ type: 'minecraft:single_option', key: 'item', label: 'Item', options: [{ id: 'minecraft:diamond', display: 'Diamond', initial: true }, { id: 'minecraft:emerald', display: 'Emerald' }, { id: 'minecraft:gold_ingot', display: 'Gold ingot' }] }) },
    { id: 'int', label: 'Whole number', desc: 'Slider that moves in steps of 1', icon: 'sliders', make: () => ({ type: 'minecraft:number_range', key: 'amount', label: 'Amount', start: 1, end: 64, step: 1, initial: 1 }) },
    { id: 'decimal', label: 'Decimal number', desc: 'Smooth slider', icon: 'sliders', make: () => ({ type: 'minecraft:number_range', key: 'value', label: 'Value', start: 0, end: 1, initial: 0.5 }) },
    { id: 'bool', label: 'Yes / no', desc: 'Toggle that sends true or false', icon: 'toggle', make: () => ({ type: 'minecraft:boolean', key: 'enabled', label: 'Enabled', initial: false, on_true: 'true', on_false: 'false' }) },
  ];
  const TYPE_ICON = { text: 'type', boolean: 'toggle', single_option: 'select', number_range: 'sliders' };
  const TYPE_LABEL = { text: 'Text', boolean: 'Toggle', single_option: 'Options', number_range: 'Slider' };

  function insertValueButton(base, tplPath) {
    return (input, refresh) => {
      const ipath = base ? base + '.inputs' : 'inputs';
      return h('button', { type: 'button', class: 'btn sm', title: 'Insert a value from an input of this dialog', onclick: (e) => {
        const inputs = (St.get(ipath) || []).filter((i) => isObj(i) && typeof i.key === 'string' && i.key);
        const items = inputs.map((i) => ({
          id: 'key:' + i.key, label: '$(' + i.key + ')', icon: TYPE_ICON[SC.bare(i.type)] || 'hash',
          desc: (TYPE_LABEL[SC.bare(i.type)] || 'Input') + ' · ' + (DMC.text.plain(i.label, St.version()) || 'no label'), group: 'Inputs in this dialog',
        }));
        for (const p of INPUT_PRESETS) items.push({ id: 'new:' + p.id, label: p.label, desc: p.desc, icon: p.icon, group: 'Add a new input and insert it', tag: 'new input' });
        Pick.menu(e.currentTarget, items, {
          width: 340,
          onPick: (it) => {
            if (it.id.startsWith('key:')) {
              F.insertAtCursor(input, '$(' + it.id.slice(4) + ')');
              refresh();
              return;
            }
            const preset = INPUT_PRESETS.find((p) => 'new:' + p.id === it.id);
            const def = preset.make();
            const used = new Set(inputs.map((i) => i.key));
            let k = def.key;
            let n = 2;
            while (used.has(k)) k = def.key + n++;
            def.key = k;
            const pos = input.selectionStart != null ? input.selectionStart : input.value.length;
            const next = input.value.slice(0, pos) + '$(' + k + ')' + input.value.slice(pos);
            // one undo step: add the input and put the macro into the command
            St.commit((d) => {
              let arr = U.getPath(d, ipath);
              if (!Array.isArray(arr)) { St.setPath(d, ipath, []); arr = U.getPath(d, ipath); }
              arr.push(def);
              if (tplPath) St.setPath(d, tplPath, next);
            }, { structural: true, reason: 'insert-input' });
            F.toast('Added the input “' + k + '” and inserted $(' + k + ')', { kind: 'ok' });
          },
        });
      } }, U.icon('plus', 14), 'Insert value');
    };
  }

  /** Sample value for each input when previewing a template. */
  A.sampleValues = function (base) {
    const inputs = (St.get(base ? base + '.inputs' : 'inputs') || []).filter(isObj);
    const vals = {};
    for (const i of inputs) {
      if (typeof i.key !== 'string') continue;
      const t = SC.bare(i.type);
      if (t === 'text') vals[i.key] = C.escapeInput(i.initial || 'text');
      else if (t === 'boolean') vals[i.key] = i.initial ? (i.on_true != null ? i.on_true : 'true') : (i.on_false != null ? i.on_false : 'false');
      else if (t === 'single_option') {
        const opts = Array.isArray(i.options) ? i.options : [];
        const pick = opts.find((o) => isObj(o) && o.initial) || opts[0];
        vals[i.key] = pick == null ? '' : typeof pick === 'string' ? pick : pick.id == null ? '' : String(pick.id);
      } else if (t === 'number_range') {
        const s = typeof i.start === 'number' ? i.start : 0;
        const e = typeof i.end === 'number' ? i.end : 1;
        let v = typeof i.initial === 'number' ? i.initial : (s + e) / 2;
        if (typeof i.step === 'number' && i.step > 0) v = Math.min(e, Math.max(s, s + Math.round((v - s) / i.step) * i.step));
        vals[i.key] = Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
      }
    }
    return vals;
  };

  /* ------------------------------------------------------------------ *
   * Payload editor (custom action): anything the plugin may want
   * ------------------------------------------------------------------ */
  function payloadEditor(bind) {
    const b = F.subBind(bind, 'payload');
    const v = b.get();
    const kind = v === undefined ? 'none' : typeof v === 'string' ? 'text' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'bool' : 'json';
    const wrap = h('div', { class: 'stack-s' });
    wrap.appendChild(F.seg([
      { id: 'none', label: 'None' }, { id: 'text', label: 'Text' }, { id: 'number', label: 'Number' }, { id: 'bool', label: 'Yes / no' }, { id: 'json', label: 'Object / list' },
    ], kind, (id) => {
      if (id === 'none') b.del(true);
      else b.set(id === 'text' ? '' : id === 'number' ? 0 : id === 'bool' ? true : {}, true);
    }, { label: 'Payload type' }));
    if (kind === 'text') {
      const ta = h('textarea', { class: 'inp', rows: 2, 'aria-label': 'Payload text', spellcheck: 'false' });
      ta.value = v;
      ta.addEventListener('input', () => b.set(ta.value, false));
      wrap.appendChild(ta);
    } else if (kind === 'number') {
      const n = h('input', { class: 'inp num', type: 'number', step: 'any', value: v, 'aria-label': 'Payload number' });
      n.addEventListener('input', () => { if (n.value !== '' && Number.isFinite(Number(n.value))) b.set(Number(n.value), false); });
      wrap.appendChild(n);
    } else if (kind === 'bool') {
      wrap.appendChild(h('label', { class: 'sw-row' }, F.sw(v, (on) => b.set(on, false), { label: 'Payload value' }), h('span', null, 'true / false')));
    } else if (kind === 'json') {
      wrap.appendChild(jsonBox(b, 'Payload as JSON or SNBT'));
    }
    return wrap;
  }

  /** Raw JSON / SNBT editor bound to a binding. */
  function jsonBox(b, aria, o) {
    o = o || {};
    const wrap = h('div', { class: 'stack-s', style: 'gap:6px' });
    const ta = h('textarea', { class: 'inp mono', rows: o.rows || 4, spellcheck: 'false', 'aria-label': aria });
    const v = b.get();
    ta.value = v === undefined ? '' : JSON.stringify(v, null, 2);
    const err = h('div', { class: 'msg error', hidden: true });
    ta.addEventListener('input', () => {
      if (!ta.value.trim()) { err.hidden = true; ta.classList.remove('bad'); if (o.emptyDel) b.del(false); return; }
      const r = DMC.snbt.parseLoose(ta.value);
      if (!r.ok) { err.hidden = false; err.textContent = 'Not valid yet: ' + r.error.message + ' (character ' + (r.error.pos + 1) + ')'; ta.classList.add('bad'); return; }
      if (o.object && !isObj(r.value)) { err.hidden = false; err.textContent = 'This needs to be an object { … }.'; ta.classList.add('bad'); return; }
      err.hidden = true;
      ta.classList.remove('bad');
      b.set(r.value, false);
    });
    wrap.appendChild(ta);
    wrap.appendChild(err);
    return wrap;
  }
  A.jsonBox = jsonBox;

  /* ------------------------------------------------------------------ *
   * Action editor
   * cfg: {bind, mode: 'dialog'|'text', base (dialog base path for inputs)}
   * ------------------------------------------------------------------ */
  A.build = function (cfg) {
    const bind = F.toBinding(cfg.bind);
    const mode = cfg.mode || 'dialog';
    const a = bind.get();
    const t = typeOf(a, mode);
    const wrap = h('div', { class: 'stack-s' });
    const key = typeKey(mode);
    const sub = (k) => F.subBind(bind, k);

    // type picker
    const def = t ? SC.actionById[t] : null;
    const types = SC.actionTypes.filter((x) => (mode !== 'text' || x.text)).sort((x, y) => ORDER.indexOf(x.id) - ORDER.indexOf(y.id));
    const typeBtn = h('button', { type: 'button', class: 'btn', style: 'justify-content:flex-start;min-width:230px', 'aria-haspopup': 'menu', onclick: (e) => {
      Pick.menu(e.currentTarget, types.map((x) => ({ id: x.id, label: x.label, desc: x.desc, icon: x.icon, group: GROUPS[x.id] || 'Other', current: x.id === t, tag: x.id === 'change_page' ? 'books only' : null })), {
        width: 360,
        onPick: (it) => {
          if (it.id === t) return;
          bind.set(convertAction(a, it.id, mode), true);
        },
      });
    } }, def ? U.icon(def.icon, 16) : U.icon('help', 16), h('span', { style: 'flex:1;text-align:left' }, def ? def.label : t ? 'Unknown: ' + t : 'Pick an action'), U.icon('chevron-down', 14));
    wrap.appendChild(h('div', { class: 'inp-row' }, typeBtn));
    if (def) wrap.appendChild(h('div', { class: 'hint', style: 'margin-top:-4px' }, def.desc));
    if (!t || !def) return wrap;

    const holder = h('div', { class: 'stack-s' });
    const dataPath = (k) => (bind.path != null ? bind.path + '.' + k : null);
    switch (t) {
      case 'run_command': {
        const cf = commandField(bind, 'command', { ideas: true, aria: 'Command to run' });
        holder.appendChild(F.field('Command', cf, { path: dataPath('command'), noFor: true, hint: 'Without the leading /' }));
        holder.appendChild(h('div', { class: 'hint' }, 'The player runs this like they typed it. Anything that needs operator rights shows a confirmation screen, and fails for players without permission.'));
        break;
      }
      case 'suggest_command': {
        const cf = commandField(bind, 'command', { multiline: false, placeholder: '/msg ', aria: 'Text to put into the chat box' });
        holder.appendChild(F.field('Text for the chat box', cf, { path: dataPath('command'), noFor: true }));
        break;
      }
      case 'dynamic/run_command': {
        const base = cfg.base || '';
        const vals = A.sampleValues(base);
        const cf = commandField(bind, 'template', {
          ideas: true, aria: 'Command template', placeholder: 'give @s minecraft:diamond $(amount)',
          expand: (s) => C.expand(s, vals), insert: insertValueButton(base, dataPath('template')),
        });
        holder.appendChild(F.field('Command template', cf, { path: dataPath('template'), noFor: true, hint: 'Use $(key) for input values' }));
        const inputs = (St.get(base ? base + '.inputs' : 'inputs') || []).filter((i) => isObj(i) && i.key);
        if (!inputs.length) holder.appendChild(h('div', { class: 'msg info' }, U.icon('info', 14), h('div', { class: 'm-body' }, 'This dialog has no inputs yet. Use “Insert value” to add one and put it into the command in one go.')));
        else holder.appendChild(h('div', { class: 'cluster' }, h('span', { class: 'hint' }, 'Available:'), ...inputs.map((i) => h('button', { type: 'button', class: 'btn xs mono', title: 'Insert at the cursor', onclick: () => { F.insertAtCursor(cf.input, '$(' + i.key + ')'); } }, '$(' + i.key + ')'))));
        break;
      }
      case 'open_url': {
        const url = F.str(sub('url'), { mono: true, placeholder: 'https://example.com', aria: 'Link' });
        holder.appendChild(F.field('Link', url, { path: dataPath('url'), hint: 'Must start with https:// (or http://)' }));
        break;
      }
      case 'copy_to_clipboard': {
        const v = F.str(sub('value'), { multiline: true, rows: 2, aria: 'Text to copy' });
        holder.appendChild(F.field('Text to copy', v, { path: dataPath('value') }));
        break;
      }
      case 'show_dialog': holder.appendChild(showDialogEditor(bind, cfg, mode)); break;
      case 'custom': {
        holder.appendChild(F.field('Event id', F.str(sub('id'), { mono: true, placeholder: St.project().pack.namespace + ':my_event', aria: 'Custom event id' }), { path: dataPath('id'), hint: 'namespace:name' }));
        holder.appendChild(F.field('Payload', payloadEditor(bind), { path: dataPath('payload'), noFor: true, hint: 'Extra data sent along' }));
        holder.appendChild(h('div', { class: 'hint' }, 'Vanilla ignores custom events. A plugin or mod on the server (or client) listens for this id.'));
        break;
      }
      case 'dynamic/custom': {
        holder.appendChild(F.field('Event id', F.str(sub('id'), { mono: true, placeholder: St.project().pack.namespace + ':my_event', aria: 'Custom event id' }), { path: dataPath('id'), hint: 'namespace:name' }));
        holder.appendChild(F.optional(sub('additions'), 'Extra fields', () => ({}), () => jsonBox(sub('additions'), 'Extra fields as JSON', { object: true }), { path: dataPath('additions'), hint: 'Merged with the input values', empty: 'Nothing extra — the plugin gets the input values only.' }));
        holder.appendChild(h('div', { class: 'hint' }, 'Sends every input of this dialog (by key) together with the id. Needs a plugin or mod.'));
        break;
      }
      case 'change_page': {
        holder.appendChild(F.field('Page', F.num(sub('page'), { int: true, min: 1, delEmpty: false }), { path: dataPath('page'), row: true }));
        break;
      }
      default: break;
    }
    wrap.appendChild(holder);
    void key;
    return wrap;
  };

  /** A click event on a text part: either "nothing" or an action (text mode). */
  A.buildClick = function (bind) {
    bind = F.toBinding(bind);
    const a = bind.get();
    if (a === undefined) {
      return h('div', { class: 'cluster' },
        h('button', { type: 'button', class: 'btn sm', onclick: (e) => {
          const types = SC.actionTypes.filter((x) => x.text && x.id !== 'change_page').sort((x, y) => ORDER.indexOf(x.id) - ORDER.indexOf(y.id));
          Pick.menu(e.currentTarget, types.map((x) => ({ id: x.id, label: x.label, desc: x.desc, icon: x.icon, group: GROUPS[x.id] })), { width: 360, onPick: (it) => bind.set(convertAction(undefined, it.id, 'text'), true) });
        } }, U.icon('plus', 14), 'Add click action'),
        h('span', { class: 'hint' }, 'Nothing happens when clicked'));
    }
    const wrap = h('div', { class: 'stack-s' });
    wrap.appendChild(A.build({ bind, mode: 'text' }));
    wrap.appendChild(h('div', null, h('button', { type: 'button', class: 'btn xs ghost danger', onclick: () => bind.del(true) }, U.icon('x', 12), 'Remove click action')));
    return wrap;
  };

  /* ------------------------------------------------------------------ *
   * show_dialog: existing id or an inline dialog
   * ------------------------------------------------------------------ */
  function showDialogEditor(bind, cfg, mode) {
    const dBind = F.subBind(bind, 'dialog');
    const v = dBind.get();
    const inline = isObj(v);
    const wrap = h('div', { class: 'stack-s' });
    const dpath = bind.path != null ? bind.path + '.dialog' : null;
    if (mode === 'text' && inline) {
      wrap.appendChild(h('div', { class: 'msg info' }, U.icon('info', 14), h('div', { class: 'm-body' }, 'This click event contains an inline dialog. Edit it as JSON from the text’s “Edit all as JSON”.')));
      return wrap;
    }
    if (mode !== 'text') {
      wrap.appendChild(F.seg([{ id: 'ref', label: 'Existing dialog' }, { id: 'inline', label: 'Inline dialog' }], inline ? 'inline' : 'ref', (id) => {
        if (id === 'inline') dBind.set(SC.newDialog('notice'), true);
        else dBind.set(St.project().dialogs.filter((e) => e !== St.cur()).map((e) => St.fullId(e))[0] || '', true);
      }, { label: 'How the dialog is given' }));
    }
    if (!inline) {
      const input = h('input', { class: 'inp mono', type: 'text', value: typeof v === 'string' ? v : '', placeholder: St.project().pack.namespace + ':rules', spellcheck: 'false', 'aria-label': 'Dialog id' });
      input.addEventListener('input', () => { dBind.set(input.value, false); refreshInfo(); });
      const pick = h('button', { type: 'button', class: 'btn sm', onclick: (e) => Pick.dialogId(e.currentTarget, { exclude: St.fullId(St.cur()), onPick: (id) => { input.value = id; dBind.set(id, true); } }) }, U.icon('layers', 14), 'Choose');
      const info = h('div', { class: 'hint' });
      const refreshInfo = () => {
        info.textContent = '';
        const id = input.value.trim();
        const idx = St.project().dialogs.findIndex((e) => St.fullId(e) === DMC.rl.norm(id));
        if (idx >= 0) {
          info.appendChild(document.createTextNode('This project’s “' + (DMC.text.plain(St.project().dialogs[idx].dialog.title, St.version()) || St.project().dialogs[idx].id) + '” '));
          info.appendChild(h('button', { type: 'button', class: 'btn xs', onclick: () => St.select(idx) }, 'Edit it'));
        } else if (id && DMC.vanillaDialogs.includes(DMC.rl.norm(id))) info.textContent = 'A dialog built into the game.';
        else if (id) {
          info.appendChild(document.createTextNode('Not in this project. '));
          info.appendChild(h('button', { type: 'button', class: 'btn xs', onclick: () => {
            const ns = St.project().pack.namespace;
            const bare = DMC.rl.split(DMC.rl.norm(id));
            if (bare[0] !== ns) { F.toast('Only dialogs in “' + ns + '” can be created here.', { kind: 'err' }); return; }
            St.addDialog('notice', { id: bare[1], dialog: Object.assign(SC.newDialog('notice'), { title: U.prettyId(bare[1]) }) });
          } }, 'Create it'));
        }
      };
      refreshInfo();
      wrap.appendChild(F.field('Dialog', h('div', { class: 'inp-row' }, input, pick), { path: dpath, noFor: true }));
      wrap.appendChild(info);
    } else {
      wrap.appendChild(h('div', { class: 'sub' }, DMC.editor.inlineDialog(dpath)));
      wrap.appendChild(h('div', { class: 'cluster' }, h('button', { type: 'button', class: 'btn sm', onclick: () => {
        const inl = U.clone(dBind.get());
        const title = DMC.text.plain(inl.title, St.version()) || 'dialog';
        let full = '';
        St.commit((d, project) => {
          const id = St.uniqueId(U.slug(title));
          project.dialogs.push({ uid: U.uid(), id, dialog: inl, tags: { pause: false, quick: false, extra: [] } });
          full = project.pack.namespace + ':' + id;
          St.setPath(d, dpath, full);
        }, { structural: true, project: true, reason: 'extract-inline' });
        F.toast('Moved into its own dialog: ' + full, { kind: 'ok' });
      } }, U.icon('layers', 14), 'Move to its own dialog')));
    }
    return wrap;
  }

  /* ------------------------------------------------------------------ *
   * Button editor: label, tooltip, width, action
   * o: {base, optionalLabel, noAction, hint, actionHint}
   * ------------------------------------------------------------------ */
  A.buildButton = function (path, o) {
    o = o || {};
    const wrap = h('div', { class: 'stack' });
    const TE = DMC.textedit;
    const labelBind = F.bind(path + '.label');
    if (o.optionalLabel) {
      wrap.appendChild(F.optional(labelBind, 'Label', () => 'OK', () => TE.build({ bind: labelBind, placeholder: 'Button text' }), { path: path + '.label', noFor: true, empty: 'The game’s default “OK” button text.' }));
    } else {
      wrap.appendChild(F.field('Label', TE.build({ bind: labelBind, placeholder: 'Button text' }), { path: path + '.label', noFor: true }));
    }
    const tipBind = F.bind(path + '.tooltip');
    wrap.appendChild(F.optional(tipBind, 'Tooltip', () => 'Describe what this does', () => TE.build({ bind: tipBind, multiline: true, placeholder: 'Shown when the player hovers the button' }), { path: path + '.tooltip', noFor: true, empty: 'No tooltip.' }));
    wrap.appendChild(F.optNum(path + '.width', 'Width', SC.defaults.buttonWidth, { int: true, min: 1, max: 1024, empty: 'Default width (' + SC.defaults.buttonWidth + ' px).' }));
    if (!o.noAction) {
      const actBind = F.bind(path + '.action');
      const hasAction = actBind.get() !== undefined;
      const sw = F.sw(hasAction, (on) => {
        if (on) actBind.set(convertAction(undefined, 'run_command', 'dialog'), true);
        else actBind.del(true);
      }, { label: 'Action' });
      const body = hasAction ? A.build({ bind: actBind, mode: 'dialog', base: o.base }) : h('div', { class: 'hint' }, o.actionHint || 'No action — clicking just closes the dialog.');
      wrap.appendChild(F.field('Action', body, { path: path + '.action', tools: sw, noFor: true }));
    }
    return wrap;
  };

  A.buttonSummary = (b) => {
    if (!isObj(b)) return '';
    const label = b.label === undefined ? '' : DMC.text.plain(b.label, St.version());
    return label;
  };
})();
