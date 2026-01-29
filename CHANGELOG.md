# Changelog

All notable changes to SwellDreams will be documented in this file.

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
