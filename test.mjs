import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const exported = [
  'COMPILER_PROMPT','PERSONA_GUIDANCE','npcGuidance','characterInfo',
  'splitText','buildSources','promptText','extractJsonObject','cleanWhen','normalizeRecordTypes',
  'hardValidateRecords','validateImport','saveVersion','allSaved',
  'deleteVersion','findGroup','setLoreSelected'
].join(',');
const coreSource = fs.readFileSync(new URL('./core/index.js', import.meta.url), 'utf8').replace(/^export \{[^}]+\};?$/gm, '').replace(/^export /gm, '');
const script = coreSource.replace(/const KINDS[^;]+;/, '').replace(/const KIND_LABEL[^;]+;/, '') + '\n' + source.replace(/^import[^\n]+\n/gm, '').replace(/jQuery\(\(\)=>[\s\S]*$/, '') + '\nglobalThis.__test={'+exported+'};';
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
  promptText,extractJsonObject,cleanWhen,normalizeRecordTypes,hardValidateRecords,validateImport,
  saveVersion,allSaved,deleteVersion,findGroup,setLoreSelected,
}=context.__test;

assert.equal(COMPILER_PROMPT.includes('source_set_id'),false);
assert.match(COMPILER_PROMPT,/Atomic does NOT mean smallest possible unit/);
assert.match(COMPILER_PROMPT,/maximum 6/);
assert.match(COMPILER_PROMPT,/IMPORTANT FIELD DISTINCTION/);
assert.match(COMPILER_PROMPT,/`preference`.*MODALITY values, never record types/);
assert.match(PERSONA_GUIDANCE,/persona represented by \{\{user\}\}/);
assert.match(npcGuidance('antagonist'),/antagonist\/hostile/);
assert.match(npcGuidance('ally'),/independently retrievable trait/);
assert.doesNotMatch(npcGuidance('ally'),/usually 4-12/);

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
  entity_type:'persona',entity_name:'Mina',npc_role:null,
  sources:[{id:'S001',label:'페르소나 시트',text:'Calm'}],
};
const compiledPrompt=promptText(draft);
assert.match(compiledPrompt,/ENTITY_NAME: Mina/);
assert.match(compiledPrompt,/persona represented by \{\{user\}\}/);
assert.match(compiledPrompt,/S001 · 페르소나 시트/);

assert.equal(JSON.stringify(extractJsonObject('{"a":1}')),JSON.stringify({a:1}));
assert.equal(JSON.stringify(extractJsonObject('Here is JSON:\n```json\n{"a":"} inside","b":{"c":2}}\n```')),JSON.stringify({a:'} inside',b:{c:2}}));
assert.equal(extractJsonObject('Example: {"example":true}\nFinal:\n```json\n{"entity_type":"npc","entity_name":"Mina","records":[]}\n```').entity_name,'Mina');
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
const slotErrors=[
  {...base,type:'preference',modality:'preference'},
  {...base,type:'habit',modality:'habit'},
];
const normalizationLog=normalizeRecordTypes(slotErrors);
assert.deepEqual(Array.from(slotErrors,x=>x.type),['core','core']);
assert.deepEqual(Array.from(slotErrors,x=>x.modality),['preference','habit']);
assert.equal(JSON.stringify(normalizationLog),JSON.stringify([
  {record_index:0,field:'type',from:'preference',to:'core',reason:'modality value used as record type'},
  {record_index:1,field:'type',from:'habit',to:'core',reason:'modality value used as record type'},
]));
assert.throws(()=>hardValidateRecords([{...base,type:'fact'}],new Set(['S001'])),/knowledge 이외/);
assert.throws(()=>hardValidateRecords([{...base,source_ids:['S999']}],new Set(['S001'])),/존재하지 않는/);
assert.throws(()=>hardValidateRecords([{...base,when:['personality']}],new Set(['S001'])),/1~5개 문자열 배열/);
assert.throws(()=>hardValidateRecords([{...base,extra:true}],new Set(['S001'])),/허용되지 않은/);

const validImport=validateImport({
  entity_type:'persona',entity_name:'Mina',records:[base],
});
assert.equal(validImport.output.records.length,1);
assert.equal(JSON.stringify(validImport.output.intimacy_reference),JSON.stringify({text:'',source_ids:[]}));
assert.equal(JSON.stringify(validateImport({entity_type:'npc',entity_name:'Mina',intimacy_reference:{text:'Mina has a stated limit.',source_ids:['S001']},records:[]}).output.intimacy_reference),JSON.stringify({text:'Mina has a stated limit.',source_ids:['S001']}));
assert.throws(()=>validateImport({entity_type:'npc',entity_name:'Mina',intimacy_reference:{text:'Unsupported.',source_ids:[]},records:[]}),/intimacy_reference/);
assert.equal(validImport.import_log.import_mode,'standalone_json');
assert.equal(validImport.source_set_id,null);
const preferenceImport=validateImport({
  entity_type:'persona',entity_name:'Mina',
  records:[{...base,type:'preference',modality:'preference',knowledge_domain:'none',knowledge_state:'none'}],
});
assert.equal(preferenceImport.output.records[0].type,'core');
assert.equal(preferenceImport.output.records[0].modality,'preference');
assert.equal(preferenceImport.import_log.normalizations[0].reason,'modality value used as record type');
assert.throws(()=>validateImport({
  entity_type:'persona',entity_name:'Mina',
  records:[{...base,type:'tendency',modality:'tendency',knowledge_domain:'none',knowledge_state:'none'}],
}),/type: enum 위반/);
const unrelatedImport=validateImport({source_set_id:'old',entity_type:'npc',entity_name:'Other',records:[{...base,source_ids:['UNRELATED-1']}]});
assert.equal(unrelatedImport.output.entity_type,'npc');
assert.equal(unrelatedImport.output.entity_name,'Other');
assert.equal(unrelatedImport.source_set_id,'old');
assert.equal(unrelatedImport.output.records[0].source_ids[0],'UNRELATED-1');
assert.throws(()=>validateImport({entity_type:'unknown',entity_name:'Other',records:[base]}),/entity_type/);

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

console.log('Character Reasoner v0.9.0 regression checks passed.');
