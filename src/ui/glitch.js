// Glitch primitives + ambient connection-driven scheduler.
//
// Public API:
//   applyConnTier(conn)   - call from setConn; updates :root tier class.
//   triggerGlitch(type, intensity?, target?) - one-shot effect.
//   startScheduler({ getConn, rng })         - begin ambient ticker.
//   stopScheduler()
//
// Five primitives: scrambleText, dropChars, tearLine, colorSwap, corruptBorders.
// Each returns a Promise that resolves when the effect ends.

const SCRAMBLE_GLYPHS = '▓░▒█@#%&*$?!=+<>/\\|~^';
const BOX_CORRUPT     = '╳╫╪▓░▒┼╋';
const NAME_CORRUPT    = '▓░▒%@#?*';

const PRIMITIVES = ['scrambleText', 'dropChars', 'tearLine', 'colorSwap', 'corruptBorders'];

// Per-tier *permanent* substitution probability for typewriter and monster
// names. Subtle at low tiers, increasingly disruptive at high. See item 5/6.
const CORRUPT_P = [0, 0.003, 0.01, 0.02, 0.03, 0.045, 0.06, 0.085, 0.105, 0.13];

// Fake BBS error spam injected into the log at tier 5+. Reads like authentic
// terminal noise — packet trouble, CRC failures, frame realignment.
const FAKE_LOG_LINES = [
  '> [ERR] crc mismatch @ 0x4F',
  '> [WARN] frame realignment failed',
  '> [ERR] packet dropped (seq=42)',
  '> [WARN] retransmit window exceeded',
  '> [ERR] checksum invalid',
  '> [WARN] buffer underrun',
  '> [ERR] uart fifo overflow',
  '> [WARN] handshake timeout',
  '> [ERR] xmodem block rejected',
  '> [WARN] line noise detected',
];

// Fake-log probability per scheduler tick (only at tier 5+).
const FAKE_LOG_P = [0, 0, 0, 0, 0, 0.30, 0.40, 0.50, 0.60, 0.70];

// Per-tier scheduler config. tier 0 = clean (90-100% conn), tier 9 = catastrophic.
// Visual-only in phase A; gameplay tampering tags are reserved for phase B.
const TIERS = [
  { rollMs: 0,    chance: 0,    pool: [],                                                          maxChain: 0 }, // 0
  { rollMs: 8000, chance: 0.30, pool: ['scrambleText'],                                            maxChain: 1 }, // 1
  { rollMs: 6000, chance: 0.45, pool: ['scrambleText', 'dropChars'],                               maxChain: 1 }, // 2
  { rollMs: 4500, chance: 0.55, pool: ['scrambleText', 'dropChars', 'colorSwap'],                  maxChain: 1 }, // 3
  { rollMs: 4500, chance: 0.55, pool: ['scrambleText', 'dropChars', 'colorSwap', 'tearLine', 'corruptBorders'],  maxChain: 1 }, // 4
  { rollMs: 3500, chance: 0.65, pool: ['scrambleText', 'dropChars', 'colorSwap', 'tearLine', 'corruptBorders'],  maxChain: 1 }, // 5
  { rollMs: 3000, chance: 0.70, pool: ['scrambleText', 'dropChars', 'colorSwap', 'tearLine', 'corruptBorders'], maxChain: 2 }, // 6
  { rollMs: 2400, chance: 0.75, pool: ['scrambleText', 'dropChars', 'colorSwap', 'tearLine', 'corruptBorders'], maxChain: 2 }, // 7
  { rollMs: 2000, chance: 0.85, pool: ['scrambleText', 'dropChars', 'colorSwap', 'tearLine', 'corruptBorders'], maxChain: 2 }, // 8
  { rollMs: 1500, chance: 0.95, pool: ['scrambleText', 'dropChars', 'colorSwap', 'tearLine', 'corruptBorders'], maxChain: 3 }, // 9
];

/**
 * Permanently substitute characters in `s` with corruption glyphs.
 * Used by the typewriter and monster-name corruption — the result is meant
 * to be written into the DOM and stay there.
 */
export function corruptString(s, p, glyphs = SCRAMBLE_GLYPHS) {
  if (!s || p <= 0) return s;
  const chars = s.split('');
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === ' ' || c === '\n' || c === '\t') continue;
    if (Math.random() < p) chars[i] = glyphs[Math.floor(Math.random() * glyphs.length)];
  }
  return chars.join('');
}

export function corruptionProb(conn) {
  return CORRUPT_P[tierFromConn(conn)] ?? 0;
}

export function corruptName(s, conn) {
  return corruptString(s, corruptionProb(conn), NAME_CORRUPT);
}

export function tierFromConn(conn) {
  // 0.90..1.00 => 0; 0.80..0.90 => 1; ... 0..0.10 => 9
  const c = Math.max(0, Math.min(1, conn));
  if (c >= 1) return 0;
  return Math.min(9, Math.max(0, Math.floor((1 - c) * 10)));
}

let lastTier = 0;

export function applyConnTier(conn) {
  const tier = tierFromConn(conn);
  const root = document.documentElement;
  for (let i = 0; i <= 9; i++) root.classList.remove('tier-' + i);
  root.classList.add('tier-' + tier);
  root.style.setProperty('--conn-tier', String(tier));
  // Telegraph: when tier worsens, fire a guaranteed one-shot so the player
  // sees the BBS hiccup as connection degrades past a boundary.
  if (tier > lastTier && tier > 0) {
    const cfg = TIERS[tier];
    const intensity = 0.35 + (tier / 9) * 0.55;
    const type = cfg.pool[Math.floor(Math.random() * cfg.pool.length)] || 'scrambleText';
    // Defer one frame so any DOM updates from the same setConn settle first.
    requestAnimationFrame(() => triggerGlitch(type, intensity));
  }
  lastTier = tier;
  return tier;
}

// ---------- Primitives ----------

const sleep = ms => new Promise(r => setTimeout(r, ms));

function pickGlyphs(n, pool) {
  let out = '';
  for (let i = 0; i < n; i++) out += pool[Math.floor(Math.random() * pool.length)];
  return out;
}

// Walks descendant text nodes, returns array of {node, text}.
function textNodesIn(el) {
  const result = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeValue && /\S/.test(n.nodeValue)) result.push(n);
  }
  return result;
}

async function scrambleText(target, intensity = 0.4, durationMs = 160) {
  if (!target || target._glxBusy) return;
  target._glxBusy = true;
  const nodes = textNodesIn(target);
  if (!nodes.length) { target._glxBusy = false; return; }
  const originals = nodes.map(n => n.nodeValue);
  // Mutate each node: replace ~intensity fraction of non-space chars.
  const frac = Math.max(0.05, Math.min(0.9, intensity));
  for (let i = 0; i < nodes.length; i++) {
    const s = originals[i];
    const chars = s.split('');
    for (let j = 0; j < chars.length; j++) {
      if (chars[j] === ' ' || chars[j] === '\n') continue;
      if (Math.random() < frac) chars[j] = SCRAMBLE_GLYPHS[Math.floor(Math.random() * SCRAMBLE_GLYPHS.length)];
    }
    nodes[i].nodeValue = chars.join('');
  }
  await sleep(durationMs);
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].parentNode) nodes[i].nodeValue = originals[i];
  }
  target._glxBusy = false;
}

async function dropChars(target, intensity = 0.3, durationMs = 140) {
  if (!target || target._glxBusy) return;
  target._glxBusy = true;
  const nodes = textNodesIn(target);
  if (!nodes.length) { target._glxBusy = false; return; }
  const originals = nodes.map(n => n.nodeValue);
  const frac = Math.max(0.05, Math.min(0.7, intensity));
  for (let i = 0; i < nodes.length; i++) {
    const s = originals[i];
    const chars = s.split('');
    for (let j = 0; j < chars.length; j++) {
      if (chars[j] === ' ' || chars[j] === '\n') continue;
      if (Math.random() < frac) chars[j] = ' ';
    }
    nodes[i].nodeValue = chars.join('');
  }
  await sleep(durationMs);
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].parentNode) nodes[i].nodeValue = originals[i];
  }
  target._glxBusy = false;
}

async function tearLine(target, intensity = 0.5, durationMs = 180) {
  if (!target) return;
  const px = Math.round(4 + intensity * 14);
  const cls = 'glx-tear';
  target.style.setProperty('--glx-tear-px', px + 'px');
  target.classList.add(cls);
  await sleep(durationMs);
  target.classList.remove(cls);
  target.style.removeProperty('--glx-tear-px');
}

async function colorSwap(target, intensity = 0.5, durationMs = 220) {
  if (!target) return;
  const cls = intensity > 0.6 ? 'glx-colorswap-strong' : 'glx-colorswap';
  target.classList.add(cls);
  await sleep(durationMs);
  target.classList.remove(cls);
}

async function corruptBorders(target, intensity = 0.5, durationMs = 320) {
  if (!target) return;
  target.classList.add('glx-corrupt-border');
  await sleep(durationMs);
  target.classList.remove('glx-corrupt-border');
}

const PRIMITIVE_FNS = {
  scrambleText, dropChars, tearLine, colorSwap, corruptBorders,
};

export function triggerGlitch(type, intensity, target) {
  const fn = PRIMITIVE_FNS[type];
  if (!fn) return Promise.resolve();
  if (typeof intensity !== 'number') intensity = 0.5;
  if (!target) target = pickRandomGlitchable() || document.body;
  // For text-mutating primitives, ensure target carries text.
  if ((type === 'scrambleText' || type === 'dropChars') && !textNodesIn(target).length) {
    target = pickRandomGlitchable({ textOnly: true }) || target;
  }
  return fn(target, intensity);
}

// ---------- Target selection ----------

function activeScreen() {
  return document.querySelector('section[data-screen].active') || document.body;
}

function pickRandomGlitchable(opts = {}) {
  const scope = activeScreen();
  let pool = [...scope.querySelectorAll('[data-glitchable]')];
  if (opts.textOnly) pool = pool.filter(el => textNodesIn(el).length > 0);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------- Scheduler ----------

let schedTimer = null;
let schedDeps = null;

export function startScheduler(deps) {
  schedDeps = deps;
  scheduleNext();
}

export function stopScheduler() {
  if (schedTimer) clearTimeout(schedTimer);
  schedTimer = null;
}

function scheduleNext() {
  if (schedTimer) clearTimeout(schedTimer);
  const tier = tierFromConn(schedDeps?.getConn?.() ?? 1);
  const cfg = TIERS[tier];
  if (!cfg.rollMs) {
    // Tier 0 — recheck in 2s in case conn drops.
    schedTimer = setTimeout(scheduleNext, 2000);
    return;
  }
  // Add ±25% jitter so cadence doesn't feel mechanical.
  const jitter = 0.75 + Math.random() * 0.5;
  schedTimer = setTimeout(tick, cfg.rollMs * jitter);
}

async function tick() {
  const modalOpen = !!document.querySelector('.modal:not(.hidden)');
  const tier = tierFromConn(schedDeps?.getConn?.() ?? 1);
  const cfg = TIERS[tier];

  // Fake BBS error log spam — independent roll, runs even when scrambles
  // are skipped due to a modal (the BBS keeps complaining).
  if (FAKE_LOG_P[tier] && schedDeps?.log && Math.random() < FAKE_LOG_P[tier]) {
    const line = FAKE_LOG_LINES[Math.floor(Math.random() * FAKE_LOG_LINES.length)];
    schedDeps.log(line);
  }

  if (!modalOpen && cfg.rollMs && Math.random() < cfg.chance) {
    const chainLen = 1 + Math.floor(Math.random() * cfg.maxChain);
    for (let i = 0; i < chainLen; i++) {
      const type = cfg.pool[Math.floor(Math.random() * cfg.pool.length)];
      const intensity = 0.3 + (tier / 9) * 0.6;
      triggerGlitch(type, intensity);
      if (i < chainLen - 1) await sleep(80 + Math.random() * 140);
    }
  }
  scheduleNext();
}
