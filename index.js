const EXT = 'Character Reasoner';
const TYPES = ['fact','core','value','relationship','knowledge','reaction','expression','boundary','capability'];
const MODES = ['fact','habit','preference','tendency','conditional','possibility','negation'];
const BASES = ['explicit','direct_inference'];
const KDOM = ['none','self','person','relationship','history','event','secret','professional','organization','world','current'];
const KSTATE = ['none','knows','believes','suspects','doubts','misunderstands','does_not_know'];
const SETTINGS_KEY = 'characterReasoner';
const lore = { character: [], persona: [] };
let dlg, service, wi, personas;

const PROMPT = [
'You are a character-sheet compiler.',
'',
'Convert the supplied source material into compact retrieval records for later roleplay use.',
'This is NOT summarization. Do not write a profile, overview, analysis, explanation, biography, commentary, or prose introduction.',
'',
'Use only these information types:',
'- fact: identity, family, physical, biological, biographical, status, affiliation',
'- core: persistent temperament, preferences, general behavioral tendencies',
'- value: motives, priorities, values, goals, things protected or avoided',
'- relationship: target-specific trust, attachment, hostility, authority, expectations, dependency, boundaries',
'- knowledge: what the entity knows, believes, suspects, doubts, misunderstands, or explicitly does not know',
'- reaction: responses to specific pressures, threats, events, violations, or situations',
'- expression: speech, emotional display, affection style, conflict style, social presentation',
'- boundary: explicit contrasts, negations, limits, exceptions, or distinctions important for preventing mischaracterization',
'- capability: skills, authority, resources, responsibilities, access, competence, limitations',
'',
'SOURCE FIDELITY',
'Use only information supported by the supplied sources. Never invent hidden motives, fears, emotional causes, knowledge, relationships, preferences, prohibitions, competence, or moral qualities.',
'A minimal behavioral implication is allowed only when needed to operationalize an explicitly stated trait. Do not add psychological explanations.',
'Preserve uncertainty and modality exactly. Do not strengthen or weaken may, might, probably, usually, often, rarely, never, cannot, or conditions.',
'Do not generalize behavior toward one person into general personality. Do not treat sheet information as knowledge automatically possessed by the entity.',
'Do not turn a single isolated event into a permanent trait unless the source presents it as characteristic. Preserve contradictions instead of resolving them.',
'',
'RETRIEVAL ATOMICITY',
'Split when target, trigger, information type, knowledge state, temporal scope, modality, or behavioral consequence materially differ.',
'Keep information together when separation would destroy a contrast, qualification, condition, exception, or dependency.',
'Do not create one record per adjective. Merge adjacent traits if they share scope and retrieval circumstances and separating them gives no runtime value.',
'A record is too broad if its retrieval cues describe unrelated situations. A record is too narrow if another adjacent record is almost always required to preserve meaning.',
'',
'OUTPUT',
'Write rule and when values in concise English regardless of source language; preserve proper names exactly.',
'target: exact named person/group when target-specific, otherwise empty string.',
'when: 1-5 concrete retrieval cues, each 1-4 words. Do not use generic cues such as personality or behavior.',
'rule: one compact standalone statement, preferably 6-20 words. No explanation, examples, or literary prose.',
'basis: explicit when directly stated; direct_inference only for the minimum behavioral implication of explicit source material.',
'source_ids: cite only supplied source IDs that directly support the record.',
'For knowledge records set knowledge_domain and knowledge_state precisely. For all other types set both to none.',
'Remove semantic duplicates. Omit decorative details that cannot materially affect portrayal, continuity, knowledge, relationships, or plausible behavior.',
'Do not create record IDs. Do not output importance scores. Do not output fields outside the schema.'
].join('\n');

const BASE_SCHEMA = {
  type:'object', properties:{ records:{ type:'array', items:{ type:'object', properties:{
    type:{type:'string',enum:TYPES}, target:{type:'string'},
    when:{type:'array',minItems:1,maxItems:5,items:{type:'string'}}, rule:{type:'string'},
    modality:{type:'string',enum:MODES}, basis:{type:'string',enum:BASES},
    source_ids:{type:'array',minItems:1,items:{type:'string'}},
    knowledge_domain:{type:'string',enum:KDOM}, knowledge_state:{type:'string',enum:KSTATE}
  }, required:['type','target','when','rule','modality','basis','source_ids','knowledge_domain','knowledge_state'], additionalProperties:false }}},
  required:['records'], additionalProperties:false
};

function ctx(){ return SillyTavern.getContext(); }
function esc(v){ return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function status(k,t,bad){ const n=document.getElementById('cr-'+k+'-status'); if(n){n.textContent=t||'';n.style.color=bad?'#e57373':'';} }
function toast(t,type){ const f=window.toastr?.[type||'info']; if(typeof f==='function') f(t,EXT,{timeOut:1800}); }
function savedResults(){
  const c=ctx();
  c.extensionSettings ||= {};
  c.extensionSettings[SETTINGS_KEY] ||= {};
  const s=c.extensionSettings[SETTINGS_KEY];
  if(!Array.isArray(s.savedResults))s.savedResults=[];
  return s.savedResults;
}
function persistResults(){ const c=ctx(); if(typeof c.saveSettingsDebounced==='function')c.saveSettingsDebounced(); else if(typeof window.saveSettingsDebounced==='function')window.saveSettingsDebounced(); }
function saveResult(output){
  const item={id:globalThis.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2),saved_at:new Date().toISOString(),output};
  savedResults().unshift(item);
  persistResults();
  return item;
}
function saveCurrent(k){
  const v=document.getElementById('cr-'+k+'-output')?.value||'';
  if(!v)return;
  try{ saveResult(JSON.parse(v)); renderSaved(); status(k,'결과를 저장했습니다.'); toast('결과를 저장했습니다.','success'); }
  catch(e){ console.error('['+EXT+'] save failed',e); status(k,'저장 실패: 결과 JSON을 읽을 수 없습니다.',true); }
}
function formatSavedAt(v){ const d=new Date(v); return Number.isNaN(d.getTime())?String(v||''):d.toLocaleString(); }
function renderSaved(){
  const h=document.getElementById('cr-saved-list'), clear=document.getElementById('cr-delete-all');
  if(!h)return;
  const items=savedResults();
  if(clear)clear.disabled=!items.length;
  if(!items.length){h.innerHTML='<div class="cr-help">저장된 결과가 없습니다. 컴파일 후 결과 저장을 누르면 여기에 표시됩니다.</div>';return;}
  h.innerHTML=items.map(x=>{
    const o=x?.output||{}, kind={character:'캐릭터',persona:'페르소나',npc:'NPC'}[o.entity_type]||o.entity_type||'결과';
    const count=Array.isArray(o.records)?o.records.length:0;
    return '<div class="cr-saved-item" data-id="'+esc(x.id)+'"><div class="cr-saved-info"><b>'+esc(o.entity_name||'이름 없음')+'</b><small>'+esc(kind)+' · '+count+'개 레코드 · '+esc(formatSavedAt(x.saved_at))+'</small></div><div class="cr-saved-actions"><button class="menu_button" data-action="view">보기</button><button class="menu_button" data-action="copy">복사</button><button class="menu_button cr-danger" data-action="delete">삭제</button></div></div>';
  }).join('');
}
function findSaved(id){ return savedResults().find(x=>String(x?.id)===String(id)); }
function viewSaved(item){
  const k=item?.output?.entity_type;
  if(!['character','persona','npc'].includes(k))return;
  dlg.querySelectorAll('.cr-tabs button').forEach(x=>x.classList.toggle('active',x.dataset.tab===k));
  dlg.querySelectorAll('.cr-panel').forEach(x=>x.classList.toggle('active',x.dataset.kind===k));
  const name=document.getElementById('cr-'+k+'-name'), output=document.getElementById('cr-'+k+'-output'), result=document.getElementById('cr-'+k+'-result');
  if(name)name.value=item.output.entity_name||'';
  if(output)output.value=JSON.stringify(item.output,null,2);
  if(result)result.hidden=false;
  status(k,'저장된 결과 · '+formatSavedAt(item.saved_at));
}
async function copyText(v){
  if(!v)return;
  try{await navigator.clipboard.writeText(v);}catch{const a=document.createElement('textarea');a.value=v;a.style.position='fixed';a.style.left='-9999px';dlg.append(a);a.select();document.execCommand('copy');a.remove();}
}
async function savedAction(e){
  const button=e.target.closest('button[data-action]'), row=button?.closest('[data-id]');
  if(!button||!row)return;
  const action=button.dataset.action, item=findSaved(row.dataset.id);
  if(!item)return;
  if(action==='view')viewSaved(item);
  if(action==='copy'){await copyText(JSON.stringify(item.output,null,2));toast('저장된 결과를 복사했습니다.','success');}
  if(action==='delete'){
    if(!confirm('이 저장 결과를 삭제할까요?'))return;
    const items=savedResults(), index=items.findIndex(x=>String(x?.id)===String(item.id));
    if(index>=0)items.splice(index,1);
    persistResults(); renderSaved(); toast('저장 결과를 삭제했습니다.','success');
  }
}
function deleteAllSaved(){
  const items=savedResults();
  if(!items.length||!confirm('저장된 컴파일 결과를 모두 삭제할까요?'))return;
  items.splice(0,items.length); persistResults(); renderSaved(); toast('저장 결과를 모두 삭제했습니다.','success');
}
async function modules(){ service ||= (await import('/scripts/extensions/shared.js')).ConnectionManagerRequestService; wi ||= await import('/scripts/world-info.js').catch(()=>null); personas ||= await import('/scripts/personas.js').catch(()=>null); }
async function profile(){ await modules(); const c=ctx(), ps=service.getSupportedProfiles(), a=String(c.extensionSettings?.sceneReader?.reasonerProfileId||''), b=String(c.extensionSettings?.connectionManager?.selectedProfile||''); const p=ps.find(x=>String(x.id)===a)||ps.find(x=>String(x.id)===b)||ps[0]||null; const n=document.getElementById('cr-profile'); if(n)n.textContent=p?((String(p.id)===a&&a?'씬판독기 연결 프로필: ':'현재 연결 프로필: ')+(p.name||p.id)+' · '+(p.model||'모델 이름 없음')):'사용 가능한 연결 프로필 없음'; return p; }

function charBooks(){ const c=ctx(), ch=c.characters?.[c.characterId]; if(!ch)return[]; const primary=ch.data?.extensions?.world, key=String(ch.avatar||'').replace(/\.[^/.]+$/,''); const extra=wi?.world_info?.charLore?.find(x=>x.name===key)?.extraBooks||[]; return [...new Set([primary,...(Array.isArray(extra)?extra:[])].filter(Boolean))]; }
function personaBooks(){ const c=ctx(), p=c.powerUserSettings||{}, av=personas?.user_avatar, d=av?p.persona_descriptions?.[av]?.lorebook:''; return [...new Set([p.persona_description_lorebook,d].filter(Boolean))]; }
function entryTitle(e){ const a=String(e.comment||e.name||'').trim(), b=Array.isArray(e.key)?e.key.filter(Boolean).join(', '):String(e.key||'').trim(); return a||b||('Entry '+e.uid); }
async function loadLore(k){ await modules(); const books=k==='character'?charBooks():personaBooks(); const out=[]; for(const book of books){ try{ const d=await ctx().loadWorldInfo(book), es=d?.entries&&typeof d.entries==='object'?Object.entries(d.entries):[]; for(const pair of es){ const raw=pair[1]; if(!raw||!String(raw.content||'').trim())continue; const uid=String(raw.uid??pair[0]); out.push({id:book+'::'+uid,book,uid,title:entryTitle({...raw,uid}),content:String(raw.content).trim(),disabled:Boolean(raw.disable),order:Number(raw.order||0)}); } }catch(e){ console.warn('['+EXT+'] lore load failed',book,e); } } const seen=new Set(); lore[k]=out.filter(x=>!seen.has(x.id)&&seen.add(x.id)).sort((a,b)=>b.order-a.order||a.title.localeCompare(b.title)); renderLore(k); status(k,books.length+'개 로어북 · '+lore[k].length+'개 항목'); }
function renderLore(k){
  const h=document.getElementById('cr-'+k+'-lore');
  if(!h)return;
  if(!lore[k].length){h.innerHTML='<div class="cr-help">선택할 항목이 없습니다.</div>';return;}
  h.innerHTML=lore[k].map(x=>'<div class="cr-lore-item"><input type="checkbox" data-id="'+esc(x.id)+'" aria-label="'+esc(x.title)+' 선택"><span><b class="cr-lore-title">'+esc(x.book)+' · '+esc(x.title)+(x.disabled?' · 비활성':'')+'</b><small class="cr-lore-preview">'+esc(String(x.content).replace(/\s+/g,' ').slice(0,150))+'</small></span></div>').join('');
  h.onclick=e=>{
    const row=e.target.closest('.cr-lore-item'), box=row?.querySelector('input[type="checkbox"]');
    if(!box||e.target===box)return;
    box.checked=!box.checked;
    box.dispatchEvent(new Event('change',{bubbles:true}));
  };
}
function chosenLore(k){ const ids=new Set([...document.querySelectorAll('#cr-'+k+'-lore input[data-id]:checked')].map(x=>x.dataset.id)); return lore[k].filter(x=>ids.has(x.id)); }

function splitText(t){ t=String(t||'').replace(/\r\n?/g,'\n').trim(); if(!t)return[]; const blocks=[], lines=t.split('\n'); let buf=[]; const flush=()=>{const s=buf.join('\n').trim();if(s)blocks.push(s);buf=[];}; for(const line of lines){ if(!line.trim()){flush();continue;} if(/^\s*(?:[-*•]|\d+[.)])\s+/.test(line)||/^\s*#{1,6}\s+/.test(line)){flush();blocks.push(line.trim());continue;} if(buf.join('\n').length+line.length>1200)flush(); buf.push(line.trim()); } flush(); return blocks; }
function sources(k,text,lb){ const a=[]; let n=1; const add=(origin,label,body)=>a.push({id:'S'+String(n++).padStart(3,'0'),origin,label,text:String(body).trim()}); for(const b of splitText(text))add(k+'_sheet',k+'_sheet',b); for(const x of lb)add('lorebook',x.book+' · '+x.title,x.content); return a.filter(x=>x.text); }
function schema(ids){ const s=structuredClone(BASE_SCHEMA); s.properties.records.items.properties.source_ids.items.enum=ids; return s; }
function input(k,name,src){ return 'ENTITY_TYPE: '+k+'\nENTITY_NAME: '+name+'\n\nSOURCE MATERIAL\n'+src.map(x=>'['+x.id+' | '+x.origin+' | '+x.label+']\n'+x.text).join('\n\n'); }
function parse(v){ for(let i=0;i<5;i++){ if(Array.isArray(v))v=v.map(x=>typeof x==='string'?x:(x?.text||'')).join(''); else if(v&&typeof v==='object'){ if(typeof v.text==='string')v=v.text; else if(typeof v.content==='string'||Array.isArray(v.content))v=v.content; else if(typeof v.output==='string')v=v.output; else break;} else break;} if(typeof v==='string'){ let r=v.trim().replace(/^\uFEFF/,''); const m=r.match(/^(?:\x60){3}(?:json)?\s*([\s\S]*?)(?:\x60){3}$/i); v=JSON.parse((m?m[1]:r).trim()); } if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('모델이 JSON 객체를 반환하지 않았습니다.'); return v; }
function validate(r,ids){ if(!Array.isArray(r.records))throw new Error('records 배열이 없습니다.'); const ok=new Set(ids), seen=new Set(); let warn=0; for(const x of r.records){ if(!TYPES.includes(x.type)||!MODES.includes(x.modality)||!BASES.includes(x.basis))throw new Error('허용되지 않은 enum 값이 있습니다.'); if(!Array.isArray(x.when)||!x.when.length||x.when.length>5)throw new Error('when 형식이 잘못되었습니다.'); if(!Array.isArray(x.source_ids)||!x.source_ids.length||x.source_ids.some(id=>!ok.has(id)))throw new Error('존재하지 않는 source_id가 있습니다.'); if(x.type==='knowledge'){if(x.knowledge_domain==='none'||x.knowledge_state==='none')warn++;}else if(x.knowledge_domain!=='none'||x.knowledge_state!=='none')warn++; const key=String(x.rule||'').trim().toLowerCase(); if(!key)throw new Error('빈 rule이 있습니다.'); if(seen.has(key))warn++; seen.add(key); } return warn; }

async function compile(k){ const btn=document.getElementById('cr-'+k+'-compile'), name=String(document.getElementById('cr-'+k+'-name')?.value||'').trim(), text=String(document.getElementById('cr-'+k+'-sheet')?.value||'').trim(); if(!name){status(k,'이름을 입력하세요.',true);return;} const src=sources(k,text,k==='npc'?[]:chosenLore(k)); if(!src.length){status(k,'시트 원문이나 선택한 로어북 항목이 필요합니다.',true);return;} btn.disabled=true; status(k,'컴파일 중 · '+src.length+'개 source'); try{ const p=await profile(); if(!p)throw new Error('연결 프로필이 없습니다.'); const messages=[{role:'system',content:PROMPT},{role:'user',content:input(k,name,src)}]; const res=await service.sendRequest(p.id,messages,6000,{stream:false,extractData:true,includePreset:false,includeInstruct:true},{json_schema:{name:'character_retrieval_records',description:'Source-grounded atomic character retrieval records.',strict:true,value:schema(src.map(x=>x.id))}}); const r=parse(res?.content??res), w=validate(r,src.map(x=>x.id)); const out={entity_type:k,entity_name:name,records:r.records}; document.getElementById('cr-'+k+'-output').value=JSON.stringify(out,null,2); document.getElementById('cr-'+k+'-result').hidden=false; status(k,r.records.length+'개 레코드 생성'+(w?' · 검토 경고 '+w+'개':'')); }catch(e){console.error('['+EXT+'] compile failed',e);status(k,'실패: '+(e?.cause?.message||e?.message||e),true);}finally{btn.disabled=false;} }

async function copy(k){ const v=document.getElementById('cr-'+k+'-output')?.value||''; if(!v)return; await copyText(v); toast('결과를 복사했습니다.','success'); }
function panel(k,title,hasLore){ return '<section class="cr-panel '+(k==='character'?'active':'')+'" data-kind="'+k+'"><div class="cr-card"><label>'+title+' 이름</label><input id="cr-'+k+'-name" class="text_pole"><label>'+title+' 시트 원본</label><textarea id="cr-'+k+'-sheet" class="text_pole" placeholder="원본 시트를 그대로 붙여 넣으세요."></textarea></div>'+(hasLore?'<div class="cr-card"><div class="cr-row"><button id="cr-'+k+'-lore-load" class="menu_button">연결 로어북 가져오기</button><button id="cr-'+k+'-all" class="menu_button">전체 선택/해제</button></div><p class="cr-help">현재 연결된 로어북에서 체크한 항목만 함께 읽습니다.</p><div id="cr-'+k+'-lore" class="cr-lore-list"><div class="cr-help">아직 불러오지 않았습니다.</div></div></div>':'')+'<div class="cr-card"><button id="cr-'+k+'-compile" class="menu_button cr-compile">컴파일</button><div id="cr-'+k+'-status" class="cr-status">대기</div></div><div id="cr-'+k+'-result" class="cr-card" hidden><div class="cr-row"><b>결과 JSON</b><button id="cr-'+k+'-save" class="menu_button">결과 저장</button><button id="cr-'+k+'-copy" class="menu_button">결과 복사</button></div><textarea id="cr-'+k+'-output" class="text_pole cr-output" readonly></textarea></div></section>'; }
function makeDialog(){ if(dlg)return; dlg=document.createElement('dialog'); dlg.id='character-reasoner-dialog'; dlg.innerHTML='<div class="cr-shell"><header class="cr-header"><div class="cr-title"><h2>Character Reasoner</h2><p>시트 정규화 테스트 · Jev/임베딩/주입 없음</p></div><button id="cr-close" class="cr-icon-button"><i class="fa-solid fa-xmark"></i></button></header><div><div id="cr-profile" class="cr-profile">연결 프로필 확인 중…</div><nav class="cr-tabs"><button class="active" data-tab="character">캐릭터</button><button data-tab="persona">페르소나</button><button data-tab="npc">NPC</button></nav></div><main class="cr-main"><section class="cr-saved cr-card"><div class="cr-row cr-saved-header"><div><b>저장된 결과</b><p class="cr-help">결과 저장을 누른 항목만 현재 SillyTavern 사용자 설정에 남습니다.</p></div><button id="cr-delete-all" class="menu_button cr-danger">전체 삭제</button></div><div id="cr-saved-list" class="cr-saved-list"></div></section>'+panel('character','캐릭터',true)+panel('persona','페르소나',true)+panel('npc','NPC',false)+'</main></div>'; document.body.append(dlg); dlg.querySelector('#cr-close').onclick=()=>dlg.close(); dlg.querySelector('#cr-saved-list').onclick=e=>void savedAction(e); dlg.querySelector('#cr-delete-all').onclick=deleteAllSaved; dlg.querySelectorAll('.cr-tabs button').forEach(b=>b.onclick=()=>{dlg.querySelectorAll('.cr-tabs button').forEach(x=>x.classList.toggle('active',x===b));dlg.querySelectorAll('.cr-panel').forEach(x=>x.classList.toggle('active',x.dataset.kind===b.dataset.tab));}); ['character','persona','npc'].forEach(k=>{document.getElementById('cr-'+k+'-compile').onclick=()=>compile(k);document.getElementById('cr-'+k+'-save').onclick=()=>saveCurrent(k);document.getElementById('cr-'+k+'-copy').onclick=()=>copy(k);}); ['character','persona'].forEach(k=>{document.getElementById('cr-'+k+'-lore-load').onclick=()=>loadLore(k);document.getElementById('cr-'+k+'-all').onclick=()=>{const bs=[...document.querySelectorAll('#cr-'+k+'-lore input[type="checkbox"]')], on=bs.some(x=>!x.checked);bs.forEach(x=>x.checked=on);};}); renderSaved(); }
async function open(){ makeDialog(); const c=ctx(), a=document.getElementById('cr-character-name'), b=document.getElementById('cr-persona-name'); if(a&&!a.value)a.value=c.name2||''; if(b&&!b.value)b.value=c.name1||''; await profile().catch(()=>{}); if(!dlg.open)dlg.showModal(); }
function quick(){ if(document.getElementById('character-reasoner-quick-button'))return true; const e=document.getElementById('extensionsMenuButton'), h=e?.parentElement||document.getElementById('leftSendForm')||document.getElementById('rightSendForm'); if(!h)return false; const b=document.createElement('div');b.id='character-reasoner-quick-button';b.className='fa-solid fa-user interactable';b.tabIndex=0;b.title=EXT;b.setAttribute('role','button');b.onclick=()=>open();e?.nextSibling?h.insertBefore(b,e.nextSibling):h.append(b);return true; }
async function init(){ await modules(); makeDialog(); if(!quick()){const o=new MutationObserver(()=>{if(quick())o.disconnect();});o.observe(document.body,{childList:true,subtree:true});} await profile().catch(()=>{}); console.info('['+EXT+'] loaded'); }
jQuery(()=>void init().catch(e=>{console.error('['+EXT+'] init failed',e);toast('확장을 불러오지 못했습니다.','error');}));
