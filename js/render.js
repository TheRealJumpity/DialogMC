/* Dialog MC — rendering helpers shared by the text editor and the game preview:
 * styled text runs (Minecraft look), hover tooltips, placeholder item icons, display names. */
(function () {
  'use strict';
  const DMC = (window.DMC = window.DMC || {});
  const U = DMC.util;
  const T = DMC.text;
  const h = U.h;
  const R = (DMC.render = {});
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /* ------------------------------------------------------------------ *
   * Names
   * ------------------------------------------------------------------ */
  R.itemName = function (id, ver) {
    const bare = DMC.rl.bare(String(id || ''));
    const L = DMC.lang;
    ver = ver || DMC.store.version();
    return L.get('item.minecraft.' + bare, ver) || L.get('block.minecraft.' + bare, ver) || U.prettyId(bare);
  };
  R.entityName = function (id, ver) {
    const bare = DMC.rl.bare(String(id || ''));
    return DMC.lang.get('entity.minecraft.' + bare, ver || DMC.store.version()) || U.prettyId(bare);
  };
  R.isBlockItem = (id) => {
    const bare = DMC.rl.bare(String(id || ''));
    return DMC.lang.has('block.minecraft.' + bare, DMC.store.version()) && !DMC.lang.has('item.minecraft.' + bare, DMC.store.version());
  };

  /* ------------------------------------------------------------------ *
   * Placeholder item icons (we don't ship Mojang's textures): a small symmetric pixel glyph
   * seeded from the item id, tinted by material where the name gives it away.
   * ------------------------------------------------------------------ */
  const MATERIALS = [
    ['netherite', '#5a4a55'], ['diamond', '#4aedd9'], ['emerald', '#17dd62'], ['gold', '#fdd835'], ['golden', '#fdd835'],
    ['iron', '#d4d4d4'], ['copper', '#e0775a'], ['redstone', '#e5251d'], ['lapis', '#2b4fd0'], ['coal', '#2b2b2b'],
    ['charcoal', '#3b3226'], ['amethyst', '#a67bd8'], ['quartz', '#ece6dc'], ['stone', '#8a8a8a'], ['cobble', '#7f7f7f'],
    ['deepslate', '#4b4b55'], ['wooden', '#a1783f'], ['oak', '#b08a54'], ['spruce', '#7a5a35'], ['birch', '#d7c98f'],
    ['jungle', '#a9794a'], ['acacia', '#c26a3a'], ['dark_oak', '#4e3822'], ['mangrove', '#7b3f3f'], ['cherry', '#f2b6c8'],
    ['bamboo', '#c8b449'], ['leather', '#9b5a33'], ['chainmail', '#9aa0a6'], ['apple', '#e0372e'], ['carrot', '#f28c1f'],
    ['potato', '#d8b46a'], ['bread', '#c8924a'], ['beef', '#b24a3a'], ['porkchop', '#e59a8a'], ['chicken', '#e8cfa5'],
    ['mutton', '#b85a4a'], ['cod', '#c6a27a'], ['salmon', '#e0705f'], ['melon', '#8bc34a'], ['pumpkin', '#e8841a'],
    ['sugar', '#f4f4f4'], ['wheat', '#d8b858'], ['slime', '#7bd34a'], ['glowstone', '#f3d36a'], ['obsidian', '#2a1b3d'],
    ['water', '#3f76e4'], ['lava', '#e8641a'], ['ender', '#1f8f7f'], ['blaze', '#f3a41a'], ['prismarine', '#5aa89a'],
    ['white', '#f0f0f0'], ['orange', '#e9792a'], ['magenta', '#c74ebd'], ['light_blue', '#4ab3d8'], ['yellow', '#f5c82a'],
    ['lime', '#7fc81a'], ['pink', '#ef8fb0'], ['gray', '#767676'], ['cyan', '#168a96'], ['purple', '#8b32b8'],
    ['blue', '#3a47a8'], ['brown', '#7a4a2a'], ['green', '#4f6a1a'], ['red', '#a82a24'], ['black', '#1c1c21'],
  ];
  function hash(s) {
    let x = 2166136261;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
    return x >>> 0;
  }
  function rng(seed) {
    let a = seed || 1;
    return () => { a = (Math.imul(a ^ (a >>> 15), 1 | a) + 0x6d2b79f5) | 0; return ((a ^ (a >>> 7)) >>> 0) / 4294967296; };
  }
  function mix(hex, to, t) {
    const a = T.hexToRgb(hex);
    const b = T.hexToRgb(to);
    return T.rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  }
  R.itemColor = function (id) {
    const bare = DMC.rl.bare(String(id || '')).toLowerCase();
    let best = null;
    for (const [k, c] of MATERIALS) {
      const i = bare.indexOf(k);
      if (i >= 0 && (!best || k.length > best.k.length)) best = { k, c };
    }
    if (best) return best.c;
    const hh = hash(bare) % 360;
    return `hsl(${hh} 45% 55%)`;
  }
  const iconCache = new Map();
  /** An 8x8 mirrored pixel glyph as an inline SVG string (cached). */
  function glyphSvg(id) {
    const bare = DMC.rl.bare(String(id || '')) || 'air';
    if (iconCache.has(bare)) return iconCache.get(bare);
    const r = rng(hash(bare));
    let base = R.itemColor(bare);
    if (base.startsWith('hsl')) {
      const hh = hash(bare) % 360;
      base = hslToHex(hh, 0.48, 0.55);
    }
    const dark = mix(base, '#000000', 0.45);
    const light = mix(base, '#ffffff', 0.35);
    const cells = [];
    const W = 8;
    const grid = Array.from({ length: W }, () => new Array(W).fill(0));
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W / 2; x++) {
        const edge = y === 0 || y === W - 1 ? 0.35 : 0.0;
        const on = r() > 0.42 + edge + (x === 0 ? 0.2 : 0);
        const v = on ? (r() > 0.7 ? 2 : 1) : 0;
        grid[y][x] = v;
        grid[y][W - 1 - x] = v;
      }
    }
    // always have a solid core so every icon reads as an object
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) if (!grid[y][x]) grid[y][x] = 1;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const v = grid[y][x];
        if (!v) continue;
        const outline = !(y > 0 && grid[y - 1][x]) || !(x > 0 && grid[y][x - 1]) ? false : false;
        void outline;
        const fill = v === 2 ? light : (y + x) % 5 === 0 ? dark : base;
        cells.push(`<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="${fill}"/>`);
      }
    }
    // 1px dark outline around the glyph
    const outlineCells = [];
    for (let y = -1; y <= W; y++) {
      for (let x = -1; x <= W; x++) {
        const here = y >= 0 && y < W && x >= 0 && x < W && grid[y][x];
        if (here) continue;
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const yy = y + dy, xx = x + dx;
          return yy >= 0 && yy < W && xx >= 0 && xx < W && grid[yy][xx];
        });
        if (near) outlineCells.push(`<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="#14141a" opacity=".85"/>`);
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" shape-rendering="crispEdges" width="100%" height="100%">${outlineCells.join('')}${cells.join('')}</svg>`;
    iconCache.set(bare, svg);
    return svg;
  }
  function hslToHex(hh, s, l) {
    const k = (n) => (n + hh / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return T.rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
  }
  /** An element showing a placeholder icon for an item id. */
  R.itemIcon = function (id) {
    const el = h('span', { class: 'mc-icon', 'aria-hidden': 'true' });
    el.innerHTML = glyphSvg(id);
    return el;
  };
  R.itemIconSvg = glyphSvg;

  /* ------------------------------------------------------------------ *
   * Styled text runs
   * ------------------------------------------------------------------ */
  const OBF_POOL = '!"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let obfTimer = null;
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function scramble(el) {
    const src = el.dataset.src || '';
    let out = '';
    for (const ch of src) out += /\s/.test(ch) ? ch : OBF_POOL[(Math.random() * OBF_POOL.length) | 0];
    el.textContent = out;
  }
  function ensureObf() {
    if (obfTimer || reduced()) return;
    obfTimer = setInterval(() => {
      const els = document.querySelectorAll('.mc-obf');
      if (!els.length) { clearInterval(obfTimer); obfTimer = null; return; }
      els.forEach(scramble);
    }, 90);
  }

  const U1 = 'var(--u, 2px)';
  function runStyle(style, baseColor) {
    const color = T.colorToCss(style.color) || baseColor || '#FFFFFF';
    const css = ['color:' + color];
    const bold = style.bold === true;
    let shadow = T.shadowOf(color);
    let showShadow = true;
    if (style.shadow_color !== undefined) {
      const dec = T.argbDecode(style.shadow_color);
      if (dec) { shadow = T.argbToCss(style.shadow_color); if (dec.a === 0) showShadow = false; }
    }
    const sh = [];
    if (bold) sh.push(`calc(${U1} * 1) 0 0 ${color}`);
    if (showShadow) {
      sh.push(`calc(${U1} * ${bold ? 2 : 1}) calc(${U1} * 1) 0 ${shadow}`);
      if (bold) sh.push(`calc(${U1} * 1) calc(${U1} * 1) 0 ${shadow}`);
    }
    css.push('text-shadow:' + (sh.length ? sh.join(',') : 'none'));
    if (style.italic === true) css.push('font-style:italic');
    const deco = [];
    if (style.underlined === true) deco.push('underline');
    if (style.strikethrough === true) deco.push('line-through');
    if (deco.length) css.push('text-decoration:' + deco.join(' '));
    if (bold) css.push('letter-spacing:calc(' + U1 + ' * 0.5)');
    return css.join(';');
  }

  function fontClass(font) {
    if (font === 'minecraft:uniform' || font === 'uniform') return 'f-uniform';
    if (font === 'minecraft:alt' || font === 'alt') return 'f-alt';
    if (font === 'minecraft:illageralt' || font === 'illageralt') return 'f-illager';
    return null;
  }

  /**
   * Build a fragment of styled spans for a Text value.
   * opts: {baseColor, interactive, onClick(click_event, evt), baseStyle}
   */
  R.runs = function (value, ver, opts) {
    opts = opts || {};
    const frag = document.createDocumentFragment();
    const runs = T.flatten(value, ver, { baseStyle: opts.baseStyle });
    let hasObf = false;
    for (const r of runs) {
      const st = r.style || {};
      let el;
      if (r.kind === 'text') {
        el = h('span', { class: 'mcr', style: runStyle(st, opts.baseColor) }, r.text);
        if (st.obfuscated === true) {
          el.classList.add('mc-obf');
          el.dataset.src = r.text;
          hasObf = true;
          scramble(el);
        }
      } else if (r.kind === 'sprite') {
        const id = String(r.sprite || '').replace(/^.*\//, '');
        el = h('span', { class: 'mc-sprite', title: (r.atlas ? r.atlas + ' · ' : '') + r.sprite });
        el.appendChild(R.itemIcon(id));
      } else if (r.kind === 'head') {
        const name = typeof r.player === 'string' ? r.player : isObj(r.player) ? r.player.name || r.player.texture || '' : '';
        el = h('span', { class: 'mc-head', title: name ? 'Head of ' + name : 'Player head' });
      } else if (r.kind === 'unresolved') {
        el = h('span', { class: 'mcr mc-unres', style: runStyle(st, opts.baseColor), title: 'Not resolved inside dialogs' }, '⟨' + r.label + '⟩');
      } else continue;
      const font = fontClass(st.font);
      if (font) el.classList.add(font);
      if (st.hover_event) attachTip(el, st.hover_event, ver);
      if (st.click_event && opts.interactive !== false) {
        el.classList.add('link');
        el.addEventListener('click', (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          if (opts.onClick) opts.onClick(st.click_event, evt);
        });
      }
      frag.appendChild(el);
    }
    if (hasObf) ensureObf();
    return frag;
  };

  /** A span containing the runs. */
  R.line = function (value, ver, opts, cls) {
    const el = h('span', { class: cls || 'mc-line' });
    el.appendChild(R.runs(value, ver, opts));
    return el;
  };

  /* ------------------------------------------------------------------ *
   * Tooltips
   * ------------------------------------------------------------------ */
  let tipEl = null;
  const RARITY_COLOR = { common: 'white', uncommon: 'yellow', rare: 'aqua', epic: 'light_purple' };

  /** Tooltip element for an item stack ({id,count,components}) */
  R.itemTooltip = function (item, ver, extra) {
    const id = typeof item === 'string' ? item : item && item.id;
    const comps = (isObj(item) && isObj(item.components) ? item.components : {});
    const get = (k) => (comps['minecraft:' + k] !== undefined ? comps['minecraft:' + k] : comps[k]);
    const rarity = get('rarity') || 'common';
    const root = h('div', { class: 'mc-tip-body' });
    const color = RARITY_COLOR[rarity] || 'white';
    const custom = get('custom_name');
    const itemName = get('item_name');
    if (custom !== undefined) {
      root.appendChild(h('div', null, R.line(custom, ver, { interactive: false, baseStyle: { italic: true, color } })));
    } else if (itemName !== undefined) {
      root.appendChild(h('div', null, R.line(itemName, ver, { interactive: false, baseStyle: { color } })));
    } else {
      root.appendChild(h('div', null, R.line({ text: R.itemName(id, ver) }, ver, { interactive: false, baseStyle: { color } })));
    }
    const lore = get('lore');
    if (Array.isArray(lore)) {
      for (const l of lore.slice(0, 20)) root.appendChild(h('div', null, R.line(l, ver, { interactive: false, baseStyle: { color: 'dark_purple', italic: true } })));
    }
    const ench = get('enchantments');
    if (isObj(ench)) {
      for (const [k, lv] of Object.entries(ench)) {
        const bare = DMC.rl.bare(k);
        const nm = DMC.lang.get('enchantment.minecraft.' + bare, ver) || U.prettyId(bare);
        const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][lv] || String(lv);
        root.appendChild(h('div', { style: 'color:#AAAAAA' }, nm + (lv === 1 && ['mending', 'silk_touch', 'infinity', 'flame', 'channeling', 'aqua_affinity'].includes(bare) ? '' : ' ' + roman)));
      }
    }
    if (extra) root.appendChild(h('div', { style: 'color:#555555' }, extra));
    return root;
  };

  R.hoverTooltip = function (hover, ver) {
    if (!isObj(hover)) return null;
    if (hover.action === 'show_text') {
      return h('div', { class: 'mc-tip-body' }, R.line(hover.value === undefined ? '' : hover.value, ver, { interactive: false }));
    }
    if (hover.action === 'show_item') {
      return R.itemTooltip({ id: hover.id, count: hover.count, components: hover.components }, ver);
    }
    if (hover.action === 'show_entity') {
      const root = h('div', { class: 'mc-tip-body' });
      root.appendChild(h('div', null, hover.name !== undefined ? R.line(hover.name, ver, { interactive: false }) : R.entityName(hover.id, ver)));
      root.appendChild(h('div', { style: 'color:#AAAAAA' }, 'Type: ' + DMC.rl.norm(String(hover.id || ''))));
      root.appendChild(h('div', { style: 'color:#AAAAAA' }, String(Array.isArray(hover.uuid) ? '[I;…]' : hover.uuid || '')));
      return root;
    }
    return null;
  };

  function placeTip(evt) {
    if (!tipEl) return;
    const pad = 14;
    let x = evt.clientX + pad;
    let y = evt.clientY - pad;
    const r = tipEl.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = Math.max(8, evt.clientX - r.width - pad);
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - r.height - 8);
    tipEl.style.left = x + 'px';
    tipEl.style.top = Math.max(8, y) + 'px';
  }
  R.showTip = function (content, evt) {
    R.hideTip();
    if (!content) return;
    tipEl = h('div', { class: 'mc-tip', role: 'tooltip' }, content);
    document.body.appendChild(tipEl);
    placeTip(evt);
  };
  R.moveTip = placeTip;
  R.hideTip = function () {
    if (tipEl) { tipEl.remove(); tipEl = null; }
  };
  function attachTip(el, hover, ver) {
    el.addEventListener('mouseenter', (evt) => R.showTip(R.hoverTooltip(hover, ver), evt));
    el.addEventListener('mousemove', placeTip);
    el.addEventListener('mouseleave', R.hideTip);
  }
  R.attachTip = attachTip;
  /** Attach an arbitrary tooltip builder (used for buttons and items in the preview). */
  R.tipOn = function (el, build) {
    el.addEventListener('mouseenter', (evt) => R.showTip(build(), evt));
    el.addEventListener('mousemove', placeTip);
    el.addEventListener('mouseleave', R.hideTip);
  };
})();
