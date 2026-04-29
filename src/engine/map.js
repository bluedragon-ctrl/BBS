// Map / DAG generator. Slay-the-Spire-style: 7 layers (entry, 5 mid, sysop),
// each layer holds a small number of nodes, every node connects to 1-3 nodes
// in the next layer.

import { weightedPick } from './rng.js';

export const NODE_GLYPH = {
  combat:  '[C]',
  shop:    '[$]',
  cache:   '[D]',
  shrine:  '[!]',
  event:   '[?]',
  elite:   '[E]',
  boss:    '[★]',
};

export const NODE_LABEL = {
  combat:  'COMBAT NODE',
  shop:    'SHOP',
  cache:   'CACHE',
  shrine:  'SHRINE',
  event:   'EVENT',
  elite:   'ELITE COMBAT',
  boss:    'SYSOP',
};

export const NODE_FLAVOR = {
  combat:  'A hostile process. Resolve by combat.',
  shop:    'A node selling odd files. Spend tokens.',
  cache:   'A directory of dropped files — most encrypted, some readable.',
  shrine:  'A pocket of static calm. Restoration.',
  event:   'Something irregular. Outcome uncertain.',
  elite:   'Heavy traffic. Stronger encounter.',
  boss:    'The SYSOP itself. End of run.',
};

const LAYERS = 7;                          // 0..6
const NODES_PER_LAYER = [1, 3, 3, 4, 3, 2, 1];

// Per-layer type weights (for layers 1..5; 0 is entry-combat, 6 is boss)
const LAYER_WEIGHTS = [
  /* layer 1 */ { combat: 4, event: 1 },
  /* layer 2 */ { combat: 3, event: 1, cache: 1 },
  /* layer 3 */ { combat: 3, shop: 1, shrine: 1, elite: 1, event: 1, cache: 1 },
  /* layer 4 */ { combat: 2, shop: 1, shrine: 1, elite: 1, cache: 1, event: 1 },
  /* layer 5 */ { combat: 2, elite: 2, shop: 1, shrine: 1 },
];

export function generateMap(rng, data = null, level = 1) {
  const nodes = new Map();
  const layers = [];
  const sceneTemplates = data
    ? data.list('nodes').filter(t => t.scene && (t.level ?? 1) === level)
    : [];

  for (let li = 0; li < LAYERS; li++) {
    const count = NODES_PER_LAYER[li];
    const layer = [];
    for (let ci = 0; ci < count; ci++) {
      const id = `n_${li}_${ci}`;
      let type;
      if (li === 0)               type = 'combat';
      else if (li === LAYERS - 1) type = 'boss';
      else                        type = pickType(rng, LAYER_WEIGHTS[li - 1]);
      const node = {
        id, type, layer: li, col: ci,
        edges: [],
        encounter: makeEncounter(type, rng, li),
        visited: false,
      };
      node.scene = pickScene(sceneTemplates, node, rng);
      nodes.set(id, node);
      layer.push(node);
    }
    layers.push(layer);
  }

  // Connect each node to 1-3 nodes in the next layer.
  for (let li = 0; li < LAYERS - 1; li++) {
    const cur = layers[li];
    const next = layers[li + 1];
    for (const node of cur) {
      const max = Math.min(3, next.length);
      const numEdges = 1 + Math.floor(rng() * max);
      const picks = pickN(next, numEdges, rng);
      node.edges = picks.map(n => n.id);
    }
    // Ensure every next-layer node is reachable from someone in this layer.
    for (const target of next) {
      const reachable = cur.some(n => n.edges.includes(target.id));
      if (!reachable) {
        const src = cur[Math.floor(rng() * cur.length)];
        if (!src.edges.includes(target.id)) src.edges.push(target.id);
      }
    }
  }

  // Soft constraint: at least one cache and one shrine in the run.
  ensureType(nodes, layers, 'cache');
  ensureType(nodes, layers, 'shrine');

  return {
    nodes, layers,
    startId: layers[0][0].id,
    bossId:  layers[LAYERS - 1][0].id,
    totalNodes: nodes.size,
  };
}

function pickType(rng, weights) {
  const items = Object.entries(weights).map(([type, w]) => ({ type, w }));
  return weightedPick(rng, items, it => it.w).type;
}

// Score scene templates by matcher specificity, pick a random one from the
// most specific tier, then resolve any array-typed room/pre/post fields to a
// single string. Matcher fields: type (required), layer (optional, exact match).
function pickScene(templates, node, rng) {
  if (!templates.length) return null;
  const matches = templates
    .filter(t => t.match?.type === node.type)
    .filter(t => t.match?.layer == null || t.match.layer === node.layer);
  if (!matches.length) return null;
  const maxSpecificity = matches.reduce((m, t) => {
    const s = (t.match?.layer != null ? 1 : 0);
    return s > m ? s : m;
  }, 0);
  const tier = matches.filter(t => (t.match?.layer != null ? 1 : 0) === maxSpecificity);
  const pick = tier[Math.floor(rng() * tier.length)];
  return resolveSceneVariants(pick.scene, rng);
}

// room/pre/post may each be a string or an array of strings. Arrays are
// resolved to one element via rng so the saved node.scene is always a flat
// {room?, pre?, post?} of plain strings — downstream consumers don't need to
// know about variants.
function resolveSceneVariants(scene, rng) {
  const out = {};
  for (const k of ['room', 'pre', 'post']) {
    const v = scene[k];
    if (Array.isArray(v) && v.length) {
      out[k] = v[Math.floor(rng() * v.length)];
    } else if (v != null) {
      out[k] = v;
    }
  }
  return out;
}

// Per-layer combat recipes. Layer index matches map layer (0 = entry, last = boss).
// Each entry is a list of recipes; one is picked at random for the node.
// Act 1 occupies layers 0..3 (entry forest → goblin warrens → crypts → dragon's lair).
// Layers 4+ fall back to existing test monsters until Act 2 content lands.
const COMBAT_RECIPES = {
  0: [
    ['mon_cave_rat', 'mon_cave_rat'],
    ['mon_cave_rat'],
    ['mon_vile_bat'],
    ['mon_goblin_scout'],
  ],
  1: [
    ['mon_cave_rat', 'mon_cave_rat'],
    ['mon_vile_bat', 'mon_cave_rat'],
    ['mon_goblin_scout', 'mon_vile_bat'],
    ['mon_goblin_scout'],
  ],
  2: [
    ['mon_goblin_warrior', 'mon_goblin_scout'],
    ['mon_goblin_shaman', 'mon_goblin_scout', 'mon_goblin_scout'],
    ['mon_kobold_striker', 'mon_goblin_warrior'],
    ['mon_kobold_striker', 'mon_kobold_striker', 'mon_kobold_striker'],
  ],
  3: [
    ['mon_bone_walker', 'mon_crypt_ghoul'],
    ['mon_bone_walker', 'mon_bone_walker', 'mon_goblin_scout'],
    ['mon_acidic_ooze', 'mon_crypt_ghoul'],
    ['mon_acidic_ooze', 'mon_bone_walker', 'mon_bone_walker'],
  ],
};

// Per-layer elite recipes. Goblin Chief is Act 1's L3 elite (mini-boss).
const ELITE_RECIPES = {
  3: [
    ['mon_goblin_chief'],
  ],
};

function makeEncounter(type, rng, layer = 0) {
  if (type === 'combat') {
    const recipes = COMBAT_RECIPES[layer];
    if (recipes && recipes.length) {
      return { enemyIds: recipes[Math.floor(rng() * recipes.length)] };
    }
    // Fallback for layers without authored content yet.
    const id = rng() < 0.5 ? 'mon_watchdog' : 'mon_glyph_wraith';
    return { enemyIds: [id] };
  }
  if (type === 'elite') {
    const recipes = ELITE_RECIPES[layer];
    if (recipes && recipes.length) {
      return { enemyIds: recipes[Math.floor(rng() * recipes.length)] };
    }
    return { enemyIds: ['mon_glyph_wraith', 'mon_watchdog'] };
  }
  if (type === 'boss')   return { enemyIds: ['mon_crimson_wyrm'] };
  return null;
}

function pickN(arr, n, rng) {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length; i++) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out.sort((a, b) => a.col - b.col);
}

function ensureType(nodes, layers, type) {
  for (const node of nodes.values()) if (node.type === type) return;
  // Replace a combat node in a middle layer (2..4) with the desired type.
  for (let li = 2; li <= 4; li++) {
    const swap = layers[li]?.find(n => n.type === 'combat');
    if (swap) {
      swap.type = type;
      swap.encounter = null;
      return;
    }
  }
}
