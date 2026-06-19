# Changelog

All notable changes to SwellDreams will be documented in this file.

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
