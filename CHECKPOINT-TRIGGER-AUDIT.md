# Checkpoint & Trigger System Audit — v6.6.97 (2026-07-04)

Full-trace audit of: capacity-range checkpoints (every field), session start, event
triggers, gated intro, tree blocks, sequential + random range scripts, and the action
palette — frontend editors cross-referenced against backend executors, parameter by
parameter. Line numbers from v6.6.97.

---

## 1. VERIFIED WORKING (traced end-to-end)

### Range % checkpoints — fields
| Field (editor) | Backend consumption | Status |
|---|---|---|
| Plot Steer / Rules (`mainTheme`) | `injMsg`/stage blocks (server.js:11396, 12678) → sent in prompt | ✅ (fixed v6.6.8x) |
| Stage direction (range text) | `=== MANDATORY — INFLATION STAGE DIRECTION ===` (13066/13074/13785/13792) | ✅ |
| Max Pump ON (s) (`maxPumpOnSecs`) | `refreshRangePumpGates` → `rangePumpCapSecs` → duration cap in ai-device-control | ✅ limit switch, blank=off |
| Min Replies / Pump ON (`messagesBetweenOn`) | → `rangePumpCooldownMsgs` → cooldown gate on pump-on | ✅ limit switch, independent |
| Manual batch (`maxPumpsPerBatch`/`messagesBetweenBatches`) | `manualPumpBatchBlock` (bulb/bike only, intro-suppressed) | ✅ |
| Sequential triggers | `executeCheckpointTriggers` → `fireTriggerSequence` | ✅ see below |
| Random blocks | `rollCheckpointRandomTriggers` per reply | ✅ see below |
| `checkpointsEnabled` tickbox | gates triggers, event bindings, narrative blocks; pump PACING stays live via `getActiveCheckpointRaw` (deliberate) | ✅ |

### Sequential range scripts (`fireTriggerSequence`, 3628)
- Fire once per range per session (`firedCheckpointTriggers`), in author order. ✅
- **Fire%**: holds the rest of the sequence in its own slot (`pendingCapacityGate`, separate
  from awaits since 6.6.88); WAIT-aware (queues behind `>>` gates, `tryResumeCapacityGate`);
  gauge freezes during WAIT (wait-period runtime discarded — no catch-up jump). ✅
- **Await Pump / Await Input**: stash `rest`, resume on pump count / keyword (speaker-aware:
  player/char/either). ✅
- **Auto Next-gate** between consecutive generated messages (`>>`). ✅
- **Capacity In-Range** blocks: synchronous nested branch, runs only in [min,max]. ✅ (caveat §2.4)
- New populated range aborts a stale await from the previous range (#21). ✅

### Random blocks (`rollCheckpointRandomTriggers`, 11811)
Per-block % chance; repeat budget per session (blank/-1 = ∞); carry-over from the nearest
lower range that defines blocks; `set` mode fires ONE random trigger from a Trigger Set;
ai_message weaves into the current reply (or verbatim-replaces), other actions execute
directly. Composes with tree scopes into one reply (single per-turn injection reset). ✅

### Trigger Tree walker (`runNode`/`runTree`, 15011)
- All block types implemented (`TREE_STUB_TYPES` is empty): group, chance, random (picks 1
  child), if/branch (first-match, else-branch, all/any conditions), keyword gate
  (speaker-aware), player_choice (≤4), choose_multi (≤8), pause_resume, repeat
  (fixed/until + caps), wait, label/goto (scope-local, loop-capped), fire_tree
  (cycle-guarded, depth-capped), call_minigame, end_intro (manual-release GO! +
  profile load), actions. ✅
- **Once semantics correct**: failed chance roll / closed gate / empty container does NOT
  consume once; presenting a choice / firing an action DOES. Parent-once cascades in UI
  (checked+locked) and in effect (children in a fired-once parent don't rerun). ✅
- Suspend channels capture the innermost same-level continuation (`after`) and resume with
  fall-through; goto bubbles to enclosing frames. ✅
- Delivery model: `standalone` (session start/intro — posts bubbles, next-gates between
  back-to-back messages, first-message gate so the welcome is read first) vs `inReply`
  (range/event scopes — weaves into the current reply). ✅

### Event bindings (`runEventTrees`, 11627)
device_on/off (device filter), player/char_state_change (operator + fireOnce latch that
re-arms when the condition flips false), ai_speaks (keywords), idle, random (per-reply roll),
every_reply. Per-binding message cooldown; **priority** bindings fire first, win the turn,
then permanently step aside. Blocked during intro/pre-fill; gated on Enable Checkpoints. ✅

### Session start & intro
Session Start is per-profile (`treeRefs.sessionStart`, 19447); intro tree takes precedence;
first standalone message gated behind `>>`. Intro: `startIntroScope` → `introReadyExit`
(UNLOCK) / `end_intro` (+ GO! manual release, checkpoint-profile jump, prose-guidance
opt-out). The UNLOCK arming bugs were fixed this session (force-finalize + removed the
awaitingGoRelease guard). ✅

---

## 2. BUGS / MISMATCHES FOUND

1. **Persona range scripts bypass the sequence walker** (server.js:3840). They fire via a
   plain `executeTrigger` loop — so in a PERSONA script: `await_input`, `await_pump`,
   `capacity_inrange` (no executeTrigger case → silently skipped), **Fire% ignored**, no
   next-gates. The persona editor offers the same palette, so authors can build scripts
   that silently half-work. Fix: route personas through `fireTriggerSequence`, or hide
   gate/await actions in the persona editor.
2. **Persona precedence compares against the LEGACY trigger source** (3823 reads
   `activeStory.checkpointTriggers`) while characters now use the ACTIVE PROFILE's triggers
   (3755). The "skip persona trigger if char handles this type" check is evaluated against
   stale/wrong data. Fix: use `getActiveProfileRangeTriggers` there too.
3. **`preInflation` is dead code**: `getActiveCheckpoint` hardcodes `preInflation: null`
   (12683, deliberate — Pre-Fill replaced it). But ~40 refs remain, including 3 unreachable
   prompt blocks (`=== MANDATORY PRE-INFLATION REQUIREMENT ===` at 6005 welcome / 13063 /
   13781). No UI field exists (good). Delete the dead blocks.
4. **Nested `capacity_inrange` await leak**: if a nested block arms an await/Fire% gate, the
   OUTER sequence `continue`s and keeps firing — a later outer await can clobber the single
   `pendingRangeAwait` slot (nested rest silently lost). Fix: if the nested call armed a
   gate, `return` instead of `continue`.
5. **`pendingCapacityGate` clobber on new range**: entering a new populated range explicitly
   aborts `pendingRangeAwait` but NOT an armed Fire% gate — the new sequence can overwrite
   it silently (3646). Decide precedence (new range wins is consistent with #21) and abort +
   log it explicitly.
6. **`resumeAfterType` is vestigial**: TreeEditor writes `'turns'` (TreeEditor.js:170) but
   the backend only ever reads `resumeAfterValue` as reply-turns. Harmless; remove the field
   or implement units.
7. **`toggle_pump_always` corpse**: executeTrigger still has the case, but
   `isPumpOnEveryReply()` hard-returns false and the UI entry was removed (6.6.8x). Delete
   the case + `executePumpOnEveryReply` machinery.
8. **`fire_flow` tree nodes are only half kill-switched**: `runNode` still executes them via
   `handleButtonLinkToFlow`, which relies on `eventEngine.activateFlow` (gated) — but then
   calls `triggerButtonPressByLabel` unconditionally. Old trees containing fire_flow may
   partially execute. Fix: add an explicit `FLOWS_DISABLED` early-return in
   `handleButtonLinkToFlow` (and/or in runNode's fire_flow branch).
9. **Keyword capability gap**: backend `treeKeywordMatches` supports `logic` +
   `secondaryKeys` (AND-any second set) but the TreeEditor UI only exposes
   keys/caseSensitive/matchWholeWords/speaker. Expose it or accept it as internal.
10. **Legacy `event`-kind nodes**: runNode handles only `keyword`; other legacy event types
    skip with a log. Fine for backward-compat; migrate old trees eventually.

---

## 3. ARCHITECTURE FEEDBACK

**The concept IS solid.** The tree walker in particular is careful engineering: correct
once-semantics, cycle guards, budget caps, innermost-continuation capture. The real issue is:

1. **Two authoring systems for the same concept.** A capacity range can carry BOTH a legacy
   sequential/random trigger list (profile `rangeTriggers` → `fireTriggerSequence`) AND a
   range tree scope (`range:` → `runTreeScope`). They have separate gate machinery:
   - Legacy: `pendingRangeAwait` (4 kinds!) + `pendingCapacityGate`
   - Trees: `pendingTreeNext` / `pendingTreeChoice` / `pendingTreeResume` / `pendingTreeGame`
   That's **7 suspend slots across 2 systems**, cross-coupled via `isNextGatePending()`.
   This is exactly where "Opus loses the plot": every new gate feature must reason about all
   seven. **Recommendation:** since flows are already deprecated in favor of trees, migrate
   range sequential/random lists INTO trees next: a sequential list = a group; a random
   block = chance container (+ repeat budget param); Fire% = a new `capacity_gate` container;
   await_input/await_pump = gate containers. One walker, one suspend machinery, one editor
   (TreeEditor already does 90% of it). Keep a read-time converter for old cards, like
   `normalizeRangeTriggers` does today.
2. **Single-slot gates lose data silently.** `pendingRangeAwait` kinds clobber each other by
   design; §2.4/2.5 are instances. Until the migration: log every clobber loudly.
3. **executeTrigger is a ~900-line switch** with implicit parameter contracts. Cheap win: a
   declarative `REQUIRED_PARAMS = { impersonate: [], device_on: ['device'], goto: ['name'], … }`
   table checked at execution AND surfaced in the editor (red outline on missing required
   fields). That directly guarantees "each action has the parameters it needs."
4. **Performance:** `loadData(settings)` + full character loads happen per trigger execution
   and per capacity tick (`executeCheckpointTriggers` reloads characters every range change;
   `resumeTriggerSequence` reloads everything). On a Pi-class host this is measurable disk
   I/O in the hot path. Cache with an mtime check, or thread the already-loaded
   character/settings through (most callers have them). Same for `buildTreeIndex()` per run.
5. **Persona checkpoint triggers** should either be first-class (same walker, same gates —
   §2.1) or explicitly limited (editor shows only the supported subset). Half-support is the
   worst option.

## 4. UI / LAYOUT RECOMMENDATIONS

1. **Gate-state visibility (biggest UX win):** when a sequence is holding, only the backend
   log knows. The broadcasts already exist (`await_state`, `next_gate`) — render a small
   status chip near the input row: "⏳ holding until 40%", "🗝 waiting for: 'yes'",
   "▶ press >> to continue". Debugging scripts stops requiring the server console.
2. **Checkpoint ranges navigator:** the 11-range accordion is a long scroll. Add a compact
   range strip (chips: `1-10 … 100+`) with content dots (has PlotSteer / N seq / N rand /
   limits set), click-to-jump. Per-range header shows a one-line summary when collapsed.
3. **Inline validation in TreeEditor:** red-flag a Go To whose label doesn't exist in scope,
   a Fire Tree with a missing/deleted target, a Choice container with zero options, a device
   action with no device selected. All checkable client-side from the tree JSON.
4. **Dry-run / trace mode:** a "test this tree" button that walks the tree with
   dice-forced-100%, logging each node's decision (fired/skipped-once/gate-closed) into a
   panel. Cheap to build on runTree's existing console logs; turns script debugging from
   log-spelunking into a click.
5. **Once-state inspector:** show which nodes have consumed their once this session
   (firedSet is in sessionState) — a dimmed badge in the editor, with a "reset once for this
   tree" button for testing.
6. **TreeEditor polish (post-restructure it's good):** copy/paste nodes between trees;
   collapse/expand-all; search within the tree (the Add-menu search shipped in 6.6.7x, this
   is the sibling feature).
