/* Dialog MC — version profiles + data accessors (registries, language, keybinds). No DOM. */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const D = window.DMC_DATA;

  /* ------------------------------------------------------------------ *
   * Versions
   * ------------------------------------------------------------------ */
  const V = (DMC.ver = {});
  V.list = [
    { id: '1.21.11', label: '1.21.11', released: '2025-12-09', dataFormat: [94, 1], resFormat: [75, 0] },
    { id: '26.2', label: '26.2', released: '2026-06-16', dataFormat: [107, 1], resFormat: [88, 0] },
  ];
  V.byId = Object.fromEntries(V.list.map((v) => [v.id, v]));
  V.default = '26.2';
  // Ordering used by "since" checks. 26.1 never ships separately in this tool (it sits between).
  const ORDER = ['1.21.11', '26.1', '26.2', '26.3'];
  V.since = (ver, since) => ORDER.indexOf(ver) >= ORDER.indexOf(since);
  V.fmt = (f) => f[0] + '.' + f[1];

  /** Feature flags, each tied to the version it first appears in (from vanilla-mcdoc `since` markers). */
  V.has = {
    itemStringForm: (ver) => V.since(ver, '26.1'),   // body.item.item may be a bare "minecraft:id" string
    objectFallback: (ver) => V.since(ver, '26.1'),   // `fallback` on sprite/player-head text components
    nbtPlain: (ver) => V.since(ver, '26.1'),         // `plain` on nbt text components
    teamColorArg: (ver) => V.since(ver, '26.2'),     // /team modify color uses lowercase-only argument
  };

  /* ------------------------------------------------------------------ *
   * Resource locations
   * ------------------------------------------------------------------ */
  const RL = (DMC.rl = {});
  RL.RE = /^(?:[a-z0-9_.-]+:)?[a-z0-9_.\-/]+$/;
  RL.NS_RE = /^[a-z0-9_.-]+$/;
  RL.PATH_RE = /^[a-z0-9_.\-/]+$/;
  RL.norm = (s) => (s.includes(':') ? s : 'minecraft:' + s);
  RL.bare = (s) => (s.startsWith('minecraft:') ? s.slice(10) : s);
  RL.isValid = (s) => typeof s === 'string' && RL.RE.test(s);
  RL.split = (s) => {
    const i = s.indexOf(':');
    return i < 0 ? ['minecraft', s] : [s.slice(0, i), s.slice(i + 1)];
  };

  /* ------------------------------------------------------------------ *
   * Registries
   * ------------------------------------------------------------------ */
  const R = D.registry;
  const reg = (DMC.reg = {});
  reg.kinds = Object.keys(R.lists);
  const listCache = {};
  const setCache = {};
  const addedSets = {};

  function addedFor(kind) {
    if (!addedSets[kind]) {
      const m = {};
      for (const [ver, byKind] of Object.entries(R.added)) for (const id of byKind[kind] || []) m[id] = ver;
      addedSets[kind] = m;
    }
    return addedSets[kind];
  }

  reg.list = function (kind, ver) {
    const key = kind + '@' + ver;
    if (!listCache[key]) {
      let arr = (R.lists[kind] || []).slice();
      if (ver !== R.base) {
        const add = (R.added[ver] && R.added[ver][kind]) || [];
        arr = arr.concat(add);
      } else {
        // base list already includes everything that exists in the base version only
      }
      // R.lists holds the *base* version entries; versions above base add `added[ver]`.
      listCache[key] = arr.sort();
    }
    return listCache[key];
  };
  reg.set = function (kind, ver) {
    const key = kind + '@' + ver;
    if (!setCache[key]) setCache[key] = new Set(reg.list(kind, ver));
    return setCache[key];
  };
  /** Version in which `id` first appeared if newer than the base version, else null. */
  reg.addedIn = (kind, id) => addedFor(kind)[RL.bare(id)] || null;
  /**
   * Check a resource location against a registry.
   * status: ok | unknown-ns (custom namespace, can't verify) | missing | newer (exists only in a later version)
   */
  reg.check = function (kind, rl, ver) {
    if (typeof rl !== 'string' || !RL.isValid(rl)) return { status: 'invalid' };
    const [ns, path] = RL.split(rl);
    if (ns !== 'minecraft') return { status: 'unknown-ns' };
    if (reg.set(kind, ver).has(path)) return { status: 'ok' };
    const since = reg.addedIn(kind, path);
    if (since && since !== ver) return { status: 'newer', since };
    return { status: 'missing' };
  };

  const stackMap = {};
  for (const [size, ids] of Object.entries(R.maxStack)) for (const id of ids) stackMap[id] = +size;
  const damageSet = new Set(R.damageable);
  reg.maxStack = (id) => stackMap[RL.bare(id)] || 64;
  reg.isDamageable = (id) => damageSet.has(RL.bare(id));

  /** Closest registry ids for a "did you mean" hint. */
  reg.suggest = function (kind, id, ver, max) {
    const bare = RL.bare(id);
    const list = reg.list(kind, ver);
    const contains = list.filter((x) => x.includes(bare)).slice(0, max || 3);
    if (contains.length) return contains;
    const best = DMC.util && DMC.util.closest ? DMC.util.closest(bare, list) : null;
    return best ? [best] : [];
  };

  /* ------------------------------------------------------------------ *
   * Vanilla dialog ids / tags that always exist
   * ------------------------------------------------------------------ */
  DMC.vanillaDialogs = ['minecraft:custom_options', 'minecraft:quick_actions', 'minecraft:server_links'];
  DMC.vanillaDialogTags = ['#minecraft:pause_screen_additions', '#minecraft:quick_actions'];

  /* ------------------------------------------------------------------ *
   * Language (en_us subset)
   * ------------------------------------------------------------------ */
  const L = D.lang;
  const lang = (DMC.lang = {});
  const langCache = {};
  function langMap(ver) {
    if (!langCache[ver]) {
      const m = Object.assign({}, L.base);
      if (L.old[ver]) Object.assign(m, L.old[ver]);
      if (L.added[ver]) Object.assign(m, L.added[ver]);
      langCache[ver] = m;
    }
    return langCache[ver];
  }
  lang.map = langMap;
  lang.has = (key, ver) => Object.prototype.hasOwnProperty.call(langMap(ver), key);
  lang.get = (key, ver) => langMap(ver)[key];
  lang.keys = (ver) => Object.keys(langMap(ver));
  /** Substitute %s / %d / %1$s / %% like Java's String.format as Minecraft uses it. */
  lang.format = function (template, args) {
    args = args || [];
    let next = 0;
    return String(template).replace(/%(?:(\d+)\$)?([sd%])/g, (m, pos, kind) => {
      if (kind === '%') return '%';
      const idx = pos ? parseInt(pos, 10) - 1 : next++;
      const v = args[idx];
      return v == null ? '' : String(v);
    });
  };
  lang.resolve = function (key, ver, args, fallback) {
    const t = lang.get(key, ver);
    if (t == null) return fallback != null ? lang.format(fallback, args) : key;
    return lang.format(t, args);
  };
  /** Search translation keys by key or English value. */
  lang.search = function (q, ver, limit) {
    q = String(q || '').toLowerCase().trim();
    const m = langMap(ver);
    const out = [];
    const keys = Object.keys(m);
    if (!q) return keys.slice(0, limit || 60).map((k) => ({ key: k, value: m[k] }));
    const terms = q.split(/\s+/);
    for (const k of keys) {
      const hay = (k + ' ' + m[k]).toLowerCase();
      if (terms.every((t) => hay.includes(t))) {
        out.push({ key: k, value: m[k] });
        if (out.length >= (limit || 60)) break;
      }
    }
    return out;
  };

  /* ------------------------------------------------------------------ *
   * Keybinds
   * ------------------------------------------------------------------ */
  const keys = (DMC.keys = {});
  keys.list = (ver) => {
    const add = (R.keybinds.added && R.keybinds.added[ver]) || [];
    return R.keybinds.base.concat(add).sort();
  };
  keys.addedIn = (k) => {
    for (const [ver, arr] of Object.entries(R.keybinds.added || {})) if (arr.includes(k)) return ver;
    return null;
  };
  keys.has = (k, ver) => keys.list(ver).includes(k);
  // Default bindings shown in the preview (what a player with default controls would see).
  keys.defaults = {
    'key.attack': 'Left Button', 'key.use': 'Right Button', 'key.pickItem': 'Middle Button',
    'key.forward': 'W', 'key.left': 'A', 'key.back': 'S', 'key.right': 'D', 'key.jump': 'Space',
    'key.sneak': 'Left Shift', 'key.sprint': 'Left Control', 'key.drop': 'Q', 'key.inventory': 'E',
    'key.swapOffhand': 'F', 'key.chat': 'T', 'key.command': '/', 'key.playerlist': 'Tab',
    'key.screenshot': 'F2', 'key.togglePerspective': 'F5', 'key.fullscreen': 'F11', 'key.advancements': 'L',
    'key.saveToolbarActivator': 'C', 'key.loadToolbarActivator': 'X', 'key.quickActions': 'G',
    'key.toggleGui': 'F1', 'key.friends': 'O',
    'key.hotbar.1': '1', 'key.hotbar.2': '2', 'key.hotbar.3': '3', 'key.hotbar.4': '4', 'key.hotbar.5': '5',
    'key.hotbar.6': '6', 'key.hotbar.7': '7', 'key.hotbar.8': '8', 'key.hotbar.9': '9',
  };

  /* ------------------------------------------------------------------ *
   * Components (item data components)
   * ------------------------------------------------------------------ */
  reg.components = (ver) => reg.list('components', ver);
})();
