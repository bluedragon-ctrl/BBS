// Shared helpers used by multiple UI modules.

import { effectiveStat } from '../engine/atoms.js';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export function formatTokens(amt) {
  return `${amt} TOKEN${amt === 1 ? '' : 'S'}`;
}

export function formatSpellCost(spell) {
  const parts = [];
  if (spell?.cost?.mp)   parts.push(`${spell.cost.mp} MP`);
  if (spell?.cost?.conn) parts.push(`${spell.cost.conn} CONN`);
  return parts.join(' / ') || '—';
}

export function countBy(list) {
  const out = {};
  for (const id of list) out[id] = (out[id] || 0) + 1;
  return out;
}

// Build the player stats block (HP / MP / INT/ATK / DEF/SPD) shown in the
// stats panel on combat and map screens. Always uses effectiveStat so active
// statuses are reflected — see review note D8.
export function formatStatsBlock(actor, { extra = [] } = {}) {
  if (!actor) return '';
  const s = actor.stats || {};
  const lines = [
    `HP   ${s.hp} / ${s.maxHp}`,
    `MP   ${s.mp} / ${s.maxMp}`,
    `INT  ${effectiveStat(actor, 'int')}   ATK ${effectiveStat(actor, 'atk')}`,
    `DEF  ${effectiveStat(actor, 'def')}   SPD ${effectiveStat(actor, 'spd')}`,
  ];
  return [...lines, ...extra].join('\n');
}

// Five-line equipped readout, suitable as `extra` for formatStatsBlock.
// Reads loadout.equipped (id values) and resolves names via data.item.
const SLOT_DISPLAY = [
  ['weapon', 'WEAPON'],
  ['robe',   'ROBE  '],
  ['amulet', 'AMULET'],
  ['ring1',  'RING  '],
  ['ring2',  'RING  '],
];
export function formatEquippedSlots(actor, data) {
  if (!actor?.loadout?.equipped) return [];
  const equipped = actor.loadout.equipped;
  return SLOT_DISPLAY.map(([slot, label]) => {
    const id = equipped[slot];
    const def = id ? data?.item?.(id) : null;
    return `${label}  ${def ? def.name : '-'}`;
  });
}

// One-line stat readout (INT/ATK/DEF/SPD) for compact inspect panels.
export function formatStatLine(actor) {
  return `INT ${effectiveStat(actor, 'int')}  ATK ${effectiveStat(actor, 'atk')}  ` +
         `DEF ${effectiveStat(actor, 'def')}  SPD ${effectiveStat(actor, 'spd')}`;
}

// Swallow further keydowns of `key` (capture phase, before any screen handler)
// until the matching keyup fires. Self-cleans on release. Call this from any
// modal/overlay's dismissal handler so the dismissing keypress can't auto-
// repeat or leak through to the screen behind it on the same physical press.
export function armSwallow(key) {
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

// Selectors for every modal/overlay surface in the game. Used by
// isAnyModalOpen so screen-level keys yield while anything is on top.
const MODAL_SELECTORS = ['#node-modal', '.modal.terminal-modal'];

// `ignore` may contain modal selectors to treat as "owned by" the caller —
// e.g. a screen with its own overlay can pass them so its key handler keeps
// receiving keys while the overlay is up.
export function isAnyModalOpen(ignore) {
  const ignoreSet = ignore instanceof Set ? ignore : new Set(ignore || []);
  for (const sel of MODAL_SELECTORS) {
    if (ignoreSet.has(sel)) continue;
    const el = document.querySelector(sel);
    if (el && !el.classList.contains('hidden')) return true;
  }
  return false;
}

// Install a window-level keydown listener that no-ops unless the named screen
// is active AND no modal is on top. Centralizes the per-screen guard so
// individual screens don't each repeat the activeScreen / modal-open check.
// `opts.ignoreModals`: selectors the caller owns; not treated as foreign.
export function wireScreenKeys(screenName, getActiveScreen, handler, opts = {}) {
  const ignore = new Set(opts.ignoreModals || []);
  window.addEventListener('keydown', (e) => {
    if (getActiveScreen() !== screenName) return;
    if (isAnyModalOpen(ignore)) return;
    handler(e);
  });
}

// Match a raw KeyboardEvent.key against a list of {key, disabled?} choices,
// case-insensitively. Returns the index of the matching enabled choice, or -1.
export function pickByKey(choices, eventKey) {
  if (!eventKey) return -1;
  const k = eventKey.toLowerCase();
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i];
    if (!c?.key) continue;
    if (c.disabled) continue;
    if (String(c.key).toLowerCase() === k) return i;
  }
  return -1;
}

// Hide a modal element. Optionally arm-swallows the dismissing key so the
// same physical press can't leak through to whatever is behind. Pass any
// extra classes to remove (e.g. shell-modal) to avoid leaking modal-specific
// state into the next caller.
export function closeModal(el, { dismissKey = null, removeClasses = [] } = {}) {
  if (!el) return;
  el.classList.add('hidden');
  for (const cls of removeClasses) el.classList.remove(cls);
  if (dismissKey) armSwallow(dismissKey);
}
