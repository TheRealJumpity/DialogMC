/* Dialog MC — Brigadier-style command validator over the generated command trees. No DOM.
 *
 * DMC.cmd.validate(command, version) -> {
 *   ok, errors:[{pos,end,message,expected?,suggestion?}], level (0-4), signed, path:[names], root
 * }
 * Mirrors what the Minecraft client does for click-event / dialog commands:
 *   parse error  -> "unrecognized or invalid command" confirm screen (and the server rejects it)
 *   signed args  -> "can only be run from the chat screen" (never runs from a click)
 *   level > 0    -> "requires elevated permissions" confirm screen / players below the level can't run it
 */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const D = window.DMC_DATA;
  const C = (DMC.cmd = {});

  C.LEVELS = ['everyone', 'moderators (level 1)', 'game masters (level 2)', 'admins (level 3)', 'owners (level 4)'];
  C.levelName = (l) => ['everyone', 'level 1 (moderator)', 'level 2 (game master)', 'level 3 (admin)', 'level 4 (owner)'][l] || 'level ' + l;

  class ParseError extends Error {
    constructor(message, pos) {
      super(message);
      this.pos = pos;
    }
  }

  /* ------------------------------------------------------------------ *
   * String reader (port of Brigadier's StringReader essentials)
   * ------------------------------------------------------------------ */
  const isUnquotedChar = (c) => (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_' || c === '-' || c === '.' || c === '+';
  const isNumberChar = (c) => (c >= '0' && c <= '9') || c === '.' || c === '-';
  const isRlChar = (c) => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || c === '_' || c === ':' || c === '/' || c === '.' || c === '-';

  class Reader {
    constructor(s, i) {
      this.s = s;
      this.i = i || 0;
    }
    canRead(n) { return this.i + (n || 1) <= this.s.length; }
    peek(o) { return this.s[this.i + (o || 0)]; }
    skip() { this.i++; }
    rest() { return this.s.slice(this.i); }
    skipWs() { while (this.canRead() && /\s/.test(this.peek())) this.i++; }
    readUntilSpace() {
      const st = this.i;
      while (this.canRead() && this.peek() !== ' ') this.i++;
      return this.s.slice(st, this.i);
    }
    readUnquoted() {
      const st = this.i;
      while (this.canRead() && isUnquotedChar(this.peek())) this.i++;
      return this.s.slice(st, this.i);
    }
    readQuoted() {
      const st = this.i;
      const q = this.read();
      let out = '';
      while (this.canRead()) {
        const c = this.read();
        if (c === '\\') {
          if (!this.canRead()) break;
          const n = this.read();
          if (n === q || n === '\\') out += n;
          else throw new ParseError("Invalid escape sequence '\\" + n + "' in quoted string", this.i - 2);
        } else if (c === q) return out;
        else out += c;
      }
      throw new ParseError('Unclosed quoted string', st);
    }
    read() { return this.s[this.i++]; }
    readString() {
      if (!this.canRead()) return '';
      const c = this.peek();
      if (c === '"' || c === "'") return this.readQuoted();
      return this.readUnquoted();
    }
    readNumberText() {
      const st = this.i;
      while (this.canRead() && isNumberChar(this.peek())) this.i++;
      return this.s.slice(st, this.i);
    }
    readInt(min, max) {
      const st = this.i;
      const t = this.readNumberText();
      if (!t) throw new ParseError('Expected integer', st);
      if (!/^-?\d+$/.test(t)) throw new ParseError("Invalid integer '" + t + "'", st);
      const v = Number(t);
      if (v > 2147483647 || v < -2147483648) throw new ParseError("Invalid integer '" + t + "'", st);
      if (min != null && v < min) throw new ParseError('Integer must not be less than ' + min + ', found ' + v, st);
      if (max != null && v > max) throw new ParseError('Integer must not be more than ' + max + ', found ' + v, st);
      return v;
    }
    readLong() {
      const st = this.i;
      const t = this.readNumberText();
      if (!t) throw new ParseError('Expected long', st);
      if (!/^-?\d+$/.test(t)) throw new ParseError("Invalid long '" + t + "'", st);
      return Number(t);
    }
    readDouble(min, max, what) {
      const st = this.i;
      const t = this.readNumberText();
      if (!t) throw new ParseError('Expected ' + (what || 'double'), st);
      if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) throw new ParseError("Invalid " + (what || 'double') + " '" + t + "'", st);
      const v = Number(t);
      if (min != null && v < min) throw new ParseError((what === 'float' ? 'Float' : 'Double') + ' must not be less than ' + min + ', found ' + v, st);
      if (max != null && v > max) throw new ParseError((what === 'float' ? 'Float' : 'Double') + ' must not be more than ' + max + ', found ' + v, st);
      return v;
    }
    readBool() {
      const st = this.i;
      const t = this.readUnquoted();
      if (!t) throw new ParseError('Expected bool', st);
      if (t === 'true') return true;
      if (t === 'false') return false;
      throw new ParseError("Invalid bool, expected true or false but found '" + t + "'", st);
    }
  }

  /* ------------------------------------------------------------------ *
   * Helpers shared by parsers
   * ------------------------------------------------------------------ */
  function readRL(r, allowTag, label) {
    const st = r.i;
    if (allowTag && r.peek() === '#') r.skip();
    const s0 = r.i;
    while (r.canRead() && isRlChar(r.peek())) r.skip();
    const text = r.s.slice(s0, r.i);
    if (!text) throw new ParseError('Expected ' + (label || 'resource location'), st);
    const parts = text.split(':');
    if (parts.length > 2 || !/^[a-z0-9_.-]*$/.test(parts[0]) || !/^[a-z0-9_.\-/]*$/.test(parts[parts.length - 1]) || (parts.length === 2 && !parts[0]) ) {
      throw new ParseError("Invalid " + (label || 'resource location') + " '" + text + "'", st);
    }
    return { text, tag: r.s[st] === '#', start: st };
  }

  function readSnbt(r, expect) {
    const st = r.i;
    const res = DMC.snbt.parse(r.rest(), { partial: true });
    if (!res.ok) throw new ParseError(res.error.message, st + res.error.pos);
    if (expect === 'compound' && !(res.value && typeof res.value === 'object' && !Array.isArray(res.value))) {
      throw new ParseError('Expected a compound tag { … }', st);
    }
    r.i = st + res.end;
    return res.value;
  }

  function checkRegistry(ctx, kind, rlInfo, label) {
    if (!kind) return;
    const res = DMC.reg.check(kind, rlInfo.text.includes(':') ? rlInfo.text : 'minecraft:' + rlInfo.text, ctx.ver);
    if (res.status === 'missing') {
      const sug = DMC.reg.suggest(kind, rlInfo.text, ctx.ver, 1)[0];
      throw new ParseError("Unknown " + label + " '" + rlInfo.text + "'" + (sug ? " — did you mean '" + sug + "'?" : ''), rlInfo.start);
    }
    if (res.status === 'newer') throw new ParseError("'" + rlInfo.text + "' doesn't exist in " + ctx.ver + ' (added in ' + res.since + ')', rlInfo.start);
  }

  function parseCoord(r, intMode, allowLocal) {
    if (!r.canRead() || r.peek() === ' ') throw new ParseError('Expected coordinate', r.i);
    const c = r.peek();
    if (c === '^') {
      if (!allowLocal) throw new ParseError('Cannot use local (^) coordinates here', r.i);
      r.skip();
      if (r.canRead() && r.peek() !== ' ') r.readDouble();
      return 'local';
    }
    const rel = c === '~';
    if (rel) r.skip();
    if (r.canRead() && r.peek() !== ' ') {
      if (rel || !intMode) r.readDouble();
      else r.readInt();
    }
    return 'world';
  }
  function parseCoords(r, n, intMode, allowLocal) {
    let mode = null;
    for (let k = 0; k < n; k++) {
      if (k > 0) {
        if (!r.canRead() || r.peek() !== ' ') throw new ParseError('Incomplete position: expected ' + n + ' coordinates', r.i);
        r.skip();
      }
      const cst = r.i;
      const m = parseCoord(r, intMode, allowLocal);
      if (mode && m !== mode) throw new ParseError('Cannot mix world & local coordinates (everything must either use ^ or not)', cst);
      mode = m;
    }
  }

  function parseRange(r, isInt, what) {
    const st = r.i;
    function readNum() {
      const s0 = r.i;
      while (r.canRead()) {
        const c = r.peek();
        if ((c >= '0' && c <= '9') || c === '-') r.skip();
        else if (c === '.' && !(r.peek(1) === '.')) { if (isInt) break; r.skip(); } else break;
      }
      const t = r.s.slice(s0, r.i);
      if (!t) return null;
      if (isInt ? !/^-?\d+$/.test(t) : !/^-?(\d+\.?\d*|\.\d+)$/.test(t)) throw new ParseError("Invalid " + (what || 'number') + " '" + t + "'", s0);
      return Number(t);
    }
    const min = readNum();
    let max = min;
    if (r.peek() === '.' && r.peek(1) === '.') {
      r.i += 2;
      max = readNum();
    }
    if (min === null && max === null) throw new ParseError('Expected value or range of values', st);
    if (min !== null && max !== null && min > max) throw new ParseError('Min cannot be bigger than max', st);
  }

  /* ------------------------------------------------------------------ *
   * Entity selectors
   * ------------------------------------------------------------------ */
  const SELECTOR_OPTIONS = ['name', 'distance', 'level', 'x', 'y', 'z', 'dx', 'dy', 'dz', 'x_rotation', 'y_rotation', 'limit', 'sort', 'gamemode', 'team', 'type', 'tag', 'nbt', 'scores', 'advancements', 'predicate'];

  function skipBalanced(r) {
    // skips a value up to the next top-level ',' or ']' (respecting quotes and nesting)
    let depth = 0;
    const st = r.i;
    while (r.canRead()) {
      const c = r.peek();
      if (c === '"' || c === "'") { r.readQuoted(); continue; }
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        if (depth === 0) break;
        depth--;
      } else if (c === ',' && depth === 0) break;
      r.skip();
    }
    if (depth !== 0) throw new ParseError('Unbalanced brackets', st);
  }

  function parseSelector(r, props, ctx) {
    const st = r.i;
    const playersOnly = props && props.type === 'players';
    const single = props && props.amount === 'single';
    if (!r.canRead() || r.peek() === ' ') throw new ParseError('Expected a selector, player name or UUID', st);
    if (r.peek() !== '@') {
      const name = r.readUntilSpace();
      if (!name || name.length > 16) {
        if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(name)) {
          throw new ParseError('Invalid name or UUID', st);
        }
      }
      return;
    }
    r.skip();
    if (!r.canRead()) throw new ParseError('Missing selector type', st);
    const t = r.read();
    if (!'parsen'.includes(t) || t === ' ') throw new ParseError("Unknown selector type '@" + t + "'", st);
    let includesEntities = t === 'e' || t === 'n';
    let limitOne = t === 'p' || t === 'r' || t === 's' || t === 'n';
    let typeGiven = null;
    if (r.canRead() && r.peek() === '[') {
      r.skip();
      r.skipWs();
      while (r.canRead() && r.peek() !== ']') {
        r.skipWs();
        const kst = r.i;
        const key = r.readUnquoted();
        if (!key) throw new ParseError('Expected selector option name', kst);
        if (!SELECTOR_OPTIONS.includes(key)) {
          const sug = DMC.util.closest(key, SELECTOR_OPTIONS);
          throw new ParseError("Unknown selector option '" + key + "'" + (sug ? " — did you mean '" + sug + "'?" : ''), kst);
        }
        r.skipWs();
        if (r.peek() !== '=') throw new ParseError("Expected '=' after '" + key + "'", r.i);
        r.skip();
        r.skipWs();
        const vst = r.i;
        const neg = r.peek() === '!' && ['name', 'team', 'type', 'tag', 'gamemode', 'nbt', 'predicate'].includes(key);
        if (neg) r.skip();
        switch (key) {
          case 'x': case 'y': case 'z': case 'dx': case 'dy': case 'dz':
            r.readDouble();
            break;
          case 'distance': parseRange(r, false, 'float'); break;
          case 'level': parseRange(r, true, 'integer'); break;
          case 'x_rotation': case 'y_rotation': parseRange(r, false, 'float'); break;
          case 'limit': {
            r.readInt(1);
            limitOne = true;
            break;
          }
          case 'sort': {
            const v = r.readUnquoted();
            if (!['nearest', 'furthest', 'random', 'arbitrary'].includes(v)) throw new ParseError("Invalid or unknown sort type '" + v + "'", vst);
            break;
          }
          case 'gamemode': {
            const v = r.readUnquoted();
            if (!['survival', 'creative', 'adventure', 'spectator'].includes(v)) throw new ParseError("Invalid or unknown game mode '" + v + "'", vst);
            break;
          }
          case 'type': {
            const info = readRL(r, true, 'entity type');
            if (!info.tag && !neg) {
              checkRegistry(ctx, 'entities', info, 'entity type');
              if (!neg && info.text.replace(/^minecraft:/, '') === 'player') includesEntities = false;
              typeGiven = info.text;
            }
            break;
          }
          case 'name': case 'team': case 'tag': {
            if (r.peek() === '"' || r.peek() === "'") r.readQuoted();
            else r.readUnquoted();
            break;
          }
          case 'predicate': readRL(r, false, 'predicate'); break;
          case 'nbt': readSnbt(r, 'compound'); break;
          case 'scores': case 'advancements': {
            if (r.peek() !== '{') throw new ParseError("Expected '{' after '" + key + "='", r.i);
            readSnbtLike(r);
            break;
          }
          default: skipBalanced(r);
        }
        r.skipWs();
        if (r.canRead() && r.peek() === ',') { r.skip(); r.skipWs(); } else break;
      }
      if (!r.canRead() || r.peek() !== ']') throw new ParseError("Expected ']' to close the selector options", r.i);
      r.skip();
    }
    if (single && !limitOne) throw new ParseError('Only one entity is allowed, but the provided selector allows more than one', st);
    if (playersOnly && includesEntities && t !== 's') {
      throw new ParseError('Only players may be affected by this command, but the provided selector includes entities (use @a, @p, @r, @s or a player name)', st);
    }
    void typeGiven;
  }

  /** {a=1..5,b=2} style bodies used by scores=/advancements=: validated for brace balance only. */
  function readSnbtLike(r) {
    const st = r.i;
    let depth = 0;
    while (r.canRead()) {
      const c = r.peek();
      if (c === '"' || c === "'") { r.readQuoted(); continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { r.skip(); return; }
      }
      r.skip();
    }
    throw new ParseError("Expected '}'", st);
  }

  /* ------------------------------------------------------------------ *
   * NBT path
   * ------------------------------------------------------------------ */
  function parseNbtPath(r) {
    const st = r.i;
    const isNameChar = (c) => c !== ' ' && c !== '"' && c !== "'" && c !== '[' && c !== ']' && c !== '.' && c !== '{' && c !== '}';
    function name() {
      if (r.peek() === '"' || r.peek() === "'") return r.readQuoted();
      const s0 = r.i;
      while (r.canRead() && isNameChar(r.peek())) r.skip();
      if (r.i === s0) throw new ParseError('Invalid NBT path element', s0);
    }
    let first = true;
    while (r.canRead() && r.peek() !== ' ') {
      const c = r.peek();
      if (c === '.') {
        if (first) throw new ParseError('Invalid NBT path element', r.i);
        r.skip();
        if (!r.canRead() || r.peek() === ' ') throw new ParseError('Invalid NBT path element', r.i);
        if (r.peek() === '{') { readSnbt(r, 'compound'); continue; }
        name();
        if (r.canRead() && r.peek() === '{') readSnbt(r, 'compound');
      } else if (c === '[') {
        if (first) throw new ParseError('Invalid NBT path element', r.i);
        r.skip();
        if (r.peek() === '{') readSnbt(r, 'compound');
        else if (r.peek() === ']') { /* all */ } else r.readInt();
        if (r.peek() !== ']') throw new ParseError("Expected ']' in NBT path", r.i);
        r.skip();
      } else if (c === '{') {
        if (!first) throw new ParseError('Invalid NBT path element', r.i);
        readSnbt(r, 'compound');
      } else if (first) {
        name();
        if (r.canRead() && r.peek() === '{') readSnbt(r, 'compound');
      } else throw new ParseError('Invalid NBT path element', r.i);
      first = false;
    }
    if (r.i === st) throw new ParseError('Expected NBT path', st);
  }

  /* ------------------------------------------------------------------ *
   * Items / blocks
   * ------------------------------------------------------------------ */
  function parseComponentList(r, ctx, allowRemove, allowOps) {
    // at '['
    const st = r.i;
    r.skip();
    r.skipWs();
    const comps = new Set(DMC.reg.components(ctx.ver));
    const seen = new Set();
    while (r.canRead() && r.peek() !== ']') {
      r.skipWs();
      const kst = r.i;
      let remove = false;
      if (r.peek() === '!' && allowRemove) { r.skip(); remove = true; }
      const info = readRL(r, false, 'data component');
      const bare = info.text.replace(/^minecraft:/, '');
      if (info.text.startsWith('minecraft:') || !info.text.includes(':')) {
        if (!comps.has(bare)) {
          const newer = DMC.reg.addedIn('components', bare);
          const sug = DMC.reg.suggest('components', bare, ctx.ver, 1)[0];
          throw new ParseError(newer ? "Data component '" + bare + "' doesn't exist in " + ctx.ver + ' (added in ' + newer + ')' : "Unknown data component '" + bare + "'" + (sug ? " — did you mean '" + sug + "'?" : ''), kst);
        }
      }
      if (seen.has(bare)) throw new ParseError("Duplicate data component '" + bare + "'", kst);
      seen.add(bare);
      r.skipWs();
      if (!remove) {
        if (r.peek() !== '=' && !(allowOps && (r.peek() === '|' || r.peek() === '~'))) {
          if (allowOps) { /* bare existence test */ } else throw new ParseError("Expected '=' after component '" + bare + "'", r.i);
        }
        if (r.peek() === '=') {
          r.skip();
          r.skipWs();
          readSnbt(r);
        }
      }
      r.skipWs();
      if (r.canRead() && r.peek() === ',') { r.skip(); r.skipWs(); } else if (allowOps && r.peek() === '|') { r.skip(); r.skipWs(); } else break;
    }
    if (!r.canRead() || r.peek() !== ']') throw new ParseError("Expected ']' to close the component list", r.canRead() ? r.i : st);
    r.skip();
  }

  function parseBlockProps(r) {
    // at '['
    const st = r.i;
    r.skip();
    r.skipWs();
    while (r.canRead() && r.peek() !== ']') {
      r.skipWs();
      const k = r.readUnquoted();
      if (!k) throw new ParseError('Expected block property name', r.i);
      r.skipWs();
      if (r.peek() !== '=') throw new ParseError("Expected '=' after block property '" + k + "'", r.i);
      r.skip();
      r.skipWs();
      const v = r.readUnquoted();
      if (!v) throw new ParseError("Expected a value for block property '" + k + "'", r.i);
      r.skipWs();
      if (r.peek() === ',') { r.skip(); r.skipWs(); } else break;
    }
    if (r.peek() !== ']') throw new ParseError("Expected ']' to close the block properties", r.canRead() ? r.i : st);
    r.skip();
  }

  /* ------------------------------------------------------------------ *
   * Argument parsers
   * ------------------------------------------------------------------ */
  const ITEM_SLOT_FIXED = ['weapon', 'weapon.mainhand', 'weapon.offhand', 'armor.head', 'armor.chest', 'armor.legs', 'armor.feet', 'armor.body', 'player.cursor', 'contents', 'saddle', 'horse.saddle', 'horse.chest', 'horse.armor', 'mount.saddle'];
  const ITEM_SLOT_RANGES = { container: 54, 'enderchest': 27, hotbar: 9, inventory: 27, horse: 15, villager: 8, 'player.crafting': 4, 'player.cursor': 1, bundle: 64 };
  function parseItemSlot(r, allowWildcard) {
    const st = r.i;
    const t = r.readUnquoted();
    if (!t) throw new ParseError('Expected slot', st);
    if (ITEM_SLOT_FIXED.includes(t)) return;
    const m = /^([a-z.]+)\.(\d+|\*)$/.exec(t);
    if (m && ITEM_SLOT_RANGES[m[1]] !== undefined) {
      if (m[2] === '*') {
        if (allowWildcard) return;
      } else if (Number(m[2]) < ITEM_SLOT_RANGES[m[1]]) return;
    }
    if (/^(container|enderchest|hotbar|inventory|horse|villager|player\.crafting|bundle)\.[a-z0-9*]+$/.test(t) || /^armor\./.test(t)) {
      throw new ParseError("Unknown slot '" + t + "'", st);
    }
    throw new ParseError("Unknown slot '" + t + "'", st);
  }

  const P = {
    'brigadier:bool': (r) => r.readBool(),
    'brigadier:integer': (r, o) => r.readInt(o && o.min, o && o.max),
    'brigadier:long': (r) => r.readLong(),
    'brigadier:float': (r, o) => r.readDouble(o && o.min, o && o.max, 'float'),
    'brigadier:double': (r, o) => r.readDouble(o && o.min, o && o.max, 'double'),
    'brigadier:string': (r, o) => {
      const t = (o && o.type) || 'word';
      if (t === 'greedy') {
        if (!r.canRead()) throw new ParseError('Expected text', r.i);
        r.i = r.s.length;
      } else if (t === 'phrase') {
        const st = r.i;
        const s = r.readString();
        if (s === '' && !(r.s[st] === '"' || r.s[st] === "'")) throw new ParseError('Expected text', st);
      } else {
        const s = r.readUnquoted();
        if (!s) throw new ParseError('Expected a word', r.i);
      }
    },
    'minecraft:entity': (r, o, ctx) => parseSelector(r, o, ctx),
    'minecraft:game_profile': (r, o, ctx) => parseSelector(r, { type: 'players', amount: 'multiple' }, ctx),
    'minecraft:score_holder': (r, o, ctx) => {
      if (r.peek() === '*') { r.skip(); return; }
      if (r.peek() === '@') return parseSelector(r, { type: 'entities', amount: (o && o.amount) || 'multiple' }, ctx);
      const st = r.i;
      const name = r.readUntilSpace();
      if (!name) throw new ParseError('Expected a score holder', st);
    },
    'minecraft:block_pos': (r) => parseCoords(r, 3, true, true),
    'minecraft:column_pos': (r) => parseCoords(r, 2, true, false),
    'minecraft:vec3': (r) => parseCoords(r, 3, false, true),
    'minecraft:vec2': (r) => parseCoords(r, 2, false, false),
    'minecraft:rotation': (r) => parseCoords(r, 2, false, false),
    'minecraft:swizzle': (r) => {
      const st = r.i;
      const t = r.readUnquoted();
      if (!/^(?!.*(.).*\1)[xyz]{1,3}$/.test(t)) throw new ParseError("Invalid swizzle '" + t + "' (use a combination of x, y, z without repeats)", st);
    },
    'minecraft:entity_anchor': (r) => {
      const st = r.i;
      const t = r.readUnquoted();
      if (t !== 'feet' && t !== 'eyes') throw new ParseError("Invalid entity anchor position '" + t + "' (feet or eyes)", st);
    },
    'minecraft:message': (r) => {
      if (!r.canRead()) throw new ParseError('Expected a message', r.i);
      r.i = r.s.length;
    },
    'minecraft:component': (r) => readSnbt(r),
    'minecraft:style': (r) => readSnbt(r, 'compound'),
    'minecraft:nbt_compound_tag': (r) => readSnbt(r, 'compound'),
    'minecraft:nbt_tag': (r) => readSnbt(r),
    'minecraft:nbt_path': (r) => parseNbtPath(r),
    'minecraft:resource_location': (r) => readRL(r, false),
    'minecraft:function': (r) => readRL(r, true, 'function'),
    'minecraft:dimension': (r) => readRL(r, false, 'dimension'),
    'minecraft:loot_table': (r) => { if (r.peek() === '{' || r.peek() === '[') readSnbt(r); else readRL(r, false, 'loot table'); },
    'minecraft:loot_predicate': (r) => { if (r.peek() === '{' || r.peek() === '[') readSnbt(r); else readRL(r, false, 'predicate'); },
    'minecraft:loot_modifier': (r) => { if (r.peek() === '{' || r.peek() === '[') readSnbt(r); else readRL(r, false, 'item modifier'); },
    'minecraft:dialog': (r) => { if (r.peek() === '{') readSnbt(r, 'compound'); else readRL(r, false, 'dialog'); },
    'minecraft:resource': (r, o, ctx) => {
      const info = readRL(r, false, 'resource');
      const reg = REGISTRY_KIND[o && o.registry];
      if (reg) checkRegistry(ctx, reg[0], info, reg[1]);
    },
    'minecraft:resource_key': (r) => readRL(r, false, 'resource key'),
    'minecraft:resource_or_tag': (r, o, ctx) => {
      const info = readRL(r, true, 'resource');
      const reg = REGISTRY_KIND[o && o.registry];
      if (reg && !info.tag) checkRegistry(ctx, reg[0], info, reg[1]);
    },
    'minecraft:resource_or_tag_key': (r) => readRL(r, true, 'resource key'),
    'minecraft:resource_selector': (r) => {
      const st = r.i;
      if (r.peek() === '#') r.skip();
      while (r.canRead() && (isRlChar(r.peek()) || r.peek() === '*')) r.skip();
      if (r.i === st) throw new ParseError('Expected resource selector', st);
    },
    'minecraft:item_stack': (r, o, ctx) => {
      const info = readRL(r, false, 'item');
      checkRegistry(ctx, 'items', info, 'item');
      if (info.text.replace(/^minecraft:/, '') === 'air') throw new ParseError("'air' isn't a valid item here", info.start);
      if (r.canRead() && r.peek() === '[') parseComponentList(r, ctx, true, false);
      if (r.canRead() && r.peek() === '{') throw new ParseError("Item NBT in '{…}' was replaced by components '[…]' in 1.20.5+", r.i);
    },
    'minecraft:item_predicate': (r, o, ctx) => {
      if (r.peek() === '*') r.skip();
      else {
        const info = readRL(r, true, 'item');
        if (!info.tag) checkRegistry(ctx, 'items', info, 'item');
      }
      if (r.canRead() && r.peek() === '[') parseComponentList(r, ctx, true, true);
    },
    'minecraft:block_state': (r, o, ctx) => {
      const info = readRL(r, false, 'block');
      checkRegistry(ctx, 'blocks', info, 'block');
      if (r.canRead() && r.peek() === '[') parseBlockProps(r);
      if (r.canRead() && r.peek() === '{') readSnbt(r, 'compound');
    },
    'minecraft:block_predicate': (r, o, ctx) => {
      const info = readRL(r, true, 'block');
      if (!info.tag) checkRegistry(ctx, 'blocks', info, 'block');
      if (r.canRead() && r.peek() === '[') parseBlockProps(r);
      if (r.canRead() && r.peek() === '{') readSnbt(r, 'compound');
    },
    'minecraft:particle': (r, o, ctx) => {
      const info = readRL(r, false, 'particle');
      checkRegistry(ctx, 'particles', info, 'particle');
      if (r.canRead() && r.peek() === '{') readSnbt(r, 'compound');
    },
    'minecraft:objective': (r) => { if (!r.readUnquoted()) throw new ParseError('Expected an objective name', r.i); },
    'minecraft:objective_criteria': (r) => { if (!r.readUntilSpace()) throw new ParseError('Expected a criterion', r.i); },
    'minecraft:team': (r) => { if (!r.readUnquoted()) throw new ParseError('Expected a team name', r.i); },
    'minecraft:color': colorParser(false),
    'minecraft:team_color': colorParser(true),
    'minecraft:hex_color': (r) => {
      const st = r.i;
      const t = r.readUnquoted();
      if (!/^[0-9a-fA-F]{6}$/.test(t)) throw new ParseError("Invalid hex color '" + t + "' (expected 6 hex digits, e.g. FF8800)", st);
    },
    'minecraft:time': (r, o) => {
      const st = r.i;
      const num = r.readNumberText();
      if (!num || !/^-?(\d+\.?\d*|\.\d+)$/.test(num)) throw new ParseError('Expected a time (e.g. 10, 5s, 2d)', st);
      const unit = r.canRead() && /[dst]/.test(r.peek()) ? r.read() : '';
      if (r.canRead() && r.peek() !== ' ') throw new ParseError("Invalid time unit '" + r.peek() + "' (use d, s or t)", r.i);
      const mult = unit === 'd' ? 24000 : unit === 's' ? 20 : 1;
      const ticks = Math.round(Number(num) * mult);
      if (o && o.min != null && ticks < o.min) throw new ParseError('Tick count must be ' + (o.min <= 0 ? 'non-negative' : 'at least ' + o.min), st);
    },
    'minecraft:uuid': (r) => {
      const st = r.i;
      const t = r.readUntilSpace();
      if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(t)) throw new ParseError('Invalid UUID', st);
    },
    'minecraft:gamemode': (r) => {
      const st = r.i;
      const t = r.readUnquoted();
      if (!['survival', 'creative', 'adventure', 'spectator'].includes(t)) throw new ParseError("Invalid game mode '" + t + "'", st);
    },
    'minecraft:int_range': (r) => parseRange(r, true, 'integer'),
    'minecraft:float_range': (r) => parseRange(r, false, 'float'),
    'minecraft:item_slot': (r) => parseItemSlot(r, false),
    'minecraft:item_slots': (r) => parseItemSlot(r, true),
    'minecraft:operation': (r) => {
      const st = r.i;
      const t = r.readUntilSpace();
      if (!['=', '+=', '-=', '*=', '/=', '%=', '<', '>', '><'].includes(t)) throw new ParseError("Invalid operation '" + t + "'", st);
    },
    'minecraft:scoreboard_slot': (r) => {
      const st = r.i;
      const t = r.readUntilSpace();
      const ok = ['list', 'sidebar', 'below_name'].includes(t) || /^sidebar\.team\.[a-z_]+$/.test(t);
      if (!ok) throw new ParseError("Unknown scoreboard slot '" + t + "'", st);
    },
    'minecraft:heightmap': (r) => {
      const st = r.i;
      const t = r.readUnquoted();
      if (!['world_surface', 'motion_blocking', 'motion_blocking_no_leaves', 'ocean_floor'].includes(t)) throw new ParseError("Invalid heightmap '" + t + "'", st);
    },
    'minecraft:template_mirror': (r) => {
      const st = r.i;
      const t = r.readUnquoted();
      if (!['none', 'left_right', 'front_back'].includes(t)) throw new ParseError("Invalid mirror '" + t + "'", st);
    },
    'minecraft:template_rotation': (r) => {
      const st = r.i;
      const t = r.readUnquoted();
      if (!['none', 'clockwise_90', '180', 'counterclockwise_90'].includes(t)) throw new ParseError("Invalid rotation '" + t + "'", st);
    },
  };

  const REGISTRY_KIND = {
    'minecraft:attribute': ['attributes', 'attribute'],
    'minecraft:entity_type': ['entities', 'entity type'],
    'minecraft:enchantment': ['enchantments', 'enchantment'],
    'minecraft:mob_effect': ['effects', 'effect'],
  };

  function colorParser(strict) {
    return (r, o, ctx) => {
      const st = r.i;
      const t = r.readUnquoted();
      const names = DMC.text.COLOR_NAMES.concat(['reset']);
      const modern = DMC.ver.has.teamColorArg(ctx.ver);
      if (modern || strict) {
        if (!names.includes(t)) throw new ParseError("Invalid color '" + t + "' — use a lowercase name like dark_red", st);
      } else {
        const clean = t.toLowerCase().replace(/[^a-z]/g, '');
        if (!names.map((n) => n.replace(/_/g, '')).includes(clean)) throw new ParseError("Invalid color '" + t + "'", st);
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Tree walking
   * ------------------------------------------------------------------ */
  function treeFor(ver) {
    const t = D.commands[ver];
    if (!t) throw new Error('No command tree for version ' + ver);
    return t;
  }

  function resolveRedirect(root, path) {
    let n = root;
    for (const k of path) {
      n = n.c && n.c[k];
      if (!n) return null;
    }
    return n;
  }

  function relevantChildren(node, r) {
    const c = node.c || {};
    const entries = Object.entries(c);
    const literals = entries.filter(([, n]) => n.t !== 'a');
    if (literals.length) {
      const st = r.i;
      const word = r.readUntilSpace();
      r.i = st;
      const hit = literals.find(([k]) => k === word);
      if (hit) return [hit];
      return entries.filter(([, n]) => n.t === 'a');
    }
    return entries.filter(([, n]) => n.t === 'a');
  }

  function childLabel(node) {
    return Object.entries(node.c || {}).map(([k, n]) => (n.t === 'a' ? '<' + k + '>' : k));
  }

  /**
   * Parse from `node` (whose children are the next tokens) at reader position.
   * Returns {ok, error, depth, level, signed, path}.
   */
  function parseFrom(root, node, r, state, ctx) {
    const children = relevantChildren(node, r);
    const start = r.i;
    if (!children.length) {
      const literals = Object.entries(node.c || {}).filter(([, n]) => n.t !== 'a').map(([k]) => k);
      if (literals.length && r.canRead()) {
        // none of the literal keywords matched the next word
        const word = r.s.slice(start).split(' ')[0];
        const sug = DMC.util.closest(word, literals);
        const exp = childLabel(node);
        const e = new ParseError('Unknown ' + (state.path.length ? 'subcommand' : 'command') + " '" + word + "'" + (sug ? " — did you mean '" + sug + "'?" : '') + (exp.length && exp.length <= 12 ? ' (expected: ' + exp.join(' | ') + ')' : ''), start);
        e.expected = exp;
        e.suggestion = sug;
        e.rank = 2;
        return { ok: false, error: e, state };
      }
      const e = new ParseError(r.canRead() ? 'Unexpected extra text — nothing more is allowed after this' : 'Incomplete command', r.i);
      e.rank = 0;
      return { ok: false, error: e, state };
    }
    let best = null;
    for (const [name, child] of children) {
      r.i = start;
      const st2 = { level: Math.max(state.level, child.l || 0), signed: state.signed, path: state.path.concat(name) };
      let result;
      try {
        if (child.t === 'a') {
          const fn = P[child.p];
          if (fn) fn(r, child.o || {}, ctx);
          else {
            // unknown parser: read a word
            if (!r.readUntilSpace()) throw new ParseError('Expected a value', r.i);
          }
          if (child.p === 'minecraft:message') st2.signed = true;
        } else {
          const word = r.readUntilSpace();
          if (word !== name) throw new ParseError('Unknown option', r.i);
        }
        if (r.canRead() && r.peek() !== ' ') {
          throw new ParseError('Expected a space after this argument, but found "' + r.peek() + '"', r.i);
        }
        if (!r.canRead()) {
          // end of input: must be executable
          if (child.e) result = { ok: true, state: st2 };
          else {
            const target = child.r ? resolveRedirect(root, child.r) : child;
            const exp = target ? childLabel(target) : [];
            result = {
              ok: false,
              error: Object.assign(new ParseError('Incomplete command' + (exp.length ? ' — expected: ' + exp.slice(0, 8).join(' | ') + (exp.length > 8 ? ' …' : '') : ''), r.i), { expected: exp, rank: 1 }),
              state: st2,
            };
          }
        } else if (r.canRead(2)) {
          r.skip(); // the separating space
          const target = child.r ? resolveRedirect(root, child.r) : child;
          if (!target) throw new ParseError('Internal error: bad redirect', r.i);
          result = parseFrom(root, target, r, st2, ctx);
        } else {
          result = { ok: false, error: Object.assign(new ParseError('Unexpected trailing space at the end of the command', r.i), { rank: 1 }), state: st2 };
        }
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        result = { ok: false, error: e, state: st2 };
      }
      if (result.ok) return result;
      const rk = (x) => (x.error.rank == null ? 2 : x.error.rank);
      if (!best || result.error.pos > best.error.pos || (result.error.pos === best.error.pos && rk(result) > rk(best))) best = result;
    }
    return best;
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */
  /**
   * @param {string} command command text (a leading '/' is allowed)
   * @param {string} ver '1.21.11' | '26.2'
   */
  C.validate = function validate(command, ver) {
    let s = String(command == null ? '' : command);
    let offset = 0;
    if (s.startsWith('/')) { s = s.slice(1); offset = 1; }
    const result = { ok: false, errors: [], level: 0, signed: false, path: [], root: null };
    if (!s.trim()) {
      result.errors.push({ pos: 0, end: 0, message: 'The command is empty' });
      return result;
    }
    if (/[\n\r\u00a7]/.test(s) || /[\u0000-\u001f\u007f]/.test(s)) {
      const m = /[\n\r\u00a7\u0000-\u001f\u007f]/.exec(s);
      result.errors.push({ pos: m.index + offset, end: m.index + offset + 1, message: m[0] === '\n' || m[0] === '\r' ? 'Commands can\'t contain line breaks' : m[0] === '\u00a7' ? "Commands can't contain the § character" : 'Commands can\'t contain control characters' });
      return result;
    }
    if (s.length > 32767) {
      result.errors.push({ pos: 32767, end: s.length, message: 'Commands longer than 32767 characters are rejected' });
      return result;
    }
    const root = treeFor(ver);
    const ctx = { ver };
    const r = new Reader(s, 0);
    let res;
    try {
      res = parseFrom(root, root, r, { level: 0, signed: false, path: [] }, ctx);
    } catch (e) {
      if (e instanceof ParseError) res = { ok: false, error: e, state: { level: 0, signed: false, path: [] } };
      else throw e;
    }
    const st = res.state || { level: 0, signed: false, path: [] };
    result.level = st.level;
    result.signed = st.signed;
    result.path = st.path;
    result.root = st.path[0] || (s.split(' ')[0] || null);
    result.ok = !!res.ok;
    if (!res.ok && res.error) {
      const e = res.error;
      result.errors.push({ pos: e.pos + offset, end: Math.max(e.pos + offset + 1, Math.min(s.length + offset, e.pos + offset + 1)), message: e.message, expected: e.expected, suggestion: e.suggestion });
    }
    return result;
  };

  /**
   * Check a single argument value with one of the argument parsers (e.g. 'minecraft:entity', 'minecraft:nbt_path').
   * @returns {{ok:boolean, message?:string, pos?:number}}
   */
  C.checkArgument = function (parser, text, props, ver) {
    const fn = P[parser];
    if (!fn) return { ok: true };
    const r = new Reader(String(text), 0);
    try {
      fn(r, props || {}, { ver });
      if (r.canRead()) throw new ParseError('Unexpected extra text "' + r.rest().slice(0, 14) + '"', r.i);
      return { ok: true };
    } catch (e) {
      if (e instanceof ParseError) return { ok: false, message: e.message, pos: e.pos };
      throw e;
    }
  };

  C.stripSlash = (s) => (s.startsWith('/') ? s.slice(1) : s);

  /* ------------------------------------------------------------------ *
   * Macro templates ($(key)) used by dynamic/run_command
   * ------------------------------------------------------------------ */
  C.MACRO_RE = /\$\(([^)]*)\)/g;
  C.templateKeys = function (template) {
    const keys = [];
    const re = /\$\(([^)]*)\)/g;
    let m;
    while ((m = re.exec(template))) keys.push(m[1]);
    return keys;
  };
  C.expand = function (template, values) {
    return template.replace(/\$\(([^)]*)\)/g, (m, k) => (Object.prototype.hasOwnProperty.call(values, k) ? values[k] : m));
  };
  /** Escape a text-input value the way the game does before substituting it into a command template. */
  C.escapeInput = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");

  C._internals = { Reader, ParseError, P };
})();
