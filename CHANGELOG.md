# Changelog

All notable changes to SwellDreams will be documented in this file.

## [v3.9.6] - 2026-04-07

### Added
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
