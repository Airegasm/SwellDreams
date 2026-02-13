# chip-tool Setup Guide

chip-tool is Matter's official command-line controller for commissioning and controlling Matter devices.

## Installation

### Windows

1. **Download Pre-built Binary**
   - Download from: https://github.com/project-chip/connectedhomeip/releases
   - Look for Windows builds (chip-tool-windows-*.zip)
   - Extract `chip-tool.exe`

2. **Place in SwellDreams**
   ```
   SwellDreams/
   └── backend/
       └── bin/
           └── chip-tool/
               └── chip-tool.exe
   ```

3. **Verify Installation**
   ```bash
   cd backend/bin/chip-tool
   chip-tool.exe version
   ```

### Alternative: Build from Source

If pre-built binaries aren't available:

1. Install prerequisites:
   - Visual Studio 2019+ with C++ tools
   - Python 3.8+
   - Git

2. Clone and build:
   ```bash
   git clone https://github.com/project-chip/connectedhomeip.git
   cd connectedhomeip
   scripts/build/build_examples.py --target windows-x64-chip-tool build
   ```

3. Copy built binary:
   ```bash
   copy out\windows-x64-chip-tool\chip-tool.exe path\to\SwellDreams\backend\bin\chip-tool\
   ```

## Usage in SwellDreams

Once chip-tool is installed:

1. **Add Matter Device in Settings**
   - Go to Settings → Smart Devices → Matter
   - Enter pairing code from your Tapo app
   - Click "Commission Device"

2. **Commission Button**
   - Matter devices show a "Commission" button
   - Click to pair the device using chip-tool
   - Wait 10-30 seconds for commissioning

3. **Control Device**
   - Use Test button to test on/off
   - Device works like any other smart plug

## Troubleshooting

**"chip-tool not found"**
- Verify chip-tool.exe exists at `backend/bin/chip-tool/chip-tool.exe`
- Check file permissions

**"Commissioning failed"**
- Ensure device is in pairing mode
- Check device is on same network
- Verify pairing code is correct (11 digits)
- Try resetting the device in Tapo app

**"Device not responding"**
- Device may need re-commissioning
- Check network connectivity
- Restart chip-tool storage: delete `backend/data/matter-storage/`

## Matter Device Requirements

- Device must support Matter protocol
- Tapo P115 requires firmware v1.3.0+
- Device must be on same network as SwellDreams server
- Matter must be enabled in device's app (Tapo app → Settings → Third-Party Services)
