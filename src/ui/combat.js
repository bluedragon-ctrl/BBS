// Combat UI — renders combatant list / stats / inspect, handles input,
// drives the engine via getPlayerAction promises.

import { startCombat, runCombat, makePlayerActor, buildEnemyActors } from '../engine/combat.js';
import { ticksUntilAct, isAlive } from '../engine/scheduler.js';
import { effectiveStat } from '../engine/atoms.js';
import { formatSceneString, sceneContextFromCombat } from '../engine/scene.js';
import { showTerminalSequence } from './terminal.js';
import { triggerGlitch, corruptName } from './glitch.js';
import { sleep, escapeHtml, formatSpellCost, countBy, formatStatsBlock, formatStatLine } from './util.js';

let deps = null;          // { data, rng, log, logFlavor, awaitLogIdle, showScreen, activeScreen, getConn, onConnCost }
let currentCombat = null;
let resolvePlayerAction = null;
let uiState = 'idle';     // 'idle' | 'inspectMode' | 'pickTarget' | 'pickSpell' | 'awaitingEngine'
let pendingAction = null;
let inspectActorId = null;
let spellFocusIndex = 0;
let targetFocusIndex = 0;
let connDrainedThisTurn = 0;
let currentScene = null;  // { room, pre, post } from the active node — null when absent
let lastStatsHtml = '';
let lastInspectHtml = '';
let lastListHtml = '';

export function initCombatUi(d) {
  deps = d;
  wireButtons();
  wireRowClicks();
  wireSpellModalBackdrop();
  wireKeys();
}

// Debug accessors for devtools / preview eval — not for game logic.
export function _currentCombat() { return currentCombat; }
export function _renderAll() { renderAll(); }

// Split a log string into segments, wrapping any combat actor's name
// in a class corresponding to that actor's team. Pure — takes the actor list explicitly.
function colorizeActorNames(msg, allActors) {
  if (typeof msg !== 'string' || !allActors?.length) return msg;
  const actors = [...allActors].sort((a, b) => b.name.length - a.name.length);
  const segments = [];
  let cursor = 0;
  while (cursor < msg.length) {
    let earliest = null;
    for (const a of actors) {
      if (!a.name) continue;
      const idx = msg.indexOf(a.name, cursor);
      if (idx >= 0 && (!earliest || idx < earliest.idx)) {
        earliest = { idx, actor: a };
      }
    }
    if (!earliest) {
      segments.push({ text: msg.slice(cursor) });
      break;
    }
    if (earliest.idx > cursor) segments.push({ text: msg.slice(cursor, earliest.idx) });
    const cls = earliest.actor.team === 'enemy' ? 'log-enemy' : 'log-player';
    segments.push({ text: earliest.actor.name, class: cls });
    cursor = earliest.idx + earliest.actor.name.length;
  }
  return segments.length === 1 ? segments[0].text : segments;
}

export async function enterCombat({ enemies = ['mon_glyph_wraith'], player = null, scene = null } = {}) {
  if (!player) player = makePlayerActor();

  const conn = deps.getConn?.() ?? 1;
  const enemyActors = buildEnemyActors(deps.data, enemies);
  // Snapshot the BBS's view of each name. Worse connection at spawn =
  // more characters arrive wrong. Stable for the fight.
  for (const a of enemyActors) a.name = corruptName(a.name, conn);

  currentScene = scene || null;

  currentCombat = startCombat({
    player, enemies: enemyActors,
    data: deps.data, rng: deps.rng,
    log: msg => deps.log(colorizeActorNames(msg, currentCombat?.actors)),
    onConnChange: (delta) => {
      deps.onConnChange?.(delta);
      if (delta < 0) connDrainedThisTurn += -delta;
    },
  });

  // Default inspect to "nothing selected" so room flavor surfaces; player
  // can arrow/click to inspect actors instead.
  inspectActorId = null;
  uiState = 'idle';
  pendingAction = null;
  setPrompt('');
  deps.showScreen('combat');
  renderAll();

  // Pre-flavor: type into the log and let it land before the scheduler starts.
  if (currentScene?.pre && deps.logFlavor) {
    const ctx = sceneContextFromCombat(currentCombat);
    deps.logFlavor(formatSceneString(currentScene.pre, ctx));
    if (deps.awaitLogIdle) await deps.awaitLogIdle();
  }

  const { result } = await runCombat(currentCombat, {
    getPlayerAction: handleGetPlayerAction,
    onConnCost: deps.onConnCost,
    onTick: async () => {
      renderTitleBar();
      renderCombatList();
      await sleep(80);
    },
    onAfterAction: async () => {
      renderAll();
      if (deps.awaitLogIdle) await deps.awaitLogIdle();
      if (connDrainedThisTurn > 0) {
        const pct = Math.round(connDrainedThisTurn * 100);
        await showTerminalSequence([
          { text: '> Connectivity degradation detected...', class: 'warn' },
          { text: `> -${pct}% signal integrity`, class: 'danger' },
        ], { theme: 'alarm', dismissOn: 'auto', charMs: 18, lineDelayMs: 80 });
        // Punctuate the drain with a small data-corruption flourish on a
        // single random glitchable element. Avoid touching .main-pane —
        // animating the whole combat list reads as a full redraw.
        const intensity = Math.min(0.9, 0.3 + connDrainedThisTurn * 4);
        triggerGlitch('scrambleText', intensity);
        connDrainedThisTurn = 0;
      }
      await sleep(250);
    },
  });

  setPrompt(`COMBAT ENDED: ${result.toUpperCase()}`);
  renderAll();

  // Post-flavor: only on victory, and only if scene has a post line.
  // Drop selection so inspect falls back to the room, then type the post line
  // and gate the screen exit on a player keypress / click.
  if (result === 'victory' && currentScene?.post && deps.logFlavor) {
    inspectActorId = null;
    renderInspect();
    const ctx = sceneContextFromCombat(currentCombat);
    deps.logFlavor(formatSceneString(currentScene.post, ctx));
    if (deps.awaitLogIdle) await deps.awaitLogIdle();
    setPrompt('[press any key to leave]');
    await waitForDismiss();
  } else {
    await sleep(1200);
  }

  currentScene = null;
  return { result, player, finalCombat: currentCombat };
}

function waitForDismiss() {
  return new Promise(resolve => {
    function onKey(e) {
      // Ignore modifier keys so a stray Ctrl/Shift doesn't accidentally dismiss.
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      cleanupPrimary();
      e.preventDefault();
      e.stopImmediatePropagation();
      // Swallow any further keydown of this same key until the player releases
      // it — prevents auto-repeat (or a still-held key) from leaking into the
      // newly-active map screen and immediately confirming the focused node.
      armSwallow(e.key);
      resolve();
    }
    function onClick(e) {
      if (e.target.closest('button')) return; // let the button bar work normally
      cleanupPrimary();
      resolve();
    }
    function cleanupPrimary() {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('click', onClick, true);
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('click', onClick, true);
  });
}

// Swallow further keydowns of `key` (capture phase, before any screen handler)
// until the corresponding keyup fires. Self-cleans on release.
function armSwallow(key) {
  function swallow(e) {
    if (e.key === key) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
  function release(e) {
    if (e.key !== key) return;
    window.removeEventListener('keydown', swallow, true);
    window.removeEventListener('keyup', release, true);
  }
  window.addEventListener('keydown', swallow, true);
  window.addEventListener('keyup', release, true);
}

// ---------- Engine bridge ----------

function handleGetPlayerAction(_actor) {
  if (resolvePlayerAction) console.warn('overlapping getPlayerAction — previous resolver dropped');
  renderAll();
  uiState = 'idle';
  setPrompt('Your turn — [A]ttack [C]ast [I]tem [W]ait [X]Inspect [F]lee');
  return new Promise(resolve => { resolvePlayerAction = resolve; });
}

function resolveAction(action) {
  if (!resolvePlayerAction) return;
  const r = resolvePlayerAction;
  resolvePlayerAction = null;
  uiState = 'awaitingEngine';
  pendingAction = null;
  clearTargetable();
  setPrompt('');
  r(action);
}

// ---------- Buttons ----------

function wireButtons() {
  document.querySelectorAll('section[data-screen="combat"] .button-bar button').forEach(b => {
    b.addEventListener('click', () => handleAction(b.dataset.action));
  });
}

function handleAction(action) {
  if (!resolvePlayerAction) return;
  switch (action) {
    case 'attack':
      pendingAction = { kind: 'attack' };
      enterPickTarget('enemies');
      break;
    case 'cast':
      openSpellModal();
      break;
    case 'item':
      openItemModal();
      break;
    case 'wait':
      resolveAction({ kind: 'wait' });
      break;
    case 'inspect':
      uiState = uiState === 'inspectMode' ? 'idle' : 'inspectMode';
      setPrompt(uiState === 'inspectMode'
        ? 'Inspect mode — click any combatant. [Esc] back.'
        : 'Your turn — [A]ttack [C]ast [I]tem [W]ait [X]Inspect [F]lee');
      break;
    case 'flee':
      resolveAction({ kind: 'flee' });
      break;
  }
}

// ---------- Targeting ----------

function enterPickTarget(scope) {
  uiState = 'pickTarget';
  for (const row of document.querySelectorAll('.combat-row')) {
    const id = row.dataset.actorId;
    const actor = currentCombat.actors.find(a => a.id === id);
    const valid = actor && isAlive(actor) && (
      scope === 'enemies' ? actor.team === 'enemy'
      : scope === 'allies' ? actor.team !== 'enemy'
      : scope === 'self'   ? actor.isPlayer
      : true
    );
    row.classList.toggle('targetable', !!valid);
  }
  targetFocusIndex = 0;
  updateTargetFocus();
  syncInspectWithFocused();
  const count = targetableRows().length;
  setPrompt(count <= 1
    ? 'Pick a target — [Enter] to confirm. [Esc] cancel.'
    : 'Pick a target — [↑↓] move, [Enter] confirm, [1-9] direct, [Esc] cancel.');
}

function targetableRows() {
  return [...document.querySelectorAll('.combat-row.targetable')];
}

function updateTargetFocus() {
  const rows = targetableRows();
  rows.forEach((row, i) => row.classList.toggle('target-focused', i === targetFocusIndex));
}

function syncInspectWithFocused() {
  const rows = targetableRows();
  const row = rows[targetFocusIndex];
  if (!row) return;
  inspectActorId = row.dataset.actorId;
  renderInspect();
  // refresh row "selected" highlight without rebuilding the list
  document.querySelectorAll('.combat-row').forEach(el => {
    el.classList.toggle('selected', el.dataset.actorId === inspectActorId);
  });
}

function moveTargetFocus(delta) {
  const rows = targetableRows();
  if (!rows.length) return;
  targetFocusIndex = (targetFocusIndex + delta + rows.length) % rows.length;
  updateTargetFocus();
  syncInspectWithFocused();
}

function confirmFocusedTarget() {
  const rows = targetableRows();
  const row = rows[targetFocusIndex];
  if (!row) return;
  const actor = currentCombat.actors.find(a => a.id === row.dataset.actorId);
  if (actor) completeTargetPick(actor);
}

function clearTargetable() {
  document.querySelectorAll('.combat-row.targetable, .combat-row.target-focused')
    .forEach(el => el.classList.remove('targetable', 'target-focused'));
}

function completeTargetPick(target) {
  resolveAction({ ...pendingAction, targetId: target.id });
}

function cancelPick() {
  if (uiState === 'pickSpell') closeSpellModal();
  if (uiState === 'pickItem')  closeItemModal();
  if (uiState === 'pickTarget' || uiState === 'pickSpell' || uiState === 'pickItem' || uiState === 'inspectMode') {
    pendingAction = null;
    clearTargetable();
    uiState = 'idle';
    if (resolvePlayerAction) {
      setPrompt('Your turn — [A]ttack [C]ast [I]tem [W]ait [X]Inspect [F]lee');
    }
  }
}

// ---------- Spell modal ----------

function openSpellModal() {
  const player = currentCombat.actors.find(a => a.isPlayer);
  const knownIds = player.loadout?.spells || [];
  const list = document.getElementById('spell-list');
  list.innerHTML = '';
  knownIds.forEach((spellId, i) => {
    const sp = deps.data.spell(spellId);
    if (!sp) return;
    const mpOk = (player.stats.mp ?? 0) >= (sp.cost?.mp ?? 0);
    const connOk = deps.getConn() * 100 >= (sp.cost?.conn ?? 0);
    const enabled = mpOk && connOk;
    const li = document.createElement('li');
    li.className = `school-${sp.school}`;
    if (!enabled) li.classList.add('disabled');
    const key = String.fromCharCode(49 + i); // '1', '2', '3'...
    li.innerHTML = `
      <span class="spell-key">[${key}]</span>
      <span class="spell-name">${sp.name}</span>
      <span class="spell-school">${sp.school}</span>
      <span class="spell-cost">${formatSpellCost(sp)}</span>
    `;
    li.dataset.spellId = spellId;
    li.dataset.key = key;
    if (enabled) li.addEventListener('click', () => pickSpell(spellId));
    list.appendChild(li);
  });
  document.getElementById('spell-modal').classList.remove('hidden');
  uiState = 'pickSpell';
  // Default focus: first non-disabled item
  const items = [...document.querySelectorAll('#spell-list li')];
  spellFocusIndex = items.findIndex(li => !li.classList.contains('disabled'));
  if (spellFocusIndex < 0) spellFocusIndex = 0;
  updateSpellFocus();
  setPrompt('Choose a spell — [↑↓] move, [Enter] cast, [1-9] direct, [Esc] cancel.');
}

function updateSpellFocus() {
  const items = document.querySelectorAll('#spell-list li');
  items.forEach((li, i) => li.classList.toggle('focused', i === spellFocusIndex));
}

function moveSpellFocus(delta) {
  const items = [...document.querySelectorAll('#spell-list li')];
  if (!items.length) return;
  let i = spellFocusIndex;
  for (let step = 0; step < items.length; step++) {
    i = (i + delta + items.length) % items.length;
    if (!items[i].classList.contains('disabled')) {
      spellFocusIndex = i;
      updateSpellFocus();
      return;
    }
  }
}

function confirmFocusedSpell() {
  const items = [...document.querySelectorAll('#spell-list li')];
  const li = items[spellFocusIndex];
  if (li && !li.classList.contains('disabled')) pickSpell(li.dataset.spellId);
}

function closeSpellModal() {
  document.getElementById('spell-modal').classList.add('hidden');
}

function wireSpellModalBackdrop() {
  document.getElementById('spell-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) cancelPick();
  });
  document.getElementById('item-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) cancelPick();
  });
}

function pickSpell(spellId) {
  const sp = deps.data.spell(spellId);
  if (!sp) return;
  closeSpellModal();
  pendingAction = { kind: 'cast', spellId };
  if (sp.targeting === 'self') {
    const player = currentCombat.actors.find(a => a.isPlayer);
    completeTargetPick(player);
  } else if (['allEnemies', 'allAllies', 'all'].includes(sp.targeting)) {
    resolveAction({ kind: 'cast', spellId, targetId: null });
  } else {
    enterPickTarget('enemies');
  }
}

// ---------- Item modal ----------

function openItemModal() {
  const player = currentCombat.actors.find(a => a.isPlayer);
  const list = player.loadout?.consumables || [];
  const listEl = document.getElementById('item-list');
  listEl.innerHTML = '';
  if (!list.length) {
    deps.log('No items available.');
    return;
  }
  // Group by item id with counts.
  const counts = countBy(list);
  const ids = Object.keys(counts);
  ids.forEach((id, i) => {
    const item = deps.data.item(id);
    if (!item) return;
    const li = document.createElement('li');
    li.className = `school-${item.kind || 'consumable'}`;
    const key = String.fromCharCode(49 + i);
    li.innerHTML = `
      <span class="spell-key">[${key}]</span>
      <span class="spell-name">${item.name}</span>
      <span class="spell-school">×${counts[id]}</span>
      <span class="spell-cost">${item.blurb || ''}</span>
    `;
    li.dataset.itemId = id;
    li.dataset.key = key;
    li.addEventListener('click', () => pickItem(id));
    listEl.appendChild(li);
  });
  document.getElementById('item-modal').classList.remove('hidden');
  uiState = 'pickItem';
  setPrompt('Choose an item — [Esc] cancel.');
}

function closeItemModal() {
  document.getElementById('item-modal').classList.add('hidden');
}

function pickItem(itemId) {
  const item = deps.data.item(itemId);
  if (!item) return;
  closeItemModal();
  pendingAction = { kind: 'item', itemId };
  if (!item.targeting || item.targeting === 'self') {
    const player = currentCombat.actors.find(a => a.isPlayer);
    completeTargetPick(player);
  } else if (['allEnemies', 'allAllies', 'all'].includes(item.targeting)) {
    resolveAction({ kind: 'item', itemId, targetId: null });
  } else {
    enterPickTarget('enemies');
  }
}

// ---------- Row clicks ----------

function wireRowClicks() {
  const list = document.getElementById('combat-list');
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.combat-row');
    if (!row || !currentCombat) return;
    const actor = currentCombat.actors.find(a => a.id === row.dataset.actorId);
    if (!actor) return;
    if (uiState === 'pickTarget') {
      if (row.classList.contains('targetable')) completeTargetPick(actor);
      return;
    }
    inspectActorId = actor.id;
    renderInspect();
    renderCombatList();
  });

  // Mouse hover during target picking: move focus + preview in inspect.
  list.addEventListener('mouseover', (e) => {
    if (uiState !== 'pickTarget' || !currentCombat) return;
    const row = e.target.closest('.combat-row.targetable');
    if (!row) return;
    const rows = targetableRows();
    const idx = rows.indexOf(row);
    if (idx >= 0 && idx !== targetFocusIndex) {
      targetFocusIndex = idx;
      updateTargetFocus();
      syncInspectWithFocused();
    }
  });
}

// ---------- Keys ----------

function wireKeys() {
  window.addEventListener('keydown', (e) => {
    if (deps.activeScreen() !== 'combat') return;
    if (e.key === 'Escape') { cancelPick(); return; }

    if (uiState === 'pickSpell') {
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); moveSpellFocus(1); return; }
      if (e.key === 'ArrowUp'   || e.key === 'k') { e.preventDefault(); moveSpellFocus(-1); return; }
      if (e.key === 'Enter' || e.key === ' ')    { e.preventDefault(); confirmFocusedSpell(); return; }
      const li = document.querySelector(`#spell-list li[data-key="${e.key}"]`);
      if (li && !li.classList.contains('disabled')) pickSpell(li.dataset.spellId);
      return;
    }

    if (uiState === 'pickItem') {
      const li = document.querySelector(`#item-list li[data-key="${e.key}"]`);
      if (li) pickItem(li.dataset.itemId);
      return;
    }

    if (uiState === 'pickTarget') {
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); moveTargetFocus(1); return; }
      if (e.key === 'ArrowUp'   || e.key === 'k') { e.preventDefault(); moveTargetFocus(-1); return; }
      if (e.key === 'Enter' || e.key === ' ')    { e.preventDefault(); confirmFocusedTarget(); return; }
      const num = parseInt(e.key, 10);
      if (!Number.isNaN(num) && num >= 1) {
        const row = document.querySelectorAll('.combat-row')[num - 1];
        if (row && row.classList.contains('targetable')) {
          const actor = currentCombat.actors.find(a => a.id === row.dataset.actorId);
          if (actor) completeTargetPick(actor);
        }
      }
      return;
    }

    // Idle / inspect-mode: arrow keys cycle through living combatants and
    // refresh the INSPECT panel. Doesn't consume the action — purely viewing.
    if (uiState === 'idle' || uiState === 'inspectMode') {
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); moveInspectFocus(1); return; }
      if (e.key === 'ArrowUp'   || e.key === 'k') { e.preventDefault(); moveInspectFocus(-1); return; }
    }

    if (resolvePlayerAction) {
      const map = { a: 'attack', c: 'cast', i: 'item', w: 'wait', x: 'inspect', f: 'flee' };
      const action = map[e.key.toLowerCase()];
      if (action) handleAction(action);
    }
  });
}

function moveInspectFocus(delta) {
  if (!currentCombat) return;
  const actors = currentCombat.actors.filter(a => isAlive(a));
  if (!actors.length) return;
  const curIdx = actors.findIndex(a => a.id === inspectActorId);
  const nextIdx = (curIdx < 0 ? 0 : (curIdx + delta + actors.length) % actors.length);
  inspectActorId = actors[nextIdx].id;
  renderInspect();
  // Update .selected highlight on rows without rebuilding the whole list
  document.querySelectorAll('.combat-row').forEach(el => {
    el.classList.toggle('selected', el.dataset.actorId === inspectActorId);
  });
}

// ---------- Rendering ----------

function renderAll() {
  if (!currentCombat) return;
  renderTitleBar();
  renderCombatList();
  renderStats();
  renderInspect();
}

function renderTitleBar() {
  const tickEl = document.querySelector('section[data-screen="combat"] .combat-tick-label');
  if (tickEl) tickEl.textContent = `TICK ${String(currentCombat.tick).padStart(3, '0')}`;
}

function renderCombatList() {
  const list = document.getElementById('combat-list');
  if (!list) return;

  const alive = currentCombat.actors.filter(a => isAlive(a));
  const byEnergy = [...alive].sort((a, b) => (b.energy ?? 0) - (a.energy ?? 0));
  const nextActor = byEnergy[0];

  const rows = currentCombat.actors.map((actor, idx) => {
    const classes = ['combat-row'];
    if (actor.dead) classes.push('dead');
    if (!actor.dead && actor === nextActor) classes.push('next');
    if (actor.id === inspectActorId) classes.push('selected');

    const num = idx + 1;
    const marker = actor.dead ? '✕' : (actor === nextActor ? '▶' : '·');
    const teamClass = actor.team === 'player' ? 'team-player' : 'team-enemy';
    const hpStr = actor.dead ? '────' : `HP ${actor.stats.hp}/${actor.stats.maxHp}`;
    const mpStr = (!actor.dead && (actor.stats.maxMp || 0) > 0)
      ? `MP ${actor.stats.mp}/${actor.stats.maxMp}` : '';

    let statusesHtml = '';
    if ((actor.statuses || []).length) {
      const sorted = [...actor.statuses].sort((a, b) => {
        const ad = (a.def.kind === 'debuff') ? 0 : (a.def.kind === 'buff' ? 2 : 1);
        const bd = (b.def.kind === 'debuff') ? 0 : (b.def.kind === 'buff' ? 2 : 1);
        if (ad !== bd) return ad - bd;
        return (b.duration ?? 0) - (a.duration ?? 0);
      });
      const first = sorted[0];
      statusesHtml = `<span class="status-chip kind-${first.def.kind || 'neutral'}">${first.def.shortName || first.def.id}:${first.duration}</span>`;
      if (sorted.length > 1) {
        statusesHtml += ` <span class="status-chip status-overflow">+${sorted.length - 1}</span>`;
      }
    }

    const energyPct = Math.min(100, Math.round(((actor.energy ?? 0) / 100) * 100));
    const tt = ticksUntilAct(actor);
    const ticksText = actor.dead ? 'dead' : (actor === nextActor ? 'NEXT' : (Number.isFinite(tt) ? tt : '∞'));

    return `<div class="${classes.join(' ')}" data-actor-id="${actor.id}">
      <span class="row-num">${num}.</span>
      <span class="row-marker">${marker}</span>
      <span class="row-name ${teamClass}">${actor.name}</span>
      <span class="row-stats">${hpStr}</span>
      <span class="row-mp">${mpStr}</span>
      <span class="row-statuses">${statusesHtml}</span>
      <span class="row-energy"><span class="row-energy-fill" style="width:${energyPct}%"></span></span>
      <span class="row-tick ${actor === nextActor ? 'next' : ''}">${ticksText}</span>
    </div>`;
  }).join('');

  if (rows === lastListHtml) return;
  lastListHtml = rows;
  list.innerHTML = rows;
}

function statusChipHtml(s) {
  const k = s.def.kind || 'neutral';
  return `<span class="status-chip kind-${k}">${escapeHtml(s.def.shortName || s.def.id)}:${s.duration}</span>`;
}

function renderStats() {
  if (!currentCombat) return;
  const player = currentCombat.actors.find(a => a.isPlayer);
  const body = document.querySelector('section[data-screen="combat"] .stats-body');
  if (!body || !player) return;
  let html = escapeHtml(formatStatsBlock(player));
  if ((player.statuses || []).length) {
    html += '\n\nSTATUS\n  ' + player.statuses.map(statusChipHtml).join(' ');
  }
  if (html === lastStatsHtml) return;
  lastStatsHtml = html;
  body.innerHTML = html;
}

function renderInspect() {
  if (!currentCombat) return;
  const body = document.querySelector('section[data-screen="combat"] .inspect-body');
  if (!body) return;
  const actor = currentCombat.actors.find(a => a.id === inspectActorId);
  if (!actor) {
    if (currentScene?.room) {
      const ctx = sceneContextFromCombat(currentCombat);
      const room = formatSceneString(currentScene.room, ctx);
      const cacheKey = '__room__|' + room;
      if (cacheKey === lastInspectHtml) return;
      lastInspectHtml = cacheKey;
      body.innerHTML = `<span class="flavor-text">${escapeHtml(room)}</span>`;
    } else {
      body.textContent = '(click a combatant)';
    }
    return;
  }
  const lines = [];
  if (actor.defId) {
    const def = deps.data.monster(actor.defId);
    if (def?.ascii?.length) lines.push(...def.ascii, '');
  }
  const teamClass = actor.team === 'player' ? 'team-player' : 'team-enemy';
  let html = lines.map(escapeHtml).join('\n');
  if (lines.length) html += '\n';
  html += `<span class="row-name ${teamClass}">${escapeHtml(actor.name)}</span>\n`;
  const statLines = [`HP   ${actor.stats.hp} / ${actor.stats.maxHp}`];
  if ((actor.stats.maxMp || 0) > 0) statLines.push(`MP   ${actor.stats.mp} / ${actor.stats.maxMp}`);
  statLines.push(formatStatLine(actor));
  html += statLines.map(escapeHtml).join('\n');
  if ((actor.statuses || []).length) {
    html += '\n\n' + actor.statuses.map(statusChipHtml).join(' ');
  }
  const cacheKey = inspectActorId + '|' + html;
  if (cacheKey === lastInspectHtml) return;
  lastInspectHtml = cacheKey;
  body.innerHTML = html;
}

function setPrompt(text) {
  const el = document.getElementById('combat-prompt');
  if (el) {
    el.textContent = text || '';
    el.classList.toggle('idle', !text);
  }
}

