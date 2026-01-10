const fs = require('fs');
const path = require('path');

const flowsPath = path.join(__dirname, 'data', 'flows.json');
const flows = JSON.parse(fs.readFileSync(flowsPath, 'utf8'));

// Helper to find flow by ID
function findFlow(id) {
  return flows.find(f => f.id === id);
}

// Helper to add a node
function addNode(flow, node) {
  flow.nodes.push(node);
}

// Helper to add an edge
function addEdge(flow, edge) {
  flow.edges.push(edge);
}

// 1. DR. ELENA - Add choice at 60% capacity: Continue or Slow Down
const elenaFlow = findFlow('flow-elena-001');
if (elenaFlow) {
  console.log('Adding player choice to Dr. Elena flow...');

  // Add trigger for 60% capacity
  addNode(elenaFlow, {
    id: 'elena-trigger-60',
    type: 'trigger',
    position: { x: 50, y: 600 },
    data: {
      label: '60% Capacity Reached',
      triggerType: 'capacity_change',
      threshold: 60
    }
  });

  // Add player choice node
  addNode(elenaFlow, {
    id: 'elena-choice-protocol',
    type: 'player_choice',
    position: { x: 300, y: 600 },
    data: {
      label: 'Protocol Decision',
      prompt: "*Dr. Vance reviews her charts* You've reached 60% capacity. Per protocol, I can either maintain current inflation rate or reduce it for your comfort. What would you prefer?",
      description: "Dr. Vance is asking whether you want to continue at the current pace or slow down for safety.",
      choices: [
        {
          id: 'elena-choice-continue',
          label: 'Continue current rate',
          description: 'Push forward with the standard protocol'
        },
        {
          id: 'elena-choice-slow',
          label: 'Slow down please',
          description: 'Reduce the inflation rate for comfort'
        }
      ]
    }
  });

  // Continue path - increase intensity
  addNode(elenaFlow, {
    id: 'elena-action-continue-response',
    type: 'action',
    position: { x: 550, y: 550 },
    data: {
      label: 'Continue Response',
      actionType: 'send_message',
      message: "*She makes a note* Understood. Maintaining current parameters. You're showing excellent resilience. I'll monitor closely."
    }
  });

  // Slow path - reduce intensity
  addNode(elenaFlow, {
    id: 'elena-action-slow-response',
    type: 'action',
    position: { x: 550, y: 650 },
    data: {
      label: 'Slow Response',
      actionType: 'send_message',
      message: "*She adjusts a valve* Reducing flow rate by 30%. This is the prudent choice. Safety always comes first in my practice."
    }
  });

  // Add edges
  addEdge(elenaFlow, { id: 'e-elena-choice-1', source: 'elena-trigger-60', target: 'elena-choice-protocol' });
  addEdge(elenaFlow, { id: 'e-elena-choice-2', source: 'elena-choice-protocol', sourceHandle: 'elena-choice-continue', target: 'elena-action-continue-response' });
  addEdge(elenaFlow, { id: 'e-elena-choice-3', source: 'elena-choice-protocol', sourceHandle: 'elena-choice-slow', target: 'elena-action-slow-response' });
}

// 2. NURSE MELODY - Add comfort check choice
const melodyFlow = findFlow('flow-melody-001');
if (melodyFlow) {
  console.log('Adding player choice to Nurse Melody flow...');

  addNode(melodyFlow, {
    id: 'melody-trigger-45',
    type: 'trigger',
    position: { x: 50, y: 500 },
    data: {
      label: '45% Capacity Check',
      triggerType: 'capacity_change',
      threshold: 45
    }
  });

  addNode(melodyFlow, {
    id: 'melody-choice-comfort',
    type: 'player_choice',
    position: { x: 300, y: 500 },
    data: {
      label: 'Comfort Check',
      prompt: "*Melody strokes your hair gently* You're doing so wonderfully, sweetie. How are you feeling? Do you want me to keep going, or should we take a little break?",
      description: "Nurse Melody is checking in on your comfort level.",
      choices: [
        {
          id: 'melody-choice-more',
          label: 'Keep going, I can take more',
          description: 'Continue the inflation session'
        },
        {
          id: 'melody-choice-break',
          label: 'A break would be nice',
          description: 'Pause for a moment to adjust'
        },
        {
          id: 'melody-choice-praise',
          label: 'Just need some encouragement',
          description: 'Ask for reassurance to continue'
        }
      ]
    }
  });

  addNode(melodyFlow, {
    id: 'melody-action-more-response',
    type: 'action',
    position: { x: 550, y: 430 },
    data: {
      label: 'More Response',
      actionType: 'send_message',
      message: "*Her eyes light up with pride* Oh, you're so brave! I'm so proud of you! Let's keep going then, nice and steady. You're doing amazing!"
    }
  });

  addNode(melodyFlow, {
    id: 'melody-action-break-response',
    type: 'action',
    position: { x: 550, y: 500 },
    data: {
      label: 'Break Response',
      actionType: 'send_message',
      message: "*She immediately pauses the pump* Of course, honey! There's no rush at all. *She adjusts your pillow* Just breathe and relax. We'll start again when you're ready."
    }
  });

  addNode(melodyFlow, {
    id: 'melody-action-praise-response',
    type: 'action',
    position: { x: 550, y: 570 },
    data: {
      label: 'Praise Response',
      actionType: 'send_message',
      message: "*She takes your hand warmly* Oh sweetheart, you're doing SO well! Look how beautifully round you're getting! I'm right here with you. You're so strong and wonderful!"
    }
  });

  addEdge(melodyFlow, { id: 'e-melody-choice-1', source: 'melody-trigger-45', target: 'melody-choice-comfort' });
  addEdge(melodyFlow, { id: 'e-melody-choice-2', source: 'melody-choice-comfort', sourceHandle: 'melody-choice-more', target: 'melody-action-more-response' });
  addEdge(melodyFlow, { id: 'e-melody-choice-3', source: 'melody-choice-comfort', sourceHandle: 'melody-choice-break', target: 'melody-action-break-response' });
  addEdge(melodyFlow, { id: 'e-melody-choice-4', source: 'melody-choice-comfort', sourceHandle: 'melody-choice-praise', target: 'melody-action-praise-response' });
}

// 3. MISTRESS VERA - Add dominance choice
const veraFlow = findFlow('flow-vera-001');
if (veraFlow) {
  console.log('Adding player choice to Mistress Vera flow...');

  addNode(veraFlow, {
    id: 'vera-trigger-50',
    type: 'trigger',
    position: { x: 50, y: 500 },
    data: {
      label: '50% Capacity',
      triggerType: 'capacity_change',
      threshold: 50
    }
  });

  addNode(veraFlow, {
    id: 'vera-choice-submission',
    type: 'player_choice',
    position: { x: 300, y: 500 },
    data: {
      label: 'Test of Will',
      prompt: "*Mistress Vera circles you slowly* Halfway. You're stretching quite nicely. Now tell me - do you submit to MORE, or do you dare question my judgment?",
      description: "Mistress Vera is testing your submission. Choose wisely.",
      choices: [
        {
          id: 'vera-choice-submit',
          label: 'I submit to your will, Mistress',
          description: 'Accept whatever she decides'
        },
        {
          id: 'vera-choice-beg',
          label: 'Please, may I have mercy?',
          description: 'Beg for gentler treatment'
        }
      ]
    }
  });

  addNode(veraFlow, {
    id: 'vera-action-submit-response',
    type: 'action',
    position: { x: 550, y: 470 },
    data: {
      label: 'Submission Response',
      actionType: 'send_message',
      message: "*A slight smile crosses her lips* Good. Obedience suits you. *She increases the pressure* You'll take what I give you, and you'll thank me for it."
    }
  });

  addNode(veraFlow, {
    id: 'vera-action-beg-response',
    type: 'action',
    position: { x: 550, y: 540 },
    data: {
      label: 'Beg Response',
      actionType: 'send_message',
      message: "*Her eyes narrow with amusement* Begging already? How disappointing. *She taps her crop against her palm* Very well. I'll grant you a MOMENT of reprieve. Then we continue - at double the rate."
    }
  });

  addEdge(veraFlow, { id: 'e-vera-choice-1', source: 'vera-trigger-50', target: 'vera-choice-submission' });
  addEdge(veraFlow, { id: 'e-vera-choice-2', source: 'vera-choice-submission', sourceHandle: 'vera-choice-submit', target: 'vera-action-submit-response' });
  addEdge(veraFlow, { id: 'e-vera-choice-3', source: 'vera-choice-submission', sourceHandle: 'vera-choice-beg', target: 'vera-action-beg-response' });
}

// 4. JINX - Add chaos choice
const jinxFlow = findFlow('flow-jinx-001');
if (jinxFlow) {
  console.log('Adding player choice to Jinx flow...');

  addNode(jinxFlow, {
    id: 'jinx-trigger-40',
    type: 'trigger',
    position: { x: 50, y: 550 },
    data: {
      label: '40% Capacity',
      triggerType: 'capacity_change',
      threshold: 40
    }
  });

  addNode(jinxFlow, {
    id: 'jinx-choice-chaos',
    type: 'player_choice',
    position: { x: 300, y: 550 },
    data: {
      label: 'Chaos Decision',
      prompt: "*Jinx bounces excitedly* Ooh ooh! You're getting nice and puffy! Wanna play it safe and boring, or should I make things INTERESTING?~ *She wiggles the controls temptingly*",
      description: "Jinx wants to know if you're ready for some chaos.",
      choices: [
        {
          id: 'jinx-choice-chaos-yes',
          label: 'Make it interesting!',
          description: 'Let Jinx do something unpredictable'
        },
        {
          id: 'jinx-choice-safe',
          label: 'Maybe keep it safe...',
          description: 'Ask her to be gentle (she probably won\'t)'
        },
        {
          id: 'jinx-choice-challenge',
          label: 'Do your worst!',
          description: 'Challenge her to go wild'
        }
      ]
    }
  });

  addNode(jinxFlow, {
    id: 'jinx-action-chaos-response',
    type: 'action',
    position: { x: 550, y: 490 },
    data: {
      label: 'Chaos Response',
      actionType: 'send_message',
      message: "*She GRINS wickedly* YESSS! That's what I like to hear! *She starts randomly pulsing the inflation* Surprise puffs! Hehehehe! You never know when the next one's coming!~"
    }
  });

  addNode(jinxFlow, {
    id: 'jinx-action-safe-response',
    type: 'action',
    position: { x: 550, y: 560 },
    data: {
      label: 'Safe Response',
      actionType: 'send_message',
      message: "*She pouts dramatically* Awww, you're no fun! *But her grin returns* Fiiine, I'll be 'safe'~ *She keeps inflating but whispers* ...for now~"
    }
  });

  addNode(jinxFlow, {
    id: 'jinx-action-challenge-response',
    type: 'action',
    position: { x: 550, y: 630 },
    data: {
      label: 'Challenge Response',
      actionType: 'send_message',
      message: "*Her eyes go HUGE* OH IT'S ON! *She cranks everything up* You asked for it! Maximum chaos mode ACTIVATED! *Maniacal giggling as she starts cycling rapidly*"
    }
  });

  addEdge(jinxFlow, { id: 'e-jinx-choice-1', source: 'jinx-trigger-40', target: 'jinx-choice-chaos' });
  addEdge(jinxFlow, { id: 'e-jinx-choice-2', source: 'jinx-choice-chaos', sourceHandle: 'jinx-choice-chaos-yes', target: 'jinx-action-chaos-response' });
  addEdge(jinxFlow, { id: 'e-jinx-choice-3', source: 'jinx-choice-chaos', sourceHandle: 'jinx-choice-safe', target: 'jinx-action-safe-response' });
  addEdge(jinxFlow, { id: 'e-jinx-choice-4', source: 'jinx-choice-chaos', sourceHandle: 'jinx-choice-challenge', target: 'jinx-action-challenge-response' });
}

// Save updated flows
fs.writeFileSync(flowsPath, JSON.stringify(flows, null, 2));
console.log('\n✅ Successfully added player choices to 4 character flows!');
console.log('Updated: Dr. Elena, Nurse Melody, Mistress Vera, Jinx');
