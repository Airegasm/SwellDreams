<p align="center">
  <img src="frontend/public/logo.png" alt="SwellDreams" width="200" />
</p>
<h3 align="center">SwellDreams v3.8.0 — Open Beta is Here!</h3>
<p align="center">
  <a href="https://discord.gg/WZTzMevrQ9">Join the community on Discord</a>
</p>

> **Disclaimer**: SwellDreams is provided as-is for entertainment and creative purposes only. The developers assume no responsibility or liability for any misuse, negligence, injury, damage, or loss arising from the use of this software or any connected hardware. Users assume all risk and responsibility for their own safety and conduct. By using this software, you agree to these terms.

# SwellDreams

**v3.8.0 "Open Beta"**

> **Safety Notice**: The Emergency Stop button in this software should NOT be relied upon as your primary safety mechanism. Always have a hardware disconnect within arm's reach during use.

---

## What is SwellDreams?

SwellDreams is a self-hosted, AI-powered interactive experience platform that bridges the gap between conversational roleplay and real-world device automation. It connects to smart outlets on your local network or through cloud APIs and orchestrates them through two distinct modules — each with its own visual scripting system — creating deeply interactive, fully customizable sessions where what happens on screen drives what happens in the room.

Think of it as an AI game master that doesn't just talk — it *does things*.

> **No LLM or smart devices required.** An LLM and hardware integration deliver the full experience, but neither is necessary to run SwellDreams. You can author every response, sequence, and story beat manually using the Flow Engine and ScreenPlay — no AI needed. And if you don't have or don't want to connect smart devices, everything still works as a pure story mode. Start with what you have and add integrations when you're ready.

### ChatSD

ChatSD is the core conversational module. It pairs a full-featured AI chat system with a powerful automation layer, giving you control over every aspect of the experience. Characters are built using the **SwellD character card format** — supporting single-character and multi-character cards — with full import and conversion support for **Tavern-based V2/V3 spec** cards (PNG and JSON), including lorebooks and world info entries that convert into SwellDreams' native reminder system.

Characters are highly configurable: each card supports multiple stories with independent scenarios, welcome messages, example dialogues, per-story personality attributes with probability-based activation, capacity checkpoints that shift the AI's behavior at different intensity levels, session defaults, story progression mode with auto-generated player responses, and a full lorebook system with constant and keyword-triggered reminders at both character and global scope. The AI itself connects to any local LLM backend (llama.cpp, KoboldCpp), OpenRouter, or any OpenAI-compatible API, with streaming responses, guided impersonation, and LLM-enhanced text expansion for character authoring. Media support allows embedding images, video, and audio directly into conversations and automation sequences.

### ScreenPlay

ScreenPlay (Beta) is the storyboard module — a **Script Orchestrator** and LLM-enhanced choose-your-own-adventure system. It provides most of the same features as ChatSD — device control, capacity tracking, challenge games, LLM text enhancement, character portraits — but in a fundamentally different format. Instead of freeform conversation, ScreenPlay presents authored narratives organized into **Plays, Pages, and Paragraphs** with branching paths, player choices, inline questions, and variable-driven logic. There is no text input — the player navigates through pre-authored (and optionally AI-expanded) content, making decisions that shape the story and drive real-world device behavior. It's a visual novel engine with smart device integration.

---

## What Makes it Unique?

What elevates SwellDreams beyond a chatbot is its comprehensive, fully customizable, user-friendly scenario scripting. Both modules include their own **no-code, drag-and-drop orchestration systems** — the **Flow Node Scripting Engine** (ChatSD) and the **Storyboard Script Orchestrator** (ScreenPlay) — that put complete creative control in your hands without writing a single line of code.

Combined with character card enhancements like Local and Global Reminders, Capacity Checkpoints, Personality Attributes, device calibration with auto-capacity tracking, and fine-tuned LLM device control that lets the AI itself operate your hardware contextually, the result is an extremely custom, deeply interactive experience that adapts to your scenario, your characters, and your devices.

### Flow Node Scripting Engine

The Flow Engine is ChatSD's visual automation system. You build flows by connecting nodes on a canvas — drag, drop, and wire them together.

- **Trigger Nodes** define *when* a flow activates: on a player message, AI message, keyword match, device state change, timer, idle detection, capacity/pain/emotion threshold, or button press.
- **Action Nodes** define *what happens*: send AI or player messages (with capacity-range variants), control devices (on/off/cycle with stop conditions), set variables, toggle reminders, toggle buttons, set emotions, or adjust character attributes mid-session.
- **Logic Nodes** control *how it flows*: conditions, conditional and random branches, delays, pause/resume windows, player choices, input collection, counters, loops, switches, and session timers.
- **Challenge Nodes** add *interactive games*: prize wheel, dice roll, coin flip, rock-paper-scissors, timer challenge, number guess, slot machine, card draw, Simon memory game, and reflex challenge — each with win/lose branching.

Flows can be assigned to specific characters, personas, or run globally. They support priority levels, unblockable execution, silent mode, custom variables, and media playback.

### Storyboard Script Orchestrator

ScreenPlay's Storyboard is a hierarchical, logic-tree-based CYOA system. Stories are organized into **Plays** containing **Pages**, each with ordered **Paragraphs** that can be narration, actor dialogue, player dialogue, branching choices, or inline questions. Pages link to other pages through choices, creating branching narrative trees. Variables track player decisions and state across the story, and conditional logic controls which content appears based on those variables. The LLM enhancement system can expand brief prompts into full prose during authoring, and device events can be embedded at any point in the narrative to synchronize real-world hardware with story beats.

---

## LLM Enhancement

SwellDreams connects to any local or cloud LLM backend through a flexible connection system. Point it at a **llama.cpp** or **KoboldCpp** server running on your local network, connect to **OpenRouter** for cloud model access, or use any **OpenAI-compatible API** endpoint. The system auto-detects your API type (text completion vs. chat completion) based on the endpoint URL, or you can set it manually.

### Chat Templates

When using local backends, SwellDreams formats prompts using the correct chat template for your model. Templates are auto-detected when connecting to a llama.cpp server, or can be selected manually.

| Template | Format | Models |
|----------|--------|--------|
| **ChatML** | `<\|im_start\|>` / `<\|im_end\|>` | Qwen, Yi, many fine-tunes |
| **Llama 2** | `[INST]` / `<<SYS>>` | Llama 2 Instruct |
| **Llama 3** | `<\|start_header_id\|>` | Llama 3 / 3.1 / 3.2 / 3.3 Instruct |
| **Mistral** | `[INST]` (v0.2+) | Mistral, Mixtral |
| **Gemma 2** | `<start_of_turn>` / `<end_of_turn>` | Gemma 2 Instruct |
| **Gemma 3** | `<start_of_turn>` with system role | Gemma 3 Instruct |
| **Alpaca** | `### Instruction` / `### Response` | Alpaca-format fine-tunes |
| **Vicuna** | `USER` / `ASSISTANT` | Vicuna-format fine-tunes |
| **Jinja** | Server-side | llama.cpp applies its own template |
| **None** | Raw concatenation | No wrapping applied |

### Sampler Settings

Full control over generation quality with an extensive sampler configuration panel:

- **Core Samplers** — Temperature, Top-K, Top-P, Typical-P, Min-P, Top-A, TFS, Top N-Sigma
- **Repetition Control** — Repetition penalty, frequency penalty, presence penalty with configurable range and slope
- **Advanced Samplers** — DRY repetition penalty, XTC sampling, quadratic smoothing, dynamic temperature, Mirostat (modes 1 and 2)
- **Token Control** — Custom stop sequences, banned tokens, GBNF grammar constraints, custom sampler execution order
- **Convenience** — Lock samplers to prevent accidental changes, one-click neutralize to reset all values, per-connection profile presets

---

## Smart Device Control

SwellDreams turns smart outlets into interactive session hardware. Devices can be controlled manually, through visual flow scripts, or autonomously by the AI itself — all with built-in safety limits and real-time capacity tracking.

### How Devices Are Controlled

- **Manual Control** — Turn devices on and off directly from the session interface with one-tap buttons.
- **Flow Node Scripting** — The Flow Engine's device action nodes can turn devices on/off, start timed runs, or begin on/off cycling patterns — all triggered by conversation events, timers, capacity thresholds, or button presses.
- **AI-Driven Control** — The AI embeds device commands directly in its responses based on conversation context. It can turn devices on, pulse them, run timed activations, or start cycling patterns — all governed by per-character safety limits (max duration, max pulses, max cycle count). The system also detects 165+ natural-language patterns in AI output (like "turn up the pressure" or "the pump hums to life") and reinforces them with actual device commands.
- **ScreenPlay Events** — Device actions can be embedded at any point in a ScreenPlay storyboard, synchronizing hardware with narrative beats.

### Control Modes

| Mode | Format | Behavior |
|------|--------|----------|
| **On/Off** | Instant toggle | Direct power control with optional auto-off timer |
| **Timed** | Run for N seconds | Device activates for a set duration, then auto-stops |
| **Cycling** | On/off pattern | Configurable on-duration, off-interval, and repeat count |
| **Pulse** | Quick bursts | Rapid 0.5-second on/off pulses |

### Calibration & Auto-Capacity

Each device can be calibrated to establish a baseline — the system learns how long it takes to reach full capacity. Once calibrated, SwellDreams automatically tracks capacity in real-time based on cumulative pump runtime, updating the capacity gauge live during sessions. An auto-shutoff engages when capacity reaches the configured threshold.

### Supported Brands

| Brand | Connection | Status |
|-------|-----------|--------|
| **TP-Link Kasa** | Local network (native TCP) | Supported |
| **TP-Link Tapo** | Local network (Python bridge) | Out of service — manufacturer TATP encryption changes currently block third-party control |
| **Govee** | Cloud API | Supported |
| **Tuya / Smart Life** | Cloud API | Supported — includes Globe, Treatlife, Gosund, Teckin, and other Tuya-based brands |
| **Simulated** | None | Built-in testing mode, no hardware required |

---

## Full Feature List

### AI Chat & Roleplay (ChatSD)

- **Three-column desktop layout** — persona portrait on the left, conversation center, character portrait and controls on the right
- **Responsive mobile interface** — single-column layout with swipeable persona/character drawers, floating status badges, and touch-optimized controls
- **Streaming responses** — real-time token-by-token AI output
- **Guided Impersonation** — AI generates text as your persona; result appears in your input for editing before sending. Optionally type guidance text to steer the generation.
- **Guided Response** — AI generates a character response on demand, with optional guidance text to influence direction
- **Send as Character** — manually write dialogue as the AI character to steer the scene
- **Story Progression Mode** — auto-generates emotionally varied player reply suggestions after each AI message, influenced by current emotion, capacity, pain, and recent context. Per-story toggle with configurable suggestion count.
- **Emergency Stop** — one-tap button to immediately halt all devices and cycles. Prominently placed in the nav bar (desktop) and chat input area (mobile).
- **Adjustable font size** — +/- buttons in the chat area (10px to 32px), persistent across sessions
- **Keyboard shortcuts** — arrow keys to adjust capacity (1% or 5% with Shift)

### Character System

- **SwellD character card format** — native format supporting single-character and multi-character cards
- **Multi-character cards** — 2+ AI characters sharing a scene, each with independent name, description, and personality. The LLM writes for contextually relevant characters each turn.
- **Multiple stories per character** — each story has its own scenario, welcome messages, example dialogues, attributes, checkpoints, and session defaults
- **Welcome messages** — multiple versions per story with random or manual selection. LLM enhancement (magic wand) to expand brief text into immersive greetings.
- **Scenarios** — scene-setting context included in every prompt, with LLM enhancement support
- **Example dialogues** — sample exchanges that establish the character's voice, formatting, and subject-object relationships
- **Personality attributes** — five probability-based traits (dominant, sadistic, psychopathic, sensual, sexual) that roll on each AI message. Per-story configuration, dynamically adjustable mid-session via flow nodes.
- **Capacity checkpoints** — per-story author instructions injected at 11 capacity ranges (0% pre-inflation through 91-100%), guiding AI behavior as intensity progresses
- **Session defaults** — per-character starting values for capacity, pain, emotion, and auto-capacity speed
- **Custom reminders (lorebook)** — constant or keyword-triggered instructions with priority, scan depth, case sensitivity, and enable/disable toggle. Flow-controllable mid-session.
- **Global reminders** — reminders that apply to all characters, configured in global settings
- **Author note** — high-priority persistent instruction field in global settings
- **Custom buttons** — quick-action buttons with send message, device control, cycle device, and flow linking actions. Dynamically togglable via flows.
- **[Gender] smart pronoun system** — context-aware pronoun variable that resolves to he/she/they based on persona gender and grammatical position
- **Built-in characters** — Luna (romantic partner), Mistress Scarlett (dominatrix), Vex (gameshow host), Dr. Iris Chen (researcher), Research Team Alpha (multi-char medical team) — each with pre-built flows
- **V2/V3 Tavern import** — full conversion of SillyTavern/TavernAI character cards (PNG and JSON) including lorebook entries, alternate greetings, and avatar extraction. Post-import guidance modal.
- **Character export** — SwellDreams PNG (full-fidelity with optional embedded flows), V3 PNG (cross-platform compatible with dual V2/V3 chunks), and JSON backup
- **Full backup & restore** — export all characters, personas, flows, and settings (API keys excluded) in a single file

### Persona System

- **Persona creation** — define your player identity with name, pronouns (he/him, she/her, they/them, it/its), appearance, personality, and relationship with inflation
- **Staged portraits** — upload multiple persona avatars that transition automatically based on capacity thresholds
- **Built-in personas** — Marcus (eager, submissive) and Zara (bratty, resistant), each with pre-built reaction flows
- **Persona flows** — flows assigned to personas that auto-generate player messages at different capacity levels

### Session State & Variables

- **Capacity gauge** — circular dial (0-100%) with animated needle, manual adjustment via keyboard or click, and auto-tracking from device runtime
- **Pain scale** — Wong-Baker FACES scale (0-10) with emoji selector
- **Emotion system** — 20 selectable emotions (neutral, excited, aroused, submissive, dominant, shy, frightened, blissful, and more) with emoji display
- **Auto-link capacity to pain** — optional automatic pain level progression tied to capacity percentage
- **Emotional decline** — optional automatic emotion shift to "frightened" at 75%+ capacity
- **Built-in variables** — `[Player]`, `[Char]`, `[Gender]`, `[Capacity]`, `[Feeling]`, `[Emotion]` — replaced dynamically in prompts, messages, and reminders
- **Custom flow variables** — `[Flow:variableName]` for tracking state, counts, and decisions across a session
- **Auto-capacity system** — real-time capacity tracking from pump runtime with per-device calibration, configurable speed multiplier (0.25x-2.0x), and auto-shutoff at threshold

### Flow Node Scripting Engine

- **Visual drag-and-drop editor** — connect nodes on a canvas to build automation
- **12 trigger types** — first message, new session, player speaks, AI speaks, device on/off, timer, random, idle, player state change, button press
- **Pattern matching** — wildcard (`*`) and alternative (`[word/or/other]`) syntax for keyword triggers
- **Message actions** — send AI message, send player message, system message, capacity-ranged AI/player messages
- **Device actions** — turn on/off, start/stop cycle, with "until" conditions (timer, capacity, pain, emotion)
- **State actions** — declare/set variables, toggle reminders, toggle buttons, set emotion, set attribute
- **Logic nodes** — condition (AND logic), conditional branch, random branch (weighted), delay, pause/resume window, player choice, simple A/B, input collection, random number, counter, loop, switch, session timer, comment
- **10 challenge mini-games** — prize wheel, dice roll, coin flip, rock-paper-scissors, timer challenge, number guess, slot machine, card draw, Simon memory, reflex challenge — each with win/lose branching
- **Media nodes** — show image, play video, play audio — with blocking, looping, and silent modes
- **Flow priority** — 5 priority levels controlling execution order when multiple flows trigger simultaneously
- **Flow scope** — global (all characters), character-specific, or persona-specific
- **Unblockable mode** — critical flows that cannot be interrupted (except by E-STOP)
- **Silent mode** — flows that run without system notification messages
- **Dual outputs** — device-on and cycle-start nodes have immediate and completion outputs for chained logic

### ScreenPlay (Visual Novel System)

- **Plays, Pages, and Paragraphs** — hierarchical story structure with branching narrative trees
- **Story content** — narration (2nd or 3rd person), actor dialogue with portraits, player dialogue
- **Player interaction** — branching choices (page jumps) and inline choices (in-page responses)
- **Logic & flow control** — conditions, set variable, go to page, weighted random, delay, end (with outcome type)
- **Device control** — real pump events and mock pump events (visual-only for NPCs) with on/off/cycle/pulse/timed/until modes
- **Parallel container** — run multiple events simultaneously (pumps, variables, delays)
- **Capacity gate** — block story progress until a capacity threshold is reached
- **Dual inflatee system** — track two characters with independent capacity gauges and filmstrip portraits
- **Actors system** — named characters with avatars and personalities, importable from the main character list
- **10 challenge mini-games** — same games as the Flow Engine, with per-result page routing
- **LLM enhancement** — toggle per paragraph to have AI expand brief prompts into rich prose during playback
- **Continue mode** — manual (click to advance) or auto (configurable base delay, per-word delay, max delay)
- **Filmstrips** — side panels showing character avatars with capacity-based expression states
- **Dynamic NPC avatars** — change filmstrip portraits mid-story with Set NPC Avatar events
- **Play variables** — `[Play:variableName]` for tracking state across the story
- **Notifications** — popup modals and toast notifications within the story
- **Media embedding** — show images, play video, play audio at any story point

### Media System

- **Media album** — upload and tag images, video, and audio files
- **Media tags in chat** — `[Image:tag]`, `[Video:tag]`, `[Audio:tag]` embedded inline in messages
- **Video modes** — one-shot, looping (`[Video:tag:loop]`), and blocking (`[Video:tag:blocking]`)
- **Audio modes** — visible player or silent background (`[Audio:tag:nomsg]`)
- **Media flow nodes** — dedicated show image, play video, and play audio action nodes with blocking support

### Interface & Access

- **Desktop layout** — three-column with persona, chat, and character panels
- **Mobile layout** — single-column with swipeable drawers for persona and character panels, floating status badges
- **Remote access** — access from other devices on your network or via Tailscale VPN
- **IP whitelist** — only approved IP addresses can connect remotely
- **Simulation mode** — full functionality without hardware for testing and safe roleplay

### Security & Data

- **API key encryption** — AES-256-GCM encryption with a unique machine-specific key, generated on first run
- **Machine-bound keys** — encrypted credentials only work on the machine that created them
- **Auto-updating** — start scripts pull latest changes from git before launching
- **Per-file character storage** — characters stored as individual JSON files, auto-indexed on startup

---

## Installation

### Requirements

- **Node.js** 18+
- **Python** 3.8+ (optional — only needed for TP-Link Tapo, currently out of service)
- Modern web browser

### Clone from Release (Stable)

```bash
git clone -b release https://github.com/Airegasm/SwellDreams.git
cd SwellDreams
```

### Clone from Develop (Unstable)

```bash
git clone -b develop https://github.com/Airegasm/SwellDreams.git
cd SwellDreams
```

### Windows

```batch
start.bat
```

### Linux / macOS

```bash
chmod +x start.sh
./start.sh
```

The startup script will:
1. Pull the latest updates from your branch automatically
2. Install/update all dependencies
3. Build the frontend
4. Start the server on port 8889
5. Open your browser to http://localhost:8889

After the initial clone, SwellDreams is **auto-updating** — every time you run the start script, it pulls the latest changes before launching.

### Stopping

```batch
stop.bat       # Windows
./stop.sh      # Linux/macOS
```

---

## Support

- **Issues**: [GitHub Issues](https://github.com/Airegasm/SwellDreams/issues)
- **Discord**: [Join the community](https://discord.gg/WZTzMevrQ9)
- **Web**: [airegasm.com](https://airegasm.com)

## License

Open Beta - All rights reserved.

---

Made with care by the Airegasm team.
