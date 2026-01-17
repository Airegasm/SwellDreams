#!/bin/bash

# SwellDreams Update Script for Linux/macOS
# Checks for updates from the git repository

set -e

REPO_URL="https://github.com/saintorphan/SwellDreams.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================"
echo "  SwellDreams Update Script"
echo "========================================"
echo ""

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "[!] Git is not installed."
    echo ""

    # Detect OS and suggest installation
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Installing git via Homebrew..."
        if command -v brew &> /dev/null; then
            brew install git
        else
            echo "Homebrew not found. Installing Homebrew first..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            brew install git
        fi
    elif [[ -f /etc/debian_version ]]; then
        echo "Installing git via apt..."
        sudo apt-get update && sudo apt-get install -y git
    elif [[ -f /etc/redhat-release ]]; then
        echo "Installing git via dnf/yum..."
        if command -v dnf &> /dev/null; then
            sudo dnf install -y git
        else
            sudo yum install -y git
        fi
    elif [[ -f /etc/arch-release ]]; then
        echo "Installing git via pacman..."
        sudo pacman -S --noconfirm git
    else
        echo "Please install git manually and run this script again."
        echo "  Ubuntu/Debian: sudo apt install git"
        echo "  Fedora: sudo dnf install git"
        echo "  macOS: brew install git"
        exit 1
    fi

    echo ""
    echo "[OK] Git installed successfully!"
    echo ""
fi

cd "$SCRIPT_DIR"

# Check if this is a git repository
if [ ! -d ".git" ]; then
    echo "[!] This directory is not a git repository."
    echo "    Initializing and connecting to remote..."
    git init
    git remote add origin "$REPO_URL" 2>/dev/null || git remote set-url origin "$REPO_URL"
    git fetch origin
    git checkout -b master origin/master 2>/dev/null || git reset --hard origin/master
    echo ""
    echo "[OK] Repository initialized!"
else
    echo "[*] Checking for updates..."
    echo ""

    # Fetch latest changes
    git fetch origin

    # Get current and remote commit hashes
    LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "none")
    REMOTE=$(git rev-parse origin/master 2>/dev/null || git rev-parse origin/main 2>/dev/null || echo "none")

    if [ "$LOCAL" = "$REMOTE" ]; then
        echo "[OK] You are already on the latest version!"
        echo "    Commit: ${LOCAL:0:8}"
    else
        echo "[*] Updates available!"
        echo "    Local:  ${LOCAL:0:8}"
        echo "    Remote: ${REMOTE:0:8}"
        echo ""

        # Show what's new
        echo "Changes:"
        git log --oneline HEAD..origin/master 2>/dev/null || git log --oneline HEAD..origin/main 2>/dev/null || echo "  (unable to show changes)"
        echo ""

        read -p "Do you want to update? (y/n): " -n 1 -r
        echo ""

        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo ""
            echo "[*] Updating..."

            # Stash any local changes
            if ! git diff --quiet 2>/dev/null; then
                echo "[*] Stashing local changes..."
                git stash
                STASHED=1
            fi

            # Pull updates
            git pull origin master 2>/dev/null || git pull origin main

            # Restore stashed changes if any
            if [ "$STASHED" = "1" ]; then
                echo "[*] Restoring local changes..."
                git stash pop || echo "[!] Could not restore some local changes. Check 'git stash list'"
            fi

            echo ""
            echo "[OK] Update complete!"

            # Check if package.json changed and offer to reinstall dependencies
            if git diff HEAD@{1} --name-only 2>/dev/null | grep -q "package.json"; then
                echo ""
                echo "[!] package.json was updated."
                read -p "Do you want to reinstall dependencies? (y/n): " -n 1 -r
                echo ""
                if [[ $REPLY =~ ^[Yy]$ ]]; then
                    if [ -f "backend/package.json" ]; then
                        echo "[*] Installing backend dependencies..."
                        cd backend && npm install && cd ..
                    fi
                    if [ -f "frontend/package.json" ]; then
                        echo "[*] Installing frontend dependencies..."
                        cd frontend && npm install && cd ..
                    fi
                    echo "[OK] Dependencies updated!"
                fi
            fi
        else
            echo "Update cancelled."
        fi
    fi
fi

echo ""
echo "========================================"
echo "  Done!"
echo "========================================"
