// Safety-critical device-tag parsing tests (audit D8). Run with: npm test (node --test).
// ai-device-control is the wall between model output and physical actuation — these pin its
// parsing, rejection, stripping, and gating behavior.
const { test } = require('node:test');
const assert = require('node:assert');
const adc = require('../services/ai-device-control');

test('parses basic on/off commands', () => {
  const cmds = adc.parseDeviceCommands('Here we go [pump on] and later [vibe off].');
  assert.deepStrictEqual(cmds.map(c => [c.device, c.action]), [['pump', 'on'], ['vibe', 'off']]);
});

test('parses flexible whitespace inside brackets', () => {
  const cmds = adc.parseDeviceCommands('[ pump  on ]');
  assert.strictEqual(cmds.length, 1);
  assert.strictEqual(cmds[0].action, 'on');
});

test('parses timed commands and rejects non-positive durations', () => {
  assert.strictEqual(adc.parseDeviceCommands('[pump:timed:30]')[0].duration, 30);
  assert.strictEqual(adc.parseDeviceCommands('[pump:timed:0]').length, 0);
});

test('parses cycle commands and rejects zero on-duration', () => {
  const ok = adc.parseDeviceCommands('[pump:cycle:5:10:3]')[0];
  assert.deepStrictEqual([ok.cycleDuration, ok.cycleInterval, ok.cycles], [5, 10, 3]);
  assert.strictEqual(adc.parseDeviceCommands('[pump:cycle:0:10:3]').length, 0);
});

test('malformed tags never parse as commands', () => {
  assert.strictEqual(adc.parseDeviceCommands('[pump:timed:]').length, 0);
  assert.strictEqual(adc.parseDeviceCommands('[pump:cycle:5]').length, 0);
});

test('stripDeviceCommands removes wellformed and malformed device tags', () => {
  const out = adc.stripDeviceCommands('a [pump on] b [pump:timed:] c');
  assert.ok(!out.includes('[pump'));
  assert.ok(out.includes('a') && out.includes('b') && out.includes('c'));
});

test('CustomDevice tags route to the hook and are stripped from text', async () => {
  const calls = [];
  adc.setCustomDeviceHook((cmd) => { calls.push(cmd); return true; });
  const settings = { globalCharacterControls: { allowLlmDeviceControl: true } };
  const r = await adc.processLlmOutput('Lamp time [CustomDevice:Desk Lamp:on] done', [], {}, { settings, sessionState: { preInflationGateMet: true } });
  assert.ok(!r.text.includes('CustomDevice'));
  assert.deepStrictEqual(calls, [{ name: 'Desk Lamp', action: 'on', duration: undefined }]);
});

test('CustomDevice ON blocked when master switch is off; OFF passes', async () => {
  const calls = [];
  adc.setCustomDeviceHook((cmd) => { calls.push(cmd.action); return true; });
  const settings = { globalCharacterControls: { allowLlmDeviceControl: false } };
  const r = await adc.processLlmOutput('[CustomDevice:Lamp:on] [CustomDevice:Lamp:off]', [], {}, { settings, sessionState: { preInflationGateMet: true } });
  assert.deepStrictEqual(calls, ['off']);
  assert.ok(!r.text.includes('CustomDevice'));
});

test('CustomDevice timed carries seconds; malformed variant is stripped without executing', async () => {
  const calls = [];
  adc.setCustomDeviceHook((cmd) => { calls.push(cmd); return true; });
  const settings = { globalCharacterControls: { allowLlmDeviceControl: true } };
  const r = await adc.processLlmOutput('[CustomDevice:Fan:timed:30] [CustomDevice:broken', [], {}, { settings, sessionState: { preInflationGateMet: true } });
  assert.deepStrictEqual(calls, [{ name: 'Fan', action: 'timed', duration: 30 }]);
  assert.ok(!r.text.includes('[CustomDevice:Fan'));
});

test('per-card AI Pump Control (llmDeviceAccessOff) blocks reinforcement', () => {
  const r = adc.reinforcePumpControl(
    'She switches the pump on and air rushes into her.',
    [{ deviceType: 'PUMP', isPrimaryPump: true, ip: '1.2.3.4' }],
    { preInflationGateMet: true },
    { globalCharacterControls: { allowLlmDeviceControl: true } },
    { llmDeviceAccessOff: true }
  );
  assert.strictEqual(r.reinforced, false);
});

test('pre-inflation gate strips pump-ON commands but allows OFF', async () => {
  const settings = { globalCharacterControls: { allowLlmDeviceControl: true } };
  const r = await adc.processLlmOutput('[pump on] then [pump off]', [], { turnOff: async () => {}, turnOn: async () => {} },
    { settings, sessionState: { preInflationGateMet: false } });
  assert.ok(r.commands.every(c => c.action === 'off'));
});
