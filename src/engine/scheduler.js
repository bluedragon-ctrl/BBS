// Speed scheduler — discrete-tick energy accumulation, NetHack-style.
//
// Each actor gains `effectiveStat('spd')` energy per tick. When energy >= ENERGY_THRESHOLD,
// the actor acts and energy -= ENERGY_THRESHOLD (carry-over preserved).

import { effectiveStat } from './atoms.js';

export const ENERGY_THRESHOLD = 100;

export function isAlive(actor) {
  return !!actor && !actor.dead && (actor.stats?.hp ?? 0) > 0;
}

export function advanceTick(combat) {
  combat.tick = (combat.tick || 0) + 1;
  for (const actor of combat.actors) {
    if (!isAlive(actor)) continue;
    actor.energy = (actor.energy || 0) + effectiveStat(actor, 'spd');
  }
}

export function actorsThatCanAct(combat) {
  return combat.actors
    .filter(a => isAlive(a) && (a.energy || 0) >= ENERGY_THRESHOLD)
    .sort((a, b) => {
      const dE = (b.energy || 0) - (a.energy || 0);
      if (dE !== 0) return dE;
      return effectiveStat(b, 'spd') - effectiveStat(a, 'spd');
    });
}

export function consumeAction(actor, cost = ENERGY_THRESHOLD) {
  actor.energy = (actor.energy || 0) - cost;
}

// For UI energy bars: how many ticks until this actor next reaches the threshold.
export function ticksUntilAct(actor) {
  const spd = effectiveStat(actor, 'spd');
  if (spd <= 0) return Infinity;
  const remaining = Math.max(0, ENERGY_THRESHOLD - (actor.energy || 0));
  return Math.ceil(remaining / spd);
}
