import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const exported = [
  'COMPILER_PROMPT','PERSONA_GUIDANCE','npcGuidance','characterInfo',
  'splitText','buildSources','promptText','extractJsonObject','cleanWhen',
  'hardValidateRecords','validateImport','saveVersion','allSaved',
  'deleteVersion','findGroup','setLoreSelected'
].join(',');
const script = source.replace(/jQuery\(\(\)=>[\s\S]*$/, '') + '\nglobalThis.__test={'+exported+'};';
let uuidCounter=0;
const context = {
  console,
  structuredClone,
  crypto: { randomUUID: ()=>'uuid-'+(++uuidCounter) },
  globalThis: null,
};
context.globalThis=context;
vm.runInNewContext(script,context);

const {
  COMPILER_PROMPT,PERSONA_GUIDANCE,npcGuidance,characterInfo,splitText,buildSources,
  promptText,extractJsonObject,cleanWhen,hardValidateRecords,validateImport,
  saveVersion,allSaved,deleteVersion,findGroup,setLoreSelected,
}=context.__test;

assert.match(COMPILER_PROMPT,/source_set_id/);
assert.match(COMPILER_PROMPT,/Atomic does NOT mean smallest possible unit/);
assert.match(COMPILER_PROMPT,/maximum 6/);
assert.match(PERSONA_GUIDANCE,/persona represented by \{\{user\}\}/);
assert.match(npcGuidance('antagonist'),/antagonist\/hostile/);

const imported=characterInfo({
  characterId:0,
  characters:[{data:{name:'Lucas',description:'Desc',personality:'Calm',scenario:'Home',first_mes:'Hello',mes_example:'Example'}}],
});
assert.equal(imported.name,'Lucas');
assert.match(imported.text,/DESCRIPTION:\nDesc/);
assert.match(imported.text,/PERSONALITY:\nCalm/);
for(const excluded of ['SCENARIO','FIRST MESSAGE','Hello','Example'])assert.equal(imported.text.includes(excluded),false);

assert.deepEqual(Array.from(splitText('PERSONALITY:\nCalm\n\nLIKES:\nTea')),['PERSONALITY:\nCalm','LIKES:\nTea']);
const built=buildSources('npc','BIO:\nOne\n\nSKILLS:\nTwo',[{book:'Book',title:'Entry',content:'LORE:\nThree'}]);
assert.deepEqual(Array.from(built,x=>x.id),['S001','S002','S003']);
assert.equal(built[2].label,'Book · Entry');

const draft={
  source_set_id:'set-1',entity_type:'persona',entity_name:'Mina',npc_role:null,
  sources:[{id:'S001',label:'페르소나 시트',text:'Calm'}],
};
const compiledPrompt=promptText(draft);
assert.match(compiledPrompt,/"source_set_id": "set-1"/);
assert.match(compiledPrompt,/ENTITY_NAME: Mina/);
assert.match(compiledPrompt,/persona represented by \{\{user\}\}/);
assert.match(compiledPrompt,/S001 · 페르소나 시트/);

assert.equal(JSON.stringify(extractJsonObject('{"a":1}')),JSON.stringify({a:1}));
assert.equal(JSON.stringify(extractJsonObject('Here is JSON:\n```json\n{"a":"} inside","b":{"c":2}}\n```')),JSON.stringify({a:'} inside',b:{c:2}}));
assert.throws(()=>extractJsonObject('no object'),/찾지 못했습니다/);

const cleaned=cleanWhen([' after   heat ','After Heat','personality','what Lucas knows about himself','one two three four five six seven']);
assert.deepEqual(Array.from(cleaned.valid),['after heat']);
assert.equal(cleaned.removed.length,4);

const base={
  type:'knowledge',target:'Lucas',when:['secret identity'],rule:'Lucas knows the secret.',
  modality:'fact',basis:'explicit',source_ids:['S001'],knowledge_domain:'person',knowledge_state:'knows',
};
const records=[structuredClone(base)];
hardValidateRecords(records,new Set(['S001']));
assert.throws(()=>hardValidateRecords([{...base,type:'fact'}],new Set(['S001'])),/knowledge 이외/);
assert.throws(()=>hardValidateRecords([{...base,source_ids:['S999']}],new Set(['S001'])),/존재하지 않는/);
assert.throws(()=>hardValidateRecords([{...base,when:['personality']}],new Set(['S001'])),/유효한 cue/);
assert.throws(()=>hardValidateRecords([{...base,extra:true}],new Set(['S001'])),/허용되지 않은/);

const validImport=validateImport({
  source_set_id:'set-1',entity_type:'persona',entity_name:'Mina',records:[base],
},draft);
assert.equal(validImport.records.length,1);
assert.throws(()=>validateImport({source_set_id:'old',entity_type:'persona',entity_name:'Mina',records:[base]},draft),/source_set_id/);
assert.throws(()=>validateImport({source_set_id:'set-1',entity_type:'persona',entity_name:'Other',records:[base]},draft),/대상이 일치/);

const metadata={};
let saves=0;
const mockContext={chatId:'chat-a',chatMetadata:metadata,saveMetadataDebounced(){saves++;}};
context.SillyTavern={getContext:()=>mockContext};
const version=(id,entity,date)=>({
  id,saved_at:date,entity_name:entity,source_set_id:'set-'+id,source_method:'external_ai',
  output:{entity_type:'npc',entity_name:entity,records:[base]},sources:draft.sources,
});
saveVersion('npc','루카스',version('v1','Lucas','2026-09-29T01:00:00Z'));
saveVersion('npc','루카스',version('v2','Lucas','2026-09-30T01:00:00Z'));
saveVersion('character','루카스',version('v3','Lucas','2026-10-01T01:00:00Z'));
assert.equal(metadata.characterReasonerBank.banks.npc.length,1);
assert.equal(metadata.characterReasonerBank.banks.npc[0].versions.length,2);
assert.equal(metadata.characterReasonerBank.banks.character.length,1);
assert.equal(allSaved().length,2);
const npcGroup=metadata.characterReasonerBank.banks.npc[0];
assert.equal(npcGroup.versions[0].id,'v2');
deleteVersion('npc',npcGroup.id,'v2');
assert.equal(findGroup('npc',npcGroup.id).versions.length,1);
deleteVersion('npc',npcGroup.id,'v1');
assert.equal(findGroup('npc',npcGroup.id),undefined);
assert.ok(saves>=5);

const attributes=new Map([['aria-pressed','false']]), classes=new Set();
const row={
  setAttribute:(key,value)=>attributes.set(key,value),
  classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)},
};
setLoreSelected(row,true);
assert.equal(attributes.get('aria-pressed'),'true');
assert.equal(classes.has('selected'),true);

console.log('Character Reasoner v0.8.0 regression checks passed.');
