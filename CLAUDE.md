# SwellDreams Development Notes

## Build & Restart

Always clean rebuild the frontend and restart the server after making changes:

```bash
# From project root
cd frontend && rm -rf build && npm run build && cd ../backend && pkill -f "node server.js"; nohup node server.js > /tmp/server.log 2>&1 &
```

Or step by step:
```bash
# 1. Clean rebuild frontend
cd /home/saintorphan/Projects/SwellDreams/frontend
rm -rf build
npm run build

# 2. Restart backend
cd /home/saintorphan/Projects/SwellDreams/backend
pkill -f "node server.js"
nohup node server.js > /tmp/server.log 2>&1 &
```

The clean rebuild (`rm -rf build`) is required because incremental builds may not pick up all changes.

**Note:** The backend doesn't need building - it's plain Node.js. Restarting the server picks up backend changes immediately.

## Project Structure

- `frontend/` - React frontend (served by Express from build/)
- `backend/` - Express server (port 8889)
- `backend/services/event-engine.js` - Flow execution engine
- `backend/server.js` - Main server with WebSocket and REST API
