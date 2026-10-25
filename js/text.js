/* Dialog MC — text component helpers (normalize, flatten, colors). No DOM. */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const T = (DMC.text = {});

  /* ------------------------------------------------------------------ *
   * Colors
   * ------------------------------------------------------------------ */
  T.COLORS = {
    black: '#000000', dark_blue: '#0000AA', dark_green: '#00AA00', dark_aqua: '#00AAAA',
    dark_red: '#AA0000', dark_purple: '#AA00AA', gold: '#FFAA00', gray: '#AAAAAA',
    dark_gray: '#555555', blue: '#5555FF', green: '#55FF55', aqua: '#55FFFF',
    red: '#FF5555', light_purple: '#FF55FF', yellow: '#FFFF55', white: '#FFFFFF',
  };
  T.COLOR_NAMES = Object.keys(T.COLORS);
  T.HEX_RE = /^#[0-9a-fA-F]{6}$/;
  T.FLAGS = ['bold', 'italic', 'underlined', 'strikethrough', 'obfuscated'];

  T.colorToCss = function (c) {
    if (typeof c !== 'string') return null;
    if (T.COLORS[c]) return T.COLORS[c];
    if (T.HEX_RE.test(c)) return c;
    return null;
  };

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  T.hexToRgb = hexToRgb;
  T.rgbToHex = (r, g, b) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();

  /** Signed/unsigned 32-bit ARGB int, or [r,g,b,a] floats (0..1) -> {r,g,b,a(0..1)} */
  T.argbDecode = function (v) {
    if (Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === 'number')) {
      return { r: Math.round(v[0] * 255), g: Math.round(v[1] * 255), b: Math.round(v[2] * 255), a: v[3] };
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      const u = v >>> 0;
      return { r: (u >> 16) & 255, g: (u >> 8) & 255, b: u & 255, a: ((u >>> 24) & 255) / 255 };
    }
    return null;
  };
  /** {hex:'#RRGGBB', alpha:0..1} -> signed 32-bit ARGB int */
  T.argbEncode = function (hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    const a = Math.round(Math.max(0, Math.min(1, alpha == null ? 1 : alpha)) * 255);
    return ((a << 24) | (r << 16) | (g << 8) | b) | 0;
  };
  T.argbToCss = function (v) {
    const c = T.argbDecode(v);
    return c ? `rgba(${c.r},${c.g},${c.b},${+c.a.toFixed(3)})` : null;
  };
  /** Minecraft draws text shadows at 25% brightness of the text color. */
  T.shadowOf = function (css) {
    const hex = T.colorToCss(css) || css;
    if (!hex || !T.HEX_RE.test(hex)) return '#3F3F3F';
    const [r, g, b] = hexToRgb(hex).map((x) => Math.floor(x * 0.25));
    return T.rgbToHex(r, g, b);
  };

  /* ------------------------------------------------------------------ *
   * Component kinds
   * ------------------------------------------------------------------ */
  T.KINDS = [
    { id: 'text', label: 'Text', hint: 'Plain text you type' },
    { id: 'translatable', label: 'Translation', hint: 'A language key, e.g. gui.ok' },
    { id: 'keybind', label: 'Keybind', hint: "Shows the player's key for an action" },
    { id: 'sprite', label: 'Item / block sprite', hint: 'Inline icon from a texture atlas (1.21.9+)' },
    { id: 'head', label: 'Player head', hint: "Inline player face (1.21.9+)" },
    { id: 'score', label: 'Score', hint: 'Scoreboard value (not resolved in dialogs)' },
    { id: 'selector', label: 'Player / entity', hint: 'Entity selector (not resolved in dialogs)' },
    { id: 'nbt', label: 'NBT data', hint: 'Block / entity / storage data (not resolved in dialogs)' },
  ];
  T.kindLabel = (id) => (T.KINDS.find((k) => k.id === id) || { label: id }).label;

  T.kindOf = function (c) {
    if (typeof c === 'string') return 'text';
    if (!c || typeof c !== 'object' || Array.isArray(c)) return 'unknown';
    switch (c.type) {
      case 'text': return 'text';
      case 'translatable': return 'translatable';
      case 'score': return 'score';
      case 'selector': return 'selector';
      case 'keybind': return 'keybind';
      case 'nbt': return 'nbt';
      case 'object': return c.object === 'player' || (c.player !== undefined && c.sprite === undefined) ? 'head' : 'sprite';
      default: break;
    }
    if ('text' in c) return 'text';
    if ('translate' in c) return 'translatable';
    if ('score' in c) return 'score';
    if ('selector' in c) return 'selector';
    if ('keybind' in c) return 'keybind';
    if ('nbt' in c) return 'nbt';
    if ('sprite' in c) return 'sprite';
    if ('player' in c) return 'head';
    return 'unknown';
  };

  T.make = function (kind) {
    switch (kind) {
      case 'text': return { text: '' };
      case 'translatable': return { translate: 'gui.ok' };
      case 'keybind': return { keybind: 'key.jump' };
      case 'score': return { score: { name: '@p', objective: 'objective' } };
      case 'selector': return { selector: '@p' };
      case 'nbt': return { nbt: 'path', source: 'storage', storage: 'minecraft:example' };
      case 'sprite': return { type: 'object', object: 'atlas', sprite: 'item/diamond' };
      case 'head': return { type: 'object', object: 'player', player: { name: 'Steve' }, hat: true };
      default: return { text: '' };
    }
  };

  /** Keys that carry the content of a component (everything else is style/children). */
  const CONTENT_KEYS = ['text', 'translate', 'fallback', 'with', 'score', 'selector', 'separator', 'keybind', 'nbt', 'source', 'block', 'entity', 'storage', 'interpret', 'plain', 'type', 'object', 'atlas', 'sprite', 'player', 'hat'];
  const STYLE_KEYS = ['color', 'bold', 'italic', 'underlined', 'strikethrough', 'obfuscated', 'font', 'shadow_color', 'insertion', 'click_event', 'hover_event'];
  T.STYLE_KEYS = STYLE_KEYS;
  T.CONTENT_KEYS = CONTENT_KEYS;

  /* ------------------------------------------------------------------ *
   * Normalization: Text value <-> list of "parts"
   * ------------------------------------------------------------------ */
  function isEmptyPlain(c) {
    if (c === '') return true;
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      const keys = Object.keys(c).filter((k) => c[k] !== undefined);
      return keys.length === 1 && keys[0] === 'text' && c.text === '';
    }
    return false;
  }

  /** Any component form -> one component object ({text:..} for strings; arrays merged first+extras). */
  T.normPart = function normPart(c) {
    if (typeof c === 'string') return { text: c };
    if (typeof c === 'number' || typeof c === 'boolean') return { text: String(c) };
    if (Array.isArray(c)) {
      if (!c.length) return { text: '' };
      const first = normPart(c[0]);
      const rest = c.slice(1);
      if (!rest.length) return first;
      return Object.assign({}, first, { extra: (first.extra || []).concat(rest) });
    }
    if (c && typeof c === 'object') return c;
    return { text: '' };
  };

  /** Component object -> string when it only has `text`. */
  T.simplifyPart = function simplifyPart(p) {
    if (p && typeof p === 'object') {
      const keys = Object.keys(p).filter((k) => p[k] !== undefined);
      if (keys.length === 1 && keys[0] === 'text' && typeof p.text === 'string') return p.text;
    }
    return p;
  };

  /** Root Text value -> flat list of sibling parts (semantics preserved). */
  T.toParts = function toParts(value) {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) {
      if (!value.length) return [];
      if (isEmptyPlain(value[0])) return value.slice(1).map(T.normPart);
      return [T.normPart(value)];
    }
    const p = T.normPart(value);
    // {"text":"","extra":[...]} wrapper with no style -> unwrap
    const keys = Object.keys(p).filter((k) => p[k] !== undefined);
    if (p.text === '' && Array.isArray(p.extra) && keys.every((k) => k === 'text' || k === 'extra') && p.extra.length) {
      return p.extra.map(T.normPart);
    }
    return [p];
  };

  /** Parts -> Text value. */
  T.fromParts = function fromParts(parts) {
    if (!parts.length) return '';
    if (parts.length === 1) return T.simplifyPart(parts[0]);
    return [''].concat(parts.map(T.simplifyPart));
  };

  /* ------------------------------------------------------------------ *
   * Walking (used by the validator)
   * ------------------------------------------------------------------ */
  /**
   * Visit every component (string or object) in a Text value.
   * visit(component, path) — path is relative, dot separated, e.g. "extra.0.hover_event.value".
   */
  T.walk = function walk(value, visit, path) {
    path = path || '';
    const j = (a, b) => (a === '' ? String(b) : a + '.' + b);
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, visit, j(path, i)));
      return;
    }
    visit(value, path);
    if (value && typeof value === 'object') {
      if (Array.isArray(value.extra)) value.extra.forEach((v, i) => walk(v, visit, j(j(path, 'extra'), i)));
      if (Array.isArray(value.with)) value.with.forEach((v, i) => { if (v && typeof v === 'object' || typeof v === 'string') walk(v, visit, j(j(path, 'with'), i)); });
      if (value.separator !== undefined) walk(value.separator, visit, j(path, 'separator'));
      if (value.fallback && typeof value.fallback === 'object') walk(value.fallback, visit, j(path, 'fallback'));
      if (value.hover_event && value.hover_event.action === 'show_text' && value.hover_event.value !== undefined) {
        walk(value.hover_event.value, visit, j(j(path, 'hover_event'), 'value'));
      }
      if (value.hover_event && value.hover_event.action === 'show_entity' && value.hover_event.name !== undefined) {
        walk(value.hover_event.name, visit, j(j(path, 'hover_event'), 'name'));
      }
    }
  };

  /* ------------------------------------------------------------------ *
   * Flatten to styled runs (used by the live preview and plain-text previews)
   * ------------------------------------------------------------------ */
  function mergeStyle(parent, c) {
    const s = Object.assign({}, parent);
    for (const k of STYLE_KEYS) if (c[k] !== undefined) s[k] = c[k];
    return s;
  }

  /** Split a translation template into literal pieces and argument slots. */
  function splitFormat(tpl) {
    const parts = [];
    let last = 0;
    let next = 0;
    const re = /%(?:(\d+)\$)?([sd%])/g;
    let m;
    while ((m = re.exec(tpl))) {
      if (m.index > last) parts.push({ lit: tpl.slice(last, m.index) });
      if (m[2] === '%') parts.push({ lit: '%' });
      else parts.push({ arg: m[1] ? parseInt(m[1], 10) - 1 : next++ });
      last = re.lastIndex;
    }
    if (last < tpl.length) parts.push({ lit: tpl.slice(last) });
    return parts;
  }

  /**
   * @param {*} value Text value
   * @param {string} ver version id
   * @param {object} [opts] {baseStyle}
   * @returns {Array<object>} runs: {kind:'text'|'sprite'|'head'|'unresolved', text?, style, ...}
   */
  T.flatten = function flatten(value, ver, opts) {
    opts = opts || {};
    const runs = [];
    const lang = DMC.lang;
    const keys = DMC.keys;

    function pushText(text, style) {
      if (text === '' || text == null) return;
      runs.push({ kind: 'text', text: String(text), style });
    }

    function visit(c, parentStyle) {
      if (c === undefined || c === null) return;
      if (typeof c === 'string') return pushText(c, parentStyle);
      if (typeof c === 'number' || typeof c === 'boolean') return pushText(String(c), parentStyle);
      if (Array.isArray(c)) {
        if (!c.length) return;
        // first element is the parent; the rest are its extras and inherit its style
        const first = T.normPart(c[0]);
        const merged = Object.assign({}, first, { extra: (first.extra || []).concat(c.slice(1)) });
        return visit(merged, parentStyle);
      }
      if (typeof c !== 'object') return;
      const style = mergeStyle(parentStyle, c);
      const kind = T.kindOf(c);
      switch (kind) {
        case 'text':
          pushText(c.text == null ? '' : c.text, style);
          break;
        case 'translatable': {
          const args = Array.isArray(c.with) ? c.with : [];
          const tpl = lang.has(c.translate, ver) ? lang.get(c.translate, ver) : c.fallback != null && typeof c.fallback === 'string' ? c.fallback : c.translate;
          for (const piece of splitFormat(String(tpl))) {
            if (piece.lit !== undefined) pushText(piece.lit, style);
            else if (args[piece.arg] !== undefined) visit(args[piece.arg], style);
          }
          break;
        }
        case 'keybind': {
          const name = keys.defaults[c.keybind] || (lang.has(c.keybind, ver) ? lang.get(c.keybind, ver) : c.keybind);
          pushText(name, style);
          break;
        }
        case 'sprite':
          runs.push({ kind: 'sprite', atlas: c.atlas || 'minecraft:blocks', sprite: c.sprite || '', fallback: c.fallback, style });
          break;
        case 'head':
          runs.push({ kind: 'head', player: c.player, hat: c.hat !== false, fallback: c.fallback, style });
          break;
        case 'score':
          runs.push({ kind: 'unresolved', what: 'score', label: c.score ? `${c.score.name || '?'} · ${c.score.objective || '?'}` : 'score', style });
          break;
        case 'selector':
          runs.push({ kind: 'unresolved', what: 'selector', label: String(c.selector || '@?'), style });
          break;
        case 'nbt':
          runs.push({ kind: 'unresolved', what: 'nbt', label: String(c.nbt || 'nbt'), style });
          break;
        default:
          break;
      }
      if (Array.isArray(c.extra)) for (const e of c.extra) visit(e, style);
    }

    visit(value, opts.baseStyle || {});
    return runs;
  };

  T.plain = function plain(value, ver) {
    return T.flatten(value, ver || DMC.ver.default)
      .map((r) => (r.kind === 'text' ? r.text : r.kind === 'sprite' ? '▣' : r.kind === 'head' ? '☺' : '⟨' + r.label + '⟩'))
      .join('');
  };

  /** True if the Text value contains something other than literal strings / empty. */
  T.isEmpty = function isEmpty(value) {
    if (value === undefined || value === null || value === '') return true;
    if (Array.isArray(value)) return value.every(T.isEmpty);
    if (typeof value === 'object') {
      const k = T.kindOf(value);
      if (k === 'text' && (value.text === '' || value.text === undefined) && !(value.extra && value.extra.some((e) => !T.isEmpty(e)))) return true;
    }
    return false;
  };
})();
