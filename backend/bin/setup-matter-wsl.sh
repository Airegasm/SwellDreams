#!/bin/bash
# Setup Matter server in WSL

echo "Installing Python and dependencies..."
apt-get update > /dev/null 2>&1
apt-get install -y python3 python3-pip python3-venv > /dev/null 2>&1

echo "Creating virtual environment..."
cd /mnt/c/SwellDreams/backend
python3 -m venv venv-wsl

echo "Installing python-matter-server..."
./venv-wsl/bin/pip install python-matter-server cryptography home-assistant-chip-clusters

echo "Matter server installed successfully in WSL!"
echo "To start: wsl /mnt/c/SwellDreams/backend/venv-wsl/bin/python -m matter_server.server"
