# Matter Device Setup Guide

## Overview
SwellDreams now supports Matter-enabled smart devices (like TP-Link P110M, Tapo H500, etc.)

## Installation

```bash
cd backend
npm install @project-chip/matter-node.js
```

## Device Requirements

- Matter-enabled device (look for "M" suffix like P110M)
- Device must support Matter protocol
- Same local network as SwellDreams backend

## Setup Steps

### 1. Enable Matter on Device

**For Tapo devices:**
1. Open Tapo app
2. Go to device settings
3. Enable Matter support (if available)
4. Get the pairing code (11 digits) or QR code

**For other brands:**
- Check manufacturer instructions for enabling Matter

### 2. Commission Device via SwellDreams

#### Option A: Via API

```javascript
const matterService = require('./services/matter-service');

// Initialize Matter controller
await matterService.initialize();

// Commission device with pairing code
const device = await matterService.commission('12345678901', 'Living Room Plug');
// Returns: { deviceId: 'xxx', name: 'Living Room Plug', commissioned: true }

// Control the device
await matterService.turnOn(device.deviceId);
await matterService.turnOff(device.deviceId);
const state = await matterService.getPowerState(device.deviceId);
```

#### Option B: Via Device Service (Standard Flow)

```javascript
const { DeviceService } = require('./services/device-service');
const deviceService = new DeviceService();

// Register Matter device
deviceService.registerDevice({
  brand: 'matter',
  deviceId: 'xxx',  // From commission step
  name: 'Living Room Plug',
  deviceType: 'PLUG'
});

// Control via standard device service
await deviceService.turnOn('xxx', { brand: 'matter', deviceId: 'xxx' });
await deviceService.turnOff('xxx', { brand: 'matter', deviceId: 'xxx' });
```

## API Reference

### Discovery

```javascript
// Discover commissionable Matter devices on network
const devices = await matterService.discover(30); // 30 second timeout
// Returns: [{ deviceId, name, vendorId, productId, pairingCode, qrCode }]
```

### Commission (Pair)

```javascript
// Commission a device using pairing code
const device = await matterService.commission('12345678901', 'Device Name');
// Returns: { deviceId, name, nodeId, commissioned: true }
```

### Control

```javascript
// Turn on
await matterService.turnOn(deviceId);

// Turn off
await matterService.turnOff(deviceId);

// Get state
const state = await matterService.getPowerState(deviceId);
// Returns: 'on' or 'off'

// Get device info
const info = await matterService.getDeviceInfo(deviceId);
```

### List Commissioned Devices

```javascript
const devices = await matterService.listDevices();
// Returns: [{ deviceId, name, vendorName, productName, ... }]
```

### Remove Device

```javascript
await matterService.removeDevice(deviceId);
```

## Storage

Matter credentials and commissioned devices are stored in:
```
backend/data/matter-storage/
```

This directory contains the Matter fabric credentials and device pairings.

## Troubleshooting

### Device Not Discovered
- Ensure device is in pairing mode (usually first 15 minutes after power on)
- Check that device and backend are on same network
- Update device firmware via manufacturer app

### Commission Failed
- Verify pairing code is correct
- Ensure device wasn't already commissioned to another controller
- Factory reset device and try again

### Control Commands Failing
- Check device is still commissioned: `await matterService.listDevices()`
- Verify network connectivity
- Restart Matter controller: `await matterService.shutdown()` then `initialize()`

## Compatible Devices

Known compatible Matter devices:
- TP-Link Tapo P110M (Matter plug)
- TP-Link Tapo H500 (Matter hub)
- Eve Energy (Matter plug)
- Nanoleaf A19 (Matter bulb)
- Many others with Matter certification

**Note:** Regular Tapo devices (P110, P115 without "M") do NOT support Matter.

## Future Enhancements

Planned features:
- Auto-discovery UI
- QR code pairing
- Energy monitoring for Matter plugs with power measurement
- Dimming support for Matter lights
- Matter thread border router support
