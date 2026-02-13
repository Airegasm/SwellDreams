# Pump Tags Guide

## Overview

SwellDreams allows AI characters to control smart devices (pumps, vibes, TENS units) by including special tags in their responses. The tags are automatically parsed, executed, and stripped from the displayed message.

## Supported Devices

- **pump** - Inflation pumps, air pumps
- **vibe** - Vibrators, vibration devices
- **tens** - TENS/EStim units

All examples below use `[pump ...]` but work the same for `[vibe ...]` and `[tens ...]`.

---

## Basic On/Off

### Turn On
```
[pump on]
```
- Turns the device on
- Automatically turns off after configured duration (default 30 seconds)
- Safety: Blocked if capacity is at 100% (unless override enabled)

### Turn Off
```
[pump off]
```
- Turns the device off immediately
- Cancels any pending auto-off timers

**Example in AI response:**
```
"The pump hums to life. [pump on] You feel the pressure building..."
```
→ Displayed to user: `"The pump hums to life. You feel the pressure building..."`
→ Device: Pump turns on

---

## Pulse Mode

Quick on/off bursts (0.5s on, 0.5s off per pulse).

### Syntax
```
[pump:pulse:N]
```
- `N` = number of pulses (e.g., 3, 5, 10)

### Examples
```
[pump:pulse:3]   - 3 quick pulses
[pump:pulse:5]   - 5 quick pulses
[vibe:pulse:10]  - 10 quick vibration pulses
```

**Example in AI response:**
```
"She taps the button rapidly. [pump:pulse:5] Quick bursts of pressure..."
```
→ Device: 5 quick on/off pulses

---

## Timed Mode

Run device for a specific duration, then automatically turn off.

### Syntax
```
[pump:timed:SECONDS]
```
- `SECONDS` = duration in seconds

### Examples
```
[pump:timed:30]  - Run for 30 seconds then auto-off
[pump:timed:60]  - Run for 1 minute then auto-off
[vibe:timed:45]  - Vibrate for 45 seconds then auto-off
```

**Example in AI response:**
```
"The pump will run for exactly one minute. [pump:timed:60] Watch the gauge climb..."
```
→ Device: Pump runs for 60 seconds, then automatically turns off

---

## Cycle Mode

Repeated on/off cycles with customizable timing.

### Syntax
```
[pump:cycle:ON_DURATION:OFF_INTERVAL:CYCLES]
```
- `ON_DURATION` = seconds device stays on per cycle
- `OFF_INTERVAL` = seconds device stays off between cycles
- `CYCLES` = number of cycles (0 = infinite)

### Examples
```
[pump:cycle:5:10:3]   - 5s on, 10s off, repeat 3 times
[pump:cycle:3:8:5]    - 3s on, 8s off, repeat 5 times
[pump:cycle:10:15:0]  - 10s on, 15s off, repeat infinitely
[vibe:cycle:2:5:10]   - 2s on, 5s off, repeat 10 times
```

**Example in AI response:**
```
"The pump begins its rhythmic cycle. [pump:cycle:5:10:3] Five seconds on, ten seconds off, three times."
```
→ Device:
1. Pump on for 5 seconds
2. Pump off for 10 seconds
3. Repeat 2 more times (3 total cycles)
4. Pump turns off

**Infinite cycling example:**
```
"The relentless rhythm begins. [pump:cycle:3:7:0] Over and over..."
```
→ Device: Cycles 3s on, 7s off, forever (until manually stopped or emergency stop)

---

## Safety Features

### Capacity Limit Protection
- **Pump commands are blocked at 100% capacity** (unless "Allow Over-Inflation" is enabled in settings)
- Applies to: `[pump on]`, `[pump:pulse:N]`, `[pump:timed:N]`, `[pump:cycle:...]`
- Protects against accidental over-inflation
- User sees a safety warning message

### Auto-Off Protection
- `[pump on]` automatically turns off after max duration (default 30s, configurable)
- Prevents runaway devices if AI forgets to turn them off
- Can be interrupted with `[pump off]` or emergency stop

### Timer Management
- Only one timer/operation per device at a time
- New commands cancel previous timers
- Example: `[pump on]` followed by `[pump:timed:60]` cancels the first auto-off timer

---

## Command Priority

If multiple commands for the same device appear in one message, **only the LAST one executes**.

**Example:**
```
"First the pump turns on [pump on], but then she changes her mind [pump off]."
```
→ Only `[pump off]` executes (device stays off)

This prevents conflicting commands and matches natural language flow.

---

## Usage Tips

### For Character Creators

**Good practice:**
- Use tags when the character explicitly controls a device
- Match the action to the narrative ("She flips the switch [pump on]")
- Use pulse for dramatic, rhythmic moments
- Use cycle for training sequences or patterns
- Use timed for precise durations

**Avoid:**
- Overusing tags (not every sentence needs device control)
- Contradictory tags in the same message
- Using tags when just describing what the device is doing (vs. actively controlling it)

### For Flow Authors

Tags work in Flow nodes (AI Message, Character Message, etc.):
```
Flow Node: "Beginning the cycle now [pump:cycle:10:5:3]"
```

### For ScreenPlay Authors

Tags work in ScreenPlay dialogue and narration:
```
MISTRESS: "Let's see how you handle this. [pump:timed:45]"
```

---

## Configuration

### Settings → Global Character Controls

- **Allow LLM Device Control**: Enable/disable all AI device tags
- **Max LLM Device Control Duration**: Default auto-off time for `[pump on]` (seconds)
- **Allow Over-Inflation**: Allow pump at 100%+ capacity
- **Pulse Duration**: Default pulses for `[pump:pulse:N]` if N not specified

---

## Emergency Stop

The **Emergency Stop** button immediately:
- Turns off ALL devices
- Cancels all timers
- Stops all cycles
- Clears all pending operations

**Always have a hardware disconnect within reach during use.**

---

## Advanced: Reinforcement System

SwellDreams has an optional "reinforcement" system that can **auto-append tags** if the AI describes pump activity but forgets the tag.

**Example:**
```
AI writes: "She turns on the pump and it hums to life."
System detects: Pump activation phrase but no [pump on] tag
System auto-appends: [pump on]
```

This helps less tag-aware models control devices more reliably. Can be enabled/disabled in settings.

---

## Complete Tag Reference

| Tag | Description | Example |
|-----|-------------|---------|
| `[pump on]` | Turn on (auto-off after max duration) | `[pump on]` |
| `[pump off]` | Turn off immediately | `[pump off]` |
| `[pump:pulse:N]` | N quick pulses (0.5s each) | `[pump:pulse:5]` |
| `[pump:timed:SECONDS]` | Run for SECONDS then auto-off | `[pump:timed:60]` |
| `[pump:cycle:ON:OFF:N]` | Cycle ON/OFF N times | `[pump:cycle:5:10:3]` |
| `[vibe on]` | Turn vibrator on | `[vibe on]` |
| `[vibe:pulse:N]` | N quick vibe pulses | `[vibe:pulse:3]` |
| `[tens on]` | Turn TENS unit on | `[tens on]` |
| `[tens:timed:N]` | TENS for N seconds | `[tens:timed:30]` |

---

## Troubleshooting

### Tag Not Working

1. **Check format**: Must be exact (no extra spaces, correct syntax)
   - ✅ `[pump on]`
   - ❌ `[ pump  on ]` (extra spaces)
   - ❌ `[pump:on]` (wrong separator)

2. **Check device is configured**: Go to Settings → Devices, ensure device exists and is marked as PUMP/VIBE/TENS

3. **Check logs**: Backend console shows parsed commands and any errors

### Device Doesn't Turn On

1. **Check capacity**: Pump blocked at 100%? Check "Allow Over-Inflation" setting
2. **Check device connection**: Test manual control in device settings
3. **Emergency stop active?**: Clear emergency stop state

### Cycles Not Working

1. **Check device service**: Ensure backend supports cycling (TP-Link Kasa, Govee, Tuya, etc.)
2. **Check parameters**: ON, OFF, CYCLES must be numbers
3. **Previous cycle running?**: New cycle command stops old one

---

## Examples in Context

### Training Scene
```
MISTRESS: "We'll do five sets. [pump:cycle:8:12:5] Eight seconds on, twelve seconds rest. Can you handle it?"
```

### Teasing
```
LUNA: "Just a little taste... [pump:pulse:3] See how that feels?"
```

### Endurance Challenge
```
VEX: "One full minute. No breaks. [pump:timed:60] Ready?"
```

### Buildup
```
DR. CHEN: "Starting the pump now. [pump on] We'll monitor for the standard duration."
```

---

Made with care by the Airegasm team.
