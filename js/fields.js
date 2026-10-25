/* Dialog MC — form building blocks bound to the project store: fields, switches, entries, messages, modals, toasts. */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const U = DMC.util;
  const h = U.h;
  const St = DMC.store;
  const F = (DMC.fields = {});

  const curKey = (path) => 'set:' + St.ui.cur + ':' + path;
  F.quietDel = (path) => St.commit((d) => St.setPath(d, path, undefined), { coalesce: curKey(path) });

  /* ------------------------------------------------------------------ *
   * Bindings: {path, get(), set(value, structural), del(structural)}
   * A string path is bound to the current dialog; virtual bindings (F.objBind) edit a working copy
   * and report changes through a callback, so the same controls work inside nested editors.
   * ------------------------------------------------------------------ */
  F.bind = function (path) {
    return {
      path,
      get: () => St.get(path),
      set: (v, structural) => St.set(path, v, { structural: !!structural }),
      del: (structural) => (structural ? St.del(path) : F.quietDel(path)),
    };
  };
  const B = (t) => (typeof t === 'string' ? F.bind(t) : t);
  F.toBinding = B;
  /** Binding over obj[key]; onChange(structural) is called after every mutation. */
  F.objBind = function (obj, key, onChange, path) {
    return {
      path: path == null ? null : path,
      get: () => obj[key],
      set: (v, structural) => { obj[key] = v; onChange(!!structural); },
      del: (structural) => { delete obj[key]; onChange(!!structural); },
    };
  };
  /** Binding over obj[key] where obj is itself reached through another binding (clone-on-write). */
  F.subBind = function (parent, key) {
    return {
      path: parent.path != null ? parent.path + '.' + key : null,
      get: () => { const o = parent.get(); return o && typeof o === 'object' ? o[key] : undefined; },
      set: (v, structural) => { const o = U.clone(parent.get()) || {}; o[key] = v; parent.set(o, structural); },
      del: (structural) => { const o = U.clone(parent.get()); if (o && typeof o === 'object') { delete o[key]; parent.set(o, structural); } },
    };
  };

  /* ------------------------------------------------------------------ *
   * Toasts and modals
   * ------------------------------------------------------------------ */
  let toastHost = null;
  F.toast = function (msg, o) {
    o = o || {};
    if (!toastHost) {
      toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastHost);
    }
    const t = h('div', { class: 'toast' + (o.kind === 'err' ? ' err' : '') },
      o.kind === 'ok' ? U.icon('check', 16) : o.kind === 'err' ? U.icon('error', 16) : null,
      h('span', null, msg),
      o.action ? h('button', { type: 'button', class: 'btn xs', style: 'pointer-events:auto', onclick: () => { o.action.onClick(); t.remove(); } }, o.action.label) : null);
    toastHost.appendChild(t);
    setTimeout(() => t.remove(), o.ms || (o.action ? 6000 : 2600));
    return t;
  };

  F.modal = function (o) {
    const prev = document.activeElement;
    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      if (o.onClose) o.onClose();
      if (prev && document.contains(prev)) { try { prev.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && !DMC.pop.isOpen()) { e.stopPropagation(); close(); }
      if (e.key === 'Tab') {
        const f = Array.from(modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select,textarea,[href],[tabindex]:not([tabindex="-1"])')).filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    const modal = h('div', { class: 'modal' + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title },
      h('div', { class: 'modal-h' }, h('h2', null, o.title), h('button', { type: 'button', class: 'btn icon ghost', 'aria-label': 'Close', onclick: close }, U.icon('x', 18))),
      h('div', { class: 'modal-b' }, o.body),
      o.footer ? h('div', { class: 'modal-f' }, o.footer) : null);
    const scrim = h('div', { class: 'scrim', onpointerdown: (e) => { if (e.target === scrim) close(); } }, modal);
    document.body.appendChild(scrim);
    document.addEventListener('keydown', onKey, true);
    const f = modal.querySelector('[data-autofocus]') || modal.querySelector('input,textarea,select') || modal.querySelector('.modal-f button') || modal.querySelector('button');
    setTimeout(() => f && f.focus({ preventScroll: true }), 0);
    return { close, el: modal };
  };

  F.confirm = function (o) {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
      const m = F.modal({
        title: o.title,
        body: h('p', { style: 'color:var(--muted);max-width:60ch' }, o.text),
        footer: [
          h('button', { type: 'button', class: 'btn', onclick: () => fin(false) }, o.cancel || 'Cancel'),
          h('button', { type: 'button', class: 'btn ' + (o.danger ? 'danger' : 'primary'), 'data-autofocus': '', onclick: () => fin(true) }, o.ok || 'OK'),
        ],
        onClose: () => { if (!done) { done = true; resolve(false); } },
      });
    });
  };

  /* ------------------------------------------------------------------ *
   * Primitive controls
   * ------------------------------------------------------------------ */
  /** Switch (button role=switch). */
  F.sw = function (value, onChange, o) {
    o = o || {};
    const b = h('button', { type: 'button', class: 'sw', role: 'switch', 'aria-checked': String(!!value), 'aria-label': o.label || 'Toggle', disabled: !!o.disabled });
    b.addEventListener('click', () => {
      const next = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', String(next));
      onChange(next);
    });
    b.set = (v) => b.setAttribute('aria-checked', String(!!v));
    return b;
  };

  /** Segmented control. options: [{id,label,icon,title}] */
  F.seg = function (options, value, onChange, o) {
    o = o || {};
    const wrap = h('div', { class: 'seg' + (o.accent ? ' accent' : '') + (o.wrap ? ' wrap' : ''), role: 'group', 'aria-label': o.label || null });
    const buttons = [];
    for (const opt of options) {
      const b = h('button', { type: 'button', title: opt.title || '', 'aria-pressed': String(opt.id === value), onclick: () => { set(opt.id); onChange(opt.id); } },
        opt.icon ? U.icon(opt.icon, 14) : null, opt.label);
      b.dataset.id = opt.id;
      buttons.push(b);
      wrap.appendChild(b);
    }
    function set(id) { for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.id === String(id))); }
    wrap.set = set;
    return wrap;
  };

  /** Text input / textarea bound to a path. o: {placeholder, mono, multiline, rows, maxlength, delEmpty, onInput, transform} */
  F.str = function (target, o) {
    o = o || {};
    const b = B(target);
    const el = h(o.multiline ? 'textarea' : 'input', {
      class: 'inp' + (o.mono ? ' mono' : ''), type: o.multiline ? null : 'text', placeholder: o.placeholder, maxlength: o.maxlength,
      spellcheck: 'false', autocomplete: 'off', rows: o.rows, 'aria-label': o.aria || null,
    });
    const cur = b.get();
    el.value = typeof cur === 'string' ? cur : cur === undefined ? '' : typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
    el.addEventListener('input', () => {
      const v = el.value;
      if (o.onInput && o.onInput(v) === false) return;
      if (v === '' && o.delEmpty) b.del(false);
      else b.set(o.transform ? o.transform(v) : v, false);
    });
    return el;
  };

  /** Number input bound to a path. o: {min,max,step,int,placeholder,delEmpty} */
  F.num = function (target, o) {
    o = o || {};
    const b = B(target);
    const el = h('input', { class: 'inp num', type: 'number', min: o.min, max: o.max, step: o.step != null ? o.step : o.int ? 1 : 'any', placeholder: o.placeholder, inputmode: 'decimal', 'aria-label': o.aria || null });
    const cur = b.get();
    el.value = typeof cur === 'number' ? String(cur) : '';
    el.addEventListener('input', () => {
      if (el.value === '') {
        if (o.delEmpty !== false) b.del(false);
        return;
      }
      const n = Number(el.value);
      if (Number.isFinite(n)) b.set(n, false);
    });
    return el;
  };

  /** Boolean switch bound to a path; the key is removed again when it matches the default. */
  F.bool = function (target, o) {
    o = o || {};
    const b = B(target);
    const cur = b.get();
    const on = cur === undefined ? !!o.dflt : !!cur;
    return F.sw(on, (v) => {
      if (o.dflt !== undefined && v === o.dflt && !o.explicit) b.del(false);
      else b.set(v, false);
      if (o.onChange) o.onChange(v);
    }, o);
  };

  /** Native select bound to a path. options: [{id,label}] ; the default option removes the key. */
  F.select = function (target, options, o) {
    o = o || {};
    const b = B(target);
    const el = h('select', { class: 'inp', 'aria-label': o.aria || null });
    for (const opt of options) el.appendChild(h('option', { value: opt.id }, opt.label));
    const cur = b.get();
    el.value = cur === undefined ? (o.dflt !== undefined ? o.dflt : options[0].id) : String(cur);
    el.addEventListener('change', () => {
      const v = el.value;
      if (o.dflt !== undefined && v === o.dflt && !o.explicit) b.del(!!o.structural);
      else b.set(v, !!o.structural);
      if (o.onChange) o.onChange(v);
    });
    return el;
  };

  /* ------------------------------------------------------------------ *
   * Field wrapper (label + control + message area)
   * ------------------------------------------------------------------ */
  F.field = function (label, control, o) {
    o = o || {};
    let target = control;
    if (control && control.matches && !control.matches('input,select,textarea')) target = control.querySelector && control.querySelector('input:not([type=hidden]),select,textarea');
    if (target && !target.id) target.id = 'f' + U.uid();
    const lab = target && target.id && !o.noFor ? h('label', { class: 'fld-label', for: target.id }, label) : h('span', { class: 'fld-label' }, label);
    const head = label || o.hint || o.tools
      ? h('div', { class: 'fld-head' }, label ? lab : null, o.hint ? h('span', { class: 'hint' }, o.hint) : null, h('span', { class: 'grow' }), o.tools || null)
      : null;
    const el = h('div', { class: 'fld' + (o.row ? ' row' : '') + (o.className ? ' ' + o.className : ''), 'data-path': o.path != null ? o.path : null },
      head, h('div', { class: 'fld-body' }, control), h('div', { class: 'fld-msgs' }));
    return el;
  };

  /**
   * An optional key: a switch in the header adds/removes the key, the body shows the control when present.
   * build(): Node ; makeDefault(): value
   */
  F.optional = function (target, label, makeDefault, build, o) {
    o = o || {};
    const b = B(target);
    const present = b.get() !== undefined;
    const sw = F.sw(present, (on) => {
      if (on) b.set(makeDefault(), true);
      else b.del(true);
    }, { label: (present ? 'Remove ' : 'Add ') + label });
    const body = present ? build() : h('div', { class: 'hint' }, o.empty || 'Not set — the game uses its default.');
    const el = F.field(label, body, Object.assign({ path: b.path, tools: sw, noFor: true }, o, { row: false }));
    if (!present) el.classList.add('off-quiet');
    return el;
  };

  /** Number field with an on/off switch (for optional sizes). */
  F.optNum = function (target, label, dflt, o) {
    o = o || {};
    return F.optional(target, label, () => dflt, () => F.num(target, Object.assign({ delEmpty: false }, o)), { hint: o.hint, empty: o.empty || 'Default: ' + dflt });
  };

  /* ------------------------------------------------------------------ *
   * Sections and entries
   * ------------------------------------------------------------------ */
  F.section = function (title, o) {
    o = o || {};
    const head = h('div', { class: 'sec-h' }, h('h2', null, title), o.note ? h('span', { class: 'sec-note' }, o.note) : null, h('span', { class: 'grow' }), o.actions || null);
    const body = h('div', { class: 'sec-b' }, o.body || null);
    return h('section', { class: 'sec', 'data-sec': o.id || null }, head, body);
  };

  F.iconBtn = function (icon, label, onclick, o) {
    o = o || {};
    return h('button', { type: 'button', class: 'btn icon xs ghost' + (o.danger ? ' danger' : ''), 'aria-label': label, title: label, disabled: !!o.disabled, onclick }, U.icon(icon, 14));
  };

  /**
   * Collapsible list entry.
   * o: {path, icon, kind, summary(), body(), defaultOpen, listPath, index, len, extraTools, onRemove, noMove, noDup}
   */
  F.entry = function (o) {
    let open = St.isOpen(o.path, o.defaultOpen);
    let built = false;
    const sum = h('span', { class: 'e-sum' });
    const refresh = () => { sum.textContent = (o.summary ? o.summary() : '') || ''; };
    refresh();
    const titleBtn = h('button', { type: 'button', class: 'btn ghost', style: 'flex:1;justify-content:flex-start;height:30px;padding:0 6px;min-width:0;overflow:hidden', 'aria-expanded': String(open), 'aria-label': (open ? 'Collapse ' : 'Expand ') + (o.kind || 'item') },
      U.icon(open ? 'chevron-down' : 'chevron-right', 14),
      o.icon ? h('span', { class: 'e-ico' }, U.icon(o.icon, 16)) : null,
      h('span', { class: 'e-title' }, h('span', { class: 'e-kind' }, o.kind || ''), sum));
    const tools = h('div', { class: 'e-tools' });
    if (o.extraTools) for (const t of [].concat(o.extraTools)) tools.appendChild(t);
    if (o.listPath !== undefined && o.index !== undefined) {
      const lp = o.listPath;
      const i = o.index;
      if (!o.noMove) {
        tools.appendChild(F.iconBtn('arrow-up', 'Move up', () => { St.moveOpen(lp, i, i - 1); St.move(lp, i, i - 1); }, { disabled: i === 0 }));
        tools.appendChild(F.iconBtn('arrow-down', 'Move down', () => { St.moveOpen(lp, i, i + 1); St.move(lp, i, i + 1); }, { disabled: i >= o.len - 1 }));
      }
      if (!o.noDup) tools.appendChild(F.iconBtn('copy', 'Duplicate', () => { const v = St.get(lp + '.' + i); St.insert(lp, i + 1, U.clone(v)); }));
      tools.appendChild(F.iconBtn('trash', 'Remove', () => { if (o.onRemove) o.onRemove(); else St.remove(lp, i); }, { danger: true }));
    }
    const bodyWrap = h('div', { class: 'entry-b' }, h('div', { class: 'fld-msgs' }));
    const el = h('div', { class: 'entry' + (open ? '' : ' collapsed'), 'data-path': o.path, 'data-entry': '1' }, h('div', { class: 'entry-h' }, titleBtn, tools), bodyWrap);
    function build() {
      if (built) return;
      built = true;
      const content = o.body();
      bodyWrap.appendChild(content);
    }
    function setOpen(v) {
      open = v;
      St.setOpen(o.path, v);
      el.classList.toggle('collapsed', !v);
      titleBtn.setAttribute('aria-expanded', String(v));
      titleBtn.querySelector('svg').replaceWith(U.icon(v ? 'chevron-down' : 'chevron-right', 14));
      if (v) { build(); if (DMC.editor) DMC.editor.applyIssues(); }
    }
    titleBtn.addEventListener('click', () => setOpen(!open));
    if (open) build();
    el._refresh = refresh;
    el._setOpen = setOpen;
    el._isBuilt = () => built;
    return el;
  };

  F.addRow = function (buttons) {
    const row = h('div', { class: 'entry-add' });
    for (const b of buttons) {
      row.appendChild(h('button', { type: 'button', class: 'btn sm' + (b.primary ? ' primary' : ''), onclick: b.onclick, disabled: !!b.disabled, title: b.title || '' }, b.icon ? U.icon(b.icon, 14) : null, b.label));
    }
    return row;
  };

  /* ------------------------------------------------------------------ *
   * Issue messages
   * ------------------------------------------------------------------ */
  F.msgEl = function (issue) {
    const fix = issue.fix;
    return h('div', { class: 'msg ' + issue.level, role: issue.level === 'error' ? 'alert' : null },
      U.icon(issue.level === 'error' ? 'error' : issue.level === 'warn' ? 'warn' : 'info', 14),
      h('div', { class: 'm-body' }, issue.msg, issue.hint ? h('span', { class: 'm-hint' }, issue.hint) : null),
      fix ? h('button', { type: 'button', class: 'btn xs fixbtn', onclick: () => St.applyFix(fix) }, fix.label || 'Fix') : null);
  };

  /** Insert text at the caret of an input/textarea and fire an input event. */
  F.insertAtCursor = function (el, text) {
    const s = el.selectionStart != null ? el.selectionStart : el.value.length;
    const e = el.selectionEnd != null ? el.selectionEnd : el.value.length;
    el.value = el.value.slice(0, s) + text + el.value.slice(e);
    const pos = s + text.length;
    try { el.setSelectionRange(pos, pos); } catch (err) { /* not all input types */ }
    el.focus();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /** Auto-growing textarea (rows follow content up to max). */
  F.autosize = function (ta, maxRows) {
    const fit = () => {
      ta.style.height = 'auto';
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      const max = lh * (maxRows || 8) + 16;
      ta.style.height = Math.min(ta.scrollHeight + 2, max) + 'px';
    };
    ta.addEventListener('input', fit);
    setTimeout(fit, 0);
    return fit;
  };

  /** Copy button helper with feedback. */
  F.copyBtn = function (getText, label, o) {
    o = o || {};
    const b = h('button', { type: 'button', class: 'btn ' + (o.sm === false ? '' : 'sm') + (o.primary ? ' primary' : '') }, U.icon('copy', 14), label || 'Copy');
    b.addEventListener('click', async () => {
      const ok = await U.copy(getText());
      F.toast(ok ? 'Copied to clipboard' : 'Could not copy — select the text and press Ctrl+C', { kind: ok ? 'ok' : 'err' });
    });
    return b;
  };
})();
