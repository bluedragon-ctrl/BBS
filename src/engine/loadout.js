// Wearables system — slot-based gear with stat modifiers and hooks.
//
// Player loadout shape:
//   loadout.spells       : ids of currently-known cast scripts (per-run)
//   loadout.consumables  : ids of carried single-use items (per-run, consumed)
//   loadout.wearables    : ids of wearables found this run, deduped (per-run)
//   loadout.equipped     : { weapon, robe, amulet, ring1, ring2 } each id|null
//
// IDs throughout — defs are resolved on demand via data.item(id).

import { fireHooks } from './atoms.js';
import { markKnown } from './codex.js';

export const SLOTS = ['weapon', 'robe', 'amulet', 'ring1', 'ring2'];

// Which slot kinds an item targets. `slot` on the def is one of:
// 'weapon' | 'robe' | 'amulet' | 'ring' (rings fit either ring1 or ring2).
export function slotsFittingItem(itemDef) {
  if (!itemDef) return [];
  if (itemDef.slot === 'ring') return ['ring1', 'ring2'];
  if (SLOTS.includes(itemDef.slot)) return [itemDef.slot];
  return [];
}

export function emptyEquipped() {
  return { weapon: null, robe: null, amulet: null, ring1: null, ring2: null };
}

// Add a wearable id to the player's run-bag if not already present, and mark
// the codex entry. Returns true if this was a new pickup.
export function addWearable(player, itemId) {
  if (!player.loadout) return false;
  player.loadout.wearables = player.loadout.wearables || [];
  if (player.loadout.wearables.includes(itemId)) return false;
  player.loadout.wearables.push(itemId);
  markKnown('wearables', itemId);
  return true;
}

// Equip an item (by id) into a target slot. The item must already be in
// loadout.wearables (i.e. found this run). If the slot is occupied the
// previous item simply stays in the bag (it isn't removed by being equipped,
// so swapping doesn't lose anything).
//
// `slot` should be one of SLOTS. For ring items, callers pick ring1 or ring2
// explicitly.
//
// Fires `onApply` for the new item and `onRemove` for the displaced one
// (if any), so reactive gear "wakes up" cleanly. ctx is required for hooks.
export function equipItem(player, itemId, slot, ctx) {
  if (!player.loadout) return false;
  const data = ctx?.data;
  if (!data) return false;
  const itemDef = data.item(itemId);
  if (!itemDef || itemDef.kind !== 'wearable') return false;

  const fitting = slotsFittingItem(itemDef);
  if (!fitting.includes(slot)) return false;

  // Run-inventory check — wearable must be in the bag.
  if (!player.loadout.wearables?.includes(itemId)) return false;

  const equipped = player.loadout.equipped ||= emptyEquipped();
  const previousId = equipped[slot];

  // Fire onRemove for the displaced item (if any). Must happen before we
  // clear the slot, since fireHooks reads loadout.equipped to find sources.
  if (previousId && previousId !== itemId) {
    const prevDef = data.item(previousId);
    if (prevDef?.hooks?.onRemove?.length) {
      fireHooks(player, 'onRemove', ctx);
    }
  }

  equipped[slot] = itemId;

  // Fire onApply for the newly equipped item.
  if (itemDef.hooks?.onApply?.length) {
    fireHooks(player, 'onApply', ctx);
  }

  return true;
}

export function unequipSlot(player, slot, ctx) {
  if (!player.loadout?.equipped) return false;
  const id = player.loadout.equipped[slot];
  if (!id) return false;
  const def = ctx?.data?.item?.(id);
  // Fire onRemove BEFORE clearing the slot so the hook's source still resolves.
  if (def?.hooks?.onRemove?.length) {
    fireHooks(player, 'onRemove', ctx);
  }
  player.loadout.equipped[slot] = null;
  return true;
}

// Returns the def for an equipped slot, or null.
export function equippedDef(player, slot, data) {
  const id = player?.loadout?.equipped?.[slot];
  return id ? (data?.item?.(id) || null) : null;
}

// Returns array of { id, def } for items in the bag matching the given slot.
// For ring1/ring2 we accept any ring item.
export function bagFittingSlot(player, slot, data) {
  const ids = player?.loadout?.wearables || [];
  const out = [];
  for (const id of ids) {
    const def = data.item(id);
    if (!def) continue;
    if (slotsFittingItem(def).includes(slot)) out.push({ id, def });
  }
  return out;
}
