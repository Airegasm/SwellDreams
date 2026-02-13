#!/usr/bin/env python3
"""
Matter device control script for SwellDreams
Interfaces with python-matter-server to control Matter devices
"""
import sys
import json
import asyncio
import aiohttp
from typing import Optional
from matter_server.client.client import MatterClient


# Matter server connection details
MATTER_SERVER_URL = "ws://localhost:5580/ws"


async def connect_client() -> tuple[MatterClient, aiohttp.ClientSession]:
    """Connect to the Matter server"""
    session = aiohttp.ClientSession()
    client = MatterClient(MATTER_SERVER_URL, session)
    await client.connect()
    return client, session


async def commission_device(pairing_code: str, device_name: str = "Matter Device") -> dict:
    """
    Commission a Matter device using a pairing code

    Args:
        pairing_code: Manual pairing code (11 digits)
        device_name: Friendly name for the device

    Returns:
        Dict with success, nodeId, and name
    """
    client, session = await connect_client()

    try:
        # Commission the device
        # The commission_with_code method returns the node ID
        node_id = await client.commission_with_code(pairing_code)

        # Set device label/name if supported
        try:
            # Try to set a user label for the device
            await client.send_device_command(
                node_id,
                0,  # endpoint
                "UserLabel",  # cluster
                "AddLabel",  # command
                {"label": device_name, "value": ""}
            )
        except Exception as e:
            # Not all devices support labels, ignore errors
            pass

        return {
            "success": True,
            "nodeId": node_id,
            "name": device_name
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Commissioning failed: {str(e)}"
        }
    finally:
        await client.disconnect()
        await session.close()


async def send_on_command(node_id: int) -> dict:
    """
    Turn on a Matter device

    Args:
        node_id: Node ID of the device

    Returns:
        Dict with success and state
    """
    client, session = await connect_client()

    try:
        # Send On command to OnOff cluster on endpoint 1
        await client.send_device_command(
            node_id,
            1,  # endpoint (usually 1 for smart plugs)
            "OnOff",  # cluster name
            "On"  # command
        )

        return {
            "success": True,
            "nodeId": node_id,
            "state": "on"
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to turn on device: {str(e)}"
        }
    finally:
        await client.disconnect()
        await session.close()


async def send_off_command(node_id: int) -> dict:
    """
    Turn off a Matter device

    Args:
        node_id: Node ID of the device

    Returns:
        Dict with success and state
    """
    client, session = await connect_client()

    try:
        # Send Off command to OnOff cluster on endpoint 1
        await client.send_device_command(
            node_id,
            1,  # endpoint
            "OnOff",  # cluster name
            "Off"  # command
        )

        return {
            "success": True,
            "nodeId": node_id,
            "state": "off"
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to turn off device: {str(e)}"
        }
    finally:
        await client.disconnect()
        await session.close()


async def get_device_state(node_id: int) -> dict:
    """
    Get the current power state of a Matter device

    Args:
        node_id: Node ID of the device

    Returns:
        Dict with success and state ("on" or "off")
    """
    client, session = await connect_client()

    try:
        # Read the OnOff attribute from the OnOff cluster
        result = await client.read_attribute(
            node_id,
            1,  # endpoint
            "OnOff",  # cluster name
            "OnOff"  # attribute name
        )

        # The attribute value is a boolean
        state = "on" if result else "off"

        return {
            "success": True,
            "nodeId": node_id,
            "state": state
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to get device state: {str(e)}"
        }
    finally:
        await client.disconnect()
        await session.close()


async def list_devices() -> dict:
    """
    List all commissioned Matter devices

    Returns:
        Dict with success and list of devices
    """
    client, session = await connect_client()

    try:
        nodes = await client.get_nodes()
        devices = []

        for node_id, node_data in nodes.items():
            devices.append({
                "nodeId": node_id,
                "available": node_data.get("available", False),
                "reachable": node_data.get("reachable", False)
            })

        return {
            "success": True,
            "devices": devices
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to list devices: {str(e)}"
        }
    finally:
        await client.disconnect()
        await session.close()


def main():
    """Main entry point for the script"""
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Usage: matter-control.py <command> [args...]"}))
        sys.exit(1)

    command = sys.argv[1]
    result = None

    try:
        if command == "commission":
            pairing_code = sys.argv[2] if len(sys.argv) > 2 else None
            device_name = sys.argv[3] if len(sys.argv) > 3 else "Matter Device"

            if not pairing_code:
                print(json.dumps({"success": False, "error": "Pairing code required"}))
                sys.exit(1)

            result = asyncio.run(commission_device(pairing_code, device_name))

        elif command == "on":
            node_id = int(sys.argv[2]) if len(sys.argv) > 2 else None

            if node_id is None:
                print(json.dumps({"success": False, "error": "Node ID required"}))
                sys.exit(1)

            result = asyncio.run(send_on_command(node_id))

        elif command == "off":
            node_id = int(sys.argv[2]) if len(sys.argv) > 2 else None

            if node_id is None:
                print(json.dumps({"success": False, "error": "Node ID required"}))
                sys.exit(1)

            result = asyncio.run(send_off_command(node_id))

        elif command == "state":
            node_id = int(sys.argv[2]) if len(sys.argv) > 2 else None

            if node_id is None:
                print(json.dumps({"success": False, "error": "Node ID required"}))
                sys.exit(1)

            result = asyncio.run(get_device_state(node_id))

        elif command == "list":
            result = asyncio.run(list_devices())

        else:
            print(json.dumps({"success": False, "error": f"Unknown command: {command}"}))
            sys.exit(1)

        # Output result as JSON
        print(json.dumps(result))

        # Exit with error code if command failed
        if not result.get("success", False):
            sys.exit(1)

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
