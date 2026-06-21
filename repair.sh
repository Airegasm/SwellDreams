#!/bin/bash
# SwellDreams one-time repair: fixes the "can't update past v6.0" / "tell me who you are"
# problem. Your settings, characters, and personas are NOT touched.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================"
echo "  SwellDreams One-Time Repair"
echo "========================================"
echo ""

if [ ! -d ".git" ]; then
    echo "ERROR: This folder is not a git checkout, so it cannot self-repair."
    echo "Re-download SwellDreams fresh, then copy your old backend/data folder in."
    exit 1
fi

# Give git an identity so nothing fails with "tell me who you are".
git config user.email "swelldreams@localhost"
git config user.name "SwellDreams"

# Untrack build + personal libraries FIRST so the hard reset preserves them.
git rm --cached -r frontend/build >/dev/null 2>&1
git rm --cached backend/data/minigames.json backend/data/checkpoint-profiles.json backend/data/persona-checkpoint-profiles.json backend/data/trigger-sets.json >/dev/null 2>&1

echo "Fetching the latest release..."
if ! git fetch origin release; then
    echo "ERROR: Could not reach GitHub. Check your connection and try again."
    exit 1
fi

echo "Force-syncing to the latest version..."
git reset --hard origin/release

echo ""
echo "Repair complete! Launching SwellDreams..."
echo ""
exec bash ./start.sh
