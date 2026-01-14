# SwellDreams Development Notes

## Build & Restart

Always clean rebuild the frontend and restart the server after making changes.

### MANDATORY: ALWAYS VERIFY SERVER IS RUNNING

After ANY restart, you MUST:
1. Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8889`
2. Confirm it returns `200`
3. If NOT 200, check logs: `tail -20 /tmp/server.log`
4. Tell the user: "Server is live at http://localhost:8889"

DO NOT SKIP THIS STEP. EVER.

### Build Commands

```bash
# From project root - single line version
cd frontend && rm -rf build && npm run build && cd ../backend && (pkill -f "node server.js" || true) && sleep 1 && nohup node server.js > /tmp/server.log 2>&1 & sleep 3 && curl -s -o /dev/null -w "%{http_code}" http://localhost:8889
```

Or step by step:
```bash
# 1. Clean rebuild frontend
cd /home/saintorphan/Projects/SwellDreams/frontend
rm -rf build
npm run build

# 2. Stop old server (|| true prevents exit code 144 error)
pkill -f "node server.js" || true
sleep 1  # Wait for old process to fully terminate

# 3. Start new server
cd /home/saintorphan/Projects/SwellDreams/backend
nohup node server.js > /tmp/server.log 2>&1 &

# 4. VERIFY (MANDATORY - DO NOT SKIP)
sleep 3 && curl -s -o /dev/null -w "%{http_code}" http://localhost:8889
# Must return 200. If not, check: tail -20 /tmp/server.log
```

**Race Condition Fix:** The `sleep 1` after pkill ensures the old process fully terminates before starting the new one. The `|| true` suppresses pkill's exit code 144 (which is normal when terminating a process). The `sleep 3` gives the new server time to fully initialize.

The clean rebuild (`rm -rf build`) is required because incremental builds may not pick up all changes.

**Note:** The backend doesn't need building - it's plain Node.js. Restarting the server picks up backend changes immediately.

## Project Structure

- `frontend/` - React frontend (served by Express from build/)
- `backend/` - Express server (port 8889)
- `backend/services/event-engine.js` - Flow execution engine
- `backend/server.js` - Main server with WebSocket and REST API
