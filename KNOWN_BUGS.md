# Known Bugs

## Challenge Modals (SlidePanel)

### 1. Challenge content cut off at top
**Status:** Open
**Severity:** Medium
**Description:** All challenge game modals need to display further down. The upper portion of the content (headers/titles) gets cut off by the portrait frame.
**Location:** `frontend/src/components/SlidePanel/SlidePanel.css`
**Suggested Fix:** Increase `top` offset or add padding to push content down below the portrait overlap area.

### 2. Player Choices need scroll for 4+ options
**Status:** Open
**Severity:** Medium
**Description:** When a player choice node has more than 4 options, the list overflows without proper scrolling. Need to add overflow-y: auto and constrain max-height on the choices container.
**Location:** `frontend/src/components/modals/PlayerChoiceModal.js` / `SlidePanel.css`

## AI Behavior

### 3. AI makes up challenge results
**Status:** Open
**Severity:** High
**Description:** When challenge nodes complete, the AI sometimes generates messages that make up their own scores and declare winners/losers that don't match the actual game outcome. The LLM doesn't have context about the real challenge result.
**Location:** `backend/services/event-engine.js` (challenge result handling)
**Suggested Fix:**
- Pass challenge outcome to session state so AI has context
- Add challenge result to the system prompt or inject a system message
- Consider adding a "challenge_result" variable the AI can reference
- Could suppress LLM enhancement for post-challenge messages and use verbatim flow text instead
