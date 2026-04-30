// Persistent meta-progression flags. Lives in localStorage at `netromancer.flags`,
// separate from save and codex — survives runs, wiped only by full data wipe.
//
// Current flags:
//   netromancerRevealed (bool) — set when the player obtains the crown amulet.
//                                Gates the boot intro animation.
//   introPlayCount      (int)  — bumped each time the intro animation plays.
//                                Drives full vs fast mode on subsequent boots.

const KEY = 'netromancer.flags';
const VERSION = 1;

const DEFAULTS = {
  netromancerRevealed: false,
  introPlayCount: 0,
};

let flags = empty();

function empty() {
  return { version: VERSION, ...DEFAULTS };
}

export function loadFlags() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { flags = empty(); return flags; }
    const parsed = JSON.parse(raw);
    if (parsed.version !== VERSION) { flags = empty(); return flags; }
    flags = { ...empty(), ...parsed, version: VERSION };
    return flags;
  } catch {
    flags = empty();
    return flags;
  }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(flags)); }
  catch (e) { console.warn('flags persist failed:', e); }
}

export function getFlag(name) {
  return flags[name];
}

export function setFlag(name, value) {
  flags[name] = value;
  persist();
}

export function wipeFlags() {
  flags = empty();
  try { localStorage.removeItem(KEY); } catch {}
}

export function getFlags() { return flags; }
