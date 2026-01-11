# SwellDreams

An AI-powered interactive roleplay platform with smart device integration.

## Features

### AI Chat
- **Multiple LLM Backends**: Connect to KoboldCpp (local), OpenRouter (cloud), or any OpenAI-compatible API
- **Character System**: Create detailed characters with personalities, scenarios, and custom welcome messages
- **Persona System**: Define player personas for immersive roleplay
- **Streaming Responses**: Real-time token streaming for natural conversation flow
- **Auto Reply**: Toggle automatic AI responses or use guided response mode

### Smart Device Control
- **TP-Link Kasa**: Local network control of smart plugs, switches, and power strips
- **Govee**: Cloud API integration for Govee smart devices
- **Tuya/Smart Life**: Support for Tuya-based devices (Globe, Treatlife, Gosund, Teckin, etc.)
- **Device Actions**: Turn on, turn off, and cycle devices with customizable timing
- **Primary Pump**: Designate a primary device for quick access

### Flow Engine
- **Visual Flow Editor**: Create automation flows with a node-based interface
- **Event Triggers**: Respond to player messages, capacity changes, emotions, and more
- **Conditional Logic**: Branch flows based on variables and state
- **Device Integration**: Control smart devices directly from flows

### Custom Buttons
- **Quick Actions**: Add custom buttons to characters for one-click actions
- **Multiple Action Types**: Send messages, control devices, or trigger flows
- **Device Dropdown**: Select from registered devices or Primary Pump

### Session Management
- **Save/Load Sessions**: Preserve conversation history and state
- **Auto-save**: Automatic session backup
- **Connection Profiles**: Save and switch between LLM configurations

## Requirements

- **Node.js** 18+
- **Python** 3.8+ (for TP-Link Kasa device control)
- Modern web browser

## Quick Start

### Windows
```batch
start.bat
```

### Linux/macOS
```bash
chmod +x start.sh
./start.sh
```

The application will:
1. Install dependencies (first run)
2. Build the frontend
3. Start the backend server (port 8889)
4. Start the frontend server (port 3001)
5. Open your browser to http://localhost:3001

### Stopping
```batch
stop.bat       # Windows
./stop.sh      # Linux/macOS
```

## Configuration

### LLM Setup

#### KoboldCpp (Local)
1. Download and run [KoboldCpp](https://github.com/LostRuins/koboldcpp)
2. Load a GGUF model
3. In SwellDreams: Settings > Model > Endpoint: Kobold
4. Enter URL (default: http://localhost:5001)
5. Click Connect

#### OpenRouter (Cloud)
1. Create account at [openrouter.ai](https://openrouter.ai)
2. Generate an API key
3. In SwellDreams: Settings > Model > Endpoint: OpenRouter
4. Enter API key and click Connect
5. Select a model from the list

### Smart Device Setup

#### TP-Link Kasa
1. Set up devices in the Kasa app
2. In SwellDreams: Settings > Devices > Scan Kasa
3. Add discovered devices

#### Govee
1. Request API key from Govee Home app (Profile > Settings > About Us > Apply for API Key)
2. In SwellDreams: Settings > Devices > Govee > Enter API key
3. Scan for devices

#### Tuya/Smart Life
1. Use the official **Smart Life** app (by Volcano Technology Limited)
2. Create a project at [iot.tuya.com](https://iot.tuya.com)
3. Link your Smart Life account
4. Get your Access ID and Access Secret
5. In SwellDreams: Settings > Devices > Tuya > Enter credentials
6. Add devices using their Device ID from the Tuya IoT Platform

## Project Structure

```
SwellDreams/
├── backend/           # Node.js backend server
│   ├── server.js      # Main server
│   ├── services/      # Device and LLM services
│   └── python/        # Python scripts for Kasa
├── frontend/          # React frontend
│   ├── src/
│   │   ├── components/  # UI components
│   │   ├── context/     # App state management
│   │   └── pages/       # Main pages
│   └── build/         # Production build
├── data/              # User data (settings, characters, sessions)
├── start.sh           # Linux/macOS startup script
├── start.bat          # Windows startup script
└── version.json       # Version info
```

## API Endpoints

### LLM
- `POST /api/llm/test` - Test LLM connection
- `POST /api/llm/generate` - Generate text

### Devices
- `GET /api/devices` - List registered devices
- `POST /api/devices/:ip/on` - Turn device on
- `POST /api/devices/:ip/off` - Turn device off
- `POST /api/devices/:ip/cycle/start` - Start device cycling

### Sessions
- `GET /api/sessions` - List saved sessions
- `POST /api/sessions` - Save session
- `GET /api/sessions/:id` - Load session

## License

Private software. All rights reserved.

## Version

v1.5b "Midnight Oil"
