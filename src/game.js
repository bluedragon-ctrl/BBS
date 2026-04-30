// NETROMANCER.BBS — main entry. Wires modules and starts the boot sequence.

import { loadData } from './engine/data.js';
import { makeContext, executeAtoms, setDataRef, fireBarks } from './engine/atoms.js';
import { evalExpr } from './engine/expr.js';
import { makeRng, randomSeed } from './engine/rng.js';
import {
  cloneActor, makePlayerActor, startCombat, runCombat, buildEnemyActors,
} from './engine/combat.js';
import { initCombatUi, enterCombat, _currentCombat, _renderAll } from './ui/combat.js';
import { initMapUi } from './ui/map.js';
import { showTerminalSequence } from './ui/terminal.js';
import { initCodexUi, openCodex } from './ui/codex.js';
import { initInventoryUi, openInventory } from './ui/inventory.js';
import { loadCodex, wipeCodex } from './engine/codex.js';
import { initNodeUi } from './ui/nodes.js';
import {
  applyConnTier,
  triggerGlitch as glitchTrigger,
  startScheduler as startGlitchScheduler,
  tierFromConn,
} from './ui/glitch.js';
import { showScreen, activeScreen } from './screen.js';
import { initLog, logMessage, logFlavor, flushLog, awaitLogIdle, isTyping } from './log.js';
import {
  initRun, startNewRun, continueRun, saveAndQuit, resolveNode,
  persistRun, refreshContinueButton, wipeAllData,
} from './run.js';
import { hasSave } from './engine/save.js';

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
  bootCompleted: false,
  conn: 1.0,
  data: null,
  rng: null,
  seed: 0,
  run: null,
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

function triggerGlitch(type, intensity, target) {
  if (typeof target === 'string') target = document.querySelector(target);
  return glitchTrigger(type, intensity, target);
}

// ---- Boot sequence ----
async function runBootSequence() {
  const log = document.getElementById('boot-log');
  const menu = document.getElementById('boot-menu');
  const titleEl = document.getElementById('title-art');

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

async function handleMenuAction(action) {
  switch (action) {
    case 'new-run': startNewRun(); break;
    case 'continue':
      if (hasSave()) continueRun();
      else logMessage('No save to continue.');
      break;
    case 'codex': openCodex('boot'); break;
    case 'wipe':
      if (confirm('Wipe all save data and codex? This cannot be undone.')) {
        wipeAllData();
      }
      break;
    case 'quit':
      await showTerminalSequence([
        { text: '> CARRIER LOST', class: 'danger' },
        { text: '> GOODBYE.',     class: 'danger' },
      ], { theme: 'failure', dismissOn: 'persist', charMs: 22, lineDelayMs: 200 });
      break;
  }
}

// ---- Wiring ----
function wireButtons() {
  document.querySelectorAll('[data-screen="boot"] button').forEach(b => {
    b.addEventListener('click', () => handleMenuAction(b.dataset.action));
  });
}

function wireKeys() {
  window.addEventListener('keydown', (e) => {
    // Any keypress on any screen flushes the log strip's typing queue —
    // matches the equivalent click-anywhere behaviour wired in initLog.
    if (isTyping()) flushLog();
    if (activeScreen() === 'boot' && state.bootCompleted) {
      const map = { n: 'new-run', c: 'continue', k: 'codex', w: 'wipe', q: 'quit' };
      const action = map[e.key.toLowerCase()];
      if (action) handleMenuAction(action);
    }
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
  if (spell.cost?.conn) setConn(state.conn - spell.cost.conn / 100);

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
  const enemies = buildEnemyActors(state.data, enemyIds);
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
setDataRef(state.data);
loadCodex();

initLog({ getConn: () => state.conn });
initRun({ state, setConn });

initCombatUi({
  data: state.data,
  rng: state.rng,
  log: logMessage,
  logFlavor,
  awaitLogIdle,
  showScreen: name => { showScreen(name); },
  activeScreen,
  getConn: () => state.conn,
  onConnCost: (n) => setConn(state.conn - n / 100),
  onConnChange: (delta) => setConn(state.conn + delta),
});

initMapUi({
  data: state.data,
  log: logMessage,
  activeScreen,
  saveAndQuit,
  wipeAll: () => {
    if (confirm('Wipe all save data and codex? This cannot be undone.')) {
      wipeAllData();
    }
  },
  onChoice: (node) => resolveNode(node),
  openCodex: () => openCodex('map'),
  openInventory: () => openInventory('map'),
});

initCodexUi({
  data: state.data,
  activeScreen,
  showScreen: name => { showScreen(name); },
});

initInventoryUi({
  data: state.data,
  rng: state.rng,
  activeScreen,
  showScreen: name => { showScreen(name); },
  getRun: () => state.run,
  log: logMessage,
  persistRun,
});

initNodeUi({
  data: state.data,
  rng: state.rng,
  log: logMessage,
  logFlavor,
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
  openCodex,
  openInventory,
  cast: testCast,
  eval: testEval,
  combat: testCombat,
  enterCombat,
  makeStubPlayer, makeStubMonster, makePlayerActor, cloneActor,
  _currentCombat, _renderAll,
  showTerminalSequence,
  openCodex,
  wipeCodex,
  wipeAll: wipeAllData,
  fireBarks,
};

wireButtons();
wireKeys();
setConn(1.0);
startGlitchScheduler({ getConn: () => state.conn, log: logMessage });
runBootSequence();
