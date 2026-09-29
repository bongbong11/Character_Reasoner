import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const script = source.replace(/jQuery\(\(\)=>[\s\S]*$/, '') + '\nglobalThis.__test={PROMPT,validate,sameEntity,saveResult,savedResults,setLoreSelected,characterSheetText,personaSheetText,splitText,sources};';
const context = { console, structuredClone, globalThis: null };
context.globalThis = context;
vm.runInNewContext(script, context);

const { PROMPT, validate, sameEntity, saveResult, savedResults, setLoreSelected, characterSheetText, personaSheetText, splitText, sources } = context.__test;
const base = {
  type: 'knowledge', target: 'Lucas', when: ['secret identity'],
  rule: 'Lucas knows the secret.', modality: 'fact', basis: 'explicit',
  source_ids: ['S001'], knowledge_domain: 'person', knowledge_state: 'knows',
};

assert.equal(validate({ records: [base] }, ['S001']), 0);
assert.throws(() => validate({ records: [{ ...base, type: 'boundary' }] }, ['S001']), /knowledge 이외/);
assert.throws(() => validate({ records: [{ ...base, knowledge_state: 'none' }] }, ['S001']), /knowledge 레코드/);
assert.throws(() => validate({ records: [{ ...base, knowledge_state: undefined }] }, ['S001']), /enum/);
assert.throws(() => validate({ records: [{ ...base, when: ['background'] }] }, ['S001']), /구체적인 장면 cue/);
for (const cue of ['personality traits', 'daily demeanor', 'worldview', 'general demeanor']) assert.throws(() => validate({ records: [{ ...base, when: [cue] }] }, ['S001']), /구체적인 장면 cue/);
assert.equal(sameEntity({ output: { entity_type: 'character', entity_name: 'Lucas' } }, { output: { entity_type: 'character', entity_name: ' lucas ' } }), true);

const settingsContext = { extensionSettings: {}, saveSettingsDebounced() {} };
context.SillyTavern = { getContext: () => settingsContext };
saveResult({ output: { entity_type: 'character', entity_name: 'Lucas', records: [base] }, sources: [], profile: null });
saveResult({ output: { entity_type: 'character', entity_name: 'lucas', records: [base, base] }, sources: [], profile: null });
assert.equal(savedResults().length, 1);
assert.equal(savedResults()[0].output.records.length, 2);

const attributes = new Map([['aria-pressed', 'false']]);
const classes = new Set();
const loreRow = {
  setAttribute: (key, value) => attributes.set(key, value),
  classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
};
setLoreSelected(loreRow, true);
assert.equal(attributes.get('aria-pressed'), 'true');
assert.equal(classes.has('selected'), true);
setLoreSelected(loreRow, false);
assert.equal(attributes.get('aria-pressed'), 'false');
assert.equal(classes.has('selected'), false);

const importedCharacter = characterSheetText({ characterId: 0, characters: [{ data: { name: 'A', description: 'Desc', personality: 'Calm', scenario: 'Home' } }] });
assert.match(importedCharacter, /NAME:\nA/);
assert.match(importedCharacter, /PERSONALITY:\nCalm/);
assert.equal(personaSheetText({ personaDescription: 'Persona body' }), 'Persona body');
assert.deepEqual(Array.from(splitText('PERSONALITY:\nCalm\n\nLIKES:\nTea')), ['PERSONALITY:\nCalm', 'LIKES:\nTea']);
const loreSources = sources('character', '', [{ book: 'Book', title: 'Entry', content: 'LIKES:\nTea\n\nSKILLS:\nCooking' }]);
assert.equal(loreSources.length, 2);
assert.deepEqual(Array.from(loreSources, x => x.id), ['S001', 'S002']);

for (const required of [
  '## Source Fidelity',
  'Do not silently correct',
  '## Retrieval Atomicity',
  '## Strict Separation',
  'the records MUST remain separate',
  'One knowledge record equals one epistemic proposition',
  '## Knowledge Boundary',
  'Do not absorb related objective facts',
  '## Coverage',
  'Compression removes redundancy, not information',
  '## Meta Instructions',
  'Use direct_inference only for the smallest operational restatement',
]) assert.ok(PROMPT.includes(required), `missing prompt guard: ${required}`);
for (const overfit of ['Lucas', 'prime alpha', 'hospital test', 'As a bouncer']) assert.equal(PROMPT.includes(overfit), false, `overfit example remains: ${overfit}`);

console.log('Character Reasoner regression checks passed.');
