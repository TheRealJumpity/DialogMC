/* Dialog MC — exporters: canonical JSON, SNBT /dialog command, tellraw opener, data pack files, ZIP, import. No DOM. */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const X = (DMC.exp = {});
  const S = DMC.schema;
  const RLu = DMC.rl;

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /* ------------------------------------------------------------------ *
   * Canonical form: tidy key order, namespaced type ids, no empty junk
   * ------------------------------------------------------------------ */
  const ORDER = [
    'type', 'key', 'title', 'external_title', 'body', 'inputs', 'can_close_with_escape', 'pause', 'after_action',
    'action', 'yes', 'no', 'actions', 'columns', 'button_width', 'dialogs', 'exit_action',
    'label', 'tooltip', 'width', 'height', 'label_visible', 'contents', 'item', 'id', 'count', 'components', 'description',
    'show_decorations', 'show_tooltip', 'initial', 'max_length', 'multiline', 'max_lines', 'on_true', 'on_false',
    'options', 'display', 'start', 'end', 'step', 'label_format',
    'text', 'translate', 'fallback', 'with', 'keybind', 'score', 'name', 'objective', 'selector', 'separator', 'nbt',
    'source', 'block', 'entity', 'storage', 'interpret', 'plain', 'object', 'atlas', 'sprite', 'player', 'hat', 'texture', 'cape', 'elytra', 'model', 'properties',
    'color', 'bold', 'italic', 'underlined', 'strikethrough', 'obfuscated', 'font', 'shadow_color', 'insertion', 'extra',
    'click_event', 'hover_event', 'command', 'url', 'value', 'page', 'dialog', 'payload', 'template', 'additions', 'uuid',
  ];
  const RANK = Object.fromEntries(ORDER.map((k, i) => [k, i]));
  const BUTTON_ORDER = ['label', 'tooltip', 'width', 'action'];
  function ordered(o, custom) {
    const keys = Object.keys(o).filter((k) => o[k] !== undefined);
    const rank = (k) => {
      if (custom) {
        const i = custom.indexOf(k);
        if (i >= 0) return i;
        return 500 + (RANK[k] ?? 999);
      }
      return RANK[k] ?? 999;
    };
    keys.sort((a, b) => rank(a) - rank(b));
    const out = {};
    for (const k of keys) out[k] = o[k];
    return out;
  }
  const ns = (t) => (typeof t === 'string' ? (t.includes(':') ? t : 'minecraft:' + t) : t);

  function canonText(v) {
    if (Array.isArray(v)) return v.map(canonText);
    if (!isObj(v)) return v;
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) continue;
      if (k === 'extra' || k === 'with' || k === 'separator' || k === 'fallback') o[k] = canonText(val);
      else if (k === 'click_event' && isObj(val)) o[k] = canonAction(val, 'text');
      else if (k === 'hover_event' && isObj(val)) {
        const h = Object.assign({}, val);
        if (h.value !== undefined) h.value = canonText(h.value);
        if (h.name !== undefined) h.name = canonText(h.name);
        if (h.components !== undefined) h.components = canonComponents(h.components);
        o[k] = ordered(h);
      } else o[k] = val;
    }
    return ordered(o);
  }
  function canonComponents(c) {
    if (!isObj(c)) return c;
    const o = {};
    for (const [k, v] of Object.entries(c)) o[k] = k.replace(/^!/, '') === 'minecraft:custom_name' || k.replace(/^!/, '') === 'minecraft:item_name' ? canonText(v) : v;
    return o;
  }
  function canonItem(it) {
    if (!isObj(it)) return it;
    const o = Object.assign({}, it);
    if (o.components !== undefined) {
      o.components = canonComponents(o.components);
      if (isObj(o.components) && !Object.keys(o.components).length) delete o.components;
    }
    return ordered(o);
  }
  function canonAction(a, mode) {
    if (!isObj(a)) return a;
    const o = Object.assign({}, a);
    if (mode !== 'text' && typeof o.type === 'string') o.type = ns(o.type);
    if (o.dialog !== undefined && isObj(o.dialog)) o.dialog = canonDialog(o.dialog);
    return ordered(o);
  }
  function canonButton(b) {
    if (!isObj(b)) return b;
    const o = Object.assign({}, b);
    if (o.label !== undefined) o.label = canonText(o.label);
    if (o.tooltip !== undefined) o.tooltip = canonText(o.tooltip);
    if (o.action !== undefined) o.action = canonAction(o.action, 'dialog');
    return ordered(o, BUTTON_ORDER);
  }
  function canonBody(b) {
    if (!isObj(b)) return b;
    const o = Object.assign({}, b);
    if (typeof o.type === 'string') o.type = ns(o.type);
    if (o.contents !== undefined) o.contents = canonText(o.contents);
    if (o.item !== undefined) o.item = canonItem(o.item);
    if (o.description !== undefined) {
      const d = o.description;
      o.description = isObj(d) && 'contents' in d ? ordered(Object.assign({}, d, { contents: canonText(d.contents) })) : canonText(d);
    }
    return ordered(o);
  }
  function canonInput(i) {
    if (!isObj(i)) return i;
    const o = Object.assign({}, i);
    if (typeof o.type === 'string') o.type = ns(o.type);
    if (o.label !== undefined) o.label = canonText(o.label);
    if (Array.isArray(o.options)) {
      o.options = o.options.map((op) => {
        if (!isObj(op)) return op;
        const p = Object.assign({}, op);
        if (p.display !== undefined) p.display = canonText(p.display);
        return ordered(p);
      });
    }
    if (isObj(o.multiline)) o.multiline = ordered(o.multiline);
    return ordered(o);
  }
  function canonDialog(d) {
    if (!isObj(d)) return d;
    const o = Object.assign({}, d);
    if (typeof o.type === 'string') o.type = ns(o.type);
    if (o.title !== undefined) o.title = canonText(o.title);
    if (o.external_title !== undefined) o.external_title = canonText(o.external_title);
    if (o.body !== undefined) {
      const arr = Array.isArray(o.body) ? o.body : [o.body];
      if (!arr.length) delete o.body;
      else if (arr.length === 1) o.body = canonBody(arr[0]);
      else o.body = arr.map(canonBody);
    }
    if (Array.isArray(o.inputs)) {
      if (!o.inputs.length) delete o.inputs;
      else o.inputs = o.inputs.map(canonInput);
    }
    for (const k of ['action', 'yes', 'no', 'exit_action']) if (o[k] !== undefined) o[k] = canonButton(o[k]);
    if (Array.isArray(o.actions)) o.actions = o.actions.map(canonButton);
    if (o.dialogs !== undefined) {
      if (Array.isArray(o.dialogs)) o.dialogs = o.dialogs.map((x) => (isObj(x) ? canonDialog(x) : x));
      else if (isObj(o.dialogs)) o.dialogs = canonDialog(o.dialogs);
    }
    return ordered(o);
  }
  X.canonical = canonDialog;

  /* ------------------------------------------------------------------ *
   * Text outputs
   * ------------------------------------------------------------------ */
  X.json = (dialog, opts) => JSON.stringify(canonDialog(dialog), null, (opts && opts.indent) != null ? opts.indent : 2);
  X.jsonMin = (dialog) => JSON.stringify(canonDialog(dialog));
  X.snbt = (dialog, opts) => DMC.snbt.stringify(canonDialog(dialog), opts);

  /** `/dialog show <target> <snbt>` */
  X.command = function (dialog, target, opts) {
    opts = opts || {};
    const slash = opts.slash === false ? '' : '/';
    return slash + 'dialog show ' + (target || '@s') + ' ' + X.snbt(dialog);
  };
  X.commandForId = (id, target, opts) => ((opts && opts.slash === false) ? '' : '/') + 'dialog show ' + (target || '@s') + ' ' + id;

  /** A /tellraw that prints a clickable link opening the dialog. */
  X.tellraw = function (id, label, color, target, opts) {
    const comp = { text: label || '[Open menu]', color: color || 'aqua', click_event: { action: 'show_dialog', dialog: id } };
    return ((opts && opts.slash === false) ? '' : '/') + 'tellraw ' + (target || '@s') + ' ' + JSON.stringify(canonText(comp));
  };

  /* ------------------------------------------------------------------ *
   * Project -> data pack files
   * ------------------------------------------------------------------ */
  X.fullId = (project, entry) => project.pack.namespace + ':' + entry.id;

  /**
   * @param {{version:string, pack:{namespace:string,description:string,range?:boolean}, dialogs:Array<{id:string,dialog:object,tags?:{pause?:boolean,quick?:boolean,extra?:string[]}}>}} project
   * @param {{functions?:boolean}} [opts]
   * @returns {Array<{path:string, data:string}>}
   */
  X.datapackFiles = function (project, opts) {
    opts = opts || {};
    const ns = project.pack.namespace;
    const v = DMC.ver.byId[project.version];
    const files = [];
    const range = project.pack.range;
    const minFmt = range ? DMC.ver.list[0].dataFormat : v.dataFormat;
    const maxFmt = range ? DMC.ver.list[DMC.ver.list.length - 1].dataFormat : v.dataFormat;
    files.push({
      path: 'pack.mcmeta',
      data: JSON.stringify({ pack: { description: project.pack.description || 'Dialogs made with Dialog MC', min_format: minFmt, max_format: maxFmt } }, null, 2) + '\n',
    });
    const tags = {};
    for (const e of project.dialogs) {
      files.push({ path: `data/${ns}/dialog/${e.id}.json`, data: X.json(e.dialog) + '\n' });
      const full = X.fullId(project, e);
      const t = e.tags || {};
      if (t.pause) (tags['minecraft:pause_screen_additions'] = tags['minecraft:pause_screen_additions'] || []).push(full);
      if (t.quick) (tags['minecraft:quick_actions'] = tags['minecraft:quick_actions'] || []).push(full);
      for (const x of t.extra || []) (tags[RLu.norm(x)] = tags[RLu.norm(x)] || []).push(full);
      if (opts.functions) {
        files.push({ path: `data/${ns}/function/show/${e.id}.mcfunction`, data: `dialog show @s ${full}\n` });
      }
    }
    for (const [tag, values] of Object.entries(tags)) {
      const [tns, tpath] = RLu.split(tag);
      files.push({ path: `data/${tns}/tags/dialog/${tpath}.json`, data: JSON.stringify({ values }, null, 2) + '\n' });
    }
    return files;
  };

  /* ------------------------------------------------------------------ *
   * ZIP (store, no compression)
   * ------------------------------------------------------------------ */
  let CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  X.crc32 = crc32;
  const enc = (s) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : Uint8Array.from(Buffer.from(s, 'utf8')));

  /** @param {Array<{path:string,data:string|Uint8Array}>} files @returns {Uint8Array} */
  X.zip = function (files) {
    const now = new Date();
    const dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() / 2) & 31);
    const dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);
    const chunks = [];
    const central = [];
    let offset = 0;
    const u16 = (n) => [n & 255, (n >>> 8) & 255];
    const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    for (const f of files) {
      const name = enc(f.path);
      const data = typeof f.data === 'string' ? enc(f.data) : f.data;
      const crc = crc32(data);
      const local = Uint8Array.from([
        ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
      ]);
      chunks.push(local, name, data);
      central.push({ name, crc, size: data.length, offset });
      offset += local.length + name.length + data.length;
    }
    const cdStart = offset;
    for (const c of central) {
      const rec = Uint8Array.from([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
        ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset),
      ]);
      chunks.push(rec, c.name);
      offset += rec.length + c.name.length;
    }
    const cdSize = offset - cdStart;
    chunks.push(Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(cdSize), ...u32(cdStart), ...u16(0)]));
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  };

  /* ------------------------------------------------------------------ *
   * Import: JSON, SNBT or a /dialog show command
   * ------------------------------------------------------------------ */
  X.importText = function (text) {
    let t = String(text || '').trim();
    if (!t) return { ok: false, error: 'Nothing to import.' };
    let source = 'json';
    const m = /^\/?dialog\s+show\s+/i.exec(t);
    if (m) {
      source = 'command';
      t = t.slice(m[0].length);
      // skip the target selector (may contain [..] with spaces)
      let i = 0;
      let depth = 0;
      while (i < t.length && (depth > 0 || t[i] !== ' ')) {
        if (t[i] === '[') depth++;
        else if (t[i] === ']') depth--;
        i++;
      }
      t = t.slice(i).trim();
      if (!t) return { ok: false, error: 'The command has no dialog after the target.' };
      if (!t.startsWith('{')) return { ok: true, id: t, source };
    }
    const r = DMC.snbt.parseLoose(t);
    if (!r.ok) return { ok: false, error: 'Could not read this as JSON or SNBT: ' + r.error.message + ' (at character ' + (r.error.pos + 1) + ')' };
    if (m === null && r.format === 'snbt') source = 'snbt';
    if (!isObj(r.value)) return { ok: false, error: 'A dialog is an object { … }.' };
    return { ok: true, dialog: r.value, source };
  };
})();
