// Inventory UI — slot-first picker. Five slots are visible on screen; pick a
// slot (number or arrow+Enter) to open a modal listing wearables in the run-bag
// matching that slot, plus an Unequip option. Live stat-diff preview in the
// player stats panel as the player browses options in the modal.

import { effectiveStat } from '../engine/atoms.js';
import {
  SLOTS, equipItem, unequipSlot, bagFittingSlot, equippedDef, emptyEquipped,
} from '../engine/loadout.js';
import { showNodeModal } from './nodes.js';
import { escapeHtml, wireScreenKeys } from './util.js';

let deps = null;
// deps = { data, activeScreen, showScreen, getRun, persistRun, log }
let returnTarget = 'map';
let focusIndex = 0;
let previewSlot = null;     // slot id whose modal preview is updating stats panel
let previewItemId = null;   // id of the item being previewed (or 'unequip')

const SLOT_LABELS = {
  weapon: 'WEAPON',
  robe:   'ROBE',
  amulet: 'AMULET',
  ring1:  'RING',
  ring2:  'RING',
};

export function initInventoryUi(d) {
  deps = d;
  wireButtons();
  wireKeys();
}

export function openInventory(returnScreen) {
  returnTarget = returnScreen || 'map';
  focusIndex = 0;
  previewSlot = null;
  previewItemId = null;
  deps.showScreen('inventory');
  render();
}

function closeInventory() {
  previewSlot = null;
  previewItemId = null;
  deps.showScreen(returnTarget);
}

// ---------- Render ----------

function getPlayer() {
  return deps.getRun()?.player || null;
}

function ensureLoadout(player) {
  if (!player.loadout) player.loadout = { spells: [], consumables: {}, wearables: [], equipped: emptyEquipped() };
  if (!player.loadout.equipped) player.loadout.equipped = emptyEquipped();
  if (!player.loadout.wearables) player.loadout.wearables = [];
}

function render() {
  renderTitle();
  renderSlots();
  renderStats();
  renderInspect();
}

function renderTitle() {
  const player = getPlayer();
  const summary = document.querySelector('section[data-screen="inventory"] .inventory-summary');
  if (summary && player) {
    const equipped = player.loadout?.equipped || {};
    const filled = SLOTS.filter(s => equipped[s]).length;
    summary.textContent = `${filled}/5 EQUIPPED`;
  }
}

function renderSlots() {
  const container = document.querySelector('section[data-screen="inventory"] .inventory-slots');
  if (!container) return;
  const player = getPlayer();
  if (!player) { container.innerHTML = ''; return; }
  ensureLoadout(player);

  container.innerHTML = '';
  SLOTS.forEach((slot, i) => {
    const def = equippedDef(player, slot, deps.data);
    const row = document.createElement('div');
    row.className = 'inventory-slot' + (i === focusIndex ? ' focused' : '');
    row.dataset.slot = slot;
    row.dataset.index = i;
    const label = SLOT_LABELS[slot];
    const itemHtml = def
      ? `<span class="slot-item">${escapeHtml(def.name)}</span>`
      : `<span class="slot-empty">— empty —</span>`;
    row.innerHTML = `
      <span class="slot-key">[${i + 1}]</span>
      <span class="slot-label">${label}</span>
      <span class="slot-content">${itemHtml}</span>
    `;
    row.addEventListener('click', () => { focusIndex = i; renderSlots(); renderInspect(); openSlotModal(slot); });
    row.addEventListener('mouseover', () => {
      if (focusIndex !== i) { focusIndex = i; renderSlots(); renderInspect(); }
    });
    container.appendChild(row);
  });
}

function renderStats() {
  const body = document.querySelector('section[data-screen="inventory"] .stats-body');
  const player = getPlayer();
  if (!body || !player) return;
  ensureLoadout(player);

  const previewActive = previewSlot && previewItemId !== null;

  // Snapshot current (real) stats first.
  const cur = {
    int: effectiveStat(player, 'int'),
    atk: effectiveStat(player, 'atk'),
    def: effectiveStat(player, 'def'),
    spd: effectiveStat(player, 'spd'),
    maxMp: effectiveStat(player, 'maxMp') || player.stats.maxMp,
    maxHp: effectiveStat(player, 'maxHp') || player.stats.maxHp,
  };

  // If a preview is active, swap in the previewed item, recompute, restore.
  let next = null;
  if (previewActive) {
    const equipped = player.loadout.equipped;
    const oldId = equipped[previewSlot];
    equipped[previewSlot] = (previewItemId === '__unequip__') ? null : previewItemId;
    next = {
      int: effectiveStat(player, 'int'),
      atk: effectiveStat(player, 'atk'),
      def: effectiveStat(player, 'def'),
      spd: effectiveStat(player, 'spd'),
      maxMp: effectiveStat(player, 'maxMp') || player.stats.maxMp,
      maxHp: effectiveStat(player, 'maxHp') || player.stats.maxHp,
    };
    equipped[previewSlot] = oldId;
  }

  // Format a stat with optional before→after when changed.
  const fmt = (key, baseLabel) => {
    const a = cur[key];
    const b = next ? next[key] : a;
    if (next && b !== a) return `${baseLabel} ${formatNum(a)} → ${formatNum(b)}`;
    return `${baseLabel} ${formatNum(a)}`;
  };

  const lines = [
    `HP   ${player.stats.hp} / ${formatNum(cur.maxHp)}` +
      (next && next.maxHp !== cur.maxHp ? ` → ${formatNum(next.maxHp)}` : ''),
    `MP   ${player.stats.mp} / ${formatNum(cur.maxMp)}` +
      (next && next.maxMp !== cur.maxMp ? ` → ${formatNum(next.maxMp)}` : ''),
    `${fmt('int', 'INT ')}   ${fmt('atk', 'ATK')}`,
    `${fmt('def', 'DEF ')}   ${fmt('spd', 'SPD')}`,
  ];

  body.textContent = lines.join('\n');
}

function formatStatRow(name, cur, max) {
  return `${name.padEnd(4)} ${cur} / ${max}`;
}

function formatNum(n) {
  // Strip trailing zeros from floats (effectiveStat returns numbers with mult)
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

function renderInspect() {
  const body = document.querySelector('section[data-screen="inventory"] .inspect-body');
  if (!body) return;
  const player = getPlayer();
  if (!player) { body.textContent = '(no run)'; return; }
  ensureLoadout(player);

  const slot = SLOTS[focusIndex];
  const def = equippedDef(player, slot, deps.data);
  if (!def) {
    body.innerHTML =
      `<span class="row-name">${SLOT_LABELS[slot]}</span>\n` +
      `(empty)\n\n` +
      `Press [Enter] or click to choose from your run inventory.`;
    return;
  }
  body.innerHTML = formatItemInspect(def);
}

function formatItemInspect(def) {
  const lines = [
    `<span class="row-name">${escapeHtml(def.name)}</span>`,
    `SLOT:   ${def.slot}`,
    `TIER:   ${def.tier ?? 1}`,
  ];
  if (def.modifiers?.length) {
    lines.push('', 'MODIFIERS:');
    for (const m of def.modifiers) lines.push('  ' + describeModifier(m));
  }
  if (def.hooks) {
    const names = Object.keys(def.hooks).filter(k => def.hooks[k]?.length);
    if (names.length) {
      lines.push('', 'HOOKS:');
      for (const h of names) lines.push(`  ${h}: ${def.hooks[h].length} effect${def.hooks[h].length === 1 ? '' : 's'}`);
    }
  }
  if (def.blurb) lines.push('', `"${escapeHtml(def.blurb)}"`);
  return lines.join('\n');
}

function describeModifier(m) {
  if (m.stat) {
    const parts = [];
    if (m.add  != null) parts.push(`+${m.add}`);
    if (m.mult != null) parts.push(`x${m.mult}`);
    return `${m.stat} ${parts.join(' ')}`;
  }
  if (m.damageTakenMult != null) return `damage taken x${m.damageTakenMult}`;
  if (m.damageTakenAdd  != null) return `damage taken +${m.damageTakenAdd}`;
  if (m.flags) return `flags: ${m.flags.join(', ')}`;
  return JSON.stringify(m);
}

// ---------- Slot modal ----------

async function openSlotModal(slot) {
  const player = getPlayer();
  if (!player) return;
  ensureLoadout(player);
  const equipped = player.loadout.equipped[slot];
  const fitting = bagFittingSlot(player, slot, deps.data);

  const choices = [];
  // Unequip option (if anything is in the slot)
  if (equipped) {
    const def = deps.data.item(equipped);
    choices.push({
      key: '0',
      label: `UNEQUIP ${def ? def.name : equipped}`,
      _itemId: '__unequip__',
    });
  }
  fitting.forEach((entry, i) => {
    const isCurrent = entry.id === equipped;
    choices.push({
      key: String(i + 1),
      label: entry.def.name + (isCurrent ? ' (equipped)' : ''),
      _itemId: entry.id,
    });
  });
  choices.push({ key: 'L', label: 'CANCEL', isLeave: true, _itemId: null });

  // If only the cancel/leave option is available (no items fit, nothing
  // equipped), still show the modal with a clear "no items" flavor — users
  // need feedback that the click registered, not silent return.
  const hasOptions = choices.length > 1;

  // Wire live preview by listening to focus changes via mouseover/keys —
  // showNodeModal doesn't expose focus events directly, so we monkey-patch
  // by re-rendering stats on every mouseover/keydown while the modal is open.
  previewSlot = slot;
  const initialPreview = choices.find(c => !c.isLeave);
  previewItemId = initialPreview?._itemId ?? null;
  renderStats();

  // The modal updates its focused class via its own keydown handler. We
  // need to read focus AFTER that handler runs — defer with queueMicrotask
  // (or rAF as a fallback) so the DOM reflects the new focus.
  const onPreviewChange = () => {
    queueMicrotask(() => {
      const focused = document.querySelector('#node-modal .modal-choice.focused');
      if (!focused) return;
      const idx = Number(focused.dataset.index);
      const choice = choices[idx];
      previewItemId = choice && !choice.isLeave ? choice._itemId : null;
      renderStats();
    });
  };
  // Bubble phase, registered after modal's window-level handler so the
  // microtask reads the post-update DOM in any case.
  window.addEventListener('keydown', onPreviewChange);
  document.addEventListener('mouseover', onPreviewChange);

  const i = await showNodeModal({
    title: `${SLOT_LABELS[slot]} — slot ${slot}`,
    flavor: hasOptions ? 'Choose an item to equip.' : '(no items in your bag fit this slot)',
    choices,
  });

  window.removeEventListener('keydown', onPreviewChange);
  document.removeEventListener('mouseover', onPreviewChange);
  previewSlot = null;
  previewItemId = null;

  const chosen = choices[i];
  if (!chosen || chosen.isLeave) {
    render();
    return;
  }

  const ctx = buildPlayerCtx();
  if (chosen._itemId === '__unequip__') {
    unequipSlot(player, slot, ctx);
    deps.log(`> Unequipped ${SLOT_LABELS[slot]}.`);
  } else if (chosen._itemId) {
    if (chosen._itemId === equipped) {
      // Already equipped — no-op
    } else {
      equipItem(player, chosen._itemId, slot, ctx);
      const def = deps.data.item(chosen._itemId);
      deps.log(`> Equipped ${def ? def.name : chosen._itemId} to ${SLOT_LABELS[slot]}.`);
    }
  }
  deps.persistRun?.();
  render();
}

function describeItemBrief(def) {
  const parts = [];
  for (const m of def.modifiers || []) parts.push(describeModifier(m));
  if (def.hooks) {
    const ks = Object.keys(def.hooks).filter(k => def.hooks[k]?.length);
    if (ks.length) parts.push(`(${ks.join('+')})`);
  }
  return parts.join(' · ') || (def.blurb ? '' : 'no effect');
}

function buildPlayerCtx() {
  const run = deps.getRun();
  return {
    data: deps.data,
    log: deps.log,
    rng: deps.rng,
  };
}

// ---------- Input ----------

function wireButtons() {
  document.querySelector('section[data-screen="inventory"] [data-action="back"]')
    ?.addEventListener('click', () => closeInventory());
}

function wireKeys() {
  wireScreenKeys('inventory', deps.activeScreen, (e) => {
    if (e.key === 'Escape') { closeInventory(); e.preventDefault(); return; }
    if (e.key === 'ArrowDown' || e.key === 'j') { moveFocus(1); e.preventDefault(); return; }
    if (e.key === 'ArrowUp'   || e.key === 'k') { moveFocus(-1); e.preventDefault(); return; }
    if (e.key === 'Enter' || e.key === ' ')    { openSlotModal(SLOTS[focusIndex]); e.preventDefault(); return; }
    if (e.key >= '1' && e.key <= '5') {
      const idx = Number(e.key) - 1;
      focusIndex = idx;
      renderSlots();
      renderInspect();
      openSlotModal(SLOTS[idx]);
    }
  });
}

function moveFocus(delta) {
  focusIndex = (focusIndex + delta + SLOTS.length) % SLOTS.length;
  renderSlots();
  renderInspect();
}
