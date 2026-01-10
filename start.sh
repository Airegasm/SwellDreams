#!/bin/bash

# SwellDreams Startup Script

echo "Starting SwellDreams..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if Python3 is installed
if ! command -v python3 &> /dev/null; then
    echo "Error: Python3 is not installed. Please install Python3 first."
    exit 1
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$SCRIPT_DIR/.pids"
mkdir -p "$PID_DIR"

# Check if already running
if [ -f "$PID_DIR/backend.pid" ]; then
    OLD_PID=$(cat "$PID_DIR/backend.pid")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "SwellDreams is already running (backend PID: $OLD_PID)"
        echo "Run ./stop.sh first to stop it."
        exit 1
    fi
fi

# Install backend dependencies if needed
if [ ! -d "$SCRIPT_DIR/backend/node_modules" ]; then
    echo "Installing backend dependencies..."
    cd "$SCRIPT_DIR/backend" && npm install
fi

# Install frontend dependencies if needed
if [ ! -d "$SCRIPT_DIR/frontend/node_modules" ]; then
    echo "Installing frontend dependencies..."
    cd "$SCRIPT_DIR/frontend" && npm install
fi

# Start backend
echo "Starting backend server..."
cd "$SCRIPT_DIR/backend"
node server.js &
BACKEND_PID=$!
echo $BACKEND_PID > "$PID_DIR/backend.pid"

# Wait for backend to start
sleep 2

# Start frontend on port 3001
echo "Starting frontend..."
cd "$SCRIPT_DIR/frontend"
PORT=3001 npm start &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$PID_DIR/frontend.pid"

echo ""
echo "SwellDreams is running!"
echo "  Backend:  http://localhost:8889 (PID: $BACKEND_PID)"
echo "  Frontend: http://localhost:3001 (PID: $FRONTEND_PID)"
echo ""
echo "Press Ctrl+C to stop, or run ./stop.sh"

# Cleanup function
cleanup() {
    echo ""
    echo "Stopping SwellDreams..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    rm -f "$PID_DIR/backend.pid" "$PID_DIR/frontend.pid"
    echo "Stopped."
    exit 0
}

# Handle shutdown
trap cleanup INT TERM

# Wait for processes
wait
