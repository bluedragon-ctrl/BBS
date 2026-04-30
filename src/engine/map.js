// Map / DAG generator. Slay-the-Spire-style: 7 layers (entry, 5 mid, sysop),
// each layer holds a small number of nodes, every node connects to 1-3 nodes
// in the next layer.

import { weightedPick } from './rng.js';

export const NODE_GLYPH = {
  shell:   '[>]',
  combat:  '[C]',
  shop:    '[$]',
  cache:   '[D]',
  shrine:  '[!]',
  event:   '[?]',
  elite:   '[E]',
  boss:    '[★]',
};

// Generic per-type fallback labels. Scene templates can override via an
// optional `scene.label` field, which is preferred whenever set.
export const NODE_LABEL = {
  shell:   'SHELL PROMPT',
  combat:  'COMBAT',
  shop:    'TRADER',
  cache:   'CACHE',
  shrine:  'ALTAR',
  event:   'ENCOUNTER',
  elite:   'ELITE',
  boss:    'BOSS',
};

// Generic per-type fallback flavor. Scene `room` overrides whenever set;
// these only show on legacy nodes that have no scene attached.
export const NODE_FLAVOR = {
  shell:   'The starting glade. Press onward.',
  combat:  'A hostile encounter. Resolve by combat.',
  shop:    'A wayside trader. Spend tokens.',
  cache:   'A hidden stash — old goods, half-perished.',
  shrine:  'A pocket of quiet. An old altar, kept warm.',
  event:   'Something irregular. Outcome uncertain.',
  elite:   'Stronger quarry. The path narrows.',
  boss:    "The lair at the heart of the kingdom. End of run.",
};

const LAYERS = 7;                          // 0..6
const NODES_PER_LAYER = [1, 3, 3, 4, 3, 2, 1];

// Per-layer type weights (for layers 1..5; 0 is entry-shell, 6 is boss).
// Act 1 (level 1) uses shops in place of caches — the unlock loop dedupes
// caches into near-empty pools after a few runs, so caches as a node type
// don't earn their place in the door-game. Act 2 (level 2) keeps caches
// because the discovery framing fits the BBS substrate.
const LAYER_WEIGHTS_L1 = [
  /* layer 1 */ { combat: 4, event: 1 },
  /* layer 2 */ { combat: 3, event: 1, shop: 1 },
  /* layer 3 */ { combat: 3, shop: 1, shrine: 1, event: 1 },
  /* layer 4 */ { combat: 2, shop: 1, shrine: 1, elite: 1, event: 1 },
  /* layer 5 */ { combat: 2, elite: 2, shop: 1, shrine: 1 },
];

const LAYER_WEIGHTS_L2 = [
  /* layer 1 */ { combat: 4, event: 1 },
  /* layer 2 */ { combat: 3, event: 1, cache: 1 },
  /* layer 3 */ { combat: 3, shop: 1, shrine: 1, elite: 1, event: 1, cache: 1 },
  /* layer 4 */ { combat: 2, shop: 1, shrine: 1, elite: 1, cache: 1, event: 1 },
  /* layer 5 */ { combat: 2, elite: 2, shop: 1, shrine: 1 },
];

function pickLayerWeights(level) {
  return level === 2 ? LAYER_WEIGHTS_L2 : LAYER_WEIGHTS_L1;
}

export function generateMap(rng, data = null, level = 1) {
  const nodes = new Map();
  const layers = [];
  const sceneTemplates = data
    ? data.list('nodes').filter(t => t.scene && (t.level ?? 1) === level)
    : [];
  const layerWeights = pickLayerWeights(level);

  for (let li = 0; li < LAYERS; li++) {
    const count = NODES_PER_LAYER[li];
    const layer = [];
    for (let ci = 0; ci < count; ci++) {
      const id = `n_${li}_${ci}`;
      let type;
      if (li === 0)               type = 'shell';
      else if (li === LAYERS - 1) type = 'boss';
      else                        type = pickType(rng, layerWeights[li - 1]);
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

  // Soft constraint: at least one shrine in every run, and one cache in
  // Act 2 runs (Act 1 uses shops in place of caches — see weight tables).
  if (level === 2) ensureType(nodes, layers, 'cache');
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
  const resolved = resolveSceneVariants(pick.scene, rng);
  // Template-level fields (label etc.) propagate onto the resolved scene so
  // downstream consumers (map UI inspect, modal titles) can read them off
  // node.scene.label without reaching back to the template.
  if (pick.label) resolved.label = pick.label;
  return resolved;
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
// Act 1 narrative zones: Borderwood (L1) → Warrens (L2) → Crypts (L3-L5) →
// Hoard (L6 boss). The 7-layer scaffold has more mid layers than Act 1 has
// distinct zones, so L4-L5 reuse the L3 Crypts pool — "deeper crypts" — until
// the proper map-structure refactor lands.
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
    ['mon_kobold_striker', 'mon_kobold_striker', 'mon_goblin_scout'],
  ],
  3: [
    ['mon_bone_walker', 'mon_crypt_ghoul'],
    ['mon_bone_walker', 'mon_goblin_scout', 'mon_goblin_scout'],
    ['mon_acidic_ooze', 'mon_crypt_ghoul'],
    ['mon_acidic_ooze', 'mon_bone_walker', 'mon_goblin_scout'],
  ],
  4: [
    ['mon_bone_walker', 'mon_crypt_ghoul'],
    ['mon_acidic_ooze', 'mon_crypt_ghoul'],
    ['mon_acidic_ooze', 'mon_bone_walker', 'mon_crypt_ghoul'],
    ['mon_crypt_ghoul', 'mon_crypt_ghoul'],
  ],
  5: [
    ['mon_bone_walker', 'mon_crypt_ghoul', 'mon_crypt_ghoul'],
    ['mon_acidic_ooze', 'mon_acidic_ooze'],
    ['mon_bone_walker', 'mon_acidic_ooze', 'mon_crypt_ghoul'],
  ],
};

// Per-layer elite recipes. Goblin Chief is Act 1's only authored elite. He
// appears at L4 and L5 only — L3 stays normal Crypts content so the player
// gets one more layer of buildup before the mini-boss encounter.
const ELITE_RECIPES = {
  4: [
    ['mon_goblin_chief'],
  ],
  5: [
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
