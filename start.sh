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

# Auto-update from git
echo "Checking for updates..."
cd "$SCRIPT_DIR"
if [ ! -d ".git" ]; then
    echo "Git repository not found. Setting up..."
    git init
    git remote add origin https://github.com/Airegasm/SwellDreams.git
    git fetch origin release
    git checkout -b release origin/release
    echo "Repository initialized on release branch."
elif ! git remote get-url origin &>/dev/null; then
    echo "No remote configured. Adding origin..."
    git remote add origin https://github.com/Airegasm/SwellDreams.git
    git pull origin release
    echo "Remote added. Pulled from release branch."
else
    # Migrate master users to release branch
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    if [ "$CURRENT_BRANCH" = "master" ] || [ "$CURRENT_BRANCH" = "main" ]; then
        echo "Migrating from $CURRENT_BRANCH to release branch..."
        git fetch origin release 2>/dev/null
        if git checkout release 2>/dev/null; then
            git branch -D "$CURRENT_BRANCH" 2>/dev/null
            echo "Switched to release branch."
        else
            echo "Warning: Could not switch to release. Continuing on $CURRENT_BRANCH..."
        fi
    fi
    if git pull; then
        echo "Update complete!"
    else
        echo "Warning: Could not update from git. Continuing with local version..."
    fi
fi
echo ""

# Re-read version after git pull (may have changed)
VERSION=$(cat "$SCRIPT_DIR/version.json" | grep '"version"' | sed 's/.*: *"\(.*\)".*/\1/')
NAME=$(cat "$SCRIPT_DIR/version.json" | grep '"name"' | sed 's/.*: *"\(.*\)".*/\1/')
CODENAME=$(cat "$SCRIPT_DIR/version.json" | grep '"codename"' | sed 's/.*: *"\(.*\)".*/\1/')

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
}

# Check if Node.js is installed, install if not
echo "Checking for Node.js..."
if ! command -v node &> /dev/null; then
    install_node
fi
echo "Node.js found: $(node --version)"

# Check Python and install dependencies
echo ""
echo "Checking for Python..."
if ! command -v python3 &> /dev/null; then
    echo "Warning: Python3 not found. Some features (Tapo) will be unavailable."
    echo "Install Python from https://www.python.org/downloads/"
else
    echo "Python found: $(python3 --version)"
    if [ -f "$SCRIPT_DIR/backend/requirements.txt" ]; then
        echo "Installing/updating Python dependencies..."
        pip3 install -q -r "$SCRIPT_DIR/backend/requirements.txt" 2>/dev/null || pip install -q -r "$SCRIPT_DIR/backend/requirements.txt" 2>/dev/null || echo "Warning: Could not install Python dependencies. Some features may not work."
    fi
fi

PID_DIR="$SCRIPT_DIR/.pids"
mkdir -p "$PID_DIR"

# Check if already running
if [ -f "$PID_DIR/server.pid" ]; then
    OLD_PID=$(cat "$PID_DIR/server.pid")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo ""
        echo "Warning: SwellDreams may already be running (PID: $OLD_PID)"
        echo "Close it manually or run ./stop.sh first to avoid conflicts."
        echo ""
        sleep 3
    fi
fi

# Install/update backend dependencies
echo ""
echo "Checking backend dependencies..."
cd "$SCRIPT_DIR/backend"
if [ ! -f "package.json" ]; then
    echo "ERROR: backend/package.json not found!"
    exit 1
fi
npm install
if [ $? -ne 0 ]; then
    echo "ERROR: Backend npm install failed!"
    exit 1
fi

# Install/update frontend dependencies
echo ""
echo "Checking frontend dependencies..."
cd "$SCRIPT_DIR/frontend"
if [ ! -f "package.json" ]; then
    echo "ERROR: frontend/package.json not found!"
    exit 1
fi
npm install
if [ $? -ne 0 ]; then
    echo "ERROR: Frontend npm install failed!"
    exit 1
fi

# Remove old build and rebuild frontend
echo ""
echo "Removing old frontend build..."
rm -rf "$SCRIPT_DIR/frontend/build"
echo "Building frontend for production..."
cd "$SCRIPT_DIR/frontend" && npm run build
if [ $? -ne 0 ]; then
    echo "ERROR: Frontend build failed!"
    exit 1
fi

# Start server
echo ""
echo "Starting SwellDreams server..."
cd "$SCRIPT_DIR/backend"
node server.js &
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
