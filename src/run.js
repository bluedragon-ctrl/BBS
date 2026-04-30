// Run lifecycle — start/continue/persist, node resolution, game-over.

import { makeRng, randomSeed } from './engine/rng.js';
import { makePlayerActor } from './engine/combat.js';
import { addWearable } from './engine/loadout.js';
import { generateMap, NODE_LABEL, NODE_FLAVOR } from './engine/map.js';
import {
  hasSave, save as saveSlot, load as loadSlot, wipe as wipeSave,
  serializeMap, deserializeMap,
} from './engine/save.js';
import { setRun as setMapRun, clearRun as clearMapRun, renderMap } from './ui/map.js';
import { enterCombat } from './ui/combat.js';
import {
  showShrine, showCache, showEvent, showShop, showBossIntro, showShell, showNodeModal,
} from './ui/nodes.js';
import { showTerminalSequence } from './ui/terminal.js';
import { showScreen } from './screen.js';
import { logMessage } from './log.js';
import { formatTokens } from './ui/util.js';
import { wipeCodex } from './engine/codex.js';
import { wipeFlags } from './engine/flags.js';
import { wipeUnlocks, bankLoadout } from './engine/unlocks.js';

let state = null;
let setConn = () => {};

export function initRun(d) {
  state = d.state;
  setConn = d.setConn;
}

let runBusy = false;

export function startNewRun() {
  wipeSave();
  state.seed = randomSeed();
  state.rng = makeRng(state.seed);
  state.conn = 1.0;
  state.run = {
    seed: state.seed,
    level: 1,
    map: generateMap(state.rng, state.data, 1),
    currentNodeId: null,
    previousNodeId: null,
    visitedIds: [],
    player: makePlayerActor(),
    tokens: 0,
    seenEvents: [],
  };
  state.run.currentNodeId = state.run.map.startId;
  state.run.visitedIds.push(state.run.map.startId);
  state.run.map.nodes.get(state.run.map.startId).visited = true;
  setConn(1.0);
  setMapRun(state.run);
  showScreen('map');
  renderMap();
  // Show the shell-prompt entry; player browses inventory/codex from the map after.
  resolveNode(state.run.map.nodes.get(state.run.map.startId), { entry: true });
}

export function continueRun() {
  const data = loadSlot();
  if (!data) { logMessage('No save to continue.'); return; }
  wipeSave();
  state.seed = data.seed;
  state.rng = makeRng(data.seed);
  state.conn = data.conn ?? 1.0;
  state.run = {
    seed: data.seed,
    level: data.level ?? 1,
    map: deserializeMap(data.map),
    currentNodeId: data.currentNodeId,
    previousNodeId: data.previousNodeId || null,
    visitedIds: data.visitedIds || [],
    player: data.player,
    tokens: data.tokens || 0,
    seenEvents: data.seenEvents || [],
  };
  setConn(state.conn);
  setMapRun(state.run);
  showScreen('map');
  renderMap();
}

export function persistRun() {
  if (!state.run) return;
  saveSlot({
    seed: state.run.seed,
    level: state.run.level ?? 1,
    map: serializeMap(state.run.map),
    currentNodeId: state.run.currentNodeId,
    previousNodeId: state.run.previousNodeId,
    visitedIds: state.run.visitedIds,
    player: state.run.player,
    tokens: state.run.tokens,
    conn: state.conn,
    seenEvents: state.run.seenEvents || [],
  });
}

export function saveAndQuit() {
  persistRun();
  state.run = null;
  clearMapRun();
  refreshContinueButton();
  showScreen('boot');
}

export function backToBoot() {
  state.run = null;
  clearMapRun();
  refreshContinueButton();
  showScreen('boot');
}

// Full data reset — wipes the suspended save AND the persistent codex,
// clears in-memory run state, resets CONN, returns to boot. Used by the
// boot-menu and map-screen "WIPE DATA" actions and exposed on window.netro.
export function wipeAllData() {
  wipeSave();
  wipeCodex();
  wipeFlags();
  wipeUnlocks();
  state.run = null;
  state.conn = 1.0;
  setConn(1.0);
  clearMapRun();
  refreshContinueButton();
  logMessage('> All save data and codex wiped.');
  showScreen('boot');
}

export function refreshContinueButton() {
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

export async function resolveNode(node, opts = {}) {
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
        scene: node.scene || null,
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
      // Victory — clear combat statuses, grant token reward, resolve loot drops,
      // bank persistent unlocks for everything currently in the player's kit.
      state.run.player.statuses = [];
      grantCombatTokens(node.type);
      grantCombatLoot(result.finalCombat);
      bankLoadout(state.run.player.loadout);
    } else if (node.type === 'shell') {
      await showShell(node);
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
  else if (type === 'boss')  amt = 5 + Math.floor(state.rng() * 4); // 4 + 1d4 → 5-8
  if (amt > 0) {
    state.run.tokens = (state.run.tokens || 0) + amt;
    logMessage(`> +${formatTokens(amt)}.`);
  }
}

function grantCombatLoot(combat) {
  if (!combat?.actors) return;
  for (const actor of combat.actors) {
    if (!actor.dead || actor.team !== 'enemy' || !actor.defId) continue;
    const def = state.data.monster(actor.defId);
    if (!def?.loot?.length) continue;
    for (const entry of def.loot) {
      const id     = typeof entry === 'string' ? entry : entry.id;
      const chance = typeof entry === 'string' ? 1.0   : (entry.chance ?? 1.0);
      if (!id || state.rng() > chance) continue;
      const item = state.data.item(id);
      if (!item) continue;
      if (item.kind === 'wearable') {
        if (addWearable(state.run.player, id)) {
          logMessage(`> ${actor.name} dropped ${item.name}.`);
        }
      } else if (item.kind === 'consumable') {
        state.run.player.loadout.consumables.push(id);
        logMessage(`> ${actor.name} dropped ${item.name}.`);
      }
    }
  }
}

function showStubNodeModal(node) {
  const baseFlavor = (node.scene?.room || NODE_FLAVOR[node.type] || '') +
    '\n\nThis node type is not yet implemented. Press [Enter] to leave.';
  return showNodeModal({
    title: NODE_LABEL[node.type] || node.type.toUpperCase(),
    flavor: baseFlavor,
    choices: [{ key: 'L', label: 'LEAVE', isLeave: true }],
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
