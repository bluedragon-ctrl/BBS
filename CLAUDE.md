# NETROMANCER.BBS

## What this is

A roguelike where a simulated 80s BBS (bulletin board system) is the dungeon. The player is a mage/hacker exploring nodes (rooms), fighting monsters, learning spells. The progression arc is **mage → hacker**: standard fantasy spells unlock first; "exploit" spells (RESET.EXE, DELETE, CORRUPT) are mid/late-run discoveries that interact with the BBS itself. Aesthetic is 80s retro CRT — neon phosphor, scanlines, ASCII art, terminal frames.

## How to run

```
python -m http.server 8123
```

Open `http://localhost:8123` in a browser. No build step, no npm. Plain ES modules — must be served via HTTP (not `file://`).

`.claude/launch.json` defines a preview server profile named `netromancer` for use with the Claude Code preview tool.

## File layout

```
BBS/
  index.html                   entry — all screens as <section data-screen="...">
  style.css                    VT323, palette, scanlines, glow, panels, signal bar
  run.bat                      Windows launch script (python http.server)
  CLAUDE.md                    this file
  .gitignore
  .claude/launch.json          preview server profile (port 8765 — auto-port enabled)
  data/
    monsters.json              monster defs (stats, ascii, ai, actions, hooks, loot)
    spells.json                spell defs (school, tier, cost, targeting, effects)
    statuses.json              status defs (kind, tags, modifiers, hooks, duration)
    items.json                 wearables + consumables (kind: 'wearable' | 'consumable')
    events.json                event defs (title, description, choices with weighted outcomes)
    nodes.json                 (reserved — currently empty; map gen builds nodes procedurally)
  src/
    game.js                    main entry — wires modules, runs boot sequence
    screen.js                  screen router (showScreen / activeScreen)
    log.js                     log strip — queue + typewriter + flush-on-input
    run.js                     run lifecycle — startNewRun, continueRun, resolveNode, persistRun
    engine/
      rng.js                   Mulberry32 seeded PRNG + weightedPick / pick helpers
      expr.js                  dice + arithmetic evaluator (NdM, with-binding for stats)
      atoms.js                 atom registry, executeAtoms, fireHooks, effectiveStat,
                               damageTakenMods, actorHasFlag, status helpers, setDataRef
      data.js                  JSON loader with cache-bust, lookup API
      scheduler.js             NetHack-style energy threshold scheduler
      combat.js                combat orchestration, AI, end conditions, hook firing
      map.js                   Slay-the-Spire DAG generator + node type weights
      save.js                  localStorage suspend (single slot, wiped on load)
      codex.js                 persistent codex (across runs, separate from save slot)
      loadout.js               equip/unequip API, slot resolution, addWearable
    ui/
      terminal.js              showTerminalSequence — top-right modal for BBS messages
      combat.js                combat UI — list view, modals, target nav, log overlay
      map.js                   left-to-right node graph, right-angle box-drawing edges
      codex.js                 tabbed codex screen (M/S/W/C/E)
      nodes.js                 shrine / cache / event / shop / boss-intro handlers
      inventory.js             slot-first wearable picker with live stat-diff preview
      glitch.js                visual glitch primitives + connection-driven scheduler
      util.js                  shared formatters (escapeHtml, stat blocks, etc.)
```

## Locked design decisions

| Area | Decision |
|---|---|
| Genre | Roguelike, permadeath, single fantasy-themed BBS |
| Map | Slay-the-Spire DAG, ~15 nodes / 6 layers, SYSOP node = win condition |
| Map visibility | Show current node + immediate next-step nodes only (fog of war); future codex/items may unlock further peek |
| Combat | Turn-based, NetHack-style speed scheduler (each actor accumulates energy per tick, acts when threshold hit) |
| Combat scale | Player + summoned allies vs up to 10 enemies |
| Combat UI | List view by default, all combatants in one list with per-row stats, statuses, energy bar, ticks-until-action; ASCII art (~7×14) shown only via inspect |
| Targeting | Numbered list selection (`1-9, 0, a-z`); selection happens in right panel, not modal |
| Modals | Codex, full inventory view, confirms, game over |
| Stats | HP, MP, INT, ATK, DEF, SPD, CONN |
| Damage typing | INT scales magic offense and (planned) magic resistance — no separate RES stat. ATK scales physical melee. DEF reduces all damage in v1; magic-vs-INT mitigation is a planned refinement. `damageType: 'physical'\|'magical'\|'pure'` is a forward-compat tag on damage atoms (currently no behavioural effect) |
| Connection (CONN) | Meta-resource. Drains only on death/failure (v1). Drives ambient screen degradation and stochastic glitches at low values |
| Spell schools | Arcane (mp cost), Exploit/Hacker (mp + conn cost), Hybrid (both) |
| Spell progression | Start with basic arcane spells; find new spells in run; discovered spells become *findable* in future runs (b2 model). Hacker spells are mid/late-run discoveries |
| Equipment slots | Weapon, Robe, Amulet, Ring, Ring |
| Items | Wearables = selection from known; consumables = free use; unknown items show as `???.SPL` etc. until identified |
| Codex | Known/unknown only (v1). Persists across runs — primary meta-progression |
| Currency | TOKENS |
| Node types | Combat, shop, library, shrine, event, elite, boss |
| Save | Suspend on room-leave (single slot, wiped on load) — no save-scumming |
| Audio | None v1; possible 8-bit pass later |

## Architecture conventions

- **All content is data-driven.** Monsters, spells, items, and nodes are defined in JSON under `data/`. Never hardcode content in JS files.
- **Behaviors = effect atoms + expression strings.** Behaviors are arrays of typed actions like `{type: "damage", target: "enemy", amount: "2d6+INT"}`. Numeric/conditional fields accept dice strings and small expressions evaluated against game state. Never embed raw JS in data — atoms only.
- **Screens** are hidden `<section data-screen="name">` elements in `index.html`. `showScreen(name)` toggles `.active`. Add new screens by adding sections, not by swapping documents.
- **Log strip** uses a queue + typewriter (30 ms/char). Use `logMessage(msg)` to append. Click outside any button or any keypress flushes the current line and queue.
- **Color palette legend** — green `--fg` = player/allies/safe; red `--enemy` = hostile actors; bright red `--danger` = crisis (low HP/CONN, debuff chips); magenta `--accent` = hacker theme + exploit/hybrid spells + chrome + key bindings; amber `--warn` = warning levels. Each colored variant has its own `text-shadow` glow override to avoid magenta-glowing-green halos.
- **CONN** is the single source of truth for connection-driven effects. `setConn(v)` writes to `state.conn` and the `--conn` CSS variable. Future glitch effects (scanline intensity, phosphor desat, noise overlay) must key off `--conn` rather than read state directly.
- **Glitch primitives** go through `triggerGlitch(type, intensity, target)`. Planned types: `scrambleText`, `tearLine`, `colorSwap`, `corruptBorders`, `flicker`. Mark glitchable text elements with `data-glitchable` so the system can find them.
- **Right column = selection and inspect.** Two roles: idle = show last hovered/selected entity; active selection = chooser for target/spell/item picks. Modals only for things that need overlay focus.
- **Combatants share one scheduler.** Player, allies, enemies are all actors with `speed` and accumulated `energy`. Same data model on both sides.
- **Hooks are unified.** `fireHooks(actor, hookName, ctxBase, opts)` walks every hook source attached to an actor — active statuses, equipped wearables (`actor.loadout.equipped[*]`), and the monster passive (`data.monster(actor.defId).hooks`). Same JSON shape everywhere: `hooks: { onX: [atoms] }`. Canonical names: `onSpawn, onTurnStart, onTurnEnd, onApply, onRemove, onDamaged, onDealDamage, onKill, onDeath, onCast`. `ctx.self` is always the hook owner; `opts.target` sets `ctx.target` (defaults to self) — for `onDamaged` it's the attacker, for `onDealDamage`/`onKill` the victim, for `onCast` the spell target. Atoms fire hooks at the semantically-owning moment (e.g. the `damage` atom fires `onDamaged`/`onDealDamage`/`onKill`); combat fires lifecycle hooks (`onSpawn`, turn boundaries, `onDeath`). Add new hook fire points by calling `fireHooks` from the atom or combat moment that owns the trigger — never invent a parallel walker.
- **Hook patterns to reach for.** Most content fits one of these shapes — author against them rather than inventing one-off mechanics.
  1. **periodic-pulse** — `onTurnStart` (or `onTurnEnd`) fires repeating atoms each turn the actor takes. Used by DoT statuses (bleed, corrupted) and regen statuses (patched).
  2. **retaliate-on-damaged** — `onDamaged` fires damage / status-application back at the attacker. `ctx.target` is the attacker by convention, so `target: "target"` reflects the effect. Used by reactive auras and thorns-style wearables.
  3. **on-cast-trigger** — `onCast` fires effects after the actor casts a spell (`ctx.target` = spell target, possibly null). Used for "every cast restores 1 MP" / "every cast applies a status" wearables.
  4. **apply-on-attack composition** — *not a hook* — a monster action's `effects` array bundles `damage` + `applyStatus` together. Default to this for "this attack also bleeds" rather than reaching for a hook; hooks are for triggers that don't fit a single discrete action.
- **Damage resolution order.** The `damage` atom resolves in this order: (1) `raw = floor(eval(amount))` — already includes source-side stat mods via `effectiveStat`; (2) DEF subtraction (`raw - target.def`, skipped when `ignoresDef: true`); (3) target-side multiplicative mods — product of every `damageTakenMult` from the target's statuses + equipped wearables; (4) target-side additive mods — sum of every `damageTakenAdd`. Final damage is floored at 0. `ignoresDef` skips DEF only — mult/add still apply, so `vulnerable`/`exposed` amplifies pure damage too. Modifier shape: `{ damageTakenMult: 1.5 }` and `{ damageTakenAdd: 1 }` sit alongside the existing `{ stat, add, mult }` shape; effectiveStat ignores them, `damageTakenMods` reads them.
- **Status flags.** Statuses can declare `flags: ["cannotAct"]` (top-level on the def, or on a modifier object). The combat loop checks `actorHasFlag(actor, "cannotAct")` at the action step; if set, the actor's turn is consumed without an action (used by `stunned`). Use flags for hard-CC / behavioral switches that aren't expressible as stat or damage modifiers.
- **`window.netro`** exposes `state`, `setConn`, `triggerGlitch` for devtools/preview-eval debugging. Add new entries here when introducing systems worth poking at runtime.

## Working rule

**Always discuss the implementation approach before writing or editing code.** Even after design is locked and the user has greenlit the next step, lay out the concrete choices first (file layout, library/framework picks, specific values, edge cases) and wait for confirmation. This applies per-step, not just at project start. Small visible tweaks the user explicitly directs ("change X to Y") can be done without ceremony, but anything involving a design choice requires the discussion.

## Build order

1. ~~Project skeleton + CSS aesthetic shell + boot screen + screen router~~ ✅
2. ~~Data loader + atom executor + expression evaluator~~ ✅
3. ~~Speed scheduler + combat loop~~ ✅
4. ~~Combat UI: list view, inspect modal, target popup, stats panel wiring~~ ✅
5. ~~Map generator + node navigation + suspend save/load~~ ✅
6. ~~Codex screen + identification flow~~ ✅
7. ~~Special node interactions (shop / cache / shrine / event / boss intro)~~ ✅
8a. ~~Glitch primitives + ambient connection-driven visuals~~ ✅
8b. ~~Unified hook system (statuses + wearables + monster passives via `fireHooks`)~~ ✅
8c. ~~Core effect vocabulary — 12 statuses (bleed, corrupted, stunned, slowed, hasted, warded, focused, patched, vulnerable, traced, barbed, phase) with damageTaken modifiers and cannotAct flag~~ ✅
8d. ~~Wearables system — slots, equip/unequip, inventory UI, 7 placeholder items, cache/shop pickups~~ ✅
9. **Content pass** ← next — expand monsters / spells / events / boss; balance pass

## Architecture summary (current)

- **Reusable terminal primitive** — `src/ui/terminal.js` exports `showTerminalSequence(lines, options)`. Used by boot dial-up, boss intro, death/victory sequences, and CONN-drain alerts. **All terminal output anchors to the top-right** of the viewport so the player learns "this window = the BBS speaking". Themes: `normal | alarm | failure | glitch`. The selector `.modal.terminal-modal` outranks the base `.modal` for positioning.
- **Node interaction handlers** — `src/ui/nodes.js` exports `showShrine / showCache / showEvent / showShop / showBossIntro`. `src/run.js`'s `resolveNode` dispatches by `node.type`. Each handler builds its own ctx via `makeContext` with `onTokenGain` and `onConnChange` callbacks. `showNodeModal` is a shared building block — title + flavor + numbered choices, arrow/Enter nav, mouse hover focus, key shortcuts, Esc-to-leave on `isLeave: true` choices.
- **Codex** — `src/engine/codex.js` persists in `localStorage.netromancer.codex` (separate from save slot). 5 categories: monsters / spells / wearables / consumables / statuses. Auto-marked: monsters on kill, spells on loadout entry, statuses on `applyStatus`, wearables on `addWearable` (cache/shop pickup or starter equip).
- **CONN model** — single global stat. `setConn(v)` writes to `state.conn` + `--conn` CSS var. `applyConnTier(v)` from `ui/glitch.js` sets a discrete tier class on the body for tiered visual degradation (scanline density, phosphor desat, vignette darkness). `drainConnection` atom is **silent** (caller narrates). Combat UI counts per-turn drain via `onConnChange` callback and fires a brief alarm-themed `showTerminalSequence` overlay after the turn completes, plus a `triggerGlitch('scrambleText', ...)` flourish.
- **Tokens** — `state.run.tokens`. Earned per encounter type: 50% chance of 1 on combat, `1d2` on elite, `4 + 1d4` on boss (silent on miss). Spent in shops. Display abbreviation is `tkn` (not `t` — collision with "turn").
- **Player loadout** — `{ spells, consumables, wearables, equipped }`:
  - `spells` — ids of currently-known cast scripts (per-run; codex marks across runs).
  - `consumables` — id list of carried single-use items (per-run; consumed on use). Display name suffix `.RUN` ("run-once").
  - `wearables` — id list (per-run, deduped) of wearables the player has found this run. Equipping does NOT remove from this list.
  - `equipped` — `{ weapon, robe, amulet, ring1, ring2 }` each `id|null`. Slot values are item ids; resolved to defs via `data.item(id)`.
- **Wearable resolution** — `setDataRef(data)` in `atoms.js` stashes a module-level data reference so `effectiveStat`, `allModifiers`, `actorHasFlag`, and `fireHooks` can resolve `equipped[slot]` ids to defs without threading `data` through every call site. The internal `equippedDefs(actor)` iterator yields each equipped item's def; everything iterates through it.
- **Run state** — `state.run = { seed, map, currentNodeId, previousNodeId, visitedIds, player, tokens }`. Save on every node transition; suspend wipes on load. `loadout.equipped` and `loadout.wearables` ride along in player serialization (id-based, no def caching).
- **Test monsters** — `mon_glyph_wraith` (basic) and `mon_watchdog` (drains 2% CONN per "logs a trace" action — exists as the connection-degradation test fixture).
- **Test wearables** — 7 placeholders: `RUSTED.DAGGER`, `STAFF.DBG`, `THIN.ROBE`, `STATIC.WEAVE`, `LINK.AMULET` (onCast hook), `BARBED.RING` (onDamaged hook), `BIT.RING`. Worth keeping the 2 hook-bearing items as canonical examples for hook-pattern authoring.

## Next session — content pass

The substrate is complete. Step 9 expands content. Recommended order (feel free to slice differently, but each is self-contained):

1. **Monsters (ICE tier)** — 4-6 new monsters covering the BBS-fights-back arc. Watchdog is the prototype; needs partners with distinct mechanics (CONN drain, status inflictors, AoE, summoners, retaliators, conditional behavior). Layer-aware spawn rules (replace the current 50/50 wraith/watchdog roll in `engine/map.js`).
2. **Spells** — currently 4 (3 starter + `spl_corrupt`). Aim ~6-10 more: more arcane (chain, freeze, mirror, heal-other), more exploit (DELETE, RESET.EXE, PEEK, BACKDOOR.EXE), one or two hybrids. Drives library/cache value.
3. **Events** — 3 → 8-12. The structure (title + description + choices with weighted outcomes) supports rich variety.
4. **Boss content** — currently 2× wraith placeholder. Needs unique SYSOP monster with multi-phase actions, conn-tampering mechanics, HP-threshold phase changes, bespoke ASCII art, taunt lines integrated with `showBossIntro`.
5. **Decorative per-node ASCII art** (optional polish) — atmospheric backgrounds for shrine/cache nodes.
6. **Balance pass** — once content is in: token economy, monster stats, spell costs, wearable strength. Run a full playthrough (or several) and tune.

Authoring is JSON-only for 1-3, JSON + minor ASCII art for 4-5, mostly tuning numbers for 6.

**Hook patterns to reach for** (from existing canon — see Architecture conventions):
- `periodic-pulse` (DoT, regen, conn-drain auras)
- `retaliate-on-damaged` (thorns, traces, alarm)
- `on-cast-trigger` (mana refund, status apply per cast)
- `apply-on-attack composition` (attack effects array bundles damage + applyStatus — default for "this attack also bleeds")

**Existing 12 statuses** to compose with: bleed, corrupted, stunned, slowed, hasted, warded, focused, patched, vulnerable, traced, barbed, phase. Add new statuses opportunistically when authoring needs them; the codex surfaces them naturally.

## Open TODOs

- Real SYSOP boss content (currently 2× wraith placeholder).
- Decorative per-node ASCII art for shrine/cache (atmospheric backgrounds).
- More monsters (the BBS-resists-harder arc — ICE tier).
- More spells (especially hacker/exploit beyond CORRUPT.SPL).
- More events (run feels samey with 3).
- Balance pass (post-content).
