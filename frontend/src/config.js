/**
 * Configuration Constants for SwellDreams Frontend
 * Centralizes all configuration values that were previously hardcoded
 */

// API Configuration
const API_PORT = process.env.REACT_APP_API_PORT || 8889;
const API_HOST = window.location.hostname;

export const API_BASE = `http://${API_HOST}:${API_PORT}`;
export const WS_URL = `ws://${API_HOST}:${API_PORT}`;

// Timing Configuration
export const CONFIG = {
  // Polling intervals
  POLL_INTERVAL_MS: 2500,
  WS_RECONNECT_DELAY_MS: 3000,

  // Request timeouts
  DEFAULT_TIMEOUT_MS: 30000,
  LLM_TIMEOUT_MS: 120000,
  DEVICE_SCAN_TIMEOUT_MS: 15000,

  // UI delays
  TOAST_DURATION_MS: 5000,
  DEBOUNCE_DELAY_MS: 300,
};

// Event Types (used in flow triggers and WebSocket messages)
export const EVENT_TYPES = {
  DEVICE_ON: 'device_on',
  DEVICE_OFF: 'device_off',
  DEVICE_CYCLE_START: 'device_cycle_start',
  DEVICE_CYCLE_STOP: 'device_cycle_stop',
  PLAYER_SPEAKS: 'player_speaks',
  AI_SPEAKS: 'ai_speaks',
  CAPACITY_CHANGE: 'capacity_change',
  CAPACITY_THRESHOLD: 'capacity_threshold',
  SENSATION_CHANGE: 'sensation_change',
  EMOTION_CHANGE: 'emotion_change',
  KEYWORD_DETECTED: 'keyword_detected',
  BUTTON_PRESS: 'button_press',
};

// Node Types (used in flow editor)
export const NODE_TYPES = {
  TRIGGER: 'trigger',
  ACTION: 'action',
  CONDITION: 'condition',
  BRANCH: 'branch',
  DELAY: 'delay',
  PLAYER_CHOICE: 'player_choice',
  SIMPLE_AB: 'simple_ab',
  BUTTON_PRESS: 'button_press',
};

// Action Types (used in flow actions)
export const ACTION_TYPES = {
  SEND_MESSAGE: 'send_message',
  SET_CAPACITY: 'set_capacity',
  MODIFY_CAPACITY: 'modify_capacity',
  SET_SENSATION: 'set_sensation',
  SET_EMOTION: 'set_emotion',
  DEVICE_CONTROL: 'device_control',
  START_CYCLE: 'start_cycle',
  STOP_CYCLE: 'stop_cycle',
  SET_VARIABLE: 'set_variable',
  TRIGGER_FLOW: 'trigger_flow',
};

// WebSocket Message Types
export const WS_MESSAGE_TYPES = {
  // Initialization
  INIT: 'init',

  // Chat messages
  CHAT_MESSAGE: 'chat_message',
  AI_MESSAGE: 'ai_message',
  SYSTEM_MESSAGE: 'system_message',
  AI_MESSAGE_START: 'ai_message_start',
  AI_MESSAGE_CHUNK: 'ai_message_chunk',
  AI_MESSAGE_COMPLETE: 'ai_message_complete',

  // Session state
  SESSION_STATE: 'session_state',
  SETTINGS_UPDATE: 'settings_update',

  // Device state
  DEVICE_STATE_CHANGE: 'device_state_change',
  DEVICE_CYCLE_UPDATE: 'device_cycle_update',

  // Flow events
  FLOW_EXECUTION: 'flow_execution',
  FLOW_MESSAGE: 'flow_message',

  // Player interaction
  PLAYER_CHOICE: 'player_choice',
  PLAYER_CHOICE_RESPONSE: 'player_choice_response',

  // Character
  CHARACTER_SELECTED: 'character_selected',

  // Generation state
  GENERATION_STATE: 'generation_state',

  // Errors
  ERROR: 'error',
};

// Sensation values
export const SENSATIONS = ['normal', 'mild', 'moderate', 'intense', 'overwhelming'];

// Device brands
export const DEVICE_BRANDS = ['tplink', 'govee', 'tuya', 'simulated'];

// Default session state
export const DEFAULT_SESSION_STATE = {
  capacity: 0,
  sensation: 'normal',
  emotion: 'neutral',
  playerName: 'Player',
  characterName: '',
  flowVariables: {},
};

export default CONFIG;
