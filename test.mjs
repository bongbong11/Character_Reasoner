import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const script = source.replace(/jQuery\(\(\)=>[\s\S]*$/, '') + '\nglobalThis.__test={PROMPT,validate,sameEntity,saveResult,savedResults,setLoreSelected};';
const context = { console, structuredClone, globalThis: null };
context.globalThis = context;
vm.runInNewContext(script, context);

const { PROMPT, validate, sameEntity, saveResult, savedResults, setLoreSelected } = context.__test;
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

for (const required of [
  'AUTHORIAL / META DIRECTIVES',
  'dominant alpha',
  'hospital test',
  'Never change OR into AND',
  'TEMPORAL / ROLE SCOPE',
  'As a bouncer',
  'independently retrievable propositions',
]) assert.ok(PROMPT.includes(required), `missing prompt guard: ${required}`);

console.log('Character Reasoner regression checks passed.');
