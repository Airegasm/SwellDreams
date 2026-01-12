#!/bin/bash

# SwellDreams Stop Script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$SCRIPT_DIR/.pids"

echo "Stopping SwellDreams..."

STOPPED=0

# Stop server
if [ -f "$PID_DIR/server.pid" ]; then
    SERVER_PID=$(cat "$PID_DIR/server.pid")
    if kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null
        echo "  Stopped server (PID: $SERVER_PID)"
        STOPPED=1
    fi
    rm -f "$PID_DIR/server.pid"
fi

# Legacy: Stop old backend/frontend pids if they exist
if [ -f "$PID_DIR/backend.pid" ]; then
    BACKEND_PID=$(cat "$PID_DIR/backend.pid")
    kill "$BACKEND_PID" 2>/dev/null && echo "  Stopped legacy backend"
    rm -f "$PID_DIR/backend.pid"
    STOPPED=1
fi

if [ -f "$PID_DIR/frontend.pid" ]; then
    FRONTEND_PID=$(cat "$PID_DIR/frontend.pid")
    kill "$FRONTEND_PID" 2>/dev/null && echo "  Stopped legacy frontend"
    rm -f "$PID_DIR/frontend.pid"
    STOPPED=1
fi

# Also kill any orphaned processes
pkill -f "node.*server.js" 2>/dev/null && echo "  Killed orphaned server processes" && STOPPED=1

if [ $STOPPED -eq 0 ]; then
    echo "SwellDreams was not running."
else
    echo "SwellDreams stopped."
fi
