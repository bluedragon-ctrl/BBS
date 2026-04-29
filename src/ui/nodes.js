// Special-node interaction handlers — shrine, cache, event, shop, boss intro.
// Each is `async function show...(node) → resolves when player leaves`.

import { makeContext, executeAtoms } from '../engine/atoms.js';
import { weightedPick, pick } from '../engine/rng.js';
import { evalExpr } from '../engine/expr.js';
import { markKnown } from '../engine/codex.js';
import { addWearable } from '../engine/loadout.js';
import { showTerminalSequence } from './terminal.js';
import { sleep, escapeHtml, formatTokens, countBy } from './util.js';

let deps = null;
// deps = {
//   data, rng, log, getRun, getConn, setConn, persistRun
// }

export function initNodeUi(d) { deps = d; }

// ====================================================================
// SHARED: a generic node modal — title + flavor + numbered choice list
// ====================================================================

function modal() {
  return document.getElementById('node-modal');
}

export function showNodeModal({ title, flavor, choices, onPick }) {
  return new Promise(resolve => {
    const m = modal();
    const titleEl = document.getElementById('node-modal-title');
    const bodyEl  = document.getElementById('node-modal-body');
    const buttonRow = m.querySelector('.modal-frame');
    // Remove any prior actions div
    buttonRow.querySelectorAll('.modal-actions').forEach(el => el.remove());

    titleEl.textContent = title;
    bodyEl.textContent = flavor;

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const buttonEls = [];
    choices.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.className = 'modal-choice';
      if (c.disabled) btn.disabled = true;
      btn.dataset.index = i;
      btn.innerHTML = `<span class="key">[${c.key}]</span> ${escapeHtml(c.label)}` +
        (c.detail ? ` <span class="modal-choice-detail">${escapeHtml(c.detail)}</span>` : '');
      btn.addEventListener('click', () => choose(i));
      btn.addEventListener('mouseover', () => setFocus(i));
      actions.appendChild(btn);
      buttonEls.push(btn);
    });
    buttonRow.appendChild(actions);

    // Focus tracking for arrow-key nav. Default to first non-disabled.
    let focusIdx = choices.findIndex(c => !c.disabled);
    if (focusIdx < 0) focusIdx = 0;
    function setFocus(i) {
      focusIdx = i;
      buttonEls.forEach((b, j) => b.classList.toggle('focused', j === i));
    }
    function moveFocus(delta) {
      let i = focusIdx;
      for (let step = 0; step < choices.length; step++) {
        i = (i + delta + choices.length) % choices.length;
        if (!choices[i].disabled) { setFocus(i); return; }
      }
    }
    setFocus(focusIdx);

    let resolved = false;
    function choose(i) {
      if (resolved) return;
      if (choices[i]?.disabled) return;
      resolved = true;
      cleanup();
      m.classList.add('hidden');
      Promise.resolve(onPick ? onPick(i) : null).then(() => resolve(i));
    }

    function keyHandler(e) {
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); moveFocus(1); return; }
      if (e.key === 'ArrowUp'   || e.key === 'k') { e.preventDefault(); moveFocus(-1); return; }
      if (e.key === 'Enter' || e.key === ' ')    { e.preventDefault(); choose(focusIdx); return; }
      const c = choices.find(c => c.key.toLowerCase() === e.key.toLowerCase());
      if (c && !c.disabled) { e.preventDefault(); choose(choices.indexOf(c)); return; }
      if (e.key === 'Escape') {
        const leave = choices.findIndex(c => c.isLeave);
        if (leave >= 0) { e.preventDefault(); choose(leave); }
      }
    }
    function cleanup() {
      window.removeEventListener('keydown', keyHandler);
    }
    window.addEventListener('keydown', keyHandler);

    m.classList.remove('hidden');
  });
}

// Prepend a node's scene description (room + optional pre) to a modal's
// existing flavor body. Returns the merged string. Both inputs may be empty.
function mergeSceneFlavor(scene, baseFlavor = '') {
  const parts = [];
  if (scene?.room) parts.push(scene.room);
  if (scene?.pre)  parts.push(scene.pre);
  if (baseFlavor)  parts.push(baseFlavor);
  return parts.join('\n\n');
}

function buildPlayerCtx() {
  const run = deps.getRun();
  return makeContext(run.player, run.player, {
    rng: deps.rng,
    data: deps.data,
    log: deps.log,
    onTokenGain: (n) => { run.tokens = (run.tokens || 0) + n; deps.persistRun(); },
    onConnChange: (delta) => { deps.setConn(deps.getConn() + delta); deps.persistRun(); },
  });
}

// ====================================================================
// SHRINE
// ====================================================================

export async function showShrine(node) {
  const run = deps.getRun();
  const player = run.player;
  await showNodeModal({
    title: 'SHRINE',
    flavor: mergeSceneFlavor(node?.scene, 'A pocket of static calm.'),
    choices: [
      { key: '1', label: 'DEFRAG', detail: 'restore HP to full' },
      { key: '2', label: 'RESYNC', detail: 'restore 25% CONN' },
      { key: 'L', label: 'LEAVE',  isLeave: true },
    ],
    onPick: (i) => {
      if (i === 0) {
        const before = player.stats.hp;
        player.stats.hp = player.stats.maxHp;
        deps.log(`> DEFRAG complete. HP ${before} → ${player.stats.hp}.`);
      } else if (i === 1) {
        const newConn = Math.min(1, deps.getConn() + 0.25);
        deps.setConn(newConn);
        deps.log(`> RESYNC complete. Connection +25%.`);
      } else {
        deps.log('> Shrine left undisturbed.');
      }
      deps.persistRun();
    },
  });
}

// ====================================================================
// CACHE — directory listing with selectable + flavor files; reveal animation
// ====================================================================

const FLAVOR_TAGS = ['[encrypted]', '[locked]', '[CRC ERROR]', '[404]', '[permission denied]', '[binary]'];
const FLAVOR_NAMES = [
  'SYSPRIV.LOG', '.htaccess', 'backup.tar.gz', 'ARCH3.???', 'CORE.DMP',
  'mail.archive', 'shadow', 'auth.log', 'ringbuf', 'cache.bin',
];
const REVEAL_NOISE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export async function showCache(node) {
  const run = deps.getRun();
  const player = run.player;
  const rng = deps.rng;
  const sceneRoom = node?.scene?.room || '';

  const selectableCount = 1 + Math.floor(rng() * 3); // 1-3
  const flavorCount = 3 + Math.floor(rng() * 4);     // 3-6

  // Build candidate pools: spells/wearables not yet found this run, plus tokens fallback.
  const level = run.level ?? 1;
  const knownSpells = new Set(player.loadout.spells);
  const candidateSpells = deps.data.list('spells')
    .filter(s => (s.level ?? 1) === level && !knownSpells.has(s.id));
  const ownedWearables = new Set(player.loadout.wearables || []);
  const candidateWearables = (deps.data.list('items') || [])
    .filter(it => it.kind === 'wearable' && (it.level ?? 1) === level && !it.noShop && !ownedWearables.has(it.id));

  function rollDrop() {
    // Pool selection: 60% spell if any unknown, 30% wearable if any new, else tokens.
    const r = rng();
    if (candidateSpells.length && r < 0.55) {
      const spell = weightedPick(rng, candidateSpells, s => 1 / Math.max(1, s.tier || 1) ** 1.5 * 6);
      return { kind: 'spell', spell };
    }
    if (candidateWearables.length && r < 0.85) {
      const item = weightedPick(rng, candidateWearables, it => 1 / Math.max(1, it.tier || 1) ** 1.5 * 6);
      return { kind: 'wearable', item };
    }
    if (candidateSpells.length) {
      const spell = weightedPick(rng, candidateSpells, s => 1 / Math.max(1, s.tier || 1) ** 1.5 * 6);
      return { kind: 'spell', spell };
    }
    if (candidateWearables.length) {
      const item = weightedPick(rng, candidateWearables, it => 1 / Math.max(1, it.tier || 1) ** 1.5 * 6);
      return { kind: 'wearable', item };
    }
    return { kind: 'tokens', amount: 1 + Math.floor(rng() * 3) };
  }

  const drops = [];
  for (let i = 0; i < selectableCount; i++) drops.push(rollDrop());

  // Build display rows
  const rows = [];
  const realNames = [];
  for (let i = 0; i < selectableCount; i++) {
    const placeholder = `EXEC_${(i + 1).toString(16).toUpperCase()}.???`;
    rows.push({ kind: 'select', label: placeholder, key: String(i + 1) });
    const d = drops[i];
    realNames.push(
      d.kind === 'spell'    ? d.spell.name
    : d.kind === 'wearable' ? d.item.name
    :                         `+${d.amount} TOKENS`
    );
  }
  // Flavor rows
  const usedNames = new Set();
  for (let i = 0; i < flavorCount; i++) {
    let n;
    do { n = pick(rng, FLAVOR_NAMES); } while (usedNames.has(n));
    usedNames.add(n);
    rows.push({ kind: 'flavor', label: n, tag: pick(rng, FLAVOR_TAGS) });
  }

  // Render directory listing
  const m = modal();
  const titleEl = document.getElementById('node-modal-title');
  const bodyEl  = document.getElementById('node-modal-body');
  const frame = m.querySelector('.modal-frame');
  frame.querySelectorAll('.modal-actions').forEach(el => el.remove());

  titleEl.textContent = 'CACHE';
  const dirHash = (Math.floor(rng() * 0xFFFF)).toString(16).padStart(4, '0');
  const intro = (sceneRoom ? `${sceneRoom}\n\n` : '') + `DIR: /tmp/dump.${dirHash}\n\n`;
  redraw(bodyEl, intro, rows);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  rows.filter(r => r.kind === 'select').forEach((r, i) => {
    const btn = document.createElement('button');
    btn.className = 'modal-choice';
    btn.dataset.index = i;
    btn.innerHTML = `<span class="key">[${r.key}]</span> open ${escapeHtml(r.label)}`;
    btn.addEventListener('click', () => pickFile(i));
    actions.appendChild(btn);
  });
  const leaveBtn = document.createElement('button');
  leaveBtn.className = 'modal-choice';
  leaveBtn.innerHTML = `<span class="key">[L]</span> LEAVE`;
  leaveBtn.addEventListener('click', () => leave());
  actions.appendChild(leaveBtn);
  frame.appendChild(actions);

  m.classList.remove('hidden');

  let resolved = false;
  let resolveOuter;
  const result = new Promise(r => { resolveOuter = r; });

  function keyHandler(e) {
    if (resolved) return;
    if (e.key === 'Escape' || e.key.toLowerCase() === 'l') { e.preventDefault(); leave(); return; }
    const idx = parseInt(e.key, 10) - 1;
    if (idx >= 0 && idx < selectableCount) { e.preventDefault(); pickFile(idx); }
  }
  window.addEventListener('keydown', keyHandler);

  async function pickFile(idx) {
    if (resolved) return;
    resolved = true;
    window.removeEventListener('keydown', keyHandler);
    actions.querySelectorAll('button').forEach(b => b.disabled = true);

    const realName = realNames[idx];
    await revealName(bodyEl, intro, rows, idx, realName, deps.rng);

    // Apply effect
    const drop = drops[idx];
    if (drop.kind === 'spell') {
      player.loadout.spells.push(drop.spell.id);
      markKnown('spells', drop.spell.id);
      deps.log(`> ${drop.spell.name} added to loadout.`);
    } else if (drop.kind === 'wearable') {
      addWearable(player, drop.item.id);
      deps.log(`> ${drop.item.name} catalogued. Equip from inventory.`);
    } else if (drop.kind === 'tokens') {
      run.tokens = (run.tokens || 0) + drop.amount;
      deps.log(`> +${formatTokens(drop.amount)}.`);
    }
    deps.persistRun();
    await sleep(700);
    m.classList.add('hidden');
    resolveOuter();
  }

  function leave() {
    if (resolved) return;
    resolved = true;
    window.removeEventListener('keydown', keyHandler);
    m.classList.add('hidden');
    deps.log('> Cache closed.');
    resolveOuter();
  }

  return result;
}

async function revealName(bodyEl, intro, rows, pickedIdx, realName, rng) {
  // Find the row and replace its label one char at a time.
  const target = realName.padEnd(18);
  const startLabel = rows[pickedIdx].label;

  // Phase 1: cycle random chars in '?' slots
  for (let frame = 0; frame < 4; frame++) {
    const cur = startLabel.split('').map(ch => ch === '?' ? REVEAL_NOISE[Math.floor(rng() * REVEAL_NOISE.length)] : ch).join('');
    rows[pickedIdx].label = cur;
    redraw(bodyEl, intro, rows);
    await sleep(80);
  }
  // Phase 2: settle each char to the target
  let cur = rows[pickedIdx].label.split('');
  for (let i = 0; i < target.length; i++) {
    cur[i] = target[i];
    rows[pickedIdx].label = cur.join('').slice(0, 18);
    redraw(bodyEl, intro, rows);
    await sleep(60);
  }
}

function redraw(bodyEl, intro, rows) {
  bodyEl.textContent = intro + rows.map(r => {
    if (r.kind === 'select') return `  [${r.key}]  ${r.label.padEnd(18)} [readable]`;
    return `  -    ${r.label.padEnd(18)} ${r.tag}`;
  }).join('\n');
}

// ====================================================================
// EVENT
// ====================================================================

export async function showEvent(node) {
  const run = deps.getRun();
  const level = run.level ?? 1;
  const seen = run.seenEvents = run.seenEvents || [];
  const allLevelEvents = (deps.data.list('events') || []).filter(e => (e.level ?? 1) === level);
  if (!allLevelEvents.length) {
    deps.log('> No events authored.');
    return;
  }
  // `once: true` events are filtered out once seen; if that empties the pool,
  // fall back to the full level set so the picker is never stranded.
  const unseen = allLevelEvents.filter(e => !(e.once && seen.includes(e.id)));
  const pool = unseen.length ? unseen : allLevelEvents;
  const evt = pick(deps.rng, pool);
  if (evt.once && !seen.includes(evt.id)) seen.push(evt.id);

  await showNodeModal({
    title: evt.title,
    flavor: mergeSceneFlavor(node?.scene, evt.description),
    choices: [
      ...evt.choices.map((c, i) => ({ key: String(i + 1), label: c.label })),
    ],
    onPick: async (i) => {
      const choice = evt.choices[i];
      const outcome = weightedPick(deps.rng, choice.outcomes, o => o.weight ?? 1);
      if (outcome.text) deps.log(`> ${outcome.text}`);
      if (outcome.effects?.length) {
        const ctx = buildPlayerCtx();
        executeAtoms(outcome.effects, ctx);
      }
      deps.persistRun();
    },
  });
}

// ====================================================================
// SHOP
// ====================================================================

export async function showShop(node) {
  const run = deps.getRun();
  const level = run.level ?? 1;
  const owned = new Set(run.player.loadout?.wearables || []);
  // Pool: all consumables + wearables not already owned this run.
  const allItems = (deps.data.list('items') || []).filter(it => {
    if ((it.level ?? 1) !== level) return false;
    if (it.noShop) return false;
    if (it.kind === 'consumable') return true;
    if (it.kind === 'wearable')   return !owned.has(it.id);
    return false;
  });
  if (!allItems.length) {
    deps.log('> Shop is empty.');
    return;
  }

  // Random subset of 3, tier-weighted (commons more likely).
  const shuffled = [...allItems].sort(() => deps.rng() - 0.5);
  const offered = shuffled.slice(0, Math.min(3, shuffled.length));

  function buildChoices() {
    return offered.map((it, i) => ({
      key: String(i + 1),
      label: `${it.name}    ${it.cost} tkn`,
      detail: it.blurb,
      disabled: (run.tokens || 0) < it.cost,
    })).concat([{ key: 'L', label: 'LEAVE', isLeave: true }]);
  }

  let leaving = false;
  let lastFeedback = null; // { text, kind } shown inside the modal next iteration

  function inventoryLine() {
    const list = run.player.loadout.consumables || [];
    if (!list.length) return '';
    const counts = countBy(list);
    const parts = Object.entries(counts).map(([id, n]) => {
      const it = deps.data.item(id);
      return `${it ? it.name : id}×${n}`;
    });
    return `\nOWNED: ${parts.join('  ')}`;
  }

  while (!leaving) {
    const baseFlavor = mergeSceneFlavor(
      node?.scene,
      'A directory of dropped files for sale. All transactions final.',
    );
    const fb = lastFeedback ? `\n\n>> ${lastFeedback.text}` : '';
    const flavor = baseFlavor + fb + inventoryLine();
    const choices = buildChoices();
    const i = await showNodeModal({
      title: `SHOP — ${run.tokens || 0} tkn`,
      flavor,
      choices,
    });
    if (choices[i]?.isLeave) {
      leaving = true;
      break;
    }
    const chosen = offered[i];
    if ((run.tokens || 0) < chosen.cost) {
      lastFeedback = { text: `Insufficient tokens for ${chosen.name}.`, kind: 'fail' };
      continue;
    }
    run.tokens -= chosen.cost;
    if (chosen.kind === 'consumable') {
      run.player.loadout.consumables = run.player.loadout.consumables || [];
      run.player.loadout.consumables.push(chosen.id);
      markKnown('consumables', chosen.id);
    } else if (chosen.kind === 'wearable') {
      addWearable(run.player, chosen.id);
    }
    lastFeedback = { text: `Purchased ${chosen.name}. (-${chosen.cost} tkn)`, kind: 'ok' };
    deps.log(`> Purchased ${chosen.name}. (-${chosen.cost} tkn)`);
    deps.persistRun();
  }
  deps.log('> Shop closed.');
}

// ====================================================================
// BOSS INTRO
// ====================================================================

export async function showBossIntro() {
  // Borders crawl with corruption + a couple of frame tears as the SYSOP
  // forces its way onto the wire.
  const { triggerGlitch } = await import('./glitch.js');
  document.querySelectorAll('.panel, .main-pane').forEach(el => {
    triggerGlitch('corruptBorders', 0.8, el);
  });
  triggerGlitch('tearLine', 0.7, document.querySelector('section[data-screen="map"] .main-pane'));

  await showTerminalSequence([
    '> /usr/sysop is online.',
    { text: '> [warning] external connection detected', class: 'warn' },
    { text: '> [warning] privilege escalation attempted', class: 'warn' },
    { delay: 500 },
    { noise: '░▒▓█▓▒░' },
    { delay: 300 },
    { text: '> SYSOP: WHO DARES.', class: 'danger' },
    { delay: 600 },
    { text: '> SYSOP: YOU SHOULD NOT BE HERE.', class: 'danger' },
    { delay: 400 },
    { noise: '▓░█▒▓▒█' },
    '',
    '> [press any key to engage]',
  ], { theme: 'alarm', dismissOn: 'press' });
}

// ====================================================================
// utils
// ====================================================================

