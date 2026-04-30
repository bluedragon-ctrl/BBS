// Persistent unlock pool — spells and wearables that carry across runs.
// Lives in localStorage at `netromancer.unlocks`, separate from save/codex/flags.
// An item enters the pool on end-of-combat-victory if the player's loadout
// contained it. Subsequent runs start with these in the spellbook / inventory.

const KEY = 'netromancer.unlocks';
const VERSION = 1;
const CATEGORIES = ['spells', 'wearables'];

let unlocks = empty();

function empty() {
  const u = { version: VERSION };
  for (const k of CATEGORIES) u[k] = new Set();
  return u;
}

export function loadUnlocks() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { unlocks = empty(); return unlocks; }
    const parsed = JSON.parse(raw);
    if (parsed.version !== VERSION) { unlocks = empty(); return unlocks; }
    unlocks = empty();
    for (const k of CATEGORIES) {
      const arr = Array.isArray(parsed[k]) ? parsed[k] : [];
      unlocks[k] = new Set(arr);
    }
    return unlocks;
  } catch {
    unlocks = empty();
    return unlocks;
  }
}

function persist() {
  try {
    const out = { version: VERSION };
    for (const k of CATEGORIES) out[k] = Array.from(unlocks[k]);
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch (e) {
    console.warn('unlocks persist failed:', e);
  }
}

export function markUnlocked(category, id) {
  if (!CATEGORIES.includes(category)) return false;
  if (!id) return false;
  if (unlocks[category].has(id)) return false;
  unlocks[category].add(id);
  persist();
  return true;
}

export function isUnlocked(category, id) {
  return unlocks[category]?.has(id) ?? false;
}

export function getUnlocked(category) {
  return Array.from(unlocks[category] ?? []);
}

export function bankLoadout(loadout) {
  if (!loadout) return;
  let changed = false;
  for (const id of loadout.spells || []) {
    if (!unlocks.spells.has(id)) { unlocks.spells.add(id); changed = true; }
  }
  for (const id of loadout.wearables || []) {
    if (!unlocks.wearables.has(id)) { unlocks.wearables.add(id); changed = true; }
  }
  if (changed) persist();
}

export function wipeUnlocks() {
  unlocks = empty();
  try { localStorage.removeItem(KEY); } catch {}
}

export function getUnlocks() { return unlocks; }
