import { API_VERSION, RECORD_VERSION, COMPILER_VERSION, COMPILER_PROMPT, PERSONA_GUIDANCE, npcGuidance, splitText, buildSources, promptText, extractJsonObject, cleanWhen, normalizeRecordTypes, hardValidateRecords, validateImport } from './core/index.js';
const EXT = 'Character Reasoner';
const EXT_VERSION = '0.9.0';
const META_KEY = 'characterReasonerBank';
const KINDS = ['character','persona','npc'];
const KIND_LABEL = { character: '캐릭터', persona: '페르소나', npc: 'NPC' };
const lore = { character: [], persona: [], npc: [] };
const drafts = { character: null, persona: null, npc: null };
let dlg, wi, personas, knownChat = '';

function ctx() { return SillyTavern.getContext(); }
function esc(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
function normalized(value) { return String(value ?? '').trim().replace(/\s+/g,' '); }
function uid() { return globalThis.crypto?.randomUUID?.() || ('cr-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)); }
function toast(message, type='info') { const t=ctx().toastr || globalThis.toastr; t?.[type]?.(message); }
function status(kind, message, bad=false) { const el=document.getElementById('cr-'+kind+'-status'); if(el){el.textContent=message;el.style.color=bad?'#ff8a80':'';} }
function currentChatId() { const c=ctx(); return String(c.chatId ?? c.getCurrentChatId?.() ?? c.groupId ?? ''); }

function syncChat() {
  const id=currentChatId();
  if(id!==knownChat){knownChat=id; KINDS.forEach(k=>drafts[k]=null);}
}

function emptyBank() { return { version: 1, banks: { character: [], persona: [], npc: [] } }; }
function chatBank() {
  syncChat();
  const c=ctx();
  if(!c.chatMetadata) throw new Error('현재 채팅의 메타데이터를 찾지 못했습니다.');
  let bank=c.chatMetadata[META_KEY];
  if(!bank || bank.version!==1 || !bank.banks) bank=c.chatMetadata[META_KEY]=emptyBank();
  for(const kind of KINDS) if(!Array.isArray(bank.banks[kind])) bank.banks[kind]=[];
  return bank;
}
function persistBank() { const c=ctx(); (c.saveMetadataDebounced || globalThis.saveMetadataDebounced)?.(); }
function saveVersion(kind, saveName, version) {
  const bank=chatBank(), groups=bank.banks[kind], key=normalized(saveName);
  let group=groups.find(x=>normalized(x.name).toLocaleLowerCase()===key.toLocaleLowerCase());
  if(!group){group={id:uid(),name:key,versions:[]};groups.push(group);}
  group.versions.unshift(structuredClone(version));
  persistBank();
  return group;
}
function allSaved() {
  const bank=chatBank(), rows=[];
  for(const kind of KINDS) for(const group of bank.banks[kind]) rows.push({kind,group});
  return rows.sort((a,b)=>String(b.group.versions?.[0]?.saved_at||'').localeCompare(String(a.group.versions?.[0]?.saved_at||'')));
}
function findGroup(kind, groupId) { return chatBank().banks[kind]?.find(x=>x.id===groupId); }
function deleteVersion(kind, groupId, versionId) {
  const groups=chatBank().banks[kind], group=groups.find(x=>x.id===groupId);
  if(!group)return false;
  group.versions=group.versions.filter(x=>x.id!==versionId);
  if(!group.versions.length) groups.splice(groups.indexOf(group),1);
  persistBank(); return true;
}

async function modules(){
  wi ||= await import('/scripts/world-info.js').catch(()=>null);
  personas ||= await import('/scripts/personas.js').catch(()=>null);
}
function currentCharacter(c=ctx()) { return c?.characters?.[c.characterId]; }
function characterInfo(c=ctx()) {
  const character=currentCharacter(c);
  if(!character)return {name:'',text:''};
  const card=character.data||character;
  const text=[['DESCRIPTION',card.description],['PERSONALITY',card.personality]]
    .map(([label,value])=>[label,String(value||'').trim()]).filter(([,value])=>value)
    .map(([label,value])=>label+':\n'+value).join('\n\n');
  return {name:String(card.name||character.name||'').trim(),text};
}
function personaInfo(c=ctx()) {
  const avatar=personas?.user_avatar, entry=avatar?c?.powerUserSettings?.persona_descriptions?.[avatar]:null;
  const text=c?.personaDescription||c?.persona?.description||(typeof entry==='string'?entry:entry?.description)||c?.powerUserSettings?.persona_description||'';
  const name=c?.name1||entry?.name||String(avatar||'').replace(/\.[^/.]+$/,'');
  return {name:String(name||'').trim(),text:String(text).trim()};
}
async function importSheet(kind) {
  await modules();
  const info=kind==='character'?characterInfo():personaInfo(), box=document.getElementById('cr-'+kind+'-sheet');
  if(!info.text){status(kind,'현재 '+KIND_LABEL[kind]+' 시트를 찾지 못했습니다.',true);return;}
  if(box.value.trim()&&!confirm('현재 입력된 시트를 가져온 시트로 바꿀까요?'))return;
  box.value=info.text; document.getElementById('cr-'+kind+'-name').value=info.name;
  drafts[kind]=null; status(kind,KIND_LABEL[kind]+' 시트를 가져왔습니다 · '+info.text.length+'자');
}
function charBooks() {
  const c=ctx(), ch=currentCharacter(c); if(!ch)return[];
  const primary=ch.data?.extensions?.world, key=String(ch.avatar||'').replace(/\.[^/.]+$/,'');
  const extra=wi?.world_info?.charLore?.find(x=>x.name===key)?.extraBooks||[];
  return [...new Set([primary,...(Array.isArray(extra)?extra:[])].filter(Boolean))];
}
function personaBooks() {
  const c=ctx(), p=c.powerUserSettings||{}, av=personas?.user_avatar, d=av?p.persona_descriptions?.[av]?.lorebook:'';
  return [...new Set([p.persona_description_lorebook,d].filter(Boolean))];
}
function npcBooks() { return [...new Set((wi?.world_names||[]).filter(Boolean))]; }
function entryTitle(e) {
  const a=String(e.comment||e.name||'').trim(), b=Array.isArray(e.key)?e.key.filter(Boolean).join(', '):String(e.key||'').trim();
  return a||b||('Entry '+e.uid);
}
async function loadLore(kind) {
  await modules();
  const books=kind==='character'?charBooks():kind==='persona'?personaBooks():npcBooks(), out=[];
  for(const book of books) try {
    const data=await ctx().loadWorldInfo(book), entries=data?.entries&&typeof data.entries==='object'?Object.entries(data.entries):[];
    for(const [fallback,raw] of entries) {
      if(!raw||!String(raw.content||'').trim())continue;
      const entryUid=String(raw.uid??fallback);
      out.push({id:book+'::'+entryUid,book,uid:entryUid,title:entryTitle({...raw,uid:entryUid}),content:String(raw.content).trim(),disabled:Boolean(raw.disable),order:Number(raw.order||0)});
    }
  } catch(e){console.warn('['+EXT+'] lore load failed',book,e);}
  const seen=new Set();
  lore[kind]=out.filter(x=>!seen.has(x.id)&&seen.add(x.id)).sort((a,b)=>b.order-a.order||a.title.localeCompare(b.title));
  renderLore(kind); drafts[kind]=null;
  status(kind,books.length+'개 로어북 · '+lore[kind].length+'개 항목');
}
function renderLore(kind) {
  const host=document.getElementById('cr-'+kind+'-lore'); if(!host)return;
  if(!lore[kind].length){host.innerHTML='<div class="cr-help">선택할 항목이 없습니다.</div>';return;}
  host.innerHTML=lore[kind].map(x=>'<button type="button" class="cr-lore-item" data-id="'+esc(x.id)+'" aria-pressed="false"><span class="cr-check" aria-hidden="true"></span><span><b class="cr-lore-title">'+esc(x.book)+' · '+esc(x.title)+(x.disabled?' · 비활성':'')+'</b><small class="cr-lore-preview">'+esc(x.content.replace(/\s+/g,' ').slice(0,150))+'</small></span></button>').join('');
  host.querySelectorAll('.cr-lore-item').forEach(row=>row.onclick=()=>{setLoreSelected(row,row.getAttribute('aria-pressed')!=='true');drafts[kind]=null;});
}
function setLoreSelected(row,on) { row.setAttribute('aria-pressed',String(Boolean(on)));row.classList.toggle('selected',Boolean(on)); }
function chosenLore(kind) {
  const ids=new Set([...document.querySelectorAll('#cr-'+kind+'-lore .cr-lore-item[aria-pressed="true"]')].map(x=>x.dataset.id));
  return lore[kind].filter(x=>ids.has(x.id));
}
function newDraft(kind) {
  syncChat();
  const name=normalized(document.getElementById('cr-'+kind+'-name')?.value), sheet=document.getElementById('cr-'+kind+'-sheet')?.value.trim();
  if(!name)throw new Error(KIND_LABEL[kind]+' 이름을 입력하세요.');
  const sources=buildSources(kind,sheet,chosenLore(kind));
  if(!sources.length)throw new Error('시트 또는 선택한 로어북 원문이 필요합니다.');
  return {entity_type:kind,entity_name:name,npc_role:kind==='npc'?(document.querySelector('input[name="cr-npc-role"]:checked')?.value||'mixed'):null,sources,created_at:new Date().toISOString()};
}
async function copyPrompt(kind) {
  try {
    const draft=newDraft(kind); drafts[kind]=draft;
    await navigator.clipboard.writeText(promptText(draft));
    status(kind,'분석 명령문을 복사했습니다. 공홈 AI에 붙여넣은 뒤 JSON 결과를 가져오세요.');
    toast('분석 명령문을 복사했습니다.','success');
  } catch(e){status(kind,e.message,true);toast(e.message,'error');}
}

async function importResult(kind, raw) {
  try {
    syncChat();
    const saveName=normalized(document.getElementById('cr-'+kind+'-save-name').value);
    if(!saveName)throw new Error('저장 이름을 입력하세요. 같은 이름은 날짜별 버전으로 모입니다.');
    const imported=validateImport(raw), output=imported.output, now=new Date().toISOString(), targetKind=output.entity_type;
    const version={id:uid(),apiVersion:API_VERSION,recordVersion:RECORD_VERSION,compilerVersion:COMPILER_VERSION,saved_at:now,entity_name:output.entity_name,source_set_id:imported.source_set_id,source_method:'external_json_import',npc_role:null,import_log:imported.import_log,output,sources:[]};
    if(imported.import_log.normalizations.length)console.info('['+EXT+'] import normalization',structuredClone(imported.import_log.normalizations));
    if(imported.import_log.import_mode==='standalone_json')console.info('['+EXT+'] standalone JSON import',structuredClone(imported.import_log));
    saveVersion(targetKind,saveName,version);
    document.getElementById('cr-'+kind+'-json').value=JSON.stringify(version.source_set_id?{...output,source_set_id:version.source_set_id}:output,null,2);
    const normalizedCount=imported.import_log.normalizations.length;
    status(kind,'✓ '+output.entity_name+' · '+output.records.length+'개 레코드를 '+KIND_LABEL[targetKind]+' “'+saveName+'”에 날짜별로 저장했습니다.\n명령문 상태와 관계없이 독립 JSON으로 저장했습니다.'+(normalizedCount?'\n명백한 type field-slot 오류 '+normalizedCount+'개를 core로 보정했습니다.':''));
    renderSaved(); toast('검증된 결과를 저장했습니다.','success');
  } catch(e){status(kind,'저장되지 않았습니다.\n'+e.message,true);toast('결과를 저장하지 못했습니다.','error');}
}
async function importFile(kind,file) {
  if(!file)return;
  if(!/\.json$/i.test(file.name)){status(kind,'.json 파일만 불러올 수 있습니다.',true);return;}
  try { const text=await file.text(); document.getElementById('cr-'+kind+'-json').value=text; status(kind,'JSON 파일을 불러왔습니다. 내용을 확인하고 검증 후 저장을 누르세요.'); }
  catch(e){status(kind,'파일을 읽지 못했습니다.\n'+e.message,true);}
}
function displayDate(iso) { try{return new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(iso));}catch{return iso;} }
function renderSaved() {
  const host=document.getElementById('cr-saved-list'); if(!host)return;
  let rows; try{rows=allSaved();}catch(e){host.innerHTML='<div class="cr-help">'+esc(e.message)+'</div>';return;}
  if(!rows.length){host.innerHTML='<div class="cr-help">이 채팅방에 저장된 분석이 없습니다.</div>';return;}
  host.innerHTML=rows.map(({kind,group})=>{
    const versions=group.versions||[], latest=versions[0], entity=latest?.entity_name||'';
    const versionRows=versions.map((v,i)=>'<div class="cr-version"><div><b>'+esc(displayDate(v.saved_at))+'</b><small>'+esc(v.entity_name)+' · '+(v.output?.records?.length||0)+' records'+(i===0?' · 최신':'')+'</small></div><div class="cr-saved-actions"><button class="menu_button" data-action="view" data-kind="'+kind+'" data-group="'+esc(group.id)+'" data-version="'+esc(v.id)+'">보기</button><button class="menu_button" data-action="copy" data-kind="'+kind+'" data-group="'+esc(group.id)+'" data-version="'+esc(v.id)+'">복사</button><button class="menu_button cr-danger" data-action="delete" data-kind="'+kind+'" data-group="'+esc(group.id)+'" data-version="'+esc(v.id)+'">삭제</button></div></div>').join('');
    return '<details class="cr-saved-group"><summary><span class="cr-tag cr-tag-'+kind+'">'+KIND_LABEL[kind]+'</span><b>'+esc(group.name)+'</b><small>'+esc(entity)+' · '+versions.length+'개 날짜본</small></summary>'+versionRows+'</details>';
  }).join('');
}
function savedVersion(kind,groupId,versionId) { return findGroup(kind,groupId)?.versions?.find(x=>x.id===versionId); }
function activateTab(kind) {
  dlg.querySelectorAll('.cr-tabs button').forEach(x=>x.classList.toggle('active',x.dataset.tab===kind));
  dlg.querySelectorAll('.cr-panel').forEach(x=>x.classList.toggle('active',x.dataset.kind===kind));
}
async function savedAction(event) {
  const button=event.target.closest('button[data-action]'); if(!button)return;
  const {action,kind,group:groupId,version:versionId}=button.dataset, group=findGroup(kind,groupId), version=savedVersion(kind,groupId,versionId);
  if(action==='delete') {
    if(version&&confirm('“'+group.name+'”의 '+displayDate(version.saved_at)+' 저장본을 삭제할까요?')){deleteVersion(kind,groupId,versionId);renderSaved();}
    return;
  }
  if(action==='copy'&&version){const exported=version.source_set_id?{...version.output,source_set_id:version.source_set_id}:version.output;await navigator.clipboard.writeText(JSON.stringify(exported,null,2));toast('저장본 JSON을 복사했습니다.','success');return;}
  if(action==='view'&&version) {
    activateTab(kind);
    document.getElementById('cr-'+kind+'-save-name').value=group.name;
    document.getElementById('cr-'+kind+'-name').value=version.entity_name;
    const exported=version.source_set_id?{...version.output,source_set_id:version.source_set_id}:version.output;
    document.getElementById('cr-'+kind+'-json').value=JSON.stringify(exported,null,2);
    status(kind,'저장본 · '+group.name+' · '+displayDate(version.saved_at));
  }
}
function deleteAllSaved() {
  const bank=chatBank(), count=KINDS.reduce((n,k)=>n+bank.banks[k].reduce((m,g)=>m+(g.versions?.length||0),0),0);
  if(!count)return;
  if(confirm('이 채팅방의 저장본 '+count+'개를 모두 삭제할까요?')){ctx().chatMetadata[META_KEY]=emptyBank();persistBank();renderSaved();}
}
function resetEditor(kind) {
  const name=document.getElementById('cr-'+kind+'-name'), sheet=document.getElementById('cr-'+kind+'-sheet'), json=document.getElementById('cr-'+kind+'-json'), saveName=document.getElementById('cr-'+kind+'-save-name');
  if((name.value.trim()||sheet.value.trim()||json.value.trim()||saveName.value.trim())&&!confirm('현재 입력 중인 내용을 비우고 새 항목을 시작할까요?'))return;
  name.value=''; sheet.value=''; json.value=''; saveName.value='';
  document.querySelectorAll('#cr-'+kind+'-lore .cr-lore-item').forEach(row=>setLoreSelected(row,false));
  if(kind==='npc'){const mixed=document.querySelector('input[name="cr-npc-role"][value="mixed"]');if(mixed)mixed.checked=true;}
  drafts[kind]=null; status(kind,'새 항목을 입력할 수 있습니다.');
}

function panel(kind,title) {
  const sheetButton=kind!=='npc'?'<button id="cr-'+kind+'-sheet-load" class="menu_button">현재 '+title+' 시트 가져오기</button>':'';
  const role=kind==='npc'?'<div><label>NPC 역할</label><div class="cr-role"><label><input type="radio" name="cr-npc-role" value="ally"> 선역</label><label><input type="radio" name="cr-npc-role" value="antagonist"> 악역</label><label><input type="radio" name="cr-npc-role" value="mixed" checked> 양립/혼합</label></div></div>':'';
  return '<section class="cr-panel '+(kind==='character'?'active':'')+'" data-kind="'+kind+'"><div class="cr-panel-toolbar"><b>'+title+' 관리</b><button id="cr-'+kind+'-reset" class="menu_button">새 항목 입력</button></div><div class="cr-card cr-source-card"><label>'+title+' 이름</label><input id="cr-'+kind+'-name" class="text_pole" autocomplete="off" placeholder="이름"><div class="cr-row cr-sheet-heading"><label>'+title+' 시트 원본</label>'+sheetButton+'</div><textarea id="cr-'+kind+'-sheet" class="text_pole" placeholder="원본 시트를 그대로 붙여 넣으세요."></textarea>'+role+'</div><div class="cr-card cr-lore-card"><div class="cr-row"><button id="cr-'+kind+'-lore-load" class="menu_button">'+(kind==='npc'?'로어북 목록 가져오기':'연결 로어북 가져오기')+'</button><button id="cr-'+kind+'-all" class="menu_button">전체 선택/해제</button></div><p class="cr-help">체크한 항목만 Source에 포함됩니다.</p><div id="cr-'+kind+'-lore" class="cr-lore-list"><div class="cr-help">아직 불러오지 않았습니다.</div></div></div><div class="cr-card cr-prompt-card"><button id="cr-'+kind+'-prompt" class="menu_button cr-compile">분석 명령문 복사</button><p class="cr-help">공홈 AI에 붙여넣고 반환된 JSON을 아래에 가져오세요. API 연결은 사용하지 않습니다.</p></div><div class="cr-card cr-import"><label>저장 이름</label><input id="cr-'+kind+'-save-name" class="text_pole" autocomplete="off" placeholder="예: 루카스 설정 정리"><p class="cr-help">같은 저장 이름은 한곳에 모이고, 저장할 때마다 날짜별 버전이 추가됩니다.</p><label>AI 분석 결과 가져오기</label><textarea id="cr-'+kind+'-json" class="text_pole cr-output" placeholder="JSON을 붙여넣거나 .json 파일을 끌어놓으세요."></textarea><div class="cr-row"><button id="cr-'+kind+'-import" class="menu_button">검증 후 저장</button><button id="cr-'+kind+'-file-button" class="menu_button">JSON 파일 불러오기</button><input id="cr-'+kind+'-file" type="file" accept=".json,application/json" hidden></div><div id="cr-'+kind+'-status" class="cr-status">대기</div></div></section>';
}
function makeDialog() {
  if(dlg)return;
  dlg=document.createElement('dialog'); dlg.id='character-reasoner-dialog';
  dlg.innerHTML='<div class="cr-shell"><header class="cr-header"><div class="cr-title"><h2>Character Reasoner</h2><p>Source 조립 · 외부 AI JSON 검증 · 채팅방별 저장</p></div><button id="cr-close" class="cr-icon-button"><i class="fa-solid fa-xmark"></i></button></header><nav class="cr-tabs"><button class="active" data-tab="character">캐릭터</button><button data-tab="persona">페르소나</button><button data-tab="npc">NPC</button></nav><main class="cr-main"><section class="cr-saved cr-card"><div class="cr-row cr-saved-header"><div><b>이 채팅방의 저장된 분석</b><p class="cr-help">종류와 이름별로 모이며, 펼치면 날짜별 저장본을 관리할 수 있습니다.</p></div><button id="cr-delete-all" class="menu_button cr-danger">전체 삭제</button></div><div id="cr-saved-list" class="cr-saved-list"></div></section>'+panel('character','캐릭터')+panel('persona','페르소나')+panel('npc','NPC')+'</main></div>';
  document.body.append(dlg);
  dlg.querySelector('#cr-close').onclick=()=>dlg.close();
  dlg.querySelector('#cr-saved-list').onclick=e=>void savedAction(e);
  dlg.querySelector('#cr-delete-all').onclick=deleteAllSaved;
  dlg.querySelectorAll('.cr-tabs button').forEach(b=>b.onclick=()=>activateTab(b.dataset.tab));
  for(const kind of KINDS) {
    document.getElementById('cr-'+kind+'-prompt').onclick=()=>void copyPrompt(kind);
    document.getElementById('cr-'+kind+'-reset').onclick=()=>resetEditor(kind);
    document.getElementById('cr-'+kind+'-lore-load').onclick=()=>void loadLore(kind);
    document.getElementById('cr-'+kind+'-all').onclick=()=>{const rows=[...document.querySelectorAll('#cr-'+kind+'-lore .cr-lore-item')],on=rows.some(x=>x.getAttribute('aria-pressed')!=='true');rows.forEach(x=>setLoreSelected(x,on));drafts[kind]=null;};
    document.getElementById('cr-'+kind+'-import').onclick=()=>void importResult(kind,document.getElementById('cr-'+kind+'-json').value);
    const file=document.getElementById('cr-'+kind+'-file');
    document.getElementById('cr-'+kind+'-file-button').onclick=()=>file.click();
    file.onchange=()=>void importFile(kind,file.files?.[0]);
    const area=document.getElementById('cr-'+kind+'-json'), card=area.closest('.cr-import');
    for(const eventName of ['dragenter','dragover'])card.addEventListener(eventName,e=>{e.preventDefault();card.classList.add('dragging');});
    for(const eventName of ['dragleave','drop'])card.addEventListener(eventName,e=>{e.preventDefault();card.classList.remove('dragging');});
    card.addEventListener('drop',e=>void importFile(kind,e.dataTransfer?.files?.[0]));
    for(const id of ['name','sheet'])document.getElementById('cr-'+kind+'-'+id).addEventListener('input',()=>drafts[kind]=null);
  }
  for(const kind of ['character','persona'])document.getElementById('cr-'+kind+'-sheet-load').onclick=()=>void importSheet(kind);
  document.querySelectorAll('input[name="cr-npc-role"]').forEach(x=>x.onchange=()=>drafts.npc=null);
  renderSaved();
}
async function open() {
  makeDialog(); syncChat(); renderSaved();
  if(!dlg.open)dlg.showModal();
}
function quick() {
  if(document.getElementById('character-reasoner-quick-button'))return true;
  const anchor=document.getElementById('extensionsMenuButton'), host=anchor?.parentElement||document.getElementById('leftSendForm')||document.getElementById('rightSendForm');
  if(!host)return false;
  const button=document.createElement('div');button.id='character-reasoner-quick-button';button.className='fa-solid fa-user interactable';button.tabIndex=0;button.title=EXT;button.setAttribute('role','button');button.onclick=()=>void open();
  anchor?.nextSibling?host.insertBefore(button,anchor.nextSibling):host.append(button); return true;
}
async function init() {
  await modules(); makeDialog();
  if(!quick()){const observer=new MutationObserver(()=>{if(quick())observer.disconnect();});observer.observe(document.body,{childList:true,subtree:true});}
  console.info('['+EXT+'] v'+EXT_VERSION+' loaded');
}
jQuery(()=>void init().catch(e=>{console.error('['+EXT+'] init failed',e);toast('확장을 불러오지 못했습니다.','error');}));
