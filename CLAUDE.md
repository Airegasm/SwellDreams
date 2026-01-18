# SwellDreams - Claude Code Instructions

## Version Management

When incrementing the version, update ALL of these locations:

| File | Field | Example |
|------|-------|---------|
| `frontend/package.json` | `"version"` | `"2.5.4"` |
| `backend/package.json` | `"version"` | `"2.5.4"` |
| `version.json` | `"version"` | `"2.5.4"` |
| `frontend/src/App.js` | version-badge span | `v2.5.4` |

After updating versions, rebuild the frontend:
```bash
cd frontend && npm run build
```

## Project Structure

```
SwellDreams/
├── backend/
│   ├── server.js          # Main Express server
│   ├── services/          # Device services (Tuya, Govee, Kasa, Tapo)
│   ├── data/
│   │   ├── chars/
│   │   │   ├── default/   # Built-in characters (committed)
│   │   │   └── custom/    # User characters (gitignored)
│   │   └── flows/         # Flow JSON files
│   └── scripts/           # Utility scripts
├── frontend/
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Page components
│   │   └── context/       # React context (AppContext.js)
│   └── build/             # Production build
└── version.json           # App version and codename
```

## Key Files

- **backend/server.js** - Main server, API routes, WebSocket handling
- **backend/services/device-service.js** - Device abstraction layer
- **frontend/src/context/AppContext.js** - Global state and API methods
- **frontend/src/pages/FlowEditor.js** - Visual flow editor
- **frontend/src/config.js** - Frontend configuration constants

## Built-in Data

Characters and flows in these locations are committed to the repo:
- `backend/data/chars/default/` - Luna, Iris, Vex, Scarlett
- `backend/data/flows/flow-*.json` - Character and global flows

Index files (`chars-index.json`, `flows-index.json`) are gitignored and auto-generated on server startup.

## Device Brands

Supported smart device integrations:
- **Kasa** (TP-Link Kasa) - Local network control
- **Tapo** (TP-Link Tapo) - Python bridge via `tapo` library
- **Tuya** - Cloud API with caching
- **Govee** - Cloud API
- **Simulated** - Testing without hardware

## Common Tasks

### Adding a new device brand
1. Create `backend/services/{brand}-service.js`
2. Add routing in `backend/services/device-service.js`
3. Add API endpoints in `backend/server.js`
4. Add frontend methods in `AppContext.js`
5. Add UI in `frontend/src/components/settings/DeviceTab.js`

### Adding a new flow node type
1. Create node component in `frontend/src/components/flow/nodes/`
2. Register in `nodeTypes` object in `FlowEditor.js`
3. Add template in `NODE_TEMPLATES` in `FlowEditor.js`
4. Add execution logic in `backend/services/event-engine.js`
5. Document in `frontend/src/components/help/FlowTab.js`
