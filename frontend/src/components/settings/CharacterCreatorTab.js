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

// Ordered roughly gentle → cruel (defined in PERSONALITY_TABLE below).
const PERSONALITIES = ['Nice', 'Neutral', 'Playful', 'Shy', 'Seductive', 'Clinical', 'Nurturing', 'Bratty', 'Mean', 'Dominant', 'Submissive', 'Obsessive', 'Sadistic', 'Unhinged'];

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

// Story Features — optional dynamic elements, each built programmatically (trees / triggers)
// with LLM-written text. Bands are fixed so features never collide with each other.
const STORY_FEATURES = [
  { key: 'choiceBranch', label: 'Branching Choice', hint: 'A Player Choice at 51–60% — the pick changes how the climax plays out.' },
  { key: 'extraChoices', label: 'Extra Player Choices', hint: 'Two smaller choices (21–30%, 71–80%) the scene reacts to.' },
  { key: 'randomEvents', label: 'Random Events', hint: 'Chance-based interruptions in four bands (knock at the door, a call, someone walks in…).' },
  { key: 'plotTwist', label: 'Plot Twist', hint: 'A mid-story reveal around 65%.' },
  { key: 'stakes', label: 'Stakes & Endings', hint: 'Something is at stake, and (without Enforce Bursting) a random ending type.' },
  { key: 'minigame', label: 'Minigame Checkpoint', hint: 'A game at 31–40% (dice, coin, rock-paper-scissors or wheel) — losing has consequences.' },
  { key: 'groupDynamics', label: 'Group Dynamics', hint: 'Multi-Char only — rivalry, a member switching sides, or competition over the pump.', multiOnly: true },
  { key: 'keywordGate', label: 'Keyword Gate', hint: 'At 81–90% the story waits until [Player] says a demanded word.' },
  { key: 'lore', label: 'Lore Entries', hint: 'A dictionary group for this card (the place, the group or reason behind the plot, side characters) — keyword-triggered, so it only costs context when mentioned.' },
];
const PACING = [
  { value: 'preset-standard', label: 'Standard' },
  { value: 'preset-slowburn', label: 'Slow Burn' },
  { value: 'preset-intense', label: 'Quick & Intense' },
];
// Endings when bursting isn't enforced (Stakes & Endings).
const ENDINGS = [
  { key: 'edge', prose: 'the climax is being impossibly full at the very edge — nobody bursts' },
  { key: 'release', prose: 'it ends in release — the pressure is finally let out, with relief and aftermath' },
  { key: 'escape', prose: 'the one being inflated escapes or is freed at the last possible moment' },
  { key: 'reversal', prose: 'roles reverse at the end — whoever was in control ends up on the pump' },
  { key: 'cliffhanger', prose: 'it ends on a cliffhanger — held at the edge with a promise of next time' },
];

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

// Seeded randomness for a generation run: the same seed + the same options replay the same picks,
// so Resume / Reroll re-issue identical prompts and hit the result cache (see lastRun).
let rand = Math.random;
const seededRandom = (seed) => {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const uid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- Personality table: ONE row per type → tone + every deterministic setting it drives ----
// attrs = per-message attribute chances (story.attributes); emotion = starting emotion;
// inflOthers/popBurst/popSafe = desires toward inflating/popping [Player]; selfDesire /
// selfPopBurst / selfPopSafe = how they feel about being inflated/popped themselves.
// Values must match the editor's option lists (desires, pop desires, EMOTIONS keys).
const PERSONALITY_TABLE = {
  Nice:      { tone: 'warm, kind, gentle and reassuring — caring about the other person even while the inflation happens',
    attrs: { dominant: 10, submissive: 25, sadistic: 0, psychopathic: 0, sensual: 40, sexual: 15 }, emotion: 'happy',
    inflOthers: 'curious', popBurst: 'willing', popSafe: 'avoidant', selfDesire: 'curious', selfPopBurst: 'anxious', selfPopSafe: 'anxious' },
  Neutral:   { tone: 'matter-of-fact, calm and detached — professional, curious, neither cruel nor tender',
    attrs: { dominant: 25, submissive: 15, sadistic: 5, psychopathic: 0, sensual: 20, sexual: 15 }, emotion: 'curious',
    inflOthers: 'neutral', popBurst: 'careless', popSafe: 'avoidant', selfDesire: 'neutral', selfPopBurst: 'resigned', selfPopSafe: 'anxious' },
  Playful:   { tone: 'playful, giggly and teasing in a fun way — treats the inflation like a game and loves a reaction',
    attrs: { dominant: 30, submissive: 15, sadistic: 10, psychopathic: 0, sensual: 30, sexual: 20 }, emotion: 'playful',
    inflOthers: 'eager', popBurst: 'curious', popSafe: 'careless', selfDesire: 'curious', selfPopBurst: 'curious', selfPopSafe: 'anxious' },
  Shy:       { tone: 'shy, flustered and soft-spoken — easily embarrassed, stammers, but quietly fascinated',
    attrs: { dominant: 5, submissive: 50, sadistic: 0, psychopathic: 0, sensual: 25, sexual: 10 }, emotion: 'shy',
    inflOthers: 'reluctant', popBurst: 'avoidant', popSafe: 'avoidant', selfDesire: 'nervous', selfPopBurst: 'dreading', selfPopSafe: 'terrified' },
  Seductive: { tone: 'sultry, flirtatious and seductive — slow, husky teasing; makes the inflation feel intimate and charged',
    attrs: { dominant: 40, submissive: 10, sadistic: 10, psychopathic: 0, sensual: 70, sexual: 55 }, emotion: 'aroused',
    inflOthers: 'eager', popBurst: 'curious', popSafe: 'avoidant', selfDesire: 'eager', selfPopBurst: 'curious', selfPopSafe: 'anxious' },
  Clinical:  { tone: 'cold, clinical and precise — speaks like a researcher taking measurements, emotionally detached',
    attrs: { dominant: 45, submissive: 0, sadistic: 15, psychopathic: 10, sensual: 0, sexual: 0 }, emotion: 'stoic',
    inflOthers: 'curious', popBurst: 'careless', popSafe: 'avoidant', selfDesire: 'neutral', selfPopBurst: 'indifferent', selfPopSafe: 'indifferent' },
  Nurturing: { tone: 'motherly, soothing and doting — praises and comforts constantly, insists it is all for their own good',
    attrs: { dominant: 35, submissive: 5, sadistic: 0, psychopathic: 0, sensual: 35, sexual: 5 }, emotion: 'loving',
    inflOthers: 'eager', popBurst: 'willing', popSafe: 'avoidant', selfDesire: 'curious', selfPopBurst: 'resigned', selfPopSafe: 'anxious' },
  Bratty:    { tone: 'bratty, snarky and defiant — whines, argues, rolls their eyes, acts like none of it is their fault',
    attrs: { dominant: 35, submissive: 20, sadistic: 15, psychopathic: 0, sensual: 10, sexual: 10 }, emotion: 'bratty',
    inflOthers: 'eager', popBurst: 'careless', popSafe: 'careless', selfDesire: 'reluctant', selfPopBurst: 'dreading', selfPopSafe: 'terrified' },
  Mean:      { tone: 'mocking, teasing, condescending and bratty — enjoys the other person\'s discomfort and embarrassment',
    attrs: { dominant: 60, submissive: 0, sadistic: 35, psychopathic: 5, sensual: 15, sexual: 15 }, emotion: 'mischievous',
    inflOthers: 'eager', popBurst: 'eager', popSafe: 'careless', selfDesire: 'reluctant', selfPopBurst: 'dreading', selfPopSafe: 'terrified' },
  Dominant:  { tone: 'commanding, strict and in total control — gives orders, expects obedience, never asks permission',
    attrs: { dominant: 90, submissive: 0, sadistic: 30, psychopathic: 5, sensual: 20, sexual: 20 }, emotion: 'dominant',
    inflOthers: 'eager', popBurst: 'willing', popSafe: 'careless', selfDesire: 'reluctant', selfPopBurst: 'resigned', selfPopSafe: 'anxious' },
  Submissive: { tone: 'meek, eager-to-please and obedient — apologises, asks for approval, does what they are told',
    attrs: { dominant: 0, submissive: 85, sadistic: 0, psychopathic: 0, sensual: 30, sexual: 20 }, emotion: 'submissive',
    inflOthers: 'reluctant', popBurst: 'avoidant', popSafe: 'avoidant', selfDesire: 'eager', selfPopBurst: 'willing', selfPopSafe: 'resigned' },
  Obsessive: { tone: 'fixated and intense — talks about bellies and fullness constantly, breathless, can never get enough',
    attrs: { dominant: 50, submissive: 10, sadistic: 30, psychopathic: 15, sensual: 40, sexual: 30 }, emotion: 'excited',
    inflOthers: 'obsessed', popBurst: 'eager', popSafe: 'curious', selfDesire: 'obsessed', selfPopBurst: 'eager', selfPopSafe: 'curious' },
  Sadistic:  { tone: 'cruel, cold and sadistic — takes real pleasure in pushing past limits, savours fear and strain',
    attrs: { dominant: 80, submissive: 0, sadistic: 85, psychopathic: 25, sensual: 20, sexual: 20 }, emotion: 'dominant',
    inflOthers: 'obsessed', popBurst: 'sadistic', popSafe: 'curious', selfDesire: 'eager', selfPopBurst: 'curious', selfPopSafe: 'indifferent' },
  Unhinged:  { tone: 'unhinged and unpredictable — giggles at the wrong moments, swings between sweet and terrifying',
    attrs: { dominant: 60, submissive: 10, sadistic: 60, psychopathic: 70, sensual: 15, sexual: 15 }, emotion: 'mischievous',
    inflOthers: 'obsessed', popBurst: 'sadistic', popSafe: 'curious', selfDesire: 'obsessed', selfPopBurst: 'eager', selfPopSafe: 'indifferent' },
};
// Legacy-shaped views over the table (the generator reads these by personality name).
const pmap = (field) => Object.fromEntries(Object.entries(PERSONALITY_TABLE).map(([k, v]) => [k, v[field]]));
const ATTRIBUTES = pmap('attrs');
const EMOTION = pmap('emotion');
const INFLATE_OTHERS = pmap('inflOthers');
const POP_OTHERS_BURST = pmap('popBurst');
const POP_OTHERS_SAFE = pmap('popSafe');
const SELF_DESIRE = pmap('selfDesire');
const SELF_POP_BURST = pmap('selfPopBurst');
const SELF_POP_SAFE = pmap('selfPopSafe');
const TONE = pmap('tone');

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

// Last Creator settings this tab saved — hydrating from it on remount means a change made just
// before leaving the tab is never replaced by an older copy.
let lastSavedCreator = null;

// The last generation run, kept across tab switches (the component unmounts when the new card opens):
// seed + every LLM result keyed by its exact prompt, grouped by progress step. Resume re-runs with the
// same seed so finished steps come straight from the cache; Reroll drops one step's results so that
// step (and everything written from it) is regenerated, then overwrites the same card.
let lastRun = null; // { seed, cache: Map, stepKeys: { [label]: Set }, status, savedId, personaId, loreGroupId, name }

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
  const [customLocation, setCustomLocation] = useState('');
  const [customPlot, setCustomPlot] = useState('');
  const [customType, setCustomType] = useState('');
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
  const [checkpointsPerWelcome, setCheckpointsPerWelcome] = useState(false);
  const [features, setFeatures] = useState({});
  const [pacing, setPacing] = useState('preset-standard');
  const [createPersona, setCreatePersona] = useState(false);
  const [personaGender, setPersonaGender] = useState('female');
  const toggleFeature = (k, v) => setFeatures(prev => ({ ...prev, [k]: v }));
  const [genderSurprise, setGenderSurprise] = useState(false);
  const [personalitySurprise, setPersonalitySurprise] = useState(false);
  const [memberGender, setMemberGender] = useState('same'); // same | random | female | male | nonbinary
  const [memberPersonality, setMemberPersonality] = useState('auto'); // auto | random | a PERSONALITIES type
  const [eventChance, setEventChance] = useState(25);
  const [runInfo, setRunInfo] = useState(() => (lastRun ? { ...lastRun } : null)); // drives Resume / Reroll
  const [rerollStep, setRerollStep] = useState('');
  const [randomizeTargets, setRandomizeTargets] = useState(false);
  const [randomizeOperators, setRandomizeOperators] = useState(false);
  const [newScenarioEach, setNewScenarioEach] = useState(false);

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]); // [{ label, status: 'pending'|'active'|'done'|'error' }]
  const cancelRef = useRef(false);

  // ---- Persist the Creator's choices server-side (settings.characterCreator) so they survive
  // app/browser restarts and follow the user across devices. Hydrate once when settings arrive,
  // then save (debounced) on change — never before hydration, or defaults would clobber them.
  const persisted = {
    gender: [gender, setGender], personality: [personality, setPersonality],
    inflated: [inflated, setInflated], inflatedSurprise: [inflatedSurprise, setInflatedSurprise],
    operator: [operator, setOperator], operatorSurprise: [operatorSurprise, setOperatorSurprise],
    types: [types, setTypes], typesSurprise: [typesSurprise, setTypesSurprise],
    location: [location, setLocation], locationSurprise: [locationSurprise, setLocationSurprise],
    customLocation: [customLocation, setCustomLocation], customPlot: [customPlot, setCustomPlot], customType: [customType, setCustomType],
    plot: [plot, setPlot], plotSurprise: [plotSurprise, setPlotSurprise],
    createCheckpoints: [createCheckpoints, setCreateCheckpoints], checkpointLevel: [checkpointLevel, setCheckpointLevel],
    enforceBursting: [enforceBursting, setEnforceBursting], welcomeCount: [welcomeCount, setWelcomeCount],
    randomizeTargets: [randomizeTargets, setRandomizeTargets], randomizeOperators: [randomizeOperators, setRandomizeOperators],
    newScenarioEach: [newScenarioEach, setNewScenarioEach], multiChar: [multiChar, setMultiChar],
    extraCount: [extraCount, setExtraCount], guidance: [guidance, setGuidance],
    checkpointsPerWelcome: [checkpointsPerWelcome, setCheckpointsPerWelcome],
    features: [features, setFeatures], pacing: [pacing, setPacing],
    createPersona: [createPersona, setCreatePersona], personaGender: [personaGender, setPersonaGender],
    genderSurprise: [genderSurprise, setGenderSurprise], personalitySurprise: [personalitySurprise, setPersonalitySurprise],
    memberGender: [memberGender, setMemberGender], memberPersonality: [memberPersonality, setMemberPersonality],
    eventChance: [eventChance, setEventChance],
  };
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef(null);
  const unmountingRef = useRef(false);
  // Declared before the save effect so its cleanup runs first on unmount.
  useEffect(() => () => { unmountingRef.current = true; }, []);
  useEffect(() => {
    // AppContext starts with a placeholder settings object; only hydrate from the server's real one
    // (it always carries globalCharacterControls), or saved choices would never load.
    if (hydratedRef.current || !settings || (settings.globalCharacterControls === undefined && settings.characterCreator === undefined)) return;
    // AppContext's settings are NOT refreshed by updateSettings, so after a save they still hold the
    // page-load copy. Prefer what this tab last saved, or a cleared field comes back on remount.
    const saved = lastSavedCreator || settings.characterCreator;
    if (saved && typeof saved === 'object') {
      for (const [k, [, setter]] of Object.entries(persisted)) {
        if (saved[k] !== undefined) setter(saved[k]);
      }
    }
    hydratedRef.current = true;
  }, [settings]);
  const persistedValues = Object.fromEntries(Object.entries(persisted).map(([k, [v]]) => [k, v]));
  const persistedJson = JSON.stringify(persistedValues);
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (JSON.stringify(lastSavedCreator || settings?.characterCreator || null) === persistedJson) return; // already saved
    lastSavedCreator = JSON.parse(persistedJson); // remount hydrates from this, not stale context settings
    clearTimeout(saveTimerRef.current);
    let done = false;
    const save = () => { if (done) return; done = true; api.updateSettings({ characterCreator: JSON.parse(persistedJson) }).catch(() => {}); };
    saveTimerRef.current = setTimeout(save, 800);
    // Leaving the tab inside the debounce window still saves (a cleared field must not be lost).
    return () => { clearTimeout(saveTimerRef.current); if (unmountingRef.current) save(); };
  }, [persistedJson]);
  const presetsRef = useRef(null);

  const gamesRef = useRef([]);
  useEffect(() => {
    apiFetch(`${API_BASE}/api/minigames`).then(d => { gamesRef.current = d?.games || []; }).catch(() => {});
  }, []);
  useEffect(() => {
    apiFetch(`${API_BASE}/api/checkpoint-presets`).then(d => { presetsRef.current = d?.presets || []; }).catch(() => {});
  }, []);

  const activePersona = personas?.find(p => p.id === settings?.activePersonaId);
  const llmDeviceControlOff = !settings?.globalCharacterControls?.allowLlmDeviceControl;

  const toggleType = (v) => setTypes(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));

  const setStep = (idx, status) => setSteps(prev => prev.map((s, i) => (i === idx ? { ...s, status } : s)));

  // One LLM call with cancel + rate-limit (429) backoff.
  // Creator guidance rides at the END of every prompt (small models weight the last thing they read).
  const guidanceRef = useRef('');
  // fmt = a label-format answer (KEY: value lines): runs cooler for reliable formatting and skips
  // the sentence trim (it would delete a last line like "POP: dreading" that has no punctuation).
  const stepLabelRef = useRef('');
  const llm = async (prompt, maxTokens, { noGuidance = false, fmt = false } = {}) => {
    const fullPrompt = !noGuidance && guidanceRef.current
      ? `${prompt}\n\n=== CREATOR'S GUIDANCE — MUST FOLLOW ===\n${guidanceRef.current}\nApply this to WHAT you write (people, relationships, tone, events). Keep the exact output format requested above.\n=== END GUIDANCE ===`
      : prompt;
    const key = `${fmt ? 'f' : 'p'}|${maxTokens}|${fullPrompt}`;
    if (lastRun) {
      const label = stepLabelRef.current || '?';
      (lastRun.stepKeys[label] = lastRun.stepKeys[label] || new Set()).add(key);
      if (lastRun.cache.has(key)) return lastRun.cache.get(key);
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      if (cancelRef.current) throw new Error('cancelled');
      try {
        const r = await api.generateText({ prompt: fullPrompt, maxTokens, ...(fmt ? { temperature: 0.7, trimIncomplete: false } : {}) });
        if (cancelRef.current) throw new Error('cancelled');
        const text = r?.text || '';
        if (lastRun && text) lastRun.cache.set(key, text);
        return text;
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

  // Generate: if there is guidance, one short call first pulls out anything that maps to a setting
  // (name, gender, personality, plot, location, target, operator, persona gender) — those override
  // the dropdowns for this run. Everything else in the guidance stays as prose steering.
  // mode: 'new' (fresh seed + empty cache) · 'resume' (same seed, finished steps from the cache) ·
  // 'reroll' (same seed, one step's cached results dropped, the same card is overwritten).
  const handleGenerate = async (mode = 'new', rerollLabel = '') => {
    if (running) { handleAbort(); return; }
    if (mode === 'new' || !lastRun) {
      lastRun = { seed: (Math.random() * 2 ** 31) >>> 0, cache: new Map(), stepKeys: {}, status: 'running', savedId: null, personaId: null, loreGroupId: null, name: '' };
    } else if (mode === 'reroll') {
      for (const k of lastRun.stepKeys[rerollLabel] || []) lastRun.cache.delete(k);
    }
    lastRun.status = 'running';
    lastRun.mode = mode === 'reroll' || (mode === 'resume' && lastRun.savedId) ? 'update' : 'create';
    lastRun.stepKeys = mode === 'new' ? {} : lastRun.stepKeys;
    rand = seededRandom(lastRun.seed);
    setRunInfo({ ...lastRun });
    const gText = String(guidance || '').trim().slice(0, 600);
    guidanceRef.current = gText;
    cancelRef.current = false;
    const ov = {};
    // The pre-pass only pays off when the guidance names something a setting controls; pure tone
    // notes ("keep it playful, darker later") skip it and only ride along as prose steering.
    const cueRe = new RegExp(`\\b(nam(e|ed)|call(ed)?|female|male|woman|man|girl|boy|guy|lady|non.?binary|enby|${[...PERSONALITIES, ...PLOTS.map(x => x.label), ...LOCATIONS.flatMap(x => x.label.split(' '))].map(x => escapeRe(x.toLowerCase())).join('|')}|inflat\\w*|pump\\w*|enema|air|fluid|water|burst\\w*|pop\\w*|welcome|opening|member|group|friends?|checkpoint\\w*|player|i am|i'm|clinic|office|school|house|room|location|place)\\b`, 'i');
    if (gText && cueRe.test(gText)) {
      setRunning(true);
      stepLabelRef.current = 'Reading guidance';
      setSteps([{ label: 'Reading guidance', status: 'active' }]);
      try {
        const raw = await llm(`Read this guidance for a roleplay character generator and extract ONLY what it states explicitly. Use NONE for anything not clearly stated — do not guess.

GUIDANCE: «${gText}»

Answer EXACTLY in this format:
NAME: <the main character's name, or NONE>
GENDER: <female, male, nonbinary, or NONE — the main character>
PERSONALITY: <one of: ${PERSONALITIES.join(', ')} — or NONE>
PLOT: <one of: ${PLOTS.map(x => x.label).join(', ')} — or a short description of another plot — or NONE>
LOCATION: <one of: ${LOCATIONS.map(x => x.label).join(', ')} — or a short description of another place — or NONE>
INFLATION: <one of: ${INFLATION_TYPES.map(x => x.label).join(', ')} — or a short description of another method — or NONE>
INFLATED: <player, character, both, or NONE — who gets inflated>
OPERATOR: <player, character, story, shared, or NONE — who runs the pump>
PLAYER_GENDER: <female, male, nonbinary, or NONE — the player's gender>
WELCOMES: <1, 2 or 3 — how many opening messages, or NONE>
MEMBERS: <0, 1 or 2 — how many EXTRA characters besides the main one, or NONE>
BURSTING: <yes or no — must the story end in a burst/pop, or NONE>
CHECKPOINTS: <off, minimal, balanced or thorough — or NONE>`, 180, { noGuidance: true, fmt: true });
        const field = (k) => {
          const m = String(raw).match(new RegExp(`^\\s*${k}\\s*:\\s*(.+)$`, 'im'));
          const v = m ? m[1].trim().replace(/^["'*]+|["'*.]+$/g, '') : '';
          return /^none\b/i.test(v) ? '' : v;
        };
        const match = (v, list, key = 'value', lab = 'label') => {
          const t = String(v).toLowerCase();
          return t ? list.find(x => t === String(x[key]).toLowerCase() || t === String(x[lab]).toLowerCase() || t.includes(String(x[lab]).toLowerCase())) : null;
        };
        const gen = (v) => {
          const t = String(v).toLowerCase();
          return /non.?binary|enby|they/.test(t) ? 'nonbinary' : /^(female|woman|girl|she)/.test(t) ? 'female' : /^(male|man|boy|he)/.test(t) ? 'male' : '';
        };
        const name = field('NAME');
        if (name && name.length <= 40 && /^[\p{L}][\p{L}' .-]*$/u.test(name)) ov.name = name;
        const gg = gen(field('GENDER')); if (gg) ov.gender = gg;
        const pers = PERSONALITIES.find(x => x.toLowerCase() === field('PERSONALITY').toLowerCase()); if (pers) ov.personality = pers;
        const plText = field('PLOT');
        const pl = match(plText, PLOTS);
        if (pl) ov.plot = pl.value;
        else if (plText && plText.length <= 160) { ov.plot = 'custom'; ov.customPlot = plText; }
        const tyText = field('INFLATION');
        const ty = match(tyText, INFLATION_TYPES) || INFLATION_TYPES.find(x => tyText.toLowerCase().includes(x.value));
        if (ty) ov.types = [ty.value];
        else if (tyText && tyText.length <= 160) { ov.types = ['custom']; ov.customType = tyText; }
        const locText = field('LOCATION');
        const lc = match(locText, LOCATIONS);
        if (lc) ov.location = lc.value;
        else if (locText && locText.length <= 120) { ov.location = 'custom'; ov.customLocation = locText; } // a place not on the list
        const inf = match(field('INFLATED'), INFLATED.filter(x => x.value !== 'mix')); if (inf) ov.inflated = inf.value;
        const opv = match(field('OPERATOR'), OPERATORS.filter(x => x.value !== 'mix'), 'value', 'value'); if (opv) ov.operator = opv.value;
        const pg = gen(field('PLAYER_GENDER')); if (pg) ov.personaGender = pg;
        const nw = Number((field('WELCOMES').match(/[1-3]/) || [])[0]); if (nw) ov.welcomeCount = nw;
        const nmM = field('MEMBERS').match(/[0-2]/);
        if (nmM) { const nm = Number(nmM[0]); ov.multiChar = nm > 0; if (nm > 0) ov.extraCount = nm; }
        const bu = field('BURSTING').toLowerCase(); if (/^(yes|true)/.test(bu)) ov.enforceBursting = true; else if (/^(no|false)/.test(bu)) ov.enforceBursting = false;
        const ck = field('CHECKPOINTS').toLowerCase().match(/off|minimal|balanced|thorough/);
        if (ck) { ov.createCheckpoints = ck[0] !== 'off'; if (ck[0] !== 'off') ov.checkpointLevel = ck[0]; }
        console.log('[CharacterCreator] guidance overrides:', ov);
      } catch (e) {
        if (e?.message === 'cancelled') {
          setRunning(false);
          setSteps(prev => prev.map(x => ({ ...x, status: 'error' })));
          lastRun.status = 'failed'; setRunInfo({ ...lastRun });
          showError?.('Character generation aborted');
          return;
        }
        console.warn('[CharacterCreator] guidance extraction failed — using the dropdowns:', e);
      }
    }
    const has = (k) => ov[k] !== undefined;
    await runGeneration({
      gender: ov.gender || (genderSurprise ? pick(GENDERS).value : gender),
      personality: ov.personality || (personalitySurprise ? pick(PERSONALITIES) : personality),
      welcomeCount: has('welcomeCount') ? ov.welcomeCount : welcomeCount,
      multiChar: has('multiChar') ? ov.multiChar : multiChar,
      extraCount: has('extraCount') ? ov.extraCount : extraCount,
      enforceBursting: has('enforceBursting') ? ov.enforceBursting : enforceBursting,
      createCheckpoints: has('createCheckpoints') ? ov.createCheckpoints : createCheckpoints,
      checkpointLevel: ov.checkpointLevel || checkpointLevel,
      inflated: ov.inflated || inflated, inflatedSurprise: ov.inflated ? false : inflatedSurprise,
      operator: ov.operator || operator, operatorSurprise: ov.operator ? false : operatorSurprise,
      location: ov.location || location, locationSurprise: ov.location ? false : locationSurprise,
      customLocation: ov.customLocation || customLocation,
      customPlot: ov.customPlot || customPlot,
      types: ov.types || types, typesSurprise: ov.types ? false : typesSurprise,
      customType: ov.customType || customType,
      plot: ov.plot || plot, plotSurprise: ov.plot ? false : plotSurprise,
      personaGender: ov.personaGender || personaGender,
      nameOverride: ov.name || '',
    });
  };

  const runGeneration = async (o) => {
    // Shadow the dropdown state with this run's resolved choices (guidance overrides win).
    const { gender, personality, inflated, inflatedSurprise, operator, operatorSurprise, location, locationSurprise, customLocation, plot, plotSurprise, personaGender, nameOverride, customPlot, types, typesSurprise, customType,
      welcomeCount, multiChar, extraCount, enforceBursting, createCheckpoints, checkpointLevel } = o;

    // ---- Resolve choices (Surprise Me picks at random) ----

    const g = GENDERS.find(x => x.value === gender) || GENDERS[0];
    const who = inflatedSurprise ? pick(INFLATED).value : inflated;
    const op = operatorSurprise ? pick(OPERATORS).value : operator;
    let typeVals = typesSurprise
      ? [...INFLATION_TYPES].sort(() => rand() - 0.5).slice(0, 1 + Math.floor(rand() * 2)).map(t => t.value)
      : types;
    if (!typeVals.length) typeVals = ['air'];
    const customText = String(customLocation || '').trim();
    const loc = (!locationSurprise && location === 'custom' && customText)
      ? { value: 'custom', label: customText.length > 32 ? `${customText.slice(0, 30)}…` : customText, prose: customText }
      : (LOCATIONS.find(l => l.value === (locationSurprise ? pick(LOCATIONS).value : location)) || LOCATIONS[0]);
    const customTypeText = String(customType || '').trim();
    const methods = [
      ...INFLATION_TYPES.filter(t => typeVals.includes(t.value)),
      ...(typeVals.includes('custom') && customTypeText ? [{ value: 'custom', label: customTypeText.length > 28 ? `${customTypeText.slice(0, 26)}…` : customTypeText, prose: customTypeText }] : []),
    ];
    if (!methods.length) methods.push(INFLATION_TYPES[0]); // "Custom" ticked with an empty box
    const methodProse = methods.map(m => m.prose).join(', and/or ');
    const methodLabel = methods.map(m => m.label).join(' + ');

    const charName = nameOverride || `${pick(NAMES[g.value].first)} ${pick(LAST_NAMES)}`;
    const newPersonaG = createPersona ? (GENDERS.find(x => x.value === personaGender) || GENDERS[0]) : null;
    const personaName = createPersona ? '' : (activePersona?.displayName || '');
    const personaPronouns = newPersonaG ? newPersonaG.pronouns : (activePersona?.pronouns || 'they/them');
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
    // One checkpoint set per welcome (auto-switched by the picked welcome) vs ONE shared set (default).
    let perWelcomeCkpts = nWelcome > 1 && checkpointsPerWelcome; // also forced on below when welcomes track different gauges
    // Story Features (multiOnly ones need a group).
    const F = (k) => !!features?.[k] && !(STORY_FEATURES.find(x => x.key === k)?.multiOnly && !multiChar);
    const gameChoices = (gamesRef.current || []).filter(x => ['mg-default-dice', 'mg-default-coin', 'mg-default-rps', 'mg-default-wheel'].includes(x.id));
    const game = F('minigame') && gameChoices.length ? pick(gameChoices) : null;
    let stakeText = '';
    let dynamicText = '';
    let dynamicBeat = '';
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
    const customPlotText = String(customPlot || '').trim();
    const customPlotObj = customPlotText ? { value: 'custom', label: customPlotText.length > 28 ? `${customPlotText.slice(0, 26)}…` : customPlotText, prose: customPlotText } : null;
    const variantPlots = [plotSurprise ? pick(PLOTS) : (plot === 'custom' && customPlotObj ? customPlotObj : (PLOTS.find(p => p.value === plot) || PLOTS[0]))];
    for (let v = 1; v < nWelcome; v++) {
      if (!plotSurprise || !(newScenarioEach || randomTargets || randomOps)) { variantPlots.push(variantPlots[0]); continue; }
      const unused = PLOTS.filter(p => !variantPlots.includes(p));
      variantPlots.push(unused.length ? pick(unused) : pick(PLOTS));
    }
    const mixedPlots = new Set(variantPlots.map(p => p.value)).size > 1;

    // Multi-Char: 1-2 additional group members (gender + personality type per the Members selects). Per variant,
    // some are present from the opening and some ARRIVE later (a checkpoint step brings them in).
    const extras = [];
    if (multiChar) {
      for (let i = 0; i < Math.max(1, Math.min(2, Number(extraCount) || 1)); i++) {
        const mg = memberGender === 'same' ? g : memberGender === 'random' ? pick(GENDERS) : (GENDERS.find(x => x.value === memberGender) || g);
        const mp = memberPersonality === 'auto' ? '' : memberPersonality === 'random' ? pick(PERSONALITIES) : memberPersonality;
        const pool = NAMES[mg.value].first.filter(n => !usedFirst.has(n));
        const first = pick(pool.length ? pool : NAMES[mg.value].first);
        usedFirst.add(first);
        // Not everyone is on the character's side: some are the player's friend or a near-stranger.
        const relations = [
          "[Player]'s close friend, who came along with [Player]",
          "a casual acquaintance of [Player] — they barely know each other",
          `${charName}'s friend and accomplice`,
          'a stranger who just happens to be here',
        ];
        const relation = pick(relations.filter(r => !extras.some(x => x.relation === r)));
        extras.push({ arrivalOffset: 1 + Math.floor(rand() * 6), id: `m-${Date.now()}-${i + 1}`, name: `${first} ${pick(LAST_NAMES)}`, relation, g: mg, ptype: mp, description: '', personality: '', hardInstruct: '', pumpable: false });
      }
    }
    // ---- Random Mix resolution (needs the group cast) ----
    // Target: a random combination of [Player], the main character and individual members — always
    // including [Player] or the main character, since checkpoints can only track those two gauges.
    // Resolves to the usual player/character/both + a per-variant SET of inflated members.
    const coin = () => rand() < 0.5;
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
    // A shared set tracks ONE gauge (the player's if any welcome inflates the player). A welcome that
    // inflates only the character would then never move it — none of its beats would fire — so
    // welcomes that track different gauges always get their own sets.
    const trackOf = (w) => (w === 'player' || w === 'both' ? 'player' : 'char');
    const forcedPerWelcome = nWelcome > 1 && !perWelcomeCkpts && new Set(variantWho.map(trackOf)).size > 1;
    if (forcedPerWelcome) perWelcomeCkpts = true;
    // Ending (Stakes & Endings, no forced burst). Reversal needs someone to put the character on the
    // pump at the end: only when every welcome inflates just [Player] and the character side pumps.
    const canReverse = variantWho.every(w => w === 'player') && variantOps.every(x => ['character', 'story'].includes(x.op));
    const ending = F('stakes') && !enforceBursting ? pick(ENDINGS.filter(e => e.key !== 'reversal' || canReverse)) : null;
    const reversal = ending?.key === 'reversal';

    const ARRIVAL_RANGES = ['41-50', '61-70'];
    const makeArrivals = () => {
      if (!extras.length) return [];
      if (extras.length === 1) return [rand() < 0.5 ? 'start' : 'late'];
      return rand() < 0.5 ? ['start', 'late'] : ['late', 'start']; // two: one opens, one arrives
    };
    const variantArrivals = [makeArrivals()];
    // A shared checkpoint set fires arrival steps for every welcome, so arrival timing must be shared too.
    for (let v = 1; v < nWelcome; v++) variantArrivals.push(perVariantScenario && perWelcomeCkpts ? makeArrivals() : variantArrivals[0]);
    // Late members in order → the range each one arrives in.
    const arrivalPlan = (arr) => {
      let n = 0;
      return extras.map((m, i) => (arr[i] === 'late' ? { m, range: ARRIVAL_RANGES[n++] || '61-70', offset: m.arrivalOffset } : null)).filter(Boolean);
    };
    const castLine = (arr, w, ms) => {
      const membersInflated = (m) => (ms ? ms.has(m.id) : (w === 'character' || w === 'both')); // this story's target
      if (!extras.length) return '';
      const parts = extras.map((m, i) => {
        const prof = m.description ? ` — ${m.description.split(/(?<=[.!?])\s/).slice(0, 2).join(' ')}` : '';
        const when = !arr ? '' : arr[i] === 'late'
          ? ` NOT present at the start — arrives later (around ${arrivalPlan(arr).find(a => a.m === m)?.range.split('-')[0]}% capacity); only mention them as expected/absent before that`
          : ' present from the very start';
        return `${m.name} (${m.g.label.toLowerCase()}, ${m.g.pronouns}, ${m.relation})${prof};${when}${m.pumpable && membersInflated(m) ? `; ${m.name.split(' ')[0]} ALSO gets inflated (${methodLabel.toLowerCase()}) with their own belly and fullness` : ''}`;
      });
      return `\n- Group cast (they share the scene with ${charName} and also speak in replies): ${parts.join(' | ')}.`;
    };
    // Everyone on the character side: the main character plus any group members.
    const castNames = [charName, ...extras.map(m => m.name)];
    // Names the RP formatter keeps as bare "Name:" labels (group members, plus a story char) —
    // without them a group welcome came out as *Mara:* "...".
    const welcomeSpeakers = (o) => {
      const names = [...(extras.length ? castNames : []), ...(o?.op === 'story' && o.npcName ? [o.npcName] : [])];
      return names.length ? [...names, charName].flatMap(n => [n, n.split(' ')[0]]) : [];
    };
    const castText = castNames.length > 1 ? `${castNames.slice(0, -1).join(', ')} and ${castNames[castNames.length - 1]}` : charName;
    const operatorTextOf = (o) => (o.op === 'any' ? 'whoever runs the pump in the current scenario (it differs between openings — follow the scenario)'
      : o.op === 'player' ? '[Player]'
      : o.op === 'character' ? (extras.length ? `${castText} (the characters together)` : charName)
        : o.op === 'shared' ? `everyone — [Player] and ${castText} share control of the pump (taking turns, handing it off, or fighting over it)`
          : o.op === 'mix' ? `${joinNames(o.names)} — sharing control of the pump (taking turns or fighting over it)${o.includesPlayer ? '; [Player] has a hand on it too' : ''}`
          : `${o.npcName} (a supporting character, ${g.pronouns})`);
    const opLabel = (o) => (o.op === 'any' ? 'Operator varies' : o.op === 'player' ? 'Player pumps' : o.op === 'character' ? (extras.length ? 'Chars pump' : 'Char pumps')
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
    const ckptLabel = (k) => (k === '100+' ? 'Burst beat' : `Checkpoint ${k}%`);
    const featureSteps = (tag) => [
      ...(F('choiceBranch') ? [`${tag}Branching choice`] : []),
      ...(F('extraChoices') ? [`${tag}Extra choice 1`, `${tag}Extra choice 2`] : []),
      ...(F('randomEvents') ? [`${tag}Random events`] : []),
      ...(F('plotTwist') ? [`${tag}Plot twist`] : []),
      ...(F('keywordGate') ? [`${tag}Keyword gate`] : []),
    ];
    const stepList = ['Description & personality', ...extras.map((m, i) => `Group member ${i + 1}`), 'Example dialogue',
      ...(F('stakes') ? ['Stakes'] : []), ...(F('groupDynamics') && extras.length ? ['Group dynamics'] : [])];
    for (let v = 0; v < nWelcome; v++) {
      const ownStory = v === 0 || perVariantScenario;
      if (ownStory && variantOps[v].op === 'story') stepList.push(`${vTag(v)}Story char`);
      if (ownStory) stepList.push(`${vTag(v)}Scenario`);
      stepList.push(`${vTag(v)}Welcome message`);
      if (perWelcomeCkpts) { ckptRanges.forEach(k => stepList.push(`${vTag(v)}${ckptLabel(k)}`)); stepList.push(...featureSteps(vTag(v))); }
    }
    if (!perWelcomeCkpts) { ckptRanges.forEach(k => stepList.push(ckptLabel(k))); stepList.push(...featureSteps('')); } // shared set runs after every welcome
    if (F('lore')) stepList.push('Lore entries');
    if (createPersona) stepList.push('Persona');
    stepList.push('Saving character');
    setSteps(stepList.map(label => ({ label, status: 'pending' })));
    cancelRef.current = false;
    setRunning(true);

    const clean = (t) => cleanText(t, { personaName, charName });

    // Shared story brief — every prompt gets the same facts so the fields stay cohesive. `w` =
    // this variant's inflation target (null = card-level text that must fit every variant).
    const guidanceText = String(guidance || '').trim().slice(0, 600);
    const briefFor = (w, o, pl, arr, ms) => `STORY FACTS (keep every detail consistent with these):
- Character: ${charName} (${g.label.toLowerCase()}, ${g.pronouns}).
- Personality type: ${personality} — ${TONE[personality]}.
- The player is written as [Player] (never invent a name). For the player's pronouns write [Gender] (e.g. "[Gender] belly", "looks at [Gender]") — it resolves at runtime.
- [Player] is ${playerGenderText}. Write [Player]'s body, clothing, and how ${charName} addresses and treats [Gender] to fit that gender (e.g. ${playerAddress}).
- Location: ${loc.prose}.
- Inflation method: ${methodProse}.
- Plot: ${pl ? `${pl.prose}. Build the story's motive, stakes and escalation around this plot.` : 'varies between stories — do NOT commit to one specific plot here'}.
- Being inflated: ${w ? victimOf(w, ms) : 'varies between stories ([Player], ' + charName + ', or both) — do NOT commit to who'}.
- Operating the pump: ${o ? operatorTextOf(o) : 'named in each scenario — do NOT mention who here'}.${o?.op === 'story' ? `\n- ${o.npcName} is a supporting character who exists only in this scene${o.npcProfile ? `: ${o.npcProfile}` : ''}. ${charName}'s replies also narrate and voice ${o.npcName}${o.npcVoice ? `, who ${o.npcVoice}` : ''}.` : ''}
${castLine(arr, w, ms)}
- Ending: ${enforceBursting ? `the scene builds toward a burst — ${w ? victimOf(w, ms) : 'someone'} will ultimately be inflated until they burst/pop.` : ending ? `${ending.prose}.` : 'the scene builds to maximum fullness but nobody bursts — the climax is being impossibly full at the very edge.'}${stakeText ? `\n- At stake: ${stakeText}` : ''}${dynamicText ? `\n- Group dynamic: ${dynamicText}` : ''}
- Equipment rule: the nozzle/tube is always shown being inserted BEFORE any inflation is described — no filling, swelling or pressure until it is in place.`;

    const style = `STYLE: grounded, sensory, natural language — no purple prose. Never write the player's dialogue or decisions. Use [Player] for the player's name. Output ONLY the requested text, no headings, no notes, no explanations.`;

    let idx = 0;
    const run = async (fn) => { stepLabelRef.current = stepList[idx]; setStep(idx, 'active'); const out = await fn(); setStep(idx, 'done'); idx++; return out; };

    try {
      // Card-level text must fit every variant and never mention a story char (they live only in
      // their own scenario/welcome).
      const cardBrief = briefFor(randomTargets ? null : variantWho[0], (randomOps || variantOps[0].op === 'story') ? null : variantOps[0], mixedPlots ? null : variantPlots[0], undefined, randomTargets ? undefined : variantMembers[0]);
      const cardWho = randomTargets ? null : variantWho[0];
      // Description + personality + voice line in ONE structured call (saves two full-brief prompts);
      // any part that doesn't parse falls back to its own call inside the same step.
      const voiceFix = (raw) => {
        let line = (String(raw || '').split('\n').map(l => l.trim()).find(Boolean) || '').replace(/^["“']+|["”']+$/g, '').trim();
        if (line && !/^speak like/i.test(line)) line = `Speak like ${line.replace(/^[A-Z]/, c => c.toLowerCase())}`;
        if (line && !/[.!]$/.test(line)) line += '.';
        return line;
      };
      const { description, persText, hardInstruct } = await run(async () => {
        const raw = String(await llm(`You are writing a roleplay character card.
${cardBrief}

Write three parts for ${charName}, using EXACTLY these labels:
DESCRIPTION:
<2 short paragraphs, third person: their appearance, clothing, background, how they came to be at this location, and their relationship to [Player]${extras.length ? ` and to ${extras.map(m => m.name).join(' and ')}` : ''}. Mention how they feel about inflation and their role in it${cardWho ? ` (${cardWho === 'player' ? 'they are involved in inflating [Player]' : 'they are going to be inflated'})` : ''}.>
PERSONALITY: <one line of 6-10 comma-separated traits, then one or two sentences on how they speak and behave toward [Player] during the inflation — match the "${personality}" personality type>
VOICE: <ONE short sentence (under 20 words) starting with "Speak like" — a concrete, modern speaking style, e.g. "Speak like a cold, calculating medical professional." Plain words, nothing archaic or poetic>
${style}`, 700, { fmt: true }) || '');
        let d = clean((raw.match(/DESCRIPTION\s*:\s*([\s\S]*?)(?=\n\s*\**PERSONALITY\s*:|$)/i) || [])[1] || '');
        let p = clean((raw.match(/PERSONALITY\s*:\s*([\s\S]*?)(?=\n\s*\**VOICE\s*:|$)/i) || [])[1] || '').replace(/\s*\n\s*/g, ' ');
        let hv = voiceFix(clean((raw.match(/VOICE\s*:\s*([^\n]+)/i) || [])[1] || ''));
        if (d.length < 80) {
          d = clean(await llm(`You are writing a roleplay character card.
${cardBrief}

Write ${charName}'s DESCRIPTION in third person, 2 short paragraphs: their appearance, clothing, background, how they came to be at this location, and their relationship to [Player]${extras.length ? ` and to ${extras.map(m => m.name).join(' and ')}` : ''}. Mention how they feel about inflation and their role in it${cardWho ? ` (${cardWho === 'player' ? 'they are involved in inflating [Player]' : 'they are going to be inflated'})` : ''}.
${style}`, 450));
        }
        if (p.length < 20) {
          p = clean(await llm(`You are writing a roleplay character card.
${cardBrief}

Write ${charName}'s PERSONALITY: one line of 6-10 comma-separated traits, then one or two sentences on how they speak and behave toward [Player] during the inflation. Match the "${personality}" personality type.
${style}`, 160));
        }
        if (!hv) hv = voiceFix(clean(await llm(`You are writing a roleplay character card.
${cardBrief}

Personality: ${p}

Write ONE short sentence (under 20 words) telling the writer how ${charName} speaks, starting with "Speak like". Name a concrete, modern speaking style. Plain words — no archaic or poetic style. Output only that sentence.`, 60)));
        return { description: d, persText: p, hardInstruct: hv || `Speak like a ${TONE[personality].split(' — ')[0].split(',')[0]} person, in plain modern language.` };
      });

      // Group members: description / personality / voice in one structured call each.
      for (const m of extras) {
        const others = extras.filter(x => x !== m && x.description).map(x => `${x.name}: ${x.description.slice(0, 200)}`).join('\n');
        const raw = await run(async () => llm(`You are writing a supporting group member for a roleplay character card.
${cardBrief}

Main character ${charName}:
${description}
${others ? `\nOther group member(s):\n${others}\n` : ''}
Create ${m.name} (${m.g.label.toLowerCase()}, ${m.g.pronouns}) — a distinct person with their own look and attitude. Their relationship: ${m.relation}.${m.ptype ? ` Personality type: ${m.ptype} — ${TONE[m.ptype]}.` : ''} Use EXACTLY this format:
DESCRIPTION: <2-3 sentences: appearance, who they are, why they are here, relationship to ${charName}>
PERSONALITY: <6-8 comma-separated traits>
VOICE: <one sentence starting with "Speak like", a concrete modern speaking style different from ${charName}'s>`, 260, { fmt: true }));
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

      const dialogueRaw = await run(async () => llm(`You are writing example dialogue for a roleplay character card.
${cardBrief}

Write 2 short example exchanges showing how ${charName} talks. Use EXACTLY this format, nothing else:
PLAYER: <a short line [Player] might say>
CHAR: <${extras.length ? `the group's reply on ONE line — ${charName} and ${extras.map(m => m.name.split(' ')[0]).join('/')} each speak, every speaker's part starting with their name, e.g. ${charName.split(' ')[0]}: *smirks* "..." ${extras[0].name.split(' ')[0]}: *laughs* "..."` : `${charName}'s in-character reply with *actions* and "dialogue", 1-3 sentences`}>
PLAYER: <...>
CHAR: <...>`, 350, { fmt: true }));
      const exampleDialogues = [];
      {
        const lines = String(dialogueRaw || '').split('\n').map(l => l.trim()).filter(Boolean);
        // Cast names stay as bare "Name:" labels. A group reply the model split over several lines
        // (one "Name: ..." line per speaker) is joined back into one reply instead of keeping only the first.
        const speakerNames = extras.length ? castNames.flatMap(n => [n, n.split(' ')[0]]) : [];
        const castRe = speakerNames.length ? new RegExp(`^\\**(${speakerNames.map(escapeRe).join('|')})\\**\\s*:\\s*(.+)$`) : null;
        let user = null; let reply = null;
        const flush = () => { if (user && reply) exampleDialogues.push({ user, character: enforceRpFormat(reply, speakerNames) }); reply = null; };
        for (const l of lines) {
          const pm = l.match(/^\**(PLAYER|\[Player\]|USER)\**\s*:\s*(.+)$/i);
          const cm = l.match(/^\**(CHAR|CHARACTER|\[Char\])\**\s*:\s*(.+)$/i);
          const nm = castRe ? l.match(castRe) : null;
          if (pm) { flush(); user = clean(pm[2]); }
          else if (cm && user) { flush(); reply = clean(cm[2]); }
          else if (nm && user) reply = reply ? `${reply} ${nm[1]}: ${clean(nm[2])}` : `${nm[1]}: ${clean(nm[2])}`;
          else if (!extras.length && user && !reply && /^[A-Z][a-z]+\s*:/.test(l)) reply = clean(l.replace(/^[A-Z][a-z]+\s*:\s*/, '')); // "Mara: ..." for a solo card
        }
        flush();
      }

      if (F('stakes')) {
        stakeText = await run(async () => trimToLength(clean(await llm(`You are writing a roleplay character card.
${cardBrief}

In ONE short sentence, say what is at stake in this story — a bet, a debt, a secret, a job, someone's freedom, a reward. Make it concrete and fit the plot. Output only that sentence.`, 70)), 1, 30));
      }
      if (F('groupDynamics') && extras.length) {
        const raw = await run(async () => llm(`You are writing a roleplay character card.
${cardBrief}

Invent ONE tension inside the group (${castText}): a rivalry, someone secretly on [Player]'s side, someone switching sides partway, or members competing over the pump. Use EXACTLY:
DYNAMIC: <one sentence describing the tension>
BEAT: <one short sentence: the moment it surfaces in the scene — no dialogue>`, 140, { fmt: true }));
        dynamicText = trimToLength(clean((String(raw).match(/DYNAMIC\s*:\s*([^\n]+)/i) || [])[1] || ''), 1, 35);
        dynamicBeat = sanitizeBeat(clean((String(raw).match(/BEAT\s*:\s*([^\n]+)/i) || [])[1] || ''));
      }

      const preset = (presetsRef.current || []).find(p => p.id === pacing) || (presetsRef.current || []).find(p => p.id === 'preset-standard');

      // Build one checkpoint profile for a variant (target `w`, scenario text). Returns
      // { profile, charThemes, autoPumpOperator }.
      // sp = { ms, plot, arrivals, autoPump, startBase, startMembers, varies, name } — either one
      // welcome's own settings, or the union of every welcome for the shared set.
      const buildProfile = async (w, o, scenario, sp) => {
        const ms = sp.ms;
        const brief = briefFor(w, o, sp.plot, sp.arrivals, ms);
        const { op, npcName } = o;
        const operatorText = operatorTextOf(o);
        const playerInflated = w === 'player' || w === 'both';
        const charInflated = w === 'character' || w === 'both';
        const victimText = sp.varies ? `${victimOf(w, ms)} (exactly who varies by opening — follow the scenario)` : victimOf(w, ms);
        const themes = {};
        for (const k of RANGE_KEYS) themes[k] = { mainTheme: preset?.ranges?.[k]?.mainTheme || FALLBACK_THEMES[k] };
        const triggers = {}; // `${track}-${range}` → { sequential: [], random: [] }
        const charThemes = {}; // story.characterCheckpoints (char-capacity stage directions)
        // Primary track = player capacity when the player is inflated, else the character's.
        const track = playerInflated ? 'player' : 'char';
        const autoPumpOperator = sp.autoPump; // char/NPC drives the real pump (in EVERY welcome, for a shared set)
        const priorBeats = [];
        // Insert one trigger into a band's sequential list at its Fire% (kept ascending). before=true goes
        // ahead of same-% entries (a pump stop must land before the beat that describes it).
        const insertSeq = (k, item, fp, before = false) => {
          const cur = triggers[k] || { sequential: [], random: [] };
          item.firePercent = fp;
          const at = cur.sequential.findIndex(t => (before ? Number(t.firePercent) >= fp : Number(t.firePercent) > fp));
          cur.sequential.splice(at < 0 ? cur.sequential.length : at, 0, item);
          triggers[k] = cur;
        };

        for (const rk of ckptRanges) {
          const [lo, hi] = RANGE_BOUNDS[rk];
          const nSteps = rk === '100+' ? 1 : plan.steps;
          const isClimax = rk === '91-100';
          const isBurst = rk === '100+';
          const climaxNote = isBurst
            ? `This is the BURST: ${track === 'player' ? '[Player]' : charName} has gone past the limit and pops. Write the burst moment and its immediate aftermath.`
            : isClimax
              ? (enforceBursting ? `This is the climax: ${victimText} is at absolute capacity and right on the verge of bursting — ${operatorText} keeps going.` : `This is the climax: ${victimText} is impossibly full — ${ending ? ending.prose : 'the inflation stops at the very edge, nobody bursts'}.`)
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
Good: "${charName} notices how quickly the belly is rounding and teases [Player] about it." Bad: "${charName} kneels and says \"look at you\" while adjusting the nozzle."`, 140 + nSteps * 60, { fmt: true }));

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
          // Climax BEATS (story text). The pump controls that go with them are added after the loop,
          // so they still apply with Create Checkpoints off.
          if (isClimax) {
            if (track === 'player' && !enforceBursting && autoPumpOperator) {
              seq.push({ id: uid('trg'), type: 'ai_message', firePercent: 99, context: beatContext(ending && ending.key !== 'edge'
                ? `The pump stops and the ending plays out now: ${ending.prose}.`
                : `${op === 'story' ? npcName : op === 'character' ? charName : 'Whoever is running the pump'} shuts it off at the very edge — [Player] is as full as [Gender] can possibly be, and ${charName} savours the moment.`) });
            }
            if (charInflated) {
              const ct = triggers[`char-${rk}`] || { sequential: [], random: [] };
              if (!enforceBursting) ct.sequential.push({ id: uid('trg'), type: 'ai_message', firePercent: 99, context: beatContext(`The pump stops — ${charName} is impossibly full, right at the edge, and reacts in character.`) });
              // The tracked body's burst comes from the generated burst beat below; this is the other gauge's.
              else if (track !== 'char') ct.sequential.push({ id: uid('trg'), type: 'ai_message', firePercent: 100, context: beatContext(`${charName} reaches the absolute limit and bursts.`) });
              triggers[`char-${rk}`] = ct;
            }
          }
          if (isBurst) {
            // The burst lands at 100% inside 91-100: gauge-driven pumps stop at 100, so a separate 100+
            // band might never be reached (and firing both doubled the burst).
            insertSeq(`${track}-91-100`, { id: uid('trg'), type: 'ai_message', context: beatContext(stepTexts[0] || `${track === 'player' ? '[Player]' : charName} reaches the absolute limit and bursts. ${charName} reacts in character (${personality.toLowerCase()}).`) }, 100);
            continue;
          }
          const key = `${track}-${rk}`;
          const existing = triggers[key] || { sequential: [], random: [] };
          triggers[key] = { ...existing, sequential: [...seq, ...existing.sequential] };
        }

        // ---- Climax pump controls (always, checkpoints or not) ----
        const climaxMembers = extras.filter(m => m.pumpable && ms && ms.has(m.id));
        if (track === 'player' && autoPumpOperator) {
          if (enforceBursting) insertSeq('player-91-100', { id: uid('trg'), type: 'pump_on', durationMode: 'percent_until', duration: '100', awaitCompletion: true }, 99, true);
          else {
            // Reversal ending: the character ends up on the pump once [Player]'s is shut off.
            if (reversal) insertSeq('player-91-100', { id: uid('trg'), type: 'char_inflate_start' }, 99, true);
            insertSeq('player-91-100', { id: uid('trg'), type: 'pump_off' }, 99, true);
          }
        }
        if (charInflated && !enforceBursting) insertSeq('char-91-100', { id: uid('trg'), type: 'char_inflate_stop' }, 99, true);
        // Group members' simulated pumps have no gauge checkpoints of their own: stop them at the edge on
        // the tracked gauge (and the character's, when that runs too), or give them their burst beat.
        for (const m of climaxMembers) {
          if (!enforceBursting) {
            insertSeq(`${track}-91-100`, { id: uid('trg'), type: 'char_inflate_stop', targetMember: m.id }, 99, true);
            if (charInflated && track === 'player') insertSeq('char-91-100', { id: uid('trg'), type: 'char_inflate_stop', targetMember: m.id }, 99, true);
          }
        }
        if (enforceBursting && plan && climaxMembers.length) {
          insertSeq(`${track}-91-100`, { id: uid('trg'), type: 'ai_message', context: beatContext(`${joinNames(climaxMembers.map(m => m.name.split(' ')[0]))} ${climaxMembers.length > 1 ? 'reach their limits and burst' : 'reaches the limit and bursts'} too — everyone reacts.`) }, 100);
        }

        // Late group members: on entering their arrival band, a message brings them into the scene.
        for (const { m, range, offset } of arrivalPlan(sp.arrivals || [])) {
          const key = `${track}-${range}`;
          const ex = triggers[key] || { sequential: [], random: [] };
          const [alo] = RANGE_BOUNDS[range];
          ex.sequential = [{ id: uid('trg'), type: 'ai_message', firePercent: alo + (offset || 1), context: `Continue directly from the last message, keeping everything already established consistent. ${m.name} arrives and joins the scene now (${m.description.split(/(?<=[.!?])\s/)[0]}). Make the entrance a clear moment — ${charName} and the others react, and ${m.name.split(' ')[0]} speaks to [Player]. From now on ${m.name.split(' ')[0]} takes part.` },
            // A pump-target member arriving with a non-player operator gets hooked up on arrival.
            ...(sp.startMembers.has(m.id) ? [{ id: uid('trg'), type: 'char_inflate_start', targetMember: m.id }] : []),
            ...ex.sequential];
          triggers[key] = ex;
        }

        // ---- Story Features: built in code, text from the LLM. Fixed bands so they never collide:
        // 21-30 extra choice · 31-40 minigame · 51-60 branching choice (+group beat) · 61-70 twist ·
        // 71-80 extra choice · 81-90 keyword gate · random events in 21/41/61/81 bands.
        const treeRanges = {};
        const charVars = [];
        const tkey = (rk) => `${track}-${rk}`;
        const act = (type, params) => ({ id: uid('node'), kind: 'action', type, params });
        const msgNode = (beat) => act('ai_message', { context: beatContext(beat), llmEnhance: true });
        const setTree = (rk, name, nodes) => { treeRanges[tkey(rk)] = { inline: { id: uid('tree'), name, nodes } }; };
        // Insert a block into a band's sequential list at its Fire% (keeps the list ascending).
        const addSeqBlock = (rk, block, fp) => {
          const k = tkey(rk);
          const cur = triggers[k] || { sequential: [], random: [] };
          block[0].firePercent = fp;
          const at = cur.sequential.findIndex(t => Number(t.firePercent) > fp);
          cur.sequential.splice(at < 0 ? cur.sequential.length : at, 0, ...block);
          triggers[k] = cur;
        };
        const parseOptions = (text, withEnding) => [...String(text || '').matchAll(/OPTION\s*\d+\s*:\s*([^\n]+)/gi)].map(m => {
          const [label, beat, end] = m[1].split('|').map(x => clean(x || '').trim());
          return { label: (label || '').replace(/["“”*]/g, '').split(/\s+/).slice(0, 6).join(' '), beat: sanitizeBeat(beat), end: withEnding ? sanitizeBeat(end) : '' };
        }).filter(o => o.label && o.beat);
        const choiceTree = (question, opts, extraPerOpt) => [{
          id: uid('node'), kind: 'container', type: 'player_choice', params: { prompt: question },
          children: opts.map(o => ({ id: uid('node'), kind: 'container', type: 'choice', params: { label: o.label }, children: [...extraPerOpt(o), msgNode(o.beat)] })),
        }];

        if (F('choiceBranch')) {
          const raw = await run(async () => llm(`You are designing a turning point in an inflation roleplay.
${brief}

Scenario: ${scenario}

Around halfway full, [Player] must choose how to respond. Use EXACTLY this format:
QUESTION: <the choice shown to [Player], under 12 words>
OPTION 1: <label, 2-5 words> | <one sentence: how ${charName} reacts right away> | <one sentence: how the CLIMAX plays out differently because of this choice>
OPTION 2: <...> | <...> | <...>
OPTION 3: <...> | <...> | <...>
Make the three options clearly different (for example: beg, defy, play along). No dialogue, no quotation marks.`, 380, { fmt: true }));
          const question = trimToLength(clean((String(raw).match(/QUESTION\s*:\s*([^\n]+)/i) || [])[1] || ''), 1, 14) || 'How do you respond?';
          let opts = parseOptions(raw, true).slice(0, 3);
          if (opts.length < 2) opts = [
            { label: 'Beg for mercy', beat: `${charName} reacts to [Player] begging, in character.`, end: `${charName} remembers [Player] begged and lets it shape the climax.` },
            { label: 'Defy them', beat: `${charName} reacts to [Player]'s defiance, in character.`, end: `${charName} makes [Player] pay for that defiance at the climax.` },
            { label: 'Play along', beat: `${charName} is surprised and pleased that [Player] plays along.`, end: `${charName} rewards [Player] for playing along as the climax hits.` },
          ];
          setTree('51-60', 'Turning point (choice)', choiceTree(question, opts, (o) => [
            act('set_variable', { varType: 'custom', variable: 'Stance', operation: 'set', value: o.label }),
            act('set_variable', { varType: 'custom', variable: 'EndingBeat', operation: 'set', value: o.end || o.beat }),
          ]));
          charVars.push({ id: uid('cv'), name: 'Stance', value: '' }, { id: uid('cv'), name: 'EndingBeat', value: `the climax plays out in character for ${charName}` });
          // The climax follows through on the pick (EndingBeat resolves at runtime).
          addSeqBlock('91-100', [{ id: uid('trg'), type: 'ai_message', context: beatContext('Earlier, [Player] chose "[CharVar:Stance]" — follow through on it now: [CharVar:EndingBeat]') }], 97);
        }

        if (F('extraChoices')) {
          for (const [rk, moment] of [['21-30', 'early, as the first real fullness sets in'], ['71-80', 'late, when it is getting hard to bear']]) {
            const raw = await run(async () => llm(`You are designing a small choice moment in an inflation roleplay.
${brief}

Scenario: ${scenario}

The moment is ${moment}. Give [Player] a quick two-way choice. Use EXACTLY:
QUESTION: <under 12 words>
OPTION 1: <label, 2-5 words> | <one sentence: how ${charName} reacts>
OPTION 2: <label, 2-5 words> | <one sentence: how ${charName} reacts>
No dialogue, no quotation marks.`, 220, { fmt: true }));
            const question = trimToLength(clean((String(raw).match(/QUESTION\s*:\s*([^\n]+)/i) || [])[1] || ''), 1, 14) || 'What do you do?';
            const opts = parseOptions(raw, false).slice(0, 2);
            if (opts.length === 2) setTree(rk, `Choice at ${rk}%`, choiceTree(question, opts, () => []));
          }
        }

        if (F('randomEvents')) {
          const raw = await run(async () => llm(`You are adding unscripted interruptions to an inflation roleplay.
${brief}

Write 4 short random EVENTS that could interrupt the scene at this location (someone knocks, a phone buzzes, a noise outside, a guest wanders in, a sudden mood shift). Use EXACTLY:
EVENT 1: <one short sentence>
EVENT 2: <one short sentence>
EVENT 3: <one short sentence>
EVENT 4: <one short sentence>
No dialogue. Nobody touches or adjusts the pump.`, 240, { fmt: true }));
          const evs = [...String(raw).matchAll(/EVENT\s*\d+\s*:\s*([^\n]+)/gi)].map(m => sanitizeBeat(clean(m[1]))).filter(Boolean).slice(0, 4);
          ['21-30', '41-50', '61-70', '81-90'].forEach((rk, i) => {
            if (!evs[i]) return;
            const k = tkey(rk);
            const cur = triggers[k] || { sequential: [], random: [] };
            cur.random = [...(cur.random || []), { id: uid('blk'), chance: Number(eventChance) || 25, repeats: 1, mode: 'group', setId: '',
              triggers: [{ id: uid('trg'), type: 'ai_message', context: beatContext(`An interruption happens: ${evs[i]} Everyone reacts, then the scene carries on.`) }] }];
            triggers[k] = cur;
          });
        }

        if (F('plotTwist')) {
          const raw = await run(async () => llm(`You are adding a plot twist to an inflation roleplay.
${brief}

Scenario: ${scenario}

Write ONE short sentence revealing a twist that fits these characters (a hidden motive, a betrayal, a secret ally, it was planned all along). Use EXACTLY:
TWIST: <one sentence>`, 90, { fmt: true }));
          const twist = sanitizeBeat(clean((String(raw).match(/TWIST\s*:\s*([^\n]+)/i) || [])[1] || ''));
          if (twist) addSeqBlock('61-70', [{ id: uid('trg'), type: 'ai_message', context: beatContext(`A twist is revealed now: ${twist}`) }], 65);
        }

        if (dynamicBeat) addSeqBlock('51-60', [{ id: uid('trg'), type: 'ai_message', context: beatContext(dynamicBeat) }], 57);

        if (game) {
          // Win = a small mercy; lose = a consequence (a short real pump burst only when a character runs it).
          setTree('31-40', `Minigame: ${game.name}`, [
            msgNode(`${charName} proposes a quick game of ${game.name}: if [Player] wins there is a small mercy, if [Player] loses there is a consequence.`),
            { id: uid('node'), kind: 'action', type: 'call_minigame', params: { miniGameId: game.id } },
            { id: uid('node'), kind: 'container', type: 'switch', params: { value: 'GameWinner' }, children: [
              { id: uid('node'), kind: 'container', type: 'case', params: { match: 'Player' }, children: [msgNode(`[Player] won the ${game.name} — ${charName} reacts in character and grants the small mercy.`)] },
              { id: uid('node'), kind: 'container', type: 'case', params: { match: 'Character' }, children: [
                msgNode(`[Player] lost the ${game.name} — ${charName} delivers the consequence, in character.`),
                ...(autoPumpOperator ? [act('pump_on', { duration: '8' })] : []),
              ] },
              { id: uid('node'), kind: 'container', type: 'case', params: { default: true }, children: [msgNode(`The ${game.name} ends in a draw — ${charName} reacts and decides what happens next.`)] },
            ] },
          ]);
        }

        if (F('keywordGate')) {
          const raw = await run(async () => llm(`You are designing a moment where the story waits for the player in an inflation roleplay.
${brief}

Near the end, ${charName} demands that [Player] say or beg for something specific before anything continues. Use EXACTLY:
DEMAND: <one sentence: what ${charName} demands [Player] say — no quotation marks>
WORDS: <2-4 single lowercase words [Player] could say to satisfy it, comma-separated>
RELENT: <one sentence: how ${charName} reacts once [Player] says it>`, 160, { fmt: true }));
          const demand = sanitizeBeat(clean((String(raw).match(/DEMAND\s*:\s*([^\n]+)/i) || [])[1] || ''));
          const words = String((String(raw).match(/WORDS\s*:\s*([^\n]+)/i) || [])[1] || '').toLowerCase().split(/[,;/]+/).map(w => w.replace(/[^a-z' -]/g, '').trim()).filter(w => w && w.length < 20).slice(0, 4);
          const relent = sanitizeBeat(clean((String(raw).match(/RELENT\s*:\s*([^\n]+)/i) || [])[1] || ''));
          const finalWords = words.length ? words : ['please', 'mercy'];
          addSeqBlock('81-90', [
            { id: uid('trg'), type: 'ai_message', context: beatContext(demand || `${charName} demands that [Player] beg before anything continues.`) },
            { id: uid('trg'), type: 'toast', text: `Say one of: ${finalWords.join(', ')}`, preset: 'midnight' },
            { id: uid('trg'), type: 'await_input', words: finalWords.join(', '), speaker: 'player' },
            { id: uid('trg'), type: 'ai_message', context: beatContext(relent || `${charName} reacts to [Player] finally saying it, in character.`) },
          ], 82);
        }

        if (charInflated) for (const k of RANGE_KEYS) if (!charThemes[k]) charThemes[k] = { mainTheme: FALLBACK_THEMES[k] };

        const rsId = uid('rs');
        // Session Start: when the character is inflated and someone other than the player runs the
        // pump, start the character's (simulated) pump so the char-capacity checkpoints progress.
        const ssNodes = [
          ...(sp.startBase ? [{ id: uid('node'), kind: 'action', type: 'char_inflate_start', params: {} }] : []),
          // Pump-target group members present from the opening start their own (simulated) pumps too.
          ...extras.filter((m, i) => sp.startMembers.has(m.id) && (sp.arrivals || [])[i] !== 'late')
            .map(m => ({ id: uid('node'), kind: 'action', type: 'char_inflate_start', params: { targetMember: m.id } })),
        ];
        const profile = {
          id: uid('prof'),
          name: sp.name,
          rules: [
            sp.plot ? `Plot: ${sp.plot.prose}.` : 'Plot: varies by opening — follow the scenario.',
            `Inflation method: ${methodProse}.`,
            `Being inflated: ${victimText}. Pump operator: ${operatorText}.`,
            enforceBursting ? `The story ends with ${victimText} bursting — escalate steadily toward it.` : 'Nobody bursts — the climax is maximum fullness at the very edge.',
          ].join('\n'),
          rangeSets: [{ id: rsId, name: 'Default', ranges: track === 'player' ? themes : {}, checkpointTriggers: triggers, treeRefs: { ranges: treeRanges } }],
          defaultRangeSetId: rsId,
          treeRefs: {
            introEnabled: false,
            ...(ssNodes.length ? { sessionStart: { inline: { id: uid('tree'), name: 'Session Start', nodes: ssNodes } } } : {}),
          },
        };
        return { profile, charThemes: charInflated ? charThemes : null, autoPumpOperator, charVars };
      };

      // Checkpoint-set settings for ONE welcome.
      const spFor = (v) => {
        const w = variantWho[v]; const o = variantOps[v];
        const pl = w === 'player' || w === 'both'; const base = w === 'character' || w === 'both';
        const opOn = o.op !== 'player';
        return {
          ms: variantMembers[v], plot: variantPlots[v], arrivals: variantArrivals[v],
          autoPump: pl && opOn, startBase: base && opOn,
          startMembers: new Set(opOn ? [...variantMembers[v]] : []),
          varies: false,
          name: perWelcomeCkpts ? `Welcome ${v + 1} — ${variantPlots[v].label}, ${whoLabel(w, variantMembers[v])}, ${opLabel(o)}` : variantPlots[0].label,
        };
      };

      // ---- Per-variant scenario / welcome / checkpoints ----
      const scenarios = [];
      const welcomes = [];
      const profiles = [];
      const cardVars = []; // Character Variables the features read ([CharVar:Stance] etc.)
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

Create ${o.npcName} (${g.label.toLowerCase()}, ${g.pronouns}), the person who operates the pump in this scene. They should feel distinct from ${charName}. Use EXACTLY:
PROFILE: <2 sentences: their role at this location, their appearance, their attitude toward [Player]${w !== 'player' ? ` and ${charName}` : ''}, and why they are the one running the pump>
VOICE: <one sentence starting with "Speak like", a concrete modern speaking style clearly different from ${charName}'s>`, 200, { fmt: true })));
          // Story chars are voiced by the character's replies, so give them their own voice line or a
          // small model blends them into the main character.
          const npcRaw = o.npcProfile;
          o.npcProfile = clean((npcRaw.match(/PROFILE\s*:\s*([^\n]+)/i) || [])[1] || npcRaw.replace(/VOICE\s*:[^\n]*/i, '')).trim();
          const nv = voiceFix(clean((npcRaw.match(/VOICE\s*:\s*([^\n]+)/i) || [])[1] || ''));
          o.npcVoice = nv ? nv.replace(/^Speak like/i, 'speaks like') : '';
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
          if (o.op === 'story' && o.npcVoice) sc.text += ` ${o.npcName.split(' ')[0]} ${o.npcVoice}`;
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
${style}`, 700)), welcomeSpeakers(o)));
        if (perWelcomeCkpts) {
          built = await buildProfile(w, o, sc.text, spFor(v));
          profiles.push(built.profile);
          cardVars.push(...(built.charVars || []));
          if (!charThemes && built.charThemes) charThemes = built.charThemes;
        }
        if (v === 0) shared = { sc, built };
        welcomes.push({
          id: uid('wm'), text: welcome, llmEnhanced: true,
          // Variant links (backend applyWelcomeVariant): a randomly picked welcome brings its own
          // scenario, checkpoint profile and pump-control setting.
          ...(perVariantScenario ? { scenarioId: sc.id, allowLlmDeviceAccess: true } : {}),
          ...(perWelcomeCkpts ? { checkpointProfileId: built.profile.id } : {}),
        });
      }

      // ---- ONE shared checkpoint set (default): built once, to fit every welcome ----
      if (!perWelcomeCkpts) {
        const anyP = variantWho.some(x => x === 'player' || x === 'both');
        const anyB = variantWho.some(x => x === 'character' || x === 'both');
        const uw = anyP && anyB ? 'both' : anyP ? 'player' : 'character';
        const ums = new Set(variantMembers.flatMap(set => [...set]));
        const sameOp = variantOps.every(x => x === variantOps[0] || (x.op === variantOps[0].op && x.op !== 'story' && x.op !== 'mix'));
        const uo = sameOp ? variantOps[0] : { op: 'any' };
        const opOn = (i) => variantOps[i].op !== 'player';
        const sp = {
          ms: ums,
          plot: mixedPlots ? null : variantPlots[0],
          arrivals: variantArrivals[0],
          // Pump automation only where it is right for EVERY welcome.
          autoPump: anyP && variantWho.every((x, i) => !(x === 'player' || x === 'both') || opOn(i)),
          startBase: variantWho.every((x, i) => (x === 'character' || x === 'both') && opOn(i)),
          startMembers: new Set(extras.filter(m => variantMembers.every((set, i) => set.has(m.id) && opOn(i))).map(m => m.id)),
          varies: randomTargets || randomOps,
          name: mixedPlots ? 'Generated' : variantPlots[0].label,
        };
        const scText = scenarios.length > 1 ? scenarios.map((x, i) => `Opening ${i + 1}: ${x.text}`).join('\n') : scenarios[0].text;
        const one = await buildProfile(uw, uo, scText, sp);
        profiles.push(one.profile);
        cardVars.push(...(one.charVars || []));
        charThemes = one.charThemes;
      }

      // ---- Lore Entries: keyword-gated dictionary terms for the card's own world ----
      let loreTerms = [];
      if (F('lore')) {
        const npcs = variantOps.filter(x => x.npcName).map(x => `${x.npcName}${x.npcProfile ? ` — ${x.npcProfile}` : ''}`);
        const raw = await run(async () => llm(`You are writing lore entries (a keyword-triggered glossary) for a roleplay character card.
${cardBrief}

Scenario:
${scenarios.map(x => x.text).join('\n')}
${npcs.length ? `\nSupporting characters:\n${npcs.join('\n')}\n` : ''}
Write 3-4 entries for the things this story keeps mentioning: the location, the group/organisation/rule/reason behind the plot, ${npcs.length ? 'each supporting character, ' : ''}and anything at stake. Never an entry for ${charName} or [Player]. Use EXACTLY one line per entry:
ENTRY: <short name> | <2-4 lowercase trigger words or phrases, comma-separated> | <1-2 sentences of facts the writer should know>`, 360, { fmt: true }));
        loreTerms = [...String(raw).matchAll(/ENTRY\s*:\s*([^\n]+)/gi)].map((m, i) => {
          const [term, keys, def] = m[1].split('|').map(x => clean(x || '').trim());
          const keyList = String(keys || '').toLowerCase().split(/[,;/]+/).map(k => k.replace(/["*]/g, '').trim()).filter(k => k && k.length < 40).slice(0, 4);
          return term && def && keyList.length ? { id: `lore-${Date.now()}-${i}`, term: term.replace(/["*]/g, '').slice(0, 60), keys: keyList, definition: trimToLength(def, 2, 60), enabled: true } : null;
        }).filter(Boolean).slice(0, 4);
      }

      // ---- Create Persona: a player character built for THIS story (generated before saving so the
      // progress list stays in order; created + activated right after the card). Text uses [Player]. ----
      let personaDraft = null;
      if (createPersona) {
        const pool = NAMES[newPersonaG.value].first.filter(n => !usedFirst.has(n));
        const pFirst = pick(pool.length ? pool : NAMES[newPersonaG.value].first);
        usedFirst.add(pFirst);
        const playerOps = variantOps.some(o => o.op === 'player' || o.op === 'shared' || (o.op === 'mix' && o.includesPlayer));
        const raw = await run(async () => llm(`You are creating the PLAYER CHARACTER for a roleplay — the person written as [Player].
${cardBrief}

Main character ${charName}:
${description}

Scenario:
${(scenarios[0] && scenarios[0].text) || ''}

Design [Player] (${newPersonaG.label.toLowerCase()}, ${newPersonaG.pronouns}) so they fit exactly what this story needs${playerOps ? ' — they also handle the pump at times' : ''}. Refer to them as [Player]. Use EXACTLY:
APPEARANCE: <2 sentences: looks, build, clothing>
PERSONALITY: <6-8 comma-separated traits, then one sentence on how they act in this situation>
CONTEXT: <one sentence: who they are to ${charName} and why they are in this story>
VOICE: <one sentence starting with "Speak like", a concrete modern speaking style>
DESIRE: <ONE word — how they feel about being inflated: terrified, reluctant, nervous, neutral, curious, eager, obsessed>
POP: <ONE word — how they feel about popping: terrified, dreading, anxious, resigned, indifferent, curious, willing, eager>`, 380, { fmt: true }));
        const t = String(raw || '');
        const grab = (k) => clean((t.match(new RegExp(`${k}\\s*:\\s*([^\\n]+)`, 'i')) || [])[1] || '');
        const oneOf = (v, list, dflt) => { const w = String(v || '').toLowerCase().match(/[a-z]+/)?.[0]; return list.includes(w) ? w : dflt; };
        const desire = oneOf(grab('DESIRE'), ['terrified', 'reluctant', 'nervous', 'neutral', 'curious', 'eager', 'obsessed'], 'nervous');
        const pop = oneOf(grab('POP'), ['terrified', 'dreading', 'anxious', 'resigned', 'indifferent', 'curious', 'willing', 'eager'], enforceBursting ? 'dreading' : 'terrified');
        let voice = grab('VOICE').replace(/^["“']+|["”']+$/g, '');
        if (voice && !/^speak like/i.test(voice)) voice = `Speak like ${voice.replace(/^[A-Z]/, c => c.toLowerCase())}`;
        personaDraft = {
          displayName: `${pFirst} ${pick(LAST_NAMES)}`,
          pronouns: newPersonaG.pronouns,
          appearance: grab('APPEARANCE'),
          personality: grab('PERSONALITY'),
          relationshipWithInflation: grab('CONTEXT'),
          hardInstruct: voice,
          responseContext: '',
          inflationKnowledge: ['curious', 'eager', 'obsessed'].includes(desire) ? 'informed' : 'partial',
          inflationDesire: desire,
          popDesire: pop,
          // Player-operated stories: the persona is willing (or eager) to inflate others.
          desireToInflateOthers: playerOps ? (['eager', 'obsessed'].includes(desire) ? 'eager' : 'willing') : 'none',
          desireToPopOthers: playerOps && enforceBursting ? 'curious' : 'none',
          attributes: {}, avatar: '', stagedPortraits: {}, checkpoints: {}, characterCheckpoints: {}, checkpointTriggers: {},
          assignedFlows: [], buttons: [], assignedButtons: [],
          generatedBy: { tool: 'character-creator', forCharacter: charName },
        };
      }

      // ---- Assemble the card ----
      stepLabelRef.current = 'Saving character';
      setStep(idx, 'active');
      // Lore group first (the card's story names it). A reroll/resume of a saved card updates its group.
      let loreGroupId = null;
      if (loreTerms.length) {
        const gName = `${charName} — Lore`;
        try {
          if (lastRun.mode === 'update' && lastRun.loreGroupId) { await api.updateDictionaryGroup(lastRun.loreGroupId, { name: gName, terms: loreTerms }); loreGroupId = lastRun.loreGroupId; }
          else { const r = await api.createDictionaryGroup(gName, loreTerms, true); loreGroupId = r?.id || null; }
        } catch (e) { console.warn('[CharacterCreator] lore group could not be saved:', e); }
      }
      lastRun.loreGroupId = loreGroupId || lastRun.loreGroupId;
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
        charVariables: cardVars.filter((cv, i) => cardVars.findIndex(x => x.name === cv.name) === i),
        // Group card: Respond as Group by default. Member 0 IS the base character (mirrors the card).
        multiChar: {
          enabled: extras.length > 0,
          ...(extras.length ? { responseMode: 'group', voiceLocked: true } : {}),
          characters: [
            { id: memberId, name: charName, description, personality: persText, gender: g.value, portrait: '', hardInstruct, isPumpable: anyCharInflated || reversal },
            ...extras.map(m => ({ id: m.id, name: m.name, description: m.description, personality: m.personality, gender: m.g.value, portrait: '', hardInstruct: m.hardInstruct, isPumpable: !!m.pumpable })),
          ],
        },
        isPumpable: anyCharInflated || reversal, // a Reversal ending puts the character on the pump at the end
        defaultPumpType: 'electric',
        characterCalibrationTime: ({ 'preset-slowburn': 180, 'preset-intense': 75 })[pacing] || 120, // follows Pacing
        charBurstPercent: enforceBursting ? 100 : 150,
        hideCharBurstFromDetails: true,
        charSyncCalibrationWithPlayer: anyCharInflated || reversal || extras.some(m => m.pumpable),
        charPumpsFollowStory: anyCharInflated || extras.some(m => m.pumpable), // story-driven char pumps // pump-target chars always share the player's calibration
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
          dictionaryGroupIds: ['dict-builtin-inflation-tools', ...(loreGroupId ? [loreGroupId] : [])],
          attributes,
          checkpointsEnabled: true,
          checkpointProfiles: profiles,
          defaultCheckpointProfileId: profiles[0].id,
          ...(charThemes ? { characterCheckpoints: charThemes } : {}),
        }],
        activeStoryId: storyId,
        generatedBy: { tool: 'character-creator', options: { gender: g.value, personality, inflated: variantWho.map((w, i) => victimOf(w, variantMembers[i])), operatorsMix: variantOps.map(o => (o.op === 'mix' ? o.names : null)), operator: variantOps.map(o => o.op), types: typeVals, location: loc.value, plots: variantPlots.map(p => p.value), groupMembers: extras.map(m => `${m.name} (${m.relation})`), guidance: guidanceText, checkpoints: createCheckpoints ? checkpointLevel : 'off', enforceBursting, storyChars: variantOps.filter(o => o.npcName).map(o => o.npcName), playerPronouns: personaPronouns, welcomeCount: nWelcome, randomizeTargets: randomTargets, randomizeOperators: randomOps, newScenarioEach: perVariantScenario } },
      };

      // Reroll (or Resume after the card was saved) overwrites the same card instead of making another.
      const updating = lastRun.mode === 'update' && lastRun.savedId;
      const saved = updating ? { ...(await api.updateCharacter(lastRun.savedId, card) || {}), id: lastRun.savedId } : await api.createCharacter(card);
      lastRun.savedId = saved?.id || lastRun.savedId;
      lastRun.name = charName;
      // Generated cards expect the model to drive devices — make sure the global switch is on
      // (the card's own AI Pump Control is a no-op while it's off).
      if (!settings?.globalCharacterControls?.allowLlmDeviceControl) {
        await api.updateSettings({ globalCharacterControls: { ...(settings?.globalCharacterControls || {}), allowLlmDeviceControl: true } })
          .catch((e) => console.warn('[CharacterCreator] could not enable LLM device control:', e));
      }
      let personaMsg = '';
      if (personaDraft) {
        try {
          const savedPersona = updating && lastRun.personaId
            ? { ...(await api.updatePersona(lastRun.personaId, personaDraft) || {}), id: lastRun.personaId }
            : await api.createPersona(personaDraft);
          if (savedPersona?.id) { lastRun.personaId = savedPersona.id; await api.updateSettings({ activePersonaId: savedPersona.id }); }
          personaMsg = ` + persona "${personaDraft.displayName}" (now active)`;
        } catch (e) {
          console.warn('[CharacterCreator] persona creation failed:', e);
          personaMsg = ' (persona could not be created)';
        }
      }
      setStep(idx, 'done');
      lastRun.status = 'done'; setRunInfo({ ...lastRun });
      showSuccess?.(`${updating ? 'Updated' : 'Created'} "${charName}"${loreGroupId ? ` + ${loreTerms.length} lore entries` : ''}${personaMsg}`);
      setRunning(false);
      navigate('/characters-personas/characters', { state: { openCharacterId: saved?.id } });
    } catch (e) {
      setRunning(false);
      if (lastRun) { lastRun.status = 'failed'; setRunInfo({ ...lastRun }); }
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
        {createPersona
          ? <> (the player is written as the new persona's gender — {(GENDERS.find(x => x.value === personaGender) || GENDERS[0]).pronouns})</>
          : activePersona ? <> (the player is written as <strong>{activePersona.displayName}</strong>'s gender — {activePersona.pronouns || 'they/them'})</> : null}.
      </p>

      <div className="cc-grid">
        <div className="form-group">
          {check(multiChar, setMultiChar, 'Multi-Char', { title: true })}
          {multiChar && (
            <>
              <select value={extraCount} disabled={disabled} onChange={(e) => setExtraCount(Number(e.target.value))} style={{ marginTop: 4 }}>
                <option value={1}>1 additional character</option>
                <option value={2}>2 additional characters</option>
              </select>
              <select value={memberGender} disabled={disabled} onChange={(e) => setMemberGender(e.target.value)} style={{ marginTop: 4 }}>
                <option value="same">Members: same gender as main</option>
                <option value="random">Members: random genders</option>
                {GENDERS.map(x => <option key={x.value} value={x.value}>Members: {x.label}</option>)}
              </select>
              <select value={memberPersonality} disabled={disabled} onChange={(e) => setMemberPersonality(e.target.value)} style={{ marginTop: 4 }}>
                <option value="auto">Member personalities: LLM decides</option>
                <option value="random">Member personalities: random types</option>
                {PERSONALITIES.map(x => <option key={x} value={x}>Member personalities: {x}</option>)}
              </select>
              <p className="section-hint" style={{ marginTop: 6 }}>Group card (Respond as Group). Some members are in the scene from the start, others arrive partway through.</p>
            </>
          )}
        </div>
        <div className="form-group">
          <label>Gender</label>
          <select value={gender} disabled={disabled || genderSurprise} onChange={(e) => setGender(e.target.value)}>
            {GENDERS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
          {surprise(genderSurprise, setGenderSurprise)}
        </div>

        <div className="form-group">
          <label>Personality</label>
          <select value={personality} disabled={disabled || personalitySurprise} onChange={(e) => setPersonality(e.target.value)}>
            {PERSONALITIES.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          {surprise(personalitySurprise, setPersonalitySurprise)}
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
            <div className={`cc-type-row${types.includes('custom') ? ' is-checked' : ''}`}>
              {check(types.includes('custom'), () => toggleType('custom'), 'Custom', { off: typesSurprise })}
              {types.includes('custom') && !typesSurprise && (
                <input type="text" value={customType} disabled={disabled} maxLength={200} onChange={(e) => setCustomType(e.target.value)}
                  placeholder="e.g. a milk enema through a long tube" style={{ marginTop: 4 }} />
              )}
            </div>
          </div>
          {surprise(typesSurprise, setTypesSurprise)}
        </div>

        <div className="form-group">
          <label>Location</label>
          <select value={location} disabled={disabled || locationSurprise} onChange={(e) => setLocation(e.target.value)}>
            {LOCATIONS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
            <option value="custom">Custom…</option>
          </select>
          {location === 'custom' && !locationSurprise && (
            <input type="text" value={customLocation} disabled={disabled} maxLength={160} onChange={(e) => setCustomLocation(e.target.value)}
              placeholder="e.g. an abandoned water park at midnight" style={{ marginTop: 4 }} />
          )}
          {surprise(locationSurprise, setLocationSurprise)}
        </div>

        <div className="form-group">
          <label>Plot</label>
          <select value={plot} disabled={disabled || plotSurprise} onChange={(e) => setPlot(e.target.value)}>
            {PLOTS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
            <option value="custom">Custom…</option>
          </select>
          {plot === 'custom' && !plotSurprise && (
            <input type="text" value={customPlot} disabled={disabled} maxLength={200} onChange={(e) => setCustomPlot(e.target.value)}
              placeholder="e.g. a rivalry between two sisters over an inheritance" style={{ marginTop: 4 }} />
          )}
          {surprise(plotSurprise, setPlotSurprise)}
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
              {check(checkpointsPerWelcome, setCheckpointsPerWelcome, 'Checkpoints for Each Welcome')}
              {randomizeTargets && !checkpointsPerWelcome && (
                <span className="section-hint" style={{ marginTop: -2 }}>
                  If the random targets mix [Player]-inflated and character-only welcomes, each welcome gets its own set anyway — one shared set can only follow one belly.
                </span>
              )}
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
                ? `Each welcome gets a different ${[randomizeTargets && 'inflation target', randomizeOperators && 'pump operator'].filter(Boolean).join(' and ')} with its own scenario; one is picked at random each session.`
                : newScenarioEach
                  ? 'Each welcome gets its own scenario; one is picked at random each session.'
                  : 'Alternate openings for the same scenario; one is picked at random each session.')
              + (checkpointsPerWelcome ? ' Each welcome also gets its own checkpoint set, switched in automatically when that welcome is picked.' : ' All welcomes share ONE checkpoint set.')
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

      <div className="cc-grid" style={{ marginTop: 14 }}>
        <div className="form-group">
          <label>Story Features</label>
          <div className="cc-type-list" style={{ maxHeight: 210 }}>
            {STORY_FEATURES.map(f => {
              const off = !!f.multiOnly && !multiChar;
              return (
                <div key={f.key} className={`cc-type-row${features[f.key] && !off ? ' is-checked' : ''}`} title={f.hint}>
                  {check(!!features[f.key] && !off, (v) => toggleFeature(f.key, v), f.label, { off })}
                  <div className="section-hint" style={{ margin: '2px 0 0 24px' }}>{off ? 'Needs Multi-Char.' : f.hint}</div>
                </div>
              );
            })}
          </div>
          <p className="section-hint" style={{ marginTop: 6 }}>Independent of Create Checkpoints: features are added to the card's checkpoint profile (choices, gates, trees) even when no capacity steps are generated. Stakes and Group Dynamics go into the story text; Lore Entries become a dictionary group linked to the card.</p>
          {features.randomEvents && (
            <select value={eventChance} disabled={disabled} onChange={(e) => setEventChance(Number(e.target.value))} style={{ marginTop: 4 }}>
              <option value={15}>Random events: rare (15% per band)</option>
              <option value={25}>Random events: normal (25% per band)</option>
              <option value={40}>Random events: frequent (40% per band)</option>
            </select>
          )}
        </div>
        <div className="form-group">
          <label>Pacing</label>
          <select value={pacing} disabled={disabled} onChange={(e) => setPacing(e.target.value)}>
            {PACING.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
          <p className="section-hint" style={{ marginTop: 6 }}>Base size steering for the bands the generator doesn't write itself.</p>
        </div>
      </div>

      <div className="form-group" style={{ marginTop: 14 }}>
        <label>Scenario or Character Guidance (Optional)</label>
        <textarea rows={3} value={guidance} disabled={disabled} maxLength={600} onChange={(e) => setGuidance(e.target.value)}
          placeholder="e.g. She's [Player]'s strict older roommate. Keep it playful at first, darker later. One of the group is secretly on [Player]'s side." />
        <p className="section-hint" style={{ marginTop: 4 }}>Followed by every generation step, and anything it states outright (name, gender, personality, plot, location, inflation type, who's inflated or pumping) overrides the dropdowns above.</p>
        {String(guidance || '').trim() && (
          <p className="section-hint" style={{ marginTop: 4, color: 'var(--warning-color, #e0a030)' }}>
            ⚠ Guidance can slow generation down a lot: it adds a "Reading guidance" step first and makes every prompt in the run longer — noticeable on slower local models and on big runs (several welcomes, Thorough checkpoints, many Story Features).
          </p>
        )}
      </div>

      <div className="form-group" style={{ marginTop: 10, maxWidth: 360 }}>
        {check(createPersona, setCreatePersona, 'Create Persona', { title: true })}
        {createPersona && (
          <select value={personaGender} disabled={disabled} onChange={(e) => setPersonaGender(e.target.value)} style={{ marginTop: 4 }}>
            {GENDERS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        )}
        <p className="section-hint" style={{ marginTop: 6 }}>
          {createPersona
            ? 'Also generates a player persona built for this story (look, personality, voice, inflation feelings) and makes it the active persona. The story is written for this gender.'
            : 'Off: the story is written for your current persona.'}
        </p>
      </div>

      <div className="tab-header-actions" style={{ marginTop: 12 }}>
        <button className={`btn ${running ? 'btn-danger' : 'btn-primary'}`} onClick={() => handleGenerate('new')}
          disabled={!running && !typesSurprise && types.length === 0}>
          {running ? 'Abort' : 'Generate'}
        </button>
        {!running && (
          <button type="button" className="btn btn-secondary" title="Tick every Surprise Me (gender, personality, target, operator, inflation type, location, plot)"
            onClick={() => { setGenderSurprise(true); setPersonalitySurprise(true); setInflatedSurprise(true); setOperatorSurprise(true); setTypesSurprise(true); setLocationSurprise(true); setPlotSurprise(true); }}>
            Surprise Everything
          </button>
        )}
        {!running && runInfo?.status === 'failed' && (
          <button type="button" className="btn btn-secondary" onClick={() => handleGenerate('resume')}
            title="Run again with the same random picks — finished steps come back instantly from the last run, only the rest is generated">
            Resume
          </button>
        )}
        {!typesSurprise && types.length === 0 && <span className="section-hint">Pick at least one inflation type.</span>}
      </div>

      {!running && runInfo?.savedId && runInfo.status === 'done' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <select value={rerollStep} onChange={(e) => setRerollStep(e.target.value)}>
            <option value="">Reroll one step of "{runInfo.name}"…</option>
            {Object.keys(runInfo.stepKeys || {}).filter(l => l !== 'Saving character' && l !== '?').map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <button type="button" className="btn btn-sm btn-secondary" disabled={!rerollStep} onClick={() => handleGenerate('reroll', rerollStep)}>Reroll</button>
          <span className="section-hint" style={{ margin: 0 }}>Regenerates that step and everything written from it, keeps the rest, and overwrites the same card (edits made to it since are lost).</span>
        </div>
      )}
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
