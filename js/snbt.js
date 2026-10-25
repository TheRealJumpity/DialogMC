/* Dialog MC — SNBT (stringified NBT) parser + serializer. Pure functions, no DOM. */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const S = (DMC.snbt = {});

  /* ------------------------------------------------------------------ *
   * Serializer: JS value -> SNBT string
   * ------------------------------------------------------------------ */
  const UNQUOTED_KEY = /^[A-Za-z_][A-Za-z0-9_.+-]*$/;

  function quote(str) {
    // Prefer the quote character that needs the fewest escapes (like vanilla).
    const dq = (str.match(/"/g) || []).length;
    const sq = (str.match(/'/g) || []).length;
    const q = dq > sq ? "'" : '"';
    let out = q;
    for (const ch of str) {
      const c = ch.codePointAt(0);
      if (ch === '\\') out += '\\\\';
      else if (ch === q) out += '\\' + q;
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (c < 0x20 || c === 0x7f) out += '\\x' + c.toString(16).padStart(2, '0');
      else out += ch;
    }
    return out + q;
  }
  S.quote = quote;

  function num(n) {
    if (!Number.isFinite(n)) return '0';
    if (Number.isInteger(n)) {
      if (n > 2147483647 || n < -2147483648) return n + 'L';
      return String(n);
    }
    return String(n);
  }

  /**
   * @param {*} v
   * @param {{unquotedKeys?: boolean, indent?: number}} [opts]
   */
  S.stringify = function stringify(v, opts) {
    opts = opts || {};
    const unq = opts.unquotedKeys !== false;
    const indent = opts.indent || 0;
    function go(x, depth) {
      if (x === null || x === undefined) return '""';
      if (typeof x === 'boolean') return x ? 'true' : 'false';
      if (typeof x === 'number') return num(x);
      if (typeof x === 'string') return quote(x);
      const pad = indent ? '\n' + ' '.repeat(indent * (depth + 1)) : '';
      const padEnd = indent ? '\n' + ' '.repeat(indent * depth) : '';
      const sep = ',' ;
      if (Array.isArray(x)) {
        if (!x.length) return '[]';
        return '[' + pad + x.map((e) => go(e, depth + 1)).join(sep + pad) + padEnd + ']';
      }
      const keys = Object.keys(x).filter((k) => x[k] !== undefined);
      if (!keys.length) return '{}';
      const colon = indent ? ': ' : ':';
      return (
        '{' + pad +
        keys.map((k) => (unq && UNQUOTED_KEY.test(k) ? k : quote(k)) + colon + go(x[k], depth + 1)).join(sep + pad) +
        padEnd + '}'
      );
    }
    return go(v, 0);
  };

  /* ------------------------------------------------------------------ *
   * Parser: SNBT / JSON string -> JS value
   * ------------------------------------------------------------------ */
  class SnbtError extends Error {
    constructor(message, pos) {
      super(message);
      this.pos = pos;
    }
  }

  const NUM_RE = /^[-+]?(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][-+]?\d+)?)[bBsSlLfFdD]?$/;
  const UNQUOTED_CHAR = /[0-9A-Za-z_\-.+]/;

  function parseNumberToken(tok) {
    // returns {value, type} or null
    if (!NUM_RE.test(tok)) return null;
    let s = tok.replace(/_/g, '');
    let type = null;
    const last = s[s.length - 1];
    const isHex = /^[-+]?0[xX]/.test(s);
    const isBin = /^[-+]?0[bB][01]/.test(s);
    if (/[bBsSlLfFdD]$/.test(s) && !(isHex && /[bBdDfF]$/.test(s))) {
      if (!(isBin && /[bB]$/.test(s) && /^[-+]?0[bB][01]+$/.test(s))) {
        type = last.toLowerCase();
        s = s.slice(0, -1);
      }
    }
    let value;
    if (isHex) {
      const neg = s[0] === '-';
      value = parseInt(s.replace(/^[-+]?0[xX]/, ''), 16);
      if (neg) value = -value;
    } else if (isBin) {
      const neg = s[0] === '-';
      value = parseInt(s.replace(/^[-+]?0[bB]/, ''), 2);
      if (neg) value = -value;
    } else {
      value = Number(s);
    }
    if (Number.isNaN(value)) return null;
    return { value, type };
  }

  /**
   * Parse SNBT text. Returns {ok:true, value} or {ok:false, error:{message,pos}}.
   * Also accepts normal JSON.
   * @param {string} text
   * @param {{partial?: boolean}} [opts] partial: allow trailing input and report end position
   */
  S.parse = function parse(text, opts) {
    opts = opts || {};
    let i = 0;
    const n = text.length;

    const fail = (msg, pos) => {
      throw new SnbtError(msg, pos == null ? i : pos);
    };
    const ws = () => {
      while (i < n && /\s/.test(text[i])) i++;
    };

    function parseQuoted() {
      const q = text[i++];
      let out = '';
      while (i < n) {
        const ch = text[i++];
        if (ch === q) return out;
        if (ch === '\\') {
          if (i >= n) break;
          const e = text[i++];
          switch (e) {
            case 'b': out += '\b'; break;
            case 'f': out += '\f'; break;
            case 'n': out += '\n'; break;
            case 'r': out += '\r'; break;
            case 's': out += ' '; break;
            case 't': out += '\t'; break;
            case '\\': out += '\\'; break;
            case '"': out += '"'; break;
            case "'": out += "'"; break;
            case 'x': case 'u': case 'U': {
              const len = e === 'x' ? 2 : e === 'u' ? 4 : 8;
              const hex = text.substr(i, len);
              if (hex.length < len || !/^[0-9a-fA-F]+$/.test(hex)) fail('Invalid unicode escape', i - 2);
              out += String.fromCodePoint(parseInt(hex, 16));
              i += len;
              break;
            }
            default:
              fail('Invalid escape sequence \\' + e, i - 2);
          }
        } else out += ch;
      }
      return fail('Unterminated string', i);
    }

    function parseToken() {
      const start = i;
      while (i < n && UNQUOTED_CHAR.test(text[i])) i++;
      if (i === start) fail('Unexpected character ' + (i < n ? JSON.stringify(text[i]) : '(end of input)'), start);
      return text.slice(start, i);
    }

    function parseKey() {
      ws();
      if (text[i] === '"' || text[i] === "'") return parseQuoted();
      return parseToken();
    }

    function parseArrayTyped(kind) {
      // after "[X;"
      const out = [];
      ws();
      while (i < n && text[i] !== ']') {
        ws();
        const v = parseValue();
        if (typeof v !== 'number') fail('Expected a number inside [' + kind + ';]', i);
        out.push(v);
        ws();
        if (text[i] === ',') { i++; ws(); } else break;
      }
      ws();
      if (text[i] !== ']') fail("Expected ']'", i);
      i++;
      return out;
    }

    function parseValue() {
      ws();
      if (i >= n) fail('Unexpected end of input', i);
      const c = text[i];
      if (c === '{') {
        i++;
        const obj = {};
        ws();
        while (i < n && text[i] !== '}') {
          const key = parseKey();
          ws();
          if (text[i] !== ':') fail("Expected ':' after key " + JSON.stringify(key), i);
          i++;
          obj[key] = parseValue(); // duplicate keys: last one wins (like vanilla)
          ws();
          if (text[i] === ',') { i++; ws(); } else if (text[i] !== '}') fail("Expected ',' or '}'", i);
        }
        if (text[i] !== '}') fail("Expected '}'", i);
        i++;
        return obj;
      }
      if (c === '[') {
        i++;
        ws();
        const m = /^([BILbil])\s*;/.exec(text.slice(i, i + 12));
        if (m) {
          i += m[0].length;
          return parseArrayTyped(m[1].toUpperCase());
        }
        const arr = [];
        while (i < n && text[i] !== ']') {
          arr.push(parseValue());
          ws();
          if (text[i] === ',') { i++; ws(); } else if (text[i] !== ']') fail("Expected ',' or ']'", i);
        }
        if (text[i] !== ']') fail("Expected ']'", i);
        i++;
        return arr;
      }
      if (c === '"' || c === "'") return parseQuoted();
      const tok = parseToken();
      const low = tok.toLowerCase();
      if (low === 'true') return true;
      if (low === 'false') return false;
      const nm = parseNumberToken(tok);
      if (nm) return nm.value;
      return tok; // unquoted string
    }

    try {
      const value = parseValue();
      const end = i;
      ws();
      if (!opts.partial && i < n) fail('Unexpected trailing data ' + JSON.stringify(text.slice(i, i + 12)), i);
      return { ok: true, value, end };
    } catch (e) {
      if (e instanceof SnbtError) return { ok: false, error: { message: e.message, pos: e.pos } };
      throw e;
    }
  };

  /** Parse JSON first (fast, strict) and fall back to SNBT. */
  S.parseLoose = function parseLoose(text) {
    const t = String(text).trim();
    try {
      return { ok: true, value: JSON.parse(t), format: 'json' };
    } catch (e) { /* try snbt */ }
    const r = S.parse(t);
    if (r.ok) r.format = 'snbt';
    return r;
  };
})();
