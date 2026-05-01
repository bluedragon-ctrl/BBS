# NETROMANCER.BBS

## What this is

A roguelike where a simulated 80s BBS (bulletin board system) is the dungeon. The player is a mage/hacker exploring nodes (rooms), fighting monsters, learning spells.

The game is structured as **two acts**:

- **Act 1 — "The Lost Crown"**: a fantasy door game advertised on the BBS. The player is a SORCERER hunting the Crown of Eldarmark; whoever takes it from the dragon's hoard is, by ancient pact, the new king. Borderwood → Warrens → Crypts → Hoard. Boss: CRIMSON WYRM.
- **Act 2 — "Trespass"** (locked design, content pending): after the dragon dies, fake credits screen tears in a glitch and the player can step *through* it into the BBS substrate that the door game was wallpapered over. SYSOP — a recluse who built this private realm — turns hostile. Mage → hacker progression: arcane spells give way to exploit spells (RESET.EXE, DELETE, CORRUPT). Backstage / Stacks / Inner Court zones. Boss: SYSOP.

Aesthetic is 80s retro CRT — neon phosphor, scanlines, ASCII art, terminal frames.

## How to run

```
python -m http.server 8123
```

Open `http://localhost:8123` in a browser. No build step, no npm. Plain ES modules — must be served via HTTP (not `file://`).

`.claude/launch.json` defines a preview server profile named `netromancer` for use with the Claude Code preview tool.

## File layout

```
BBS/
  index.html              entry point; all screens declared as <section data-screen="...">
  style.css               aesthetic shell — VT323, palette, scanlines, glow, panels
  src/
    game.js               main entry; wires modules, boot sequence, exposes window.netro
    log.js                shared log strip — typewriter, click/keypress flush
    screen.js             showScreen() — toggles .active and portals .log-strip into slot
    run.js                run lifecycle: startNewRun/continueRun/persistRun, resolveNode,
                          showGameOver, inter-room heal, loot grant, unlock bank, wipeAllData
    engine/
      atoms.js            atom registry, fireHooks / fireBarks walkers, makeContext, damage
                          resolution (DEF → mult → add, lifesteal, damageType filter)
      combat.js           turn loop, AI action selection w/ actionCount, makePlayerActor
                          (merges starter + unlocked spells + unlocked wearables)
      data.js             JSON loader; returns { monster, spell, item, status, node, event,
                          list, has } lookup API
      expr.js             evalExpr — dice notation + with(ctx) expression evaluator
      rng.js              seeded RNG, weightedPick, pick
      scheduler.js        speed/energy scheduler primitives
      map.js              7-layer DAG generator, NODE_LABEL/FLAVOR/GLYPH, per-act weight
                          tables, COMBAT_RECIPES / ELITE_RECIPES, scene/label propagation
      save.js             single-slot localStorage suspend save (serialize/deserialize map)
      codex.js            knowledge persistence (known/unknown across runs)
      flags.js            persistent flags (intro play count, banner reveal)
      unlocks.js          permanent unlock pool (spells + wearables across runs)
      loadout.js          equip/unequip helpers
      scene.js            formatSceneString interpolation, scene-context builders
    ui/
      combat.js           combat UI — combatant list, modal pickers (spell/item/target),
                          scene flavor pre/post lines
      map.js              map screen — DAG render, choice picker, inspect-body, end-art
      nodes.js            node modals — showShell / showShrine / showCache / showEvent /
                          showShop / showBossIntro + showNodeModal helper
      codex.js            codex screen
      inventory.js        inventory screen — slot picker, equip flow
      terminal.js         showTerminalSequence — boot, boss intro, death, victory
      intro-banner.js     CRIMSON_WYRM → NETROMANCER reveal animation (first-run intro)
      glitch.js           glitch primitives, scheduler, applyConnTier
      util.js             escapeHtml, sleep, formatStatsBlock, formatTokens, ...
  data/                   all content data-driven; per-act level: 1 / level: 2 tagging
    spells.json
    items.json            wearables + consumables; optional systemName for dual-act items
    monsters.json         stats, ascii, hooks, actions, loot, barks
    statuses.json         modifiers, flags, hooks
    events.json
    nodes.json            scene templates (room/pre/post variants, optional layer + label)
  CLAUDE.md               this file
  .gitignore
  .claude/launch.json     preview server config
```

## Locked design decisions

| Area | Decision |
|---|---|
| Genre | Roguelike, permadeath. Two-act structure: door-game pastiche → BBS-substrate trespass. |
| Map | 7-layer DAG, `NODES_PER_LAYER = [1, 3, 3, 4, 3, 2, 1]`. Layer 0 = SHELL PROMPT entry; layer 6 = boss; mid-layers (1-5) weighted per type. Per-act `LAYER_WEIGHTS_L1` / `_L2` tables. Soft constraints: ≥1 shrine in every run; ≥1 cache in Act 2 runs (Act 1 uses shops in place of caches); ≥1 shop in Act 1's L5 (pre-Wyrm). |
| Map visibility | Current node + immediate next-step nodes (fog of war). |
| Combat | Turn-based, NetHack-style speed scheduler (energy accumulates per tick). Per-actor `actionCount` increments on each action; powers turn-aware action selection (`self.actionCount % 2` etc.). |
| Combat scale | Player vs up to 10 enemies. (No allies/summons in current Act 1; reserved for future content.) |
| Combat UI | List view by default — all combatants in one row-per-row list with stats, statuses, energy bar, ticks-until-action; ASCII art (~7×14) shown only via inspect. Spell / item / target pickers are modals (`showNodeModal` reused). |
| Targeting | Numbered keys (`1-9`) + arrow nav + Enter inside the picker modal. |
| Modals | Codex, inventory, confirms, game over, **combat spell/item/target pickers**, node interactions (shell, shop, cache, shrine, event, boss intro). |
| Stats | HP, MP, INT, ATK, DEF, SPD, CONN. |
| Damage typing | `damageType: 'physical'\|'magical'\|'pure'` on damage atoms. DEF subtracts from raw. Target-side `damageTakenMult` / `damageTakenAdd` modifiers may carry an optional `damageType` filter (e.g. `bone_armor` resists physical only). INT scales magical via formulas like `1d6+INT`. No separate magic-resist stat. `lifesteal: x` heals attacker for `floor(dealt * x)`. |
| CONN | Meta-resource. Drains via `drainConnection` atom (exploit spells, hostile events). Restores via shrines / events. Drives ambient screen degradation and stochastic glitches at low values via `applyConnTier`. |
| Spell schools | Arcane (mp cost), Exploit/Hacker (mp + conn cost), Hybrid (both). |
| Spell progression | Starter spells fixed at run start (`MISSILE`, `MEND`). Spells used in any past run → permanent starters in future runs (unlocks system). Findable spells in cache/shop are filtered by `run.level` and dedup against the unlock pool. |
| Equipment slots | Weapon, Robe, Amulet, Ring, Ring. |
| Items | Per-act level tag (`level: 1` Act 1, `level: 2` Act 2). Cache/shop pools filter by `run.level`. Wearables equipped in any past run → permanent starter inventory in future runs (not auto-equipped — player picks each run). Consumables: per-run only, never unlock. |
| Codex | Known/unknown across runs (separate `localStorage.netromancer.codex`). Categories: monsters / spells / wearables / consumables / statuses. Auto-marked: monsters on kill, spells on cast, statuses on apply. |
| Persistence layers | `netromancer.save` (run state, wipes on death/load), `netromancer.codex` (knowledge), `netromancer.unlocks` (starter pool), `netromancer.flags` (intro play state). All cleared by **Wipe Data** action (boot menu / map button / `window.netro.wipeAll()`). |
| Currency | TOKENS. Earned per encounter (regular combat 65% chance of 1; elite 1-2; boss 5-8). Spent in shops. |
| Node types | shell, combat, shop, cache, shrine, event, elite, boss. |
| Save | Single-slot suspend on node transition; wiped on death and on game-over (victory/defeat). |
| Audio | None v1. |

## Architecture conventions

- **All content is data-driven.** Monsters, spells, items, statuses, events, nodes (scene templates) live in JSON under `data/`. Never hardcode content in JS files.
- **Behaviors = effect atoms + expression strings.** Behaviors are arrays of typed actions like `{type: "damage", target: "target", amount: "2d6+INT"}`. Numeric/conditional fields accept dice strings and small expressions evaluated against game state via `with(ctx)`. Never embed raw JS in data — atoms only.
- **Screens** are hidden `<section data-screen="name">` elements in `index.html`. `showScreen(name)` toggles `.active`. Add new screens by adding sections, not by swapping documents.
- **Log strip** is a single global DOM element (the only `.log-strip` / `.log-body` in the document) — content, scroll position, and listeners persist across every screen change. Each gameplay screen (`map`, `combat`, `codex`, `inventory`) declares a `<div class="log-slot">` inside its `.layout` grid. `showScreen(name)` in `src/screen.js` *portals* the `.log-strip` into the active screen's slot via `appendChild`. Boot has no slot, so the strip parks in `<div id="log-host" hidden>` and disappears from view. The result: identical layout shell on every gameplay screen — title-bar, layout (main + tall-inspect + log-strip), button-bar — with one continuous log. Use `logMessage(msg)` to append; click outside any button or any keypress flushes the current line and queue. The `.layout` grid is `"main inspect" / "log inspect"` (right-col spans both rows so inspect is tall).
- **Color palette legend** — green `--fg` = player/allies/safe; red `--enemy` = hostile actors; bright red `--danger` = crisis (low HP/CONN, debuff chips); magenta `--accent` = hacker theme + exploit/hybrid spells + chrome + key bindings; amber `--warn` = warning levels; muted parchment amber `--flavor` = scene/room narration (`.log-flavor`). Keep `--warn` reserved for actual warnings — use `--flavor` for ambient narrative text so the warning channel stays uncluttered. Each colored variant has its own `text-shadow` glow override to avoid magenta-glowing-green halos.
- **CONN** is the single source of truth for connection-driven effects. `setConn(v)` writes to `state.conn` and the `--conn` CSS variable, then `applyConnTier` scales scanline / phosphor / noise overlays. Glitch primitives ride on top via `triggerGlitch(type, intensity, target)` — types: `scrambleText`, `tearLine`, `colorSwap`, `corruptBorders`, `flicker`. Mark glitchable text elements with `data-glitchable`.
- **Right column = selection and inspect.** Two roles: idle = show last hovered/selected entity; active selection = chooser for target/spell/item picks. Modals for things that need overlay focus (combat pickers, node interactions, confirms).
- **Combatants share one scheduler.** Player, allies, enemies are all actors with `speed` and accumulated `energy`. Same data model on both sides. Each actor carries `actionCount` (bumped on every real action; `cannotAct` turns don't count) so monster action conditions can express turn-aware patterns like `self.actionCount % 3 === 2`.
- **Hooks are unified.** `fireHooks(actor, hookName, ctxBase, opts)` walks every hook source attached to an actor — active statuses, equipped wearables (`actor.loadout.equipped[*]`), and the monster passive (`data.monster(actor.defId).hooks`). Same JSON shape everywhere: `hooks: { onX: [atoms] }`. Canonical names: `onSpawn, onTurnStart, onTurnEnd, onApply, onRemove, onDamaged, onDealDamage, onKill, onDeath, onCast`. `ctx.self` is always the hook owner; `opts.target` sets `ctx.target` (defaults to self). Atoms fire hooks at the semantically-owning moment (e.g. the `damage` atom fires `onDamaged`/`onDealDamage`/`onKill`); combat fires lifecycle hooks. Add new hook fire points by calling `fireHooks` from the atom or combat moment that owns the trigger — never invent a parallel walker.
- **Hook patterns to reach for.** Most content fits one of these shapes — author against them rather than inventing one-off mechanics.
  1. **periodic-pulse** — `onTurnStart` (or `onTurnEnd`) fires repeating atoms each turn the actor takes. Used by DoT statuses (bleed, burn, corrupted) and regen statuses (patched).
  2. **retaliate-on-damaged** — `onDamaged` fires damage / status-application back at the attacker. `ctx.target` is the attacker by convention. Used by reactive auras and thorns-style wearables (`barbed_ring`).
  3. **on-cast-trigger** — `onCast` fires effects after the actor casts a spell (`ctx.target` = spell target, possibly null). Used for "every cast restores 1 MP" / "every cast applies a status" wearables.
  4. **threshold one-shot** — `onDamaged` with a condition that includes `!self.statuses.some(s => s.def.id === 'X')` as a fired-once guard. Used by Goblin Chief and Crimson Wyrm's `enraged` trigger at <50% HP. Place atoms in order: cleanse → bark → applyStatus, so the bark fires before the flag-status closes the gate.
  5. **apply-on-attack composition** — *not a hook* — a monster action's `effects` array bundles `damage` + `applyStatus` together. Default to this for "this attack also bleeds" rather than reaching for a hook; hooks are for triggers that don't fit a single discrete action.
- **Action shapes.** Monster `actions` entries support: `name` (verb), `weight`, optional `chance`, optional `condition` (expression), `effects` (atoms). Plus optional `narrate: "self"` to drop the target's name from the log line (used when an action targets `self` or `lowestHpAlly` and the auto-paired `{actor} {verb} {target}` would read wrong, e.g. shaman heal).
- **Damage resolution order.** The `damage` atom resolves: (1) `raw = floor(eval(amount))` — already includes source-side stat mods via `effectiveStat`; (2) DEF subtraction (skipped when `ignoresDef: true`); (3) target-side multiplicative mods — product of every `damageTakenMult` matching the incoming `damageType` filter; (4) target-side additive mods — sum of every `damageTakenAdd` (same filter); (5) lifesteal to attacker if `atom.lifesteal` is set. Final damage floored at 0. `ignoresDef` skips DEF only — mult/add still apply. Modifiers shape: `{ damageTakenMult: 1.5 }` and `{ damageTakenAdd: 1 }`, optionally `{ ..., damageType: "physical" }` for filtered application.
- **Status flags.** Statuses can declare `flags: ["cannotAct"]` (top-level on the def, or on a modifier object). The combat loop checks `actorHasFlag(actor, "cannotAct")` at the action step; if set, the actor's turn is consumed without an action (used by `stunned`).
- **Bark system.** Monster defs may carry `barks: { onSpawn: [...], onDamaged: { chance, lines }, onCast: ..., onDeath: ... }`. Each slot accepts either an array of strings (chance 1.0) or `{ chance, lines }`. Lines starting with `*` render as actions (`MONSTER grins.`); plain strings render as quoted speech (`MONSTER: "..."`). Strings interpolate via `formatSceneString`. `onPhase` is *not* a real hook — author a `bark` atom (`{type:"bark", lines:[...]}` or `{text:"..."}`) and place it in the same `effects` array as the threshold-trigger `applyStatus`.
- **`window.netro`** exposes runtime hooks for devtools and preview-eval debugging. Current entries: `state`, `setConn`, `triggerGlitch`, `data`, `openCodex`, `openInventory`, `cast`, `eval`, `combat`, `enterCombat`, `makeStubPlayer`/`makeStubMonster`/`makePlayerActor`/`cloneActor`, `_currentCombat`/`_renderAll`, `showTerminalSequence`, `wipeCodex`, `wipeAll`, `getUnlocked`, `fireBarks`, `tierFromConn`, `glitch`. Add new entries when introducing systems worth poking at runtime.
- **Scene flavor.** Every node carries an optional `node.scene = { label, room, pre, post }`. `room` is the persistent place description (default INSPECT body on map/combat screens, prepended to non-combat node modals). `pre` types into the log strip in italics on combat-screen entry. `post` types into the log strip on victory and gates the screen exit on a player keypress / click. `label` overrides the generic `NODE_LABEL[type]` for inspect-body / map-hover display (e.g. `"WARRENS — RUINED COTTAGE"`).

  **Authoring.** `data/nodes.json` holds scene **templates**: `{ id, level, label?, match: { type, layer? }, scene: { room, pre, post } }`. In templates each of `room`/`pre`/`post` may be either a string OR an array of strings. `engine/map.js#generateMap` filters templates by `level === run.level`, picks the most type+layer-specific matching template per node, then `resolveSceneVariants` collapses any arrays to a single string via the run rng — so the saved `node.scene` is always flat strings (and survives suspend/load through `serializeMap`). The template-level `label` is propagated onto the resolved scene by `pickScene`. Authoring an array of N pres × M posts on one template gives N×M variants per run; multiple matching templates multiply further.

  **Interpolation.** Scene strings pass through `formatSceneString(text, ctx)` (`src/engine/scene.js`) at display time. Supported `{path}` shapes: `{enemies[0].name}`, ..., `{enemyCount}`, `{enemyNames}` (comma-joined), `{player.name}` (combat only), `{layer}`, `{nodeType}` (map preview only). Two context builders: `sceneContextFromCombat(combat)` uses live actor names; `sceneContextFromNode(node, data)` uses canonical `data.monster(id).name` lookups for the map-screen inspect preview. Missing paths render as empty string.

  **Naming.** Three different shapes share the word "flavor" elsewhere — `monster.flavor` (random AI lines), `showNodeModal({ flavor })` (modal body string), and template entries here under `scene.*` — keep them straight. `logFlavor(text)` (in `src/log.js`) is the canonical way to emit italic scene narration; rendered with `.log-flavor` styling.
- **Level-aware rendering.** Several UI surfaces branch on `run.level`: shrine choices (Act 1 BOOST HEALTH/MANA over-cap; Act 2 DEFRAG/RESYNC), boss intro (Act 1 passive `/usr/sysop: carry on` monitoring; Act 2 hostile `WHO DARES` corruption), death sequence (Act 1 BBS-monitoring + `USER PURGED` hint; Act 2 connectivity-themed signal cut), boss banner (derived from boss encounter monster name — fits `T H E   C R I M S O N   W Y R M` for Act 1, `T H E   S Y S O P` for Act 2 automatically). Find-loop pickers filter content by `run.level`.
- **MUD-ish expansions** — the console is doing more narrative work as the design evolves. Future content can lean further into MUD territory without restructuring: named features inside `scene.room` that become inspectable subjects (`> inspect campfire`), exits described by text rather than glyphs, NPC chatter via the existing monster `barks` mechanism, and verb-shaped buttons (`[L]ook`, `[T]alk`, `[U]se`) when nodes warrant them. Treat these as content/data extensions on top of `scene` — no new core systems needed.

## Working rule

**Always discuss the implementation approach before writing or editing code.** Even after design is locked and the user has greenlit the next step, lay out the concrete choices first (file layout, library/framework picks, specific values, edge cases) and wait for confirmation. This applies per-step, not just at project start. Small visible tweaks the user explicitly directs ("change X to Y") can be done without ceremony, but anything involving a design choice requires the discussion.

## Current state

### Built and shipping

**Engine + UI scaffolding**
- Project skeleton, CRT shell (scanlines / phosphor / vignette), screen router
- Boot dial-up sequence + intro banner reveal animation (CRIMSON WYRM → NETROMANCER, full on first run, fast on subsequent runs via flags)
- Boot menu: NEW RUN / CONTINUE / CODEX / WIPE DATA / DISCONNECT
- Shared log strip portaled across screens
- JSON data loader with per-category lookup API
- Atom registry + expression evaluator with dice notation
- Speed/energy scheduler + main combat loop with status-flag CC support
- Combat UI: list view, modal pickers (spell/item/target), inspect, status chips, energy bar, scene flavor pre/post lines
- Map UI: 7-layer DAG render, choice picker, inspect-body with scene labels, dynamic boss-banner end-art
- Inventory UI: 5-slot loadout (weapon/robe/amulet/ring/ring), equip flow
- Codex UI: 5 categories (monsters/spells/wearables/consumables/statuses), persistent across runs

**Run lifecycle + persistence**
- Single-slot suspend save with serialize/deserialize (preserves map, scenes, level, seenEvents)
- Codex persistence (`netromancer.codex`)
- Flags persistence (`netromancer.flags`) — intro play count, banner reveal
- **Unlocks persistence** (`netromancer.unlocks`) — used spells + equipped wearables become permanent starter pool across runs; sweep at end of every combat-victory; find-loop dedup against the pool
- **Wipe Data** action — clears all four persistence layers; available from boot menu, map screen, and `window.netro.wipeAll()`

**Hook + bark systems**
- `fireHooks` walks statuses + equipped wearables + monster passives uniformly
- Threshold one-shot pattern (Goblin Chief / Crimson Wyrm enrage) via condition guards
- `actionCount` per actor for turn-aware action selection
- `narrate: "self"` action field for non-target-paired log lines
- `bark` atom + `fireBarks` walker for monster speech/action lines (sentinel `*` prefix marks intransitive actions)

**Glitch primitives**
- `triggerGlitch(type, intensity, target)` — `scrambleText` / `tearLine` / `colorSwap` / `corruptBorders` / `flicker`
- `applyConnTier` scales scanline / phosphor / noise per `--conn`
- Glitch scheduler driven by CONN

**Map / per-act structure**
- Per-act `LAYER_WEIGHTS_L1` / `_L2` (Act 1 has shops in place of caches; Act 2 keeps caches)
- Per-layer `COMBAT_RECIPES` (L0-L5 authored; encounter caps prevent 2-BW or 3-kobold groups)
- `ELITE_RECIPES` for L4-L5 (Goblin Chief; pushed out of L3 for buildup pacing)
- Soft constraints: shrine guaranteed every run; cache guaranteed in Act 2; **shop guaranteed in Act 1's L5 (pre-Wyrm)**
- Inter-room heal: 25% maxHp recovered after every successful non-entry node transition

**Scene + level systems**
- Scene templates with `level`, `match: { type, layer? }`, `label` (top-level), and `scene: { room, pre, post }` (variants per slot)
- Per-act content tagging on all spells / items / monsters / events / scenes
- Find-loop pickers (cache, shop, event) filter by `run.level` and dedup against unlocks

**Act 1 content**
- 11 monsters across 4 conceptual zones — Borderwood (rats/bats/scout), Warrens (warrior/shaman/kobold), Crypts (bone walker / crypt ghoul / acidic ooze + Goblin Chief mini-boss), Hoard (CRIMSON WYRM)
- 11 statuses — bleed, vulnerable, corroded, enraged, bone_armor, burn, preparing + buffs (warded, hasted, focused, patched, barbed, phase)
- 8 findable spells across damage / heal / buff / CC / AoE / debuff archetypes (plus 2 starters: ARCANE MISSILE, MEND)
- 12 wearables across 5 slots, 2 tiers
- 5 consumables (2 starters + 3 findable)
- 6 events — 3 lore drops (`once: true`) drip-feeding the kingdom's backstory + 3 ambient (cursed altar / trapped chest / hungry ghost)
- 28 scene templates with layer-themed labels (BORDERWOOD — FOREST PATH / CRYPTS — TOMB GALLERY / THE HOARD etc.)
- Monster barks for elites (full coverage on Wyrm + Chief: spawn / damaged / phase via bark atom / death) and selective trash flavor

### Act 1 status

Mechanically complete. Iterating on balance via playtest — heal numbers, monster damage, encounter caps, token economy, shop density, pre-boss prep beat all tuned in playtest-driven PRs.

## Next session candidates

(in roughly priority order — pick what's blocking)

1. **Map structure refactor** — collapse the 7-layer scaffold into a 4-layer Act 1 + a separate Act 2 generation post-glitch. Currently L4-L5 reuse L3 Crypts content because the scaffold has more layers than Act 1 has narrative zones. Real fix is structural; clean prerequisite for serious Act 2 content.
2. **Fake-credits + glitch transition** — biggest narrative beat in the whole game. After Wyrm dies, fake credits typewrite ("CONGRATULATIONS, ADVENTURER!"), credits tear via glitch primitives mid-line, an unauthorized `[C] C̷O̴N̵T̶I̷N̴U̶E̴?` option appears alongside `[D] DISCONNECT`. Pick `D` = run ends as victory; pick `C` = step through into Act 2. Doesn't need Act 2 content to land first; the transition primitive should ship before content authoring begins.
3. **Act 2 content authoring** — Backstage / Stacks / Inner Court zones with their monster casts, exploit spells (RESET.EXE / DELETE / CORRUPT), system-side wearables (the `.RUN` / `.DBG` items already in `data/items.json` are placeholders for this), SYSOP boss, lore events. Big chunk; multiple sessions.
4. **Dual-name renderer** (`name` / `systemName`) — for items that span both acts (HEALING DRAUGHT in Act 1 → HEAL.RUN in Act 2). One renderer helper plus a content-author pass on the cross-act items. Defer until Act 2 actually needs it.
5. **Codex lore tab** — capture once-per-run lore events (`evt_torn_chronicle` etc.) as persistent meta-progression so the drip-feed accumulates across runs into a real arc.
6. **Player DEF starter bump** (2 → 3) — flagged as a follow-up tuning lever if bosses still feel rough after the post-tone-down playtest pass.
7. **Token economy retune** — bump combat-win amount or layer-cleared bonus if shops still feel thin in cold runs after the unlocks loop matures.
