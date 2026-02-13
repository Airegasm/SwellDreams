#!/bin/sh
# Build chip-tool for Windows in WSL

set -e

echo "=== Starting chip-tool build ==="
echo "Step 1: Checking build tools..."

# Check required tools
which git || (echo "ERROR: git not found" && exit 1)
which python3 || (echo "ERROR: python3 not found" && exit 1)

echo "Step 2: Cloning Matter SDK..."
cd /tmp
if [ ! -d "connectedhomeip" ]; then
    git clone --depth 1 --branch v1.5.0.1 https://github.com/project-chip/connectedhomeip.git
    echo "Cloned Matter SDK"
else
    echo "Matter SDK already exists, using existing clone"
fi

cd connectedhomeip

echo "Step 3: Installing dependencies..."
# Install required packages
sudo apt-get update
sudo apt-get install -y git gcc g++ pkg-config libssl-dev libdbus-1-dev \
     libglib2.0-dev libavahi-client-dev ninja-build python3-venv python3-dev \
     python3-pip unzip libgirepository1.0-dev libcairo2-dev libreadline-dev

echo "Step 4: Bootstrapping build environment..."
source scripts/activate.sh
scripts/bootstrap.sh

echo "Step 5: Building chip-tool..."
# Build for Linux first (simpler than cross-compiling for Windows)
scripts/build/build_examples.sh --target linux-x64-chip-tool build/

echo "Step 6: Copying binary..."
mkdir -p /mnt/c/SwellDreams/backend/bin/chip-tool
cp out/linux-x64-chip-tool/chip-tool /mnt/c/SwellDreams/backend/bin/chip-tool/chip-tool

echo "=== Build complete! ==="
echo "Binary location: /mnt/c/SwellDreams/backend/bin/chip-tool/chip-tool"
echo "You can run it via: wsl /mnt/c/SwellDreams/backend/bin/chip-tool/chip-tool --help"
