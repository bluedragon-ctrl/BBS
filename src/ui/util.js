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

// One-line stat readout (INT/ATK/DEF/SPD) for compact inspect panels.
export function formatStatLine(actor) {
  return `INT ${effectiveStat(actor, 'int')}  ATK ${effectiveStat(actor, 'atk')}  ` +
         `DEF ${effectiveStat(actor, 'def')}  SPD ${effectiveStat(actor, 'spd')}`;
}
