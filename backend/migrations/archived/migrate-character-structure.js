const fs = require('fs');
const path = require('path');

const charactersPath = path.join(__dirname, 'data', 'characters.json');
const characters = JSON.parse(fs.readFileSync(charactersPath, 'utf8'));

console.log('Migrating character structure to support multiple welcome messages and scenarios...\n');

characters.forEach(char => {
  let updated = false;

  // Migrate firstMessage to welcomeMessages array
  if (char.firstMessage && !char.welcomeMessages) {
    char.welcomeMessages = [{
      id: 'wm-1',
      text: char.firstMessage,
      llmEnhanced: false
    }];
    char.activeWelcomeMessageId = 'wm-1';
    delete char.firstMessage;
    updated = true;
    console.log(`✓ Migrated firstMessage for ${char.name}`);
  } else if (!char.welcomeMessages) {
    char.welcomeMessages = [{
      id: 'wm-1',
      text: '',
      llmEnhanced: false
    }];
    char.activeWelcomeMessageId = 'wm-1';
    updated = true;
    console.log(`✓ Created empty welcomeMessages for ${char.name}`);
  }

  // Migrate scenario to scenarios array
  if (char.scenario && !char.scenarios) {
    char.scenarios = [{
      id: 'sc-1',
      text: char.scenario
    }];
    char.activeScenarioId = 'sc-1';
    delete char.scenario;
    updated = true;
    console.log(`✓ Migrated scenario for ${char.name}`);
  } else if (!char.scenarios) {
    char.scenarios = [{
      id: 'sc-1',
      text: ''
    }];
    char.activeScenarioId = 'sc-1';
    updated = true;
    console.log(`✓ Created empty scenarios for ${char.name}`);
  }

  if (updated) {
    console.log(`  Updated ${char.name} structure\n`);
  }
});

// Save updated characters
fs.writeFileSync(charactersPath, JSON.stringify(characters, null, 2));
console.log('✅ Character structure migration complete!');
console.log('All characters now support multiple welcome messages and scenarios.');
