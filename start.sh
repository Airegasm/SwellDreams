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

# Wait for backend to start
sleep 2

# Start frontend on port 3001
echo "Starting frontend..."
cd "$SCRIPT_DIR/frontend"
PORT=3001 npm start &
FRONTEND_PID=$!

echo ""
echo "SwellDreams is running!"
echo "  Backend:  http://localhost:8889"
echo "  Frontend: http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop"

# Handle shutdown
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM

# Wait for processes
wait
