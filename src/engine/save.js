// Suspend save — single slot, wipes on load. Backed by localStorage.

const SAVE_KEY = 'netromancer.save';
const VERSION  = 2;

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); }
  catch { return false; }
}

export function save(payload) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ version: VERSION, ...payload }));
  } catch (e) {
    console.warn('save failed:', e);
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function wipe() {
  try { localStorage.removeItem(SAVE_KEY); } catch {}
}

export function serializeMap(map) {
  return {
    nodes: [...map.nodes.values()],
    startId: map.startId,
    bossId:  map.bossId,
    totalNodes: map.totalNodes,
  };
}

export function deserializeMap(obj) {
  const nodes = new Map();
  const layers = [];
  for (const n of obj.nodes) {
    nodes.set(n.id, n);
    while (layers.length <= n.layer) layers.push([]);
    layers[n.layer].push(n);
  }
  for (const layer of layers) layer.sort((a, b) => a.col - b.col);
  return { nodes, layers, startId: obj.startId, bossId: obj.bossId, totalNodes: obj.totalNodes };
}
