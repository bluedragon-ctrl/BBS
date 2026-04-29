// Scene flavor utilities.
// Templates live in `data/nodes.json` and are picked + variant-resolved by
// `engine/map.js#pickScene` at run-generation time. Display-time helpers below
// substitute `{path}` interpolations against a context built from the combat
// or the node's encounter data.

// Substitute {path} occurrences. Supports dotted paths and numeric indices,
// e.g. "{enemies[0].name}" → ctx.enemies[0].name. Missing values become "".
export function formatSceneString(text, ctx) {
  if (!text) return text;
  return String(text).replace(/\{([^}]+)\}/g, (_, raw) => {
    const value = resolvePath(ctx, raw.trim());
    return value == null ? '' : String(value);
  });
}

function resolvePath(obj, path) {
  const tokens = [];
  const re = /([A-Za-z_]\w*)|\[(\d+)\]/g;
  let m;
  while ((m = re.exec(path))) {
    tokens.push(m[1] != null ? m[1] : Number(m[2]));
  }
  let cur = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    cur = cur[t];
  }
  return cur;
}

// Build interpolation context from a live combat. Uses each actor's *current*
// (possibly CONN-corrupted) name — by the time pre/post fire, the BBS view of
// names is what the player sees on screen.
export function sceneContextFromCombat(combat) {
  if (!combat) return {};
  const enemies = combat.actors.filter(a => a.team === 'enemy');
  const player  = combat.actors.find(a => a.isPlayer);
  return {
    enemies: enemies.map(a => ({ name: a.name })),
    enemyCount: enemies.length,
    enemyNames: enemies.map(a => a.name).join(', '),
    player: player ? { name: player.name } : null,
  };
}

// Build interpolation context from a map node before combat starts (e.g. for
// the map-screen inspect preview). Uses canonical monster names from `data`.
export function sceneContextFromNode(node, data) {
  if (!node?.encounter?.enemyIds) {
    return { enemies: [], enemyCount: 0, enemyNames: '' };
  }
  const ids = node.encounter.enemyIds;
  const names = ids.map(id => data?.monster(id)?.name || id);
  return {
    enemies: names.map(name => ({ name })),
    enemyCount: ids.length,
    enemyNames: names.join(', '),
    layer: node.layer,
    nodeType: node.type,
  };
}
