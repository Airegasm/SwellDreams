# Changelog

All notable changes to SwellDreams will be documented in this file.

## [2.0] - 2026-01-16

### Added

#### Mobile Experience
- Redesigned mobile layout with floating capacity gauge above chat input
- Moved StatusBadges (capacity gauge + emotion/pain emojis) to overlay position
- Added mobile E-STOP button centered in input area
- Moved logo from header to hamburger menu panel
- Persona (🎈) and character (😈) drawer toggle buttons in mobile nav

#### Auto-Capacity System
- Pump calibration feature - calibrate pump runtime to capacity percentage
- Auto-incrementing capacity gauge based on real pump runtime
- Calibration data persisted in `backend/data/calibrations.json`
- Auto-capacity multiplier setting for fine-tuning

#### Multi-Stage Persona Portraits
- Support for staged portraits that change based on capacity level
- Configurable capacity thresholds for portrait transitions
- Smooth transitions between portrait stages

#### Flow System Enhancements
- Flow priority system (1-5) for execution ordering
- Unblockable flows that cannot be interrupted
- Selective notification system per flow
- ScreenPlay page for viewing flow-generated content

#### UI/UX Improvements
- Page transition animations with dimming effects
- Transparent hamburger menu with backdrop blur
- Automation submenu in navigation (Flows, ScreenPlay)
- Capacity-based AI/Player message nodes for flow editor

### Changed
- Simplified mobile header - removed top bars, just hamburger menu
- Flow editor saves now strip runtime data to prevent freezing on load
- Improved node styling in flow editor
- Stop cycle action now attempts turnOff as safety fallback

### Fixed
- Flow editor freezing when loading flows with stale runtime data
- Device stop_cycle action skipping when device state out of sync
- Mobile sidebars z-index conflicts with chat area
- Drawer toggle buttons not opening sidebars on mobile
