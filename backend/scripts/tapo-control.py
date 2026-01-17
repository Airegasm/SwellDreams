#!/usr/bin/env python3
"""
Tapo Device Control Script
Uses plugp100 library with proper KLAP protocol support

Usage:
  python3 tapo-control.py <command> <ip> <email> <password>

Commands:
  on     - Turn device on
  off    - Turn device off
  state  - Get device power state
  info   - Get device info (JSON)
"""

import sys
import json
import asyncio
from plugp100.api.tapo_client import TapoClient
from plugp100.common.credentials import AuthCredential

async def get_device(ip: str, email: str, password: str):
    """Create authenticated Tapo client"""
    credentials = AuthCredential(email, password)
    client = TapoClient.create(credentials, ip)
    await client.initialize()
    return client

async def turn_on(ip: str, email: str, password: str):
    """Turn device on"""
    try:
        client = await get_device(ip, email, password)
        await client.on()
        await client.close()
        return {"success": True, "state": "on"}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def turn_off(ip: str, email: str, password: str):
    """Turn device off"""
    try:
        client = await get_device(ip, email, password)
        await client.off()
        await client.close()
        return {"success": True, "state": "off"}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def get_state(ip: str, email: str, password: str):
    """Get device power state"""
    try:
        client = await get_device(ip, email, password)
        state = await client.get_device_info()
        await client.close()
        device_on = state.get("device_on", False)
        return {"success": True, "state": "on" if device_on else "off"}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def get_info(ip: str, email: str, password: str):
    """Get device info"""
    try:
        client = await get_device(ip, email, password)
        info = await client.get_device_info()
        await client.close()
        return {"success": True, "info": info}
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
