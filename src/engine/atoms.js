// Effect atom registry + executor + status hooks.

import { evalExpr } from './expr.js';
import { markKnown } from './codex.js';

// Module-level data reference. Set once at boot via setDataRef(data) so that
// hook walkers and stat resolvers can look up equipped item defs by id without
// every call site threading `data` through. Used by allModifiers / fireHooks /
// effectiveStat when reading actor.loadout.equipped[slot] (which holds ids).
let _dataRef = null;
export function setDataRef(data) { _dataRef = data; }

function* equippedDefs(actor) {
  const equipped = actor?.loadout?.equipped;
  if (!equipped || !_dataRef?.item) return;
  for (const slot of Object.keys(equipped)) {
    const id = equipped[slot];
    if (!id) continue;
    const def = _dataRef.item(id);
    if (def) yield def;
  }
}

// ---------- Stat resolution ----------

// Stats are stored on actor.stats with lowercase keys (hp, maxHp, mp, maxMp, int, def, spd, conn, maxConn).
// Status modifiers: { stat: "DEF", add: 4 } or { stat: "spd", mult: 0.5 } — matched case-insensitively.
// Equipped wearables contribute the same way via def.modifiers.
export function effectiveStat(actor, statName) {
  if (!actor) return 0;
  const lower = String(statName).toLowerCase();
  let val = actor.stats?.[lower] ?? 0;
  let mult = 1;
  const apply = (mods) => {
    for (const m of mods ?? []) {
      if (String(m.stat || '').toLowerCase() === lower) {
        if (m.add  != null) val += m.add;
        if (m.mult != null) mult *= m.mult;
      }
    }
  };
  for (const s of actor.statuses ?? []) apply(s.def?.modifiers);
  for (const def of equippedDefs(actor))     apply(def.modifiers);
  return val * mult;
}

// ---------- Modifier walkers (target-side / flag-style) ----------

// Iterates every modifier object attached to actor — across active statuses and
// equipped wearables — for non-stat fields like damageTakenMult / flags.
function* allModifiers(actor) {
  for (const s of actor?.statuses ?? []) {
    for (const m of s.def?.modifiers ?? []) yield m;
  }
  for (const def of equippedDefs(actor)) {
    for (const m of def.modifiers ?? []) yield m;
  }
}

// Returns { mult, add } aggregated across all sources. mult is a product, add is a sum.
// A modifier with `damageType: "physical"` (or any other type) only applies to that
// damage type. Modifiers without `damageType` apply to all incoming damage.
export function damageTakenMods(actor, damageType) {
  let mult = 1, add = 0;
  for (const m of allModifiers(actor)) {
    if (m.damageType != null && damageType != null && m.damageType !== damageType) continue;
    if (m.damageTakenMult != null) mult *= m.damageTakenMult;
    if (m.damageTakenAdd  != null) add  += m.damageTakenAdd;
  }
  return { mult, add };
}

// Returns true if any active status / wearable declares `flags: [name]`.
export function actorHasFlag(actor, name) {
  for (const m of allModifiers(actor)) {
    if (Array.isArray(m.flags) && m.flags.includes(name)) return true;
  }
  for (const s of actor?.statuses ?? []) {
    if (Array.isArray(s.def?.flags) && s.def.flags.includes(name)) return true;
  }
  for (const def of equippedDefs(actor)) {
    if (Array.isArray(def.flags) && def.flags.includes(name)) return true;
  }
  return false;
}

// ---------- Context ----------

const SHORTCUT_STATS = ['HP', 'MP', 'INT', 'ATK', 'DEF', 'SPD', 'CONN'];

export function makeContext(self, target, opts = {}) {
  const ctx = {
    self,
    target,
    allEnemies: opts.allEnemies ?? [],
    allAllies: opts.allAllies ?? [],
    rng: opts.rng,
    tick: opts.tick ?? 0,
    log: opts.log ?? (msg => console.log(msg)),
    data: opts.data,
    onTokenGain: opts.onTokenGain,
    onConnChange: opts.onConnChange,
  };
  Object.defineProperty(ctx, 'all', {
    get: () => [...ctx.allEnemies, ...ctx.allAllies],
    enumerable: true,
  });

  if (self) {
    // Getters read this.self dynamically so subCtx = Object.create(ctx); subCtx.self = other
    // resolves stats against the override (used by fireHooks when a hook fires on a non-self actor).
    for (const k of SHORTCUT_STATS) {
      Object.defineProperty(ctx, k, {
        get() { return effectiveStat(this.self, k); },
        enumerable: true,
      });
    }
    Object.defineProperty(ctx, 'MAX_HP', { get() { return this.self?.stats?.maxHp ?? 0; }, enumerable: true });
    Object.defineProperty(ctx, 'MAX_MP', { get() { return this.self?.stats?.maxMp ?? 0; }, enumerable: true });
  }
  return ctx;
}

// ---------- Target resolution ----------

export function resolveTarget(keyword, ctx) {
  switch (keyword) {
    case 'self':       return ctx.self ? [ctx.self] : [];
    case 'target':
    case 'enemy':      return ctx.target ? [ctx.target] : [];
    case 'allEnemies': return [...ctx.allEnemies];
    case 'ally':       return ctx.target && ctx.allAllies.includes(ctx.target) ? [ctx.target] : [];
    case 'allAllies':  return [...ctx.allAllies];
    case 'lowestHpAlly': {
      const allies = ctx.allAllies ?? [];
      if (!allies.length) return [];
      let pick = allies[0];
      for (const a of allies) {
        if ((a.stats?.hp ?? 0) < (pick.stats?.hp ?? 0)) pick = a;
      }
      return [pick];
    }
    case 'all':        return [...ctx.allEnemies, ...ctx.allAllies];
    default:           return [];
  }
}

// ---------- Atom registry ----------

const ATOMS = {};

export function registerAtom(name, fn) { ATOMS[name] = fn; }

export function executeAtoms(atoms, ctx) {
  const results = [];
  for (const atom of atoms || []) {
    if (atom.condition != null) {
      const ok = evalExpr(atom.condition, ctx);
      if (!ok) continue;
    }
    const handler = ATOMS[atom.type];
    if (!handler) {
      ctx.log(`(unknown atom "${atom.type}")`);
      continue;
    }
    const targets = resolveTarget(atom.target ?? 'self', ctx);
    for (const t of targets) {
      const subCtx = Object.create(ctx);
      subCtx.target = t;
      const r = handler(atom, subCtx);
      if (r) results.push(r);
    }
  }
  return results;
}

// ---------- Status helpers ----------

export function applyStatusToActor(actor, statusDef, duration, ctx) {
  if (!actor || !statusDef) return;
  actor.statuses ??= [];
  const dur = duration ?? statusDef.duration ?? 3;
  const mode = statusDef.stackMode || 'refresh';
  const existing = actor.statuses.find(s => s.def.id === statusDef.id);

  if (existing && mode !== 'independent') {
    if (mode === 'refresh')      existing.duration = Math.max(existing.duration, dur);
    else if (mode === 'stack')   existing.duration += dur;
    else if (mode === 'replace') existing.duration = dur;
    return;
  }

  const inst = { def: statusDef, duration: dur };
  actor.statuses.push(inst);
  const subCtx = Object.create(ctx);
  subCtx.self = actor;
  subCtx.target = actor;
  executeAtoms(statusDef.hooks?.onApply || [], subCtx);
}

export function removeStatusFromActor(actor, idOrTag, ctx) {
  if (!actor?.statuses) return 0;
  let removed = 0;
  actor.statuses = actor.statuses.filter(s => {
    const match = s.def.id === idOrTag || (s.def.tags || []).includes(idOrTag);
    if (match) {
      const subCtx = Object.create(ctx);
      subCtx.self = actor;
      subCtx.target = actor;
      executeAtoms(s.def.hooks?.onRemove || [], subCtx);
      removed++;
    }
    return !match;
  });
  return removed;
}

// Unified hook walker — runs `def.hooks[hookName]` atoms from every source attached to actor:
//   1. Active statuses (actor.statuses[*].def.hooks)
//   2. Equipped wearables (actor.loadout.equipped[*].hooks) — equip flow lands later, walk is a no-op until then
//   3. Monster passive (data.monster(actor.defId).hooks) — always-on while alive
// opts.target overrides ctx.target (default: actor itself). ctx.self is always the hook owner.
export function fireHooks(actor, hookName, ctxBase, opts = {}) {
  if (!actor || actor.dead) return;
  const target = opts.target ?? actor;
  const sources = [];

  for (const s of actor.statuses ?? []) {
    const hooks = s.def?.hooks?.[hookName];
    if (hooks?.length) sources.push(hooks);
  }

  for (const def of equippedDefs(actor)) {
    const hooks = def.hooks?.[hookName];
    if (hooks?.length) sources.push(hooks);
  }

  if (actor.defId && ctxBase?.data?.monster) {
    const def = ctxBase.data.monster(actor.defId);
    const hooks = def?.hooks?.[hookName];
    if (hooks?.length) sources.push(hooks);
  }

  if (!sources.length) return;
  for (const atoms of sources) {
    const subCtx = Object.create(ctxBase);
    subCtx.self = actor;
    subCtx.target = target;
    executeAtoms(atoms, subCtx);
  }
}

// Back-compat alias — existing callers still work; prefer fireHooks for new code.
export const fireStatusHooks = fireHooks;

// Decrements duration on each status; returns ids that expired (after firing onRemove).
export function tickStatusDurations(actor, ctx) {
  if (!actor?.statuses?.length) return [];
  const expired = [];
  actor.statuses = actor.statuses.filter(s => {
    if (s.duration < 0) return true; // permanent
    s.duration -= 1;
    if (s.duration <= 0) {
      const subCtx = Object.create(ctx);
      subCtx.self = actor;
      subCtx.target = actor;
      executeAtoms(s.def.hooks?.onRemove || [], subCtx);
      expired.push(s.def.id);
      return false;
    }
    return true;
  });
  return expired;
}

// ---------- Built-in atoms ----------

registerAtom('damage', (atom, ctx) => {
  const t = ctx.target;
  if (!t) return null;
  const raw = Math.max(0, Math.floor(evalExpr(atom.amount, ctx)));
  const damageType = atom.damageType || 'physical';
  // damageType is a forward-compat tag; current engine reduces all non-pure damage by DEF.
  // Target-side mult/add can filter on damageType (e.g. physical-resist via damageTakenMult 0.7).
  const def = atom.ignoresDef ? 0 : effectiveStat(t, 'def');
  // Order: raw → DEF → mult → add. ignoresDef skips DEF only; target-side mult/add still apply.
  const afterDef = Math.max(0, raw - def);
  const { mult, add } = damageTakenMods(t, damageType);
  const dmg = Math.max(0, Math.floor(afterDef * mult) + add);
  t.stats.hp = Math.max(0, (t.stats.hp ?? 0) - dmg);
  ctx.log(`${t.name} takes ${dmg} damage.`);
  if (dmg > 0) {
    const attacker = ctx.self;
    fireHooks(t, 'onDamaged', ctx, { target: attacker || t });
    if (attacker && attacker !== t) fireHooks(attacker, 'onDealDamage', ctx, { target: t });
    if ((t.stats.hp ?? 0) <= 0 && attacker && attacker !== t) {
      fireHooks(attacker, 'onKill', ctx, { target: t });
    }
    // Lifesteal: heal the attacker for floor(dmg * lifesteal) on hit.
    // Self-targeted damage (attacker === t) skips lifesteal — no free healing loops.
    if (atom.lifesteal != null && attacker && attacker !== t) {
      const stolen = Math.floor(dmg * atom.lifesteal);
      if (stolen > 0) {
        const before = attacker.stats.hp ?? 0;
        const cap = attacker.stats.maxHp ?? before + stolen;
        attacker.stats.hp = Math.min(cap, before + stolen);
        const healed = attacker.stats.hp - before;
        if (healed > 0) ctx.log(`${attacker.name} drains ${healed} HP.`);
      }
    }
  }
  return { kind: 'damage', target: t.id, amount: dmg, damageType };
});

registerAtom('heal', (atom, ctx) => {
  const t = ctx.target;
  if (!t) return null;
  const amt = Math.max(0, Math.floor(evalExpr(atom.amount, ctx)));
  const before = t.stats.hp ?? 0;
  t.stats.hp = Math.min(t.stats.maxHp ?? before + amt, before + amt);
  const healed = (t.stats.hp ?? 0) - before;
  ctx.log(`${t.name} heals ${healed} HP.`);
  return { kind: 'heal', target: t.id, amount: healed };
});

registerAtom('drainMana', (atom, ctx) => {
  const t = ctx.target;
  if (!t) return null;
  const amt = Math.max(0, Math.floor(evalExpr(atom.amount, ctx)));
  t.stats.mp = Math.max(0, (t.stats.mp ?? 0) - amt);
  ctx.log(`${t.name} loses ${amt} MP.`);
  return { kind: 'drainMana', target: t.id, amount: amt };
});

registerAtom('applyStatus', (atom, ctx) => {
  const t = ctx.target;
  if (!t) return null;
  const def = ctx.data?.status(atom.effect);
  if (!def) { ctx.log(`(unknown status "${atom.effect}")`); return null; }
  const duration = atom.duration != null ? Math.floor(evalExpr(atom.duration, ctx)) : undefined;
  applyStatusToActor(t, def, duration, ctx);
  // Codex: status identified once it's been used or received in combat.
  markKnown('statuses', def.id);
  ctx.log(`${t.name} is afflicted with ${def.shortName || def.name}.`);
  return { kind: 'applyStatus', target: t.id, status: def.id };
});

registerAtom('removeStatus', (atom, ctx) => {
  const t = ctx.target;
  if (!t) return null;
  const removed = removeStatusFromActor(t, atom.effect, ctx);
  if (removed > 0) ctx.log(`${t.name} is cleansed of ${atom.effect}.`);
  return { kind: 'removeStatus', target: t.id, effect: atom.effect, removed };
});

// ---------- Real atoms (token / conn / mana / cleanse) ----------

registerAtom('addToken', (atom, ctx) => {
  const amt = Math.max(0, Math.floor(evalExpr(atom.amount, ctx)));
  if (amt > 0 && ctx.onTokenGain) ctx.onTokenGain(amt);
  if (amt > 0) ctx.log(`+${amt} TOKEN${amt === 1 ? '' : 'S'}.`);
  return { kind: 'addToken', amount: amt };
});

// drainConnection: amount expressed in percentage points (0-100). Positive = drain, negative = restore.
// Intentionally silent — the caller (combat overlay / event outcome text) handles narration so
// CONN damage reads as a separate "system is fighting back" event rather than a log line.
registerAtom('drainConnection', (atom, ctx) => {
  const amt = Math.floor(evalExpr(atom.amount, ctx));
  if (amt && ctx.onConnChange) ctx.onConnChange(-amt / 100);
  return { kind: 'drainConnection', amount: amt };
});

registerAtom('restoreMana', (atom, ctx) => {
  const t = ctx.target;
  if (!t) return null;
  const amt = Math.max(0, Math.floor(evalExpr(atom.amount, ctx)));
  const before = t.stats.mp ?? 0;
  t.stats.mp = Math.min(t.stats.maxMp ?? before + amt, before + amt);
  const restored = (t.stats.mp ?? 0) - before;
  if (restored > 0) ctx.log(`${t.name} restores ${restored} MP.`);
  return { kind: 'restoreMana', target: t.id, amount: restored };
});

// cleanse: removes statuses by kind ('debuff' default) or tag.
registerAtom('cleanse', (atom, ctx) => {
  const t = ctx.target;
  if (!t || !t.statuses) return null;
  const tag = atom.tag;
  const kind = atom.kind || (tag ? null : 'debuff');
  const before = t.statuses.length;
  t.statuses = t.statuses.filter(s => {
    if (tag && (s.def.tags || []).includes(tag)) return false;
    if (kind && s.def.kind === kind) return false;
    return true;
  });
  const removed = before - t.statuses.length;
  if (removed > 0) ctx.log(`${t.name} is cleansed (${removed} effect${removed === 1 ? '' : 's'} removed).`);
  return { kind: 'cleanse', target: t.id, removed };
});

// ---------- Stub atoms ----------
// Registered so executeAtoms doesn't bail; later steps replace these in place.
const STUB_ATOMS = [
  'buff', 'debuff', 'summon', 'dispel',
  'move', 'swap', 'flee', 'teleport',
  'revealNode', 'revealCodex', 'peekDeck',
  'resetRoom', 'deleteEnemy', 'corruptEnemy', 'glitchSelf',
  'identify', 'spawnLoot', 'scriptHook',
];
for (const name of STUB_ATOMS) {
  registerAtom(name, (atom, ctx) => {
    ctx.log(`(stub: ${name})`);
    return { kind: 'stub', type: name };
  });
}
