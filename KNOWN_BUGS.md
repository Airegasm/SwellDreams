# Known Bugs

## Challenge Modals (SlidePanel)

### 1. Challenge content cut off at top
**Status:** Fixed
**Severity:** Medium
**Description:** All challenge game modals need to display further down. The upper portion of the content (headers/titles) gets cut off by the portrait frame.
**Location:** `frontend/src/components/SlidePanel/SlidePanel.css`
**Fix:** Added `padding-top: 24px` to `.slide-panel-content` to push content below portrait overlap area.

### 2. Player Choices need scroll for 4+ options
**Status:** Fixed
**Severity:** Medium
**Description:** When a player choice node has more than 4 options, the list overflows without proper scrolling. Need to add overflow-y: auto and constrain max-height on the choices container.
**Location:** `frontend/src/pages/Chat.css`
**Fix:** Added `overflow-y: auto` and `max-height: 200px` to `.player-choice-panel.compact .choice-buttons`.

## AI Behavior

### 3. AI makes up challenge results
**Status:** Fixed
**Severity:** High
**Description:** When challenge nodes complete, the AI sometimes generates messages that make up their own scores and declare winners/losers that don't match the actual game outcome. The LLM doesn't have context about the real challenge result.
**Location:** `backend/services/event-engine.js`, `backend/server.js`
**Fix:**
- Challenge results are now stored in `sessionState.lastChallengeResult` when a challenge completes
- Added `[ChallengeResult]`, `[ChallengeType]`, and `[ChallengeOutcome]` variable substitutions for flow text
- Recent challenge results (within 60 seconds) are now included in the AI system prompt with explicit instructions to use the actual result
