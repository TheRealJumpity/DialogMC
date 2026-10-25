/* Dialog MC — project state: undo/redo, autosave, share links, validation results. No DOM rendering here. */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const U = DMC.util;
  const SC = DMC.schema;
  const RLu = DMC.rl;
  const St = (DMC.store = {});

  const LS_KEY = 'dmc.project.v1';
  const HISTORY_MAX = 200;
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /* ------------------------------------------------------------------ *
   * Path helpers (dot paths into a JSON value; numbers index arrays)
   * ------------------------------------------------------------------ */
  function setPath(obj, path, value) {
    const keys = String(path).split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (cur[k] === null || typeof cur[k] !== 'object') cur[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      cur = cur[k];
    }
    const last = keys[keys.length - 1];
    if (value === undefined) {
      if (Array.isArray(cur)) cur.splice(+last, 1);
      else delete cur[last];
    } else cur[last] = value;
  }
  St.setPath = setPath;
  St.getPath = U.getPath;

  /* ------------------------------------------------------------------ *
   * Project model
   * ------------------------------------------------------------------ */
  function freshProject(version) {
    const first = SC.newDialog('multi_action');
    first.title = 'Main menu';
    first.body = [{ type: 'minecraft:plain_message', contents: 'Pick something to do.' }];
    first.actions = [
      { label: 'Help', tooltip: 'Opens the rules', action: { type: 'minecraft:show_dialog', dialog: 'my_pack:rules' } },
      { label: 'Website', action: { type: 'minecraft:open_url', url: 'https://www.minecraft.net' } },
    ];
    const rules = SC.newDialog('confirmation');
    rules.title = 'Server rules';
    rules.body = [{ type: 'minecraft:plain_message', contents: 'Be kind and have fun. Do you agree?' }];
    rules.yes = { label: { text: 'I agree', color: 'green' } };
    rules.no = { label: { text: 'Not now', color: 'red' } };
    return {
      version: version || DMC.ver.default,
      pack: { namespace: 'my_pack', description: 'Dialogs made with Dialog MC', range: false },
      dialogs: [
        { uid: U.uid(), id: 'main_menu', dialog: first, tags: { pause: false, quick: false, extra: [] } },
        { uid: U.uid(), id: 'rules', dialog: rules, tags: { pause: false, quick: false, extra: [] } },
      ],
    };
  }
  St.freshProject = freshProject;

  /** Make an arbitrary (possibly hand-written / imported) value into a well-formed project. */
  function sanitizeProject(p) {
    const out = { version: DMC.ver.byId[p && p.version] ? p.version : DMC.ver.default, pack: {}, dialogs: [] };
    const pk = (p && p.pack) || {};
    out.pack.namespace = typeof pk.namespace === 'string' && pk.namespace ? pk.namespace : 'my_pack';
    out.pack.description = typeof pk.description === 'string' ? pk.description : 'Dialogs made with Dialog MC';
    out.pack.range = !!pk.range;
    for (const e of (p && Array.isArray(p.dialogs) ? p.dialogs : [])) {
      if (!e || !isObj(e.dialog)) continue;
      const t = e.tags || {};
      out.dialogs.push({
        uid: typeof e.uid === 'string' ? e.uid : U.uid(),
        id: typeof e.id === 'string' && e.id ? e.id : 'dialog_' + (out.dialogs.length + 1),
        dialog: DMC.editor ? DMC.editor.normalize(e.dialog, 0) : e.dialog,
        tags: { pause: !!t.pause, quick: !!t.quick, extra: Array.isArray(t.extra) ? t.extra.filter((x) => typeof x === 'string') : [] },
      });
    }
    if (!out.dialogs.length) out.dialogs.push({ uid: U.uid(), id: 'main_menu', dialog: SC.newDialog('notice'), tags: { pause: false, quick: false, extra: [] } });
    return out;
  }

  let project = freshProject();
  const ui = (St.ui = { cur: 0, open: new Map(), tab: 'json', stage: null });
  St.project = () => project;
  St.version = () => project.version;
  St.fullId = (e) => project.pack.namespace + ':' + e.id;
  St.cur = () => project.dialogs[ui.cur] || project.dialogs[0];
  St.dialog = () => St.cur().dialog;
  St.get = (path) => (path === '' || path == null ? St.dialog() : U.getPath(St.dialog(), path));

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */
  const subs = {};
  St.on = function (type, fn) {
    (subs[type] = subs[type] || []).push(fn);
    return () => { subs[type] = subs[type].filter((f) => f !== fn); };
  };
  function emit(type, payload) {
    for (const fn of (subs[type] || []).slice()) {
      try { fn(payload); } catch (e) { console.error('[dmc] listener for ' + type + ' failed', e); }
    }
  }
  St.emit = emit;

  /* ------------------------------------------------------------------ *
   * History
   * ------------------------------------------------------------------ */
  let undoStack = [];
  let redoStack = [];
  let lastCoalesce = null;
  let lastTime = 0;
  const snapshot = () => JSON.stringify({ pack: project.pack, dialogs: project.dialogs, cur: ui.cur });

  function restore(json) {
    const s = JSON.parse(json);
    const ver = project.version;
    project = sanitizeProject({ version: ver, pack: s.pack, dialogs: s.dialogs });
    ui.cur = U.clamp(s.cur || 0, 0, project.dialogs.length - 1);
  }

  St.canUndo = () => undoStack.length > 0;
  St.canRedo = () => redoStack.length > 0;
  St.undo = function () {
    if (!undoStack.length) return false;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    lastCoalesce = null;
    afterChange({ structural: true, reason: 'undo', project: true });
    return true;
  };
  St.redo = function () {
    if (!redoStack.length) return false;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    lastCoalesce = null;
    afterChange({ structural: true, reason: 'redo', project: true });
    return true;
  };

  /**
   * Run `fn` as one undoable change.
   * opts: {structural, coalesce, reason, project (affects pack/ids/tags too)}
   */
  St.commit = function (fn, opts) {
    opts = opts || {};
    const now = Date.now();
    const same = opts.coalesce && opts.coalesce === lastCoalesce && now - lastTime < 1200 && undoStack.length;
    const before = same ? null : snapshot();
    const result = fn(St.dialog(), project);
    if (!same) {
      undoStack.push(before);
      if (undoStack.length > HISTORY_MAX) undoStack.shift();
      redoStack = [];
    }
    lastCoalesce = opts.coalesce || null;
    lastTime = now;
    afterChange(opts);
    return result;
  };

  function afterChange(opts) {
    scheduleSave();
    scheduleValidate();
    if (opts.project) emit('project', opts);
    emit(opts.structural ? 'structure' : 'value', opts);
  }

  /* convenient mutators (paths are relative to the current dialog) */
  St.set = (path, value, opts) => St.commit((d) => setPath(d, path, value), Object.assign({ coalesce: 'set:' + ui.cur + ':' + path }, opts));
  St.del = (path, opts) => St.commit((d) => setPath(d, path, undefined), Object.assign({ structural: true }, opts));
  St.insert = (path, index, value, opts) => St.commit((d) => {
    let arr = U.getPath(d, path);
    if (!Array.isArray(arr)) { setPath(d, path, []); arr = U.getPath(d, path); }
    arr.splice(index == null ? arr.length : index, 0, value);
  }, Object.assign({ structural: true }, opts));
  St.remove = (path, index, opts) => St.commit((d) => {
    const arr = U.getPath(d, path);
    if (Array.isArray(arr)) arr.splice(index, 1);
  }, Object.assign({ structural: true }, opts));
  St.move = (path, from, to, opts) => St.commit((d) => {
    const arr = U.getPath(d, path);
    if (!Array.isArray(arr) || to < 0 || to >= arr.length) return;
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
  }, Object.assign({ structural: true }, opts));

  /** Apply a validator quick-fix ({set:[{path,value}], del:[path], move:{from,to}}). */
  St.applyFix = function (fix) {
    St.commit((d) => {
      for (const s of fix.set || []) setPath(d, s.path, s.value);
      for (const p of fix.del || []) setPath(d, p, undefined);
      if (fix.move) {
        const v = U.getPath(d, fix.move.from);
        setPath(d, fix.move.from, undefined);
        setPath(d, fix.move.to, v);
      }
    }, { structural: true, reason: 'fix' });
  };

  /* ------------------------------------------------------------------ *
   * Open / collapsed state of editor entries (UI only, not undoable)
   * ------------------------------------------------------------------ */
  const okey = (path) => St.cur().uid + '|' + path;
  St.isOpen = (path, dflt) => (ui.open.has(okey(path)) ? ui.open.get(okey(path)) : !!dflt);
  St.setOpen = (path, v) => { ui.open.set(okey(path), !!v); };
  /** After an array entry moved, carry its open state with it. */
  St.moveOpen = function (base, from, to, len) {
    const pre = base ? base + '.' : '';
    const keys = [];
    for (const k of ui.open.keys()) if (k.startsWith(okey(pre))) keys.push(k);
    const idxOf = (k) => {
      const rest = k.slice(okey(pre).length);
      const m = /^(\d+)(.*)$/.exec(rest);
      return m ? { i: +m[1], tail: m[2] } : null;
    };
    const entries = keys.map((k) => ({ k, v: ui.open.get(k), p: idxOf(k) })).filter((x) => x.p);
    for (const x of entries) ui.open.delete(x.k);
    for (const x of entries) {
      let i = x.p.i;
      if (i === from) i = to;
      else if (from < to && i > from && i <= to) i -= 1;
      else if (from > to && i >= to && i < from) i += 1;
      ui.open.set(okey(pre + i + x.p.tail), x.v);
    }
    void len;
  };

  /* ------------------------------------------------------------------ *
   * Dialogs in the project
   * ------------------------------------------------------------------ */
  function uniqueId(base) {
    const ids = new Set(project.dialogs.map((e) => e.id));
    let id = base;
    let n = 2;
    while (ids.has(id)) id = base + '_' + n++;
    return id;
  }
  St.uniqueId = uniqueId;

  St.select = function (i) {
    i = U.clamp(i, 0, project.dialogs.length - 1);
    if (i === ui.cur) return;
    ui.cur = i;
    lastCoalesce = null;
    scheduleSave();
    scheduleValidate();
    emit('select', { index: i });
  };
  St.selectById = function (fullId) {
    const i = project.dialogs.findIndex((e) => St.fullId(e) === RLu.norm(fullId) || e.id === fullId);
    if (i >= 0) { St.select(i); return true; }
    return false;
  };

  St.addDialog = function (type, opts) {
    opts = opts || {};
    const dialog = opts.dialog || SC.newDialog(type || 'notice');
    const base = U.slug(opts.id || (typeof dialog.title === 'string' ? dialog.title : DMC.text.plain(dialog.title, project.version)), 'dialog');
    St.commit(() => {
      project.dialogs.push({ uid: U.uid(), id: uniqueId(base), dialog, tags: Object.assign({ pause: false, quick: false, extra: [] }, opts.tags || {}) });
      ui.cur = project.dialogs.length - 1;
    }, { structural: true, project: true, reason: 'add' });
    emit('select', { index: ui.cur });
    return project.dialogs[ui.cur];
  };
  St.duplicateDialog = function (i) {
    const src = project.dialogs[i];
    if (!src) return;
    St.commit(() => {
      project.dialogs.splice(i + 1, 0, { uid: U.uid(), id: uniqueId(src.id + '_copy'), dialog: U.clone(src.dialog), tags: U.clone(src.tags) });
      ui.cur = i + 1;
    }, { structural: true, project: true, reason: 'duplicate' });
    emit('select', { index: ui.cur });
  };
  St.removeDialog = function (i) {
    if (project.dialogs.length <= 1) return false;
    St.commit(() => {
      project.dialogs.splice(i, 1);
      ui.cur = U.clamp(ui.cur > i ? ui.cur - 1 : ui.cur, 0, project.dialogs.length - 1);
    }, { structural: true, project: true, reason: 'remove' });
    emit('select', { index: ui.cur });
    return true;
  };
  St.moveDialog = function (i, j) {
    if (j < 0 || j >= project.dialogs.length) return;
    St.commit(() => {
      const cur = St.cur();
      const [x] = project.dialogs.splice(i, 1);
      project.dialogs.splice(j, 0, x);
      ui.cur = project.dialogs.indexOf(cur);
    }, { structural: true, project: true, reason: 'move' });
  };
  St.setEntry = (i, patch) => St.commit(() => { Object.assign(project.dialogs[i], patch); }, { structural: false, project: true, coalesce: 'entry:' + i + ':' + Object.keys(patch).join(','), reason: 'entry' });
  St.setTags = (i, patch) => St.commit(() => { Object.assign(project.dialogs[i].tags, patch); }, { structural: false, project: true, coalesce: 'tags:' + i + ':' + Object.keys(patch).join(','), reason: 'tags' });
  St.setPack = (patch) => St.commit(() => { Object.assign(project.pack, patch); }, { structural: false, project: true, coalesce: 'pack:' + Object.keys(patch).join(','), reason: 'pack' });

  /** Change the pack namespace and keep show_dialog references to this pack's dialogs in sync. */
  St.setNamespace = function (ns) {
    const old = project.pack.namespace;
    if (ns === old) return;
    St.commit(() => {
      project.pack.namespace = ns;
      if (ns) {
        for (const e of project.dialogs) {
          for (const o of project.dialogs) rewriteRefs(o.dialog, old + ':' + e.id, ns + ':' + e.id);
        }
      }
    }, { structural: false, project: true, coalesce: 'pack:namespace', reason: 'pack' });
  };

  /** Rename a dialog and keep show_dialog references to it in sync. */
  St.renameDialog = function (i, newId) {
    const e = project.dialogs[i];
    const oldFull = St.fullId(e);
    const newFull = project.pack.namespace + ':' + newId;
    St.commit(() => {
      e.id = newId;
      for (const o of project.dialogs) rewriteRefs(o.dialog, oldFull, newFull);
    }, { structural: false, project: true, coalesce: 'rename:' + i, reason: 'rename' });
  };
  function rewriteRefs(node, from, to) {
    if (Array.isArray(node)) { node.forEach((x, i) => { if (x === from) node[i] = to; else rewriteRefs(x, from, to); }); return; }
    if (!isObj(node)) return;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string' && v === from && (k === 'dialog' || k === 'dialogs')) node[k] = to;
      else rewriteRefs(v, from, to);
    }
  }

  St.setVersion = function (v) {
    if (!DMC.ver.byId[v] || v === project.version) return;
    project.version = v;
    scheduleSave();
    scheduleValidate();
    emit('version', { version: v });
    emit('structure', { structural: true, reason: 'version' });
  };

  /** Replace the whole project (import / template / new). Undoable. */
  St.replaceProject = function (p, opts) {
    const next = sanitizeProject(Object.assign({}, p, { version: (opts && opts.keepVersion) === false ? p.version : project.version }));
    St.commit(() => {
      const ver = project.version;
      project = next;
      project.version = (opts && opts.version) || ver;
      ui.cur = 0;
    }, { structural: true, project: true, reason: 'replace' });
    emit('select', { index: 0 });
  };

  /** Add dialogs (e.g. from a template or an import) without touching the rest. Returns the first added index. */
  St.addMany = function (entries, opts) {
    opts = opts || {};
    const startIdx = project.dialogs.length;
    St.commit(() => {
      const map = new Map();
      // allocate ids first so show_dialog references can be rewritten
      const incoming = entries.map((e) => {
        const id = uniqueId(U.slug(e.id, 'dialog'));
        map.set(e.id, id);
        project.dialogs.push({ uid: U.uid(), id, dialog: e.dialog, tags: Object.assign({ pause: false, quick: false, extra: [] }, e.tags || {}) });
        return project.dialogs[project.dialogs.length - 1];
      });
      const ns = project.pack.namespace;
      for (const e of incoming) {
        for (const [from, to] of map) if (from !== to) rewriteRefs(e.dialog, ns + ':' + from, ns + ':' + to);
      }
      ui.cur = startIdx;
    }, { structural: true, project: true, reason: opts.reason || 'add-many' });
    emit('select', { index: startIdx });
    return startIdx;
  };

  /* ------------------------------------------------------------------ *
   * Dialog type conversion (keeps whatever carries over)
   * ------------------------------------------------------------------ */
  St.convert = function (d, newType) {
    const old = SC.bare(d.type);
    const out = {};
    const lost = [];
    const fresh = SC.newDialog(newType);
    const keep = SC.commonKeys.filter((k) => k !== 'type');
    out.type = 'minecraft:' + newType;
    for (const k of keep) if (d[k] !== undefined) out[k] = d[k];
    const btn = (b) => (isObj(b) ? b : undefined);
    const pool = []; // buttons that can seed the new type
    if (old === 'notice' && btn(d.action)) pool.push(d.action);
    if (old === 'confirmation') { if (btn(d.yes)) pool.push(d.yes); if (btn(d.no)) pool.push(d.no); }
    if (old === 'multi_action' && Array.isArray(d.actions)) pool.push(...d.actions.filter(isObj));
    switch (newType) {
      case 'notice':
        if (pool[0]) out.action = pool[0];
        break;
      case 'confirmation':
        out.yes = pool[0] || fresh.yes;
        out.no = pool[1] || fresh.no;
        break;
      case 'multi_action':
        out.actions = pool.length ? pool : fresh.actions;
        if (d.exit_action) out.exit_action = d.exit_action; else out.exit_action = fresh.exit_action;
        if (d.columns !== undefined) out.columns = d.columns;
        break;
      case 'server_links':
        out.exit_action = d.exit_action || fresh.exit_action;
        if (d.columns !== undefined) out.columns = d.columns;
        if (d.button_width !== undefined) out.button_width = d.button_width;
        break;
      case 'dialog_list':
        out.dialogs = old === 'dialog_list' && d.dialogs !== undefined ? d.dialogs : [];
        out.exit_action = d.exit_action || fresh.exit_action;
        if (d.columns !== undefined) out.columns = d.columns;
        if (d.button_width !== undefined) out.button_width = d.button_width;
        break;
      default: break;
    }
    for (const k of Object.keys(d)) if (k !== 'type' && out[k] === undefined && !SC.commonKeys.includes(k)) lost.push(k);
    if (old === 'multi_action' && Array.isArray(d.actions) && newType === 'notice' && d.actions.length > 1) lost.push((d.actions.length - 1) + ' extra button(s)');
    return { dialog: out, lost };
  };

  /* ------------------------------------------------------------------ *
   * Validation (debounced) — current dialog, per-dialog counts, both versions
   * ------------------------------------------------------------------ */
  St.issues = [];
  St.counts = { error: 0, warn: 0, info: 0 };
  St.dialogCounts = [];
  St.compat = {};
  St.projectIssues = [];
  let vTimer = null;

  St.knownIds = function () {
    const dialogIds = project.dialogs.map((e) => St.fullId(e));
    const tagIds = [];
    for (const e of project.dialogs) {
      const t = e.tags || {};
      if (t.pause) tagIds.push('#minecraft:pause_screen_additions');
      if (t.quick) tagIds.push('#minecraft:quick_actions');
      for (const x of t.extra || []) tagIds.push('#' + RLu.norm(x));
    }
    return { dialogIds, tagIds };
  };

  function runValidation() {
    const { dialogIds, tagIds } = St.knownIds();
    const ver = project.version;
    const cur = St.cur();
    const res = DMC.validate.dialog(cur.dialog, { ver, dialogIds, tagIds });
    St.issues = res.issues;
    St.counts = res.counts;
    St.dialogCounts = project.dialogs.map((e) => (e === cur ? res.counts : DMC.validate.dialog(e.dialog, { ver, dialogIds, tagIds }).counts));
    const compat = {};
    for (const v of DMC.ver.list) {
      let errors = 0;
      let warns = 0;
      for (const e of project.dialogs) {
        const c = v.id === ver && e === cur ? res.counts : DMC.validate.dialog(e.dialog, { ver: v.id, dialogIds, tagIds }).counts;
        errors += c.error;
        warns += c.warn;
      }
      compat[v.id] = { errors, warns };
    }
    St.compat = compat;
    St.projectIssues = projectIssues();
    emit('issues', res);
  }
  St.revalidate = runValidation;
  function scheduleValidate() {
    clearTimeout(vTimer);
    vTimer = setTimeout(runValidation, 110);
  }

  function projectIssues() {
    const out = [];
    const nsBad = DMC.validate.id(project.pack.namespace, 'x').filter((m) => m.startsWith('Namespace'));
    if (nsBad.length) out.push({ level: 'error', where: 'pack', msg: nsBad[0] });
    const seen = new Map();
    project.dialogs.forEach((e, i) => {
      const bad = DMC.validate.id('x', e.id).filter((m) => m.startsWith('Dialog name'));
      if (bad.length) out.push({ level: 'error', where: 'dialog:' + i, msg: '“' + e.id + '”: ' + bad[0] });
      if (seen.has(e.id)) out.push({ level: 'error', where: 'dialog:' + i, msg: 'Two dialogs share the id “' + e.id + '”.' });
      seen.set(e.id, i);
      for (const x of (e.tags && e.tags.extra) || []) {
        if (!RLu.isValid(x)) out.push({ level: 'error', where: 'dialog:' + i, msg: 'Tag “' + x + '” is not a valid id.' });
      }
    });
    if (project.pack.range) {
      out.push({ level: 'info', where: 'pack', msg: 'The pack declares support for both versions (data pack format ' + DMC.ver.fmt(DMC.ver.list[0].dataFormat) + ' – ' + DMC.ver.fmt(DMC.ver.list[DMC.ver.list.length - 1].dataFormat) + '). Make sure every dialog works in both — see the badges at the top.' });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Persistence
   * ------------------------------------------------------------------ */
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 350);
  }
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, project, cur: ui.cur }));
    } catch (e) { /* storage may be unavailable (private mode, quota) — the editor still works */ }
  }
  St.saveNow = save;

  St.loadSaved = function () {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s || !s.project) return false;
      project = sanitizeProject(s.project);
      ui.cur = U.clamp(s.cur || 0, 0, project.dialogs.length - 1);
      return true;
    } catch (e) {
      return false;
    }
  };

  St.reset = function () {
    St.commit(() => { project = freshProject(project.version); ui.cur = 0; }, { structural: true, project: true, reason: 'reset' });
    emit('select', { index: 0 });
  };

  /* ------------------------------------------------------------------ *
   * Share links (#p=...) — deflate-raw when the browser supports it
   * ------------------------------------------------------------------ */
  const b64u = {
    enc(bytes) {
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    dec(str) {
      const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    },
  };
  async function pipe(bytes, stream) {
    const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }
  St.shareHash = async function () {
    const json = JSON.stringify({ v: 1, pack: project.pack, dialogs: project.dialogs.map((e) => ({ id: e.id, dialog: e.dialog, tags: e.tags })), version: project.version });
    const bytes = new TextEncoder().encode(json);
    if (typeof CompressionStream !== 'undefined') {
      try { return '#p=z.' + b64u.enc(await pipe(bytes, new CompressionStream('deflate-raw'))); } catch (e) { /* fall back */ }
    }
    return '#p=r.' + b64u.enc(bytes);
  };
  St.loadHash = async function (hash) {
    const m = /^#p=([zr])\.(.+)$/.exec(hash || '');
    if (!m) return false;
    try {
      let bytes = b64u.dec(m[2]);
      if (m[1] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
      const s = JSON.parse(new TextDecoder().decode(bytes));
      project = sanitizeProject(s);
      ui.cur = 0;
      return true;
    } catch (e) {
      return false;
    }
  };

  St.exportProject = () => JSON.stringify({ app: 'dialog-mc', v: 1, version: project.version, pack: project.pack, dialogs: project.dialogs.map((e) => ({ id: e.id, dialog: e.dialog, tags: e.tags })) }, null, 2);
  St.importProject = function (text) {
    try {
      const s = JSON.parse(text);
      if (s && s.app === 'dialog-mc' && Array.isArray(s.dialogs)) return { ok: true, project: s };
    } catch (e) { /* not a project file */ }
    return { ok: false };
  };

  St.init = function () {
    runValidation();
  };
})();
