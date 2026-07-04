# Audit Brief — "Dynamic Directive Wording Per Model Family"

**For:** a fresh reviewer (Fable) with repo access, no prior conversation context.
**Ask:** stress-test the proposal below. Tell us if it's worth doing, where it breaks, and whether the incremental plan is the right shape. Be skeptical — see "Risk history."

Repo: SwellDreams (AI roleplay app that drives physical inflation pumps). Branch `unified-card`, currently at `v6.6.94` / tag `v6.6.94-known-good` (a deliberate restore point). Backend: `backend/server.js` (~19k lines) + `backend/services/llm-service.js`. Local model via llama.cpp `/completion`, model = TheDrummer Cydonia-24B-v4.3 (Mistral-Small-3.1 base, "Tekken" template).

---

## 1. The claim to audit

> The app's *reinjected directive blocks* (stage directions, belly state, director's note, device-control instruction, etc.) are hardcoded to one `=== MANDATORY — … ===` markdown style for every model. Mistral/Tekken bases weight `[bracketed]` flags / `---` rules / `[OOC:]` as meta-boundaries (mirrors their `[INST]` + RP training), whereas Gemma leans XML (`<start_of_turn>`) and ChatML leans `<|im_start|>`. Reformatting the directive *content* per model family (keyed on the profile's `promptTemplate`) should improve instruction adherence — especially **device-tag compliance** (the model emitting `[pump on]`), which is the outcome we actually care about.

**Two sub-questions:**
- (a) Is the *architecture* claim correct — that this is a real hardcoded gap the template system does NOT already cover?
- (b) Is the *payoff* claim plausible — that per-model directive wording yields a **meaningful** adherence gain, not a rounding error?

## 2. Verified architecture (two distinct layers)

**Layer 1 — the prompt envelope (already model-aware, correct).** `wrapWithTemplate(systemPrompt, prompt, template)` at `llm-service.js:132` wraps the final payload in the model's delimiter tokens. For `mistral-tekken` (`llm-service.js:169-178`) it emits:
```
[SYSTEM_PROMPT]{systemPrompt}[/SYSTEM_PROMPT][INST]{prompt}[/INST]
```
Gemma → `<start_of_turn>…`, ChatML → `<|im_start|>…`. Driven by the profile's `promptTemplate`. No complaint here.

**Layer 2 — the directive CONTENT inside the envelope (hardcoded).** `{systemPrompt}` / `{prompt}` are strings the app assembles *before* templating, and every directive block is literal `=== MANDATORY — … ===` markdown built identically for all models, then stuffed inside the envelope. This is the hardcoded layer. The proposal touches ONLY Layer 2.

## 3. Scope — the directive blocks (server.js)

There are **~30** `=== … ===` blocks. Representative, adherence-relevant ones:
- `buildDeviceControlInstruction(template, …)` — **`server.js:5684`** — the pump-tag instruction. **NOTE: it already receives `template` as arg 1** — reviewer should check whether it already branches on it or ignores it. This is the proposed first-convert.
- `applyCharacterGuidance(context, character, guidanceText)` — `server.js:13938` → "DIRECTOR'S NOTE FOR THIS REPLY" (`13945/13949`, also `13124`).
- Stage directions — `13066/13074/13785/13792`. Belly state — `5990`. Pre-inflation — `6005/13063/13781`.
- Individual/solo/persona/character drive — `10551/13244/11002/11123`. Gated-intro — `12171/12214`. Capacity/critical — `6273/6283…`.

Grep to reproduce the full inventory: `grep -noE "=== [A-Z][^=]*===" backend/server.js | sort -u`.

## 4. Proposed implementation

A single helper `wrapDirective(heading, body, template)` that every block routes through:
- Mistral/Tekken family → `[OOC: …]` and/or `---` hard-break block (exact style TBD — 3 candidates were floated: `[OOC:]`, `--- ### HEADING ---`, `[SYSTEM NOTE: key=val]`).
- Gemma/ChatML → XML-ish.
- Everything else / unknown → **current `===` (unchanged default)**.

Reversibility: non-Mistral default path is byte-for-byte the current behavior. Existing output cleaners (`stripStrayBrackets` removes stray `[...]`, `stripModelScaffolding`) already tolerate/clean brackets, which also mitigates the "model echoes the directive into the reply" problem.

## 5. Proposed plan (incremental, evidence-gated)

1. Branch `dynamic-directives` off `v6.6.94-known-good`.
2. Convert **only** `buildDeviceControlInstruction` for Mistral family. Leave the other ~29 blocks on `===`.
3. A/B on real chats vs baseline. If **tag compliance** visibly improves → roll the pattern out. If wash/worse → `git checkout unified-card`, zero loss.

## 6. Risk history (why we're skeptical)

Two "theoretically sound" changes were just made and **reverted** because they made things worse in practice:
- **v6.6.93 sampler retune** to TheDrummer's published Cydonia v4-line rec (dynatemp 0.5–0.7, top_p 0.9, min_p 0.02, XTC 0.5, rep-pen off). Result: prose eventually better, but **welcome messages went garbage and tag compliance collapsed** (working theory: XTC + rep-pen-off eats the structured `[pump on]` token). Reverted in v6.6.94. Full notes: `CYDONIA-SAMPLER-TUNING.md`.
- **v6.6.91/92 welcome changes** (`[Characters]:` group primer + scaffolding strip) → produced "# Character Sheet" dumps. Reverted.

Lesson: sound theory ≠ better output with these models. The baseline (temp 1.0, top_p 1, min_p 0.05, rep-pen 1.05, dynatemp/XTC off) is the known-good: prose ok, **tags reliable**.

## 7. What we want the audit to answer

1. **Architecture check:** Confirm/refute the Layer-1-vs-Layer-2 split. Does `wrapWithTemplate` (or anything else) already reformat directive *content* per model, making this redundant? Does `buildDeviceControlInstruction`'s existing `template` param already do part of this?
2. **Payoff realism:** For a Mistral-Small-3.x finetune, is `[OOC:]`/`---` directive framing likely to move *tag-compliance* meaningfully, or is tag compliance dominated by sampler settings (which we just saw can kill it) and prompt *position* (tags are currently instructed at the END / final line; stops are role-boundary only, no `\n` stop)? i.e. are we optimizing the wrong variable?
3. **Which Mistral style** of the three is best-supported, and should different block types use different styles (short OOC vs multi-line `---`)?
4. **Regression surface:** anything that makes the `===` default non-identical, or any block whose meaning changes if rebracketed (e.g. blocks the model is *supposed* to partly echo)? Interaction with the output cleaners (`stripStrayBrackets` eating a legit bracketed directive that leaks, vs a real device tag)?
5. **Verdict:** proceed with the 1-block device-control test, expand scope, or don't bother — and why.

Please read the cited files directly before judging; line numbers are from `v6.6.94` and may drift.

---

# AUDIT RESULT (Fable 5, 2026-07-04)

**Verdict: do NOT proceed as proposed.** Findings against section 7:

1. **Architecture (Q1): claim true but overstated.** Layer-1/2 split confirmed (`wrapWithTemplate` is envelope-only). BUT the two highest-leverage blocks are ALREADY model-family-aware by design:
   - `buildDeviceControlInstruction` (server.js:5684) branches Gemma/ChatML (terse rule-list) vs Mistral-family (**worked few-shot demonstration block**, 5697-5714) — a stronger adherence technique than `[OOC:]` framing.
   - `applyCharacterGuidance` (13938) already injects the director's note at **depth 0 before the primer** to exploit Mistral recency weighting (deliberate, commented, 13945-13948).
2. **Payoff (Q2): wrong variable.** Experimental record: tags reliable at baseline with `===` wording; compliance collapsed ONLY when samplers changed (v6.6.93 XTC/rep-pen-off) and recovered on revert. Tag compliance is dominated by samplers + few-shot examples + position — all already in the known-good state. No observed adherence failure is attributable to directive wording. The one REAL wording-related symptom is directive **echo** (why `stripLeakedDirectives` exists).
3. **Style (Q3):** `[OOC:]` or `[SYSTEM NOTE:]` acceptable (single bracket block; echoes cleaned generically by `stripStrayBrackets`). `---`/`###` block REJECTED: `stripStrayBrackets` drops `---`/`#` lines but keeps `* bullet` text → echoed bullets leak into the bubble.
4. **Regression surface (Q4): SAFETY-CRITICAL coupling found.** `stripLeakedDirectives` (9387) is keyed to the current `===` header keywords. Reformatting directives without updating it in the same commit means echoed blocks stop being stripped — and the device instruction's examples contain literal `[pump on]` lines. Today an echoed block is removed BEFORE device parsing; a reformatted echo would survive (`stripStrayBrackets` preserves pump tags by design) and could **fire the physical pump from an echoed instruction**.
5. **Recommendation (Q5):** Skip the ~30-block conversion. Never convert `buildDeviceControlInstruction` first (already tuned, safety-critical, known-good — the brief's step-2 inverted). The only worthwhile narrow experiment: convert the echo-prone narrative directives (director's note + stage directions) to `[OOC:]` on Mistral only, update `stripLeakedDirectives` in lockstep, measure **echo frequency** (primary) with **tag reliability** as guardrail. Modest expected win; contained blast radius.
