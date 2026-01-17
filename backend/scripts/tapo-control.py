#!/usr/bin/env python3
"""
Tapo Device Control Script
Uses plugp100 library with proper KLAP protocol support

Usage:
  python tapo-control.py <command> <ip> <email> <password>

Commands:
  on     - Turn device on
  off    - Turn device off
  state  - Get device power state
  info   - Get device info (JSON)
"""

import sys
import json
import asyncio
from plugp100.new.device_factory import connect, DeviceConnectConfiguration
from plugp100.common.credentials import AuthCredential

async def get_device(ip: str, email: str, password: str):
    """Create authenticated Tapo device connection"""
    credentials = AuthCredential(email, password)
    config = DeviceConnectConfiguration(host=ip, credentials=credentials)
    device = await connect(config)
    return device

async def turn_on(ip: str, email: str, password: str):
    """Turn device on"""
    try:
        device = await get_device(ip, email, password)
        await device.on()
        return {"success": True, "state": "on"}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def turn_off(ip: str, email: str, password: str):
    """Turn device off"""
    try:
        device = await get_device(ip, email, password)
        await device.off()
        return {"success": True, "state": "off"}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def get_state(ip: str, email: str, password: str):
    """Get device power state"""
    try:
        device = await get_device(ip, email, password)
        info = await device.get_device_info()
        # Handle both dict and object responses
        if hasattr(info, 'device_on'):
            device_on = info.device_on
        elif isinstance(info, dict):
            device_on = info.get("device_on", False)
        else:
            device_on = getattr(info, 'device_on', False)
        return {"success": True, "state": "on" if device_on else "off"}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def get_info(ip: str, email: str, password: str):
    """Get device info"""
    try:
        device = await get_device(ip, email, password)
        info = await device.get_device_info()
        # Convert to dict if it's an object
        if hasattr(info, '__dict__'):
            info_dict = {k: v for k, v in info.__dict__.items() if not k.startswith('_')}
        elif isinstance(info, dict):
            info_dict = info
        else:
            info_dict = {"raw": str(info)}
        return {"success": True, "info": info_dict}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def main():
    if len(sys.argv) < 5:
        print(json.dumps({"success": False, "error": "Usage: tapo-control.py <command> <ip> <email> <password>"}))
        sys.exit(1)

    command = sys.argv[1].lower()
    ip = sys.argv[2]
    email = sys.argv[3]
    password = sys.argv[4]

    if command == "on":
        result = await turn_on(ip, email, password)
    elif command == "off":
        result = await turn_off(ip, email, password)
    elif command == "state":
        result = await get_state(ip, email, password)
    elif command == "info":
        result = await get_info(ip, email, password)
    else:
        result = {"success": False, "error": f"Unknown command: {command}"}

    print(json.dumps(result))

if __name__ == "__main__":
    asyncio.run(main())
