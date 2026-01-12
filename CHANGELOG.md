# Changelog

All notable changes to SwellDreams will be documented in this file.

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
