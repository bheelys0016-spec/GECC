/* ===================== GECC central database (Supabase) =====================
   Inactive until gecc-config.js contains the Supabase URL + anon key.
   Without it every page keeps working in local (browser-only) mode.            */
(function(){
'use strict';
if(window.GeccDB) return;

var cfg = window.GECC_CONFIG || {};
var enabled = !!(cfg.supabaseUrl && cfg.supabaseKey && /^https?:\/\//.test(cfg.supabaseUrl) && window.supabase && window.supabase.createClient);
var BUCKET = 'gecc-files';
var sb = null;
if(enabled){
  try{ sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth:{ persistSession:true, autoRefreshToken:true } }); }
  catch(e){ enabled = false; sb = null; }
}

var GeccDB = { enabled:enabled, me:null, BUCKET:BUCKET, client:sb };
window.GeccDB = GeccDB;

/* username -> pseudo e-mail used by Supabase Auth (accounts are created by the admin) */
function emailOf(u){ return String(u || '').trim().toLowerCase().replace(/\s+/g, '') + '@gecc.app'; }
GeccDB.emailOf = emailOf;

var LEGACY_OF = { '1001':'BKK-004', '1031':'AYA-011', '1118':'PLK-018', '2114':'NMA-022', '2290':'UBN-030', '4101':'PBI-014', '4239':'SRT-027', '4347':'HDY-033' };
GeccDB.syncLocal = function(m){
  try{
    localStorage.setItem('gecc-role', m.role === 'officer' ? 'auditor' : 'staff');
    if(m.role === 'staff'){ localStorage.setItem('gecc-station-code', LEGACY_OF[m.station] || m.station); }
    else{ localStorage.removeItem('gecc-station-code'); }
  }catch(e){}
};

function uuid(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  var b = new Uint8Array(16);
  if(window.crypto && crypto.getRandomValues) crypto.getRandomValues(b); else for(var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  var h = Array.prototype.map.call(b, function(x){ return ('0' + x.toString(16)).slice(-2); }).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}
GeccDB.uuid = uuid;

/* ---------- auth ---------- */
GeccDB.loadMe = async function(){
  if(!enabled) return null;
  var r = await sb.auth.getSession();
  var s = r && r.data && r.data.session;
  if(!s){ GeccDB.me = null; return null; }
  var p = await sb.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
  if(p.error || !p.data){ GeccDB.me = { id:s.user.id, noProfile:true }; return GeccDB.me; }
  GeccDB.me = { id:s.user.id, username:p.data.username, name:p.data.display_name || p.data.username, role:p.data.role, station:p.data.station_code || '' };
  return GeccDB.me;
};

GeccDB.signIn = async function(username, password, expectRole){
  if(!enabled) return { ok:false, error:'disabled' };
  var r = await sb.auth.signInWithPassword({ email: emailOf(username), password: password });
  if(r.error) return { ok:false, error:'invalid' };
  var m = await GeccDB.loadMe();
  if(!m || m.noProfile){ await sb.auth.signOut(); GeccDB.me = null; return { ok:false, error:'noprofile' }; }
  if(expectRole && m.role !== expectRole){ await sb.auth.signOut(); GeccDB.me = null; return { ok:false, error:'role' }; }
  GeccDB.syncLocal(m);
  return { ok:true, me:m };
};

GeccDB.signOut = async function(){
  try{ if(enabled) await sb.auth.signOut(); }catch(e){}
  try{ localStorage.removeItem('gecc-role'); localStorage.removeItem('gecc-station-code'); }catch(e){}
  GeccDB.me = null;
};

/* ready: resolves after the session check; content pages bounce to the login page when not signed in */
GeccDB.ready = (async function(){
  if(!enabled) return null;
  var m = null;
  try{ m = await GeccDB.loadMe(); }catch(e){ m = null; }
  if(!m || m.noProfile){
    try{ localStorage.removeItem('gecc-role'); localStorage.removeItem('gecc-station-code'); }catch(e){}
    if(!window.__geccNoGuard) location.replace('index.html');
    return null;
  }
  var before = '', after = '';
  try{ before = (localStorage.getItem('gecc-role') || '') + '|' + (localStorage.getItem('gecc-station-code') || ''); }catch(e){}
  GeccDB.syncLocal(m);
  try{ after = (localStorage.getItem('gecc-role') || '') + '|' + (localStorage.getItem('gecc-station-code') || ''); }catch(e){}
  try{
    if(before !== after && !sessionStorage.getItem('gecc-rl')){ sessionStorage.setItem('gecc-rl', '1'); location.reload(); }
    else if(before === after){ sessionStorage.removeItem('gecc-rl'); }
  }catch(e){}
  return m;
})();

document.addEventListener('click', function(ev){
  if(!enabled) return;
  var a = ev.target.closest && ev.target.closest('a[href="index.html"]');
  if(a && /ออกจากระบบ/.test(a.textContent)){
    ev.preventDefault();
    GeccDB.signOut().then(function(){ location.href = 'index.html'; });
  }
});

/* ---------- images / storage ---------- */
GeccDB.toBlob = function(file, maxSide, quality){
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onerror = reject;
    reader.onload = function(){
      var img = new Image();
      img.onerror = reject;
      img.onload = function(){
        var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function(b){ if(b) resolve(b); else reject(new Error('toBlob failed')); }, 'image/jpeg', quality || 0.78);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
};

GeccDB.uploadImage = async function(blob, folder, name){
  var safe = String(name || 'photo').replace(/[^\w.\-]+/g, '_').slice(-40);
  var path = folder + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + safe;
  var up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert:false });
  if(up.error) throw up.error;
  var pub = sb.storage.from(BUCKET).getPublicUrl(path);
  return { path:path, url:pub.data.publicUrl };
};
GeccDB.removeFiles = async function(paths){
  if(!paths || !paths.length) return;
  await sb.storage.from(BUCKET).remove(paths);
};

/* ---------- station photos ---------- */
GeccDB.listStationPhotos = async function(code){
  var r = await sb.from('station_photos').select('*').eq('station_code', code).order('created_at', { ascending:true });
  if(r.error) throw r.error;
  return r.data || [];
};
GeccDB.addStationPhoto = async function(code, blob, name){
  var up = await GeccDB.uploadImage(blob, 'stations/' + code, name);
  var r = await sb.from('station_photos').insert({ station_code:code, name:name, path:up.path, url:up.url }).select().single();
  if(r.error){ try{ await GeccDB.removeFiles([up.path]); }catch(e){} throw r.error; }
  return r.data;
};
GeccDB.deleteStationPhoto = async function(row){
  var r = await sb.from('station_photos').delete().eq('id', row.id);
  if(r.error) throw r.error;
  try{ await GeccDB.removeFiles([row.path]); }catch(e){}
};

/* ---------- audit (self-assessment) ---------- */
GeccDB.loadAudit = async function(code){
  var a = await sb.from('audit_items').select('*').eq('station_code', code);
  var b = await sb.from('audit_images').select('*').eq('station_code', code).order('created_at', { ascending:true });
  var c = await sb.from('audit_meta').select('*').eq('station_code', code).maybeSingle();
  if(a.error) throw a.error; if(b.error) throw b.error; if(c.error) throw c.error;
  return { items:a.data || [], images:b.data || [], meta:c.data || null };
};
GeccDB.saveAuditItem = async function(code, crit, no, f){
  var row = { station_code:code, crit:crit, item_no:no, checked:!!f.checked, auto_checked:!!f.autoChecked,
    note:f.note || '', drive_link:f.driveLink || '', evidence_time:f.evidenceTime || '', sub_checks:f.subChecks || {}, updated_at:new Date().toISOString() };
  var r = await sb.from('audit_items').upsert(row, { onConflict:'station_code,crit,item_no' });
  if(r.error) throw r.error;
};
GeccDB.saveAuditMeta = async function(code, agencyIdx){
  var r = await sb.from('audit_meta').upsert({ station_code:code, agency_idx:agencyIdx, updated_at:new Date().toISOString() }, { onConflict:'station_code' });
  if(r.error) throw r.error;
};
GeccDB.addAuditImage = async function(code, crit, no, blob, name){
  var up = await GeccDB.uploadImage(blob, 'audit/' + code, crit + '_' + no + '_' + name);
  var r = await sb.from('audit_images').insert({ station_code:code, crit:crit, item_no:no, name:name, path:up.path, url:up.url }).select().single();
  if(r.error){ try{ await GeccDB.removeFiles([up.path]); }catch(e){} throw r.error; }
  return r.data;
};
GeccDB.deleteAuditImage = async function(row){
  var r = await sb.from('audit_images').delete().eq('id', row.id);
  if(r.error) throw r.error;
  try{ await GeccDB.removeFiles([row.path]); }catch(e){}
};

/* ---------- chat ---------- */
GeccDB.chatLoad = async function(){
  var m = await sb.from('chat_messages').select('*').order('created_at', { ascending:false }).limit(1000);
  var r = await sb.from('chat_reads').select('*');
  if(m.error) throw m.error; if(r.error) throw r.error;
  return { messages:(m.data || []).slice().reverse(), reads:r.data || [] };
};
GeccDB.chatSend = async function(msg){
  var r = await sb.from('chat_messages').insert({ id:msg.id, station_code:msg.station_code, sender_role:msg.sender_role, text:msg.text });
  if(r.error) throw r.error;
};
GeccDB.chatRead = async function(code, side, iso){
  var r = await sb.from('chat_reads').upsert({ station_code:code, side:side, read_at:iso }, { onConflict:'station_code,side' });
  if(r.error) throw r.error;
};
GeccDB.chatSubscribe = function(onMsg, onRead){
  var ch = sb.channel('gecc-chat');
  ch.on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_messages' }, function(p){ if(p && p.new) onMsg(p.new); });
  ch.on('postgres_changes', { event:'*', schema:'public', table:'chat_reads' }, function(p){ if(p && p.new) onRead(p.new); });
  ch.subscribe();
  return ch;
};

})();
