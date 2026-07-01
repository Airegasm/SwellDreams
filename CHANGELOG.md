# Changelog

All notable changes to SwellDreams will be documented in this file.

## [v6.2.19] - 2026-07-01

### Fixed
- **AI could still drive the pump with device control OFF or in manual pump mode.** processLlmOutput (which actually actuates devices from [pump on] tags) only honored the pre-inflation gate — it ignored the "AI Pump Control" master switch AND manual (bulb/bike) pump mode. Both now block pump-ON commands (OFF still allowed as a safety) and strip the tag from the message. Pump-prose reinforcement is also skipped in manual mode.

## [v6.2.18] - 2026-07-01

### Fixed
- **Auto reply stalled/broke when a card had event or checkpoint trees.** The LLM-busy flag added in 6.2.8 was set BEFORE runReplyScopes(), so any tree that generates an AI message/impersonate during the reply would wait on a flag that couldn't clear until the reply finished — stalling every reply on the 90s timeout. The flag now wraps ONLY the main generation, not the scope pass, so replies fire immediately again (trigger-driven generations still queue behind the main reply).

## [v6.2.17] - 2026-07-01

### Changed
- **Trigger action cleanup.** Removed the vestigial **Set Player Pain** and **Set Player Disposition** trigger actions (pain/emotion engine is retired). Replaced **Toggle Char Reminder** + **Equip/Unequip Char Reminder** with a single **Toggle Char Library Entry** action (enable/disable a character library entry). Old `toggle_reminder` triggers on existing cards still work as an alias.

## [v6.2.16] - 2026-07-01

### Added
- **Up/down reorder arrows on sequential checkpoint triggers** (and on the nested actions inside a Capacity In-Range block), matching the reordering already available on tree/event nodes.

## [v6.2.15] - 2026-07-01

### Changed
- **Capacity In-Range is now a nested block.** Instead of gating loose rows until the next gate, a Capacity In-Range trigger now holds its OWN indented list of actions — set the % range, then add the actions that run inside it. Blocks can be stacked (and nested) to branch a sequence by capacity.

## [v6.2.14] - 2026-07-01

### Added
- **Capacity In-Range branch gate for sequential triggers.** A new gate (◧ Capacity In-Range) that runs the block after it — up to the next Capacity In-Range gate — only when capacity is within a set % range. Stack several with non-overlapping ranges to branch a sequence by capacity: exactly one block fires (e.g. after a keyword gate, pick the response that matches the current capacity band). Supports 0-200% for over-inflation.

## [v6.2.13] - 2026-07-01

### Added
- **Priority flag on event triggers.** When multiple event triggers conflict (match the same turn, e.g. same keyword), one marked **priority** fires FIRST and suppresses the others that turn. It is one-shot: after firing once it steps aside permanently, letting the conflicting trigger(s) take over on later matches. (Classic use: a "once" setup response that pre-empts a recurring capacity-based response the first time a keyword is said, then hands off.) Resets on New Session.

## [v6.2.12] - 2026-07-01

### Changed
- **Fire% in the Over-Inflation (100%+) checkpoint can now exceed 100%** (up to 200%), so waypoints can be placed anywhere in the over-inflation band. Other ranges remain capped at their 0-100 bounds. (The backend gate already had no upper bound; this lifts the UI clamp for that range.)

## [v6.2.11] - 2026-07-01

### Changed
- **Fire% is now a true sequence waypoint.** Sequential checkpoint triggers run top-to-bottom on range entry; a trigger with a Fire% now *holds the rest of the sequence* until capacity reaches that %, then fires and continues — preserving list order (e.g. A, B → wait 2% → C → D, E → wait 6% → F). Previously no-Fire% triggers were batched on entry and Fire% triggers fired independently, ignoring their position. Also fixes the first band (0-10%): the sequence now starts on the first tick in the band instead of relying on a band-change event.

## [v6.2.10] - 2026-07-01

### Added
- **Speaker gate on Await Input triggers.** The keyword gate now has a dropdown — **Player Only** (default), **Char Only**, or **Either** — controlling whose message can satisfy it. Char/Either now also match the AI's own replies, not just the player's.

## [v6.2.9] - 2026-07-01

### Added
- **Max Response Tokens on AI-message and Player-Impersonate trigger actions.** Optional per-action token cap on the generation — blank falls through to the character/global limit; set it to restrict that trigger's output length.

## [v6.2.8] - 2026-07-01

### Added
- **Fire% on sequential checkpoint triggers.** Each sequential trigger can set an exact capacity % (inside its range) at which it fires, instead of firing when the range is first entered. Leave blank for the classic range-entry behavior.

### Fixed
- **Trigger-driven LLM generations now queue behind an in-progress reply.** Checkpoint AI-message and Player-Impersonate triggers that fire while the AI is mid-reply now wait for it to finish and generate immediately after, instead of launching a second concurrent request (which could interleave/garble output). Bounded by a timeout so it can never hard-block.

## [v6.2.7] - 2026-07-01

### Changed
- **Player Impersonate trigger action now SENDS the generated message** (as a player message) instead of only dropping it in the input box. New **"Suppress reply"** checkbox on the action: when off, the AI responds as if you sent it; when on, the message is sent with no AI response.

## [v6.2.6] - 2026-07-01

### Added
- **"Press READY to exit intro" toggle in the checkpoint Intro section.** When ticked, the E-STOP/PUMP button becomes a **READY!** button during the intro. Pressing it ends the intro, opens the pump gate, and reverts the button to the correct control for the session's pump (E-STOP for electric, PUMP for manual). Reuses the existing GO! gate-release; no "End Gated Intro" action required.

## [v6.2.5] - 2026-07-01

### Added
- **"Enable Intro" toggle in the checkpoint Intro section.** When off, the gated intro never runs and nothing is gated — the pump can fire from the first reply and low-capacity (e.g. 1-10%) checkpoint triggers, AI messages, and range main themes all work immediately. Defaults on for existing cards. (An active intro was gating pumping AND blocking other scopes, which is why 1-10% triggers/themes appeared not to fire.)

## [v6.2.4] - 2026-06-30

### Fixed
- **Instructor mode couldn't control smart devices (`[pump on]` emitted but never activated, tag left visible).** Instructor cards started with the pre-inflation gate CLOSED (gated on their prereq Q&A), which blocked pump commands — and capacity can't rise without pumping, so it deadlocked ("randomly" working only once capacity crossed 0% some other way). Instructor cards now start ungated like standard/group cards, and the prereq sequence no longer holds the pump gate. Gating the pump during setup is now solely the job of a deliberate gated-intro tree / Pre-Fill.

## [v6.2.3] - 2026-06-30

### Changed
- **Disabled the periodic pump safety watchdog** (the 1s interval that force-offed all pumps on a believed max-on-time / capacity ceiling). It was the source of the "pump only stays on ~1s" loop. Per-command auto-off timers, explicit `[pump off]`, the pre-inflation/capacity gate, and Emergency Stop still apply. Toggle `PUMP_SAFETY_WATCHDOG_ENABLED` in server.js to re-enable.

## [v6.2.2] - 2026-06-30

### Fixed
- **Pump only staying on ~1s (safety watchdog looping on a phantom pump).** If a configured pump is unreachable/stale, its force-off never "confirms", so the watchdog kept believing a pump was on and force-offed *every* pump every second — killing the working pump right after it turned on. Force-off now gives up on an unconfirmable device after a few attempts (clearing its stale on-state), and New/reset clears believed-on pump state so it can't carry across sessions.

## [v6.2.1] - 2026-06-30

### Fixed
- **`[pump on]` silently stripped after switching characters (esp. group cards).** A character switch left the pre-inflation gate at whatever the previous session set it to (e.g. a prior instructor/intro/pre-fill card closed it), so the AI's `[pump on]` tags were blocked to off-only on the new card. The switch now sets the gate from the new character just like a fresh session does — standard/group cards start ungated.

## [v6.2.0] - 2026-06-25 — "Stable Overhaul"

Stable release of the 6.1.x overhaul: unified character cards (single/group/instructor in one), the Trigger system replacing Flows, the Minigames editor, Dictionary/Library lorebook, Automatic Pumps + manual pump mode, persistent per-character chats, a redesigned Checkpoint system, a restructured main prompt, a Settings overhaul, and free AI Horde LLM support — plus the updater/data-tracking and `fsync` fixes from 6.1.4–6.1.6. See the entries below for details.

## [v6.1.6] - 2026-06-21

### Removed
- **Deprecated bundled Flows (83 files).** Flows are replaced by the Trigger system, and shipping them as committed defaults meant deleting a flow in-app never stuck (the next update restored the file) and left stale flow-index entries that rebuilt every launch. All bundled flow definitions are removed and `backend/data/flows/` is no longer tracked.

## [v6.1.5] - 2026-06-21

### Fixed
- **Data saves failing on network/mapped/exotic drives (`EPERM: fsync`).** Atomic writes called `fsync` unconditionally; on filesystems that reject it (e.g. a mapped `S:` drive on Windows, network shares), every save threw — which also caused the character/flow index to rebuild on a loop (the rebuilt index couldn't be saved). `fsync` is now best-effort: the write still happens, the durability flush is skipped when the filesystem won't allow it.
- **Node engine warning** — widened the supported Node range to `>=18` (dropped the upper bound) so Node 23/24 no longer print `EBADENGINE` warnings.

## [v6.1.4] - 2026-06-21

### Fixed
- **Auto-update could get stuck (couldn't update past a version).** The launcher rebuilds the frontend on every run, which modified tracked files under `frontend/build/`, leaving the working tree dirty so the next `git pull` failed ("local changes would be overwritten") and the app stayed on the old version. `frontend/build/` is no longer tracked (it's a build artifact, regenerated each launch), and `start.bat`/`start.sh` now force-sync to `release` (`git fetch` + `git reset --hard origin/release`) so locally-rebuilt files can never block an update again. Only tracked files are touched — all user data lives in gitignored files and is preserved.

## [v6.1.3] - 2026-06-21

### Added
- **Per-character chat continuity** — Each character keeps its own most-recent chat, saved after every message (crash/close safe). Switching characters restores that character's conversation; **New** wipes it. A new **"Use" Begins New Chat Session** toggle (top of the Characters page, default off) forces a fresh session on selection instead.
- **Button Sets** — Swap whole sets of custom buttons on the fly from the top of the Custom Buttons tab. Sets are isolated per mode (single / group / instructor). The built-in Lana card ships with a Lana & Scarlett set.
- **Per-member button targeting** — In group mode, an AI Chat Message button action can target a specific member (or the whole group); the reply is attributed to and spoken only by that member.
- **Automatic Pumps → Settings sub-tab** — Pump/device controls moved here from Global Character Controls: AI Pump Control (master switch, on by default), Max On Duration + Max Pulses, Pump Trigger Phrase Assist (off by default), Use Auto-Capacity, Allow Over-Inflation, Capacity Multiplier, Auto-Pop Roleplay + Hide from Details.
- **Inflation Tools dictionary** ticked by default on new cards.

### Changed
- **Settings cleanup** — Fixed light-on-light text across the Settings cards; "Start New Session on Character Selection" moved to the Characters page; the now-empty Global Character Controls section was removed.
- **Default author's note** uses SwellDreams' own `[Player]` / `[Char]` variables instead of SillyTavern `{{user}}`/`{{char}}` macros (both still resolve).
- **Multi-character portrait overlay** — member name/speech chips moved to the bottom-left of the portrait so they no longer cover the Hide-Portrait control.

### Removed
- **Emotional Decline** and **Reminder Scan Depth** (the latter is handled by the Dictionary now), plus the retired "Migrated Reminders" dictionary group.

## [v6.1.2] - 2026-06-21

### Added
- **Short Description** — A per-card field shown only in the character list (never sent to the AI), for labelling cards at a glance (e.g. "Group Member Test").
- **Group dialogue blended format** — In group mode, example dialogues are authored as one **blended reply** where every member speaks (dialog in "quotes", actions in *asterisks*, attributed by name) in a multiline box, instead of single-line per-character rows.
- **Lana** — A new built-in group card (Lana + Scarlett) that demonstrates the unified group format end to end: group greeting/scenario, blended group dialogues, and per-member attributes.

### Changed
- **Character list** — Group cards now show a **Members:** line listing the cast alongside the short description.

### Fixed
- **Example dialogues now reach the AI** — Dialogues authored in the unified editor are stored on the active story; the prompt builder previously only read a legacy top-level field, so they were never sent. It now falls back to the story's dialogues (single and group).
- **Light-on-light dropdowns in Global settings** — Select menus on the light settings cards were rendering with dark-theme (light) text. Forced light `color-scheme` on those dropdowns so the control and its option list are readable; the dark Resume-Calibration popup is unaffected.

## [v6.1.1] - 2026-06-21

### Added
- **Unified character card** — Single-character, multi-character group, and instructor cards are now one card whose shape follows the existing `multiChar`/`instructor` flags. One editor (Main / Member(s) / Attributes / Checkpoints / Library / Custom Buttons), with non-destructive Instructor-mode switchover, per-card Author's Note, and card versioning.
- **Group cards use the full story machinery** — A group's greeting, scenario, and example dialogues are now the same **versioned** Story fields used by single cards (story selector with add/rename/delete, welcome/scenario versions, LLM-enhance 🪄, random-version, etc.), relabeled "Group …". Previously group content was written to fields the engine never read, so it never reached the AI.
- **Per-member Attributes** — In a group, each member edits their own personality attributes and inflation dispositions (with a shared fallback), driving that member's behavior independently.
- **Per-member Checkpoints with a Primary picker** — The Base character's checkpoints govern by default; tick another member **Primary** to hand capacity-driven story events to their checkpoints instead.
- **Member imports** — A two-pane **Import SwellD card** picker (list + portrait/description preview) and **Import V2/V3** (`.png`/`.json`) bring characters in as new group members.
- **Automatic Pumps** — Calibrating a pump now creates a **named pump** that owns its calibration and device-control limits and **binds to an outlet** (it remembers the last device/IP it was plugged into). Per-pump **Limits** popup (Max ON / Cycle / Reps / Pulse / Timed + *Latch Until Off*) with **Reset to Factory**; the primary pump's limits act as the upper ceiling over per-story limits. Existing calibrations migrate automatically.

### Changed
- **Pump Data settings** — New **Automatic Pumps** section with per-pump device dropdown, last-seen reference, and Recalibrate / Primary / Test / Limits / Del controls.

### Fixed
- **`[pump on]` latch safety** — Setting numeric per-pump limits can no longer silently disable a card's per-story Latch-Until-Off; pump latch is now an explicit override, not a hidden veto.
- **Automatic Pumps layout** — Rows are no longer crammed to the left; the Limits popup was rebuilt with a proper layout, and light-on-light text in the Manual Pumps section is now readable.

## [v6.0.0] - 2026-06-20

### Added
- **Multi-character individual responses** — A responder dropdown in the chat input bar lets you tick girls (in order) to reply **one at a time as only themselves**, back-to-back, instead of the group reply. N ticks = N generations, each capped by a new per-card **Individual Response Tokens** setting (default 150). Muted girls are greyed/un-tickable.
- **Manual "GO!" gate-release** — A new option on the *End Gated Intro* action holds the pump gate closed after the intro until the player presses **GO!** (mobile: the ESTOP button becomes GO!; PC: a floating button). Prevents premature pumping during long buildups. Combine with a profile load to "assign a profile AND wait for GO!".
- **Always-On is now a multi-trigger section** — Each scope can hold multiple always-on trigger trees (add/remove), like Event Triggers, everywhere it appears (Character, MultiChar, Instructor, per checkpoint profile).
- **Await-gate triggers** — Checkpoint trigger sequences can pause and resume:
  - **Await Pump Amount** (manual-pump profiles): waits until the player presses PUMP a set number of times, then fires the following triggers.
  - **Await Input**: waits for a keyword; the options render as **clickable chips under AI bubbles** (screen-only) — clicking sends the word and fires the gated triggers.
- **Instructor dispositions split** — *Knowledgeable* and *Sadistic* are now separate dispositions (alongside Careful and Scientific).

### Changed
- **Unified checkpoint tab** — A non-pumpable single character now uses the same **Checkpoint Profiles** UI as multi-character cards (per-profile ranges), exposing the manual per-range pacing fields (MSG/Batch, Max Pump/Batch) for bulb/bike pumps.
- **Checkpoint priority rule** — Reaching a new range that *has* triggers aborts any pending/in-process triggers from a previous range; reaching an empty range leaves them running. LLM-enhanced triggers block the next trigger until generation finishes.
- **PC ESTOP/PUMP relocated** — Now centered in the strip above the chat textbox for all card types; white when PUMP (manual), matching mobile.
- **MultiChar editor cleanup** — Removed the Story Progression, Associated Flows, and Constant Reminders sections; Library lore matches single-character cards.

### Fixed
- Bulb/bike manual pump capacity now rounds to 1 decimal (was a 15-digit float).
- Number fields no longer render many rows tall on mobile in the MultiChar/Instructor editors.
- Card-modal dropdowns no longer render black-on-black (forced light `color-scheme`).

## [v5.7.4] - 2026-06-19

### Added
- **Prose pump-enforcement toggle** — A new **"Enforce pump from narration"** option under Global Controls → LLM Device Control (default OFF). When on, if the AI describes the pump starting/running but forgets the `[pump on]` tag, the system infers and fires it anyway — re-arming the narration-detection layer that was previously unreachable. Turning the pump *off* from narration stays always-on regardless.

### Changed
- **Stronger LLM device-control instructions** — The model is now told explicitly that omitting the tag means the device doesn't move, to emit `[pump on]` in the same reply it narrates pumping, and to re-emit it each reply (since the pump auto-times-out) — making `[pump on]` enforcement far more reliable.
- **Checkpoints tab polish** — Trigger-tree blocks are type-color-coded (block/event/action) with clearer labels; the "add block" dropdown in Session Start is no longer clipped; and the Character/Instructor/MultiChar editors widen on the Checkpoints tab for room to edit trigger trees.

## [v5.7.3] - 2026-06-19

### Fixed
- **AI Horde "Input payload validation failed" / failed generations** — AI Horde validates every sampler param against a strict range and rejects the entire request if any is out of bounds (e.g. `max_length` < 16, `top_k` > 100, `rep_pen` < 1) — values KoboldCpp/llama.cpp accept fine. All params sent to Horde are now clamped to its accepted ranges, so a sampler profile borrowed from a local backend no longer breaks generation.
- **AI Horde treated as "not configured" without a key** — The anonymous tier (blank key) is valid, so AI Horde no longer requires an API key to count as configured (frontend send checks + backend generation gates).

### Added
- **Default "AI Horde (Free Cloud)" connection profile** — Seeded on startup with anonymous access and Horde-safe sampler values, so it works out of the box without manual setup.
- **AI Horde request logging** — The backend now logs every Horde endpoint it calls (connect, submit, poll) with the exact URL and response status, plus the offending field on a validation rejection, to make connection/generation issues diagnosable.

## [v5.7.2] - 2026-06-19

### Fixed
- **AI Horde showing "disconnected" after reopening Settings** — The Model tab now restores the live connection (and reconnects if the server's model cache was cleared) when the menu is reopened, instead of reverting to a "Connect" state every time.
- **Spurious "model no longer available" error on AI Horde** — Horde's model list only includes models with active workers and changes constantly, so a momentarily-absent selection no longer raises an error toast; the request simply queues or falls back to any available worker.

## [v5.7.0] - 2026-06-19

### Added
- **AI Horde LLM provider** — A new endpoint option in Settings > Model alongside OpenAI/KoboldCpp/llama.cpp/OpenRouter. AI Horde ([aihorde.net](https://aihorde.net)) is a free, crowdsourced inference grid — no local hardware or paid API needed.
  - **Anonymous or keyed** — Leave the key blank to use the anonymous tier, or enter a registered key for faster queue priority (stored encrypted at rest).
  - **Live model picker** — Browse available text models with worker count, queue depth, and ETA; choose a specific model or **"Any model"** to route to the fastest available worker.
  - **Async submit-and-poll** — Requests are submitted to the grid and polled to completion automatically, with a timeout that cancels stuck jobs. No native streaming (the response is delivered once complete); the standard KoboldAI sampler set and your chosen chat template both apply.
- **MiniGames page** — A new main-menu workbench for authoring reusable minigame configs: prize wheel, dice, coin flip, rock-paper-scissors, slots, timer, number guess, card draw, Simon, and reflex. Each game is a two-pane editor (live animated preview + mechanics/exits) that writes its outcome to `[GameResult]` (and `[GameWinner]` for competitive games), with named exits ready to bind to a future "Call MiniGame" character trigger. Wheel/dice animations ported from PumpDirect.

## [v5.3.0] - 2026-06-19

### Added
- **Per-character data for Multi-Char cards** — Group members are no longer just name/description/personality:
  - **Per-member personality attributes** rolled independently each turn and injected inline with each member's current drive; targetable at runtime by checkpoint triggers, the Triggers page, and the flow `set_attribute` node via a visual member picker.
  - Per-member **gender** (pronouns in the prompt) and **portrait** (placeholder slot).
  - **Import a single-char card** as a new member (copies name/description/personality/gender/avatar/example-dialogues/attributes).
  - **Speak/mute toggle** — an overlay of member chips over the portrait; muted members stay in the scene but the prompt won't write for them this turn.
- **Checkpoint injections** — Each capacity range gains a main theme plus probabilistic pop-up injections (% chance, per-session max-appearances) with optional actions: a Primary Pump run (timed/cycle), a Set-Variable, or an inline Player Choice (per-choice pump/var + response). Available on single, multichar, and instructor checkpoints. A "Show/Hide All" spoilers button was added to every checkpoint tab.
- **Instructor pre-reqs + per-card checkpoint profiles** — The instructor 0% range is now an ordered, drag-arrangeable list of mandatory player-choice steps (each choice can load a checkpoint profile and/or set a variable), timed at session-start or after the first player message; the inflation gate holds until answered. The 1–100% ranges live in multiple **named checkpoint profiles** selected at runtime by a pre-req choice (e.g. "What pump?" → loads that pump's profile). Backward compatible via a synthesized Default profile.
- **Dictionary** — Per-term enable toggles and optional **comma-separated trigger words** per term (blank = always-on); keyword-gated terms route through the reminder engine so multiple matching phrases activate multiple entries in one generation.
- **Built-in "Inflation Assistant"** — A ships-with-the-app immutable instructor profile + default instructor card (female), plus a default "Inflation Tools" dictionary group (bulb/bike/compressor/aquarium/fluid/enema-bag) with definitions. Instructors auto-respond by default.
- **Mistral v7 (Tekken) template** and an expanded sampler/token panel (Ban EOS, logit_bias, banned strings, seed, override-server-samplers, n_keep, `top_n_sigma` fix) across KoboldCpp + llama.cpp.

### Changed / Fixed
- **Trigger dropdowns** now use readable, theme-consistent styling (was an unreadable hardcoded background); trigger rows wrap and the Triggers page stacks on mobile.
- **Dictionary editor** redesigned into clean stacked term cards (was a cramped single-row layout, broken on mobile and desktop).

## [v5.2.0] - 2026-06-19

### Added
- **Instructor character type** — A third card type alongside Single and Multi-Char. Instructors do not perform story-style roleplay; they speak only in direct, non-embellished, mission-specific instructions (a fantasy operator/handler voice). Instructor cards appear in the same character list (Instructor badge) and run sessions like any character.
  - **Character page tabs** — The Characters page now has **Character Select** (all existing cards, including Instructors) and a new **Instructor Settings** tab.
  - **Instructor Profiles** — Named system-prompt briefs that define how an instructor behaves and performs; one profile is assignable per Instructor card. Managed under Instructor Settings (`/api/instructor-profiles`, stored in `instructor-profiles.json`).
  - **Instructor Library** — A keyword-triggered term dictionary grouped into named bundles. A term's definition is injected only when the player uses that term (reuses the reminder engine's keyword activation). Multiple groups can be assigned to a card (`/api/instructor-library`, stored in `instructor-library.json`).
  - **Slim editor** — New Instructor editor with portrait, name, gender, mission, assigned profile, assigned library groups, welcome message(s), and per-capacity **Checkpoints** (with full trigger rows for device/flow actions).
  - **Prompt construction** — Instructors get a terse system prompt (identity + mission + profile + hard "no roleplay prose" directive). They receive raw capacity/pain awareness so checkpoint device actions still work, but none of the belly-state descriptive scaffolding.
- **Global Dictionary** — A new always-on, global term dictionary under Global States (between Token Switching and Global Reminders). Groups of term/definition pairs (with per-group and per-term enable toggles) are injected into every character's prompt — no keyword trigger and not assigned per-card (`/api/dictionary`, stored in `dictionary.json`).
- **Inflation Pre-Req (Met/Unmet) trigger** — A trigger action that forces the per-session pre-inflation gate status. Available as a checkpoint trigger, button trigger, and on the Triggers page.
- **Fire Trigger Set flow action** — A new flow Action node that runs every trigger in a saved Trigger Set against the active character/session.

### Fixed
- **Mobile: Flow editor** — The toolbar (Save / Undo / Redo / Organize / Export) is shown again on mobile as a compact bar instead of being hidden, and palette nodes can be tapped to add to the canvas (native drag-and-drop doesn't fire on touch).
- **Mobile: Model settings** — Connection rows now stack on narrow screens, so the Chat Template selector (and other fields) are no longer pushed off-screen.

## [v5.1.0] - 2026-06-19

### Added
- **Choose Multi node** — New flow node presenting a multi-select checkbox modal; every selected branch fires in parallel, with per-choice variable operations applied on selection.

### Changed
- **Prompt construction overhaul (chat-completion)** — Fixes 7 prompt-syntax issues found auditing against SillyTavern. Backend only; text-completion (KoboldCpp / llama.cpp) behavior is preserved — only chat-completion consumes the new structured messages.
  - Guided response / swipe / flow-ai-message paths unified onto `buildChatContext` with a single depth-0 guidance injection (`applyCharacterGuidance`); dropped the stripped-down `buildSpecialContext('guided')` path for character voice.
  - Chat-completion builders now return a structured `{role, content}` messages array (real user/assistant turns) instead of one flat user block, threaded through every builder-fed generate / generateStream call; OpenRouter path routes through `buildChatMessages` and no longer drops the system prompt.
  - Consistent history/primer convention using real persona/character names everywhere (removed `[Player]:` / `[Char]:` divergence across action-message, variation, and action-wrapper paths) and fixed a stale double-primer.
  - Author's Note injected at a configurable chat depth (`authorNoteDepth`, default 4) instead of pinned to the end of the system prompt.
  - Removed the brittle `toThirdPerson` card rewrite for impersonate; relies on instruction plus name-based stop sequences. Example dialogues use real names with `<START>` separators.
- **Guidance injection depth** — Guidance is now injected at depth 0 (right before the primer, in the same MANDATORY format checkpoints use) for both character and player voice, fixing Mistral / Tekken-family models that ignored system-block guidance. Finished P3/P1 unification stragglers (action-message, variation, action-wrapper paths, and the flow `ai_message` trigger) onto real names and the unified guided path.

### Fixed / Hardening
- **Backend hardening** — Atomic file writes, ID validation, request validation middleware, and crypto helpers; updates across device-service, Kasa, Tapo, Tuya, AI device control, image storage, reminder engine, and migration scripts.

## [v5.0.0] - 2026-06-18

### Added
- **Set Variable operations** — Set Variable action node gains an operation dropdown (Set / Increase / Decrease / Multiply / Divide). Math options appear automatically for numeric variables; string variables only get Set. Numbers stay numeric so math works end-to-end.
- **Persistent `[Choice]`** — The selected Player Choice label now persists and is referenceable anywhere later in the flow (live and in flow-test mode).
- **Nested / dynamic variables** — Variable references resolve recursively (innermost-first), so names can be built dynamically: `[Flow:[Choice]]`, `[Flow:[Choice]_score]`, `[Flow:[Capacity]bonus]`. Works in both reads and in the Set Variable name/value fields; supports names with spaces.
- **Player Choice node overhaul** — Removed the 4-choice cap (unlimited choices now render); multi-column node layout (settings column + paired choice columns); per-choice **Set Variables** with full CRUD and the same Set/Inc/Dec/Mult/Div operations, applied when a choice is selected.
- **Trigger Sets** — Named, reusable bundles of triggers managed on a new **Triggers** page (create / save / rename / delete). Fire an entire set at once via the API, or attach it to a button with the new **Run Trigger Set** button action — available in the Character, Multi-Character, and Persona editors.
- **New trigger types** — **System Message** (inject a system message into the chat) and **Set Flow Variable** (Set / Inc / Dec / Mult / Div a flow variable, sharing the new variable engine including nested/dynamic names) added to the checkpoint & button trigger system.
- **Mistral v7 (Tekken) chat template** — `[SYSTEM_PROMPT]…[/SYSTEM_PROMPT][INST]…[/INST]` for Mistral Small 3.x and finetunes (Skyfall, etc.), alongside the existing Mistral v0.2+ template.
- **Sampler & token control expansion (KoboldCpp + llama.cpp)**:
  - **Ban EOS Token** — `use_default_badwordsids` (KoboldCpp) / `ignore_eos` (llama.cpp), exposed as an outcome-labeled toggle separate from stop strings.
  - **`logit_bias`** — per-token-ID bias/bans on both backends; numeric banned tokens auto-convert to bans on llama.cpp.
  - **Banned Strings** — KoboldCpp anti-slop phrase suppression.
  - **Seed**, **Skip special tokens**, **Add BOS token**, and llama.cpp **`n_keep`** (retain leading prompt tokens on context overflow).
  - **Override Server Samplers** — per-profile toggle to send only prompt/limits/stop/EOS and defer sampler control to the server's launched profile (for llama-server / managed clusters).

### Fixed
- **`top_n_sigma` was a dead control** — the UI slider and profile field existed but the value was never sent to any backend; now wired to KoboldCpp (`nsigma`) and llama.cpp (`top_n_sigma`).
- **`presence_penalty` / `frequency_penalty` missing on KoboldCpp** — were only sent on the llama.cpp/OpenAI paths; now sent to KoboldCpp for parity.
- **Implicit EOS ban on KoboldCpp** — EOS control is now sent explicitly (default: allowed), preventing mysterious run-on/cut replies from server-side defaults.

## [v4.0.0] - 2026-04-07

### Added
- **Complete Skin System Overhaul** — Every visual element is now fully skinnable
  - 8 built-in scene skins with custom backgrounds, sidebar images, and coordinated palettes
  - Persistent skin images: uploads saved to `/data/skins/` as files, served via `/api/skins/`
  - Bubble transparency slider (10-100%) with hover-to-full-opacity; scene skins default to 75%
  - Session skin dropdown in character editor now shows all skins (built-in + custom)
  - Skinned: modal headers, settings sections, token switching popups, configured devices card, calibration modal, new session dialog, TOS content, center-modal overlay pages
  - Transparent action menu backgrounds on all scene skins so sidebar images show through
  - Chat background, center-modal pages, and all card-bg sections now respect `--skin-chat-bg` and `--skin-section-bg`
- **36 Character-Specific Checkpoint Profiles** — 18 player + 18 character profiles with tailored triggers
- **Automatic pump control unloading** — Switching to a non-pumpable character stops inflation, resets capacity, and removes pump buttons

### Fixed
- **Persona data corruption** — Race condition from concurrent unawaited writes to persona JSON files; `syncPersonaAutoGeneratedButtons` now accepts in-memory persona objects to avoid stale disk re-reads
- Non-pumpable characters missing spoiler toggles and checkpoint triggers
- Use button navigating to exit-modal instead of chat
- Character select not closing window and navigating to chat
- Chat background not responding to skin changes (hardcoded `url()` instead of `var(--skin-chat-bg)`)
- Skin not reverting to default when switching to a character with no custom skin assigned
- Token switching/removal modal popups using unskinned generic headers
- Configured devices header ignoring skin variables
- Unreachable non-primary devices triggering toast warnings on startup (now silent, logged to console)

## [v3.9.6] - 2026-04-07

### Added
- **Display Settings / Skin System** — New Settings > Display tab with full visual customization
  - Skin CRUD: save, load, update, rename, delete custom skins (default is read-only)
  - Player/Character/System chat bubble colors, outlines, text colors, fonts, font sizes
  - Background image, modal background image, UI header color, tab strip color, system font
  - Web-safe font picker, custom image upload with size recommendations
  - Per-character story skin: Custom Skin dropdown auto-loads a skin when starting a session
  - Set Display Skin checkpoint trigger: dynamically change skins based on capacity ranges
  - Live CSS variable injection with WebSocket push to all connected clients
- **Persona Disposition System** — General Disposition dropdown on persona (baseline emotion)
  - Override Persona Starting Disposition per character story (enable checkbox + dropdown)
  - 39 disposition/emotion options (added: playful, defiant, bratty, eager, reluctant, resigned, stoic, desperate, panicked, nervous, vulnerable, overwhelmed, aggressive, euphoric, smug, flirtatious, detached, broken, fearful, hysterical, manic, proud, humiliated, adoring, spiteful, pleading)
- **Persona Checkpoint Triggers** — Full trigger system (TriggerRow) in persona checkpoint ranges
  - Checkpoint triggers saved with persona checkpoint profiles
  - Character checkpoint triggers take precedence over persona triggers for same range/type
- **Separate Persona Checkpoint Profiles** — Persona profiles stored independently from character profiles
  - 6 built-in profiles with triggers and desire shifts: Eager Submissive, Reluctant Curious, Defiant Brat, Fascinated Observer, Protective Caretaker, Sadistic Controller
- **New Trigger Types** — Set Player Attribute, Nudge Char/Player Attribute (+/-), Set Player Disposition, Set Player Inflate/Pop Desire, Set Player Desire to Inflate/Pop Others, Set Display Skin
- **Searchable Trigger Dropdown** — Type-to-filter search in checkpoint trigger type picker
- **Token Switching: Remove** — Strip entire sentences containing trigger words/phrases with colon-aware boundaries
- **Pre-Inflation Gate** — 0% checkpoint blocks LLM pump commands until human-initiated capacity > 0
  - System notice bubble after welcome message, Device Access toggle with "Checkpoint Gated" indicator
- **Clear Chat Menu** — Gear button next to zoom controls: Clear Screen, Clear Context, Clear Both, Summarize & Clear
- **Random Welcome Message Version** — Toggle (R) button picks random version per session start
- **Batch V2/V3 Import** — Multi-file selection with per-file error handling
- **Token Switching** — New section in Settings > Global States that replaces overused LLM words with random alternatives
  - CRUD list with trigger word → comma-separated replacements
  - Case-preserving whole-word replacement (Title Case, ALL CAPS, lowercase)
  - Per-rule enable/disable toggle
- **Persona Checkpoint Profiles** — Load, Save As New, Update, and Delete checkpoint profiles in the Persona editor
  - Shares the same profile library as the Character editor
  - Dirty tracking shows "!" on Update when checkpoints have changed
- **Random Welcome Message Version** — Toggle button (R) in the welcome message controls
  - When active, a random version is selected from the dropdown on each new session start
  - Per-story setting stored on the story data
- **Batch V2/V3 Character Import** — Select multiple files at once when importing V2/V3 character cards
  - Sequential processing with per-file error handling
  - Individual error toasts for failed files, aggregate success count
  - Backend logs original filename on import failure

### Fixed
- Import error handling hardened — non-JSON error responses no longer crash the import loop

## [v3.9.5] - 2026-03-29

### Fixed
- Portrait fallback at burst/over-100% — search backward from highest range instead of defaulting
- AI pump buttons not loading on fresh installs and custom personas

### Changed
- Startup migration backfills new fields on all characters and personas

## [v3.9.4] - 2026-03-28

### Added
- Persona attributes tab with inflation knowledge/desire dropdowns
- Hardcoded state preface with positive-framing guardrails

### Fixed
- Circular JSON crash from isPlayerVoice reference
- Exaggeration at low capacity levels

## [v3.9.3] - 2026-03-27

### Added
- Persona checkpoints (My Inflation / Character's Inflation subtabs)

### Fixed
- Circular JSON crash from inflation timer on sessionState
- Failsafe for circular JSON serialization

---

## [v2.5.6] - 2026-01-28

### Added
- **Media Album** - New page for managing images, videos, and audio files
  - Upload and organize media with tags and descriptions
  - Folder system for organizing content
  - Image cropping with portrait/landscape orientation support
  - Video support (mp4, webm, mov) up to 500MB
  - Audio support (mp3, wav, ogg, m4a) up to 100MB with waveform editor

- **Chat Media Integration** - Display media inline in chat messages
  - `[image:tag]`, `[video:tag]`, `[audio:tag]` syntax
  - Video looping and blocking modes (pause flows until video ends)
  - Autoplay support with graceful fallback

- **ScreenPlay System** - Visual novel/CYOA authoring tool
  - Plays, Actors, Storyboard, and Controls tabs
  - Paragraph event types: narration, dialogue, player dialogue, choice, inline choice, goto page, condition, set variable, delay, pump (real), mock pump, end
  - LLM text enhancement with configurable token limits
  - Global definitions for consistent context
  - Variable system with `[Play:varname]` syntax (like `[Flow:varname]` for flows)
  - Expression evaluation in set_variable (e.g., `[Play:count] + 1`)
  - Conditional choice visibility with exists/not_exists operators
  - Inline choices that don't change pages
  - Inflatee system with player and optional NPC targets
  - Real pump control (cycle/pulse/timed/on/off) for Primary Pump and other devices
  - Mock pump events for simulated NPC inflation
  - System variables: `[Player]`, `[Capacity]`, `[Capacity_mock]`, `[Feeling]`, `[Feeling_mock]`
  - Configurable max pain scale for feeling calculations

---

## [v2.5b] - 2026-01-17

### Added
- **TP-Link Tapo smart outlet support** - Connect Tapo P100/P105/P110/P115 devices via TP-Link cloud credentials with session caching
- Auto-pop roleplay setting with configurable capacity threshold
- Pump device auto-shutoff when auto-pop triggers

### Changed
- Removed "OVERINFLATING" and "Automatic/Manual" text overlays from persona portrait area

### Fixed
- Streaming responses incorrectly detected as duplicates (message was detecting itself in chat history)
