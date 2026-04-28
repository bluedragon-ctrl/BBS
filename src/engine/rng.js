// Mulberry32 PRNG. Deterministic given a seed; suitable for save/replay.

export function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0xFFFFFFFF);
}

export function pick(rng, array) {
  return array[Math.floor(rng() * array.length)];
}

export function weightedPick(rng, items, weightFn = it => it.weight ?? 1) {
  const total = items.reduce((s, it) => s + weightFn(it), 0);
  let r = rng() * total;
  for (const it of items) {
    r -= weightFn(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}
