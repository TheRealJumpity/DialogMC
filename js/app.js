/* Dialog MC — app shell: topbar, dialog rail, wiring between store, editor, preview and outputs. */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const U = DMC.util;
  const h = U.h;
  const St = DMC.store;
  const F = DMC.fields;
  const E = DMC.editor;
  const X = DMC.exp;

  let els = {};
  let raf = 0;

  /* ---------------- topbar ---------------- */
  function buildTopbar() {
    const seg = F.seg(DMC.ver.list.map((v) => ({ id: v.id, label: v.label, title: 'Minecraft Java ' + v.label })), St.version(), (id) => St.setVersion(id), { accent: true, label: 'Minecraft version' });
    els.verSeg = seg;
    els.compat = h('div', { class: 'compat', 'aria-live': 'polite' });
    els.undo = h('button', { type: 'button', class: 'btn icon ghost', 'aria-label': 'Undo', title: 'Undo (Ctrl+Z)', onclick: () => St.undo() }, U.icon('undo', 17));
    els.redo = h('button', { type: 'button', class: 'btn icon ghost', 'aria-label': 'Redo', title: 'Redo (Ctrl+Shift+Z)', onclick: () => St.redo() }, U.icon('redo', 17));
    const projBtn = h('button', { type: 'button', class: 'btn', onclick: (e) => projectMenu(e.currentTarget) }, U.icon('folder', 15), 'Project');
    const tplBtn = h('button', { type: 'button', class: 'btn', onclick: () => DMC.templates.open() }, U.icon('layers', 15), 'Templates');
    const shareBtn = h('button', { type: 'button', class: 'btn', onclick: share }, U.icon('link', 15), 'Share');
    const exportBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => { setView('output'); DMC.outputs.setTab('pack'); } }, U.icon('download', 15), 'Export');
    const helpBtn = h('button', { type: 'button', class: 'btn icon ghost', 'aria-label': 'Help', title: 'Help', onclick: help }, U.icon('help', 17));
    return h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, brandMark(), 'Dialog MC'),
      seg, els.compat,
      h('div', { class: 'spacer' }),
      h('div', { class: 'topbar-group' }, els.undo, els.redo),
      h('div', { class: 'topbar-group tb-actions' }, projBtn, tplBtn, shareBtn, exportBtn, helpBtn));
  }

  function brandMark() {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 22 22');
    s.setAttribute('class', 'brand-mark');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<rect x="1" y="1" width="20" height="20" rx="3" fill="#202531" stroke="#5ccfe2" stroke-width="1.5"/><rect x="5" y="5" width="12" height="3" fill="#5ccfe2"/><rect x="5" y="10" width="12" height="2" fill="#7b859b"/><rect x="5" y="14" width="5" height="3" fill="#6f6f6f"/><rect x="12" y="14" width="5" height="3" fill="#6f6f6f"/>';
    return s;
  }

  function updateTopbar() {
    els.verSeg.set(St.version());
    els.undo.disabled = !St.canUndo();
    els.redo.disabled = !St.canRedo();
    els.compat.textContent = '';
    for (const v of DMC.ver.list) {
      const c = St.compat[v.id];
      if (!c) continue;
      const bad = c.errors > 0;
      els.compat.appendChild(h('button', { type: 'button', class: 'badge ' + (bad ? 'bad' : 'ok') + (v.id === St.version() ? ' here' : ''), title: bad ? v.label + ': ' + U.plural(c.errors, 'error') + ' in the project' : v.label + ': works', onclick: () => { St.setVersion(v.id); } },
        U.icon(bad ? 'error' : 'check', 13), v.label, bad ? h('b', null, c.errors) : null));
    }
  }

  /* ---------------- project menu / import ---------------- */
  function projectMenu(anchor) {
    DMC.pick.menu(anchor, [
      { id: 'import', label: 'Import…', desc: 'Paste JSON, SNBT or a /dialog command, or open a file', icon: 'upload' },
      { id: 'save', label: 'Save project file', desc: 'All dialogs and pack settings as .json', icon: 'save' },
      { id: 'zip', label: 'Download data pack', desc: 'A ready-to-use .zip', icon: 'package' },
      { id: 'new', label: 'New project', desc: 'Clear everything (you can undo)', icon: 'refresh', danger: true },
    ], {
      width: 300,
      onPick: async (it) => {
        if (it.id === 'import') importModal();
        else if (it.id === 'save') U.download(St.project().pack.namespace + '_project.json', St.exportProject(), 'application/json');
        else if (it.id === 'zip') { setView('output'); DMC.outputs.setTab('pack'); }
        else if (it.id === 'new') {
          if (await F.confirm({ title: 'Start a new project?', text: 'This replaces all dialogs with the starter ones. You can undo it right after.', ok: 'Start new', danger: true })) St.reset();
        }
      },
    });
  }

  function importModal() {
    const ta = h('textarea', { class: 'inp mono', rows: 10, placeholder: 'Paste a dialog as JSON or SNBT, a /dialog show command, or a Dialog MC project file…', spellcheck: 'false', 'data-autofocus': '', 'aria-label': 'Text to import' });
    const status = h('div', { class: 'msg info', hidden: true });
    const file = h('input', { type: 'file', accept: '.json,.snbt,.txt,.mcfunction', hidden: true });
    const drop = h('div', { class: 'drop' }, 'Drop a file here or ', h('button', { type: 'button', class: 'btn sm', onclick: () => file.click() }, 'choose a file'));
    const readFile = async (f) => { if (f) { ta.value = await f.text(); status.hidden = true; } };
    file.addEventListener('change', () => readFile(file.files[0]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); readFile(e.dataTransfer.files[0]); });
    let m;
    const fail = (t) => { status.hidden = false; status.className = 'msg error'; status.textContent = t; };
    const go = (replace) => {
      const text = ta.value;
      const proj = St.importProject(text);
      if (proj.ok) {
        const p = proj.project;
        if (replace) St.replaceProject(p, { version: DMC.ver.byId[p.version] ? p.version : St.version() });
        else St.addMany((p.dialogs || []).filter((d) => d && d.dialog).map((d) => ({ id: d.id || 'imported', dialog: E.normalize(d.dialog, 0), tags: d.tags })), { reason: 'import' });
        m.close();
        F.toast('Project imported', { kind: 'ok' });
        return;
      }
      const r = X.importText(text);
      if (!r.ok) return fail(r.error);
      if (!r.dialog) return fail('That command only names a dialog (' + r.id + '). Paste the dialog itself to import it.');
      const d = E.normalize(r.dialog, 0);
      St.addDialog(null, { dialog: d });
      m.close();
      F.toast('Imported as a new dialog', { kind: 'ok' });
    };
    m = F.modal({
      title: 'Import', body: h('div', { class: 'stack' }, ta, drop, file, status),
      footer: [h('span', { class: 'grow' }, 'Adds to the project; a project file can also replace it.'),
        h('button', { type: 'button', class: 'btn', onclick: () => go(true) }, 'Replace project'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => go(false) }, 'Import')],
    });
  }

  async function share() {
    const hash = await St.shareHash();
    const url = location.href.split('#')[0] + hash;
    history.replaceState(null, '', hash);
    const ok = await U.copy(url);
    const long = url.length > 8000;
    F.toast(ok ? 'Link copied' + (long ? ' — it’s long, some chat apps may cut it' : '') : 'Link is in the address bar — copy it from there', { kind: ok ? 'ok' : 'err' });
  }

  function help() {
    F.modal({
      title: 'How it works',
      body: h('div', { class: 'stack' },
        h('p', { style: 'color:var(--muted)' }, 'Dialog MC builds Minecraft Java dialogs — the pop-up screens added in 1.21.6. Pick the game version at the top; checks and options follow it.'),
        h('ol', { class: 'help-list' },
          h('li', null, 'Pick or add a dialog in the left list, then fill in its title, body, inputs and buttons.'),
          h('li', null, 'Click buttons in the preview to see what they would do. Commands are checked and logged.'),
          h('li', null, 'Red and amber marks show what won’t work. The Problems tab lists them with fixes.'),
          h('li', null, 'Export the JSON, a ', h('code', null, '/dialog show'), ' command, or a data pack zip.')),
        h('div', { class: 'cluster' }, h('span', { class: 'kbd' }, 'Ctrl Z'), 'undo', h('span', { class: 'kbd' }, 'Ctrl Shift Z'), 'redo'),
        h('p', { class: 'hint' }, 'Item icons are placeholders — no Mojang artwork is bundled. Your work is saved in this browser; use Share or Project → Save to keep it elsewhere. Not affiliated with Mojang or Microsoft.')),
    });
  }

  /* ---------------- rail ---------------- */
  function buildRail() {
    els.dlist = h('div', { class: 'dlist', role: 'list' });
    els.nsIn = h('input', { class: 'inp mono', spellcheck: 'false', 'aria-label': 'Namespace', style: 'height:28px' });
    els.nsIn.addEventListener('input', () => St.setNamespace(els.nsIn.value.trim()));
    const add = h('button', { type: 'button', class: 'btn sm', 'aria-label': 'Add dialog', onclick: (e) => addMenu(e.currentTarget) }, U.icon('plus', 13), 'Add');
    return h('aside', { class: 'rail', 'aria-label': 'Dialogs' },
      h('div', { class: 'rail-sec' }, h('div', { class: 'rail-h' }, 'Dialogs', add), els.dlist),
      h('div', { class: 'rail-foot' }, h('div', { class: 'pack-field' }, h('label', null, 'Namespace'), els.nsIn),
        h('div', { class: 'hint' }, 'Dialogs are named namespace:name.')));
  }

  function addMenu(anchor) {
    DMC.pick.menu(anchor, DMC.schema.dialogTypes.map((t) => ({ id: t.id, label: t.label, desc: t.desc, icon: t.icon })).concat([{ id: '_tpl', label: 'From a template…', icon: 'layers', group: 'More' }]), {
      width: 320,
      onPick: (it) => { if (it.id === '_tpl') DMC.templates.open(); else St.addDialog(it.id); },
    });
  }

  function renderRail() {
    if (document.activeElement !== els.nsIn) els.nsIn.value = St.project().pack.namespace;
    els.dlist.textContent = '';
    const ds = St.project().dialogs;
    ds.forEach((e, i) => {
      const c = St.dialogCounts[i] || { error: 0, warn: 0 };
      const cur = e === St.cur();
      const row = h('div', { class: 'ditem-row', role: 'listitem' },
        h('button', { type: 'button', class: 'ditem', 'aria-current': String(cur), onclick: () => St.select(i), onkeydown: (ev) => rowKey(ev, i) },
          U.icon(DMC.schema.dialogTypes.find((t) => t.id === DMC.schema.bare(e.dialog.type)) ? DMC.schema.dialogTypes.find((t) => t.id === DMC.schema.bare(e.dialog.type)).icon : 'file', 15),
          h('span', { class: 'nm' }, e.id),
          h('span', { class: 'dots' }, c.error ? h('i', { class: 'dot err', title: U.plural(c.error, 'error') }) : null, c.warn ? h('i', { class: 'dot warn', title: U.plural(c.warn, 'warning') }) : null)));
      if (cur) {
        row.appendChild(h('div', { class: 'ditem-tools' },
          F.iconBtn('arrow-up', 'Move up', () => St.moveDialog(i, i - 1), { disabled: i === 0 }),
          F.iconBtn('arrow-down', 'Move down', () => St.moveDialog(i, i + 1), { disabled: i === ds.length - 1 }),
          F.iconBtn('copy', 'Duplicate', () => St.duplicateDialog(i)),
          F.iconBtn('trash', 'Delete', () => removeDialog(i), { disabled: ds.length <= 1 })));
      }
      els.dlist.appendChild(row);
    });
  }

  function rowKey(ev, i) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const btns = els.dlist.querySelectorAll('.ditem');
      const n = btns[i + (ev.key === 'ArrowDown' ? 1 : -1)];
      if (n) { n.focus(); }
    }
  }

  async function removeDialog(i) {
    const e = St.project().dialogs[i];
    if (await F.confirm({ title: 'Delete “' + e.id + '”?', text: 'Buttons that open it will show a problem. You can undo this.', ok: 'Delete', danger: true })) St.removeDialog(i);
  }

  /* ---------------- views (mobile) ---------------- */
  function setView(v) {
    els.app.dataset.view = v;
    for (const b of els.mtabs.children) b.setAttribute('aria-pressed', String(b.dataset.v === v));
  }

  /* ---------------- refresh scheduling ---------------- */
  function later(fn) { return () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fn); }; }
  const refreshLight = later(() => {
    E.refreshSummaries();
    DMC.preview.render();
    DMC.outputs.render(false);
    renderRail();
    updateTopbar();
  });

  function fullRender() {
    E.render(els.editor);
    DMC.preview.render();
    DMC.outputs.render(true);
    DMC.outputs.refreshTabs();
    renderRail();
    updateTopbar();
  }

  function boot() {
    const root = document.getElementById('app');
    els.app = root;
    const top = buildTopbar();
    const rail = buildRail();
    els.editor = h('main', { class: 'editor', id: 'editor', tabindex: '-1' });
    els.pv = h('div', { class: 'pv-host' });
    els.out = h('div', { class: 'out' });
    els.side = h('aside', { class: 'side', 'aria-label': 'Preview and output' }, els.pv, els.out);
    els.mtabs = h('nav', { class: 'mobile-tabs', 'aria-label': 'Sections' },
      ...[['edit', 'Edit', 'sliders'], ['preview', 'Preview', 'eye'], ['output', 'Output', 'code']].map(([id, label, icon]) =>
        h('button', { type: 'button', 'data-v': id, 'aria-pressed': 'false', onclick: () => setView(id) }, U.icon(icon, 16), label)));
    root.appendChild(top);
    root.appendChild(h('div', { class: 'workbench' }, rail, els.editor, els.side));
    root.appendChild(els.mtabs);
    setView('edit');

    DMC.preview.mount(els.pv);
    DMC.outputs.mount(els.out);
    E.render(els.editor);
    St.init();
    fullRender();

    St.on('structure', () => { fullRender(); });
    St.on('select', () => { fullRender(); });
    St.on('version', () => { updateTopbar(); });
    St.on('value', refreshLight);
    St.on('project', refreshLight);
    St.on('issues', () => {
      E.applyIssues();
      DMC.outputs.refreshTabs();
      DMC.outputs.render(state_issuesOnly());
      renderRail();
      updateTopbar();
    });
    // the Problems tab rebuilds on issue changes; other tabs update in place
    function state_issuesOnly() { return false; }

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !t.readOnly;
      if (k === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) St.redo(); else St.undo(); }
      else if (k === 'y' && !typing) { e.preventDefault(); St.redo(); }
      else if (k === 's') { e.preventDefault(); St.saveNow(); F.toast('Saved in this browser', { kind: 'ok' }); }
    });
    window.addEventListener('beforeunload', () => St.saveNow());
    window.addEventListener('hashchange', async () => { if (await St.loadHash(location.hash)) { fullRender(); } });
  }

  DMC.app = { boot, setView, fullRender };

  async function start() {
    let fromHash = false;
    if (location.hash.startsWith('#p=')) fromHash = await St.loadHash(location.hash);
    if (!fromHash) St.loadSaved();
    boot();
    if (location.hash.startsWith('#p=') && !fromHash) F.toast('That share link couldn’t be read', { kind: 'err' });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
