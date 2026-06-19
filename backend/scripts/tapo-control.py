#!/usr/bin/env python3
"""
Tapo Device Control Script
Uses 'tapo' library (Rust-based, more compatible)

Usage:
  python tapo-control.py <command> <ip> <email> <password>

Commands:
  on     - Turn device on
  off    - Turn device off
  state  - Get device power state
  info   - Get device info (JSON)
"""

import sys
import os
import json
import asyncio

# Try to import tapo library
try:
    from tapo import ApiClient
except ImportError as e:
    print(json.dumps({
        "success": False,
        "error": f"tapo library not installed. Try: pip install tapo"
    }))
    sys.exit(1)

# Models to probe, in priority order. Once we learn which model an IP speaks,
# we persist it so subsequent calls skip the probe (avoids tripling latency).
PROBE_MODELS = ["p100", "p110", "p115"]

# Persisted IP -> model map so we can skip probing on subsequent invocations.
_MODEL_CACHE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".tapo-model-cache.json"
)


def _load_model_cache():
    try:
        with open(_MODEL_CACHE_PATH, "r") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
    except (FileNotFoundError, ValueError, OSError):
        pass
    return {}


def _save_model_cache(cache: dict):
    try:
        tmp = _MODEL_CACHE_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(cache, f)
        os.replace(tmp, _MODEL_CACHE_PATH)
    except OSError:
        # Cache is a best-effort optimisation; ignore persistence failures.
        pass


def _is_connection_error(exc: Exception) -> bool:
    """True only for connection/network failures (so we should try the next
    model), False for auth/protocol errors (which we must surface, not mask)."""
    name = type(exc).__name__.lower()
    msg = str(exc).lower()
    connection_markers = (
        "connect", "connection", "timed out", "timeout", "unreachable",
        "refused", "network", "no route", "reset", "host", "dns", "resolve",
    )
    return any(m in name or m in msg for m in connection_markers)


async def get_device(ip: str, email: str, password: str):
    """Create authenticated Tapo device connection.

    Uses a persisted IP->model cache to skip probing. When probing, only
    connection errors fall through to the next model; auth/protocol errors are
    raised immediately so they aren't masked.
    """
    client = ApiClient(email, password)
    cache = _load_model_cache()

    # If we already know this device's model, use it directly (no probe).
    known = cache.get(ip)
    order = list(PROBE_MODELS)
    if known in PROBE_MODELS:
        order = [known] + [m for m in PROBE_MODELS if m != known]

    last_error = None
    for idx, model in enumerate(order):
        factory = getattr(client, model)
        try:
            device = await factory(ip)
            # Persist the resolved model for next time.
            if cache.get(ip) != model:
                cache[ip] = model
                _save_model_cache(cache)
            return device
        except Exception as e:  # noqa: BLE001 - we re-raise non-connection errors below
            last_error = e
            # Only keep probing on connection errors; surface anything else.
            if not _is_connection_error(e):
                raise Exception(
                    f"Could not connect to Tapo device at {ip}: {e}"
                )
            # If this was a cached/known model that's now unreachable, drop it
            # so we re-probe from scratch on the remaining models.
            if idx == 0 and known is not None and cache.get(ip) == known:
                cache.pop(ip, None)
                _save_model_cache(cache)

    raise Exception(f"Could not connect to Tapo device at {ip}: {last_error}")

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
        device_on = info.device_on if hasattr(info, 'device_on') else False
        return {"success": True, "state": "on" if device_on else "off"}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def get_info(ip: str, email: str, password: str):
    """Get device info"""
    try:
        device = await get_device(ip, email, password)
        info = await device.get_device_info()
        # Convert to dict
        info_dict = {}
        for attr in ['device_id', 'type', 'model', 'nickname', 'device_on', 'on_time',
                     'overheated', 'ip', 'mac', 'hw_ver', 'fw_ver', 'rssi', 'ssid']:
            if hasattr(info, attr):
                val = getattr(info, attr)
                info_dict[attr] = val
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
    try:
        asyncio.run(main())
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Script error: {type(e).__name__}: {e}"}))
        sys.exit(1)
