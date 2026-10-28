/* Test double for @supabase/supabase-js (subset used by GECC). Data lives in localStorage so several tabs of one browser act like several devices. */
(function(){
  var KEY = '__fdb';
  function load(){ try{ var d = JSON.parse(localStorage.getItem(KEY)); if(d) return d; }catch(e){} return { t:{}, files:{}, users:[
    { id:'u-staff', email:'bkk-004@gecc.app', password:'rail2569', profile:{ username:'BKK-004', display_name:'นายสถานีกรุงเทพ', role:'staff', station_code:'1001' } },
    { id:'u-staff2', email:'nma-022@gecc.app', password:'rail2569', profile:{ username:'NMA-022', display_name:'นายสถานีนครราชสีมา', role:'staff', station_code:'2114' } },
    { id:'u-off', email:'g-10-458821@gecc.app', password:'gecc2569', profile:{ username:'G-10-458821', display_name:'เจ้าหน้าที่ GECC', role:'officer', station_code:null } } ] }; }
  function save(d){ localStorage.setItem(KEY, JSON.stringify(d)); }
  var bc = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('fdb') : null;
  var handlers = [];
  function dispatch(m){ handlers.forEach(function(h){ if(h.filter.table === m.table && (h.filter.event === '*' || h.filter.event === m.event)) h.cb({ eventType:m.event, new:m.new }); }); }
  if(bc) bc.onmessage = function(e){ dispatch(e.data); };
  function emit(table, event, row){ var m = { table:table, event:event, new:row }; if(bc) bc.postMessage(m); setTimeout(function(){ dispatch(m); }, 5); }
  function uuid(){ return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){ var r = Math.random()*16|0; return (c==='x'?r:(r&3|8)).toString(16); }); }
  function Q(t){ this.t = t; this.op = 'select'; this.f = []; this.ord = null; this.lim = null; this.one = null; this.rows = null; this.opts = null; this.ret = false; }
  Q.prototype.select = function(){ if(this.op === 'insert' || this.op === 'upsert') this.ret = true; return this; };
  Q.prototype.eq = function(k, v){ this.f.push([k, v]); return this; };
  Q.prototype.order = function(c, o){ this.ord = [c, !(o && o.ascending === false)]; return this; };
  Q.prototype.limit = function(n){ this.lim = n; return this; };
  Q.prototype.single = function(){ this.one = 'single'; return this; };
  Q.prototype.maybeSingle = function(){ this.one = 'maybe'; return this; };
  Q.prototype.insert = function(r){ this.op = 'insert'; this.rows = Array.isArray(r) ? r : [r]; return this; };
  Q.prototype.upsert = function(r, o){ this.op = 'upsert'; this.rows = Array.isArray(r) ? r : [r]; this.opts = o || {}; return this; };
  Q.prototype.delete = function(){ this.op = 'delete'; return this; };
  Q.prototype.then = function(res, rej){ var self = this; return new Promise(function(ok){ setTimeout(function(){ ok(self.run()); }, 2); }).then(res, rej); };
  Q.prototype.run = function(){
    var d = load(), t = this.t, self = this;
    var sess = sessionStorage.getItem('__fsess');
    if(t === 'profiles'){
      var rows = d.users.map(function(u){ return Object.assign({ id:u.id }, u.profile); });
      rows = rows.filter(function(r){ return self.f.every(function(kv){ return r[kv[0]] === kv[1]; }); });
      return this.fin(rows);
    }
    var tbl = d.t[t] = d.t[t] || [];
    var out;
    var match = function(r){ return self.f.every(function(kv){ return r[kv[0]] === kv[1]; }); };
    if(this.op === 'insert' || this.op === 'upsert'){
      out = [];
      this.rows.forEach(function(r){
        r = Object.assign({}, r);
        if((t === 'station_photos' || t === 'audit_images' || t === 'chat_messages') && !r.id) r.id = uuid();
        if(!r.created_at && (t !== 'audit_items' && t !== 'audit_meta' && t !== 'chat_reads')) r.created_at = new Date().toISOString();
        if(self.op === 'upsert'){
          var keys = (self.opts.onConflict || '').split(',').filter(Boolean);
          var idx = tbl.findIndex(function(x){ return keys.every(function(k){ return x[k] === r[k]; }); });
          if(idx > -1){ tbl[idx] = Object.assign(tbl[idx], r); out.push(tbl[idx]); emit(t, 'UPDATE', tbl[idx]); return; }
        }
        if(self.op === 'insert' && r.id && tbl.some(function(x){ return x.id === r.id; })) return;
        tbl.push(r); out.push(r); emit(t, 'INSERT', r);
      });
      save(d);
      return this.ret ? this.fin(out) : { data:null, error:null };
    }
    if(this.op === 'delete'){
      d.t[t] = tbl.filter(function(r){ return !match(r); }); save(d); return { data:null, error:null };
    }
    out = tbl.filter(match);
    if(this.ord){ var c = this.ord[0], asc = this.ord[1]; out = out.slice().sort(function(a, b){ return (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1); }); }
    if(this.lim != null) out = out.slice(0, this.lim);
    return this.fin(out);
  };
  Q.prototype.fin = function(rows){
    if(this.one === 'single'){ return rows.length === 1 ? { data:rows[0], error:null } : { data:null, error:{ message:'single() expects 1 row, got ' + rows.length } }; }
    if(this.one === 'maybe'){ return { data: rows[0] || null, error:null }; }
    return { data:rows, error:null };
  };
  var client = {
    from: function(t){ return new Q(t); },
    auth: {
      getSession: function(){ return Promise.resolve({ data:{ session: sessionStorage.getItem('__fsess') ? { user:{ id:sessionStorage.getItem('__fsess') } } : null } }); },
      signInWithPassword: function(c){ var u = load().users.find(function(x){ return x.email === c.email && x.password === c.password; }); if(!u) return Promise.resolve({ error:{ message:'Invalid login credentials' } }); sessionStorage.setItem('__fsess', u.id); return Promise.resolve({ data:{ user:{ id:u.id } }, error:null }); },
      signOut: function(){ sessionStorage.removeItem('__fsess'); return Promise.resolve({ error:null }); }
    },
    storage: { from: function(b){ return {
      upload: function(path, blob){ return new Promise(function(ok){ var fr = new FileReader(); fr.onload = function(){ var d = load(); d.files[path] = fr.result; save(d); ok({ data:{ path:path }, error:null }); }; fr.readAsDataURL(blob); }); },
      getPublicUrl: function(path){ return { data:{ publicUrl: (load().files[path] || 'about:blank') } }; },
      remove: function(paths){ var d = load(); paths.forEach(function(p){ delete d.files[p]; }); save(d); return Promise.resolve({ data:null, error:null }); }
    }; } },
    channel: function(){ var ch = { on: function(type, filter, cb){ handlers.push({ filter:filter, cb:cb }); return ch; }, subscribe: function(){ return ch; } }; return ch; }
  };
  window.supabase = { createClient: function(){ return client; } };
})();
