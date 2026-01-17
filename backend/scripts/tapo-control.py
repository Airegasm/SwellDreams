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

# Try to import plugp100 with helpful error message
try:
    from plugp100.new.device_factory import connect, DeviceConnectConfiguration
    from plugp100.common.credentials import AuthCredential
except ImportError as e:
    print(json.dumps({
        "success": False,
        "error": f"plugp100 library not installed properly: {e}. Try: pip install plugp100"
    }))
    sys.exit(1)
except Exception as e:
    print(json.dumps({
        "success": False,
        "error": f"Failed to import plugp100: {type(e).__name__}: {e}"
    }))
    sys.exit(1)

async def get_device(ip: str, email: str, password: str):
    """Create authenticated Tapo device connection"""
    try:
        credentials = AuthCredential(email, password)
        config = DeviceConnectConfiguration(host=ip, credentials=credentials)
        device = await connect(config)
        return device
    except TypeError as e:
        # Handle "super() argument" errors which may indicate Python version issues
        if "super()" in str(e):
            raise Exception(f"Python compatibility error. Try upgrading Python to 3.10+ or reinstalling plugp100: {e}")
        raise

async def turn_on(ip: str, email: str, password: str):
    """Turn device on"""
    device = None
    try:
        device = await get_device(ip, email, password)
        await device.on()
        return {"success": True, "state": "on"}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if device and hasattr(device, 'close'):
            try:
                await device.close()
            except:
                pass

async def turn_off(ip: str, email: str, password: str):
    """Turn device off"""
    device = None
    try:
        device = await get_device(ip, email, password)
        await device.off()
        return {"success": True, "state": "off"}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if device and hasattr(device, 'close'):
            try:
                await device.close()
            except:
                pass

async def get_state(ip: str, email: str, password: str):
    """Get device power state"""
    device = None
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
    finally:
        if device and hasattr(device, 'close'):
            try:
                await device.close()
            except:
                pass

async def get_info(ip: str, email: str, password: str):
    """Get device info"""
    device = None
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
    finally:
        if device and hasattr(device, 'close'):
            try:
                await device.close()
            except:
                pass

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
    try:
        asyncio.run(main())
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Script error: {type(e).__name__}: {e}"}))
        sys.exit(1)
