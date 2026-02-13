# Matter Integration for SwellDreams

SwellDreams now supports Matter-compatible smart devices using the `python-matter-server` wrapper!

## What is Matter?

Matter is a unified smart home standard that allows devices from different manufacturers to work together. Many newer TP-Link Tapo devices (like the P115 smart plug) support Matter in addition to their native protocols.

## Setup

### Automatic Installation

**No manual setup required!** When you run `start.bat`, it automatically:
- Checks for Python installation
- Installs/updates all Python dependencies including `python-matter-server`
- Sets up the Matter control script

Just make sure you have **Python 3.8+** installed on your system.

### Manual Installation (Optional)

If you want to manually install dependencies:

```bash
cd backend
pip install -r requirements.txt
```

This installs:
- `python-matter-server` - Official Python wrapper for Matter protocol
- All required dependencies (aiohttp, orjson, home-assistant-chip-clusters, etc.)

### Verify Installation

Check that the Matter control script works:

```bash
python backend/bin/matter-control.py
```

You should see a usage message indicating the script is ready.

## How It Works

### Architecture

1. **Matter Server** (`python-matter-server`): Background process that handles Matter protocol communication
2. **Control Script** (`backend/bin/matter-control.py`): Python wrapper that sends commands to the Matter server
3. **Matter Service** (`backend/services/matter-service.js`): Node.js service that calls the Python script
4. **REST API** (`backend/server.js`): Express endpoints for device control
5. **Frontend UI** (`frontend/src/components/settings/DeviceTab.js`): User interface for commissioning and controlling devices

### Flow Diagram

```
Frontend UI
    ↓
REST API (/api/matter/commission)
    ↓
Matter Service (matter-service.js)
    ↓
Python Control Script (matter-control.py)
    ↓
Python Matter Server (WebSocket: ws://localhost:5580)
    ↓
Matter Device (e.g., Tapo P115)
```

## Using Matter Devices in SwellDreams

**Prerequisites:** Python 3.8+ installed (dependencies auto-install when you run `start.bat`)

### Step 1: Enable Matter on Your Device

For Tapo devices:
1. Open the Tapo app
2. Select your device (e.g., P115 smart plug)
3. Go to Settings → Third-Party Services
4. Enable "Matter"
5. The app will show a pairing code (11 digits)

### Step 2: Start the Matter Server (Optional)

The Matter server can auto-start when needed, or you can start it manually:

1. Open SwellDreams Settings → Smart Devices → Matter
2. Click "Start Server" in the Matter Server status box
3. Enable "Auto-start server when commissioning devices" for automatic startup

### Step 3: Commission the Device

1. In SwellDreams, go to Settings → Smart Devices → Matter
2. Enter the pairing code from your Tapo app (11 digits)
3. Give your device a friendly name (e.g., "Living Room Plug")
4. Click "Commission Device"
5. Wait 10-30 seconds for commissioning to complete

### Step 4: Use the Device

Once commissioned:
- The device appears in your smart device list
- You can test on/off control with the "Test" button
- Use it in flows just like any other smart device
- Control it via chat commands

## API Reference

### Backend API Endpoints

#### Get Matter Server Status
```
GET /api/matter/status
Response: {
  matterControllerInstalled: true,
  ready: true,
  server: {
    running: true,
    autoStart: true,
    storagePath: "backend/data/matter-storage",
    processId: 12345
  }
}
```

#### Start Matter Server
```
POST /api/matter/server/start
Response: {
  success: true,
  message: "Matter server started",
  running: true
}
```

#### Stop Matter Server
```
POST /api/matter/server/stop
Response: {
  success: true,
  message: "Matter server stopped",
  running: false
}
```

#### Set Auto-Start
```
POST /api/matter/server/autostart
Body: { enabled: true }
Response: {
  success: true,
  autoStart: true
}
```

#### Commission Device
```
POST /api/matter/commission
Body: {
  pairingCode: "34970112332",
  deviceName: "Living Room Plug"
}
Response: {
  deviceId: "1",
  nodeId: 1,
  name: "Living Room Plug",
  commissioned: true
}
```

#### Control Device
```
POST /api/matter/devices/:deviceId/on
POST /api/matter/devices/:deviceId/off
GET  /api/matter/devices/:deviceId/state
```

### Python Control Script Commands

The `matter-control.py` script supports these commands:

```bash
# Commission a device
python matter-control.py commission <pairingCode> [deviceName]

# Turn device on
python matter-control.py on <nodeId>

# Turn device off
python matter-control.py off <nodeId>

# Get device state
python matter-control.py state <nodeId>

# List commissioned devices
python matter-control.py list
```

All commands return JSON output with `success` and result data.

## Troubleshooting

### "Matter server not running"

The server auto-starts when commissioning, but you can manually start it:
1. Go to Settings → Smart Devices → Matter
2. Click "Start Server"

Or enable auto-start:
1. Check "Auto-start server when commissioning devices"

### "Failed to commission device"

- Ensure the device is in pairing mode (Matter enabled in Tapo app)
- Verify the pairing code is correct (11 digits)
- Check that the device is on the same network as your computer
- Try resetting the device and re-enabling Matter in the Tapo app
- Ensure `python-matter-server` is installed: `pip install python-matter-server`

### "python-matter-server not found"

This means Python dependencies weren't installed. Solutions:

1. **Easiest:** Just run `start.bat` again - it auto-installs dependencies
2. **Manual:** Install directly:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```
3. **Check Python:** Make sure Python 3.8+ is installed and in your PATH

### "Device not responding"

- Device may need re-commissioning
- Check network connectivity
- Restart the Matter server (Stop → Start)
- Clear storage and re-commission: delete `backend/data/matter-storage/`

### "Module not found: matter_server"

The Python package is installed but Python can't find it. Try:
```bash
python -m pip install --upgrade python-matter-server
```

## Matter vs Native Tapo

You can control Tapo devices using either:

1. **Native Tapo Protocol** (via `tapo` Python library or `tp-link-tapo-connect` npm package)
   - Faster, no additional server needed
   - Works with all Tapo devices
   - Requires Tapo username/password

2. **Matter Protocol** (via `python-matter-server`)
   - Standardized protocol
   - No cloud credentials needed
   - Works with any Matter device, not just Tapo
   - Requires Matter-compatible firmware (Tapo P115 needs v1.3.0+)
   - Requires Matter server to be running

Choose the method that works best for your setup!

## Supported Devices

Any Matter-compatible smart plug should work, including:

- **TP-Link Tapo**
  - P115 (firmware v1.3.0+)
  - Other Matter-enabled Tapo devices

- **Other Matter Devices**
  - Most smart plugs with Matter support
  - Matter-compatible lights and switches
  - Any device with OnOff cluster support

## Technical Details

### Matter Server Storage

Commissioned devices are stored in: `backend/data/matter-storage/`

This directory contains:
- Device credentials and certificates
- Matter fabric information
- Commissioned node data

**Note:** Deleting this directory will unpair all devices and require re-commissioning.

### Matter Clusters Used

- **OnOff Cluster**: Controls on/off state of devices
  - Endpoint: 1 (typical for smart plugs)
  - Commands: On, Off
  - Attributes: OnOff (boolean state)

- **UserLabel Cluster** (optional): Sets device friendly names
  - Endpoint: 0 (root endpoint)
  - Command: AddLabel

### WebSocket Communication

The Python control script connects to the Matter server via WebSocket:
- URL: `ws://localhost:5580/ws`
- Protocol: Matter server's internal WebSocket API
- Connection: Created per command, then closed

## Future Enhancements

Potential improvements:
- [ ] Support for Matter lights (brightness, color)
- [ ] Energy monitoring (if device supports)
- [ ] Matter groups for controlling multiple devices
- [ ] OTA firmware updates for Matter devices
- [ ] Matter bridge mode to expose SwellDreams devices
- [ ] Persistent WebSocket connection for faster commands
- [ ] Real-time device status updates via subscriptions

## References

- [Matter Specification](https://csa-iot.org/all-solutions/matter/)
- [python-matter-server GitHub](https://github.com/home-assistant-libs/python-matter-server)
- [Home Assistant CHIP Clusters](https://github.com/home-assistant-libs/home-assistant-chip-clusters)
- [Tapo P115 Matter Support](https://www.tp-link.com/us/support/faq/3420/)
