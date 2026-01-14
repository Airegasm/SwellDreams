# Changelog

All notable changes to SwellDreams will be documented in this file.

## [1.5d] - 2026-01-13

### Fixed
- **Emergency Stop Flow Abort** - Completely halts flow execution chain:
  - Uses epoch-based tracking to detect abort across async operations
  - Properly cancels flow after post-delays and delay nodes
  - LLM generation aborted during emergency stop no longer posts fallback messages
- **Selective Device Stop** - Emergency stop only turns off devices activated by flows:
  - Tracks which devices were started by flow actions (device_on, start_cycle)
  - Other devices remain unaffected by flow emergency stop
  - Failsafe shutdown still stops all devices for safety

---

## [1.5c] - 2026-01-13

### Added
- **Flow Node Test Mode** - Test flow execution directly from the canvas:
  - "Test" button on all 16 node types (triggers, actions, conditions, branches, delays, choices, challenges)
  - Step-by-step execution results in a blocking popup modal
  - Mock state gauges (capacity, pain, emotion) with animated value changes
  - Auto-adjusts state values to meet condition thresholds during test
  - Simulates device actions (no actual device calls)
  - Auto-resolves challenges and player choices
  - Suppresses all LLM enhancement during tests
- **AI Message Fields for Challenge Nodes** - Configure AI-generated messages for:
  - Challenge start announcements
  - Character wins outcomes
  - Character loses outcomes
- **Flow Error Handling** - Display errors for failed flow actions/nodes via toast notifications

### Changed
- **Error Display Standardization** - All errors now use toast notifications:
  - Removed inline chat error displays
  - Removed LLM Not Configured modal
  - Unified error handling through ErrorContext
- **Flows Page UI** - Cleaner interface:
  - Hidden corner column decorations on Flows page
  - LLM status badge hidden on Flows page
  - Right column top bar matches flow header blue gradient
  - Logo and hamburger menu remain visible
- **Start Scripts** - Now remove and rebuild frontend fresh on each start:
  - Ensures latest code changes are always deployed
  - Updated both `start.sh` (Linux/Mac) and `start.bat` (Windows)
- **Navigation Layout** - Fixed robot head (LLM status) position to upper right corner

---

## [1.5b] "Midnight Oil" - 2026-01-12

### Added
- **Challenge Nodes** - Interactive game elements for flows:
  - Prize Wheel, Dice Roll, Coin Flip, Rock-Paper-Scissors
  - Timer Challenge, Number Guess, Slot Machine, Card Draw
  - Configurable outcomes that branch flow execution
- **Global Character Controls** - Automatic linking between capacity, pain, and emotion states
  - Auto-link capacity to Wong-Baker pain scale
  - Emotional decline at high capacity (locks to "Frightened" at 75%+)
- **API Key Encryption** - AES-256-GCM encryption for stored API keys
- **Portrait avatars** on persona and character cards in Settings
- **Error boundary** - Graceful error handling with recovery options
- **Version badge** - Version display in navigation bar
- **Report Issue link** - Direct link to GitHub issues for bug reporting

### Changed
- **Single server architecture** - Backend now serves frontend directly from port 8889 (simplified deployment)
- **Character writing style** - Hybrid first/third person (dialogue uses "I", actions use character name)
- **Help documentation** - Updated with Challenge Nodes, Global Character Controls, and API encryption sections
- Added airegasm.com community link to Getting Started

### Fixed
- Factory flow template edge connections (branch/condition source handles)
- Julie's "Pushing Buttons" flow branch connections
- Settings reference error in capacity settings

### Known Issues
- Flow status badge feature is planned but not yet implemented
- Some edge cases in challenge node outcome routing

---

## [1.4] - Previous Release

### Added
- Flow system with visual node editor
- Device control integration (TP-Link, Govee, Tuya)
- Session save/load functionality
- Character buttons with custom instructions
- Welcome messages and scenarios per character

### Changed
- Improved mobile responsiveness
- Enhanced toast notification system

---

## [1.3] - Earlier Release

### Added
- Initial release with core chat functionality
- Persona and character management
- Basic device simulation mode
- OpenRouter integration for LLM

---

For community resources and hardware guides, visit [airegasm.com](https://airegasm.com)
