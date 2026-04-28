// Persistent codex — what the player has seen, killed, used, received.
// Lives in localStorage under `netromancer.codex`, separate from the save slot
// (the codex persists across runs and deaths; save wipes on load).

const KEY = 'netromancer.codex';
const VERSION = 1;
const CATEGORIES = ['monsters', 'spells', 'wearables', 'consumables', 'statuses'];

let codex = empty();

function empty() {
  const c = { version: VERSION };
  for (const k of CATEGORIES) c[k] = new Set();
  return c;
}

export function loadCodex() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { codex = empty(); return codex; }
    const parsed = JSON.parse(raw);
    if (parsed.version !== VERSION) { codex = empty(); return codex; }
    codex = empty();
    for (const k of CATEGORIES) {
      const arr = Array.isArray(parsed[k]) ? parsed[k] : [];
      codex[k] = new Set(arr);
    }
    return codex;
  } catch {
    codex = empty();
    return codex;
  }
}

function persist() {
  try {
    const out = { version: VERSION };
    for (const k of CATEGORIES) out[k] = Array.from(codex[k]);
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch (e) {
    console.warn('codex persist failed:', e);
  }
}

export function markKnown(category, id) {
  if (!CATEGORIES.includes(category)) return;
  if (!id) return;
  if (codex[category].has(id)) return false;
  codex[category].add(id);
  persist();
  return true; // true = newly added
}

export function isKnown(category, id) {
  return codex[category]?.has(id) ?? false;
}

export function knownIds(category) {
  return Array.from(codex[category] ?? []);
}

export function summary(data) {
  // Returns { monsters: {known, total}, spells: {...}, ... } based on the
  // currently loaded data. wearables/consumables are derived from items.kind.
  const out = {};
  const items = data?.list?.('items') || [];
  for (const k of CATEGORIES) {
    let total;
    if (k === 'wearables')        total = items.filter(it => it.kind === 'wearable').length;
    else if (k === 'consumables') total = items.filter(it => it.kind === 'consumable').length;
    else                          total = (data?.list?.(k) || []).length;
    out[k] = { known: codex[k].size, total };
  }
  return out;
}

export function wipeCodex() {
  codex = empty();
  try { localStorage.removeItem(KEY); } catch {}
}

export function getCodex() { return codex; }
