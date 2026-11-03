import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useError } from '../../context/ErrorContext';
import { API_BASE } from '../../config';
import { apiFetch } from '../../utils/api';
import './SettingsTabs.css';
import './CharacterCreator.css';

// Character Creator — pick a handful of story parameters, press Generate, and the LLM writes a
// complete, cohesive card (description, personality, scenario, welcome, example dialogue) while
// the creator fills every SETTING deterministically from the choices (pump target/control,
// dispositions, attributes, author's note, checkpoint profile with sequential escalation steps).
// All text uses [Player] / [Gender] so the card works with any persona. Generation is orchestrated
// here, one LLM call per field, so progress is visible and the run is cancellable.

const GENDERS = [
  { value: 'female', label: 'Female', pronouns: 'she/her' },
  { value: 'male', label: 'Male', pronouns: 'he/him' },
  { value: 'nonbinary', label: 'Non-Binary', pronouns: 'they/them' },
];

const PERSONALITIES = ['Nice', 'Neutral', 'Mean', 'Sadistic'];

const INFLATED = [
  { value: 'player', label: 'Player' },
  { value: 'character', label: 'Character' },
  { value: 'both', label: 'Both' },
  { value: 'mix', label: 'Random Mix' },
];

const OPERATORS = [
  { value: 'player', label: 'Player' },
  { value: 'character', label: 'Character' },
  { value: 'story', label: 'Story Char' },
  { value: 'shared', label: 'Both (shared)' },
  { value: 'mix', label: 'Random Mix' },
];
// Multi-Char relabels: "Character" covers every group member, "Both" becomes "All".
const inflatedLabel = (x, multi) => (multi ? ({ character: 'Characters', both: 'All' }[x.value] || x.label) : x.label);
const operatorLabel = (x, multi) => (multi && x.value === 'shared' ? 'All (shared)' : x.label);

const INFLATION_TYPES = [
  { value: 'air', label: 'Air (Anal Infusion)', prose: 'air pumped in through an anal nozzle (anal air infusion)' },
  { value: 'enema', label: 'Enema', prose: 'a warm-water enema delivered from an enema bag and tube' },
  { value: 'fluid', label: 'Fluid Pump (Anal)', prose: 'liquid driven in by a fluid pump through an anal nozzle' },
];

const PLOTS = [
  { value: 'initiation', label: 'Initiation', prose: 'an initiation — whoever is being inflated must endure it as a rite to be accepted into a group, club, order, or circle' },
  { value: 'inquisition', label: 'Inquisition', prose: 'an inquisition — the inflation is used as interrogation, escalating until a confession or secret is given up' },
  { value: 'gratification', label: 'Sexual Gratification', prose: 'sexual gratification — the inflation is an erotic, kink-driven act done for pleasure and arousal' },
  { value: 'execution', label: 'Public Execution', prose: 'a public execution — the inflation is a sentence carried out as a spectacle in front of an audience or crowd' },
  { value: 'punishment', label: 'Punishment', prose: 'a punishment — the inflation is discipline for a broken rule, debt, or wrongdoing' },
  { value: 'challenge', label: 'Challenge', prose: 'a challenge — a bet, dare, contest, or endurance game with stakes for winning or losing' },
];

const LOCATIONS = [
  { value: 'house', label: 'Suburban House', prose: 'a quiet suburban house — a cozy living room with the curtains drawn' },
  { value: 'dungeon', label: 'Stone Dungeon', prose: 'a damp, torch-lit stone dungeon with chains, a padded bench, and heavy iron doors' },
  { value: 'party', label: 'House Party', prose: 'a loud house party — music thumping downstairs, a locked upstairs bedroom' },
  { value: 'clinic', label: 'Private Clinic', prose: 'an after-hours private medical clinic — exam table, sterile lights, humming equipment' },
  { value: 'lab', label: 'Research Lab', prose: 'a secretive research laboratory full of monitors, gauges, and clipboards' },
  { value: 'spa', label: 'Luxury Spa', prose: 'an exclusive luxury spa — steam, soft towels, a private treatment room' },
  { value: 'gym', label: 'Gym Locker Room', prose: 'an empty gym locker room after closing — tiled walls, benches, echoing showers' },
  { value: 'mansion', label: 'Haunted Mansion', prose: 'a creaking, candle-lit haunted mansion on a stormy night' },
  { value: 'cabin', label: 'Mountain Cabin', prose: 'a remote snowed-in mountain cabin with a crackling fireplace' },
  { value: 'office', label: 'Office After Hours', prose: 'a corporate office after hours — dim cubicles, a corner office with a big desk' },
  { value: 'spaceship', label: 'Starship Medbay', prose: 'the medbay of a deep-space starship — sleek panels, alarms, the hum of engines' },
  { value: 'circus', label: 'Traveling Circus', prose: 'a backstage tent at a traveling carnival circus, lit by strings of bulbs' },
];

// First + last names per gender — picked locally so names stay varied (LLMs collapse to "Elara").
const NAMES = {
  female: {
    first: ['Mara', 'Delia', 'Sloane', 'Ingrid', 'Talia', 'Brynn', 'Celeste', 'Noor', 'Juniper', 'Vivian', 'Rosalind', 'Kenna', 'Odette', 'Priya', 'Marisol', 'Hazel', 'Ines', 'Margot', 'Saoirse', 'Yuki', 'Daphne', 'Lorelei', 'Nadia', 'Greta', 'Esme', 'Tamsin', 'Willa', 'Camille', 'Freya', 'Lucia'],
  },
  male: {
    first: ['Dorian', 'Silas', 'Marcus', 'Theo', 'Rafael', 'Callum', 'Jonah', 'Viktor', 'Elias', 'Malik', 'Desmond', 'Hugo', 'Kenji', 'Lucan', 'Ronan', 'Felix', 'Anders', 'Mateo', 'Grant', 'Isaac', 'Bastian', 'Corwin', 'Darius', 'Emmett', 'Gideon', 'Jasper', 'Nikolai', 'Oren', 'Soren', 'Wade'],
  },
  nonbinary: {
    first: ['Rowan', 'Sage', 'Quinn', 'Ash', 'Robin', 'Ellis', 'Marlowe', 'Indigo', 'Arden', 'Shay', 'Wren', 'Lake', 'Remy', 'Sol', 'Emery', 'Kit', 'Phoenix', 'River', 'Briar', 'Onyx', 'Jules', 'Lux', 'Nico', 'Rain', 'Tatum', 'Vesper', 'Zephyr', 'Morgan', 'Avery', 'Echo'],
  },
};
const LAST_NAMES = ['Voss', 'Hale', 'Marlow', 'Draven', 'Okafor', 'Lindqvist', 'Castellan', 'Reyes', 'Thorne', 'Ashby', 'Kincaid', 'Moreau', 'Sato', 'Blackwood', 'Varga', 'Delacroix', 'Quill', 'Navarro', 'Holloway', 'Stroud', 'Fairfax', 'Mercer', 'Vale', 'Ibarra', 'Winslow', 'Corvin', 'Haldane', 'Petrov', 'Sinclair', 'Rook'];

const CHECKPOINT_LEVELS = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'thorough', label: 'Thorough' },
];

const RANGE_KEYS = ['1-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71-80', '81-90', '91-100', '100+'];
const RANGE_BOUNDS = {
  '1-10': [0, 10], '11-20': [11, 20], '21-30': [21, 30], '31-40': [31, 40], '41-50': [41, 50],
  '51-60': [51, 60], '61-70': [61, 70], '71-80': [71, 80], '81-90': [81, 90], '91-100': [91, 100], '100+': [101, 120],
};
// Narrative stage per range — keeps the generated beats escalating in order instead of every
// range re-describing the same thing.
const RANGE_STAGE = {
  '1-10': 'the very beginning — setup, the first moments of the inflation, anticipation',
  '11-20': 'first real sensations — a faint fullness, the first reactions',
  '21-30': 'visible change begins — a soft roundness, the reality setting in',
  '31-40': 'clearly rounding — pressure building, the dynamic between the characters sharpening',
  '41-50': 'the halfway point — firmly swollen, a turning point in the scene',
  '51-60': 'heavy and taut — real pressure, the stakes rising',
  '61-70': 'drum-tight — strain, laboured breathing, emotions running high',
  '71-80': 'hugely distended — genuine struggle, the scene intensifying',
  '81-90': 'near the limit — creaking, desperate, the edge in sight',
  '91-100': 'absolute capacity — the climax of the scene',
  '100+': 'beyond capacity — the final, explosive moment',
};
// Which ranges get sequential steps, and how many steps each, per level.
const LEVEL_PLAN = {
  minimal: { ranges: ['21-30', '51-60', '81-90', '91-100'], steps: 1 },
  balanced: { ranges: ['1-10', '21-30', '41-50', '61-70', '81-90', '91-100'], steps: 2 },
  thorough: { ranges: ['1-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71-80', '81-90', '91-100'], steps: 3 },
};

// Fallback range themes if the shipped presets can't be fetched.
const FALLBACK_THEMES = {
  '1-10': 'Inflation has barely begun — the belly looks essentially normal. Keep physical description minimal.',
  '11-20': 'A slight, soft fullness — like after a big meal. One brief physical mention at most.',
  '21-30': 'Mild, visible bloating begins — a gentle roundness, the waistband snug.',
  '31-40': 'Clearly rounding now — a noticeable dome, skin starting to feel taut.',
  '41-50': 'Firmly swollen and round — obvious inflation, tightness building, about half full.',
  '51-60': 'Heavily rounded and taut — the belly dominates now, real pressure building.',
  '61-70': 'Very full and drum-tight — stretched skin, laboured movement.',
  '71-80': 'Hugely distended — skin shiny and stretched, genuine strain.',
  '81-90': 'Massive and straining — near the limit, difficulty breathing deeply.',
  '91-100': 'At absolute capacity — impossibly full, the climax.',
  '100+': 'Beyond full — over-inflated, dangerously tight.',
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const uid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- Deterministic settings maps (personality → dispositions/attributes) ----
const ATTRIBUTES = {
  Nice: { dominant: 10, submissive: 25, sadistic: 0, psychopathic: 0, sensual: 40, sexual: 15 },
  Neutral: { dominant: 25, submissive: 15, sadistic: 5, psychopathic: 0, sensual: 20, sexual: 15 },
  Mean: { dominant: 60, submissive: 0, sadistic: 35, psychopathic: 5, sensual: 15, sexual: 15 },
  Sadistic: { dominant: 80, submissive: 0, sadistic: 85, psychopathic: 25, sensual: 20, sexual: 20 },
};
const EMOTION = { Nice: 'happy', Neutral: 'curious', Mean: 'mischievous', Sadistic: 'dominant' };
const INFLATE_OTHERS = { Nice: 'curious', Neutral: 'neutral', Mean: 'eager', Sadistic: 'obsessed' };
const POP_OTHERS_BURST = { Nice: 'willing', Neutral: 'careless', Mean: 'eager', Sadistic: 'sadistic' };
const POP_OTHERS_SAFE = { Nice: 'avoidant', Neutral: 'avoidant', Mean: 'careless', Sadistic: 'curious' };
const SELF_DESIRE = { Nice: 'curious', Neutral: 'neutral', Mean: 'reluctant', Sadistic: 'eager' };
const SELF_POP_BURST = { Nice: 'anxious', Neutral: 'resigned', Mean: 'dreading', Sadistic: 'curious' };
const SELF_POP_SAFE = { Nice: 'anxious', Neutral: 'anxious', Mean: 'terrified', Sadistic: 'indifferent' };
const TONE = {
  Nice: 'warm, kind, gentle and reassuring — caring about the other person even while the inflation happens',
  Neutral: 'matter-of-fact, calm and detached — professional, curious, neither cruel nor tender',
  Mean: 'mocking, teasing, condescending and bratty — enjoys the other person\'s discomfort and embarrassment',
  Sadistic: 'cruel, cold and sadistic — takes real pleasure in pushing past limits, savours fear and strain',
};

// Strip common LLM preamble/wrapping and normalise placeholders.
function cleanText(raw, { personaName, charName } = {}) {
  let t = String(raw || '').trim();
  t = t.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '');
  t = t.replace(/^(sure|okay|certainly|here(?:'s| is| are))[^\n]*:\s*\n+/i, '');
  t = t.replace(/^(description|personality|scenario|greeting|welcome message)\s*:\s*/i, '');
  t = t.replace(/\{\{user\}\}/gi, '[Player]').replace(/\{\{char\}\}/gi, charName || '[Char]');
  t = t.replace(/\[(?:user|you|player name|persona)\]/gi, '[Player]');
  if (personaName && personaName.length > 1) t = t.replace(new RegExp(`\\b${escapeRe(personaName)}\\b`, 'g'), '[Player]');
  t = t.replace(/^"([^"]*)"$/, '$1').trim(); // only a fully-quoted single span
  return t;
}

// Roleplay formatting: narration/actions in *asterisks*, dialogue in "quotes". Models drop the
// asterisks, or wrap whole paragraphs (quotes included) in one pair — so always rebuild it: strip
// every asterisk, then wrap each non-dialogue span. Correctly formatted text comes out unchanged.
function enforceRpFormat(text, speakerNames = []) {
  const labelRe = speakerNames.length ? new RegExp(`((?:^|\\s)(?:${speakerNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}):\\s)`) : null;
  return String(text || '').split(/\n/).map((para) => {
    const plain = para.replace(/\*+/g, '');
    if (!plain.trim()) return plain;
    // Group lines ("Mara: *smirks* "Hi." Dorian: ...") — format each speaker's chunk separately
    // so the name labels stay bare.
    if (labelRe && labelRe.test(plain)) {
      return plain.split(labelRe).map(chunk => (labelRe.test(chunk) || !chunk.trim() ? chunk : enforceRpFormat(chunk))).join('');
    }
    return plain.split(/("[^"]*"|“[^”]*”)/).map((seg) => {
      if (!seg || /^["“]/.test(seg)) return seg;
      const m = seg.match(/^(\s*)([\s\S]*?)(\s*)$/);
      const body = m[2];
      if (!body || !/[A-Za-z]/.test(body)) return seg;
      return `${m[1]}*${body}*${m[3]}`;
    }).join('');
  }).join('\n');
}

// Runtime wrapper for a generated checkpoint beat: the step text was written blind at creation time,
// so tell the model to fold it into what is ACTUALLY happening rather than jump to a new scene.
// Models ignore "no dialogue / one beat" rules, so enforce it: drop quoted speech and asterisks,
// keep the first sentence, cap ~25 words. A beat must be a direction, not a pre-written scene.
function sanitizeBeat(raw) {
  let t = String(raw || '').replace(/"[^"]*"|“[^”]*”/g, ' ').replace(/\*/g, '').replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  t = (t.match(/^[^.!?]*[.!?]?/) || [t])[0].trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 25) t = words.slice(0, 25).join(' ').replace(/[,;:]$/, '');
  t = t.replace(/[,;:\s]+$/, '');
  if (t && !/[.!?]$/.test(t)) t += '.';
  // Narrated pump control would contradict the real device state — drop those beats.
  if (/\b(paus|stop|halt|switch|turn|crank|increas|decreas|adjust|speed|slow|dial|open|clos)\w*\b[^.]{0,40}\b(pump|valve|flow|nozzle|machine|pressure)/i.test(t)) return '';
  return words.length >= 4 ? t : '';
}

// Hard length cap for always-in-context fields (models overshoot "N sentences").
function trimToLength(text, maxSentences, maxWords) {
  const sentences = String(text || '').replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+["”']?|[^.!?]+$/g) || [];
  let out = sentences.slice(0, maxSentences).map(x => x.trim()).join(' ');
  const words = out.split(/\s+/);
  if (words.length > maxWords) out = words.slice(0, maxWords).join(' ').replace(/[,;:]$/, '') + '.';
  return out;
}

function beatContext(beat) {
  return `Continue directly from the last message — keep the current moment, positions, and conversation consistent; do not skip ahead, restart, or change the setting. As part of that natural continuation, work in this beat: ${beat}`;
}

function CharacterCreatorTab() {
  const { settings, api, personas, sendWsMessage } = useApp();
  const { showError, showSuccess } = useError();
  const navigate = useNavigate();

  const [gender, setGender] = useState('female');
  const [personality, setPersonality] = useState('Nice');
  const [inflated, setInflated] = useState('player');
  const [inflatedSurprise, setInflatedSurprise] = useState(false);
  const [operator, setOperator] = useState('character');
  const [operatorSurprise, setOperatorSurprise] = useState(false);
  const [types, setTypes] = useState(['air']);
  const [typesSurprise, setTypesSurprise] = useState(false);
  const [location, setLocation] = useState('house');
  const [plot, setPlot] = useState('challenge');
  const [plotSurprise, setPlotSurprise] = useState(true);
  const [locationSurprise, setLocationSurprise] = useState(false);
  const [createCheckpoints, setCreateCheckpoints] = useState(true);
  const [checkpointLevel, setCheckpointLevel] = useState('balanced');
  const [enforceBursting, setEnforceBursting] = useState(false);
  const [welcomeCount, setWelcomeCount] = useState(1);
  const [multiChar, setMultiChar] = useState(false);
  const [extraCount, setExtraCount] = useState(1);
  const [guidance, setGuidance] = useState('');
  const [randomizeTargets, setRandomizeTargets] = useState(false);
  const [randomizeOperators, setRandomizeOperators] = useState(false);
  const [newScenarioEach, setNewScenarioEach] = useState(false);

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]); // [{ label, status: 'pending'|'active'|'done'|'error' }]
  const cancelRef = useRef(false);
  const presetsRef = useRef(null);

  useEffect(() => {
    apiFetch(`${API_BASE}/api/checkpoint-presets`).then(d => { presetsRef.current = d?.presets || []; }).catch(() => {});
  }, []);

  const activePersona = personas?.find(p => p.id === settings?.activePersonaId);
  const llmDeviceControlOff = !settings?.globalCharacterControls?.allowLlmDeviceControl;

  const toggleType = (v) => setTypes(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));

  const setStep = (idx, status) => setSteps(prev => prev.map((s, i) => (i === idx ? { ...s, status } : s)));

  // One LLM call with cancel + rate-limit (429) backoff.
  const llm = async (prompt, maxTokens) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (cancelRef.current) throw new Error('cancelled');
      try {
        const r = await api.generateText({ prompt, maxTokens });
        if (cancelRef.current) throw new Error('cancelled');
        return r?.text || '';
      } catch (e) {
        if (e.message === 'cancelled') throw e;
        const msg = String(e?.message || '');
        if ((e?.status === 429 || /too many/i.test(msg)) && attempt < 3) { await sleep(20000); continue; }
        if (attempt < 1) { await sleep(1500); continue; } // one quick retry for transient failures
        throw e;
      }
    }
    return '';
  };

  // Abort: flag the run AND kill the in-flight LLM request server-side (same message the chat's
  // stop button sends), so it stops now instead of after the current call finishes.
  const handleAbort = () => {
    cancelRef.current = true;
    try { sendWsMessage?.('cancel_generation', {}); } catch (e) { /* socket down — the flag still stops the run */ }
  };

  const handleGenerate = async () => {
    if (running) { handleAbort(); return; }

    // ---- Resolve choices (Surprise Me picks at random) ----
    const g = GENDERS.find(x => x.value === gender) || GENDERS[0];
    const who = inflatedSurprise ? pick(INFLATED).value : inflated;
    const op = operatorSurprise ? pick(OPERATORS).value : operator;
    let typeVals = typesSurprise
      ? [...INFLATION_TYPES].sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 2)).map(t => t.value)
      : types;
    if (!typeVals.length) typeVals = ['air'];
    const loc = LOCATIONS.find(l => l.value === (locationSurprise ? pick(LOCATIONS).value : location)) || LOCATIONS[0];
    const methods = INFLATION_TYPES.filter(t => typeVals.includes(t.value));
    const methodProse = methods.map(m => m.prose).join(', and/or ');
    const methodLabel = methods.map(m => m.label).join(' + ');

    const charName = `${pick(NAMES[g.value].first)} ${pick(LAST_NAMES)}`;
    const personaName = activePersona?.displayName || '';
    const personaPronouns = activePersona?.pronouns || 'they/them';
    // Persona gender drives how the player is written (body, address, pet names) — the text still
    // uses [Player]/[Gender] so names and pronouns resolve per persona at runtime.
    const playerGenderText = personaPronouns === 'she/her' ? 'a woman (she/her)'
      : personaPronouns === 'he/him' ? 'a man (he/him)'
        : 'non-binary (they/them)';
    const playerAddress = personaPronouns === 'she/her' ? '"girl", "sweetheart", "young lady" — never male terms'
      : personaPronouns === 'he/him' ? '"boy", "big guy", "handsome" — never female terms'
        : 'gender-neutral terms like "you", "darling", "little one" — never gendered terms';

    // ---- Variants: one per welcome message. Randomize Inflation Targets gives each its own
    // target (distinct while possible) and forces a new scenario + checkpoint profile per variant,
    // since the scenario and checkpoints name who is being inflated. ----
    const nWelcome = Math.max(1, Math.min(3, Number(welcomeCount) || 1));
    const randomTargets = nWelcome > 1 && randomizeTargets;
    const randomOps = nWelcome > 1 && randomizeOperators;
    const perVariantScenario = nWelcome > 1 && (newScenarioEach || randomTargets || randomOps);
    const variantWho = [who];
    for (let v = 1; v < nWelcome; v++) {
      if (!randomTargets) { variantWho.push(who); continue; }
      const unused = INFLATED.map(x => x.value).filter(x => !variantWho.includes(x));
      variantWho.push(unused.length ? pick(unused) : pick(INFLATED).value);
    }
    // Pump operator per variant. A Story Char operator is an "internal" supporting character —
    // same gender as the main character, generated per variant, and written ONLY into that
    // variant's scenario/welcome (never the card description), so it exists just in that story.
    const usedFirst = new Set([charName.split(' ')[0]]);
    const makeOp = (value) => {
      if (value === 'mix') return { op: 'mix', names: [] }; // resolved once the group cast exists
      if (value !== 'story') return { op: value };
      const pool = NAMES[g.value].first.filter(n => !usedFirst.has(n));
      const first = pick(pool.length ? pool : NAMES[g.value].first);
      usedFirst.add(first);
      return { op: 'story', npcName: `${first} ${pick(LAST_NAMES)}`, npcProfile: '' };
    };
    const variantOps = [makeOp(op)];
    for (let v = 1; v < nWelcome; v++) {
      if (!randomOps) { variantOps.push(variantOps[0]); continue; } // same object = shared story char
      const used = variantOps.map(o => o.op);
      const unused = OPERATORS.map(x => x.value).filter(x => !used.includes(x));
      variantOps.push(makeOp(unused.length ? pick(unused) : pick(OPERATORS).value));
    }
    // Plot per variant: Surprise gives each own-scenario variant a different plot.
    const variantPlots = [plotSurprise ? pick(PLOTS) : (PLOTS.find(p => p.value === plot) || PLOTS[0])];
    for (let v = 1; v < nWelcome; v++) {
      if (!plotSurprise || !(newScenarioEach || randomTargets || randomOps)) { variantPlots.push(variantPlots[0]); continue; }
      const unused = PLOTS.filter(p => !variantPlots.includes(p));
      variantPlots.push(unused.length ? pick(unused) : pick(PLOTS));
    }
    const mixedPlots = new Set(variantPlots.map(p => p.value)).size > 1;

    // Multi-Char: 1-2 additional group members, same gender as the main character. Per variant,
    // some are present from the opening and some ARRIVE later (a checkpoint step brings them in).
    const extras = [];
    if (multiChar) {
      for (let i = 0; i < Math.max(1, Math.min(2, Number(extraCount) || 1)); i++) {
        const pool = NAMES[g.value].first.filter(n => !usedFirst.has(n));
        const first = pick(pool.length ? pool : NAMES[g.value].first);
        usedFirst.add(first);
        // Not everyone is on the character's side: some are the player's friend or a near-stranger.
        const relations = [
          "[Player]'s close friend, who came along with [Player]",
          "a casual acquaintance of [Player] — they barely know each other",
          `${charName}'s friend and accomplice`,
          'a stranger who just happens to be here',
        ];
        const relation = pick(relations.filter(r => !extras.some(x => x.relation === r)));
        extras.push({ id: `m-${Date.now()}-${i + 1}`, name: `${first} ${pick(LAST_NAMES)}`, relation, description: '', personality: '', hardInstruct: '', pumpable: false });
      }
    }
    // ---- Random Mix resolution (needs the group cast) ----
    // Target: a random combination of [Player], the main character and individual members — always
    // including [Player] or the main character, since checkpoints can only track those two gauges.
    // Resolves to the usual player/character/both + a per-variant SET of inflated members.
    const coin = () => Math.random() < 0.5;
    const variantMembers = [];
    for (let v = 0; v < nWelcome; v++) {
      if (v > 0 && !randomTargets) { variantWho[v] = variantWho[0]; variantMembers[v] = variantMembers[0]; continue; }
      const raw = variantWho[v];
      if (raw === 'mix') {
        let pl = coin(); let base = coin();
        if (!pl && !base) { if (coin()) pl = true; else base = true; }
        const mem = extras.filter(() => coin());
        variantWho[v] = pl && base ? 'both' : pl ? 'player' : 'character';
        variantMembers[v] = new Set(mem.map(m => m.id));
      } else {
        variantMembers[v] = new Set((raw === 'character' || raw === 'both') ? extras.map(m => m.id) : []);
      }
    }
    // Operator mix: any non-empty combination of [Player], the main character and members — so the
    // player may end up inflating someone else, or themselves. A single pick collapses to that op.
    for (const o of new Set(variantOps)) {
      if (o.op !== 'mix') continue;
      const pool = [{ key: 'player', name: '[Player]' }, { key: 'base', name: charName }, ...extras.map(m => ({ key: m.id, name: m.name }))];
      let chosen = pool.filter(() => coin());
      if (!chosen.length) chosen = [pick(pool)];
      if (chosen.length === 1 && chosen[0].key === 'player') { o.op = 'player'; continue; }
      if (chosen.length === 1 && chosen[0].key === 'base') { o.op = 'character'; continue; }
      o.names = chosen.map(c => c.name);
      o.includesPlayer = chosen.some(c => c.key === 'player');
    }
    const joinNames = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : (list[0] || ''));

    const ARRIVAL_RANGES = ['41-50', '61-70'];
    const makeArrivals = () => {
      if (!extras.length) return [];
      if (extras.length === 1) return [Math.random() < 0.5 ? 'start' : 'late'];
      return Math.random() < 0.5 ? ['start', 'late'] : ['late', 'start']; // two: one opens, one arrives
    };
    const variantArrivals = [makeArrivals()];
    for (let v = 1; v < nWelcome; v++) variantArrivals.push(perVariantScenario ? makeArrivals() : variantArrivals[0]);
    // Late members in order → the range each one arrives in.
    const arrivalPlan = (arr) => {
      let n = 0;
      return extras.map((m, i) => (arr[i] === 'late' ? { m, range: ARRIVAL_RANGES[n++] || '61-70' } : null)).filter(Boolean);
    };
    const castLine = (arr, w, ms) => {
      const membersInflated = (m) => (ms ? ms.has(m.id) : (w === 'character' || w === 'both')); // this story's target
      if (!extras.length) return '';
      const parts = extras.map((m, i) => {
        const prof = m.description ? ` — ${m.description.split(/(?<=[.!?])\s/).slice(0, 2).join(' ')}` : '';
        const when = !arr ? '' : arr[i] === 'late'
          ? ` NOT present at the start — arrives later (around ${arrivalPlan(arr).find(a => a.m === m)?.range.split('-')[0]}% capacity); only mention them as expected/absent before that`
          : ' present from the very start';
        return `${m.name} (${g.pronouns}, ${m.relation})${prof};${when}${m.pumpable && membersInflated(m) ? `; ${m.name.split(' ')[0]} ALSO gets inflated (${methodLabel.toLowerCase()}) with their own belly and fullness` : ''}`;
      });
      return `\n- Group cast (they share the scene with ${charName} and also speak in replies): ${parts.join(' | ')}.`;
    };
    // Everyone on the character side: the main character plus any group members.
    const castNames = [charName, ...extras.map(m => m.name)];
    const castText = castNames.length > 1 ? `${castNames.slice(0, -1).join(', ')} and ${castNames[castNames.length - 1]}` : charName;
    const operatorTextOf = (o) => (o.op === 'player' ? '[Player]'
      : o.op === 'character' ? (extras.length ? `${castText} (the characters together)` : charName)
        : o.op === 'shared' ? `everyone — [Player] and ${castText} share control of the pump (taking turns, handing it off, or fighting over it)`
          : o.op === 'mix' ? `${joinNames(o.names)} — sharing control of the pump (taking turns or fighting over it)${o.includesPlayer ? '; [Player] has a hand on it too' : ''}`
          : `${o.npcName} (a supporting character, ${g.pronouns})`);
    const opLabel = (o) => (o.op === 'player' ? 'Player pumps' : o.op === 'character' ? (extras.length ? 'Chars pump' : 'Char pumps')
      : o.op === 'shared' ? 'Shared pump' : o.op === 'mix' ? 'Mixed pump' : `${o.npcName.split(' ')[0]} pumps`);
    const anyPlayerInflated = variantWho.some(w => w === 'player' || w === 'both');
    const anyCharInflated = variantWho.some(w => w === 'character' || w === 'both');
    // Who is inflated in a variant: base target + that variant's member set (ms; undefined = members
    // follow the characters).
    const inflatedPeople = (w, ms) => [
      ...((w === 'player' || w === 'both') ? ['[Player]'] : []),
      ...((w === 'character' || w === 'both') ? [charName] : []),
      ...extras.filter(m => (ms ? ms.has(m.id) : (w === 'character' || w === 'both'))).map(m => m.name),
    ];
    const victimOf = (w, ms) => joinNames(inflatedPeople(w, ms));
    const whoLabel = (w, ms) => {
      const ppl = inflatedPeople(w, ms);
      if (!extras.length) return w === 'both' ? 'Both inflated' : w === 'player' ? 'Player inflated' : 'Character inflated';
      if (ppl.length === extras.length + 2) return 'All inflated';
      return `${ppl.map(n => (n === '[Player]' ? 'Player' : n.split(' ')[0])).join(' + ')} inflated`;
    };

    const plan = createCheckpoints ? LEVEL_PLAN[checkpointLevel] : null;
    const ckptRanges = plan ? [...plan.ranges, ...(enforceBursting ? ['100+'] : [])] : [];

    const vTag = (v) => (nWelcome > 1 ? `Welcome ${v + 1} · ` : '');
    const stepList = ['Description', ...extras.map((m, i) => `Group member ${i + 1}`), 'Personality', 'Hard instruct', 'Example dialogue'];
    for (let v = 0; v < nWelcome; v++) {
      const ownStory = v === 0 || perVariantScenario;
      if (ownStory && variantOps[v].op === 'story') stepList.push(`${vTag(v)}Story char`);
      if (ownStory) stepList.push(`${vTag(v)}Scenario`);
      stepList.push(`${vTag(v)}Welcome message`);
      if (ownStory) ckptRanges.forEach(k => stepList.push(`${vTag(v)}Checkpoint ${k}%`));
    }
    stepList.push('Saving character');
    setSteps(stepList.map(label => ({ label, status: 'pending' })));
    cancelRef.current = false;
    setRunning(true);

    const clean = (t) => cleanText(t, { personaName, charName });

    // Shared story brief — every prompt gets the same facts so the fields stay cohesive. `w` =
    // this variant's inflation target (null = card-level text that must fit every variant).
    const guidanceText = String(guidance || '').trim().slice(0, 600);
    const briefFor = (w, o, pl, arr, ms) => `STORY FACTS (keep every detail consistent with these):
- Character: ${charName} (${g.label.toLowerCase()}, ${g.pronouns}).${guidanceText ? `\n- Creator's guidance (work it in naturally where it fits; the facts above win if they conflict): ${guidanceText}` : ''}
- Personality type: ${personality} — ${TONE[personality]}.
- The player is written as [Player] (never invent a name). For the player's pronouns write [Gender] (e.g. "[Gender] belly", "looks at [Gender]") — it resolves at runtime.
- [Player] is ${playerGenderText}. Write [Player]'s body, clothing, and how ${charName} addresses and treats [Gender] to fit that gender (e.g. ${playerAddress}).
- Location: ${loc.prose}.
- Inflation method: ${methodProse}.
- Plot: ${pl ? `${pl.prose}. Build the story's motive, stakes and escalation around this plot.` : 'varies between stories — do NOT commit to one specific plot here'}.
- Being inflated: ${w ? victimOf(w, ms) : 'varies between stories ([Player], ' + charName + ', or both) — do NOT commit to who'}.
- Operating the pump: ${o ? operatorTextOf(o) : 'named in each scenario — do NOT mention who here'}.${o?.op === 'story' ? `\n- ${o.npcName} is a supporting character who exists only in this scene${o.npcProfile ? `: ${o.npcProfile}` : ''}. ${charName}'s replies also narrate and voice ${o.npcName}.` : ''}
${castLine(arr, w, ms)}
- Ending: ${enforceBursting ? `the scene builds toward a burst — ${w ? victimOf(w, ms) : 'someone'} will ultimately be inflated until they burst/pop.` : 'the scene builds to maximum fullness but nobody bursts — the climax is being impossibly full at the very edge.'}`;

    const style = `STYLE: grounded, sensory, natural language — no purple prose. Never write the player's dialogue or decisions. Use [Player] for the player's name. Output ONLY the requested text, no headings, no notes, no explanations.`;

    let idx = 0;
    const run = async (fn) => { setStep(idx, 'active'); const out = await fn(); setStep(idx, 'done'); idx++; return out; };

    try {
      // Card-level text must fit every variant and never mention a story char (they live only in
      // their own scenario/welcome).
      const cardBrief = briefFor(randomTargets ? null : variantWho[0], (randomOps || variantOps[0].op === 'story') ? null : variantOps[0], mixedPlots ? null : variantPlots[0], undefined, randomTargets ? undefined : variantMembers[0]);
      const cardWho = randomTargets ? null : variantWho[0];
      const description = await run(async () => clean(await llm(`You are writing a roleplay character card.
${cardBrief}

Write ${charName}'s DESCRIPTION in third person, 2 short paragraphs: their appearance, clothing, background, how they came to be at this location, and their relationship to [Player]${extras.length ? ` and to ${extras.map(m => m.name).join(' and ')}` : ''}. Mention how they feel about inflation and their role in it${cardWho ? ` (${cardWho === 'player' ? 'they are involved in inflating [Player]' : 'they are going to be inflated'})` : ''}.
${style}`, 450)));

      // Group members: description / personality / voice in one structured call each.
      for (const m of extras) {
        const others = extras.filter(x => x !== m && x.description).map(x => `${x.name}: ${x.description.slice(0, 200)}`).join('\n');
        const raw = await run(async () => llm(`You are writing a supporting group member for a roleplay character card.
${cardBrief}

Main character ${charName}:
${description}
${others ? `\nOther group member(s):\n${others}\n` : ''}
Create ${m.name} (${g.label.toLowerCase()}, ${g.pronouns}) — a distinct person with their own look and attitude. Their relationship: ${m.relation}. Use EXACTLY this format:
DESCRIPTION: <2-3 sentences: appearance, who they are, why they are here, relationship to ${charName}>
PERSONALITY: <6-8 comma-separated traits>
VOICE: <one sentence starting with "Speak like", a concrete modern speaking style different from ${charName}'s>`, 260));
        const t = String(raw || '');
        const grab = (k) => clean((t.match(new RegExp(`${k}\\s*:\\s*([^\\n]+)`, 'i')) || [])[1] || '');
        m.description = grab('DESCRIPTION') || `${m.name} is part of ${charName}'s circle and shares the scene.`;
        m.personality = grab('PERSONALITY') || 'curious, opinionated, distinct';
        let voice = grab('VOICE').replace(/^["“']+|["”']+$/g, '');
        if (voice && !/^speak like/i.test(voice)) voice = `Speak like ${voice.replace(/^[A-Z]/, c => c.toLowerCase())}`;
        m.hardInstruct = voice || '';
        // Members follow "Who is being inflated": Characters / All make every member a pump target.
        m.pumpable = variantMembers.some(ms => ms.has(m.id));
      }

      const persText = await run(async () => clean(await llm(`You are writing a roleplay character card.
${cardBrief}

Write ${charName}'s PERSONALITY: one line of 6-10 comma-separated traits, then one or two sentences on how they speak and behave toward [Player] during the inflation. Match the "${personality}" personality type.
${style}`, 160)));

      // Hard Instruct: one plain voice line, re-sent with every reply to keep small models in voice.
      const hardInstruct = await run(async () => {
        const raw = clean(await llm(`You are writing a roleplay character card.
${cardBrief}

Personality: ${persText}

Write ONE short sentence (under 20 words) telling the writer how ${charName} speaks, starting with "Speak like". Name a concrete, modern speaking style (e.g. "Speak like a cold, calculating medical professional."). Plain words — no archaic or poetic style. Output only that sentence.`, 60));
        let line = (raw.split('\n').map(l => l.trim()).find(Boolean) || '').replace(/^["“']+|["”']+$/g, '').trim();
        if (!/^speak like/i.test(line)) line = line ? `Speak like ${line.replace(/^[A-Z]/, c => c.toLowerCase())}` : '';
        if (line && !/[.!]$/.test(line)) line += '.';
        return line || `Speak like a ${TONE[personality].split(' — ')[0].split(',')[0]} person, in plain modern language.`;
      });

      const dialogueRaw = await run(async () => llm(`You are writing example dialogue for a roleplay character card.
${cardBrief}

Write 2 short example exchanges showing how ${charName} talks. Use EXACTLY this format, nothing else:
PLAYER: <a short line [Player] might say>
CHAR: <${extras.length ? `the group's reply on ONE line — ${charName} and ${extras.map(m => m.name.split(' ')[0]).join('/')} each speak, every speaker's part starting with their name, e.g. ${charName.split(' ')[0]}: *smirks* "..." ${extras[0].name.split(' ')[0]}: *laughs* "..."` : `${charName}'s in-character reply with *actions* and "dialogue", 1-3 sentences`}>
PLAYER: <...>
CHAR: <...>`, 350));
      const exampleDialogues = [];
      {
        const lines = String(dialogueRaw || '').split('\n').map(l => l.trim()).filter(Boolean);
        let user = null;
        for (const l of lines) {
          const pm = l.match(/^\**(PLAYER|\[Player\]|USER)\**\s*:\s*(.+)$/i);
          const cm = l.match(/^\**(CHAR|CHARACTER|\[Char\]|[A-Z][a-z]+)\**\s*:\s*(.+)$/);
          if (pm) user = clean(pm[2]);
          else if (cm && user) { exampleDialogues.push({ user, character: enforceRpFormat(clean(cm[2]), extras.length ? [charName, ...extras.map(m => m.name)].flatMap(n => [n, n.split(' ')[0]]) : []) }); user = null; }
        }
      }

      const preset = (presetsRef.current || []).find(p => p.id === 'preset-standard');

      // Build one checkpoint profile for a variant (target `w`, scenario text). Returns
      // { profile, charThemes, autoPumpOperator }.
      const buildProfile = async (w, o, scenario, v) => {
        const ms = variantMembers[v];
        const brief = briefFor(w, o, variantPlots[v], variantArrivals[v], ms);
        const { op, npcName } = o;
        const operatorText = operatorTextOf(o);
        const playerInflated = w === 'player' || w === 'both';
        const charInflated = w === 'character' || w === 'both';
        const victimText = victimOf(w, ms);
        const themes = {};
        for (const k of RANGE_KEYS) themes[k] = { mainTheme: preset?.ranges?.[k]?.mainTheme || FALLBACK_THEMES[k] };
        const triggers = {}; // `${track}-${range}` → { sequential: [], random: [] }
        const charThemes = {}; // story.characterCheckpoints (char-capacity stage directions)
        // Primary track = player capacity when the player is inflated, else the character's.
        const track = playerInflated ? 'player' : 'char';
        const autoPumpOperator = playerInflated && op !== 'player'; // char/NPC drives the real pump
        const priorBeats = [];

        for (const rk of ckptRanges) {
          const [lo, hi] = RANGE_BOUNDS[rk];
          const nSteps = rk === '100+' ? 1 : plan.steps;
          const isClimax = rk === '91-100';
          const isBurst = rk === '100+';
          const climaxNote = isBurst
            ? `This is the BURST: ${victimText} has gone past the limit and pops. Write the burst moment and its immediate aftermath.`
            : isClimax
              ? (enforceBursting ? `This is the climax: ${victimText} is at absolute capacity and right on the verge of bursting — ${operatorText} keeps going.` : `This is the climax: ${victimText} is impossibly full at the very edge — the inflation stops here, nobody bursts.`)
              : '';
          const raw = await run(async () => llm(`You are designing a capacity checkpoint for an inflation roleplay. Checkpoints fire as ${track === 'player' ? '[Player]' : charName}'s belly fills.
${brief}

Scenario: ${scenario}

This checkpoint: ${lo}%-${hi}% capacity — ${RANGE_STAGE[rk]}. ${climaxNote}
How big the belly actually is at this point (stay accurate to this — do not exaggerate early sizes): ${themes[rk]?.mainTheme || FALLBACK_THEMES[rk]}
${priorBeats.length ? `Earlier beats already used (do NOT repeat them, escalate from them):\n${priorBeats.slice(-6).map(b => `- ${b}`).join('\n')}\n` : ''}
Write EXACTLY this format:
THEME: <1-2 sentences of guidance for how the scene and ${track === 'player' ? "[Player]'s" : `${charName}'s`} body should be written at this fullness${w === 'both' ? ` — describe ONLY ${track === 'player' ? '[Player]' : charName}'s belly here; ${track === 'player' ? charName : '[Player]'}'s fullness is tracked separately` : ''}>
${Array.from({ length: nSteps }, (_, i) => `STEP ${i + 1}: <a short story BEAT, under 20 words${i > 0 ? ', escalating from the previous step' : ''}>`).join('\n')}

STEP RULES — these fire later, in the middle of a live roleplay whose exact events you cannot see, so each beat must fit ANY moment of the scene:
- Describe WHAT changes or what ${charName} reacts to (a feeling, a reaction, a decision, a shift in mood or tension) — not a scripted scene.
- NO exact dialogue, NO quotation marks, NO stage blocking (no "moves behind", "kneels", "picks up", no attaching or adjusting equipment).
- Never assume where anyone is standing or what was just said.
- NEVER have anyone start, stop, pause, speed up, or adjust the pump/flow — the real device controls that.
Good: "${charName} notices how quickly the belly is rounding and teases [Player] about it." Bad: "${charName} kneels and says \"look at you\" while adjusting the nozzle."`, 140 + nSteps * 60));

          const text = String(raw || '');
          const themeM = text.match(/THEME\s*:\s*([^\n]+)/i);
          const stepTexts = [...text.matchAll(/STEP\s*\d+\s*:\s*([^\n]+)/gi)].map(m => sanitizeBeat(clean(m[1]))).filter(Boolean).slice(0, nSteps);
          if (themeM) {
            const th = clean(themeM[1]);
            if (track === 'player') themes[rk] = { mainTheme: th };
            if (charInflated) charThemes[rk] = { mainTheme: track === 'char' ? th : FALLBACK_THEMES[rk] };
          }
          // Every band keeps at least one beat even if the model's were all rejected.
        if (!stepTexts.length && !isBurst) stepTexts.push(`${charName} reacts in character to how full ${track === 'player' ? '[Player]' : charName} is getting — ${RANGE_STAGE[rk]}.`);
        priorBeats.push(...stepTexts);

          // Sequential triggers: first step on entry, the rest spaced by Fire% inside the band.
          const seq = [];
          stepTexts.forEach((st, i) => {
            const t = { id: uid('trg'), type: 'ai_message', context: beatContext(st) };
            // Every step waits for its own % inside the band, so normal replies happen between beats
            // and nothing fires the instant a band is entered (e.g. right after the welcome).
            if (!isBurst) t.firePercent = Math.min(hi, lo + Math.max(2, Math.round(((hi - lo) * (i + 0.5)) / nSteps)));
            seq.push(t);
          });
          // Climax functions: drive / stop the pump and gate the final beat on the gauge.
          if (isClimax) {
            if (track === 'player') {
              if (enforceBursting && autoPumpOperator) {
                seq.push({ id: uid('trg'), type: 'pump_on', durationMode: 'percent_until', duration: '100', awaitCompletion: true });
              }
              if (!enforceBursting && autoPumpOperator) {
                seq.push({ id: uid('trg'), type: 'pump_off', firePercent: 99 });
                seq.push({ id: uid('trg'), type: 'ai_message', firePercent: 99, context: beatContext(`${op === 'story' ? npcName : charName} shuts the pump off at the very edge — [Player] is as full as [Gender] can possibly be, and ${charName} savours the moment.`) });
              }
              if (enforceBursting) {
                seq.push({ id: uid('trg'), type: 'ai_message', firePercent: 100, context: beatContext(`[Player] reaches the absolute limit and bursts. ${charName} reacts in character (${personality.toLowerCase()}).`) });
              }
            }
            if (charInflated) {
              const ct = triggers[`char-${rk}`] || { sequential: [], random: [] };
              if (enforceBursting) {
                ct.sequential.push({ id: uid('trg'), type: 'ai_message', firePercent: 100, context: beatContext(`${charName} reaches the absolute limit and bursts.`) });
              } else {
                ct.sequential.push({ id: uid('trg'), type: 'char_inflate_stop', firePercent: 99 });
                ct.sequential.push({ id: uid('trg'), type: 'ai_message', firePercent: 99, context: beatContext(`The pump stops — ${charName} is impossibly full, right at the edge, and reacts in character.`) });
              }
              triggers[`char-${rk}`] = ct;
            }
          }
          const key = `${track}-${rk}`;
          const existing = triggers[key] || { sequential: [], random: [] };
          triggers[key] = { ...existing, sequential: [...seq, ...existing.sequential] };
        }
        // Late group members: on entering their arrival band, a message brings them into the scene.
        for (const { m, range } of arrivalPlan(variantArrivals[v] || [])) {
          const key = `${track}-${range}`;
          const ex = triggers[key] || { sequential: [], random: [] };
          const [alo] = RANGE_BOUNDS[range];
          ex.sequential = [{ id: uid('trg'), type: 'ai_message', firePercent: alo + 1, context: `Continue directly from the last message, keeping everything already established consistent. ${m.name} arrives and joins the scene now (${m.description.split(/(?<=[.!?])\s/)[0]}). Make the entrance a clear moment — ${charName} and the others react, and ${m.name.split(' ')[0]} speaks to [Player]. From now on ${m.name.split(' ')[0]} takes part.` },
            // A pump-target member arriving with a non-player operator gets hooked up on arrival.
            ...(ms.has(m.id) && op !== 'player' ? [{ id: uid('trg'), type: 'char_inflate_start', targetMember: m.id }] : []),
            ...ex.sequential];
          triggers[key] = ex;
        }
        if (charInflated) for (const k of RANGE_KEYS) if (!charThemes[k]) charThemes[k] = { mainTheme: FALLBACK_THEMES[k] };

        const rsId = uid('rs');
        // Session Start: when the character is inflated and someone other than the player runs the
        // pump, start the character's (simulated) pump so the char-capacity checkpoints progress.
        const ssNodes = [
          ...((charInflated && op !== 'player') ? [{ id: uid('node'), kind: 'action', type: 'char_inflate_start', params: {} }] : []),
          // Pump-target group members present from the opening start their own (simulated) pumps too.
          ...(op !== 'player' ? extras.filter((m, i) => ms.has(m.id) && (variantArrivals[v] || [])[i] !== 'late')
            .map(m => ({ id: uid('node'), kind: 'action', type: 'char_inflate_start', params: { targetMember: m.id } })) : []),
        ];
        const profile = {
          id: uid('prof'),
          name: nWelcome > 1 && perVariantScenario ? `Welcome ${v + 1} — ${variantPlots[v].label}, ${whoLabel(w, ms)}, ${opLabel(o)}` : variantPlots[0].label,
          rules: [
            `Plot: ${variantPlots[v].prose}.`,
            `Inflation method: ${methodProse}.`,
            `Being inflated: ${victimText}. Pump operator: ${operatorText}.`,
            enforceBursting ? `The story ends with ${victimText} bursting — escalate steadily toward it.` : 'Nobody bursts — the climax is maximum fullness at the very edge.',
          ].join('\n'),
          rangeSets: [{ id: rsId, name: 'Default', ranges: track === 'player' ? themes : {}, checkpointTriggers: triggers, treeRefs: { ranges: {} } }],
          defaultRangeSetId: rsId,
          treeRefs: {
            introEnabled: false,
            ...(ssNodes.length ? { sessionStart: { inline: { id: uid('tree'), name: 'Session Start', nodes: ssNodes } } } : {}),
          },
        };
        return { profile, charThemes: charInflated ? charThemes : null, autoPumpOperator };
      };

      // ---- Per-variant scenario / welcome / checkpoints ----
      const scenarios = [];
      const welcomes = [];
      const profiles = [];
      let charThemes = null;
      let shared = null; // variant 0's scenario/profile, reused when variants share a scenario
      for (let v = 0; v < nWelcome; v++) {
        const w = variantWho[v];
        const o = variantOps[v];
        let sc = shared?.sc;
        let built = shared?.built;
        if ((v === 0 || perVariantScenario) && o.op === 'story' && !o.npcProfile) {
          o.npcProfile = await run(async () => clean(await llm(`You are creating a supporting character for one roleplay scene.
${briefFor(w, { ...o, npcProfile: '' }, variantPlots[v], variantArrivals[v], variantMembers[v])}

Create ${o.npcName} (${g.label.toLowerCase()}, ${g.pronouns}), the person who operates the pump in this scene. In 2 sentences give their role at this location, their appearance, their attitude toward [Player]${w !== 'player' ? ` and ${charName}` : ''}, and why they are the one running the pump. They should feel distinct from ${charName}.
${style}`, 160)));
        }
        const brief = briefFor(w, o, variantPlots[v], variantArrivals[v], variantMembers[v]);
        if (v === 0 || perVariantScenario) {
          // Scenario rides in every prompt — keep it tiny for small context windows: 2 sentences,
          // +1 per extra named character (story char / group member), hard-trimmed afterwards.
          const scSentences = 2 + extras.length + (o.op === 'story' ? 1 : 0);
          const scWords = 45 + 20 * (extras.length + (o.op === 'story' ? 1 : 0));
          const prevSc = scenarios.map(s => `- ${s.text.slice(0, 160)}`).join('\n');
          const scText = await run(async () => clean(await llm(`You are writing a roleplay character card.
${brief}

Character description:
${description}

Write a SHORT SCENARIO — ${scSentences} plain sentences, under ${scWords} words total, third person present tense. State only the facts: where ${charName} and [Player] are, why (the ${variantPlots[v].label.toLowerCase()} plot), who is inflated (${victimOf(w, variantMembers[v])}) and who runs the pump (${operatorTextOf(o)}).${o.op === 'story' ? ` Name ${o.npcName} and their role in a few words.` : ''}${extras.length ? ` Name each group member in a few words; say who arrives later.` : ''} No sensory description, no backstory, no adjectives piled up.${prevSc ? `\nMake it a DIFFERENT setup from these existing scenarios:\n${prevSc}` : ''}
${style}`, 70 + scWords * 2)));
          sc = { id: uid('sc'), text: trimToLength(scText, scSentences, scWords) };
          scenarios.push(sc);
        }
        const prevWm = welcomes.map(x => `- ${x.text.slice(0, 200)}`).join('\n');
        const welcome = await run(async () => enforceRpFormat(clean(await llm(`You are writing the opening message of a roleplay.
${brief}

Character description:
${description}

Scenario:
${sc.text}

Write ${charName}'s WELCOME MESSAGE — the first message of the roleplay, 3-5 paragraphs, written as ${charName}. Narrate in THIRD PERSON ("${charName} leans…", never "I lean…") and refer to the player as [Player] or [Gender] in narration, never "you" (dialogue may say "you"). FORMAT RULE: every action/narration sentence goes inside *single asterisks* and every spoken line goes inside "double quotes" — e.g. *${charName} leans against the doorframe, smirking.* "You finally made it." *She gestures at the bench.*${o.op === 'story' ? ` ${o.npcName} (the pump operator) appears and speaks too.` : ''}${extras.length ? ` Group members who are present from the start must appear and speak, each in their own voice; anyone arriving later is only mentioned (expected, late, on the way).` : ''} Establish the location with sensory detail, show ${charName}'s personality, set up the ${methodLabel.toLowerCase()} equipment, and address [Player] directly. Inflation has NOT started yet (or is just starting) — no belly growth yet. End on a moment that invites [Player] to respond. Do not write [Player]'s actions, thoughts, or dialogue.${prevWm ? `\nThis is an ALTERNATE opening — make it clearly different from these existing ones (different first action, different first line):\n${prevWm}` : ''}
${style}`, 700))));
        if (v === 0 || perVariantScenario) {
          built = await buildProfile(w, o, sc.text, v);
          profiles.push(built.profile);
          if (!charThemes && built.charThemes) charThemes = built.charThemes;
        }
        if (v === 0) shared = { sc, built };
        welcomes.push({
          id: uid('wm'), text: welcome, llmEnhanced: true,
          // Variant links (backend applyWelcomeVariant): a randomly picked welcome brings its own
          // scenario, checkpoint profile and pump-control setting.
          ...(perVariantScenario ? { scenarioId: sc.id, checkpointProfileId: built.profile.id, allowLlmDeviceAccess: true } : {}),
        });
      }

      // ---- Assemble the card ----
      setStep(idx, 'active');
      const storyId = uid('story');
      const attributes = ATTRIBUTES[personality];
      const memberId = `m-${Date.now()}`;
      const shortDescription = `${personality} · ${mixedPlots ? 'Mixed plots' : variantPlots[0].label} · ${loc.label} · ${methodLabel} · ${randomTargets ? 'Mixed targets' : whoLabel(variantWho[0], variantMembers[0])}`;
      const authorsNote = [
        (settings?.globalPrompt || '').trim(),
        `[Story note: ${charName} is ${TONE[personality]}. Inflation by ${methodProse}. ${(randomOps || variantOps[0].op === 'story') ? 'The scenario names who operates the pump.' : `${operatorTextOf(variantOps[0])} operates the pump.`} ${enforceBursting ? 'Build toward a burst.' : 'Nobody bursts.'} Write [Player]'s pronouns as [Gender].]`,
      ].filter(Boolean).join('\n\n');

      // The character runs its own pump in every variant that inflates it → self-pumping dispositions.
      const selfPumps = variantWho.every((w, i) => w === 'player' || variantOps[i].op === 'character');
      const card = {
        name: charName,
        shortDescription,
        gender: g.value,
        description,
        personality: persText,
        hardInstruct,
        responseContext: '',
        responseTokens: '',
        historyDepth: '',
        avatar: '',
        authorsNote,
        instructor: { enabled: false },
        // Checkpoints live ONLY on the base character (the active story) and the base member is the
        // explicit Primary — group members get no checkpoint store of their own.
        primaryCheckpointMemberId: memberId,
        // Group card: Respond as Group by default. Member 0 IS the base character (mirrors the card).
        multiChar: {
          enabled: extras.length > 0,
          ...(extras.length ? { responseMode: 'group', voiceLocked: true } : {}),
          characters: [
            { id: memberId, name: charName, description, personality: persText, gender: g.value, portrait: '', hardInstruct, isPumpable: anyCharInflated },
            ...extras.map(m => ({ id: m.id, name: m.name, description: m.description, personality: m.personality, gender: g.value, portrait: '', hardInstruct: m.hardInstruct, isPumpable: !!m.pumpable })),
          ],
        },
        isPumpable: anyCharInflated,
        defaultPumpType: 'electric',
        characterCalibrationTime: checkpointLevel === 'thorough' ? 180 : checkpointLevel === 'balanced' ? 120 : 90,
        charBurstPercent: enforceBursting ? 100 : 150,
        hideCharBurstFromDetails: true,
        charSyncCalibrationWithPlayer: anyCharInflated || extras.some(m => m.pumpable), // pump-target chars always share the player's calibration
        charInflateKnowledge: anyCharInflated ? (selfPumps ? 'expert' : 'informed') : 'informed',
        charInflateDesire: anyCharInflated ? (selfPumps ? 'eager' : SELF_DESIRE[personality]) : 'neutral',
        charPopDesire: anyCharInflated ? (enforceBursting ? SELF_POP_BURST[personality] : SELF_POP_SAFE[personality]) : 'terrified',
        desireToInflateOthers: anyPlayerInflated ? INFLATE_OTHERS[personality] : 'none',
        desireToPopOthers: anyPlayerInflated ? (enforceBursting ? POP_OTHERS_BURST[personality] : POP_OTHERS_SAFE[personality]) : 'none',
        sessionDefaults: { capacity: 0, pain: 0, emotion: EMOTION[personality], capacityModifier: 1 },
        buttons: [],
        buttonSets: [],
        activeButtonSetId: '',
        constantReminders: [],
        globalReminders: [],
        stories: [{
          id: storyId,
          name: `${loc.label} Story`,
          welcomeMessages: welcomes,
          activeWelcomeMessageId: welcomes[0].id,
          randomWelcomeVersion: welcomes.length > 1,
          scenarios,
          activeScenarioId: scenarios[0].id,
          exampleDialogues,
          autoReplyEnabled: true,
          allowLlmDeviceAccess: true,
          assignedFlows: [],
          assignedButtons: [],
          constantReminderIds: [],
          globalReminderIds: [],
          startingEmotion: EMOTION[personality],
          storyProgressionEnabled: false,
          storyProgressionMaxOptions: 3,
          dictionaryGroupIds: ['dict-builtin-inflation-tools'],
          attributes,
          checkpointsEnabled: true,
          checkpointProfiles: profiles,
          defaultCheckpointProfileId: profiles[0].id,
          ...(charThemes ? { characterCheckpoints: charThemes } : {}),
        }],
        activeStoryId: storyId,
        generatedBy: { tool: 'character-creator', options: { gender: g.value, personality, inflated: variantWho.map((w, i) => victimOf(w, variantMembers[i])), operatorsMix: variantOps.map(o => (o.op === 'mix' ? o.names : null)), operator: variantOps.map(o => o.op), types: typeVals, location: loc.value, plots: variantPlots.map(p => p.value), groupMembers: extras.map(m => `${m.name} (${m.relation})`), guidance: guidanceText, checkpoints: createCheckpoints ? checkpointLevel : 'off', enforceBursting, storyChars: variantOps.filter(o => o.npcName).map(o => o.npcName), playerPronouns: personaPronouns, welcomeCount: nWelcome, randomizeTargets: randomTargets, randomizeOperators: randomOps, newScenarioEach: perVariantScenario } },
      };

      const saved = await api.createCharacter(card);
      // Generated cards expect the model to drive devices — make sure the global switch is on
      // (the card's own AI Pump Control is a no-op while it's off).
      if (!settings?.globalCharacterControls?.allowLlmDeviceControl) {
        await api.updateSettings({ globalCharacterControls: { ...(settings?.globalCharacterControls || {}), allowLlmDeviceControl: true } })
          .catch((e) => console.warn('[CharacterCreator] could not enable LLM device control:', e));
      }
      setStep(idx, 'done');
      showSuccess?.(`Created "${charName}"`);
      setRunning(false);
      navigate('/characters-personas/characters', { state: { openCharacterId: saved?.id } });
    } catch (e) {
      setRunning(false);
      if (e?.message === 'cancelled') {
        setSteps(prev => prev.map(s => (s.status === 'active' ? { ...s, status: 'error' } : s)));
        showError?.('Character generation aborted');
        return;
      }
      console.error('[CharacterCreator] generation failed:', e);
      setSteps(prev => prev.map(s => (s.status === 'active' ? { ...s, status: 'error' } : s)));
      showError?.(`Character generation failed: ${e?.message || e}`);
    }
  };

  const disabled = running;
  const check = (checked, onChange, label, { title = false, surpriseStyle = false, off = false } = {}) => (
    <label className={`cc-check${title ? ' cc-title' : ''}${surpriseStyle ? ' cc-surprise' : ''}${(disabled || off) ? ' is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled || off} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
  const surprise = (checked, setChecked) => check(checked, setChecked, 'Surprise Me', { surpriseStyle: true });

  return (
    <div className="settings-tab character-creator">
      <p className="section-hint" style={{ marginTop: 0 }}>
        Pick the story setup and press Generate — the LLM writes the description, personality, scenario, welcome message(s), example dialogue
        and (optionally) escalating capacity checkpoints, and every card setting is filled to match. Text uses <code>[Player]</code> so it works with any persona
        {activePersona ? <> (the player is written as <strong>{activePersona.displayName}</strong>'s gender — {activePersona.pronouns || 'they/them'})</> : null}.
      </p>

      <div className="cc-grid">
        <div className="form-group">
          <label>Gender</label>
          <select value={gender} disabled={disabled} onChange={(e) => setGender(e.target.value)}>
            {GENDERS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Personality</label>
          <select value={personality} disabled={disabled} onChange={(e) => setPersonality(e.target.value)}>
            {PERSONALITIES.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Who is being inflated?</label>
          <select value={inflated} disabled={disabled || inflatedSurprise} onChange={(e) => setInflated(e.target.value)}>
            {INFLATED.map(x => <option key={x.value} value={x.value}>{inflatedLabel(x, multiChar)}</option>)}
          </select>
          {inflated === 'mix' && !inflatedSurprise && <span className="section-hint">A random combination of [Player], the character{multiChar ? ' and any group members' : ''} — always includes [Player] or the main character.</span>}
          {surprise(inflatedSurprise, setInflatedSurprise)}
        </div>

        <div className="form-group">
          <label>Who is operating the pump?</label>
          <select value={operator} disabled={disabled || operatorSurprise} onChange={(e) => setOperator(e.target.value)}>
            {OPERATORS.map(x => <option key={x.value} value={x.value}>{operatorLabel(x, multiChar)}</option>)}
          </select>
          {operator === 'mix' && !operatorSurprise && <span className="section-hint">A random set of operators — [Player] may end up pumping someone else, or themselves.</span>}
          {surprise(operatorSurprise, setOperatorSurprise)}
        </div>

        <div className="form-group">
          <label>Type of inflation?</label>
          <div className={`cc-type-list${typesSurprise ? ' is-disabled' : ''}`}>
            {INFLATION_TYPES.map(t => (
              <div key={t.value} className={`cc-type-row${types.includes(t.value) ? ' is-checked' : ''}`}>
                {check(types.includes(t.value), () => toggleType(t.value), t.label, { off: typesSurprise })}
              </div>
            ))}
          </div>
          {surprise(typesSurprise, setTypesSurprise)}
        </div>

        <div className="form-group">
          <label>Location</label>
          <select value={location} disabled={disabled || locationSurprise} onChange={(e) => setLocation(e.target.value)}>
            {LOCATIONS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
          {surprise(locationSurprise, setLocationSurprise)}
        </div>

        <div className="form-group">
          <label>Plot</label>
          <select value={plot} disabled={disabled || plotSurprise} onChange={(e) => setPlot(e.target.value)}>
            {PLOTS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
          {surprise(plotSurprise, setPlotSurprise)}
        </div>

        <div className="form-group">
          {check(multiChar, setMultiChar, 'Multi-Char', { title: true })}
          {multiChar && (
            <>
              <select value={extraCount} disabled={disabled} onChange={(e) => setExtraCount(Number(e.target.value))} style={{ marginTop: 4 }}>
                <option value={1}>1 additional character</option>
                <option value={2}>2 additional characters</option>
              </select>
              <p className="section-hint" style={{ marginTop: 6 }}>Group card (Respond as Group), members the same gender as the main character. Some are in the scene from the start, others arrive partway through.</p>
            </>
          )}
        </div>

        <div className="form-group">
          <label># of Welcome Messages</label>
          <select value={welcomeCount} disabled={disabled} onChange={(e) => setWelcomeCount(Number(e.target.value))}>
            {[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          {welcomeCount > 1 && (
            <div className="cc-sub">
              {check(randomizeTargets, setRandomizeTargets, 'Randomize Inflation Targets')}
              {check(randomizeOperators, setRandomizeOperators, 'Randomize Pump Operators')}
              {check(newScenarioEach || randomizeTargets || randomizeOperators, setNewScenarioEach,
                (randomizeTargets || randomizeOperators) ? 'New Scenario for Each (required)' : 'New Scenario for Each',
                { off: randomizeTargets || randomizeOperators })}
              {(randomizeTargets || randomizeOperators) && (
                <span className="section-hint" style={{ marginTop: -2 }}>
                  Locked on: each welcome has a different {randomizeTargets && randomizeOperators ? 'target and pump operator' : randomizeTargets ? 'inflation target' : 'pump operator'}, and the scenario and checkpoints name who that is — one shared scenario would contradict the other welcomes.
                </span>
              )}
            </div>
          )}
          <p className="section-hint" style={{ marginTop: 6 }}>
            {welcomeCount > 1
              ? ((randomizeTargets || randomizeOperators)
                ? `Each welcome gets a different ${[randomizeTargets && 'inflation target', randomizeOperators && 'pump operator'].filter(Boolean).join(' and ')} with its own scenario and checkpoints; one is picked at random each session.`
                : newScenarioEach
                  ? 'Each welcome gets its own scenario and checkpoints; one is picked at random each session.'
                  : 'Alternate openings for the same scenario; one is picked at random each session.')
              : 'One opening message (LLM-enhanced at session start).'}
          </p>
        </div>

        <div className="form-group">
          {check(createCheckpoints, setCreateCheckpoints, 'Create Checkpoints', { title: true })}
          {createCheckpoints && (
            <select value={checkpointLevel} disabled={disabled} onChange={(e) => setCheckpointLevel(e.target.value)} style={{ marginTop: 4 }}>
              {CHECKPOINT_LEVELS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          )}
          <p className="section-hint" style={{ marginTop: 6 }}>
            {createCheckpoints
              ? { minimal: '4 key ranges, 1 step each.', balanced: '6 ranges, 2 steps each.', thorough: 'Every range, 3 steps each.' }[checkpointLevel]
              : 'Off: the card gets the Standard Pacing themes only (no generated steps).'}
          </p>
        </div>

        <div className="form-group">
          {check(enforceBursting, setEnforceBursting, 'Enforce Bursting', { title: true })}
          <p className="section-hint" style={{ marginTop: 6 }}>The story builds to a burst instead of stopping at the edge.</p>
        </div>
      </div>

      {llmDeviceControlOff && (
        <p className="section-hint">
          "Allow LLM Device Control" (Settings → Global) is off — generating will turn it on, along with the card's AI Pump Control and Auto-Response.
        </p>
      )}

      <div className="form-group" style={{ marginTop: 14 }}>
        <label>Scenario or Character Guidance (Optional)</label>
        <textarea rows={3} value={guidance} disabled={disabled} maxLength={600} onChange={(e) => setGuidance(e.target.value)}
          placeholder="e.g. She's [Player]'s strict older roommate. Keep it playful at first, darker later. One of the group is secretly on [Player]'s side." />
        <p className="section-hint" style={{ marginTop: 4 }}>A light nudge added to every generation step — the choices above still take priority.</p>
      </div>

      <div className="tab-header-actions" style={{ marginTop: 12 }}>
        <button className={`btn ${running ? 'btn-danger' : 'btn-primary'}`} onClick={handleGenerate}
          disabled={!running && !typesSurprise && types.length === 0}>
          {running ? 'Abort' : 'Generate'}
        </button>
        {!typesSurprise && types.length === 0 && <span className="section-hint">Pick at least one inflation type.</span>}
      </div>

      {steps.length > 0 && (
        <div className="cc-progress">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <strong>{running ? 'Generating…' : steps.some(x => x.status === 'error') ? 'Stopped' : 'Done'}</strong>
            <span className="section-hint">{steps.filter(x => x.status === 'done').length} / {steps.length}</span>
            <span style={{ flex: 1 }} />
            {running && <button type="button" className="btn btn-sm btn-danger" onClick={handleAbort}>Abort</button>}
          </div>
          <ul>
            {steps.map((s, i) => (
              <li key={i} style={{ opacity: s.status === 'pending' ? 0.5 : 1 }}>
                {s.status === 'done' ? '✓' : s.status === 'active' ? '…' : s.status === 'error' ? '✕' : '○'} {s.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default CharacterCreatorTab;
