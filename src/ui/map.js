// Map UI — renders current node + immediate next-layer choices, handles input.

import { NODE_GLYPH, NODE_LABEL, NODE_FLAVOR } from '../engine/map.js';
import { formatSceneString, sceneContextFromNode } from '../engine/scene.js';
import { formatStatsBlock, formatEquippedSlots, escapeHtml } from './util.js';

let deps = null;
let run = null;             // shared run state object from game.js
let focusIndex = 0;         // highlighted choice
let onChoiceCallback = null;

export function initMapUi(d) {
  deps = d;
  wireButtons();
  wireKeys();
}

export function setRun(r) { run = r; }
export function clearRun() { run = null; }

export function renderMap() {
  if (!run) return;
  renderTitleBar();
  renderMainPane();
  renderStats();
  renderInspect();
}

// ---------- Title bar ----------

function renderTitleBar() {
  const titleSection = document.querySelector('section[data-screen="map"]');
  if (!titleSection) return;
  const cur = run.map.nodes.get(run.currentNodeId);
  const layerEl = titleSection.querySelector('.title-bar > span:nth-child(2)');
  const tickEl  = titleSection.querySelector('.title-bar > span:nth-child(3)');
  if (layerEl) layerEl.textContent = `LAYER ${cur.layer + 1}/${run.map.layers.length}`;
  if (tickEl)  tickEl.textContent = `NODES ${run.visitedIds.length}/${run.map.totalNodes}`;
}

// ---------- Main pane (choices + edges + current node) ----------

function renderMainPane() {
  const pane = document.querySelector('section[data-screen="map"] .main-pane');
  if (!pane) return;
  pane.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'MAP';
  pane.appendChild(title);

  const view = document.createElement('div');
  view.className = 'map-view';
  pane.appendChild(view);

  const cur = run.map.nodes.get(run.currentNodeId);
  const choiceIds = cur.edges || [];
  const choices = choiceIds.map(id => run.map.nodes.get(id)).filter(Boolean);

  if (focusIndex >= choices.length) focusIndex = 0;

  if (choices.length === 0) {
    // At boss / sysop — no further choices
    const pre = document.createElement('pre');
    pre.className = 'map-art';
    pre.textContent = renderEndArt(cur);
    view.appendChild(pre);
    return;
  }

  const N = choices.length;
  const anchor = Math.floor((N - 1) / 2);
  // Visual rows: branch + connector between branches → 2N-1 rows
  const visualRows = 2 * N - 1;
  view.style.setProperty('--visual-rows', visualRows);

  // Previous-node cell (dim) on the far left, if there's history.
  const prevId = run.previousNodeId;
  const prevNode = prevId ? run.map.nodes.get(prevId) : null;
  if (prevNode) {
    const prevCell = document.createElement('div');
    prevCell.className = `map-prev node-${prevNode.type}`;
    prevCell.innerHTML = `
      <span class="prev-glyph">${NODE_GLYPH[prevNode.type] || '[ ]'}</span>
      <span class="prev-arrow">───</span>
    `;
    view.appendChild(prevCell);
  }

  // YOU on the left (spans all rows)
  const youCell = document.createElement('div');
  youCell.className = 'map-current';
  youCell.setAttribute('data-glitchable', '');
  const isBoss = cur.type === 'boss';
  youCell.innerHTML = isBoss
    ? `<span class="you-marker">▶</span><span class="you-label">SYSOP</span><span class="you-marker">◀</span>`
    : `<span class="you-marker">▶</span><span class="you-label">YOU</span><span class="you-marker">◀</span>`;
  view.appendChild(youCell);

  // Edges block — multi-line `<pre>` with right-angle box drawing chars
  const edgesPre = document.createElement('pre');
  edgesPre.className = 'map-edges';
  edgesPre.innerHTML = renderEdgeBlock(N, anchor, focusIndex);
  view.appendChild(edgesPre);

  // Choices column on the right — placed at every other (odd) visual row
  const choicesCol = document.createElement('div');
  choicesCol.className = 'map-choices';
  choices.forEach((node, i) => {
    const cell = document.createElement('div');
    cell.className = `map-choice node-${node.type}`;
    if (i === focusIndex) cell.classList.add('focused');
    cell.setAttribute('data-glitchable', '');
    cell.dataset.nodeId = node.id;
    cell.dataset.index = i;
    cell.style.gridRow = `${i * 2 + 1} / span 1`;
    cell.innerHTML = `
      <span class="choice-glyph">${NODE_GLYPH[node.type] || '[ ]'}</span>
      <span class="choice-key">[${i + 1}]</span>
    `;
    choicesCol.appendChild(cell);
  });
  view.appendChild(choicesCol);

  // Hint below
  const hint = document.createElement('div');
  hint.className = 'map-hint';
  hint.textContent = 'Pick next node — [↑↓] move, [Enter] enter, [1-9] direct.';
  view.appendChild(hint);
}

// Render the right-angle box-drawing edge block for N choices.
// Anchor is the row YOU's incoming line attaches to (floor((N-1)/2)).
// `focusedIdx` highlights the path from anchor to that choice.
function renderEdgeBlock(N, anchor, focusedIdx) {
  if (N === 1) {
    // single direct line
    const cls = focusedIdx === 0 ? 'edge-focused' : '';
    return `<span class="${cls}">─────</span>`;
  }

  const lines = [];
  for (let i = 0; i < N; i++) {
    const isTop = (i === 0);
    const isBottom = (i === N - 1);
    const isAnchor = (i === anchor);
    let trunk;
    // Anchor row uses a plain '─' so the trunk vertical visually passes
    // through it cleanly (the explicit junction glyphs misalign in many fonts).
    if (isAnchor)                  trunk = '─';
    else if (isTop)                trunk = '┌';
    else if (isBottom)             trunk = '└';
    else                           trunk = '├';

    const approach = isAnchor ? '─' : ' ';
    const branch   = '──';

    const focusedRow = (i === focusedIdx);
    // The path from anchor to focused row is highlighted; that's the trunk
    // verticals between them, plus the focused branch row.
    const onPath = focusedRow ||
      (i > Math.min(anchor, focusedIdx) && i < Math.max(anchor, focusedIdx));
    const branchCls = focusedRow ? 'edge-focused' : '';
    lines.push(`<span class="${branchCls}">${approach}${trunk}${branch}</span>`);

    if (!isBottom) {
      // Vertical connector below this branch row
      const connectorOnPath =
        (i + 1 > Math.min(anchor, focusedIdx) && i + 1 <= Math.max(anchor, focusedIdx)) ||
        (i >= Math.min(anchor, focusedIdx) && i < Math.max(anchor, focusedIdx));
      const cCls = connectorOnPath ? 'edge-focused' : '';
      lines.push(`<span class="${cCls}"> │</span>`);
    }
  }
  return lines.join('\n');
}

function renderEndArt(node) {
  if (node.type === 'boss') {
    return [
      '┌───────────────────────────────┐',
      '│                               │',
      '│         T H E   S Y S O P     │',
      '│                               │',
      '└───────────────────────────────┘',
      '',
      '         ▶  YOU  ◀',
    ].join('\n');
  }
  return '\n         ▶  YOU  ◀\n\n( terminal node — run complete )';
}

// ---------- Stats / inspect ----------

function renderStats() {
  const body = document.querySelector('section[data-screen="map"] .stats-body');
  if (!body || !run.player) return;
  const slots = formatEquippedSlots(run.player, deps.data);
  body.textContent = formatStatsBlock(run.player, {
    extra: ['', ...slots, '', `TOKENS  ${run.tokens || 0}`],
  });
}

function renderInspect() {
  const body = document.querySelector('section[data-screen="map"] .inspect-body');
  if (!body) return;
  const cur = run.map.nodes.get(run.currentNodeId);
  const choiceIds = cur.edges || [];
  const choices = choiceIds.map(id => run.map.nodes.get(id)).filter(Boolean);
  const focused = choices[focusIndex];
  if (!focused) {
    body.textContent = '(no choices)';
    return;
  }
  const label = NODE_LABEL[focused.type] || focused.type.toUpperCase();
  const ctx = sceneContextFromNode(focused, deps.data);
  const rawRoom = focused.scene?.room || NODE_FLAVOR[focused.type] || '';
  const room = formatSceneString(rawRoom, ctx);
  let html = escapeHtml(label) + '\n\n';
  if (room) {
    html += `<span class="flavor-text">${escapeHtml(room)}</span>`;
  }
  if (focused.encounter?.enemyIds) {
    html += `\n\nENEMIES: ${focused.encounter.enemyIds.length}`;
  }
  body.innerHTML = html;
}

// ---------- Input ----------

function wireButtons() {
  document.querySelectorAll('section[data-screen="map"] .button-bar button').forEach(b => {
    b.addEventListener('click', () => handleAction(b.dataset.action));
  });
  // Click on a choice cell
  document.querySelector('section[data-screen="map"] .main-pane')
    .addEventListener('click', (e) => {
      const cell = e.target.closest('.map-choice');
      if (!cell || !run) return;
      const idx = parseInt(cell.dataset.index, 10);
      if (!Number.isNaN(idx)) {
        focusIndex = idx;
        renderMainPane();
        renderInspect();
        confirmFocused();
      }
    });
  // Hover over choice updates focus + inspect
  document.querySelector('section[data-screen="map"] .main-pane')
    .addEventListener('mouseover', (e) => {
      const cell = e.target.closest('.map-choice');
      if (!cell || !run) return;
      const idx = parseInt(cell.dataset.index, 10);
      if (!Number.isNaN(idx) && idx !== focusIndex) {
        focusIndex = idx;
        renderMainPane();
        renderInspect();
      }
    });
}

function handleAction(action) {
  if (!run) return;
  switch (action) {
    case 'inspect':
      // Inspect already updates with focus; this is a no-op feedback.
      deps.log('Hover or arrow-key over choices to inspect.');
      break;
    case 'inventory':
      if (deps.openInventory) deps.openInventory();
      else deps.log('Inventory not available.');
      break;
    case 'codex':
      if (deps.openCodex) deps.openCodex();
      else deps.log('Codex not available.');
      break;
    case 'save-quit':
      deps.saveAndQuit();
      break;
    case 'move':
      confirmFocused();
      break;
  }
}

function wireKeys() {
  window.addEventListener('keydown', (e) => {
    if (deps.activeScreen() !== 'map' || !run) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'j' || e.key === 'l') {
      moveFocus(1); e.preventDefault(); return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'k' || e.key === 'h') {
      moveFocus(-1); e.preventDefault(); return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      confirmFocused(); e.preventDefault(); return;
    }
    if (e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key, 10) - 1;
      const choices = currentChoices();
      if (idx >= 0 && idx < choices.length) {
        focusIndex = idx;
        renderMainPane();
        renderInspect();
        confirmFocused();
      }
      return;
    }
    const shortcut = { s: 'save-quit', i: 'inventory', k: 'codex', x: 'inspect' }[e.key.toLowerCase()];
    if (shortcut) handleAction(shortcut);
  });
}

function currentChoices() {
  const cur = run.map.nodes.get(run.currentNodeId);
  return (cur.edges || []).map(id => run.map.nodes.get(id)).filter(Boolean);
}

function moveFocus(delta) {
  const choices = currentChoices();
  if (!choices.length) return;
  focusIndex = (focusIndex + delta + choices.length) % choices.length;
  renderMainPane();
  renderInspect();
}

function confirmFocused() {
  const choices = currentChoices();
  const node = choices[focusIndex];
  if (!node) return;
  if (deps.onChoice) deps.onChoice(node);
}
