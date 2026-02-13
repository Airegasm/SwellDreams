# Matter Device Support

## Overview

SwellDreams includes native Matter protocol support using the official chip-tool binary. This provides seamless control of Matter-compatible devices (like Tapo P115 smart plugs) without any external dependencies.

## Features

✓ **Native Windows Support** - No Python, no WSL, no manual installations
✓ **Automatic Setup** - Binary downloads automatically on first use
✓ **One-Click Enable** - Just click a button in the UI to enable Matter
✓ **Full Device Control** - Commission, control, and monitor Matter devices
✓ **Works Offline** - No cloud services required after initial setup

## How It Works

SwellDreams uses `chip-tool`, the official Matter SDK command-line tool, to communicate directly with Matter devices on your network. Everything is handled automatically:

1. When you enable Matter support, the binary downloads automatically (if needed)
2. Click "Commission Device" with a pairing code - that's it!
3. Control devices just like any other smart device in SwellDreams

## Files

- **bin/chip-tool/** - Matter SDK binary directory
  - `chip-tool.exe` - Official Matter controller (auto-downloaded)

- **services/matter-service.js** - Node.js Matter service
  - Automatically downloads chip-tool if missing
  - Manages device commissioning and control
  - Provides Device Service compatible API

## Usage

### Enable Matter Support

1. Go to **Settings > Smart Devices**
2. Expand the **Matter (Universal Smart Home)** section
3. The system will automatically check for and download chip-tool if needed
4. Status indicator shows when Matter is ready

**No manual installation required!** Everything happens automatically.

### Commission a Matter Device

1. Put your Matter device in pairing mode (check device manual)
2. In the Matter section, enter the device's pairing code (11-digit number)
3. Optionally enter a friendly name for the device
4. Click **Commission Device**
5. Wait a few seconds for commissioning to complete
6. Device is now ready to use!

**Finding the pairing code:**
- Usually found on a sticker on the device or in the box
- Format: 11 digits (e.g., 12345678901)
- May also be shown as a QR code (enter the numbers below the QR)

### Control Matter Devices

Once commissioned, Matter devices work like any other smart device:
- **UI Control** - Turn on/off via the device list
- **Flows** - Use in automation flows with Device On/Off actions
- **Conditions** - Query state for conditional logic
- **Test Button** - Quick test to cycle power

### Supported Devices

Matter is a universal standard. Any Matter-compatible device should work, including:
- **Tapo P115** - Smart plug (main reason for Matter support)
- **Eve Energy** - Smart plug
- **Nanoleaf** - Smart lights
- **Philips Hue Bridge** - (Matter-enabled version)
- Any device with the Matter logo

## Technical Details

### Binary Management

- **Location:** `backend/bin/chip-tool/chip-tool.exe`
- **Download:** Automatic from official Matter SDK releases
- **Size:** ~5-20 MB (varies by version)
- **Updates:** Manual (will notify when updates available)

### Storage

Device commissioning data is stored in:
- **Path:** `backend/data/matter-storage/`
- **Format:** chip-tool native format
- **Persistence:** Survives app restarts

### Commands

chip-tool commands used internally:
```bash
# Commission device
chip-tool pairing code <node-id> <pairing-code>

# Turn on
chip-tool onoff on <node-id> 1

# Turn off
chip-tool onoff off <node-id> 1

# Read state
chip-tool onoff read on-off <node-id> 1
```

## Troubleshooting

### "Binary download failed"
- **Solution:** Check internet connection
- **Manual Fix:** Download from [Matter SDK Releases](https://github.com/project-chip/connectedhomeip/releases)
- Place at: `backend/bin/chip-tool/chip-tool.exe`

### "Commission failed"
- **Check:** Pairing code is correct (11 digits, no spaces)
- **Check:** Device is in pairing mode (LED flashing, etc.)
- **Check:** Device is powered on and nearby
- **Try:** Reset device to factory settings and try again

### "Device not responding"
- **Check:** Device is powered on
- **Check:** Device is on the same Wi-Fi network
- **Check:** Router/firewall allows local network communication
- **Try:** Re-commission the device

### "Command timeout"
- **Check:** Device is reachable on network
- **Check:** No firewall blocking mDNS/UDP ports
- **Try:** Move device closer to Wi-Fi router
- **Try:** Restart device and try again

## Why Matter?

**The Tapo Problem:**
- Tapo updated firmware to block third-party API access
- Matter protocol is built into the firmware
- Can't be blocked or encrypted away
- Official standard supported by major manufacturers

**Benefits:**
- Works with any Matter device, not just Tapo
- No cloud dependency (local network only)
- Fast response times
- Industry standard protocol

## Advanced

### Manual Binary Installation

If auto-download fails, manually install chip-tool:

1. Download from: https://github.com/project-chip/connectedhomeip/releases
2. Look for: `chip-tool-windows.exe` or `chip-tool-windows-x64.zip`
3. Extract and rename to: `backend/bin/chip-tool/chip-tool.exe`
4. Restart SwellDreams

### Command-Line Testing

Test chip-tool directly:
```bash
cd backend/bin/chip-tool

# Commission (node ID 1, pairing code 12345678901)
chip-tool.exe pairing code 1 12345678901

# Turn on device 1
chip-tool.exe onoff on 1 1

# Turn off device 1
chip-tool.exe onoff off 1 1

# Read state of device 1
chip-tool.exe onoff read on-off 1 1
```

### Development

To modify Matter behavior:
- Edit: `backend/services/matter-service.js`
- Main function: `executeChipTool(action, params)`
- Restart backend to apply changes
