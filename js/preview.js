/* Dialog MC — interactive Minecraft-style preview. Click buttons to see what would happen: dialogs open,
 * commands are checked and logged, inputs are filled in and substituted into $(key) templates. */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const U = DMC.util;
  const h = U.h;
  const St = DMC.store;
  const F = DMC.fields;
  const R = DMC.render;
  const SC = DMC.schema;
  const C = DMC.cmd;
  const PV = (DMC.preview = {});
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  const state = { stack: [], log: [], closed: false, overlay: null, zoom: 'fit', curUid: null };
  let rootEl = null;
  let stageEl = null;
  let logEl = null;
  let crumbsEl = null;
  let zoomSel = null;

  const ver = () => St.version();
  const plainText = (v) => DMC.text.plain(v, ver()).replace(/\s+/g, ' ').trim();
  const GAP = 4;

  /* ------------------------------------------------------------------ *
   * Stack handling
   * ------------------------------------------------------------------ */
  function newFrame(ref) { return { ref, values: {}, touched: {} }; }
  function resetStack() {
    state.stack = [newFrame({ type: 'current' })];
    state.closed = false;
    state.overlay = null;
  }
  function resolve(frame) {
    const r = frame.ref;
    if (r.type === 'current') return { dialog: St.dialog(), entry: St.cur() };
    if (r.type === 'project') {
      const e = St.project().dialogs.find((x) => x.uid === r.uid);
      return e ? { dialog: e.dialog, entry: e } : { missing: r.id };
    }
    if (r.type === 'inline') return { dialog: r.dialog };
    if (r.type === 'builtin') return { builtin: r.id };
    return { missing: r.id };
  }
  /** Reference to a dialog from an action: id string or inline object. */
  function refFor(d) {
    if (isObj(d)) return { type: 'inline', dialog: U.clone(d) };
    const id = DMC.rl.norm(String(d || ''));
    const e = St.project().dialogs.find((x) => St.fullId(x) === id);
    if (e) return { type: 'project', uid: e.uid, id };
    if (DMC.vanillaDialogs.includes(id)) return { type: 'builtin', id };
    return { type: 'missing', id };
  }
  function openDialog(d) {
    state.stack.push(newFrame(refFor(d)));
    state.closed = false;
    render();
  }
  function popDialog() {
    if (state.stack.length > 1) state.stack.pop();
    else state.closed = true;
    state.overlay = null;
    render();
  }

  /* ------------------------------------------------------------------ *
   * Log
   * ------------------------------------------------------------------ */
  function logEvent(entry) {
    entry.time = new Date();
    state.log.unshift(entry);
    if (state.log.length > 40) state.log.length = 40;
    renderLog();
  }

  function commandBadges(cmd) {
    const r = C.validate(cmd, ver());
    if (!r.ok) {
      const e = r.errors[0];
      return [{ kind: 'bad', text: 'Invalid: ' + e.message + (e.pos != null ? ' (char ' + (e.pos + 1) + ')' : '') }];
    }
    if (r.signed) return [{ kind: 'bad', text: '/' + r.root + ' is a chat-signed command — Minecraft refuses to run it from a click' }];
    if (r.level > 0) return [{ kind: 'warn', text: 'Needs ' + C.levelName(r.level) + '. Players below that can’t run it; operators see a confirmation screen first.' }];
    return [{ kind: 'ok', text: 'Runs for any player' }];
  }

  /* ------------------------------------------------------------------ *
   * Input values
   * ------------------------------------------------------------------ */
  const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(6)));
  function inputType(i) { return isObj(i) ? SC.bare(i.type) : ''; }
  function initialValue(i) {
    switch (inputType(i)) {
      case 'text': return typeof i.initial === 'string' ? i.initial : '';
      case 'boolean': return i.initial === true;
      case 'single_option': {
        const opts = Array.isArray(i.options) ? i.options : [];
        const idx = opts.findIndex((o) => isObj(o) && o.initial === true);
        return idx >= 0 ? idx : 0;
      }
      case 'number_range': {
        const s = typeof i.start === 'number' ? i.start : 0;
        const e = typeof i.end === 'number' ? i.end : 1;
        let v = typeof i.initial === 'number' ? i.initial : (s + e) / 2;
        if (typeof i.step === 'number' && i.step > 0) v = s + Math.round((v - s) / i.step) * i.step;
        return Math.min(Math.max(v, Math.min(s, e)), Math.max(s, e));
      }
      default: return '';
    }
  }
  function valueOf(frame, i) {
    return frame.touched[i.key] && i.key in frame.values ? frame.values[i.key] : initialValue(i);
  }
  /** The string substituted for $(key). */
  function substitution(frame, i) {
    const v = valueOf(frame, i);
    switch (inputType(i)) {
      case 'text': return C.escapeInput(v);
      case 'boolean': return v ? (typeof i.on_true === 'string' ? i.on_true : 'true') : (typeof i.on_false === 'string' ? i.on_false : 'false');
      case 'single_option': {
        const o = (Array.isArray(i.options) ? i.options : [])[v];
        return o == null ? '' : typeof o === 'string' ? o : o.id == null ? '' : String(o.id);
      }
      case 'number_range': return fmtNum(v);
      default: return '';
    }
  }
  function allSubstitutions(frame, d) {
    const out = {};
    for (const i of (Array.isArray(d.inputs) ? d.inputs : [])) if (isObj(i) && typeof i.key === 'string' && i.key) out[i.key] = substitution(frame, i);
    return out;
  }
  function rawValues(frame, d) {
    const out = {};
    for (const i of (Array.isArray(d.inputs) ? d.inputs : [])) {
      if (!isObj(i) || typeof i.key !== 'string') continue;
      const v = valueOf(frame, i);
      const t = inputType(i);
      out[i.key] = t === 'single_option' ? substitution(frame, i) : t === 'boolean' ? substitution(frame, i) : v;
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Performing actions
   * ------------------------------------------------------------------ */
  function perform(a, ctx) {
    if (!isObj(a)) return;
    const t = SC.bare(a.type !== undefined ? a.type : a.action);
    const what = ctx.label ? '“' + ctx.label + '”' : 'text';
    const dialog = ctx.dialog || {};
    switch (t) {
      case 'run_command': {
        const cmd = '/' + C.stripSlash(String(a.command || ''));
        logEvent({ title: 'Clicked ' + what, lines: [{ code: cmd }], badges: commandBadges(cmd) });
        break;
      }
      case 'dynamic/run_command': {
        const subs = allSubstitutions(ctx.frame, dialog);
        const tpl = String(a.template || '');
        const missing = C.templateKeys(tpl).filter((k) => !(k in subs));
        const cmd = '/' + C.stripSlash(C.expand(tpl, subs));
        const badges = missing.length ? [{ kind: 'bad', text: 'No input has the key ' + missing.map((k) => '“' + k + '”').join(', ') + ' — the game rejects this command' }] : commandBadges(cmd);
        logEvent({ title: 'Clicked ' + what, lines: [{ code: cmd }, { hint: 'Template: ' + tpl }], badges });
        break;
      }
      case 'suggest_command':
        state.overlay = { kind: 'chat', text: String(a.command || '') };
        logEvent({ title: 'Clicked ' + what, lines: [{ text: 'Puts this into the chat box:' }, { code: String(a.command || '') }], badges: [{ kind: 'ok', text: 'Nothing is sent until the player presses Enter' }] });
        renderOverlay();
        return;
      case 'open_url': {
        const url = String(a.url || '');
        let ok = true;
        try { const u = new URL(url); ok = u.protocol === 'http:' || u.protocol === 'https:'; } catch (e) { ok = false; }
        state.overlay = { kind: 'url', url, ok };
        renderOverlay();
        return;
      }
      case 'copy_to_clipboard':
        U.copy(String(a.value || ''));
        logEvent({ title: 'Clicked ' + what, lines: [{ text: 'Copies to the clipboard:' }, { code: String(a.value || '') }], badges: [{ kind: 'ok', text: 'Copied' }] });
        break;
      case 'show_dialog': {
        const target = a.dialog;
        const ref = refFor(target);
        const label = isObj(target) ? 'an inline dialog' : '“' + DMC.rl.norm(String(target || '')) + '”';
        if (ref.type === 'missing') {
          logEvent({ title: 'Clicked ' + what, lines: [{ text: 'Should open ' + label }], badges: [{ kind: 'bad', text: 'No dialog with that id in this project — make sure a data pack provides it' }] });
          return;
        }
        if (ref.type === 'builtin') {
          logEvent({ title: 'Clicked ' + what, lines: [{ text: 'Opens the built-in dialog ' + label }], badges: [{ kind: 'ok', text: 'Provided by the game' }] });
          return;
        }
        logEvent({ title: 'Clicked ' + what, lines: [{ text: 'Opens ' + label }], badges: [{ kind: 'ok', text: 'Dialog found' }] });
        openDialog(target);
        return;
      }
      case 'custom': {
        const payload = a.payload === undefined ? '' : ' with ' + JSON.stringify(a.payload);
        logEvent({ title: 'Clicked ' + what, lines: [{ code: 'custom event ' + (a.id || '?') + payload }], badges: [{ kind: 'warn', text: 'Does nothing on vanilla — a plugin or mod must handle this event' }] });
        break;
      }
      case 'dynamic/custom': {
        const payload = Object.assign({}, isObj(a.additions) ? a.additions : {}, rawValues(ctx.frame, dialog));
        logEvent({ title: 'Clicked ' + what, lines: [{ code: 'custom event ' + (a.id || '?') }, { code: JSON.stringify(payload) }], badges: [{ kind: 'warn', text: 'Does nothing on vanilla — a plugin or mod must handle this event' }] });
        break;
      }
      case 'change_page':
        logEvent({ title: 'Clicked ' + what, lines: [{ text: 'change_page' }], badges: [{ kind: 'warn', text: 'Only works in written books — does nothing here' }] });
        break;
      default:
        logEvent({ title: 'Clicked ' + what, lines: [{ text: 'Unknown action “' + t + '”' }], badges: [{ kind: 'bad', text: 'The game doesn’t know this action' }] });
    }
    if (ctx.button) afterClick(ctx);
  }

  function afterClick(ctx) {
    const d = ctx.dialog || {};
    const after = d.after_action || 'close';
    if (after === 'none') { render(); return; }
    if (after === 'wait_for_response') {
      state.overlay = { kind: 'wait' };
      renderOverlay();
      return;
    }
    popDialog();
  }

  /* a button press: runs its action, then applies after_action */
  function press(button, ctx) {
    const label = button && button.label !== undefined ? plainText(button.label) : ctx.defaultLabel || '';
    const c = Object.assign({}, ctx, { label, button: true });
    if (button && isObj(button.action)) perform(button.action, c);
    else {
      logEvent({ title: 'Clicked “' + label + '”', lines: [{ text: 'No action — just ' + ((ctx.dialog.after_action || 'close') === 'none' ? 'stays open' : 'closes the dialog') }], badges: [] });
      afterClick(c);
    }
  }

  /* ------------------------------------------------------------------ *
   * Widgets
   * ------------------------------------------------------------------ */
  function textRuns(value, ctx, base) {
    return R.runs(value, ver(), {
      baseColor: base,
      onClick: (ev) => perform(ev, { label: '', frame: ctx.frame, dialog: ctx.dialog, button: false }),
    });
  }

  function mcButton(label, width, opts) {
    opts = opts || {};
    const btn = h('button', { type: 'button', class: 'mc-btn', style: '--bw:' + width, disabled: !!opts.disabled, onclick: opts.onclick || null });
    const span = h('span', null);
    span.appendChild(label);
    btn.appendChild(span);
    if (opts.tooltip !== undefined) R.tipOn(btn, () => h('div', { class: 'mc-tip-body' }, R.line(opts.tooltip, ver(), { interactive: false })));
    return btn;
  }

  function buttonFor(button, defaultWidth, ctx, fallbackLabel) {
    const b = isObj(button) ? button : {};
    const labelVal = b.label !== undefined ? b.label : fallbackLabel;
    const frag = textRuns(labelVal === undefined ? '' : labelVal, ctx, '#FFFFFF');
    const w = typeof b.width === 'number' && b.width > 0 ? b.width : defaultWidth;
    return mcButton(frag, w, { tooltip: b.tooltip, onclick: () => press(b, Object.assign({}, ctx, { defaultLabel: fallbackLabel ? plainText(fallbackLabel) : '' })) });
  }

  function bodyWidget(b, ctx) {
    if (!isObj(b)) return null;
    const t = SC.bare(b.type);
    if (t === 'plain_message') {
      const w = typeof b.width === 'number' && b.width > 0 ? b.width : SC.defaults.plainWidth;
      const el = h('div', { class: 'mc-msg', style: 'width:calc(var(--u) * ' + Math.min(w, 1024) + ');text-align:center' });
      el.appendChild(textRuns(b.contents === undefined ? '' : b.contents, ctx, '#FFFFFF'));
      return el;
    }
    if (t === 'item') {
      const item = typeof b.item === 'string' ? { id: b.item } : isObj(b.item) ? b.item : {};
      const w = typeof b.width === 'number' ? b.width : SC.defaults.itemSize;
      const hh = typeof b.height === 'number' ? b.height : SC.defaults.itemSize;
      const slot = h('div', { class: 'mc-slot', style: 'width:calc(var(--u) * ' + Math.min(w, 256) + ');height:calc(var(--u) * ' + Math.min(hh, 256) + ')' }, R.itemIcon(item.id || 'air'));
      if (b.show_decorations !== false) {
        if (item.count > 1) slot.appendChild(h('span', { class: 'cnt' }, String(item.count)));
        const comps = isObj(item.components) ? item.components : {};
        const dmg = comps['minecraft:damage'] !== undefined ? comps['minecraft:damage'] : comps.damage;
        const mx = comps['minecraft:max_damage'] !== undefined ? comps['minecraft:max_damage'] : comps.max_damage;
        if (typeof dmg === 'number' && dmg > 0 && typeof mx === 'number' && mx > 0) {
          const pct = Math.max(0, Math.min(1, 1 - dmg / mx));
          const bar = h('span', { class: 'dur' }, h('i', { style: 'width:' + Math.round(pct * 100) + '%;background:hsl(' + Math.round(pct * 120) + ' 80% 45%)' }));
          slot.appendChild(bar);
        }
      }
      if (b.show_tooltip !== false && item.id) R.tipOn(slot, () => R.itemTooltip(item, ver()));
      const row = h('div', { class: 'mc-item' }, slot);
      if (b.description !== undefined) {
        const d = b.description;
        const contents = isObj(d) && 'contents' in d ? d.contents : d;
        const dw = isObj(d) && typeof d.width === 'number' ? d.width : SC.defaults.plainWidth;
        const desc = h('div', { class: 'mc-msg', style: 'width:calc(var(--u) * ' + Math.min(dw, 1024) + ');text-align:left' });
        desc.appendChild(textRuns(contents, ctx, '#FFFFFF'));
        row.appendChild(desc);
      }
      return row;
    }
    return null;
  }

  function labelNode(inp, ctx) {
    const frag = inp.label === undefined ? document.createDocumentFragment() : textRuns(inp.label, ctx, '#FFFFFF');
    return frag;
  }

  function inputWidget(inp, ctx) {
    if (!isObj(inp)) return null;
    const t = inputType(inp);
    const frame = ctx.frame;
    const key = typeof inp.key === 'string' ? inp.key : '';
    const w = typeof inp.width === 'number' && inp.width > 0 ? inp.width : SC.defaults.inputWidth;
    const set = (v) => { frame.values[key] = v; frame.touched[key] = true; };
    if (t === 'text') {
      const wrap = h('div', { class: 'mc-input' });
      if (inp.label_visible !== false && inp.label !== undefined) wrap.appendChild(h('div', { class: 'mc-lbl' }, labelNode(inp, ctx)));
      const ml = isObj(inp.multiline) ? inp.multiline : null;
      const maxLen = typeof inp.max_length === 'number' && inp.max_length > 0 ? inp.max_length : SC.defaults.maxLength;
      let el;
      if (ml) {
        const hpx = typeof ml.height === 'number' ? ml.height : typeof ml.max_lines === 'number' ? ml.max_lines * 9 + 8 : 64;
        el = h('textarea', { class: 'mc-edit', style: '--bw:' + w + ';height:calc(var(--u) * ' + Math.min(hpx, 512) + ')', maxlength: maxLen, 'aria-label': plainText(inp.label) || key, spellcheck: 'false' });
      } else {
        el = h('input', { class: 'mc-edit', type: 'text', style: '--bw:' + w, maxlength: maxLen, 'aria-label': plainText(inp.label) || key, spellcheck: 'false' });
      }
      el.value = String(valueOf(frame, inp));
      el.addEventListener('input', () => set(el.value));
      wrap.appendChild(el);
      return wrap;
    }
    if (t === 'boolean') {
      const on = !!valueOf(frame, inp);
      const btn = h('button', { type: 'button', class: 'mc-check', role: 'checkbox', 'aria-checked': String(on) }, h('span', { class: 'box' + (on ? ' on' : '') }), h('span', null, labelNode(inp, ctx)));
      btn.addEventListener('click', () => {
        const nv = !valueOf(frame, inp);
        set(nv);
        btn.setAttribute('aria-checked', String(nv));
        btn.querySelector('.box').classList.toggle('on', nv);
      });
      return btn;
    }
    if (t === 'single_option') {
      const opts = Array.isArray(inp.options) ? inp.options : [];
      const label = () => {
        const frag = document.createDocumentFragment();
        const o = opts[valueOf(frame, inp)];
        if (inp.label_visible !== false && inp.label !== undefined) {
          frag.appendChild(labelNode(inp, ctx));
          frag.appendChild(document.createTextNode(': '));
        }
        if (o !== undefined) {
          const disp = isObj(o) ? (o.display !== undefined ? o.display : o.id) : o;
          frag.appendChild(textRuns(disp == null ? '' : disp, ctx, '#FFFFFF'));
        }
        return frag;
      };
      const btn = mcButton(label(), w, {});
      btn.addEventListener('click', () => {
        if (!opts.length) return;
        set((valueOf(frame, inp) + 1) % opts.length);
        const span = btn.querySelector('span');
        span.textContent = '';
        span.appendChild(label());
      });
      return btn;
    }
    if (t === 'number_range') {
      const s = typeof inp.start === 'number' ? inp.start : 0;
      const e = typeof inp.end === 'number' ? inp.end : 1;
      const lo = Math.min(s, e);
      const hi = Math.max(s, e);
      const step = typeof inp.step === 'number' && inp.step > 0 ? inp.step : null;
      const fmtKey = typeof inp.label_format === 'string' ? inp.label_format : 'options.generic_value';
      const slider = h('div', { class: 'mc-slider', style: '--bw:' + w, role: 'slider', tabindex: '0', 'aria-valuemin': lo, 'aria-valuemax': hi, 'aria-label': plainText(inp.label) || key });
      const thumb = h('div', { class: 'thumb' });
      const lab = h('div', { class: 'lab' });
      slider.appendChild(thumb);
      slider.appendChild(lab);
      const paint = () => {
        const v = valueOf(frame, inp);
        const pct = hi === lo ? 0 : ((v - lo) / (hi - lo)) * 100;
        slider.style.setProperty('--pct', pct + '%');
        slider.setAttribute('aria-valuenow', fmtNum(v));
        const tpl = DMC.lang.get(fmtKey, ver());
        lab.textContent = '';
        const lblText = inp.label === undefined ? '' : plainText(inp.label);
        if (tpl) lab.textContent = DMC.lang.format(tpl, [lblText, fmtNum(v)]);
        else lab.textContent = fmtKey;
      };
      const setFromX = (clientX) => {
        const r = slider.getBoundingClientRect();
        let f = (clientX - r.left) / r.width;
        f = Math.max(0, Math.min(1, f));
        let v = lo + f * (hi - lo);
        if (step) v = lo + Math.round((v - lo) / step) * step;
        v = Math.max(lo, Math.min(hi, v));
        set(+v.toFixed(6));
        paint();
      };
      slider.addEventListener('pointerdown', (ev) => {
        slider.setPointerCapture(ev.pointerId);
        setFromX(ev.clientX);
        const move = (m) => setFromX(m.clientX);
        const up = () => { slider.removeEventListener('pointermove', move); slider.removeEventListener('pointerup', up); };
        slider.addEventListener('pointermove', move);
        slider.addEventListener('pointerup', up);
      });
      slider.addEventListener('keydown', (ev) => {
        const st = step || (hi - lo) / 100 || 1;
        let v = valueOf(frame, inp);
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') v += st;
        else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') v -= st;
        else return;
        ev.preventDefault();
        set(+Math.max(lo, Math.min(hi, v)).toFixed(6));
        paint();
      });
      paint();
      return slider;
    }
    return h('div', { class: 'mc-note' }, 'Unknown input type');
  }

  /* ------------------------------------------------------------------ *
   * Dialog layout
   * ------------------------------------------------------------------ */
  function gridOf(buttons, cols, width) {
    const grid = h('div', { class: 'mc-grid', style: 'grid-template-columns:repeat(' + Math.max(1, cols) + ', max-content)' });
    buttons.forEach((b) => grid.appendChild(b));
    void width;
    return grid;
  }

  function targetLabel(ref, ctx) {
    const r = refFor(ref);
    let d = null;
    if (r.type === 'project') d = St.project().dialogs.find((e) => e.uid === r.uid).dialog;
    else if (r.type === 'inline') d = r.dialog;
    if (d) return { label: d.external_title !== undefined ? d.external_title : d.title, ok: true };
    void ctx;
    return { label: { text: String(typeof ref === 'string' ? ref : '?'), color: r.type === 'builtin' ? 'white' : 'red' }, ok: r.type === 'builtin' };
  }

  function renderDialogInto(root, dialog, frame) {
    const ctx = { frame, dialog };
    const type = SC.bare(dialog.type);
    root.appendChild(h('div', { class: 'mc-title' }, textRuns(dialog.title === undefined ? '' : dialog.title, ctx, '#FFFFFF')));
    const body = Array.isArray(dialog.body) ? dialog.body : isObj(dialog.body) ? [dialog.body] : [];
    if (body.length) {
      const wrap = h('div', { class: 'mc-body' });
      for (const b of body) { const w = bodyWidget(b, ctx); if (w) wrap.appendChild(w); }
      root.appendChild(wrap);
    }
    const inputs = Array.isArray(dialog.inputs) ? dialog.inputs : [];
    if (inputs.length) {
      const wrap = h('div', { class: 'mc-inputs' });
      for (const i of inputs) { const w = inputWidget(i, ctx); if (w) wrap.appendChild(w); }
      root.appendChild(wrap);
    }
    const bw = (d) => (typeof d.button_width === 'number' && d.button_width > 0 ? d.button_width : SC.defaults.buttonWidth);
    const cols = (d) => (typeof d.columns === 'number' && d.columns > 0 ? d.columns : SC.defaults.columns);
    const footer = h('div', { class: 'mc-footer' });
    switch (type) {
      case 'notice': {
        const a = isObj(dialog.action) ? dialog.action : {};
        footer.appendChild(buttonFor(Object.assign({}, a, a.label === undefined ? { label: { translate: 'gui.ok' } } : {}), SC.defaults.buttonWidth, ctx));
        break;
      }
      case 'confirmation': {
        const row = h('div', { class: 'mc-grid', style: 'grid-template-columns:repeat(2, max-content)' });
        row.appendChild(buttonFor(dialog.yes, SC.defaults.buttonWidth, ctx, { translate: 'gui.yes' }));
        row.appendChild(buttonFor(dialog.no, SC.defaults.buttonWidth, ctx, { translate: 'gui.no' }));
        footer.appendChild(row);
        break;
      }
      case 'multi_action': {
        const list = Array.isArray(dialog.actions) ? dialog.actions : [];
        if (list.length) footer.appendChild(gridOf(list.map((b) => buttonFor(b, SC.defaults.buttonWidth, ctx)), cols(dialog)));
        else footer.appendChild(h('div', { class: 'mc-note' }, 'No buttons yet'));
        break;
      }
      case 'server_links': {
        const n = Math.max(cols(dialog), 2);
        const placeholders = Array.from({ length: n }, (_, i) => mcButton(document.createTextNode('Server link ' + (i + 1)), bw(dialog), { disabled: true }));
        footer.appendChild(gridOf(placeholders, cols(dialog)));
        footer.appendChild(h('div', { class: 'mc-note' }, 'The server provides these links'));
        break;
      }
      case 'dialog_list': {
        let refs = [];
        const dl = dialog.dialogs;
        if (typeof dl === 'string' && dl.startsWith('#')) {
          const tag = DMC.rl.norm(dl.slice(1));
          const members = St.project().dialogs.filter((e) => {
            const t = e.tags || {};
            if (tag === 'minecraft:pause_screen_additions') return t.pause;
            if (tag === 'minecraft:quick_actions') return t.quick;
            return (t.extra || []).map(DMC.rl.norm).includes(tag);
          }).filter((e) => e.dialog !== dialog);
          refs = members.map((e) => St.fullId(e));
          if (!refs.length) footer.appendChild(h('div', { class: 'mc-note' }, 'No dialog in this project is in the tag ' + dl));
        } else refs = Array.isArray(dl) ? dl : dl !== undefined ? [dl] : [];
        const btns = refs.map((r) => {
          const tl = targetLabel(r, ctx);
          return mcButton(textRuns(tl.label, ctx, '#FFFFFF'), bw(dialog), { onclick: () => perform({ type: 'minecraft:show_dialog', dialog: r }, { label: plainText(tl.label), frame, dialog, button: false }) });
        });
        if (btns.length) footer.appendChild(gridOf(btns, cols(dialog)));
        else if (!(typeof dl === 'string')) footer.appendChild(h('div', { class: 'mc-note' }, 'No dialogs listed yet'));
        break;
      }
      default: break;
    }
    if (footer.childNodes.length) root.appendChild(footer);
    if (isObj(dialog.exit_action) && (type === 'multi_action' || type === 'server_links' || type === 'dialog_list')) {
      const ex = h('div', { class: 'mc-exit' });
      ex.appendChild(buttonFor(dialog.exit_action, SC.defaults.buttonWidth, ctx));
      root.appendChild(ex);
    }
    return root;
  }

  /** Natural width in GUI pixels (to choose a scale that fits the stage). */
  function naturalWidth(d) {
    const type = SC.bare(d.type);
    const cols = typeof d.columns === 'number' && d.columns > 0 ? d.columns : SC.defaults.columns;
    const bw = typeof d.button_width === 'number' && d.button_width > 0 ? d.button_width : SC.defaults.buttonWidth;
    let w = 200;
    if (type === 'confirmation') w = Math.max(w, 2 * 150 + GAP);
    if (type === 'multi_action') {
      const list = Array.isArray(d.actions) ? d.actions : [];
      const ws = list.map((b) => (isObj(b) && typeof b.width === 'number' ? b.width : 150));
      const per = Math.max(150, ...ws);
      w = Math.max(w, Math.min(cols, Math.max(1, list.length)) * per + (Math.min(cols, Math.max(1, list.length)) - 1) * GAP);
    }
    if (type === 'dialog_list' || type === 'server_links') w = Math.max(w, cols * bw + (cols - 1) * GAP);
    for (const b of Array.isArray(d.body) ? d.body : []) if (isObj(b) && typeof b.width === 'number') w = Math.max(w, b.width);
    for (const i of Array.isArray(d.inputs) ? d.inputs : []) if (isObj(i) && typeof i.width === 'number') w = Math.max(w, i.width);
    return Math.min(w, 700);
  }

  /* ------------------------------------------------------------------ *
   * Mount + render
   * ------------------------------------------------------------------ */
  PV.mount = function (container) {
    rootEl = container;
    crumbsEl = h('div', { class: 'crumbs' });
    zoomSel = h('select', { class: 'inp', style: 'width:auto;height:26px;padding-left:8px', 'aria-label': 'Preview scale', onchange: () => { state.zoom = zoomSel.value; render(); } },
      h('option', { value: 'fit' }, 'Fit'), h('option', { value: '1' }, '1×'), h('option', { value: '2' }, '2×'), h('option', { value: '3' }, '3×'), h('option', { value: '4' }, '4×'));
    const bar = h('div', { class: 'pv-bar' },
      h('button', { type: 'button', class: 'btn icon sm ghost', 'aria-label': 'Back', title: 'Back (like pressing ESC)', onclick: () => popDialog() }, U.icon('chevron-left', 16)),
      crumbsEl,
      h('span', { class: 'grow' }),
      zoomSel,
      h('button', { type: 'button', class: 'btn icon sm ghost', 'aria-label': 'Restart preview', title: 'Restart preview', onclick: () => { resetStack(); state.log = []; render(); renderLog(); } }, U.icon('refresh', 15)));
    stageEl = h('div', { class: 'pv-stage' });
    logEl = h('div', { class: 'pv-log' });
    rootEl.appendChild(h('div', { class: 'pv-wrap' }, bar, stageEl, logEl));
    resetStack();
    render();
    renderLog();
  };

  PV.reset = function () { resetStack(); render(); };
  PV.clearLog = function () { state.log = []; renderLog(); };

  function render() {
    if (!stageEl) return;
    R.hideTip();
    const top = state.stack[state.stack.length - 1];
    const res = resolve(top);
    // breadcrumbs
    crumbsEl.textContent = '';
    state.stack.forEach((f, i) => {
      const r = resolve(f);
      const name = r.dialog ? plainText(r.dialog.title) || 'Untitled' : r.builtin || r.missing || '?';
      if (i) crumbsEl.appendChild(h('span', { class: 'sep' }, '›'));
      crumbsEl.appendChild(h('span', { class: i === state.stack.length - 1 ? 'cur' : '' }, name.length > 22 ? name.slice(0, 21) + '…' : name));
    });
    stageEl.textContent = '';
    stageEl.classList.toggle('closed', state.closed);
    if (state.closed) {
      stageEl.style.setProperty('--u', '2px');
      stageEl.appendChild(h('div', { class: 'pv-closed' }, h('div', null, 'The dialog is closed.'),
        h('button', { type: 'button', class: 'btn', onclick: () => { resetStack(); render(); } }, U.icon('play', 14), 'Open it again')));
      return;
    }
    if (!res.dialog) {
      stageEl.style.setProperty('--u', '2px');
      stageEl.appendChild(h('div', { class: 'pv-closed' },
        h('div', null, res.builtin ? 'This is a dialog built into the game — it can’t be shown here.' : 'There is no dialog called ' + (res.missing || '?') + ' in this project.'),
        h('button', { type: 'button', class: 'btn', onclick: () => popDialog() }, 'Go back')));
      return;
    }
    const d = res.dialog;
    // scale
    const avail = Math.max(260, stageEl.clientWidth || 440) - 28;
    let u = state.zoom === 'fit' ? Math.max(1, Math.min(3, Math.floor((avail / (naturalWidth(d) + 24)) * 4) / 4)) : Number(state.zoom);
    if (!Number.isFinite(u)) u = 2;
    stageEl.style.setProperty('--u', u + 'px');
    const mc = h('div', { class: 'mc' });
    renderDialogInto(mc, d, top);
    stageEl.appendChild(mc);
    if (d.can_close_with_escape === false) stageEl.appendChild(h('div', { class: 'pv-esc' }, 'ESC is disabled for this dialog'));
    renderOverlay();
  }

  function renderOverlay() {
    if (!stageEl) return;
    stageEl.querySelectorAll('.pv-overlay').forEach((el) => el.remove());
    const o = state.overlay;
    if (!o) return;
    const close = () => { state.overlay = null; renderOverlay(); };
    let box;
    if (o.kind === 'url') {
      box = h('div', { class: 'pv-box' },
        h('div', { class: 'pv-box-t' }, 'Do you want to open the following website?'),
        h('code', { class: 'pv-box-c' }, o.url || '(empty)'),
        o.ok ? null : h('div', { class: 'msg error' }, U.icon('error', 14), h('div', { class: 'm-body' }, 'Not a valid web link — the game won’t open it.')),
        h('div', { class: 'cluster' },
          h('button', { type: 'button', class: 'btn sm primary', onclick: () => { logEvent({ title: 'Open link', lines: [{ code: o.url }], badges: [o.ok ? { kind: 'ok', text: 'Confirmed — a browser would open (not opened here)' } : { kind: 'bad', text: 'Invalid link' }] }); close(); } }, 'Yes'),
          h('button', { type: 'button', class: 'btn sm', onclick: () => { U.copy(o.url); close(); } }, 'Copy to clipboard'),
          h('button', { type: 'button', class: 'btn sm', onclick: close }, 'No')));
    } else if (o.kind === 'chat') {
      box = h('div', { class: 'pv-box bottom' }, h('div', { class: 'pv-box-t' }, 'Chat box'), h('code', { class: 'pv-box-c' }, o.text + '▏'), h('div', { class: 'cluster' }, h('button', { type: 'button', class: 'btn sm', onclick: close }, 'Close')));
    } else if (o.kind === 'wait') {
      box = h('div', { class: 'pv-box' }, h('div', { class: 'pv-box-t' }, 'Waiting for Response'), h('div', { class: 'hint' }, 'The game shows this until the server answers (or the player presses ESC).'), h('div', { class: 'cluster' }, h('button', { type: 'button', class: 'btn sm', onclick: () => { state.overlay = null; popDialog(); } }, 'The server answered')));
    }
    if (box) stageEl.appendChild(h('div', { class: 'pv-overlay' }, box));
  }

  function renderLog() {
    if (!logEl) return;
    logEl.textContent = '';
    const head = h('div', { class: 'pv-log-h' }, h('span', { class: 'fld-label' }, 'What happens when you click'), h('span', { class: 'grow', style: 'flex:1' }),
      state.log.length ? h('button', { type: 'button', class: 'btn xs ghost', onclick: () => PV.clearLog() }, 'Clear') : null);
    logEl.appendChild(head);
    if (!state.log.length) {
      logEl.appendChild(h('div', { class: 'hint', style: 'padding:2px 2px 8px' }, 'Click a button above — commands are checked as if the player pressed it.'));
      return;
    }
    const list = h('div', { class: 'log-list' });
    for (const e of state.log.slice(0, 12)) {
      const item = h('div', { class: 'log-item' }, h('div', { class: 'log-t' }, e.title));
      for (const l of e.lines || []) {
        if (l.code) item.appendChild(h('code', { class: 'log-c' }, l.code));
        else if (l.hint) item.appendChild(h('div', { class: 'hint mono', style: 'font-size:11.5px' }, l.hint));
        else item.appendChild(h('div', { class: 'hint' }, l.text));
      }
      for (const b of e.badges || []) {
        item.appendChild(h('div', { class: 'msg ' + (b.kind === 'ok' ? 'ok' : b.kind === 'warn' ? 'warn' : 'error') }, U.icon(b.kind === 'ok' ? 'check' : b.kind === 'warn' ? 'warn' : 'error', 14), h('div', { class: 'm-body' }, b.text)));
      }
      list.appendChild(item);
    }
    logEl.appendChild(list);
  }

  PV.render = function () {
    // keep the stack root in sync with the dialog being edited
    const cur = St.cur();
    if (state.curUid !== cur.uid) { state.curUid = cur.uid; resetStack(); }
    render();
  };
  PV.state = state;
})();
