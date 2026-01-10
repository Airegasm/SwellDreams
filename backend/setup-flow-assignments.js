const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:8889');

ws.on('open', () => {
  console.log('Connected to SwellDreams server');

  // Character flow assignments
  const characterAssignments = [
    { characterId: 'char-001', flowIds: ['flow-elena-001'] },
    { characterId: 'char-002', flowIds: ['flow-melody-001'] },
    { characterId: 'char-003', flowIds: ['flow-sasha-001'] },
    { characterId: 'char-004', flowIds: ['flow-jinx-001'] },
    { characterId: 'char-005', flowIds: ['flow-vera-001'] },
    { characterId: 'char-006', flowIds: ['flow-collector-001'] },
    { characterId: 'char-007', flowIds: ['flow-bubble-001'] },
    { characterId: 'char-008', flowIds: ['flow-helium-001'] }
  ];

  // Send character flow assignments
  characterAssignments.forEach(({ characterId, flowIds }) => {
    ws.send(JSON.stringify({
      type: 'update_character_flows',
      data: { characterId, flows: flowIds }
    }));
    console.log(`Linked ${flowIds[0]} to ${characterId}`);
  });

  // Assign Progress Milestones to Global
  ws.send(JSON.stringify({
    type: 'update_global_flows',
    data: { flows: ['flow-global-003'] }
  }));
  console.log('Assigned Progress Milestones to Global');

  // Assign Body Awareness Journey to Airegasm persona
  ws.send(JSON.stringify({
    type: 'update_persona_flows',
    data: {
      personaId: 'e5372926-5b37-49e9-8bdb-a0e6d29b2b56',
      flows: ['flow-persona-001']
    }
  }));
  console.log('Assigned Body Awareness Journey to Airegasm persona');

  setTimeout(() => {
    console.log('\nAll flow assignments complete!');
    ws.close();
  }, 1000);
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

ws.on('close', () => {
  console.log('Disconnected from server');
  process.exit(0);
});
