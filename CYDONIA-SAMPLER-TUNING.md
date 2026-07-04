# Cydonia 24B v4.3 — Sampler Tuning Notes

Scratch reference for experimenting with the `default-cydonia24b-llamacpp` / `-kobold`
connection presets (server.js `DEFAULT_PROFILES`). Both presets share the same sampler
block. `settings.llm` is a **copy** of the active profile — to test live, edit the active
profile in Settings → Model (or the values get reset on restart by the `samplerRev` migration).

Model: TheDrummer/Cydonia-24B-v4.3 · base Mistral-Small-3.1-24B · Mistral v7 "Tekken" template.
No official sampler rec on the v4.3 card; the "v4-line" column below is from the v4.1 discussion.

---

## Side-by-side

| Field                | A — Original baseline (SHIPPED v6.6.94) | B — v4-line retune (was v6.6.93, reverted) |
|----------------------|------------------------------------------|--------------------------------------------|
| temperature          | **1.0**                                  | **0.6**  (dynatemp center)                 |
| topK                 | 0                                        | 0                                          |
| topP                 | **1**  (open)                            | **0.9**                                    |
| typicalP             | 1 (off)                                  | 1 (off)                                     |
| minP                 | **0.05**                                 | **0.02**                                   |
| topA                 | 0                                        | 0                                          |
| tfs                  | 1 (off; dead on llama.cpp)               | 1 (off)                                     |
| topNsigma            | 0                                        | 0                                          |
| repetitionPenalty    | **1.05**                                 | **1.0**  (off)                             |
| repPenRange          | 2048                                     | 2048                                       |
| dynaTempRange        | **0**  (dynatemp OFF)                    | **0.1**  (→ dynatemp 0.5–0.7)              |
| dynaTempExponent     | 1                                        | **1.4**                                    |
| xtcProbability       | **0**  (XTC OFF)                         | **0.5**                                    |
| xtcThreshold         | 0.1                                      | 0.1                                        |
| dryMultiplier        | 0.8 (light DRY on)                       | 0.8 (light DRY on)                         |
| dryBase / AllowedLen | 1.75 / 2                                 | 1.75 / 2                                   |
| temperatureLast      | true                                     | true                                       |
| maxTokens            | 400                                      | 400                                        |

## Observations (user)

- **A (original):** prose OK-ish, and **tag compliance is reliable** — the model emits
  `[pump on]` etc. on its own. This is the known-good working state.
- **B (v4-line):** prose got **better eventually**, BUT the **welcome message was often garbage**
  and it **would not follow tag instructions at all**. Suspected culprits for the tag failure:
  `repetitionPenalty` off + `XTC 0.5` (XTC randomly drops top tokens, which can nuke the
  structured tag), and the lower/dynamic temperature reducing instruction-following.

## Knobs to play with next (hypotheses)

- Keep **A's rep-pen 1.05 + XTC off** (tag compliance) but try **dropping temp 1.0 → ~0.85**
  and **top_p 1 → 0.95** for less rambling without killing tags.
- If trying XTC, keep it **low** (`xtcProbability` 0.1–0.2) so it doesn't eat the tag.
- Dynatemp is orthogonal to tag compliance — can layer B's dynatemp onto A's rep-pen/XTC.

---

## Welcome-message variants (reverted in v6.6.94 — here if we revisit)

These were tried in 6.6.91/6.6.92 and pulled because they made the welcome worse (character
sheets / garbage). Current shipped state = the ORIGINAL (below, "before").

| Aspect        | Before (SHIPPED)                                   | Tried & reverted                                             |
|---------------|----------------------------------------------------|-------------------------------------------------------------|
| Group primer  | `` `${character.name}:` `` (base name, all cards)  | `[Characters]:` for group cards                             |
| Instruction   | "Write an engaging, in-character first message…"   | "Write ONLY … no character sheet/analysis/markdown/meta…"   |
| Output strip  | none (welcome skips scaffolding strip)             | `stripModelScaffolding` + `stripStrayBrackets` + template fallback |

Note: the `[Characters]:` primer + strips is what produced the "# Character Sheet" dumps with
model B's loose sampling. If we retry the welcome, do it with model A's tighter tag-friendly
sampling, not B's.
