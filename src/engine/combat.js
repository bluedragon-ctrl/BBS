// Combat orchestration — turn loop, AI, end conditions.

import {
  makeContext, executeAtoms,
  fireHooks, fireBarks, tickStatusDurations,
  actorHasFlag,
} from './atoms.js';
import { evalExpr } from './expr.js';
import { weightedPick } from './rng.js';
import { markKnown } from './codex.js';
import { getUnlocked, getEquippedMemory } from './unlocks.js';
import {
  advanceTick, actorsThatCanAct, consumeAction, isAlive,
  ENERGY_THRESHOLD,
} from './scheduler.js';

// ---------- Actor construction ----------

export function cloneActor(def, opts = {}) {
  return {
    id: opts.id || def.id,
    name: opts.name || def.name,
    team: opts.team || 'enemy',
    isPlayer: false,
    defId: def.id,
    stats: { ...def.stats },
    statuses: [],
    energy: opts.energy ?? 0,
    actionCount: 0,
    dead: false,
    loadout: opts.loadout || null,
    actionCount: 0,
  };
}

export function buildEnemyActors(data, ids) {
  return ids.map((id, i) => {
    const def = data.monster(id);
    if (!def) throw new Error(`Unknown monster ${id}`);
    return cloneActor(def, { id: `${id}__${i}`, team: 'enemy' });
  });
}

export function makePlayerActor(opts = {}) {
  const player = {
    id: opts.id || 'player',
    name: opts.name || 'YOU',
    team: 'player',
    isPlayer: true,
    defId: null,
    stats: opts.stats || { hp: 30, maxHp: 30, mp: 12, maxMp: 12, int: 5, atk: 3, def: 2, spd: 10 },
    statuses: [],
    energy: 0,
    actionCount: 0,
    dead: false,
    actionCount: 0,
    loadout: opts.loadout || (() => {
      const starterSpells = ['spl_missile', 'spl_mend'];
      const unlockedSpells = getUnlocked('spells').filter(id => !starterSpells.includes(id));
      const unlockedWearables = getUnlocked('wearables');
      const bag = new Set(unlockedWearables);
      const memory = getEquippedMemory();
      const equipped = { weapon: null, robe: null, amulet: null, ring1: null, ring2: null };
      for (const slot of Object.keys(equipped)) {
        const id = memory[slot];
        if (id && bag.has(id)) equipped[slot] = id;
      }
      return {
        spells: [...starterSpells, ...unlockedSpells],
        consumables: ['itm_heal_run', 'itm_restore_run'],
        wearables: [...unlockedWearables],
        equipped,
      };
    })(),
  };
  // Codex: any spell in the starter loadout is "known" — it's already a script in your kit.
  for (const id of player.loadout.spells || []) markKnown('spells', id);
  return player;
}

// ---------- Combat state ----------

export function startCombat({ player, enemies = [], allies = [], data, rng, log, onConnChange }) {
  const combat = {
    tick: 0,
    actors: [player, ...allies, ...enemies],
    log: [],
    ended: false,
    result: null,
    data,
    rng,
    logFn: log || (() => {}),
    onConnChange: onConnChange || null,
  };

  // Fire onSpawn for every actor (statuses + monster passives + future wearables).
  for (const actor of combat.actors) {
    const ctx = buildCtxFor(actor, combat, { target: player });
    fireHooks(actor, 'onSpawn', ctx, { target: player });
    fireBarks(actor, 'onSpawn', ctx, { target: player });
  }
  return combat;
}

// ---------- Helpers ----------

function teamAllies(combat, actor) {
  return combat.actors.filter(a => isAlive(a) && a.team === actor.team && a !== actor);
}
function teamEnemies(combat, actor) {
  return combat.actors.filter(a => isAlive(a) && a.team !== actor.team);
}

function buildCtxFor(actor, combat, opts = {}) {
  return makeContext(actor, opts.target ?? null, {
    rng: combat.rng,
    data: combat.data,
    log: combat.logFn,
    tick: combat.tick,
    allEnemies: teamEnemies(combat, actor),
    allAllies: teamAllies(combat, actor),
    onConnChange: combat.onConnChange,
  });
}

function runEffectsAsActor(actor, atoms, combat, opts = {}) {
  const ctx = buildCtxFor(actor, combat, opts);
  return executeAtoms(atoms, ctx);
}

// ---------- AI ----------

function fireFlavor(actor, combat) {
  const def = combat.data.monster(actor.defId);
  if (!def?.flavor?.length) return;
  for (const f of def.flavor) {
    if (f.chance != null && combat.rng() >= f.chance) continue;
    if (f.condition != null) {
      const ctx = buildCtxFor(actor, combat);
      if (!evalExpr(f.condition, ctx)) continue;
    }
    runEffectsAsActor(actor, f.effects || [], combat);
  }
}

function chooseAiAction(actor, combat) {
  const def = combat.data.monster(actor.defId);
  if (!def?.actions?.length) return null;

  const eligible = def.actions.filter(a => {
    if (a.chance != null && combat.rng() >= a.chance) return false;
    if (a.condition != null) {
      const ctx = buildCtxFor(actor, combat);
      if (!evalExpr(a.condition, ctx)) return false;
    }
    return true;
  });
  if (!eligible.length) return null;
  return weightedPick(combat.rng, eligible, a => a.weight ?? 1);
}

function executeAiAction(action, actor, combat) {
  if (!action) {
    combat.logFn(`${actor.name} hesitates.`);
    return;
  }
  // AI default target: first living actor on opposing team.
  const target = combat.actors.find(a => isAlive(a) && a.team !== actor.team);
  const verb = action.name || 'attacks';
  const intransitive = action.narrate === 'self';
  if (target && target !== actor && !intransitive) {
    combat.logFn(`${actor.name} ${verb} ${target.name}.`);
  } else {
    combat.logFn(`${actor.name} ${verb}.`);
  }
  runEffectsAsActor(actor, action.effects || [], combat, { target });
}

// ---------- Player actions ----------

const DEFAULT_PLAYER_ATTACK_EFFECTS = [
  { type: 'damage', target: 'target', amount: '1d6+ATK', damageType: 'physical' },
];

async function executePlayerAction(action, actor, combat, hooks) {
  if (!action || action.kind === 'wait') {
    combat.logFn(`${actor.name} waits.`);
    return;
  }
  if (action.kind === 'flee') {
    combat.logFn(`${actor.name} disconnects from the node.`);
    combat.ended = true;
    combat.result = 'flee';
    return;
  }
  if (action.kind === 'cast') {
    const spell = combat.data.spell(action.spellId);
    if (!spell) { combat.logFn(`Unknown spell ${action.spellId}.`); return; }
    if (spell.cost?.mp && (actor.stats.mp ?? 0) < spell.cost.mp) {
      combat.logFn(`${actor.name} lacks MP for ${spell.name}.`);
      return;
    }
    if (spell.cost?.mp)   actor.stats.mp -= spell.cost.mp;
    if (spell.cost?.conn && hooks?.onConnCost) hooks.onConnCost(spell.cost.conn);

    const target = action.targetId
      ? combat.actors.find(a => a.id === action.targetId)
      : null;
    combat.logFn(`${actor.name} casts ${spell.name}.`);
    const castCtx = buildCtxFor(actor, combat, { target });
    fireHooks(actor, 'onCast', castCtx, { target });
    fireBarks(actor, 'onCast', castCtx, { target });
    runEffectsAsActor(actor, spell.effects, combat, { target });
    return;
  }
  if (action.kind === 'attack') {
    const target = combat.actors.find(a => a.id === action.targetId);
    if (!target) { combat.logFn(`${actor.name} has no target.`); return; }
    combat.logFn(`${actor.name} strikes ${target.name}.`);
    runEffectsAsActor(actor, DEFAULT_PLAYER_ATTACK_EFFECTS, combat, { target });
    return;
  }
  if (action.kind === 'item') {
    const item = combat.data.item(action.itemId);
    if (!item) { combat.logFn(`Unknown item ${action.itemId}.`); return; }
    const target = action.targetId ? combat.actors.find(a => a.id === action.targetId) : null;
    combat.logFn(`${actor.name} runs ${item.name}.`);
    runEffectsAsActor(actor, item.effects || [], combat, { target });
    // Remove first matching instance from loadout.consumables.
    const list = actor.loadout?.consumables || [];
    const idx = list.indexOf(action.itemId);
    if (idx >= 0) list.splice(idx, 1);
    return;
  }
  combat.logFn(`Unknown action kind: ${action.kind}`);
}

// ---------- Death + end ----------

function reapDead(combat) {
  for (const actor of combat.actors) {
    if (actor.dead) continue;
    if ((actor.stats.hp ?? 0) <= 0) {
      combat.logFn(`${actor.name} falls.`);
      if (actor.defId && actor.team === 'enemy') {
        // Codex: monsters identified on kill (player's enemies only).
        markKnown('monsters', actor.defId);
      }
      // Fire onDeath before flagging dead, so the hook walker doesn't skip the actor.
      const ctx = buildCtxFor(actor, combat);
      fireHooks(actor, 'onDeath', ctx);
      fireBarks(actor, 'onDeath', ctx);
      actor.dead = true;
    }
  }
}

function checkEndConditions(combat) {
  if (combat.ended) return;
  const player = combat.actors.find(a => a.isPlayer);
  if (!player || !isAlive(player)) {
    combat.ended = true;
    combat.result = 'defeat';
    return;
  }
  const enemyAlive = combat.actors.some(a => isAlive(a) && a.team === 'enemy');
  if (!enemyAlive) {
    combat.ended = true;
    combat.result = 'victory';
  }
}

// ---------- Main loop ----------

const SAFETY_ITERATION_LIMIT = 20000;

export async function runCombat(combat, hooks = {}) {
  let iterations = 0;

  while (!combat.ended) {
    if (++iterations > SAFETY_ITERATION_LIMIT) {
      combat.ended = true;
      combat.result = 'error';
      combat.logFn('Combat exceeded iteration limit.');
      break;
    }

    advanceTick(combat);
    if (hooks.onTick) await hooks.onTick(combat);
    const ready = actorsThatCanAct(combat);
    if (!ready.length) continue;

    for (const actor of ready) {
      if (combat.ended) break;
      if (!isAlive(actor)) continue;

      // 1. Flavor (free, ambient effects, monsters only)
      if (!actor.isPlayer) fireFlavor(actor, combat);

      // 2. Status onTurnStart (DOTs etc.)
      const ctxStart = buildCtxFor(actor, combat);
      fireHooks(actor, 'onTurnStart', ctxStart);
      reapDead(combat);
      checkEndConditions(combat);
      if (combat.ended) break;
      if (!isAlive(actor)) { consumeAction(actor); continue; }

      // 3. Action — but cannotAct (e.g. stunned) consumes the turn without acting.
      // actionCount tracks how many real actions an actor has taken (drives turn-aware
      // condition expressions like `self.actionCount % 2`). cannotAct turns don't count.
      if (actorHasFlag(actor, 'cannotAct')) {
        combat.logFn(`${actor.name} cannot act.`);
      } else if (actor.isPlayer) {
        const action = (hooks.getPlayerAction
          ? await hooks.getPlayerAction(actor, combat)
          : { kind: 'wait' });
        await executePlayerAction(action, actor, combat, hooks);
        actor.actionCount = (actor.actionCount || 0) + 1;
      } else {
        const action = chooseAiAction(actor, combat);
        executeAiAction(action, actor, combat);
        actor.actionCount = (actor.actionCount || 0) + 1;
      }
      reapDead(combat);
      checkEndConditions(combat);
      if (combat.ended) break;

      // 4. onTurnEnd + duration tick
      if (isAlive(actor)) {
        const ctxEnd = buildCtxFor(actor, combat);
        fireHooks(actor, 'onTurnEnd', ctxEnd);
        tickStatusDurations(actor, ctxEnd);
      }
      reapDead(combat);
      checkEndConditions(combat);

      consumeAction(actor);
      if (hooks.onAfterAction) await hooks.onAfterAction(actor, combat);
    }
  }
  return { result: combat.result, combat };
}
