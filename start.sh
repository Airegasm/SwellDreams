#!/bin/bash

# SwellDreams Production Startup Script

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Read version from version.json
VERSION=$(cat "$SCRIPT_DIR/version.json" | grep '"version"' | sed 's/.*: *"\(.*\)".*/\1/')
NAME=$(cat "$SCRIPT_DIR/version.json" | grep '"name"' | sed 's/.*: *"\(.*\)".*/\1/')
CODENAME=$(cat "$SCRIPT_DIR/version.json" | grep '"codename"' | sed 's/.*: *"\(.*\)".*/\1/')

echo ""
echo "========================================"
echo "  $NAME v$VERSION $CODENAME"
echo "========================================"
echo ""

# Function to install Node.js
install_node() {
    echo "Node.js not found. Attempting to install..."

    # Try to detect package manager and install
    if command -v apt-get &> /dev/null; then
        echo "Using apt to install Node.js..."
        sudo apt-get update && sudo apt-get install -y nodejs npm
    elif command -v dnf &> /dev/null; then
        echo "Using dnf to install Node.js..."
        sudo dnf install -y nodejs npm
    elif command -v pacman &> /dev/null; then
        echo "Using pacman to install Node.js..."
        sudo pacman -S --noconfirm nodejs npm
    elif command -v brew &> /dev/null; then
        echo "Using Homebrew to install Node.js..."
        brew install node
    else
        echo "Could not detect package manager. Installing via nvm..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        nvm install --lts
    fi

    # Verify installation
    if ! command -v node &> /dev/null; then
        echo "Error: Failed to install Node.js. Please install manually."
        exit 1
    fi
    echo "Node.js installed successfully: $(node --version)"
}

# Check if Node.js is installed, install if not
if ! command -v node &> /dev/null; then
    install_node
fi

# Check if Python3 is installed
if ! command -v python3 &> /dev/null; then
    echo "Error: Python3 is not installed. Please install Python3 first."
    exit 1
fi

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

# Build frontend if needed
if [ ! -d "$SCRIPT_DIR/frontend/build" ] || [ "$1" = "--rebuild" ]; then
    echo "Building frontend for production..."
    cd "$SCRIPT_DIR/frontend" && npm run build
fi

# Start server
echo "Starting SwellDreams server..."
cd "$SCRIPT_DIR/backend"
node server.js > /dev/null 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > "$PID_DIR/server.pid"

# Wait for server to start
sleep 2

echo ""
echo "========================================"
echo "  $NAME v$VERSION is running!"
echo "  http://localhost:8889"
echo "========================================"
echo ""

# Open browser
echo "Opening browser..."
if command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:8889" &> /dev/null &
elif command -v open &> /dev/null; then
    open "http://localhost:8889" &> /dev/null &
elif command -v wslview &> /dev/null; then
    wslview "http://localhost:8889" &> /dev/null &
fi

echo "Press Ctrl+C to stop, or run ./stop.sh"

# Cleanup function
cleanup() {
    echo ""
    echo "Stopping SwellDreams..."
    kill $SERVER_PID 2>/dev/null
    rm -f "$PID_DIR/server.pid"
    echo "Stopped."
    exit 0
}

# Handle shutdown
trap cleanup INT TERM

# Wait for processes
wait
