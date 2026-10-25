/* Dialog MC — output tabs: JSON, /dialog command, data pack (zip), and the problems list. */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const U = DMC.util;
  const h = U.h;
  const St = DMC.store;
  const F = DMC.fields;
  const X = DMC.exp;
  const O = (DMC.outputs = {});
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  const state = { tab: 'json', fmt: 'json', target: '@s', functions: true, notes: false };
  let host = null;
  let tabsEl = null;
  let panelEl = null;
  let panel = null; // {el, update()}

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function highlightJson(text) {
    return esc(text).replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (m, str, colon, lit, num) => {
      if (str) return colon ? '<span class="k">' + str + '</span>' + colon : '<span class="s">' + str + '</span>';
      if (lit) return '<span class="b">' + lit + '</span>';
      if (num !== undefined) return '<span class="n">' + num + '</span>';
      return m;
    });
  }

  const slug = () => St.cur().id.replace(/[\\/]+/g, '_');

  /* ------------------------------------------------------------------ *
   * Mount + tabs
   * ------------------------------------------------------------------ */
  const TABS = [
    { id: 'json', label: 'JSON', icon: 'code' },
    { id: 'command', label: 'Command', icon: 'terminal' },
    { id: 'pack', label: 'Data pack', icon: 'package' },
    { id: 'issues', label: 'Problems', icon: 'warn' },
  ];

  O.mount = function (container) {
    host = container;
    tabsEl = h('div', { class: 'tabs', role: 'tablist' });
    panelEl = h('div', { class: 'tab-panel', role: 'tabpanel' });
    host.appendChild(tabsEl);
    host.appendChild(panelEl);
    buildTabs();
    render(true);
  };

  function buildTabs() {
    tabsEl.textContent = '';
    for (const t of TABS) {
      const c = St.counts;
      let badge = null;
      if (t.id === 'issues') {
        if (c.error) badge = h('span', { class: 'count err' }, c.error);
        else if (c.warn) badge = h('span', { class: 'count warn' }, c.warn);
      }
      const btn = h('button', { type: 'button', class: 'tab', role: 'tab', id: 'tab-' + t.id, 'aria-selected': String(state.tab === t.id), onclick: () => O.setTab(t.id) }, U.icon(t.icon, 15), t.label, badge);
      tabsEl.appendChild(btn);
    }
  }

  O.setTab = function (id) {
    state.tab = id;
    buildTabs();
    render(true);
  };

  function render(full) {
    if (!panelEl) return;
    if (full || !panel || panel.tab !== state.tab) {
      panelEl.textContent = '';
      panel = ({ json: jsonPanel, command: commandPanel, pack: packPanel, issues: issuesPanel })[state.tab]();
      panel.tab = state.tab;
      panelEl.appendChild(panel.el);
    } else if (panel.update) panel.update();
  }
  O.render = render;
  O.refreshTabs = buildTabs;

  /* ------------------------------------------------------------------ *
   * JSON
   * ------------------------------------------------------------------ */
  function jsonText() {
    const d = St.dialog();
    if (state.fmt === 'min') return X.jsonMin(d);
    if (state.fmt === 'snbt') return X.snbt(d);
    return X.json(d);
  }

  function jsonPanel() {
    const code = h('pre', { class: 'code', tabindex: '0', 'aria-label': 'Dialog output' });
    const info = h('div', { class: 'hint' });
    const seg = F.seg([{ id: 'json', label: 'JSON' }, { id: 'min', label: 'Compact' }, { id: 'snbt', label: 'SNBT' }], state.fmt, (id) => { state.fmt = id; update(); }, { label: 'Output format' });
    const bar = h('div', { class: 'code-bar' }, seg, h('span', { class: 'grow' }),
      F.copyBtn(jsonText, 'Copy'),
      h('button', { type: 'button', class: 'btn sm', onclick: () => U.download(slug() + (state.fmt === 'snbt' ? '.snbt' : '.json'), jsonText() + '\n', 'application/json') }, U.icon('download', 14), 'Download'));
    function update() {
      const t = jsonText();
      if (state.fmt === 'snbt') code.textContent = t; else code.innerHTML = highlightJson(t);
      code.classList.toggle('wrap', state.fmt !== 'json');
      const e = St.cur();
      info.textContent = state.fmt === 'snbt'
        ? 'SNBT is what the /dialog command takes inline.'
        : 'Save as data/' + St.project().pack.namespace + '/dialog/' + e.id + '.json in a data pack, or use the Data pack tab.';
    }
    update();
    const el = h('div', { class: 'stack-s' }, bar, code, info);
    return { el, update };
  }

  /* ------------------------------------------------------------------ *
   * Command
   * ------------------------------------------------------------------ */
  function meter(len) {
    const CHAT = 256;
    const BLOCK = 32500;
    const pct = Math.min(100, (len / BLOCK) * 100);
    const cls = len > BLOCK ? 'err' : len > CHAT ? 'warn' : '';
    return { el: h('div', { class: 'meter ' + cls, role: 'img', 'aria-label': len + ' characters' }, h('i', { style: 'width:' + Math.max(1.5, pct) + '%' })), cls };
  }

  function commandPanel() {
    const wrap = h('div', { class: 'stack' });
    const targetIn = h('input', { class: 'inp mono', value: state.target, spellcheck: 'false', 'aria-label': 'Who sees the dialog', placeholder: '@s' });
    targetIn.addEventListener('input', () => { state.target = targetIn.value.trim() || '@s'; update(); });
    const chips = h('div', { class: 'cluster', style: 'gap:4px' });
    for (const t of ['@s', '@a', '@p', '@r']) chips.appendChild(h('button', { type: 'button', class: 'btn xs mono', onclick: () => { targetIn.value = t; state.target = t; update(); } }, t));
    wrap.appendChild(F.field('Show it to', h('div', { class: 'stack-s', style: 'gap:6px' }, targetIn, chips), { noFor: true, hint: 'Player name or selector' }));

    const blocks = h('div', { class: 'stack' });
    wrap.appendChild(blocks);
    function block(title, hint, text, o) {
      o = o || {};
      const pre = h('pre', { class: 'code wrap', tabindex: '0' }, text);
      const head = h('div', { class: 'code-bar' }, h('span', { class: 'fld-label' }, title), h('span', { class: 'grow' }), F.copyBtn(() => text, 'Copy'));
      const kids = [head];
      if (hint) kids.push(h('div', { class: 'hint' }, hint));
      kids.push(pre);
      if (o.meter) {
        const m = meter(text.length);
        const msg = text.length > 32500 ? 'Longer than a command block can hold (32,500 characters). Use the data pack instead.' : text.length > 256 ? 'Too long to type into the chat box (about 256 characters) — paste it into a command block, or use the data pack.' : null;
        kids.push(h('div', { class: 'stack-s', style: 'gap:4px' }, m.el, h('div', { class: 'hint' }, text.length.toLocaleString() + ' characters'), msg ? h('div', { class: 'msg warn' }, U.icon('warn', 14), h('div', { class: 'm-body' }, msg)) : null));
      }
      if (o.check) {
        const r = DMC.cmd.validate(text, St.version());
        kids.push(r.ok
          ? h('div', { class: 'msg ok' }, U.icon('check', 14), h('div', { class: 'm-body' }, 'The game’s command parser accepts this. ' + (r.level > 0 ? 'Needs ' + DMC.cmd.levelName(r.level) + ' to run.' : '')))
          : h('div', { class: 'msg error' }, U.icon('error', 14), h('div', { class: 'm-body' }, 'The game would reject this: ' + r.errors[0].message + (r.errors[0].pos != null ? ' (character ' + (r.errors[0].pos + 1) + ')' : ''))));
      }
      return h('div', { class: 'stack-s' }, kids);
    }
    function update() {
      blocks.textContent = '';
      const e = St.cur();
      const full = St.fullId(e);
      blocks.appendChild(block('Show this dialog now', 'Paste into chat, a command block or a function. Needs operator permission (level 2).', X.command(St.dialog(), state.target), { meter: true, check: true }));
      blocks.appendChild(block('After the data pack is installed', 'Uses the dialog file instead of pasting it all.', X.commandForId(full, state.target)));
      blocks.appendChild(block('A clickable chat link', 'Prints a link that opens the dialog when clicked.', X.tellraw(full, 'Open ' + (DMC.text.plain(St.dialog().title, St.version()).slice(0, 30) || 'menu'), 'aqua', state.target)));
      blocks.appendChild(block('Close it again', null, '/dialog clear ' + state.target));
    }
    update();
    return { el: wrap, update };
  }

  /* ------------------------------------------------------------------ *
   * Data pack
   * ------------------------------------------------------------------ */
  function packPanel() {
    const wrap = h('div', { class: 'stack' });
    const pk = () => St.project().pack;
    const nsIn = h('input', { class: 'inp mono', value: pk().namespace, spellcheck: 'false', 'aria-label': 'Namespace' });
    nsIn.addEventListener('input', () => { St.setNamespace(nsIn.value.trim()); });
    const descIn = h('input', { class: 'inp', value: pk().description, spellcheck: 'false', 'aria-label': 'Pack description' });
    descIn.addEventListener('input', () => { St.setPack({ description: descIn.value }); });
    wrap.appendChild(h('div', { class: 'grid2' },
      F.field('Namespace', nsIn, { hint: 'a-z 0-9 _ . -' }),
      F.field('Description', descIn)));
    const msgs = h('div', { class: 'stack-s' });
    wrap.appendChild(msgs);

    const rangeSw = F.sw(!!pk().range, (on) => { St.setPack({ range: on }); update(); }, { label: 'Works in both versions' });
    const v1 = DMC.ver.list[0];
    const v2 = DMC.ver.list[DMC.ver.list.length - 1];
    wrap.appendChild(h('div', { class: 'stack-s' },
      h('label', { class: 'sw-row' }, rangeSw, h('span', null, 'Mark the pack as compatible with ' + v1.label + ' and ' + v2.label)),
      h('div', { class: 'hint' }, 'Off: the pack targets ' + DMC.ver.byId[St.version()].label + ' only (data pack format ' + DMC.ver.fmt(DMC.ver.byId[St.version()].dataFormat) + ').')));
    const fnSw = F.sw(state.functions, (on) => { state.functions = on; update(); }, { label: 'Add a function per dialog' });
    wrap.appendChild(h('label', { class: 'sw-row' }, fnSw, h('span', null, 'Add a function per dialog (/function ' + pk().namespace + ':show/<name>)')));

    // dialogs: id + tags
    const list = h('div', { class: 'stack-s' });
    St.project().dialogs.forEach((e, i) => {
      const idIn = h('input', { class: 'inp mono', value: e.id, spellcheck: 'false', 'aria-label': 'Dialog file name', style: 'height:28px' });
      idIn.addEventListener('input', () => { St.renameDialog(i, idIn.value.trim()); });
      const extra = h('input', { class: 'inp mono', value: (e.tags.extra || []).join(', '), placeholder: 'extra tags, e.g. my_pack:menu', spellcheck: 'false', 'aria-label': 'Extra tags', style: 'height:28px' });
      extra.addEventListener('input', () => { St.setTags(i, { extra: extra.value.split(',').map((x) => x.trim()).filter(Boolean) }); });
      list.appendChild(h('div', { class: 'part' },
        h('div', { class: 'part-h' },
          h('div', { style: 'flex:1 1 150px;min-width:0' }, idIn),
          h('label', { class: 'sw-row', style: 'gap:6px;min-height:28px', title: 'Adds a button to the pause menu' }, F.sw(!!e.tags.pause, (on) => St.setTags(i, { pause: on }), { label: 'Pause menu' }), h('span', { class: 'hint' }, 'Pause menu')),
          h('label', { class: 'sw-row', style: 'gap:6px;min-height:28px', title: 'Opens with the quick actions key' }, F.sw(!!e.tags.quick, (on) => St.setTags(i, { quick: on }), { label: 'Quick actions' }), h('span', { class: 'hint' }, 'Quick actions (' + (DMC.keys.defaults['key.quickActions'] || 'G') + ')'))),
        h('div', { class: 'part-adv', style: 'padding-top:0;border-top:0' }, extra)));
    });
    wrap.appendChild(h('div', { class: 'stack-s' }, h('div', { class: 'fld-head' }, h('span', { class: 'fld-label' }, 'Dialogs in the pack'), h('span', { class: 'hint' }, 'file name and where it shows up')), list));

    const tree = h('div', { class: 'filetree', role: 'tree', 'aria-label': 'Files in the pack' });
    const dl = h('button', { type: 'button', class: 'btn primary', onclick: download }, U.icon('download', 16), 'Download data pack (.zip)');
    wrap.appendChild(h('div', { class: 'stack-s' }, h('div', { class: 'fld-head' }, h('span', { class: 'fld-label' }, 'Files')), tree));
    wrap.appendChild(h('div', { class: 'cluster' }, dl, h('button', { type: 'button', class: 'btn', onclick: () => U.download(St.project().pack.namespace + '_project.json', St.exportProject(), 'application/json') }, U.icon('save', 14), 'Save project file')));
    wrap.appendChild(h('div', { class: 'stack-s' },
      h('div', { class: 'fld-label' }, 'Install it'),
      h('ol', { class: 'help-list' },
        h('li', null, 'Put the zip in your world’s ', h('code', null, 'datapacks'), ' folder (or a server’s ', h('code', null, 'world/datapacks'), ').'),
        h('li', null, 'Run ', h('code', null, '/reload'), ' in the world.'),
        h('li', null, 'Show a dialog with ', h('code', null, '/dialog show @s ' + pk().namespace + ':' + (St.project().dialogs[0] ? St.project().dialogs[0].id : 'name')), '.'))));

    function files() { return X.datapackFiles(St.project(), { functions: state.functions }); }
    function download() {
      const bytes = X.zip(files());
      U.download(St.project().pack.namespace + '_dialogs.zip', new Blob([bytes], { type: 'application/zip' }));
      F.toast('Data pack downloaded', { kind: 'ok' });
    }
    function update() {
      // problems with ids / namespace
      msgs.textContent = '';
      for (const p of St.projectIssues) msgs.appendChild(F.msgEl({ level: p.level, msg: p.msg }));
      const compat = St.compat;
      if (pk().range && compat) {
        for (const v of DMC.ver.list) if (compat[v.id] && compat[v.id].errors) msgs.appendChild(F.msgEl({ level: 'warn', msg: 'The pack claims ' + v.label + ' support, but ' + U.plural(compat[v.id].errors, 'error') + ' there — switch version at the top to see them.' }));
      }
      // tree
      tree.textContent = '';
      const paths = files().map((f) => f.path);
      const seen = new Set();
      for (const p of paths) {
        const parts = p.split('/');
        parts.forEach((seg, depth) => {
          const key = parts.slice(0, depth + 1).join('/');
          if (seen.has(key)) return;
          seen.add(key);
          const isFile = depth === parts.length - 1;
          tree.appendChild(h('div', { class: isFile ? 'f-file' : 'f-dir', role: 'treeitem', style: 'padding-left:' + depth * 14 + 'px' }, (isFile ? '' : '▸ ') + seg));
        });
      }
    }
    update();
    return { el: wrap, update };
  }

  /* ------------------------------------------------------------------ *
   * Problems
   * ------------------------------------------------------------------ */
  function issuesPanel() {
    const wrap = h('div', { class: 'stack' });
    function update() {
      wrap.textContent = '';
      // compatibility
      const cmp = St.compat || {};
      const row = h('div', { class: 'cluster' });
      for (const v of DMC.ver.list) {
        const c = cmp[v.id] || { errors: 0, warns: 0 };
        const cls = c.errors ? 'bad' : 'ok';
        row.appendChild(h('button', { type: 'button', class: 'chip' + (v.id === St.version() ? ' accent' : ''), title: 'Switch to ' + v.label, onclick: () => St.setVersion(v.id) },
          U.icon(c.errors ? 'error' : 'check', 13), v.label + ': ' + (c.errors ? U.plural(c.errors, 'error') : 'no errors') + (c.warns ? ', ' + U.plural(c.warns, 'warning') : '')));
        void cls;
      }
      wrap.appendChild(h('div', { class: 'stack-s' }, h('div', { class: 'fld-head' }, h('span', { class: 'fld-label' }, 'Works in'), h('span', { class: 'hint' }, 'whole project, both versions')), row));
      const issues = St.issues || [];
      const errs = issues.filter((i) => i.level === 'error');
      const warns = issues.filter((i) => i.level === 'warn');
      const notes = issues.filter((i) => i.level === 'info');
      if (!errs.length && !warns.length) {
        wrap.appendChild(h('div', { class: 'empty-state' }, h('span', { class: 'ico-big' }, U.icon('check', 28)), h('div', null, 'No problems in this dialog'), h('div', { class: 'hint' }, 'Commands parse, ids exist and the fields fit ' + St.version() + '.')));
      }
      const group = (title, list, cls) => {
        if (!list.length) return;
        wrap.appendChild(h('div', { class: 'fld-head' }, h('span', { class: 'fld-label' }, title), h('span', { class: 'count ' + cls }, list.length)));
        const box = h('div', { class: 'issue-list' });
        for (const it of list) {
          const main = h('button', { type: 'button', class: 'issue ' + it.level, onclick: () => DMC.editor.reveal(it.path || ''), title: 'Show the field' },
            U.icon(it.level === 'error' ? 'error' : it.level === 'warn' ? 'warn' : 'info', 15),
            h('div', null, h('div', { class: 'i-msg' }, it.msg), it.hint ? h('div', { class: 'i-hint' }, it.hint) : null, it.path ? h('div', { class: 'i-path' }, it.path) : null));
          const item = h('div', { class: 'stack-s', style: 'gap:4px' }, main);
          if (it.fix) item.appendChild(h('div', null, h('button', { type: 'button', class: 'btn xs', onclick: () => St.applyFix(it.fix) }, U.icon('check', 12), it.fix.label || 'Fix it')));
          box.appendChild(item);
        }
        wrap.appendChild(box);
      };
      group('Errors', errs, 'err');
      group('Warnings', warns, 'warn');
      if (notes.length) {
        wrap.appendChild(h('button', { type: 'button', class: 'btn sm ghost', style: 'justify-self:start', 'aria-expanded': String(state.notes), onclick: () => { state.notes = !state.notes; update(); } }, U.icon(state.notes ? 'chevron-down' : 'chevron-right', 14), (state.notes ? 'Hide ' : 'Show ') + U.plural(notes.length, 'note')));
        if (state.notes) group('Notes', notes, '');
      }
      // other dialogs
      const others = [];
      St.project().dialogs.forEach((e, i) => {
        const c = St.dialogCounts[i];
        if (e !== St.cur() && c && (c.error || c.warn)) others.push({ e, i, c });
      });
      if (others.length) {
        wrap.appendChild(h('div', { class: 'fld-head' }, h('span', { class: 'fld-label' }, 'Other dialogs')));
        const box = h('div', { class: 'stack-s' });
        for (const o of others) box.appendChild(h('button', { type: 'button', class: 'btn', style: 'justify-content:flex-start', onclick: () => St.select(o.i) }, h('span', { class: 'mono' }, o.e.id), o.c.error ? h('span', { class: 'count err' }, o.c.error) : null, o.c.warn ? h('span', { class: 'count warn' }, o.c.warn) : null));
        wrap.appendChild(box);
      }
      const proj = (St.projectIssues || []).filter((p) => p.level !== 'info');
      if (proj.length) {
        wrap.appendChild(h('div', { class: 'fld-head' }, h('span', { class: 'fld-label' }, 'Pack')));
        const box = h('div', { class: 'stack-s' });
        for (const p of proj) box.appendChild(F.msgEl({ level: p.level, msg: p.msg }));
        wrap.appendChild(box);
      }
    }
    update();
    return { el: wrap, update };
  }
})();
