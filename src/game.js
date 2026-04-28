// NETROMANCER.BBS — main entry

import { loadData } from './engine/data.js';
import { makeContext, executeAtoms } from './engine/atoms.js';
import { evalExpr } from './engine/expr.js';
import { makeRng, randomSeed } from './engine/rng.js';
import {
  cloneActor, makePlayerActor, startCombat, runCombat,
} from './engine/combat.js';
import { initCombatUi, enterCombat, _currentCombat, _renderAll } from './ui/combat.js';
import { initMapUi, setRun as setMapRun, clearRun as clearMapRun, renderMap } from './ui/map.js';
import { showTerminalSequence } from './ui/terminal.js';
import { initCodexUi, openCodex } from './ui/codex.js';
import { loadCodex, wipeCodex } from './engine/codex.js';
import { initNodeUi, showShrine, showCache, showEvent, showShop, showBossIntro } from './ui/nodes.js';
import { generateMap, NODE_LABEL, NODE_FLAVOR } from './engine/map.js';
import { hasSave, save as saveSlot, load as loadSlot, wipe as wipeSave,
         serializeMap, deserializeMap } from './engine/save.js';
import {
  applyConnTier,
  triggerGlitch as glitchTrigger,
  startScheduler as startGlitchScheduler,
  tierFromConn,
  corruptionProb,
} from './ui/glitch.js';

const TITLE_ART = String.raw`
 _   _ _____ _____ ____   ___  __  __    _    _   _  ____ _____ ____
| \ | | ____|_   _|  _ \ / _ \|  \/  |  / \  | \ | |/ ___| ____|  _ \
|  \| |  _|   | | | |_) | | | | |\/| | / _ \ |  \| | |   |  _| | |_) |
| |\  | |___  | | |  _ <| |_| | |  | |/ ___ \| |\  | |___| |___|  _ <
|_| \_|_____| |_| |_| \_\\___/|_|  |_/_/   \_\_| \_|\____|_____|_| \_\
`;

const BOOT_LINES = [
  '> ATDT 555-0CCULT',
  '> RING',
  '> CONNECT 2400/ARQ/V42BIS',
  '',
  '> NETROMANCER.BBS // EST. 1987',
  '',
  '> LOGIN: SUMMONER',
  '> PASSWORD: ********',
  '> ACCESS GRANTED // RW',
  '',
  '> LOADING SHELL...',
];

// ---- App state ----
const state = {
  screen: 'boot',
  bootCompleted: false,
  conn: 1.0, // connection strength, 0–1
  data: null,
  rng: null,
  seed: 0,
  run: null, // { seed, map, currentNodeId, visitedIds, player, tokens }
};

// ---- Connection / glitch scaffolding ----
function setConn(v) {
  state.conn = Math.max(0, Math.min(1, v));
  document.documentElement.style.setProperty('--conn', state.conn);
  applyConnTier(state.conn);
  document.querySelectorAll('.conn-readout').forEach(readout => {
    const pct = readout.querySelector('.conn-pct');
    if (pct) pct.textContent = Math.round(state.conn * 100) + '%';
    readout.classList.toggle('danger', state.conn < 0.30);
    readout.classList.toggle('warn',   state.conn < 0.60 && state.conn >= 0.30);
  });
}

/**
 * Trigger a transient visual glitch.
 * @param {('scrambleText'|'dropChars'|'tearLine'|'colorSwap'|'corruptBorders')} type
 * @param {number} [intensity=0.5] 0..1
 * @param {Element|string} [target] element or selector; random glitchable if omitted
 */
function triggerGlitch(type, intensity, target) {
  if (typeof target === 'string') target = document.querySelector(target);
  return glitchTrigger(type, intensity, target);
}

// ---- Screen router ----
function showScreen(name) {
  document.querySelectorAll('#screen > section').forEach(s => {
    s.classList.toggle('active', s.dataset.screen === name);
  });
  state.screen = name;
}

// ---- Boot sequence ----
async function runBootSequence() {
  const log = document.getElementById('boot-log');
  const menu = document.getElementById('boot-menu');
  const titleEl = document.getElementById('title-art');

  // Title + menu appear underneath from the start; modal is an "incoming
  // BBS message" overlaying it, not a barrier.
  if (log) log.style.display = 'none';
  titleEl.textContent = TITLE_ART;
  menu.classList.remove('hidden');

  await showTerminalSequence(BOOT_LINES, {
    frame: true,
    dismissOn: 'auto',
    charMs: 22,
    lineDelayMs: 110,
  });

  state.bootCompleted = true;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- Menu actions ----
async function handleMenuAction(action) {
  switch (action) {
    case 'new-run':
      startNewRun();
      break;
    case 'continue':
      if (hasSave()) continueRun();
      else logMessage('No save to continue.');
      break;
    case 'codex':
      openCodex('boot');
      break;
    case 'quit':
      await showTerminalSequence([
        { text: '> CARRIER LOST', class: 'danger' },
        { text: '> GOODBYE.',     class: 'danger' },
      ], { theme: 'failure', dismissOn: 'persist', charMs: 22, lineDelayMs: 200 });
      break;
  }
}

function saveAndQuit() {
  persistRun();
  state.run = null;
  clearMapRun();
  refreshContinueButton();
  showScreen('boot');
}

function backToBoot() {
  state.run = null;
  clearMapRun();
  refreshContinueButton();
  showScreen('boot');
}

// ---- Log (typewriter with queue + flush) ----
const LOG_CHAR_MS = 30;
const LOG_MAX_LINES = 200;
const logQueue = [];
let logTyping = false;
let logFlush = false;

// Accepts either a plain string or an array of segments [{text, class?}].
function logMessage(entry) {
  logQueue.push(entry);
  if (!logTyping) drainLogQueue();
}

function toSegments(entry) {
  if (typeof entry === 'string') return [{ text: entry }];
  if (Array.isArray(entry)) return entry.map(s => typeof s === 'string' ? { text: s } : s);
  return [{ text: String(entry) }];
}

function activeLogBody() {
  return document.querySelector('section[data-screen].active .log-body')
      || document.querySelector('.log-body');
}

function isLogAtBottom(el, slack = 2) {
  if (!el) return true;
  return (el.scrollHeight - el.clientHeight - el.scrollTop) <= slack;
}

function scrollLogToBottom(el) {
  if (el) el.scrollTop = el.scrollHeight;
}

async function drainLogQueue() {
  const log = activeLogBody();
  if (!log) { logQueue.length = 0; logTyping = false; return; }
  logTyping = true;
  while (logQueue.length) {
    const segments = toSegments(logQueue.shift());
    const wasAtBottom = isLogAtBottom(log);
    const div = document.createElement('div');
    const prefix = document.createElement('span');
    prefix.textContent = '> ';
    div.appendChild(prefix);
    log.appendChild(div);
    while (log.children.length > LOG_MAX_LINES) log.removeChild(log.firstChild);
    if (wasAtBottom) scrollLogToBottom(log);

    for (const seg of segments) {
      const span = document.createElement('span');
      if (seg.class) span.className = seg.class;
      div.appendChild(span);
      if (logFlush) { span.textContent = seg.text; continue; }
      for (let i = 0; i < seg.text.length; i++) {
        if (logFlush) { span.textContent = seg.text; break; }
        // Connection-driven char corruption: substitute non-space chars
        // with a glyph from the corruption pool. Permanent — bytes arrived
        // wrong over the wire and stay that way.
        let ch = seg.text[i];
        const p = corruptionProb(state.conn);
        if (p > 0 && ch !== ' ' && ch !== '\n' && ch !== '\t' && Math.random() < p) {
          const pool = '▓░▒@#%&*?';
          ch = pool[Math.floor(Math.random() * pool.length)];
        }
        span.textContent += ch;
        if (isLogAtBottom(log, 4)) scrollLogToBottom(log);
        await sleep(LOG_CHAR_MS);
      }
    }
  }
  logTyping = false;
  logFlush = false;
}

function flushLog() {
  if (logTyping) logFlush = true;
}

// Resolves once the log queue is drained and the typewriter is idle.
// Used by combat to pace turns to readability.
function awaitLogIdle() {
  return new Promise(resolve => {
    const check = () => {
      if (!logTyping && logQueue.length === 0) resolve();
      else setTimeout(check, 40);
    };
    check();
  });
}

// ---- Run lifecycle ----

let runBusy = false;

function startNewRun() {
  wipeSave();
  state.seed = randomSeed();
  state.rng = makeRng(state.seed);
  state.conn = 1.0;
  state.run = {
    seed: state.seed,
    map: generateMap(state.rng),
    currentNodeId: null,
    previousNodeId: null,
    visitedIds: [],
    player: makePlayerActor(),
    tokens: 0,
  };
  state.run.currentNodeId = state.run.map.startId;
  state.run.visitedIds.push(state.run.map.startId);
  state.run.map.nodes.get(state.run.map.startId).visited = true;
  setConn(1.0);
  setMapRun(state.run);
  showScreen('map');
  renderMap();
  // Resolve the entry node immediately (it's a combat).
  resolveNode(state.run.map.nodes.get(state.run.map.startId), { entry: true });
}

function continueRun() {
  const data = loadSlot();
  if (!data) { logMessage('No save to continue.'); return; }
  wipeSave();
  state.seed = data.seed;
  state.rng = makeRng(data.seed);
  state.conn = data.conn ?? 1.0;
  state.run = {
    seed: data.seed,
    map: deserializeMap(data.map),
    currentNodeId: data.currentNodeId,
    previousNodeId: data.previousNodeId || null,
    visitedIds: data.visitedIds || [],
    player: data.player,
    tokens: data.tokens || 0,
  };
  setConn(state.conn);
  setMapRun(state.run);
  showScreen('map');
  renderMap();
}

function persistRun() {
  if (!state.run) return;
  saveSlot({
    seed: state.run.seed,
    map: serializeMap(state.run.map),
    currentNodeId: state.run.currentNodeId,
    previousNodeId: state.run.previousNodeId,
    visitedIds: state.run.visitedIds,
    player: state.run.player,
    tokens: state.run.tokens,
    conn: state.conn,
  });
}

function refreshContinueButton() {
  const btn = document.querySelector('[data-action="continue"]');
  const status = btn?.querySelector('.continue-status');
  if (!btn) return;
  if (hasSave()) {
    btn.disabled = false;
    if (status) status.textContent = '(suspended run)';
  } else {
    btn.disabled = true;
    if (status) status.textContent = '(no save)';
  }
}

async function resolveNode(node, opts = {}) {
  if (runBusy) return;
  runBusy = true;
  try {
    if (node.type === 'combat' || node.type === 'elite' || node.type === 'boss') {
      if (node.type === 'boss') await showBossIntro();
      state.run.player.stats.mp = state.run.player.stats.maxMp;
      state.run.player.statuses = [];
      const result = await enterCombat({
        enemies: node.encounter.enemyIds,
        player: state.run.player,
      });
      if (result.result === 'defeat') {
        wipeSave();
        return showGameOver('defeat');
      }
      if (result.result === 'flee') {
        showScreen('map');
        renderMap();
        return;
      }
      // Victory — clear combat statuses, grant token reward.
      state.run.player.statuses = [];
      grantCombatTokens(node.type);
    } else if (node.type === 'shrine') {
      await showShrine(node);
    } else if (node.type === 'cache') {
      await showCache(node);
    } else if (node.type === 'event') {
      await showEvent(node);
    } else if (node.type === 'shop') {
      await showShop(node);
    } else {
      await showStubNodeModal(node);
    }

    // Mark visited / advance.
    if (!opts.entry) {
      if (!state.run.visitedIds.includes(node.id)) state.run.visitedIds.push(node.id);
      node.visited = true;
      state.run.previousNodeId = state.run.currentNodeId;
      state.run.currentNodeId = node.id;
    }

    if (node.id === state.run.map.bossId) {
      wipeSave();
      return showGameOver('victory');
    }

    persistRun();
    showScreen('map');
    renderMap();
  } finally {
    runBusy = false;
  }
}

function grantCombatTokens(type) {
  let amt = 0;
  if (type === 'combat') amt = state.rng() < 0.5 ? 1 : 0;
  else if (type === 'elite') amt = 1 + Math.floor(state.rng() * 2); // 1-2
  else if (type === 'boss')  amt = 4 + 1 + Math.floor(state.rng() * 4); // 4 + 1d4 → 5-8
  if (amt > 0) {
    state.run.tokens = (state.run.tokens || 0) + amt;
    logMessage(`> +${amt} TOKEN${amt === 1 ? '' : 'S'}.`);
  }
}

function showStubNodeModal(node) {
  return new Promise(resolve => {
    const modal = document.getElementById('node-modal');
    const title = document.getElementById('node-modal-title');
    const body  = document.getElementById('node-modal-body');
    const frame = modal.querySelector('.modal-frame');
    frame.querySelectorAll('.modal-actions').forEach(el => el.remove());
    title.textContent = NODE_LABEL[node.type] || node.type.toUpperCase();
    body.textContent = (NODE_FLAVOR[node.type] || '') +
      '\n\nThis node type is not yet implemented. Press [Enter] to leave.';
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const btn = document.createElement('button');
    btn.className = 'modal-choice';
    btn.innerHTML = '<span class="key">[Enter]</span> LEAVE';
    btn.addEventListener('click', dismiss);
    actions.appendChild(btn);
    frame.appendChild(actions);
    modal.classList.remove('hidden');
    function dismiss() {
      modal.classList.add('hidden');
      document.removeEventListener('keydown', keyHandler);
      resolve();
    }
    function keyHandler(e) {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); dismiss(); }
    }
    document.addEventListener('keydown', keyHandler);
  });
}

async function showGameOver(kind) {
  state.run = null;
  clearMapRun();
  const lines = kind === 'victory' ? buildVictorySequence() : buildDeathSequence();
  await showTerminalSequence(lines, {
    theme: kind === 'victory' ? 'normal' : 'failure',
    dismissOn: 'press',
    charMs: 24,
    lineDelayMs: 130,
  });
  refreshContinueButton();
  showScreen('boot');
}

function buildDeathSequence() {
  return [
    { text: '> SIGNAL DEGRADING', class: 'warn' },
    { delay: 350 },
    { text: '> RECONNECT FAILED', class: 'warn' },
    { delay: 250 },
    { noise: '░▒▓█▓▒░' },
    { delay: 150 },
    { noise: '▓░█▒▓▒█' },
    { delay: 200 },
    { text: '> NO CARRIER', class: 'danger' },
    '',
    { text: '> USER PURGED.', class: 'danger' },
    '',
    '> [PRESS ENTER]',
  ];
}

function buildVictorySequence() {
  const lines = [
    '> EXPLOIT CHAIN COMPLETE',
    '> SYSOP CREDENTIALS ASSUMED',
    '',
  ];
  const monsters = state.data?.list('monsters') || [];
  const spells   = state.data?.list('spells') || [];
  const items    = state.data?.list('items') || [];
  if (monsters.length) {
    lines.push('> DUMPING /etc/monsters.dat');
    for (const m of monsters) lines.push(`>   ${m.id.padEnd(22)} [archived]`);
    lines.push({ delay: 200 });
  }
  if (spells.length) {
    lines.push('> DUMPING /etc/spells.dat');
    for (const s of spells)   lines.push(`>   ${s.id.padEnd(22)} [archived]`);
    lines.push({ delay: 200 });
  }
  if (items.length) {
    lines.push('> DUMPING /etc/items.dat');
    for (const it of items)   lines.push(`>   ${it.id.padEnd(22)} [archived]`);
    lines.push({ delay: 200 });
  }
  lines.push(
    '> DUMPING /etc/users.dat',
    '>   SYSOP                  [purged]',
    '',
    { text: '> THE BBS IS YOURS.', class: 'accent' },
    '',
    '> [PRESS ENTER]',
  );
  return lines;
}

// ---- Wiring ----
function wireButtons() {
  document.querySelectorAll('[data-screen="boot"] button').forEach(b => {
    b.addEventListener('click', () => handleMenuAction(b.dataset.action));
  });
  // Map screen buttons are wired by ui/map.js.
}

function wireKeys() {
  window.addEventListener('click', (e) => {
    if (logTyping && !e.target.closest('button')) flushLog();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      const log = activeLogBody();
      if (log) {
        const delta = e.key === 'PageUp' ? -log.clientHeight : log.clientHeight;
        log.scrollBy({ top: delta, behavior: 'smooth' });
        e.preventDefault();
        return;
      }
    }
    if (state.screen === 'map' && logTyping) flushLog();
    if (state.screen === 'boot' && state.bootCompleted) {
      const map = { n: 'new-run', c: 'continue', k: 'codex', q: 'quit' };
      const action = map[e.key.toLowerCase()];
      if (action) handleMenuAction(action);
    }
    // Map screen keys are handled in ui/map.js.
  });
}

// ---- Test helpers (devtools / preview eval) ----

function makeStubPlayer() {
  return {
    id: 'player', name: 'YOU',
    stats: { hp: 24, maxHp: 24, mp: 15, maxMp: 15, int: 6, atk: 4, def: 2, spd: 10 },
    statuses: [],
  };
}

function makeStubMonster(monsterId) {
  const def = state.data?.monster(monsterId);
  if (!def) return null;
  return {
    id: monsterId, name: def.name, defId: monsterId,
    stats: { ...def.stats },
    statuses: [],
  };
}

function testCast(spellId, opts = {}) {
  const spell = state.data?.spell(spellId);
  if (!spell) { logMessage(`unknown spell ${spellId}`); return; }
  const self = opts.self || makeStubPlayer();
  const target = opts.target || makeStubMonster('mon_glyph_wraith');

  if (spell.cost?.mp) {
    if ((self.stats.mp ?? 0) < spell.cost.mp) {
      logMessage(`Not enough MP for ${spell.name}.`);
      return;
    }
    self.stats.mp -= spell.cost.mp;
  }
  if (spell.cost?.conn) {
    setConn(state.conn - spell.cost.conn / 100);
  }

  const ctx = makeContext(self, target, {
    rng: state.rng,
    data: state.data,
    log: logMessage,
    allEnemies: target ? [target] : [],
    allAllies: [self],
  });
  logMessage(`You cast ${spell.name}.`);
  executeAtoms(spell.effects, ctx);
  return { self, target };
}

// Default scripted player AI for tests: cast bolt while MP allows, else basic attack.
function defaultGetPlayerAction(actor, combat) {
  const target = combat.actors.find(a => a.team === 'enemy' && (a.stats.hp ?? 0) > 0);
  if (!target) return { kind: 'wait' };
  if ((actor.stats.mp ?? 0) >= 4 && combat.data.spell('spl_bolt')) {
    return { kind: 'cast', spellId: 'spl_bolt', targetId: target.id };
  }
  return { kind: 'attack', targetId: target.id };
}

async function testCombat(opts = {}) {
  const enemyIds = opts.enemies || ['mon_glyph_wraith'];
  const player = opts.player || makePlayerActor();
  const enemies = enemyIds.map((id, i) => {
    const def = state.data.monster(id);
    if (!def) throw new Error(`Unknown monster ${id}`);
    return cloneActor(def, { id: `${id}__${i}`, team: 'enemy' });
  });
  const combat = startCombat({
    player, enemies, allies: opts.allies || [],
    data: state.data, rng: state.rng, log: logMessage,
  });
  const hooks = {
    getPlayerAction: opts.getPlayerAction || defaultGetPlayerAction,
    onConnCost: (n) => setConn(state.conn - n / 100),
  };
  return runCombat(combat, hooks);
}

function testEval(expression, ctxOverride = {}) {
  const self = ctxOverride.self || makeStubPlayer();
  const target = ctxOverride.target || makeStubMonster('mon_glyph_wraith');
  const ctx = makeContext(self, target, {
    rng: state.rng,
    data: state.data,
    log: logMessage,
    allEnemies: target ? [target] : [],
    allAllies: [self],
  });
  return evalExpr(expression, ctx);
}

// ---- Boot ----

state.seed = randomSeed();
state.rng = makeRng(state.seed);
state.data = await loadData();
loadCodex();

initCombatUi({
  data: state.data,
  rng: state.rng,
  log: logMessage,
  awaitLogIdle,
  showScreen: name => { showScreen(name); },
  activeScreen: () => state.screen,
  getConn: () => state.conn,
  onConnCost: (n) => setConn(state.conn - n / 100),
  onConnChange: (delta) => setConn(state.conn + delta),
});

initMapUi({
  log: logMessage,
  activeScreen: () => state.screen,
  saveAndQuit,
  onChoice: (node) => resolveNode(node),
  openCodex: () => openCodex('map'),
});

initCodexUi({
  data: state.data,
  activeScreen: () => state.screen,
  showScreen: name => { showScreen(name); },
});

initNodeUi({
  data: state.data,
  rng: state.rng,
  log: logMessage,
  getRun: () => state.run,
  getConn: () => state.conn,
  setConn,
  persistRun,
});

refreshContinueButton();

window.netro = {
  state, setConn, triggerGlitch,
  tierFromConn,
  glitch: {
    fire: triggerGlitch,
    scramble:  (sel, i = 0.5) => triggerGlitch('scrambleText',   i, sel),
    drop:      (sel, i = 0.4) => triggerGlitch('dropChars',      i, sel),
    tear:      (sel, i = 0.6) => triggerGlitch('tearLine',       i, sel),
    swap:      (sel, i = 0.6) => triggerGlitch('colorSwap',      i, sel),
    border:    (sel, i = 0.5) => triggerGlitch('corruptBorders', i, sel),
    setTier:   (t) => setConn(1 - t / 10 - 0.001),
  },
  data: state.data,
  cast: testCast,
  eval: testEval,
  combat: testCombat,
  enterCombat,
  makeStubPlayer, makeStubMonster, makePlayerActor, cloneActor,
  _currentCombat, _renderAll,
  showTerminalSequence,
  openCodex,
  wipeCodex,
};

wireButtons();
wireKeys();
setConn(1.0);
startGlitchScheduler({ getConn: () => state.conn, log: logMessage });
runBootSequence();
