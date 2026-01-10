#!/bin/bash

# SwellDreams Stop Script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$SCRIPT_DIR/.pids"

echo "Stopping SwellDreams..."

STOPPED=0

# Stop backend
if [ -f "$PID_DIR/backend.pid" ]; then
    BACKEND_PID=$(cat "$PID_DIR/backend.pid")
    if kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill "$BACKEND_PID" 2>/dev/null
        echo "  Stopped backend (PID: $BACKEND_PID)"
        STOPPED=1
    fi
    rm -f "$PID_DIR/backend.pid"
fi

# Stop frontend
if [ -f "$PID_DIR/frontend.pid" ]; then
    FRONTEND_PID=$(cat "$PID_DIR/frontend.pid")
    if kill -0 "$FRONTEND_PID" 2>/dev/null; then
        kill "$FRONTEND_PID" 2>/dev/null
        echo "  Stopped frontend (PID: $FRONTEND_PID)"
        STOPPED=1
    fi
    rm -f "$PID_DIR/frontend.pid"
fi

# Also kill any orphaned processes
pkill -f "node.*server.js" 2>/dev/null && echo "  Killed orphaned backend processes" && STOPPED=1
pkill -f "react-scripts start" 2>/dev/null && echo "  Killed orphaned frontend processes" && STOPPED=1

if [ $STOPPED -eq 0 ]; then
    echo "SwellDreams was not running."
else
    echo "SwellDreams stopped."
fi
