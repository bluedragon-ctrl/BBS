// Codex UI — tabbed list of known monsters / spells / items / statuses.
// Reads from engine/codex.js (persistent across runs) + data tables.

import { isKnown, knownIds, summary } from '../engine/codex.js';
import { escapeHtml, formatSpellCost, formatStatLine, wireScreenKeys } from './util.js';

let deps = null;            // { data, activeScreen, returnTo }
let currentTab = 'monsters';
let focusIndex = 0;
let returnTarget = 'boot';  // 'boot' or 'map'

const TABS = [
  { id: 'monsters',    label: 'MONSTERS',    key: 'M' },
  { id: 'spells',      label: 'SPELLS',      key: 'S' },
  { id: 'wearables',   label: 'WEARABLES',   key: 'W' },
  { id: 'consumables', label: 'CONSUMABLES', key: 'C' },
  { id: 'statuses',    label: 'EFFECTS',     key: 'E' },
];

export function initCodexUi(d) {
  deps = d;
  wireButtons();
  wireKeys();
}

export function openCodex(returnScreen) {
  returnTarget = returnScreen || 'boot';
  currentTab = 'monsters';
  focusIndex = 0;
  deps.showScreen('codex');
  render();
}

function closeCodex() {
  deps.showScreen(returnTarget);
}

// ---------- Render ----------

function render() {
  renderTitle();
  renderTabs();
  renderList();
  renderInspect();
}

function renderTitle() {
  const sum = summary(deps.data);
  const known = TABS.reduce((n, t) => n + sum[t.id].known, 0);
  const total = TABS.reduce((n, t) => n + sum[t.id].total, 0);
  const layerEl = document.querySelector('section[data-screen="codex"] .title-bar > span:nth-child(2)');
  const tickEl  = document.querySelector('section[data-screen="codex"] .title-bar > span:nth-child(3)');
  if (layerEl) layerEl.textContent = 'CODEX';
  if (tickEl)  tickEl.textContent = `${known}/${total} KNOWN`;
}

function renderTabs() {
  const tabBar = document.querySelector('section[data-screen="codex"] .codex-tabs');
  if (!tabBar) return;
  const sum = summary(deps.data);
  tabBar.innerHTML = '';
  for (const tab of TABS) {
    const el = document.createElement('button');
    el.className = 'codex-tab' + (tab.id === currentTab ? ' active' : '');
    el.dataset.tab = tab.id;
    const s = sum[tab.id];
    el.innerHTML = `<span class="key">[${tab.key}]</span> ${tab.label} <span class="codex-tab-count">${s.known}/${s.total}</span>`;
    el.addEventListener('click', () => { switchTab(tab.id); });
    tabBar.appendChild(el);
  }
}

function entries() {
  let list;
  if (currentTab === 'wearables' || currentTab === 'consumables') {
    const kind = currentTab === 'wearables' ? 'wearable' : 'consumable';
    list = (deps.data.list?.('items') || []).filter(it => it.kind === kind);
  } else {
    list = deps.data.list?.(currentTab) || [];
  }
  return list.map(e => ({
    entry: e,
    known: isKnown(currentTab, e.id),
  }));
}

function renderList() {
  const list = document.querySelector('section[data-screen="codex"] .codex-list');
  if (!list) return;
  list.innerHTML = '';
  const items = entries();
  if (focusIndex >= items.length) focusIndex = 0;
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'codex-empty';
    empty.textContent = '( no entries — content not yet authored )';
    list.appendChild(empty);
    return;
  }
  items.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'codex-row' + (i === focusIndex ? ' focused' : '') + (it.known ? '' : ' unknown');
    row.dataset.index = i;
    row.innerHTML = formatRow(it.entry, it.known);
    row.addEventListener('click', () => {
      focusIndex = i;
      renderList();
      renderInspect();
    });
    row.addEventListener('mouseover', () => {
      if (focusIndex !== i) {
        focusIndex = i;
        renderList();
        renderInspect();
      }
    });
    list.appendChild(row);
  });
}

function formatRow(entry, known) {
  if (currentTab === 'monsters') {
    if (!known) return `<span class="codex-name">???</span>`;
    return `<span class="codex-name team-enemy">${escapeHtml(entry.name)}</span>` +
           `<span class="codex-stats">hp:${entry.stats?.hp ?? '?'}  spd:${entry.stats?.spd ?? '?'}</span>`;
  }
  if (currentTab === 'spells') {
    if (!known) return `<span class="codex-name">???.SPL</span>`;
    const cost = formatSpellCost(entry);
    return `<span class="codex-name school-${entry.school}">${escapeHtml(entry.name)}</span>` +
           `<span class="codex-stats">${entry.school}</span>` +
           `<span class="codex-stats">${cost}</span>`;
  }
  if (currentTab === 'statuses') {
    if (!known) return `<span class="codex-name">???</span>`;
    return `<span class="codex-name kind-${entry.kind || 'neutral'}">${escapeHtml(entry.name)}</span>` +
           `<span class="codex-stats">${entry.kind || 'neutral'}</span>`;
  }
  if (currentTab === 'wearables') {
    if (!known) return `<span class="codex-name">???.GEAR</span>`;
    return `<span class="codex-name">${escapeHtml(entry.name || entry.id)}</span>` +
           `<span class="codex-stats">${entry.slot || ''}</span>`;
  }
  if (currentTab === 'consumables') {
    if (!known) return `<span class="codex-name">???.SCROLL</span>`;
    return `<span class="codex-name">${escapeHtml(entry.name || entry.id)}</span>` +
           `<span class="codex-stats">${entry.charges ? `x${entry.charges}` : ''}</span>`;
  }
  return `<span>${escapeHtml(entry.id)}</span>`;
}

function renderInspect() {
  const body = document.querySelector('section[data-screen="codex"] .inspect-body');
  if (!body) return;
  const items = entries();
  const it = items[focusIndex];
  if (!it) { body.textContent = '(empty)'; return; }
  if (!it.known) {
    body.textContent = '???\n\nNot yet identified. Find or face this entry to add it to the codex.';
    return;
  }
  body.innerHTML = formatInspect(it.entry);
}

function formatInspect(e) {
  if (currentTab === 'monsters') {
    const lines = [];
    if (e.ascii?.length) lines.push(...e.ascii, '');
    lines.push(`<span class="row-name team-enemy">${escapeHtml(e.name)}</span>`);
    lines.push(`HP   ${e.stats?.hp ?? '?'} / ${e.stats?.maxHp ?? '?'}`);
    lines.push(formatStatLine({ stats: e.stats, statuses: [] }));
    if (e.ai) lines.push('', `AI: ${e.ai}`);
    return lines.join('\n');
  }
  if (currentTab === 'spells') {
    const cost = formatSpellCost(e);
    const fx = (e.effects || []).map(eff => formatEffect(eff)).join('\n  ');
    const lines = [
      `<span class="row-name school-${e.school}">${escapeHtml(e.name)}</span>`,
      `SCHOOL: ${e.school}`,
      `TIER:   ${e.tier ?? 1}`,
      `COST:   ${cost}`,
      `TARGET: ${e.targeting || 'single'}`,
      '',
      'EFFECTS:',
      `  ${fx || '(none)'}`,
    ];
    if (e.codexBlurb) lines.push('', `"${e.codexBlurb}"`);
    return lines.join('\n');
  }
  if (currentTab === 'statuses') {
    const lines = [
      `<span class="status-chip kind-${e.kind || 'neutral'}">${escapeHtml(e.name)}</span>`,
      `KIND:     ${e.kind || 'neutral'}`,
      `STACK:    ${e.stackMode || 'refresh'}`,
      `DURATION: ${e.duration ?? '?'}`,
    ];
    if (e.tags?.length) lines.push(`TAGS:     ${e.tags.join(', ')}`);
    if (e.flags?.length) lines.push(`FLAGS:    ${e.flags.join(', ')}`);
    const modLines = [];
    for (const m of e.modifiers || []) {
      modLines.push(formatModifier(m));
    }
    if (modLines.length) {
      lines.push('', 'MODIFIERS:');
      for (const ml of modLines) lines.push(`  ${ml}`);
    }
    if (e.hooks) {
      const hookNames = Object.keys(e.hooks).filter(k => e.hooks[k]?.length);
      if (hookNames.length) {
        lines.push('', 'HOOKS:');
        for (const h of hookNames) {
          lines.push(`  ${h}:`);
          for (const eff of e.hooks[h]) lines.push(`    - ${formatEffect(eff)}`);
        }
      }
    }
    if (e.codexBlurb) lines.push('', `"${e.codexBlurb}"`);
    return lines.join('\n');
  }
  if (currentTab === 'wearables') {
    const lines = [
      `<span class="row-name">${escapeHtml(e.name)}</span>`,
      `SLOT:   ${e.slot}`,
      `TIER:   ${e.tier ?? 1}`,
    ];
    if (e.modifiers?.length) {
      lines.push('', 'MODIFIERS:');
      for (const m of e.modifiers) lines.push('  ' + formatModifier(m));
    }
    if (e.hooks) {
      const ks = Object.keys(e.hooks).filter(k => e.hooks[k]?.length);
      if (ks.length) {
        lines.push('', 'HOOKS:');
        for (const h of ks) {
          lines.push(`  ${h}:`);
          for (const eff of e.hooks[h]) lines.push('    - ' + formatEffect(eff));
        }
      }
    }
    if (e.blurb) lines.push('', `"${escapeHtml(e.blurb)}"`);
    return lines.join('\n');
  }
  if (currentTab === 'consumables') {
    const cost = e.cost != null ? `${e.cost} tkn` : '—';
    const fx = (e.effects || []).map(formatEffect).join('\n  ');
    const lines = [
      `<span class="row-name">${escapeHtml(e.name)}</span>`,
      `TIER:   ${e.tier ?? 1}`,
      `COST:   ${cost}`,
      `TARGET: ${e.targeting || 'self'}`,
      '',
      'EFFECTS:',
      `  ${fx || '(none)'}`,
    ];
    if (e.blurb) lines.push('', `"${escapeHtml(e.blurb)}"`);
    return lines.join('\n');
  }
  return escapeHtml(JSON.stringify(e, null, 2));
}

function formatEffect(eff) {
  if (!eff) return '?';
  if (eff.type === 'damage')      return `damage ${eff.amount}${eff.damageType ? ' ('+eff.damageType+')' : ''} → ${eff.target || 'target'}`;
  if (eff.type === 'heal')        return `heal ${eff.amount} → ${eff.target || 'self'}`;
  if (eff.type === 'applyStatus') return `apply ${eff.effect}${eff.duration ? ' for '+eff.duration : ''} → ${eff.target || 'target'}`;
  return `${eff.type}${eff.amount ? ' ' + eff.amount : ''} → ${eff.target || ''}`;
}

function formatModifier(m) {
  if (!m) return '?';
  // Stat-side: { stat, add, mult }
  if (m.stat) {
    const part = [];
    if (m.add  != null) part.push(`${m.add >= 0 ? '+' : ''}${m.add}`);
    if (m.mult != null) part.push(`x${m.mult}`);
    return `${String(m.stat).toUpperCase()}: ${part.join(' ') || '(noop)'}`;
  }
  // Target-side damage: { damageTakenMult, damageTakenAdd }
  if (m.damageTakenMult != null || m.damageTakenAdd != null) {
    const part = [];
    if (m.damageTakenMult != null) part.push(`x${m.damageTakenMult}`);
    if (m.damageTakenAdd  != null) part.push(`${m.damageTakenAdd >= 0 ? '+' : ''}${m.damageTakenAdd}`);
    return `damage taken: ${part.join(' ')}`;
  }
  // Flag-style: { flags: [...] }
  if (Array.isArray(m.flags)) return `flags: ${m.flags.join(', ')}`;
  return JSON.stringify(m);
}


// ---------- Input ----------

function switchTab(id) {
  currentTab = id;
  focusIndex = 0;
  renderTabs();
  renderList();
  renderInspect();
}

function moveFocus(delta) {
  const items = entries();
  if (!items.length) return;
  focusIndex = (focusIndex + delta + items.length) % items.length;
  renderList();
  renderInspect();
}

function nextTab(delta) {
  const idx = TABS.findIndex(t => t.id === currentTab);
  const ni = (idx + delta + TABS.length) % TABS.length;
  switchTab(TABS[ni].id);
}

function wireButtons() {
  document.querySelector('section[data-screen="codex"] [data-action="back"]')
    ?.addEventListener('click', () => closeCodex());
}

function wireKeys() {
  wireScreenKeys('codex', deps.activeScreen, (e) => {
    if (e.key === 'Escape') { closeCodex(); e.preventDefault(); return; }
    if (e.key === 'Tab')    { nextTab(e.shiftKey ? -1 : 1); e.preventDefault(); return; }
    if (e.key === 'ArrowDown' || e.key === 'j') { moveFocus(1); e.preventDefault(); return; }
    if (e.key === 'ArrowUp'   || e.key === 'k') { moveFocus(-1); e.preventDefault(); return; }
    const k = e.key.toLowerCase();
    const tab = TABS.find(t => t.key.toLowerCase() === k);
    if (tab) { switchTab(tab.id); e.preventDefault(); return; }
  });
}
