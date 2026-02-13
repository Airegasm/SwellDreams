# Matter Device Support

## Overview

SwellDreams includes Matter protocol support for smart devices, allowing you to control Matter-compatible plugs (like Tapo P115) without firmware restrictions.

## Current Status

**Phase 1 (COMPLETED):** Automated Matter server management
- Python Matter control script stub (`matter-control.py`)
- Node.js Matter service (`services/matter-service.js`)
- UI components with Commission button for Matter devices
- API endpoints for commissioning and control
- **Automated server start/stop in Smart Devices settings**
- **Auto-start server when commissioning (configurable)**
- **Server status display with PID tracking**

**Phase 2 (TODO):** Full Matter integration
- Connect python-matter-server to actual Matter devices
- Implement real commissioning via Matter protocol
- Real device control via OnOff cluster commands
- Persistent commissioned device storage

## Files

- **bin/matter-control.py** - Python script for Matter device control
  - Currently returns mock responses
  - Will integrate with python-matter-server WebSocket API

- **services/matter-service.js** - Node.js Matter service
  - Shells out to Python script for device control
  - Manages commissioned device tracking
  - Provides Device Service compatible API

## Dependencies

Installed via pip:
```bash
pip install python-matter-server
```

This installs:
- `python-matter-server` (8.1.2)
- `home-assistant-chip-clusters` (2025.7.0)
- Required dependencies (aiohttp, aiorun, etc.)

## Usage

### Configure Matter Server

1. In SwellDreams UI, go to **Settings > Smart Devices**
2. Expand the **Matter (Universal Smart Home)** section
3. You'll see the Matter Server status panel with:
   - **Server status** (Running/Stopped) with colored badge
   - **Start/Stop buttons** to manually control the server
   - **Auto-start checkbox** to automatically start server when commissioning
   - **Process ID (PID)** when server is running

**Recommended:** Enable auto-start (checked by default) so the server starts automatically when you commission a device.

### Commission a Matter Device

1. In the Matter section, enter the device's pairing code (11 digits)
2. Optionally enter a friendly name for the device
3. Click **Commission Device**
4. If auto-start is enabled, the server will start automatically
5. Device will be commissioned and added to your device list

Alternatively, for devices already in your list:
1. Add a device with brand "matter" and include the pairing code
2. Click the **Commission** button next to the device
3. Device will be commissioned to your Matter network

### Control Matter Devices

Once commissioned, Matter devices work like any other smart device:
- Turn on/off via UI
- Use in flows with Device On/Off actions
- Query state for conditional logic
- Test button to cycle power

## Future Integration

To complete Matter support:

1. **Update matter-control.py to connect to Matter server:**
   - Connect to WebSocket server at `ws://localhost:5580`
   - Use MatterClient for actual commissioning
   - Send OnOff cluster commands to devices
   - Parse real device responses

The Matter server is already managed through the UI with auto-start support, so no additional setup is needed!

## Testing

Test the Python script directly:
```bash
cd backend
python bin/matter-control.py commission 12345678901 "Test Device"
python bin/matter-control.py on 1
python bin/matter-control.py off 1
python bin/matter-control.py state 1
```

## Troubleshooting

**"Matter server not running"**
- Start python-matter-server manually
- Check WebSocket connection on port 5580

**"Commission failed"**
- Verify pairing code is correct (11 digits)
- Ensure device is in pairing mode
- Check Matter server logs for errors

**"Device not responding"**
- Check device is powered on
- Verify network connectivity
- Re-commission if needed
