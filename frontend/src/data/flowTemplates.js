/**
 * Pre-built flow templates for common patterns
 * These can be inserted into the Flow Editor as starting points
 */

export const FLOW_TEMPLATES = [
  {
    id: 'basic-pump-control',
    name: 'Basic Pump Control',
    description: 'Turns pump on when capacity reaches threshold',
    category: 'Device Control',
    icon: '💧',
    nodes: [
      {
        id: 't1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: {
          triggerType: 'capacity_change',
          label: 'Capacity Change'
        }
      },
      {
        id: 'c1',
        type: 'condition',
        position: { x: 0, y: 120 },
        data: {
          conditions: [{ variable: 'capacity', operator: '>=', value: 70, onlyOnce: false }],
          label: 'High Capacity?'
        }
      },
      {
        id: 'a1',
        type: 'action',
        position: { x: 150, y: 240 },
        data: {
          actionType: 'device_on',
          device: 'primary_pump',
          label: 'Turn On Pump'
        }
      }
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'c1' },
      { id: 'e2', source: 'c1', sourceHandle: 'true-0', target: 'a1' }
    ]
  },
  {
    id: 'capacity-routing',
    name: 'Capacity-Based Routing',
    description: 'Routes messages based on capacity level (low/medium/high)',
    category: 'Logic',
    icon: '📊',
    nodes: [
      {
        id: 't1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: {
          triggerType: 'capacity_change',
          label: 'Capacity Change'
        }
      },
      {
        id: 'cm1',
        type: 'capacityMessage',
        position: { x: 0, y: 120 },
        data: {
          label: 'Capacity Router',
          ranges: [
            { min: 0, max: 33, label: 'Low' },
            { min: 34, max: 66, label: 'Medium' },
            { min: 67, max: 100, label: 'High' }
          ]
        }
      },
      {
        id: 'a1',
        type: 'action',
        position: { x: -150, y: 280 },
        data: {
          actionType: 'send_message',
          message: 'Capacity is low.',
          label: 'Low Message'
        }
      },
      {
        id: 'a2',
        type: 'action',
        position: { x: 0, y: 280 },
        data: {
          actionType: 'send_message',
          message: 'Capacity is moderate.',
          label: 'Medium Message'
        }
      },
      {
        id: 'a3',
        type: 'action',
        position: { x: 150, y: 280 },
        data: {
          actionType: 'send_message',
          message: 'Capacity is high!',
          label: 'High Message'
        }
      }
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'cm1' },
      { id: 'e2', source: 'cm1', sourceHandle: 'range-0', target: 'a1' },
      { id: 'e3', source: 'cm1', sourceHandle: 'range-1', target: 'a2' },
      { id: 'e4', source: 'cm1', sourceHandle: 'range-2', target: 'a3' }
    ]
  },
  {
    id: 'loop-with-counter',
    name: 'Loop with Counter',
    description: 'Repeats an action a fixed number of times with a counter',
    category: 'Logic',
    icon: '🔄',
    nodes: [
      {
        id: 't1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: {
          triggerType: 'manual',
          label: 'Start Loop'
        }
      },
      {
        id: 'cnt1',
        type: 'counter',
        position: { x: 0, y: 120 },
        data: {
          variable: 'loopCount',
          operation: 'reset',
          initialValue: 0,
          initializeDefault: true,
          label: 'Reset Counter'
        }
      },
      {
        id: 'l1',
        type: 'loop',
        position: { x: 0, y: 240 },
        data: {
          mode: 'fixed',
          iterations: 5,
          maxIterations: 100,
          label: 'Loop 5 Times'
        }
      },
      {
        id: 'cnt2',
        type: 'counter',
        position: { x: 200, y: 240 },
        data: {
          variable: 'loopCount',
          operation: 'increment',
          amount: 1,
          initializeDefault: true,
          initialValue: 0,
          label: 'Increment'
        }
      },
      {
        id: 'a1',
        type: 'action',
        position: { x: 200, y: 360 },
        data: {
          actionType: 'send_message',
          message: 'Loop iteration [Flow:loopCount]',
          label: 'Loop Action'
        }
      },
      {
        id: 'a2',
        type: 'action',
        position: { x: 0, y: 400 },
        data: {
          actionType: 'send_message',
          message: 'Loop complete! Total iterations: [Flow:loopCount]',
          label: 'Done Message'
        }
      }
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'cnt1' },
      { id: 'e2', source: 'cnt1', target: 'l1' },
      { id: 'e3', source: 'l1', sourceHandle: 'loop', target: 'cnt2' },
      { id: 'e4', source: 'cnt2', target: 'a1' },
      { id: 'e5', source: 'a1', target: 'l1' },
      { id: 'e6', source: 'l1', sourceHandle: 'done', target: 'a2' }
    ]
  },
  {
    id: 'challenge-with-retry',
    name: 'Challenge with Retry',
    description: 'A challenge that allows the player to retry on failure',
    category: 'Gameplay',
    icon: '🎲',
    nodes: [
      {
        id: 't1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: {
          triggerType: 'manual',
          label: 'Start Challenge'
        }
      },
      {
        id: 'ch1',
        type: 'challenge',
        position: { x: 0, y: 120 },
        data: {
          challengeType: 'coin_flip',
          label: 'Coin Flip Challenge'
        }
      },
      {
        id: 'a1',
        type: 'action',
        position: { x: 150, y: 240 },
        data: {
          actionType: 'send_message',
          message: 'You won the challenge!',
          label: 'Win Message'
        }
      },
      {
        id: 'pc1',
        type: 'playerChoice',
        position: { x: -150, y: 240 },
        data: {
          prompt: 'You lost! Would you like to try again?',
          options: [
            { text: 'Try Again', value: 'retry' },
            { text: 'Give Up', value: 'quit' }
          ],
          label: 'Retry Choice'
        }
      },
      {
        id: 'a2',
        type: 'action',
        position: { x: -150, y: 400 },
        data: {
          actionType: 'send_message',
          message: 'Better luck next time.',
          label: 'Quit Message'
        }
      }
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'ch1' },
      { id: 'e2', source: 'ch1', sourceHandle: 'win', target: 'a1' },
      { id: 'e3', source: 'ch1', sourceHandle: 'lose', target: 'pc1' },
      { id: 'e4', source: 'pc1', sourceHandle: 'option-0', target: 'ch1' },
      { id: 'e5', source: 'pc1', sourceHandle: 'option-1', target: 'a2' }
    ]
  },
  {
    id: 'timed-event',
    name: 'Timed Event Sequence',
    description: 'Triggers events at specific session time intervals',
    category: 'Time-Based',
    icon: '⏱️',
    nodes: [
      {
        id: 't1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: {
          triggerType: 'message_received',
          label: 'On Message'
        }
      },
      {
        id: 'st1',
        type: 'sessionTimer',
        position: { x: 0, y: 120 },
        data: {
          mode: 'check',
          duration: 5,
          unit: 'minutes',
          onlyOnce: true,
          label: '5 Min Check'
        }
      },
      {
        id: 'a1',
        type: 'action',
        position: { x: 150, y: 240 },
        data: {
          actionType: 'send_message',
          message: 'You have been chatting for 5 minutes!',
          label: 'Time Milestone'
        }
      }
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'st1' },
      { id: 'e2', source: 'st1', sourceHandle: 'true', target: 'a1' }
    ]
  },
  {
    id: 'switch-routing',
    name: 'Switch-Based Routing',
    description: 'Routes flow based on a variable value using switch/case',
    category: 'Logic',
    icon: '⑃',
    nodes: [
      {
        id: 't1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: {
          triggerType: 'manual',
          label: 'Start'
        }
      },
      {
        id: 'act1',
        type: 'action',
        position: { x: 0, y: 100 },
        data: {
          actionType: 'declare_variable',
          name: 'choice',
          value: 'option1',
          label: 'Set Choice'
        }
      },
      {
        id: 'sw1',
        type: 'switch',
        position: { x: 0, y: 220 },
        data: {
          variable: 'custom',
          customVariable: 'choice',
          cases: [
            { value: 'option1' },
            { value: 'option2' },
            { value: 'option3' }
          ],
          includeDefault: true,
          label: 'Route by Choice'
        }
      },
      {
        id: 'a1',
        type: 'action',
        position: { x: 200, y: 220 },
        data: {
          actionType: 'send_message',
          message: 'You chose option 1',
          label: 'Option 1'
        }
      },
      {
        id: 'a2',
        type: 'action',
        position: { x: 200, y: 280 },
        data: {
          actionType: 'send_message',
          message: 'You chose option 2',
          label: 'Option 2'
        }
      },
      {
        id: 'a3',
        type: 'action',
        position: { x: 200, y: 340 },
        data: {
          actionType: 'send_message',
          message: 'You chose option 3',
          label: 'Option 3'
        }
      },
      {
        id: 'a4',
        type: 'action',
        position: { x: 0, y: 420 },
        data: {
          actionType: 'send_message',
          message: 'Unknown option selected',
          label: 'Default'
        }
      }
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'act1' },
      { id: 'e2', source: 'act1', target: 'sw1' },
      { id: 'e3', source: 'sw1', sourceHandle: 'case-0', target: 'a1' },
      { id: 'e4', source: 'sw1', sourceHandle: 'case-1', target: 'a2' },
      { id: 'e5', source: 'sw1', sourceHandle: 'case-2', target: 'a3' },
      { id: 'e6', source: 'sw1', sourceHandle: 'default', target: 'a4' }
    ]
  },
  {
    id: 'device-cycle',
    name: 'Device Cycling',
    description: 'Cycles a device on and off at intervals',
    category: 'Device Control',
    icon: '⚡',
    nodes: [
      {
        id: 't1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: {
          triggerType: 'manual',
          label: 'Start Cycle'
        }
      },
      {
        id: 'a1',
        type: 'action',
        position: { x: 0, y: 120 },
        data: {
          actionType: 'start_cycle',
          device: 'primary_pump',
          duration: 5,
          interval: 10,
          cycles: 3,
          untilType: 'forever',
          label: 'Cycle Pump'
        }
      },
      {
        id: 'a2',
        type: 'action',
        position: { x: -100, y: 280 },
        data: {
          actionType: 'send_message',
          message: 'Cycle started!',
          label: 'Started'
        }
      },
      {
        id: 'a3',
        type: 'action',
        position: { x: 100, y: 280 },
        data: {
          actionType: 'send_message',
          message: 'Cycle complete!',
          label: 'Completed'
        }
      }
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'a1' },
      { id: 'e2', source: 'a1', sourceHandle: 'immediate', target: 'a2' },
      { id: 'e3', source: 'a1', sourceHandle: 'completion', target: 'a3' }
    ]
  },
  {
    id: 'player-choice-tree',
    name: 'Player Choice Tree',
    description: 'A branching dialogue tree with player choices',
    category: 'Gameplay',
    icon: '❓',
    nodes: [
      {
        id: 't1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: {
          triggerType: 'manual',
          label: 'Start Dialogue'
        }
      },
      {
        id: 'a1',
        type: 'action',
        position: { x: 0, y: 100 },
        data: {
          actionType: 'send_message',
          message: 'Welcome! What would you like to do?',
          label: 'Welcome'
        }
      },
      {
        id: 'pc1',
        type: 'playerChoice',
        position: { x: 0, y: 220 },
        data: {
          prompt: 'Choose your path:',
          options: [
            { text: 'Explore', value: 'explore' },
            { text: 'Rest', value: 'rest' },
            { text: 'Leave', value: 'leave' }
          ],
          label: 'Main Choice'
        }
      },
      {
        id: 'a2',
        type: 'action',
        position: { x: -150, y: 380 },
        data: {
          actionType: 'send_message',
          message: 'You venture forth into the unknown...',
          label: 'Explore'
        }
      },
      {
        id: 'a3',
        type: 'action',
        position: { x: 0, y: 380 },
        data: {
          actionType: 'send_message',
          message: 'You take a moment to rest and recover.',
          label: 'Rest'
        }
      },
      {
        id: 'a4',
        type: 'action',
        position: { x: 150, y: 380 },
        data: {
          actionType: 'send_message',
          message: 'You decide to leave. Goodbye!',
          label: 'Leave'
        }
      }
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'a1' },
      { id: 'e2', source: 'a1', target: 'pc1' },
      { id: 'e3', source: 'pc1', sourceHandle: 'option-0', target: 'a2' },
      { id: 'e4', source: 'pc1', sourceHandle: 'option-1', target: 'a3' },
      { id: 'e5', source: 'pc1', sourceHandle: 'option-2', target: 'a4' }
    ]
  }
];

// Categories for organizing templates in the UI
export const TEMPLATE_CATEGORIES = [
  { id: 'device-control', name: 'Device Control', icon: '⚡' },
  { id: 'logic', name: 'Logic', icon: '⑃' },
  { id: 'gameplay', name: 'Gameplay', icon: '🎮' },
  { id: 'time-based', name: 'Time-Based', icon: '⏱️' }
];

export default FLOW_TEMPLATES;
