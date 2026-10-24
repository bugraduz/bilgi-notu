(()=>{
  'use strict';
  const $ = id => document.getElementById(id);
  const FIELDS = ['subject','location','eventDate','eventTime','incident','followup','actionsTaken'];
  const STORE = 'bn_vault_v2', OLD_NOTES = 'bn_drafts_v1', OLD_WORK = 'bn_work_v1';
  const ITERATIONS = 310000;
  const EMPTY = {subject:'',location:'',eventDate:'',eventTime:'',incident:'',followup:'',actionsTaken:'',prosecutor:false,closing:true};
  const textCoder = new TextEncoder(), textDecoder = new TextDecoder();
  let key = null, username = '', notes = [], editingId = null, isUnlocked = false;
  let toastTimer = null, saveTimer = null, writing = Promise.resolve(), vaultSalt = null;

  function readJSON(k,fallback){try{let v=localStorage.getItem(k);return v?JSON.parse(v):fallback}catch(e){return fallback}}
  function writeJSON(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){toast('Cihazda kayıt için yeterli alan yok; kayıt yapılamadı.');return false}}
  function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500)}
  function setError(s){$('authError').textContent=s}
  function b64(bytes){let s='';for(const c of bytes)s+=String.fromCharCode(c);return btoa(s)}
  function fromB64(s){const text=atob(s);return Uint8Array.from(text,c=>c.charCodeAt(0))}
  async function derive(password,salt){
    const material=await crypto.subtle.importKey('raw',textCoder.encode(password),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function encryptData(data,cryptoKey){
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const crypt=await crypto.subtle.encrypt({name:'AES-GCM',iv},cryptoKey,textCoder.encode(JSON.stringify(data)));
    return {iv:b64(iv),ciphertext:b64(new Uint8Array(crypt))};
  }
  async function decryptData(vault,cryptoKey){
    if(!vault||vault.version!==2||typeof vault.iv!=='string'||typeof vault.ciphertext!=='string')throw Error('Geçersiz şifreli kayıt');
    const binary=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(vault.iv)},cryptoKey,fromB64(vault.ciphertext));
    const payload=JSON.parse(textDecoder.decode(binary));
    if(!payload||!Array.isArray(payload.notes)||payload.notes.length>2500||!payload.work)throw Error('Geçersiz kayıt yapısı');
    return payload;
  }
  function validVault(v){return v&&v.version===2&&v.iterations===ITERATIONS&&typeof v.username==='string'&&typeof v.salt==='string'&&typeof v.ciphertext==='string'&&typeof v.iv==='string'}
  function dataFromForm(){const d={};for(const field of FIELDS)d[field]=$(field).value;d.prosecutor=$('prosecutor').checked;d.closing=$('closing').checked;return d}
  function cleanData(d){const out={...EMPTY};for(const f of FIELDS)out[f]=typeof d?.[f]==='string'?d[f].slice(0,f==='incident'?50000:5000):'';out.prosecutor=!!d?.prosecutor;out.closing=d?.closing!==false;return out}
  function currentPayload(){return {notes,work:{data:dataFromForm(),editingId}}}
  function persist(payload){
    if(!isUnlocked||!key||!vaultSalt)return Promise.resolve(false);
    const storedKey=key,storedUser=username,storedSalt=vaultSalt;
    // Serialize encryption and writing to avoid an older draft overwriting a newer one.
    writing=writing.catch(()=>{}).then(async()=>{
      const enc=await encryptData(payload,storedKey);
      return writeJSON(STORE,{version:2,username:storedUser,iterations:ITERATIONS,salt:storedSalt,...enc});
    });
    return writing;
  }
  function persistNow(){clearTimeout(saveTimer);return persist(currentPayload())}
  function scheduleSave(){clearTimeout(saveTimer);if(isUnlocked)saveTimer=setTimeout(()=>{persistNow().catch(()=>toast('Kayıt sırasında hata oluştu.'))},250)}
  function populate(d){const clean=cleanData(d);for(const f of FIELDS)$(f).value=clean[f];$('prosecutor').checked=clean.prosecutor;$('closing').checked=clean.closing;renderPreview();scheduleSave()}
  function formatDate(iso){if(!/^\d{4}-\d{2}-\d{2}$/.test(iso||''))return '';const p=iso.split('-');return `${p[2]}.${p[1]}.${p[0]}`}
  function compact(s){return String(s||'').trim().replace(/[ \t]+/g,' ')}
  function descriptionParagraphs(d){
    let lead=[];if(compact(d.location))lead.push(compact(d.location));if(formatDate(d.eventDate))lead.push(formatDate(d.eventDate)+' Günü');if(d.eventTime&&/^\d{2}:\d{2}$/.test(d.eventTime))lead.push('Saat:'+d.eventTime.replace(':','.')+' sıralarında');
    let incident=(d.incident||'').trim();let first=[lead.join(' '),incident].filter(Boolean).join(' ');let paragraphs=[];if(first)paragraphs.push(first);if((d.followup||'').trim())paragraphs.push(d.followup.trim());if((d.actionsTaken||'').trim())paragraphs.push(d.actionsTaken.trim());if(d.prosecutor)paragraphs.push('Olay ile ilgili olarak Nöbetçi Cumhuriyet Savcısından alınan talimat ile adli tahkikata başlanmıştır.');if(d.closing)paragraphs.push('Arz ederim.');return paragraphs;
  }
  function noteText(d){return ['BİLGİ NOTU','','KONU: '+(d.subject||'').trim(),'','AÇIKLAMA:','',...descriptionParagraphs(d)].join('\n\n').replace(/\n{3,}/g,'\n\n').trim()}
  function addTextNode(tag,cls,str,parent){const el=document.createElement(tag);if(cls)el.className=cls;el.textContent=str;parent.appendChild(el);return el}
  function makeDocument(data){
    const doc=document.createElement('div');doc.className='document';addTextNode('div','doc-title','BİLGİ NOTU',doc);let row=document.createElement('div');row.className='doc-row';addTextNode('span','doc-label','KONU: ',row);row.appendChild(document.createTextNode((data.subject||'').trim()));doc.appendChild(row);row=document.createElement('div');row.className='doc-row';addTextNode('span','doc-label','AÇIKLAMA:',row);doc.appendChild(row);const p=descriptionParagraphs(data);for(const s of p)addTextNode('p','doc-paragraph',s,doc);if(!data.subject&&!data.incident)addTextNode('div','doc-empty','Bilgi notunuz burada görünecek.',doc);return doc;
  }
  function renderPreview(){const previous=$('previewDocument');const doc=makeDocument(dataFromForm());doc.id='previewDocument';previous.replaceWith(doc)}
  function enterApp(payload){
    notes=payload.notes;editingId=payload.work.editingId||null;isUnlocked=true;
    $('authArea').classList.add('hidden');$('appArea').classList.remove('hidden');$('lockApp').classList.remove('hidden');$('signedUser').classList.remove('hidden');$('signedUser').textContent=username;
    populate(payload.work.data||EMPTY);$('draftStatus').textContent=editingId?'Son açık kayıt':'Yeni taslak';renderList();updateStatus();
    $('loginPassword').value='';$('newPassword').value='';$('confirmPassword').value='';setError('');
  }
  async function lockApp(){
    if(!isUnlocked)return;
    clearTimeout(saveTimer);try{await persistNow();await writing}catch(e){toast('Son kaydın şifrelenmesi başarısız oldu.')}
    key=null;isUnlocked=false;notes=[];editingId=null;username='';vaultSalt=null;
    $('noteForm').reset();$('searchNotes').value='';$('noteList').replaceChildren();$('print-sheet').replaceChildren();
    $('appArea').classList.add('hidden');$('authArea').classList.remove('hidden');$('lockApp').classList.add('hidden');$('signedUser').classList.add('hidden');
    $('loginPassword').value='';showAuth();toast('Uygulama kilitlendi.');
  }
  function showAuth(){
    const vault=readJSON(STORE,null);const present=!!vault;
    $('createAccount').classList.toggle('hidden',present);$('loginAccount').classList.toggle('hidden',!present);
    if(present&&validVault(vault))$('loginUsername').value=vault.username;
    setError('');
  }
  async function createAccount(e){
    e.preventDefault();if(readJSON(STORE,null)){showAuth();return}
    const user=$('newUsername').value.trim();const password=$('newPassword').value;
    if(user.length<3||user.length>40){setError('Kullanıcı adı 3–40 karakter olmalı.');return}
    if(password.length<12){setError('Şifre en az 12 karakter olmalı.');return}
    if(password!==$('confirmPassword').value){setError('Şifreler birbiriyle eşleşmiyor.');return}
    const button=$('createButton');button.disabled=true;setError('');
    try{
      const salt=crypto.getRandomValues(new Uint8Array(16));const generatedKey=await derive(password,salt);const newSalt=b64(salt);
      // First-time transition: migrate any original plaintext local drafts into the new encrypted vault.
      const previousNotes=readJSON(OLD_NOTES,[]);const previousWork=readJSON(OLD_WORK,null);
      const nextNotes=Array.isArray(previousNotes)?previousNotes:[];
      const nextWork=previousWork?.data?previousWork:{data:{...EMPTY},editingId:null};
      const payload={notes:nextNotes,work:nextWork};const enc=await encryptData(payload,generatedKey);
      if(!writeJSON(STORE,{version:2,username:user,iterations:ITERATIONS,salt:newSalt,...enc}))throw Error('Yerel kayıt başarısız');
      localStorage.removeItem(OLD_NOTES);localStorage.removeItem(OLD_WORK);
      key=generatedKey;vaultSalt=newSalt;username=user;
      enterApp(payload);toast('Şifreli hesap oluşturuldu.');
    }catch(err){setError('Hesap oluşturulamadı. HTTPS üzerinde açtığından ve tarayıcı depolamasının açık olduğundan emin ol.')}finally{button.disabled=false}
  }
  async function loginAccount(e){
    e.preventDefault();const vault=readJSON(STORE,null);
    if(!validVault(vault)){setError('Cihazdaki şifreli kayıt okunamıyor.');return}
    if($('loginUsername').value.trim()!==vault.username){setError('Kullanıcı adı veya şifre yanlış.');return}
    const button=$('loginButton');button.disabled=true;setError('');
    try{
      const candidate=await derive($('loginPassword').value,fromB64(vault.salt));const payload=await decryptData(vault,candidate);
      key=candidate;username=vault.username;vaultSalt=vault.salt;enterApp(payload);
      toast('Giriş başarılı.');
    }catch(err){setError('Kullanıcı adı veya şifre yanlış ya da kayıt bozulmuş.')}finally{button.disabled=false}
  }
  function newNote(){if(!confirm('Yeni boş not açılsın mı? Kaydedilmemiş değişiklikler temizlenecek.'))return;editingId=null;populate(EMPTY);$('draftStatus').textContent='Yeni taslak';window.scrollTo({top:0,behavior:'smooth'});toast('Yeni bilgi notu açıldı.')}
  async function saveNote(ev){
    ev.preventDefault();if(!$('noteForm').reportValidity())return;
    const data=dataFromForm(),now=new Date().toISOString();let record=notes.find(n=>n.id===editingId);
    if(record){record.data=data;record.updatedAt=now}else{editingId='n'+Date.now()+Math.random().toString(36).slice(2,8);notes.unshift({id:editingId,data,createdAt:now,updatedAt:now})}
    try{if(await persistNow()){$('draftStatus').textContent='Kaydedildi';renderList();toast('Bilgi notu şifrelenerek kaydedildi.')}}catch(err){toast('Kayıt yapılamadı.')}
  }
  function renderList(){
    let q=$('searchNotes').value.trim().toLocaleLowerCase('tr');$('noteCount').textContent=notes.length+' kayıt';const list=$('noteList');list.replaceChildren();let matches=notes.filter(n=>{let d=n.data||{};return [d.subject,d.location,d.incident,d.followup,d.actionsTaken].join(' ').toLocaleLowerCase('tr').includes(q)}).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
    if(!matches.length){addTextNode('div','empty-list',q?'Aramanızla eşleşen kayıt bulunamadı.':'Henüz kayıt yok. İlk bilgi notunu yukarıdaki formdan oluşturun.',list);return}
    matches.forEach(n=>{const box=document.createElement('article');box.className='note-item';const top=document.createElement('div');top.className='note-top';addTextNode('div','note-meta',formatDate(n.data?.eventDate)||'Tarih belirtilmedi',top);box.appendChild(top);addTextNode('h3','',n.data?.subject||'Konusuz bilgi notu',box);let when=new Date(n.updatedAt);addTextNode('div','note-meta','Son kayıt: '+(Number.isNaN(when.getTime())?'Bilinmiyor':when.toLocaleString('tr-TR',{dateStyle:'short',timeStyle:'short'})),box);
      const acts=document.createElement('div');acts.className='note-actions';const edit=document.createElement('button');edit.type='button';edit.className='btn';edit.textContent='Aç / Düzenle';edit.addEventListener('click',()=>{editingId=n.id;populate(n.data||EMPTY);$('draftStatus').textContent='Kayıt düzenleniyor';window.scrollTo({top:0,behavior:'smooth'});toast('Kayıt açıldı.')});acts.appendChild(edit);
      const del=document.createElement('button');del.type='button';del.className='btn btn-danger';del.textContent='Sil';del.addEventListener('click',async()=>{if(!confirm('Bu bilgi notu cihazdan silinsin mi?'))return;notes=notes.filter(x=>x.id!==n.id);if(editingId===n.id){editingId=null;$('draftStatus').textContent='Yeni taslak'}try{await persistNow();renderList();toast('Kayıt silindi.')}catch(e){toast('Silme kaydedilemedi.')}});acts.appendChild(del);box.appendChild(acts);list.appendChild(box)
    });
  }
  function download(blob,filename){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000)}
  function filename(ext){const s=(dataFromForm().subject||'bilgi-notu').toLocaleLowerCase('tr').replace(/[^a-z0-9çğıöşü\s-]/gi,'').trim().replace(/\s+/g,'-').slice(0,45)||'bilgi-notu';return `${s}.${ext}`}
  function rtfEscape(str){let out='';for(let i=0;i<str.length;i++){let code=str.charCodeAt(i),c=str.charAt(i);if(c==='\\'||c==='{'||c==='}')out+='\\'+c;else if(c==='\n')out+='\\line ';else if(code>127)out+='\\u'+(code>32767?code-65536:code)+'?';else out+=c}return out}
  function asRTF(d){let out='{\\rtf1\\ansi\\ansicpg1254\\deff0{\\fonttbl{\\f0 Times New Roman;}}\\uc1\\paperw11906\\paperh16838\\margl1134\\margr1134\\margt1247\\margb1247\\f0\\fs24\\sl360\\slmult1 ';
    out+='\\pard\\qc\\b\\fs28 '+rtfEscape('BİLGİ NOTU')+'\\b0\\fs24\\par\\par';out+='\\pard\\ql\\b KONU: \\b0'+rtfEscape((d.subject||'').trim())+'\\par\\par';out+='\\b AÇIKLAMA:\\b0\\par\\par';descriptionParagraphs(d).forEach(p=>{out+=rtfEscape(p)+'\\par\\par'});return out+'}'}
  function showTextReady(){const d=dataFromForm();if(!d.subject.trim()||!d.incident.trim()){toast('Önce konu ve olay anlatımını girin.');return false}return true}
  async function copy(){if(!showTextReady())return;const txt=noteText(dataFromForm());try{await navigator.clipboard.writeText(txt);toast('Bilgi notu kopyalandı.')}catch(e){const t=document.createElement('textarea');t.value=txt;t.style.position='fixed';t.style.top='-9999px';document.body.appendChild(t);t.select();const ok=document.execCommand('copy');t.remove();toast(ok?'Bilgi notu kopyalandı.':'Kopyalama desteklenmiyor. Metni paylaşmayı deneyin.')}}
  async function share(){if(!showTextReady())return;const txt=noteText(dataFromForm());if(navigator.share){try{await navigator.share({title:'Bilgi Notu',text:txt})}catch(e){if(e.name!=='AbortError')toast('Paylaşılamadı; kopyalama seçeneğini deneyin.')}}else await copy()}
  function print(){if(!showTextReady())return;const p=$('print-sheet');p.replaceChildren(makeDocument(dataFromForm()));window.print()}
  async function backup(){
    try{await persistNow();await writing;const encrypted=readJSON(STORE,null);if(!validVault(encrypted))throw Error('missing vault');
      download(new Blob([JSON.stringify({format:'bilgi-notu-secure-backup',...encrypted},null,2)],{type:'application/json;charset=utf-8'}),'bilgi-notu-sifreli-yedek.json');
      toast('Şifreli yedek indirildi. Geri açmak için bu hesabın şifresi gerekir.');
    }catch(e){toast('Şifreli yedek oluşturulamadı.')}
  }
  async function importBackup(file){
    if(!file)return;
    if(file.size>6*1024*1024){toast('Yedek dosyası 6 MB sınırını aşıyor.');return}
    try{
      const obj=JSON.parse(await file.text());if(obj.format!=='bilgi-notu-secure-backup'||!validVault(obj))throw Error('invalid backup');
      const pass=prompt('Yedeğin oluşturulduğu hesabın şifresini gir:');if(pass===null)return;
      const backupKey=await derive(pass,fromB64(obj.salt));const payload=await decryptData(obj,backupKey);
      const incoming=payload.notes.map(n=>({id:String(n.id||'n'+Math.random()),data:cleanData(n.data),createdAt:String(n.createdAt||new Date().toISOString()),updatedAt:String(n.updatedAt||new Date().toISOString())}));
      if(!confirm(incoming.length+' şifreli kayıt yedekten eklensin mi? Mevcut kayıtlar silinmeyecek.'))return;
      const existing=new Set(notes.map(n=>n.id));for(const n of incoming){if(existing.has(n.id))n.id='n'+Date.now()+Math.random().toString(36).slice(2,8);notes.push(n);existing.add(n.id)}
      await persistNow();renderList();toast(incoming.length+' kayıt güvenli yedekten yüklendi.');
    }catch(e){toast('Yedek açılamadı. Dosyayı veya şifreyi kontrol edin.')}finally{$('importFile').value=''}
  }
  function updateStatus(){const offline=!navigator.onLine;if(offline){$('connectionStatus').textContent='● İnternet kapalı'}else if('serviceWorker'in navigator&&navigator.serviceWorker.controller){$('connectionStatus').textContent='● Offline hazır'}else{$('connectionStatus').textContent='● İlk kurulum / çevrimiçi'}}
  $('createForm').addEventListener('submit',createAccount);$('loginForm').addEventListener('submit',loginAccount);$('lockApp').addEventListener('click',lockApp);
  $('noteForm').addEventListener('submit',saveNote);$('noteForm').addEventListener('input',()=>{renderPreview();scheduleSave();$('draftStatus').textContent='Kaydedilmemiş değişiklik'});$('noteForm').addEventListener('change',()=>{renderPreview();scheduleSave()});$('newNote').addEventListener('click',newNote);
  $('copyNote').addEventListener('click',copy);$('shareNote').addEventListener('click',share);$('printNote').addEventListener('click',print);
  $('wordNote').addEventListener('click',()=>{if(showTextReady()){download(new Blob([asRTF(dataFromForm())],{type:'application/rtf'}),filename('rtf'));toast('Word ile açılabilir RTF dosyası hazırlandı.')}});
  $('txtNote').addEventListener('click',()=>{if(showTextReady())download(new Blob(['\ufeff'+noteText(dataFromForm())],{type:'text/plain;charset=utf-8'}),filename('txt'))});
  $('searchNotes').addEventListener('input',renderList);$('backupNotes').addEventListener('click',backup);$('importNotes').addEventListener('click',()=>$('importFile').click());$('importFile').addEventListener('change',e=>importBackup(e.target.files[0]));
  let backgroundAt = 0;
  document.addEventListener('visibilitychange',()=>{
    if(!isUnlocked)return;
    if(document.hidden){backgroundAt=Date.now();persistNow().catch(()=>{});}
    else if(backgroundAt && Date.now()-backgroundAt>120000){backgroundAt=0;lockApp();}
    else backgroundAt=0;
  });
  showAuth();updateStatus();window.addEventListener('online',updateStatus);window.addEventListener('offline',updateStatus);
  if(!crypto||!crypto.subtle||!crypto.getRandomValues){setError('Bu cihazda güvenli şifreleme desteklenmiyor. Uygulamayı HTTPS üzerinden Safari ile açın.');$('createButton').disabled=true;$('loginButton').disabled=true;}
  if('serviceWorker'in navigator&&location.protocol!=='file:'){
    window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').then(()=>navigator.serviceWorker.ready).then(()=>{updateStatus();navigator.serviceWorker.addEventListener('controllerchange',updateStatus)}).catch(()=>updateStatus()));
  }
})();