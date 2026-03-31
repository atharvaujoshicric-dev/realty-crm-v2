'use strict';
// ═══════════════════════════════════════════════════════════
//  RealtyFlow CRM v3 — app.js
//  Complete rewrite. All bugs fixed.
// ═══════════════════════════════════════════════════════════

const SB_URL = 'https://pwofvcxritpiauqbdkty.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3b2Z2Y3hyaXRwaWF1cWJka3R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzMyODgsImV4cCI6MjA4OTQwOTI4OH0.Qc5QREC1yFwQq0NWTGotDRPUkiqAn38OpmkC-M7pvR0';

// ── Safe localStorage (handles Edge/Safari tracking prevention) ──
const sto = {
  get:    k => { try { return localStorage.getItem(k); }    catch(e){ return null; } },
  set:    (k,v)=>{ try { localStorage.setItem(k,v); }       catch(e){} },
  del:    k => { try { localStorage.removeItem(k); }        catch(e){} }
};

// ── Supabase client ──────────────────────────────────────────
const sb = window.supabase.createClient(SB_URL, SB_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: { getItem: sto.get, setItem: sto.set, removeItem: sto.del }
  }
});

// ── User Management — SQL RPC only (no edge function needed) ──
// Uses SECURITY DEFINER SQL functions which run with superuser privileges.
async function api(action, payload = {}) {
  return await apiRPC(action, payload);
}

// SQL RPC fallback (works without edge function via SECURITY DEFINER functions)
async function apiRPC(action, payload) {
  if (action === 'create') {
    const { email, password, name, role, project_id } = payload;
    const { data: uid, error } = await sb.rpc('create_crm_user', {
      p_email: email, p_password: password, p_name: name, p_role: role
    });
    if (error) throw new Error(error.message);
    if (project_id && uid) {
      await sb.rpc('assign_to_project', { p_user_id: uid, p_project_id: project_id, p_role: role === 'admin' ? 'admin' : 'sales' });
    }
    return { id: uid, email, name, role };
  }
  if (action === 'delete') {
    const { user_id } = payload;
    const { error } = await sb.rpc('delete_crm_user', { p_user_id: user_id });
    if (error) throw new Error(error.message);
    return { success: true };
  }
  if (action === 'update') {
    const { user_id, name, role, password } = payload;
    if (name || role) {
      await sb.from('profiles').update({ ...(name&&{full_name:name}), ...(role&&{role}) }).eq('id', user_id);
    }
    if (password) {
      const { error } = await sb.rpc('update_user_password', { p_user_id: user_id, p_password: password });
      if (error) throw new Error(error.message);
    }
    return { success: true };
  }
  throw new Error('Unknown action: ' + action);
}

// ── State ────────────────────────────────────────────────────
const S = {
  user: null, profile: null,
  projects: [], curProj: null,
  bookings: [], cheques: [], prev: [], customFields: [],
  charts: {},
  editBkId: null, editChqId: null, editProjId: null, editUserId: null,
  clearProjId: null,
  booting: false,
};

// ── DOM helpers ──────────────────────────────────────────────
const el   = id => document.getElementById(id);
const v    = id => el(id)?.value ?? '';
const num  = id => parseFloat(v(id)) || 0;
const int_ = id => parseInt(v(id))   || 0;
const setF = (id, val) => { const e = el(id); if (e) e.value = val ?? ''; };
const clearF = ids => ids.forEach(id => setF(id, ''));
const esc  = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const showEl = id => { const e = el(id); if (e) e.style.display = ''; };
const hideEl = id => { const e = el(id); if (e) e.style.display = 'none'; };
const today  = () => new Date().toISOString().slice(0, 10);
const numFmt = n => (+n || 0).toLocaleString('en-IN');
const fmtL   = n => ((+n || 0) / 100000).toFixed(1) + 'L';
const fmtCr  = n => ((+n || 0) / 10000000).toFixed(2) + 'Cr';
const sum    = (arr, k) => arr.reduce((s, x) => s + (+x[k] || 0), 0);
const groupCount = (arr, k) => { const m = {}; arr.forEach(x => { const kv = x[k] || 'Unknown'; m[kv] = (m[kv]||0)+1; }); return m; };
const groupSum   = (arr, k, vk) => { const m = {}; arr.forEach(x => { const kv = x[k]||'Other'; m[kv]=(m[kv]||0)+(+x[vk]||0); }); return m; };
const openM  = id => el(id)?.classList.add('on');
const closeM = id => el(id)?.classList.remove('on');
window.addEventListener('click', e => { if(e.target.classList.contains('overlay')) e.target.classList.remove('on'); });

function sc(cls,icon,val,label,sub){
  return `<div class="sc ${cls}"><div class="sc-blob"></div><div class="sc-icon">${icon}</div><div class="sc-val">${val}</div><div class="sc-label">${label}</div><div class="sc-sub">${sub}</div></div>`;
}
function triplet(items){
  return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px">${items.map(x=>`<div style="text-align:center;padding:12px 7px;background:${x.bg};border-radius:9px"><div style="font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:700;color:${x.c}">${x.v}</div><div style="font-size:9.5px;text-transform:uppercase;letter-spacing:1px;color:var(--inkf);margin-top:3px">${x.l}</div></div>`).join('')}</div>`;
}
function statusBadge(s){
  const m={'Agreement Completed':'b-green','Disbursement Done':'b-green','Sanction Received':'b-blue','File Given':'b-gold','Under Process':'b-teal','Cancelled':'b-rose'};
  return `<span class="badge ${m[s]||'b-gray'}">${s||'—'}</span>`;
}
function chqBadge(t){ return {RPM:'b-blue',SM:'b-gold',BOUNCE:'b-rose',NILL:'b-gray',cash:'b-teal',Other:'b-gray'}[t]||'b-gray'; }
function cfInput(f,val,id){
  if(f.field_type==='select'&&f.field_options?.length)
    return `<select id="${id}"><option value="">—</option>${f.field_options.map(o=>`<option value="${o}"${val===o?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
  if(f.field_type==='textarea') return `<textarea id="${id}" rows="2">${esc(val)}</textarea>`;
  if(f.field_type==='boolean')
    return `<select id="${id}"><option value="">—</option><option value="Yes"${val==='Yes'?' selected':''}>Yes</option><option value="No"${val==='No'?' selected':''}>No</option></select>`;
  return `<input type="${f.field_type==='number'?'number':f.field_type==='date'?'date':'text'}" id="${id}" value="${esc(val)}">`;
}
function normLoanStatus(v){
  if(!v) return 'File Given';
  const vl=String(v).toLowerCase().trim();
  if(vl==='done'||vl.includes('agreement completed')) return 'Agreement Completed';
  if(vl.includes('sanction received')||vl.includes('sanction reciv')||vl.includes('sanction recied')) return 'Sanction Received';
  if(vl.includes('cancel')) return 'Cancelled';
  if(vl.includes('phase 2')||vl.includes('under process')||vl.includes('file under process')) return 'Under Process';
  if(vl.includes('self fund')) return 'Under Process';
  if(vl.includes('disburs')&&vl.includes('done')) return 'Disbursement Done';
  return 'File Given';
}
function normEntry(v){
  if(!v) return 'RPM';
  const vl=String(v).toUpperCase().trim();
  if(['RPM','SM','NILL','BOUNCE'].includes(vl)) return vl;
  if(vl==='OTHER') return 'Other';
  if(vl.includes('CASH')) return 'cash';
  if(vl.startsWith('PLOT')||vl.startsWith('INFRA')) return 'SM';
  return 'RPM';
}
async function cancelBk(id,name){
  if(!confirm(`Cancel booking for ${name}?\nThis sets status to Cancelled.`)) return;
  const {error}=await sb.from('bookings').update({loan_status:'Cancelled'}).eq('id',id);
  if(error){toast(error.message,'err');return;}
  await logAudit('cancel','booking',id,name,'Cancelled booking for '+name);
  await loadProjData(); renderBookings(); toast('Booking cancelled');
}
async function writeLog(action,entity,entityId,entityLabel){
  await logAudit(action,entity,entityId,entityLabel,entityLabel||'');
}


function toast(msg, type = 'ok') {
  const t = el('toast');
  t.textContent = (type==='ok'?'✓ ':type==='err'?'✕ ':'ℹ ') + msg;
  t.className = 'on t-' + type;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.className = '', 3500);
}

function setBtn(id, loading) {
  const b = el(id); if (!b) return;
  b.disabled = loading;
  if (loading) { if (!b.querySelector('.spin')) b.insertAdjacentHTML('beforeend', '<span class="spin"></span>'); }
  else b.querySelector('.spin')?.remove();
}

function showLoader(on) {
  const l = el('loader'); if (!l) return;
  if (on) { l.classList.remove('hide','gone'); l.style.display = 'flex'; }
  else {
    if (window._lk) { clearTimeout(window._lk); window._lk = null; }
    l.classList.add('hide');
    setTimeout(() => { l.classList.add('gone'); l.style.display = 'none'; }, 300);
  }
}

// ── BOOT ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) await boot(session.user);
    else showLogin();
  } catch(e) { console.error('Session error:', e); showLogin(); }

  sb.auth.onAuthStateChange(async (ev, sess) => {
    if (ev === 'SIGNED_IN' && sess?.user && !S.user && !S.booting) await boot(sess.user);
    if (ev === 'SIGNED_OUT') { S.user=null; S.profile=null; showLogin(); }
  });
});

async function boot(authUser) {
  if (S.booting) return; // prevent concurrent boots
  if (S.user?.id === authUser.id) return; // already booted
  S.booting = true;
  showLoader(true);
  try {
    let { data: prof, error } = await sb.from('profiles').select('*').eq('id', authUser.id).single();
    
    // Profile missing — try to auto-create it from auth metadata
    if (error || !prof) {
      const meta = authUser.user_metadata || {};
      const name = meta.full_name || authUser.email?.split('@')[0] || 'User';
      // Check if there are any superadmins — if none, make this user superadmin
      const { data: admins } = await sb.from('profiles').select('id').eq('role','superadmin').limit(1);
      const role = (!admins || admins.length === 0) ? 'superadmin' : 'sales';
      const { data: newProf, error: insErr } = await sb.from('profiles')
        .insert({ id: authUser.id, full_name: name, role })
        .select().single();
      if (insErr || !newProf) {
        await sb.auth.signOut();
        showLogin('Account setup incomplete. Ask your admin to run the profile setup SQL.');
        return;
      }
      prof = newProf;
    }
    S.user = authUser; S.profile = prof;
    el('ucName').textContent   = prof.full_name.split(' ')[0] || prof.full_name;
    el('ucAvatar').textContent = prof.full_name.charAt(0).toUpperCase();
    hideEl('loginWrap');
    showEl('app');
    el('app').classList.add('on');

    if (prof.role === 'superadmin') {
      buildNav('superadmin');
      goPage('p-sa-proj');
      renderSAProj();
    } else {
      await loadMyProjects();
      buildNav(prof.role);
      if (S.projects.length > 1) el('projChip').style.display = 'flex';
      if (S.curProj) { goPage('p-dash'); await loadProjData(); renderDash(); }
      else {
        // Don't wipe session — show error in app UI without logging out
        showLoader(false);
        goPage('p-dash');
        const d = el('dashStats');
        if (d) d.innerHTML = '<div style="padding:20px;color:var(--rose);font-size:14px">⚠️ No projects assigned to your account. Contact your administrator.</div>';
      }
    }
  } catch(e) {
    console.error('Boot error:', e);
    showLogin('Connection error: ' + e.message);
  } finally {
    S.booting = false;
    showLoader(false);
  }
}

// ── AUTH ─────────────────────────────────────────────────────
async function doLogin() {
  const email = v('li-email').trim(), pass = v('li-pass');
  if (!email || !pass) { showLoginErr('Email and password required'); return; }
  setBtn('loginBtn', true); hideLoginErr();
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) { showLoginErr(error.message); setBtn('loginBtn', false); return; }
    if (data?.user) await boot(data.user);
  } catch(e) { showLoginErr('Connection error: ' + e.message); }
  setBtn('loginBtn', false);
}

async function doLogout() {
  S.user = null; S.profile = null; S.curProj = null;
  S.projects = []; S.bookings = []; S.cheques = []; S.prev = [];
  showLogin();
  await sb.auth.signOut();
}

function showLogin(msg) {
  S.user = null; S.profile = null;
  showLoader(false);
  el('loginWrap').style.display = 'flex';
  el('app').classList.remove('on');
  el('navTabs').innerHTML = '';
  if (msg) showLoginErr(msg);
}
function showLoginErr(msg) { const e = el('loginErr'); e.textContent = msg; e.style.display = 'block'; }
function hideLoginErr()    { el('loginErr').style.display = 'none'; }

// ── NAV ──────────────────────────────────────────────────────
const NAV_TABS = {
  superadmin: [
    {id:'p-sa-proj',i:'🏗',l:'Projects'},
    {id:'p-sa-users',i:'👥',l:'Users'},
    {id:'p-sa-import',i:'📥',l:'Import CSV'},
    {id:'p-audit',i:'📋',l:'Audit Log'},
  ],
  admin: [
    {id:'p-dash',i:'📊',l:'Dashboard'},
    {id:'p-bookings',i:'🏡',l:'Bookings'},
    {id:'p-pipeline',i:'🔄',l:'Pipeline'},
    {id:'p-cheques',i:'🧾',l:'Cheques'},
    {id:'p-prev',i:'📁',l:'Prev Team'},
    {id:'p-analytics',i:'📈',l:'Analytics'},
    {id:'p-audit',i:'📋',l:'Audit Log'},
    {id:'p-settings',i:'⚙️',l:'Settings'},
  ],
  sales: [
    {id:'p-dash',i:'📊',l:'Dashboard'},
    {id:'p-bookings',i:'🏡',l:'Bookings'},
    {id:'p-pipeline',i:'🔄',l:'Pipeline'},
    {id:'p-cheques',i:'🧾',l:'Cheques'},
    {id:'p-prev',i:'📁',l:'Prev Team'},
    {id:'p-analytics',i:'📈',l:'Analytics'},
    {id:'p-sa-import',i:'📥',l:'Import CSV'},
  ],
};

function buildNav(role) {
  const tabs = NAV_TABS[role] || NAV_TABS.sales;
  const c = el('navTabs'); c.innerHTML = '';
  tabs.forEach(t => {
    const d = document.createElement('div');
    d.className = 'nav-tab'; d.dataset.page = t.id;
    d.innerHTML = `<span>${t.i}</span>${t.l}`;
    d.onclick = () => navigate(t.id);
    c.appendChild(d);
  });
  // Sales can now add/edit bookings, cheques, prev and import
  // Only settings and user management are restricted
  ['dashNewBk','bkNewBtn','chqNewBtn','prevNewBtn'].forEach(id => {
    const e = el(id); if (e) e.style.display = '';
  });
}

async function navigate(pid) {
  goPage(pid);
  const isSA = pid.startsWith('p-sa-');
  if (!isSA && S.curProj) await loadProjData();
  const map = {
    'p-sa-proj':   renderSAProj,
    'p-sa-users':  renderSAUsers,
    'p-sa-import': renderImportPage,
    'p-sa-audit':  renderSAAudit,
    'p-dash':      renderDash,
    'p-plotmap':   renderPlotMap,
    'p-bookings':  renderBookings,
    'p-pipeline':  renderPipeline,
    'p-cheques':   renderCheques,
    'p-prev':      renderPrev,
    'p-analytics': renderAnalytics,
    'p-audit':     renderProjectAudit,
    'p-settings':  renderSettings,
  };
  map[pid]?.();
}

function goPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  el(id)?.classList.add('active');
  document.querySelector(`[data-page="${id}"]`)?.classList.add('active');
}

function updateProjHeader() {
  const p = S.curProj; if (!p) return;
  el('pcName').textContent   = p.name;
  el('pcRole').textContent   = S.profile?.role || '';
  el('dashTitle').textContent = p.name;
  el('dashSub').textContent  = `${p.location || ''} · ${S.bookings.length} bookings`;
  el('backBtn').style.display = (S.profile?.role === 'superadmin' && S.curProj) ? 'block' : 'none';
}

async function loadMyProjects() {
  const { data } = await sb.from('project_members')
    .select('role, projects(*)')
    .eq('user_id', S.profile.id);
  S.projects = (data || []).map(m => ({ ...m.projects, myRole: m.role }));
  if (S.projects.length) S.curProj = S.projects[0];
  updateProjHeader();
}

async function loadProjData() {
  if (!S.curProj) return;
  const pid = S.curProj.id;
  const [b, c, p, cf] = await Promise.all([
    sb.from('bookings').select('*').eq('project_id', pid).order('serial_no', {nullsLast:true}).order('created_at'),
    sb.from('cheques').select('*').eq('project_id', pid).order('cheque_date', {ascending:false,nullsFirst:false}).order('created_at', {ascending:false}),
    sb.from('prev_bookings').select('*').eq('project_id', pid).order('created_at'),
    sb.from('custom_fields').select('*').eq('project_id', pid).order('sort_order'),
  ]);
  S.bookings = b.data || []; S.cheques = c.data || [];
  S.prev = p.data || []; S.customFields = cf.data || [];
}


async function viewProjAsAdmin(pid) {
  const { data: p } = await sb.from('projects').select('*').eq('id', pid).single();
  if (!p) return;
  S.curProj = p;
  buildNav('admin');
  el('backBtn').style.display = 'block';
  el('projChip').style.display = 'none';
  goPage('p-dash');
  await loadProjData(); updateProjHeader(); renderDash();
}

function backToProjects() {
  // Full reset back to SA project list
  S.curProj = null; S.bookings = []; S.cheques = []; S.prev = []; S.customFields = [];
  el('backBtn').style.display = 'none';
  el('projChip').style.display = 'none';
  buildNav('superadmin');
  goPage('p-sa-proj');
  renderSAProj();
}

async function openSwitcher() {
  const list = el('switcherList'); list.innerHTML = '';
  S.projects.forEach(p => {
    const row = document.createElement('div');
    row.style.cssText = 'padding:13px 20px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:11px;transition:background .15s';
    if (S.curProj?.id === p.id) row.style.background = 'var(--goldl)';
    row.innerHTML = `<div style="width:32px;height:32px;border-radius:8px;background:var(--ink);display:flex;align-items:center;justify-content:center;font-size:14px">🏘</div>
      <div><div style="font-weight:600;font-size:13px">${esc(p.name)}</div><div style="font-size:11px;color:var(--inkf)">${p.location||''}</div></div>`;
    row.onmouseover  = () => row.style.background = 'var(--paper)';
    row.onmouseleave = () => row.style.background = S.curProj?.id===p.id?'var(--goldl)':'';
    row.onclick = async () => {
      S.curProj = p; closeM('switcherModal');
      await loadProjData(); updateProjHeader(); renderDash(); goPage('p-dash');
    };
    list.appendChild(row);
  });
  openM('switcherModal');
}

// ── SA: PROJECTS ─────────────────────────────────────────────

// ── SA OVERVIEW DASHBOARD ─────────────────────────────────────
async function renderSAOverview() {
  const grid = el('saOverviewGrid');
  if (!grid) return;
  grid.innerHTML = `<div class="lc"><div class="spin spin-dk"></div> Loading all projects…</div>`;
  const [{ data: projs }, { data: bkAll }, { data: chqAll }] = await Promise.all([
    sb.from('projects').select('*').order('created_at'),
    sb.from('bookings').select('project_id,agreement_value,loan_status,disbursement_status,sanction_received,bank_name'),
    sb.from('cheques').select('project_id,amount,entry_type'),
  ]);
  if (!projs?.length) { grid.innerHTML = ''; return; }

  const bkByProj  = {};
  const chqByProj = {};
  (bkAll||[]).forEach(b  => { if(!bkByProj[b.project_id])  bkByProj[b.project_id]=[]; bkByProj[b.project_id].push(b); });
  (chqAll||[]).forEach(c => { if(!chqByProj[c.project_id]) chqByProj[c.project_id]=[]; chqByProj[c.project_id].push(c); });

  // Summary totals
  const totalBk   = (bkAll||[]).length;
  const totalVal  = (bkAll||[]).reduce((s,b)=>s+(+b.agreement_value||0),0);
  const totalDisb = (bkAll||[]).filter(b=>b.disbursement_status==='done').length;
  const totalChq  = (chqAll||[]).reduce((s,c)=>s+(+c.amount||0),0);

  el('saov-bk').textContent  = totalBk;
  el('saov-val').textContent = '₹'+fmtCr(totalVal);
  el('saov-disb').textContent= totalDisb;
  el('saov-chq').textContent = '₹'+fmtL(totalChq);

  grid.innerHTML = '';
  projs.forEach((p,i) => {
    const bks  = bkByProj[p.id]  || [];
    const chqs = chqByProj[p.id] || [];
    const val  = bks.reduce((s,b)=>s+(+b.agreement_value||0),0);
    const disb = bks.filter(b=>b.disbursement_status==='done').length;
    const sanc = bks.filter(b=>b.sanction_received==='Yes').length;
    const collected = chqs.reduce((s,c)=>s+(+c.amount||0),0);

    const card = document.createElement('div');
    card.className = 'proj-card';
    card.style.cursor = 'pointer';
    card.onclick = () => viewProjAsAdmin(p.id);
    card.innerHTML = `
      <div class="proj-hero sw${(p.swatch??i)%5}">
        <span style="font-size:32px;opacity:.5;z-index:1;position:relative">🏘</span>
        <div style="position:absolute;top:8px;right:10px;z-index:2"><span class="badge b-gold">${bks.length} bookings</span></div>
      </div>
      <div class="proj-body">
        <div class="proj-name">${esc(p.name)}</div>
        <div class="proj-loc">📍 ${esc(p.location||'—')}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
          <div><div style="font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:700">₹${fmtCr(val)}</div><div style="font-size:9.5px;color:var(--inkf);text-transform:uppercase;letter-spacing:.8px">Total Value</div></div>
          <div><div style="font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:700">${disb}</div><div style="font-size:9.5px;color:var(--inkf);text-transform:uppercase;letter-spacing:.8px">Disbursed</div></div>
          <div><div style="font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:700">${sanc}</div><div style="font-size:9.5px;color:var(--inkf);text-transform:uppercase;letter-spacing:.8px">Sanctions</div></div>
          <div><div style="font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:700">₹${fmtL(collected)}</div><div style="font-size:9.5px;color:var(--inkf);text-transform:uppercase;letter-spacing:.8px">Collected</div></div>
        </div>
      </div>
      <div class="proj-foot" style="gap:6px">
        <span class="badge b-gray" style="font-size:10px">${esc(p.developer||'—')}</span>
        <div style="display:flex;gap:5px">
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();editProject('${p.id}')">✏️</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--gold)" onclick="event.stopPropagation();openClearDataModal('${p.id}','${esc(p.name)}')">🗑 Data</button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteProject('${p.id}','${p.name.replace(/'/g,"\'")}')" >Delete</button>
        </div>
      </div>`;
    grid.appendChild(card);
  });
}


async function renderSAProj() {
  const grid = el('saGrid');
  grid.innerHTML = `<div class="lc"><div class="spin spin-dk"></div> Loading…</div>`;
  const [{ data: projs }, { data: allBk }, { data: allChq }] = await Promise.all([
    sb.from('projects').select('*').order('created_at'),
    sb.from('bookings').select('project_id,agreement_value,disbursement_status'),
    sb.from('cheques').select('project_id,amount'),
  ]);
  if (!projs?.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="ei">🏗</div><h3>No projects yet</h3><p>Create your first project</p></div>`;
    return;
  }
  const bkMap={}, valMap={}, disbMap={}, chqMap={};
  (allBk||[]).forEach(b=>{
    bkMap[b.project_id]=(bkMap[b.project_id]||0)+1;
    valMap[b.project_id]=(valMap[b.project_id]||0)+(+b.agreement_value||0);
    if(b.disbursement_status==='done') disbMap[b.project_id]=(disbMap[b.project_id]||0)+1;
  });
  (allChq||[]).forEach(c=>{ chqMap[c.project_id]=(chqMap[c.project_id]||0)+(+c.amount||0); });
  const totalBk=Object.values(bkMap).reduce((s,v)=>s+v,0);
  const totalVal=Object.values(valMap).reduce((s,v)=>s+v,0);
  const totalDisb=Object.values(disbMap).reduce((s,v)=>s+v,0);
  const totalChq=Object.values(chqMap).reduce((s,v)=>s+v,0);
  // Write stats to dedicated element
  const ov = el('saOverviewStats');
  if (ov) ov.innerHTML =
    sc('sc-gold','🏗',projs.length,'Projects','Platform-wide') +
    sc('sc-teal','🏡',totalBk,'Total Bookings','All projects') +
    sc('sc-sky','💰','₹'+fmtCr(totalVal),'Total Value','Agreement value') +
    sc('sc-sage','✅',totalDisb,'Disbursed','Loans done') +
    sc('sc-rose','🧾','₹'+fmtCr(totalChq),'Collected','All cheques');
  // Render project cards first (never block on charts)
  grid.innerHTML = '';
  // Draw platform charts safely
  try {
    ['saC1','saC2','saC3'].forEach(id=>{const cv=el(id);if(cv){const ex=Chart.getChart(cv);if(ex)ex.destroy();}});
    const pNames=projs.map(p=>p.name);
    const pBk=projs.map(p=>bkMap[p.id]||0);
    const pVal=projs.map(p=>Math.round((valMap[p.id]||0)/10000000*100)/100);
    const ct1=el('saC1-type')?.value||'bar';
    const ct3=el('saC3-type')?.value||'bar';
    if(el('saC1')) mkChart('saC1',ct1,pNames,pBk,'#c47d1a','Bookings');
    if(el('saC2')){const sg=groupCount(allBk||[],'loan_status');mkChart('saC2','doughnut',Object.keys(sg),Object.values(sg),['#c47d1a','#196060','#1a4870','#3a6040','#a83030','#8fa5b5'],'Count');}
    if(el('saC3')) mkChart('saC3',ct3,pNames,pVal,'#196060','₹Cr');
  } catch(e) { console.warn('SA charts:', e.message); }
  projs.forEach((p,i)=>{
    const bk=bkMap[p.id]||0,val=valMap[p.id]||0,disb=disbMap[p.id]||0,chq=chqMap[p.id]||0;
    const d=document.createElement('div'); d.className='proj-card';
    d.innerHTML=`
      <div class="proj-hero sw${(p.swatch??i)%5}">
        <span style="font-size:36px;opacity:.55;z-index:1;position:relative">🏘</span>
        <div style="position:absolute;top:8px;right:10px;z-index:2"><span class="badge b-gold">${bk} bookings</span></div>
      </div>
      <div class="proj-body">
        <div class="proj-name">${esc(p.name)}</div>
        <div class="proj-loc">📍 ${esc(p.location||'—')}</div>
        <div class="proj-stats">
          <div class="pst"><div class="v">${bk}</div><div class="l">Bookings</div></div>
          <div class="pst"><div class="v">₹${fmtCr(val)}</div><div class="l">Value</div></div>
          <div class="pst"><div class="v">${disb}</div><div class="l">Disbursed</div></div>
          <div class="pst"><div class="v">₹${fmtL(chq)}</div><div class="l">Collected</div></div>
        </div>
      </div>
      <div class="proj-foot">
        <span class="badge b-gray" style="font-size:11px">${esc(p.developer||'No developer')}</span>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();editProject('${p.id}')" title="Edit">✏️</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--gold)" onclick="event.stopPropagation();openClearDataModal('${p.id}','${esc(p.name)}')" title="Clear Data">🗑 Data</button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteProject('${p.id}','${p.name.replace(/'/g,"\'")}')">Delete</button>
          <button class="btn btn-gold btn-sm" onclick="event.stopPropagation();viewProjAsAdmin('${p.id}')">Open →</button>
        </div>
      </div>`;
    grid.appendChild(d);
  });
}
function openProjModal() {
  S.editProjId = null;
  el('projMTitle').textContent = 'New Project';
  el('projMSub').textContent  = 'Create project and provision user accounts';
  el('pm-save').textContent   = '🏗 Create Project';
  el('pm-new-user-fields').style.display = '';
  clearF(['pm-name','pm-loc','pm-dev','pm-rera','pm-aname','pm-amail','pm-apass','pm-sname','pm-smail','pm-spass']);
  setF('pm-plots',100); setF('pm-infra',100); setF('pm-legal',25000); setF('pm-sdr',6); setF('pm-maint',0);
  openM('projModal');
}

async function editProject(pid) {
  const { data: p } = await sb.from('projects').select('*').eq('id', pid).single();
  if (!p) return;
  S.editProjId = pid;
  el('projMTitle').textContent = 'Edit Project';
  el('projMSub').textContent  = 'Update project details';
  el('pm-save').textContent   = '💾 Save Changes';
  el('pm-new-user-fields').style.display = 'none';
  setF('pm-name',p.name); setF('pm-loc',p.location||''); setF('pm-dev',p.developer||'');
  setF('pm-rera',p.rera||''); setF('pm-plots',p.total_plots||100);
  setF('pm-infra',p.infra_rate||100); setF('pm-legal',p.legal_charges||25000);
  setF('pm-sdr',p.sdr_rate||6); setF('pm-maint',p.maintenance||0);
  openM('projModal');
}

async function saveProject() {
  const name = v('pm-name').trim();
  if (!name) { toast('Project name required','err'); return; }
  const data = {
    name, location:v('pm-loc'), developer:v('pm-dev'), rera:v('pm-rera'),
    total_plots:int_('pm-plots'), launch_date:v('pm-launch')||null,
    infra_rate:num('pm-infra'), legal_charges:num('pm-legal'),
    sdr_rate:num('pm-sdr'), maintenance:num('pm-maint'),
  };
  setBtn('pm-save', true);

  if (S.editProjId) {
    const { error } = await sb.from('projects').update(data).eq('id', S.editProjId);
    setBtn('pm-save', false);
    if (error) { toast(error.message,'err'); return; }
    toast('Project updated!');
    closeM('projModal'); renderSAProj(); return;
  }

  // New project
  const aname=v('pm-aname').trim(), amail=v('pm-amail').trim(), apass=v('pm-apass').trim();
  if (!aname||!amail||!apass) { setBtn('pm-save',false); toast('Admin name, email and password required','err'); return; }
  if (apass.length < 8)        { setBtn('pm-save',false); toast('Password must be at least 8 characters','err'); return; }

  data.swatch = ((await sb.from('projects').select('id')).data?.length||0) % 5;
  const { data: proj, error: pe } = await sb.from('projects').insert(data).select().single();
  if (pe) { setBtn('pm-save',false); toast(pe.message,'err'); return; }

  // Create admin user via edge function
  try {
    await api('create', { email:amail, password:apass, name:aname, role:'admin', project_id:proj.id });
  } catch(e) { setBtn('pm-save',false); toast('Project created but admin user failed: '+e.message,'err'); return; }

  // Optional sales user
  const sname=v('pm-sname').trim(), smail=v('pm-smail').trim(), spass=v('pm-spass').trim();
  if (smail && spass && sname && spass.length >= 8) {
    try { await api('create', { email:smail, password:spass, name:sname, role:'sales', project_id:proj.id }); }
    catch(e) { toast('Admin created. Sales user failed: '+e.message,'err'); }
  }

  setBtn('pm-save', false);
  toast('Project created & users provisioned!');
  closeM('projModal'); renderSAProj();
}

async function deleteProject(pid, pname) {
  if (!confirm(`Delete project "${pname}"?\n\nThis permanently deletes ALL data (bookings, cheques, etc.).\n\nThis cannot be undone.`)) return;
  const typed = prompt(`Type "${pname}" to confirm:`);
  if (typed !== pname) { toast('Name did not match — cancelled','err'); return; }
  toast('Deleting…','inf');
  await sb.from('bookings').delete().eq('project_id', pid);
  await sb.from('cheques').delete().eq('project_id', pid);
  await sb.from('prev_bookings').delete().eq('project_id', pid);
  await sb.from('custom_fields').delete().eq('project_id', pid);
  await sb.from('project_members').delete().eq('project_id', pid);
  const { error } = await sb.from('projects').delete().eq('id', pid);
  if (error) { toast('Error: '+error.message,'err'); return; }
  if (S.curProj?.id === pid) { S.curProj=null; el('backBtn').style.display='none'; }
  toast(`"${pname}" deleted`); renderSAProj();
}

// ── CLEAR PROJECT DATA (Super Admin only) ─────────────────────
function openClearDataModal(pid, pname) {
  S.clearProjId = pid;
  el('clear-proj-name').textContent = pname;
  setF('clear-confirm-input', '');
  openM('clearModal');
}

async function runClearData() {
  const pid = S.clearProjId;
  const { data: proj } = await sb.from('projects').select('name').eq('id', pid).single();
  const pname = proj?.name || '';
  const typed = v('clear-confirm-input').trim();
  if (typed !== pname) { toast('Project name did not match — cancelled','err'); return; }
  setBtn('clear-save', true);
  await sb.from('bookings').delete().eq('project_id', pid);
  await sb.from('cheques').delete().eq('project_id', pid);
  await sb.from('prev_bookings').delete().eq('project_id', pid);
  setBtn('clear-save', false);
  closeM('clearModal');
  if (S.curProj?.id === pid) { S.bookings=[]; S.cheques=[]; S.prev=[]; renderDash(); }
  toast(`All data cleared from "${pname}"`);
  renderSAProj();
}

// ── SA: USERS ────────────────────────────────────────────────
async function renderSAUsers() {
  const list = el('saUsersList');
  list.innerHTML = `<div class="lc"><div class="spin spin-dk"></div></div>`;
  const [{ data: profiles }, { data: members }] = await Promise.all([
    sb.from('profiles').select('*').order('created_at'),
    sb.from('project_members').select('user_id, role, projects(id,name)'),
  ]);
  list.innerHTML = '';
  (profiles||[]).forEach(u => {
    const um   = (members||[]).filter(m => m.user_id === u.id);
    const pnames = um.map(m => m.projects?.name).filter(Boolean);
    const row  = document.createElement('div'); row.className = 'u-row';
    row.innerHTML = `
      <div class="avatar">${u.full_name.charAt(0).toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div class="ui-n">${esc(u.full_name)}</div>
        <div class="ui-e">${u.role}</div>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-right:8px">
        ${pnames.map(n=>`<span style="font-size:11px;padding:2px 8px;border-radius:5px;background:var(--paper2);border:1px solid var(--border)">${esc(n)}</span>`).join('')}
      </div>
      <span class="role-pill rp-${u.role}">${u.role}</span>
      ${u.role!=='superadmin'?`
        <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditUser('${u.id}')" title="Edit">✏️</button>
        <button class="btn btn-ghost btn-sm btn-icon" style="color:var(--rose)" onclick="deleteUser('${u.id}','${esc(u.full_name)}')" title="Delete">🗑</button>
      `:''}`;
    list.appendChild(row);
  });
  if (!profiles?.length) list.innerHTML = `<div class="empty"><div class="ei">👥</div><h3>No users yet</h3></div>`;
}

async function openUserModal(projId) {
  S.editUserId = null;
  el('umTitle').textContent = 'Add User';
  el('umSub').textContent   = '';
  clearF(['um-name','um-email','um-pass']);
  el('um-role').value = 'admin';
  el('um-pass-g').style.display = '';
  // Show superadmin option only for superadmin
  el('um-sa-opt').style.display = S.profile?.role === 'superadmin' ? '' : 'none';
  // Project dropdown
  const psel = el('um-proj'), pgrp = el('um-proj-g');
  if (projId) {
    // Called from Settings — pre-select current project
    psel.innerHTML = `<option value="${projId}">${esc(S.curProj?.name||'')}</option>`;
    pgrp.style.display = '';
  } else {
    // Called from SA Users — show all projects
    const { data: ps } = await sb.from('projects').select('id,name').order('name');
    psel.innerHTML = `<option value="">— None (Platform user) —</option>` +
      (ps||[]).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    pgrp.style.display = '';
  }
  openM('userModal');
}

async function saveUser() {
  const name   = v('um-name').trim();
  const email  = v('um-email').trim();
  const pass   = v('um-pass').trim();
  const role   = el('um-role').value;
  const projId = v('um-proj') || null;
  if (!name||!email||!pass) { toast('Name, email and password required','err'); return; }
  if (pass.length < 8)       { toast('Password must be at least 8 characters','err'); return; }
  setBtn('um-save', true);
  try {
    await api('create', { email, password:pass, name, role, project_id:projId });
  } catch(e) { setBtn('um-save',false); toast(e.message,'err'); return; }
  setBtn('um-save', false);
  closeM('userModal');
  if (S.profile?.role === 'superadmin') await renderSAUsers();
  else await renderSettings();
  toast(`User "${name}" created!`);
}

async function openEditUser(uid) {
  S.editUserId = uid;
  const { data: prof } = await sb.from('profiles').select('*').eq('id', uid).single();
  if (!prof) return;
  setF('eu-name', prof.full_name);
  el('eu-role').value = prof.role;
  setF('eu-pass', '');
  openM('editUserModal');
}

async function saveEditUser() {
  const name = v('eu-name').trim(), role = el('eu-role').value, pass = v('eu-pass').trim();
  if (!name) { toast('Name required','err'); return; }
  setBtn('eu-save', true);
  try {
    await api('update', { user_id:S.editUserId, name, role, ...(pass?{password:pass}:{}) });
  } catch(e) { setBtn('eu-save',false); toast(e.message,'err'); return; }
  setBtn('eu-save', false);
  closeM('editUserModal');
  if (S.profile?.role === 'superadmin') await renderSAUsers(); else await renderSettings();
  toast('User updated!');
}

async function deleteUser(uid, name) {
  if (!confirm(`Delete user "${name}"?\n\nThey will permanently lose all access.`)) return;
  try { await api('delete', { user_id: uid }); }
  catch(e) { toast('Error: '+e.message,'err'); return; }
  if (S.profile?.role === 'superadmin') await renderSAUsers(); else await renderSettings();
  toast(`"${name}" deleted`);
}

async function removeProjUser(uid, pid) {
  if (!confirm('Remove this user from the project?')) return;
  await sb.from('project_members').delete().eq('user_id',uid).eq('project_id',pid);
  renderSettings();
  toast('User removed from project');
}

// ── DASHBOARD ────────────────────────────────────────────────
function renderDash() {
  const bk = S.bookings; updateProjHeader();
  const totalVal = sum(bk,'agreement_value');
  const agreed  = bk.filter(b => b.loan_status === 'Agreement Completed').length;
  const disb    = bk.filter(b => b.disbursement_status === 'done').length;
  const pend    = bk.filter(b => b.loan_status!=='Cancelled' && b.loan_status!=='Agreement Completed' && b.disbursement_status!=='done').length;
  const sanc    = bk.filter(b => b.sanction_received === 'Yes').length;
  el('dashStats').innerHTML = `
    ${sc('sc-gold','🏡',bk.length,'Total Bookings','All bookings')}
    ${sc('sc-teal','💰','₹'+fmtCr(totalVal),'Total Value','Agreement value')}
    ${sc('sc-sky','✅',agreed,'Agreements Done','Fully completed')}
    ${sc('sc-sage','🏦',sanc,'Sanctions','Received')}
    ${sc('sc-rose','⏳',pend,'Pending Files','Awaiting action')}`;
  el('dashRecent').innerHTML = [...bk].reverse().slice(0,7).map(b => `<tr>
    <td class="td-link" onclick="viewBk('${b.id}')">${esc(b.client_name)}</td>
    <td>Plot ${esc(b.plot_no)}</td>
    <td style="font-weight:700">₹${fmtL(b.agreement_value)}</td>
    <td>${esc(b.bank_name||'—')}</td>
    <td>${statusBadge(b.loan_status)}</td></tr>`).join('');
  const bankMap = groupCount(bk,'bank_name');
  el('dashBank').innerHTML = Object.entries(bankMap).sort((a,b)=>b[1]-a[1]).map(([bank,cnt]) => {
    const pct = bk.length ? Math.round(cnt/bk.length*100) : 0;
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span style="font-weight:600">${esc(bank||'—')}</span><span style="color:var(--inkf)">${cnt} (${pct}%)</span>
      </div>
      <div style="height:5px;background:var(--paper2);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--gold);border-radius:3px"></div>
      </div></div>`;
  }).join('');
  const done=disb, pndD=bk.filter(b=>b.disbursement_status!=='done'&&b.loan_status!=='Cancelled').length, canc=bk.filter(b=>b.loan_status==='Cancelled').length;
  el('dashDisb').innerHTML = triplet([{v:done,l:'Done',bg:'var(--sagel)',c:'var(--sage)'},{v:pndD,l:'Pending',bg:'var(--goldl)',c:'var(--gold)'},{v:canc,l:'Cancelled',bg:'var(--rosel)',c:'var(--rose)'}]);
  const selfC=bk.filter(b=>b.bank_name==='Self').length, bankC=bk.filter(b=>b.bank_name&&b.bank_name!=='Self'&&b.bank_name!=='Phase 2').length;
  const pct2 = bk.length ? Math.round(bankC/bk.length*100) : 0;
  el('dashFin').innerHTML = `
    <div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px"><span>🏦 Bank Financed</span><span style="font-weight:600">${bankC} · ${pct2}%</span></div>
    <div style="height:7px;background:var(--paper2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct2}%;background:var(--ink);border-radius:4px"></div></div></div>
    <div><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px"><span>💵 Self Funded</span><span style="font-weight:600">${selfC} · ${100-pct2}%</span></div>
    <div style="height:7px;background:var(--paper2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${100-pct2}%;background:var(--gold);border-radius:4px"></div></div></div>`;
}

// ── BOOKINGS ─────────────────────────────────────────────────
function renderBookings() {
  let d = [...S.bookings];
  const s=v('bk-s').toLowerCase(), bank=v('bk-bank'), sts=v('bk-sts'), dis=v('bk-dis');
  if (s) d=d.filter(b=>b.client_name.toLowerCase().includes(s)||String(b.plot_no).includes(s)||(b.contact||'').includes(s));
  if (bank) d=d.filter(b=>(b.bank_name||'').toLowerCase()===bank.toLowerCase());
  if (sts)  d=d.filter(b=>b.loan_status===sts);
  if (dis==='done')    d=d.filter(b=>b.disbursement_status==='done');
  if (dis==='pending') d=d.filter(b=>b.disbursement_status!=='done');
  el('bkCnt').textContent = `${d.length} of ${S.bookings.length}`;
  const cf = S.customFields.filter(f=>f.applies_to==='booking');
  const canEdit   = true;
  const canCancel = true;
  const canDel    = S.profile?.role === 'admin' || S.profile?.role === 'superadmin';
  el('bkHead').innerHTML = `<tr><th>#</th><th>Date</th><th>Client</th><th>Contact</th><th>Plot</th><th>Area</th><th>Rate</th><th>Agr. Value</th><th>SDR</th><th>Bank</th><th>Sanction</th><th>Disbursement</th><th>Status</th>${cf.map(f=>`<th>${esc(f.field_label)}</th>`).join('')}<th></th></tr>`;
  const tbody = el('bkBody');
  if (!d.length) {
    tbody.innerHTML = `<tr><td colspan="${14+cf.length}"><div class="empty"><div class="ei">🔍</div><h3>No bookings found</h3><p>Adjust filters or add a booking</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = d.map((b,i) => `<tr>
    <td class="td-dim">${b.serial_no||i+1}</td>
    <td class="td-dim">${b.booking_date||'—'}</td>
    <td class="td-link td-name" onclick="viewBk('${b.id}')">${esc(b.client_name)}</td>
    <td class="td-mono">${esc(b.contact||'—')}</td>
    <td><strong>Plot ${esc(b.plot_no)}</strong></td>
    <td class="td-dim">${numFmt(b.plot_size)}</td>
    <td class="td-dim">₹${numFmt(b.basic_rate)}</td>
    <td style="font-weight:700">₹${numFmt(b.agreement_value)}</td>
    <td class="td-dim">₹${numFmt(b.sdr)}</td>
    <td>${esc(b.bank_name||'—')}</td>
    <td>${b.sanction_received?`<span class="badge b-green">${esc(b.sanction_received)}</span>`:'<span class="badge b-gray">—</span>'}</td>
    <td>${b.disbursement_status==='done'?'<span class="badge b-teal">✓ Done</span>':'<span class="badge b-gray">Pending</span>'}</td>
    <td>${statusBadge(b.loan_status)}</td>
    ${cf.map(f=>`<td class="td-dim">${esc(String((b.custom_data||{})[f.field_name]||'—'))}</td>`).join('')}
    <td><div style="display:flex;gap:4px">
      ${canEdit?`<button class="btn btn-ghost btn-sm btn-icon" onclick="editBk('${b.id}')" title="Edit">✏️</button>`:''}
      ${canCancel&&b.loan_status!=='Cancelled'?`<button class="btn btn-ghost btn-sm btn-icon" style="color:var(--rose)" onclick="cancelBk('${b.id}','${esc(b.client_name)}')" title="Cancel Booking">✕</button>`:''}
      ${canDel ?`<button class="btn btn-ghost btn-sm btn-icon" style="color:var(--rose)" onclick="delBk('${b.id}')" title="Delete">🗑</button>`:''}
    </div></td></tr>`).join('');
}
function clearBkF() { ['bk-s','bk-bank','bk-sts','bk-dis'].forEach(id=>{const e=el(id);if(e)e.value='';}); renderBookings(); }

// ── PIPELINE ─────────────────────────────────────────────────
function renderPipeline() {
  const bk = S.bookings;
  const stages = {'File Given':[],'Under Process':[],'Sanction Received':[],'Disbursement Done':[],'Agreement Completed':[]};
  bk.forEach(b => {
    if (b.loan_status==='Cancelled') return;
    // Agreement Completed takes priority - don't override with disbursement status
    const k = b.loan_status === 'Agreement Completed' ? 'Agreement Completed'
            : b.disbursement_status === 'done'        ? 'Disbursement Done'
            : b.loan_status;
    (stages[k] || stages['Under Process']).push(b);
  });
  const total = bk.filter(b=>b.loan_status!=='Cancelled').length;
  const sanc  = bk.filter(b=>b.sanction_received==='Yes').length;
  const disb  = bk.filter(b=>b.disbursement_status==='done').length;
  el('pipeStats').innerHTML = `
    <div class="card" style="padding:14px 18px;border-left:3px solid var(--gold)"><div style="font-size:10px;color:var(--inkf);text-transform:uppercase;letter-spacing:1px">Active Files</div><div style="font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:700;margin-top:3px">${total}</div></div>
    <div class="card" style="padding:14px 18px;border-left:3px solid var(--sky)"><div style="font-size:10px;color:var(--inkf);text-transform:uppercase;letter-spacing:1px">Sanctions Received</div><div style="font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:700;margin-top:3px">${sanc}</div></div>
    <div class="card" style="padding:14px 18px;border-left:3px solid var(--sage)"><div style="font-size:10px;color:var(--inkf);text-transform:uppercase;letter-spacing:1px">Disbursements Done</div><div style="font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:700;margin-top:3px">${disb}</div></div>`;
  const stageC = {'File Given':'var(--gold)','Under Process':'var(--teal)','Sanction Received':'var(--sky)','Disbursement Done':'var(--sage)','Agreement Completed':'#2a5c30'};
  const board = el('kanban'); board.innerHTML = '';
  Object.entries(stages).forEach(([stage,items]) => {
    const col = document.createElement('div'); col.className = 'kb-col';
    const c = stageC[stage];
    col.innerHTML = `<div class="kb-col-hd" style="color:${c};border-left:3px solid ${c}">${stage}<span class="kb-cnt">${items.length}</span></div>
      <div class="kb-cards">${items.length ? items.map(b=>`<div class="kb-card" onclick="viewBk('${b.id}')"><div class="kc-n">${esc(b.client_name)}</div><div class="kc-i">Plot ${esc(b.plot_no)} · ${esc(b.bank_name||'')}</div><div class="kc-v">₹${fmtL(b.agreement_value)}</div></div>`).join('') : '<div style="text-align:center;padding:16px;font-size:12px;color:var(--inkf)">Empty</div>'}</div>`;
    board.appendChild(col);
  });
}

// ── CHEQUES ──────────────────────────────────────────────────
function renderCheques() {
  let d = [...S.cheques];
  const s=v('chq-s').toLowerCase(), typ=v('chq-t');
  if (s) d=d.filter(c=>c.cust_name.toLowerCase().includes(s)||(c.cheque_no||'').toLowerCase().includes(s));
  if (typ) d=d.filter(c=>c.entry_type===typ);
  const total=d.reduce((s,c)=>s+(+c.amount||0),0);
  const rpm=d.filter(c=>c.entry_type==='RPM').reduce((s,c)=>s+(+c.amount||0),0);
  const sm =d.filter(c=>c.entry_type==='SM').reduce((s,c)=>s+(+c.amount||0),0);
  el('chqSummary').innerHTML = `
    <div class="card" style="padding:13px 16px"><div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700">₹${fmtL(total)}</div><div style="font-size:10.5px;color:var(--inkf);text-transform:uppercase;letter-spacing:1px;margin-top:2px">Total Collected</div></div>
    <div class="card" style="padding:13px 16px;border-left:3px solid var(--sky)"><div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700">₹${fmtL(rpm)}</div><div style="font-size:10.5px;color:var(--inkf);text-transform:uppercase;letter-spacing:1px;margin-top:2px">RPM</div></div>
    <div class="card" style="padding:13px 16px;border-left:3px solid var(--gold)"><div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700">₹${fmtL(sm)}</div><div style="font-size:10.5px;color:var(--inkf);text-transform:uppercase;letter-spacing:1px;margin-top:2px">SM (Infra)</div></div>`;
  const cf = S.customFields.filter(f=>f.applies_to==='cheque');
  const canEdit = true; // all roles can edit cheques
  const canDel = S.profile?.role==='admin'||S.profile?.role==='superadmin';
  el('chqHead').innerHTML = `<tr><th>Customer</th><th>Plot</th><th>Bank Detail</th><th>Cheque/Ref</th><th>Date</th><th>Amount</th><th>Type</th>${cf.map(f=>`<th>${esc(f.field_label)}</th>`).join('')}<th></th></tr>`;
  const tbody = el('chqBody');
  if (!d.length) { tbody.innerHTML=`<tr><td colspan="${8+cf.length}"><div class="empty"><div class="ei">🧾</div><h3>No entries</h3></div></td></tr>`; return; }
  tbody.innerHTML = d.map(c=>`<tr>
    <td class="td-name">${esc(c.cust_name)}</td><td>${esc(c.plot_no||'—')}</td>
    <td class="td-dim" style="font-size:12px">${esc(c.bank_detail||'—')}</td>
    <td class="td-mono">${esc(c.cheque_no||'—')}</td><td class="td-dim">${c.cheque_date||'—'}</td>
    <td style="font-weight:700">₹${numFmt(c.amount)}</td>
    <td><span class="badge ${chqBadge(c.entry_type)}">${c.entry_type}</span></td>
    ${cf.map(f=>`<td class="td-dim">${esc(String((c.custom_data||{})[f.field_name]||'—'))}</td>`).join('')}
    <td><div style="display:flex;gap:4px">
      ${canEdit?`<button class="btn btn-ghost btn-sm btn-icon" onclick="editChq('${c.id}')">✏️</button>`:''}
      ${canDel ?`<button class="btn btn-ghost btn-sm btn-icon" style="color:var(--rose)" onclick="delChq('${c.id}')">🗑</button>`:''}
    </div></td></tr>`).join('');
}

// ── PREV TEAM ────────────────────────────────────────────────
function renderPrev() {
  const tbody = el('prevBody');
  if (!S.prev.length) { tbody.innerHTML=`<tr><td colspan="7"><div class="empty"><div class="ei">📁</div><h3>No records</h3></div></td></tr>`; return; }
  const canEdit = true; // all roles can manage prev bookings
  tbody.innerHTML = S.prev.map((x,i)=>`<tr>
    <td class="td-dim">${i+1}</td><td class="td-name">${esc(x.client_name)}</td>
    <td>${esc(x.plot_no||'—')}</td><td class="td-dim">${numFmt(x.plot_size)}</td>
    <td style="font-weight:700">₹${numFmt(x.agreement_value)}</td>
    <td class="td-dim">${esc(x.notes||'—')}</td>
    <td>${canEdit?`<button class="btn btn-ghost btn-sm btn-icon" style="color:var(--rose)" onclick="delPrev('${x.id}')">🗑</button>`:''}</td>
  </tr>`).join('');
}

// ── ANALYTICS ────────────────────────────────────────────────
// Chart type preferences per chart
const CHART_TYPES = { 'c-status':'doughnut','c-bank':'bar','c-monthly':'line','c-value':'bar','c-disb':'doughnut','c-pay':'bar' };

function setChartType(id, type) {
  CHART_TYPES[id] = type;
  renderAnalytics(); // re-render all charts
}

function renderAnalytics() {
  const bk=S.bookings, chq=S.cheques;
  Object.values(S.charts).forEach(c=>{ try{c.destroy()}catch(e){} }); S.charts={};
  const totalVal=sum(bk,'agreement_value'), disb=bk.filter(b=>b.disbursement_status==='done').length;
  const sanc=bk.filter(b=>b.sanction_received==='Yes').length;
  const chqTotal=sum(chq,'amount');
  el('analStats').innerHTML = `
    ${sc('sc-gold','🏡',bk.length,'Bookings','')}
    ${sc('sc-teal','💰','₹'+fmtCr(totalVal),'Total Value','')}
    ${sc('sc-sky','✅',disb,'Disbursed','')}
    ${sc('sc-sage','🏦',sanc,'Sanctions','')}`;

  const typeBtn = (cid, type, label) =>
    `<button onclick="setChartType('${cid}','${type}')" style="padding:3px 8px;font-size:11px;border-radius:5px;border:1px solid var(--border);background:${CHART_TYPES[cid]===type?'var(--ink)':'#fff'};color:${CHART_TYPES[cid]===type?'#fff':'var(--inkl)'};cursor:pointer;font-family:'Outfit',sans-serif">${label}</button>`;
  const typeSwitcher = (cid, types) =>
    `<div style="display:flex;gap:4px">${types.map(([t,l])=>typeBtn(cid,t,l)).join('')}</div>`;

  // Rebuild chart card headers with type switchers
  const chartCards = [
    {id:'c-status', title:'Loan Status Distribution',    types:[['doughnut','🍩'],['bar','📊'],['pie','🥧']]},
    {id:'c-bank',   title:'Bank-wise Bookings',           types:[['bar','📊'],['doughnut','🍩'],['pie','🥧'],['line','📈']]},
    {id:'c-monthly',title:'Monthly Booking Trend',        types:[['line','📈'],['bar','📊']]},
    {id:'c-value',  title:'Agreement Value by Bank (₹L)', types:[['bar','📊'],['line','📈'],['doughnut','🍩']]},
    {id:'c-disb',   title:'Disbursement Status',          types:[['doughnut','🍩'],['pie','🥧'],['bar','📊']]},
    {id:'c-pay',    title:'Collections by Type (₹L)',     types:[['bar','📊'],['doughnut','🍩'],['pie','🥧']]},
  ];

  chartCards.forEach(cc => {
    const hd = el(cc.id+'_hd');
    if (hd) {
      hd.innerHTML = `<span class="card-hd-title">${cc.title}</span>
        <div style="display:flex;align-items:center;gap:8px">
          ${typeSwitcher(cc.id, cc.types)}
          <button class="dl-btn" onclick="dlChart('${cc.id}')">⬇ PNG</button>
        </div>`;
    }
  });

  // Build chart data
  const sg=groupCount(bk,'loan_status');
  S.charts.c1=mkChart('c-status',CHART_TYPES['c-status'],Object.keys(sg),Object.values(sg),['#c47d1a','#196060','#1a4870','#3a6040','#a83030','#8fa5b5'],'Count');

  const bg=groupCount(bk,'bank_name');
  S.charts.c2=mkChart('c-bank',CHART_TYPES['c-bank'],Object.keys(bg),Object.values(bg),'#c47d1a','Bookings');

  const mg={}; bk.forEach(b=>{if(b.booking_date){const m=b.booking_date.slice(0,7);mg[m]=(mg[m]||0)+1;}});
  const months=Object.keys(mg).sort();
  S.charts.c3=mkChart('c-monthly',CHART_TYPES['c-monthly'],months,months.map(m=>mg[m]),'#196060','Bookings');

  const bvg={}; bk.forEach(b=>{const k=b.bank_name||'Unknown';bvg[k]=(bvg[k]||0)+(+b.agreement_value||0);});
  S.charts.c4=mkChart('c-value',CHART_TYPES['c-value'],Object.keys(bvg),Object.values(bvg).map(v=>Math.round(v/100000)),'#1a4870','₹L');

  const dg={Done:0,Pending:0,Cancelled:0}; bk.forEach(b=>{if(b.loan_status==='Cancelled')dg.Cancelled++;else if(b.disbursement_status==='done')dg.Done++;else dg.Pending++;});
  S.charts.c5=mkChart('c-disb',CHART_TYPES['c-disb'],Object.keys(dg),Object.values(dg),['#3a6040','#c47d1a','#a83030'],'Count');

  const pg=groupSum(chq,'entry_type','amount');
  S.charts.c6=mkChart('c-pay',CHART_TYPES['c-pay'],Object.keys(pg),Object.values(pg).map(v=>Math.round(v/100000)),'#4a2a70','₹L');
}
function mkChart(id,type,labels,data,colors,label) {
  const canvas=el(id); if(!canvas) return null;
  const isMulti=Array.isArray(colors);
  const isPie = type==='pie'||type==='doughnut';
  const isLine = type==='line';
  const chartType = type==='pie'?'doughnut':type; // Chart.js uses doughnut for both
  const cfg = {
    type: chartType,
    data:{labels, datasets:[{
      label:label||'',data,
      backgroundColor:isMulti?colors:(isLine?'transparent':colors+'33'),
      borderColor:isMulti?colors:colors,
      borderWidth:isLine?2.5:1.5,
      pointBackgroundColor:colors,
      pointRadius:isLine?4:0,
      tension:.4, fill:isLine,
      cutout: type==='pie'?'0%':undefined,
    }]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:isPie,position:'bottom',labels:{font:{family:'Outfit',size:11},padding:14}},
        tooltip:{bodyFont:{family:'Outfit'},titleFont:{family:'Outfit'}},
      },
      scales: isPie ? {} : {
        x:{grid:{color:'rgba(0,0,0,.04)'},ticks:{font:{family:'Outfit',size:11}}},
        y:{grid:{color:'rgba(0,0,0,.04)'},ticks:{font:{family:'Outfit',size:11}}},
      }
    }
  };
  return new Chart(canvas.getContext('2d'), cfg);
}
function dlChart(id) {
  const c=el(id); if(!c) return;
  const a=document.createElement('a'); a.href=c.toDataURL('image/png'); a.download=id+'.png'; a.click();
}

// ── SETTINGS ─────────────────────────────────────────────────
async function renderSettings() {
  const p=S.curProj; if(!p) return;
  setF('set-name',p.name||''); setF('set-loc',p.location||''); setF('set-dev',p.developer||'');
  setF('set-rera',p.rera||''); setF('set-plots',p.total_plots||'');
  setF('set-infra',p.infra_rate||100); setF('set-legal',p.legal_charges||25000); setF('set-sdr',p.sdr_rate||6);
  renderCFList();
  const ul=el('projUsers'); ul.innerHTML=`<div class="lc"><div class="spin spin-dk"></div></div>`;
  const { data } = await sb.from('project_members').select('role,profiles(id,full_name)').eq('project_id',p.id);
  ul.innerHTML='';
  (data||[]).forEach(m=>{
    const row=document.createElement('div'); row.className='u-row';
    row.innerHTML=`<div class="avatar">${(m.profiles?.full_name||'?').charAt(0).toUpperCase()}</div>
      <div style="flex:1"><div class="ui-n">${esc(m.profiles?.full_name||'')}</div><div class="ui-e">${m.role}</div></div>
      <div style="display:flex;gap:6px;align-items:center">
        <span class="role-pill rp-${m.role}">${m.role}</span>
        <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditUser('${m.profiles?.id}')" title="Edit">✏️</button>
        <button class="btn btn-ghost btn-sm btn-icon" style="color:var(--rose)" onclick="removeProjUser('${m.profiles?.id}','${p.id}')" title="Remove from project">✕</button>
      </div>`;
    ul.appendChild(row);
  });
  if (!data?.length) ul.innerHTML=`<div style="padding:20px;text-align:center;color:var(--inkf);font-size:13px">No users assigned</div>`;
}

async function saveSettings() {
  const p=S.curProj; if(!p) return;
  const {error}=await sb.from('projects').update({
    name:v('set-name'),location:v('set-loc'),developer:v('set-dev'),rera:v('set-rera'),
    total_plots:int_('set-plots'),infra_rate:num('set-infra'),legal_charges:num('set-legal'),sdr_rate:num('set-sdr'),
  }).eq('id',p.id);
  if(error){toast(error.message,'err');return;}
  S.curProj.name=v('set-name'); updateProjHeader();
  toast('Settings saved!');
}

function renderCFList() {
  const list=el('cfList');
  if(!S.customFields.length){list.innerHTML='<div style="font-size:13px;color:var(--inkf);padding:8px 0">No custom fields yet.</div>';return;}
  list.innerHTML=S.customFields.map(f=>`<div class="cf-item">
    <div style="flex:1"><div class="ci-lbl">${esc(f.field_label)}</div><div class="ci-meta">${f.field_type} · ${f.applies_to}${f.is_required?' · required':''}</div></div>
    <span class="badge b-gray" style="font-size:10px">${f.field_type}</span>
    <button class="btn btn-ghost btn-sm btn-icon" style="color:var(--rose)" onclick="deleteCF('${f.id}')">🗑</button>
  </div>`).join('');
}

function openCFModal(){
  clearF(['cf-label','cf-opts']); el('cf-type').value='text'; el('cf-applies').value='booking';
  el('cf-req').checked=false; el('cf-opts-g').style.display='none'; openM('cfModal');
}

async function saveCF(){
  const label=v('cf-label').trim(); if(!label){toast('Label required','err');return;}
  const fname=label.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  const opts=v('cf-opts').split(',').map(s=>s.trim()).filter(Boolean);
  const {error}=await sb.from('custom_fields').insert({
    project_id:S.curProj.id,field_name:fname,field_label:label,
    field_type:v('cf-type'),applies_to:v('cf-applies'),
    field_options:opts.length?opts:null,is_required:el('cf-req').checked,sort_order:S.customFields.length,
  });
  if(error){toast(error.message,'err');return;}
  await loadProjData(); renderCFList(); closeM('cfModal'); toast('Custom field added!');
}

async function deleteCF(id){
  if(!confirm('Delete this custom field?')) return;
  await sb.from('custom_fields').delete().eq('id',id);
  await loadProjData(); renderCFList(); toast('Field removed');
}

// ── BOOKING MODAL ────────────────────────────────────────────
function openBkModal(bk) {
  // bk can be a full booking object OR {plot_no:'45'} from plot map
  const isPartial = bk && !bk.id;
  S.editBkId = bk?.id || null;
  el('bkMTitle').textContent = bk?.id ? 'Edit Booking' : 'New Booking';
  el('bkMSub').textContent   = bk?.id ? (bk.client_name||'') : (bk?.plot_no ? `Plot ${bk.plot_no} — Add booking` : 'Add a plot booking');
  const p=S.curProj;
  const fields = {
    'f-serial':'serial_no','f-date':'booking_date','f-name':'client_name','f-contact':'contact',
    'f-plot':'plot_no','f-size':'plot_size','f-rate':'basic_rate','f-infra':'infra',
    'f-agr':'agreement_value','f-sdr':'sdr','f-sdrminus':'sdr_minus',
    'f-maint':'maintenance','f-legal':'legal_charges',
    'f-bank':'bank_name','f-bankercont':'banker_contact','f-status':'loan_status',
    'f-sancrecv':'sanction_received','f-sancdate':'sanction_date','f-sancletter':'sanction_letter',
    'f-sdrrecv':'sdr_received','f-sdrdate':'sdr_received_date',
    'f-disbstatus':'disbursement_status','f-disbdate':'disbursement_date',
    'f-doc':'doc_submitted','f-disbremark':'disbursement_remark','f-remark':'remark',
  };
  const defaults = {'f-infra':p?.infra_rate||100,'f-legal':p?.legal_charges||25000,'f-maint':p?.maintenance||0,'f-status':'File Given'};
  Object.entries(fields).forEach(([fid,col]) => {
    const e=el(fid); if(!e) return;
    // For full booking: use booking value. For partial {plot_no}: use that. For new: use defaults.
    e.value = bk ? (bk[col]??defaults[fid]??'') : (defaults[fid]??'');
  });
  setF('f-basic',''); setF('f-bi','');
  if(bk) calcBk();
  // Custom fields
  const cf=S.customFields.filter(f=>f.applies_to==='booking');
  const cfw=el('bk-cf'); cfw.innerHTML='';
  if(cf.length){
    const sec=document.createElement('div'); sec.className='fsec full'; sec.textContent='Custom Fields'; cfw.appendChild(sec);
    cf.forEach(f=>{
      const d=document.createElement('div'); d.className='fg';
      const val=bk?(bk.custom_data||{})[f.field_name]||'':'';
      d.innerHTML=`<label>${esc(f.field_label)}${f.is_required?' *':''}</label>${cfInput(f,val,'bkcf_'+f.field_name)}`;
      cfw.appendChild(d);
    });
  }
  openM('bkModal');
}
function editBk(id){ const b=S.bookings.find(x=>x.id===id); if(b) openBkModal(b); }

function calcBk(){
  const sz=parseFloat(v('f-size'))||0, rt=parseFloat(v('f-rate'))||0, inf=parseFloat(v('f-infra'))||0;
  const sdrRate=(S.curProj?.sdr_rate||6)/100;
  setF('f-basic', Math.round(sz*rt));
  setF('f-bi',    Math.round(sz*(rt+inf)));
  setF('f-agr',   Math.round(sz*(rt+inf)));
  setF('f-sdr',   Math.round(sz*(rt+inf)*sdrRate));
}

async function saveBk(){
  const name=v('f-name').trim(); if(!name){toast('Client name required','err');return;}
  const gv=id=>{const e=el(id);return e?e.value:'';};
  const gn=id=>{const n=parseFloat(gv(id));return isNaN(n)?null:n;};
  const data={
    project_id:S.curProj.id,
    serial_no:parseInt(gv('f-serial'))||null,
    booking_date:gv('f-date')||null,
    client_name:name, contact:gv('f-contact'),
    plot_no:gv('f-plot'), plot_size:gn('f-size'),
    basic_rate:gn('f-rate'), infra:gn('f-infra'),
    agreement_value:gn('f-agr'), sdr:gn('f-sdr'),
    sdr_minus:gn('f-sdrminus'), maintenance:gn('f-maint'),
    legal_charges:gn('f-legal'),
    bank_name:gv('f-bank'), banker_contact:gv('f-bankercont'),
    loan_status:gv('f-status')||'File Given',
    sanction_received:gv('f-sancrecv')||null,
    sanction_date:gv('f-sancdate')||null,
    sanction_letter:gv('f-sancletter')||null,
    sdr_received:gn('f-sdrrecv'),
    sdr_received_date:gv('f-sdrdate')||null,
    disbursement_status:gv('f-disbstatus')||null,
    disbursement_date:gv('f-disbdate')||null,
    doc_submitted:gv('f-doc'),
    disbursement_remark:gv('f-disbremark'),
    remark:gv('f-remark'),
  };
  const cf=S.customFields.filter(f=>f.applies_to==='booking');
  if(cf.length){
    const existing=S.editBkId?(S.bookings.find(b=>b.id===S.editBkId)?.custom_data||{}):{};
    const cd={...existing};
    cf.forEach(f=>{const e=el('bkcf_'+f.field_name);if(e) cd[f.field_name]=e.value;});
    data.custom_data=cd;
  }
  setBtn('bk-save',true);
  let error;
  if(S.editBkId){({error}=await sb.from('bookings').update(data).eq('id',S.editBkId));}
  else {({error}=await sb.from('bookings').insert(data));}
  setBtn('bk-save',false);
  if(error){toast(error.message,'err');return;}
  const isEdit = !!S.editBkId;
  const savedId = isEdit ? S.editBkId : null;
  closeM('bkModal'); await loadProjData(); renderBookings();
  toast(isEdit?'Booking updated!':'Booking added!');
  // Audit log
  const saved = S.bookings.find(b => isEdit ? b.id===savedId : b.client_name===name);
  await logAudit(isEdit?'UPDATE':'CREATE', 'booking', saved?.id||null, name,
    isEdit ? `Updated booking for ${name} (Plot ${data.plot_no})` : `Created booking for ${name} (Plot ${data.plot_no}, ₹${(data.agreement_value||0).toLocaleString('en-IN')})`);
}

async function delBk(id){
  if(!confirm('Delete this booking permanently?')) return;
  const {error}=await sb.from('bookings').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  const bk = S.bookings.find(b=>b.id===id);
  await loadProjData(); renderBookings(); toast('Deleted');
  await logAudit('DELETE','booking',id,bk?.client_name||'',`Deleted booking for ${bk?.client_name||id} (Plot ${bk?.plot_no||''})`);
}

function viewBk(id){
  const b=S.bookings.find(x=>x.id===id); if(!b) return;
  el('detailTitle').textContent=b.client_name;
  el('detailSub').textContent=`Plot ${b.plot_no} · ${b.bank_name||''} · ${b.loan_status}`;
  const canEdit=true; // all roles can edit
  el('detailEdit').style.display='';
  el('detailEdit').onclick=()=>{closeM('detailModal');editBk(id);};
  const fmt=n=>n?'₹'+numFmt(n):'—';
  const secs=[
    {t:'Client',rows:[['Booking Date',b.booking_date||'—'],['Plot No.',b.plot_no||'—'],['Area',numFmt(b.plot_size)+' sqft'],['Contact',b.contact||'—']]},
    {t:'Financials',rows:[['Basic Rate','₹'+(b.basic_rate||0)+'/sqft'],['Infra','₹'+(b.infra||0)+'/sqft'],['Agreement Value',fmt(b.agreement_value)],['SDR',fmt(b.sdr)],['SDR-',fmt(b.sdr_minus)],['Maintenance',fmt(b.maintenance)],['Legal',fmt(b.legal_charges)]]},
    {t:'Loan & Bank',rows:[['Bank',b.bank_name||'—'],['Banker Contact',b.banker_contact||'—'],['Loan Status',b.loan_status],['Sanction Recv.',b.sanction_received||'—'],['Sanction Date',b.sanction_date||'—'],['Sanction Letter',b.sanction_letter||'—'],['SDR Received',fmt(b.sdr_received)],['SDR Recv. Date',b.sdr_received_date||'—'],['Disbursement',b.disbursement_status==='done'?'✓ Done':'Pending'],['Disb. Date',b.disbursement_date||'—'],['Doc for Draft',b.doc_submitted||'—']]},
  ];
  const cf=S.customFields.filter(f=>f.applies_to==='booking');
  if(cf.length) secs.push({t:'Custom Fields',rows:cf.map(f=>[f.field_label,(b.custom_data||{})[f.field_name]||'—'])});
  let html=secs.map(s=>`<div class="d-section"><div class="d-sec-title">${s.t}</div><div class="d-grid">${s.rows.map(([l,val])=>`<div class="d-item"><div class="dl">${l}</div><div class="dv">${esc(String(val))}</div></div>`).join('')}</div></div>`).join('');
  if(b.disbursement_remark) html+=`<div class="rmk-box rmk-sky" style="margin-bottom:9px"><strong>Disbursement Remark:</strong><br>${esc(b.disbursement_remark)}</div>`;
  if(b.remark) html+=`<div class="rmk-box rmk-gold"><strong>Remark:</strong><br>${esc(b.remark)}</div>`;
  el('detailBody').innerHTML=html;
  openM('detailModal');
}

// ── CHEQUE MODAL ─────────────────────────────────────────────
function openChqModal(c){
  S.editChqId=c?.id||null;
  el('chqMTitle').textContent=c?'Edit Entry':'Add Payment Entry';
  const map={'c-name':'cust_name','c-plot':'plot_no','c-bank':'bank_detail','c-no':'cheque_no','c-date':'cheque_date','c-amount':'amount','c-type':'entry_type'};
  Object.entries(map).forEach(([fid,col])=>{const e=el(fid);if(e) e.value=c?(c[col]??''):'';});
  const cf=S.customFields.filter(f=>f.applies_to==='cheque');
  const cfw=el('chq-cf'); cfw.innerHTML='';
  if(cf.length){
    const sec=document.createElement('div'); sec.className='fsec full'; sec.textContent='Custom Fields'; cfw.appendChild(sec);
    cf.forEach(f=>{const d=document.createElement('div');d.className='fg';const val=c?(c.custom_data||{})[f.field_name]||'':'';d.innerHTML=`<label>${esc(f.field_label)}</label>${cfInput(f,val,'chqcf_'+f.field_name)}`;cfw.appendChild(d);});
  }
  openM('chqModal');
}
function editChq(id){const c=S.cheques.find(x=>x.id===id);if(c) openChqModal(c);}

async function saveChq(){
  const name=v('c-name').trim(); if(!name){toast('Name required','err');return;}
  const data={project_id:S.curProj.id,cust_name:name,plot_no:v('c-plot'),bank_detail:v('c-bank'),cheque_no:v('c-no'),cheque_date:v('c-date')||null,amount:parseFloat(v('c-amount'))||0,entry_type:v('c-type')};
  const cf=S.customFields.filter(f=>f.applies_to==='cheque');
  if(cf.length){const existing=S.editChqId?(S.cheques.find(c=>c.id===S.editChqId)?.custom_data||{}):{};const cd={...existing};cf.forEach(f=>{const e=el('chqcf_'+f.field_name);if(e) cd[f.field_name]=e.value;});data.custom_data=cd;}
  setBtn('chq-save',true);
  let error;
  if(S.editChqId){({error}=await sb.from('cheques').update(data).eq('id',S.editChqId));}
  else{({error}=await sb.from('cheques').insert(data));}
  setBtn('chq-save',false);
  if(error){toast(error.message,'err');return;}
  const wasEdit = !!S.editChqId;
  closeM('chqModal'); await loadProjData(); renderCheques();
  toast(wasEdit?'Updated!':'Entry added!');
  await logAudit(wasEdit?'UPDATE':'CREATE','cheque',null,data.cust_name,
    wasEdit ? `Updated cheque entry for ${data.cust_name}` : `Added ₹${(data.amount||0).toLocaleString('en-IN')} ${data.entry_type} for ${data.cust_name}`);
}

async function delChq(id){
  if(!confirm('Delete this entry?')) return;
  await sb.from('cheques').delete().eq('id',id);
  const chq = S.cheques.find(c=>c.id===id);
  await loadProjData(); renderCheques(); toast('Deleted');
  await logAudit('DELETE','cheque',id,chq?.cust_name||'',`Deleted cheque entry for ${chq?.cust_name||id}`);
}

// ── PREV MODAL ───────────────────────────────────────────────
function openPrevModal(){clearF(['pv-name','pv-plot','pv-size','pv-val','pv-notes']);openM('prevModal');}

async function savePrev(){
  const name=v('pv-name').trim(); if(!name){toast('Name required','err');return;}
  const {error}=await sb.from('prev_bookings').insert({project_id:S.curProj.id,client_name:name,plot_no:v('pv-plot'),plot_size:parseFloat(v('pv-size'))||null,agreement_value:parseFloat(v('pv-val'))||null,notes:v('pv-notes')});
  if(error){toast(error.message,'err');return;}
  await writeLog('create','prev_booking', null, name);
  closeM('prevModal'); await loadProjData(); renderPrev(); toast('Entry added!');
}

async function delPrev(id){
  if(!confirm('Delete this entry?')) return;
  await sb.from('prev_bookings').delete().eq('id',id);
  await loadProjData(); renderPrev(); toast('Deleted');
}

// ── EXCEL EXPORT ─────────────────────────────────────────────
async function downloadProjectExcel(){
  if(!S.curProj){toast('No project selected','err');return;}
  toast('Preparing Excel…','inf');
  await loadProjData();
  const wb=XLSX.utils.book_new();
  const cf_bk=S.customFields.filter(f=>f.applies_to==='booking');
  const cf_chq=S.customFields.filter(f=>f.applies_to==='cheque');
  const bkH=['#','Date','Client Name','Contact','Plot No','Area (sqft)','Basic Rate','Infra','Agreement Value','SDR','SDR-','Maintenance','Legal','Bank','Banker Contact','Loan Status','Sanction Received','Sanction Date','Sanction Letter','SDR Received','SDR Recv Date','Disbursement','Disb Date','Doc for Draft','Disb Remark','Remark',...cf_bk.map(f=>f.field_label)];
  const bkR=S.bookings.map((b,i)=>[b.serial_no||i+1,b.booking_date||'',b.client_name,b.contact||'',b.plot_no||'',b.plot_size||'',b.basic_rate||'',b.infra||'',b.agreement_value||'',b.sdr||'',b.sdr_minus||'',b.maintenance||'',b.legal_charges||'',b.bank_name||'',b.banker_contact||'',b.loan_status,b.sanction_received||'',b.sanction_date||'',b.sanction_letter||'',b.sdr_received||'',b.sdr_received_date||'',b.disbursement_status||'',b.disbursement_date||'',b.doc_submitted||'',b.disbursement_remark||'',b.remark||'',...cf_bk.map(f=>(b.custom_data||{})[f.field_name]||'')]);
  const bkS=XLSX.utils.aoa_to_sheet([bkH,...bkR]); bkS['!cols']=bkH.map(()=>({wch:18}));
  XLSX.utils.book_append_sheet(wb,bkS,'Bookings');
  const chqH=['Customer','Plot','Bank Detail','Cheque/Ref No','Date','Amount','Type',...cf_chq.map(f=>f.field_label)];
  const chqR=S.cheques.map(c=>[c.cust_name,c.plot_no||'',c.bank_detail||'',c.cheque_no||'',c.cheque_date||'',c.amount,c.entry_type,...cf_chq.map(f=>(c.custom_data||{})[f.field_name]||'')]);
  const chqS=XLSX.utils.aoa_to_sheet([chqH,...chqR]); chqS['!cols']=chqH.map(()=>({wch:18}));
  XLSX.utils.book_append_sheet(wb,chqS,'Cheques');
  if(S.prev.length){
    const ps=XLSX.utils.aoa_to_sheet([['Customer','Plot No','Plot Size','Agreement Value','Notes'],...S.prev.map(x=>[x.client_name,x.plot_no||'',x.plot_size||'',x.agreement_value||'',x.notes||''])]);
    XLSX.utils.book_append_sheet(wb,ps,'Previous Team');
  }
  const bk=S.bookings;
  const sumD=[['RealtyFlow CRM — Project Summary'],[''],['Project',S.curProj.name],['Location',S.curProj.location||''],['Developer',S.curProj.developer||''],['RERA',S.curProj.rera||''],[''],['BOOKINGS',''],['Total Bookings',bk.length],['Total Agreement Value','₹'+sum(bk,'agreement_value').toLocaleString('en-IN')],['Disbursements Done',bk.filter(b=>b.disbursement_status==='done').length],['Sanctions Received',bk.filter(b=>b.sanction_received==='Yes').length],['Cancelled',bk.filter(b=>b.loan_status==='Cancelled').length],[''],['COLLECTIONS',''],['Total Collected (Cheques)','₹'+sum(S.cheques,'amount').toLocaleString('en-IN')],[''],['Generated on',new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})]];
  const ss=XLSX.utils.aoa_to_sheet(sumD); ss['!cols']=[{wch:30},{wch:40}];
  XLSX.utils.book_append_sheet(wb,ss,'Summary');
  XLSX.writeFile(wb,`${S.curProj.name.replace(/[^a-z0-9]/gi,'_')}_${today()}.xlsx`);
  toast('Excel downloaded!');
}

// ── CSV EXPORT ───────────────────────────────────────────────
function dlCSV(type){
  let rows, filename; const proj=S.curProj?.name||'project';
  if(type==='bookings'){
    const cf=S.customFields.filter(f=>f.applies_to==='booking');
    rows=[['#','Date','Client','Contact','Plot No','Area','Rate','Agr Value','SDR','Bank','Sanction','Disbursement','Status','Disb Date','Remark',...cf.map(f=>f.field_label)],...S.bookings.map((b,i)=>[b.serial_no||i+1,b.booking_date||'',b.client_name,b.contact||'',b.plot_no||'',b.plot_size||'',b.basic_rate||'',b.agreement_value||'',b.sdr||'',b.bank_name||'',b.sanction_received||'',b.disbursement_status||'',b.loan_status,b.disbursement_date||'',b.remark||'',...cf.map(f=>(b.custom_data||{})[f.field_name]||'')])];
    filename=`${proj}_bookings_${today()}.csv`;
  } else if(type==='cheques'){
    const cf=S.customFields.filter(f=>f.applies_to==='cheque');
    rows=[['Customer','Plot','Bank','Cheque No','Date','Amount','Type',...cf.map(f=>f.field_label)],...S.cheques.map(c=>[c.cust_name,c.plot_no||'',c.bank_detail||'',c.cheque_no||'',c.cheque_date||'',c.amount,c.entry_type,...cf.map(f=>(c.custom_data||{})[f.field_name]||'')])];
    filename=`${proj}_cheques_${today()}.csv`;
  } else {
    rows=[['#','Customer','Plot','Size','Agr Value','Notes'],...S.prev.map((x,i)=>[i+1,x.client_name,x.plot_no||'',x.plot_size||'',x.agreement_value||'',x.notes||''])];
    filename=`${proj}_prev_${today()}.csv`;
  }
  const csv=rows.map(r=>r.map(c=>'"'+String(c||'').replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download=filename; a.click();
  toast('CSV downloaded!');
}

// ── AUDIT LOG ────────────────────────────────────────────────
async function logAudit(action, entity, entityId, entityLabel, detail, changes=null) {
  if (!S.profile || !S.curProj) return;
  try {
    await sb.from('audit_log').insert({
      project_id:   S.curProj.id,
      user_id:      S.profile.id,
      user_name:    S.profile.full_name,
      user_role:    S.profile.role,
      action:       action.toLowerCase(),
      entity,
      entity_id:    entityId || null,
      entity_label: entityLabel || detail || '',
      changes:      changes || {},
    });
  } catch(e) { console.warn('Audit log failed:', e.message); }
}

// ── AUDIT LOG ────────────────────────────────────────────────
// Raw audit data cache for filtering
let _auditData = [];
let _saAuditData = [];

async function renderProjectAudit() {
  const tbody = el('audit-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6"><div class="lc"><div class="spin spin-dk"></div></div></td></tr>';
  if (!S.curProj) { tbody.innerHTML = '<tr><td colspan="6"><div class="empty"><p>No project selected</p></div></td></tr>'; return; }

  const { data, error } = await sb
    .from('audit_log')
    .select('*')
    .eq('project_id', S.curProj.id)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--rose);padding:16px">Error: ${esc(error.message)}</td></tr>`;
    return;
  }
  _auditData = data || [];
  renderAuditTable(_auditData, 'audit-body', 'audit-cnt', false);
}

function filterAudit() {
  const search = (el('audit-search')?.value || '').toLowerCase();
  const role   = el('audit-role')?.value   || '';
  const action = el('audit-action')?.value || '';
  const entity = el('audit-entity')?.value || '';
  let d = _auditData;
  if (search) d = d.filter(l => (l.user_name||'').toLowerCase().includes(search) || (l.entity_label||'').toLowerCase().includes(search));
  if (role)   d = d.filter(l => l.user_role === role);
  if (action) d = d.filter(l => l.action === action);
  if (entity) d = d.filter(l => l.entity === entity);
  renderAuditTable(d, 'audit-body', 'audit-cnt', false);
}

function clearAuditFilters() {
  ['audit-search','audit-role','audit-action','audit-entity'].forEach(id => { const e=el(id); if(e) e.value=''; });
  renderAuditTable(_auditData, 'audit-body', 'audit-cnt', false);
}

async function renderSAAudit() {
  const tbody = el('sa-audit-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7"><div class="lc"><div class="spin spin-dk"></div></div></td></tr>';

  const [{ data: projs }, { data, error }] = await Promise.all([
    sb.from('projects').select('id,name'),
    sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(1000),
  ]);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--rose);padding:16px">Error: ${esc(error.message)}</td></tr>`;
    return;
  }

  const projMap = {};
  (projs||[]).forEach(p => projMap[p.id] = p.name);
  _saAuditData = (data||[]).map(l => ({ ...l, _projName: projMap[l.project_id] || '—' }));
  renderAuditTable(_saAuditData, 'sa-audit-body', 'sa-audit-cnt', true);
}

function filterSAAudit() {
  const search = (el('sa-audit-search')?.value || '').toLowerCase();
  const role   = el('sa-audit-role')?.value   || '';
  const action = el('sa-audit-action')?.value || '';
  let d = _saAuditData;
  if (search) d = d.filter(l => (l.user_name||'').toLowerCase().includes(search) || (l.entity_label||'').toLowerCase().includes(search) || (l._projName||'').toLowerCase().includes(search));
  if (role)   d = d.filter(l => l.user_role === role);
  if (action) d = d.filter(l => l.action === action);
  renderAuditTable(d, 'sa-audit-body', 'sa-audit-cnt', true);
}

function clearSAAuditFilters() {
  ['sa-audit-search','sa-audit-role','sa-audit-action'].forEach(id => { const e=el(id); if(e) e.value=''; });
  renderAuditTable(_saAuditData, 'sa-audit-body', 'sa-audit-cnt', true);
}

function renderAuditTable(logs, tbodyId, cntId, showProject) {
  const tbody = el(tbodyId);
  const cols  = showProject ? 7 : 6;
  if (!tbody) return;
  if (el(cntId)) el(cntId).textContent = logs.length + ' records';
  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="${cols}"><div class="empty"><div class="ei">📋</div><h3>No activity yet</h3><p>Actions appear here as users work</p></div></td></tr>`;
    return;
  }
  const aColor = { create:'var(--sage)', update:'var(--sky)', cancel:'var(--gold)', delete:'var(--rose)', import:'var(--teal)', CREATE:'var(--sage)', UPDATE:'var(--sky)', DELETE:'var(--rose)', IMPORT:'var(--teal)' };
  const aBg    = { create:'#dcfce7',update:'#dbeafe',cancel:'#fef3c7',delete:'#fee2e2',import:'#ccfbf1',CREATE:'#dcfce7',UPDATE:'#dbeafe',DELETE:'#fee2e2',IMPORT:'#ccfbf1' };

  tbody.innerHTML = logs.map(log => {
    const dt      = new Date(log.created_at);
    const dateStr = dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
    const timeStr = dt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    const color   = aColor[log.action]  || 'var(--inkf)';
    const bg      = aBg[log.action]     || '#f3f4f6';
    const projCol = showProject ? `<td class="td-dim" style="font-size:11px">${esc(log._projName||'—')}</td>` : '';
    return `<tr>
      <td style="white-space:nowrap;font-size:11px">
        <div style="font-weight:600">${dateStr}</div>
        <div style="color:var(--inkf)">${timeStr}</div>
      </td>
      ${projCol}
      <td class="td-name" style="font-size:12px">${esc(log.user_name||'—')}</td>
      <td><span class="role-pill rp-${log.user_role}" style="font-size:10px">${log.user_role||'—'}</span></td>
      <td><span style="padding:2px 9px;border-radius:12px;font-size:11px;font-weight:700;background:${bg};color:${color}">${(log.action||'').toUpperCase()}</span></td>
      <td class="td-dim" style="font-size:12px">${log.entity||'—'}</td>
      <td style="font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(log.entity_label||'—')}</td>
    </tr>`;
  }).join('');
}

// Keep for SA audit HTML (legacy - not used but don't break)
function buildAuditHTML(logs) {
  return renderAuditTable ? '' : '';
}

function dlAuditCSV(mode) {
  const data = mode === 'sa' ? _saAuditData : _auditData;
  if (!data.length) { toast('No audit data to export','err'); return; }
  const header = mode === 'sa'
    ? ['Time','Project','User','Role','Action','Type','Record']
    : ['Time','User','Role','Action','Type','Record'];
  const rows = data.map(l => {
    const dt = new Date(l.created_at).toLocaleString('en-IN');
    const base = [dt, l.user_name||'', l.user_role||'', l.action||'', l.entity||'', l.entity_label||''];
    return mode === 'sa' ? [dt, l._projName||'', l.user_name||'', l.user_role||'', l.action||'', l.entity||'', l.entity_label||''] : base;
  });
  const csv = [header,...rows].map(r=>r.map(c=>'"'+String(c||'').replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download=`audit_log_${today()}.csv`; a.click();
  toast('Audit CSV downloaded!');
}

// ── PLOT MAP ─────────────────────────────────────────────────
const PM = { filter: { num: '', status: '' } };

const PLOT_STATUS = {
  available: { label:'Available',           color:'#22c55e', bg:'#dcfce7', border:'#16a34a', text:'#15803d' },
  booked:    { label:'Booked / Processing', color:'#f59e0b', bg:'#fef3c7', border:'#d97706', text:'#92400e' },
  sanction:  { label:'Sanction Received',   color:'#3b82f6', bg:'#dbeafe', border:'#1d4ed8', text:'#1e40af' },
  completed: { label:'Agreement Completed', color:'#16a34a', bg:'#bbf7d0', border:'#15803d', text:'#14532d' },
  prev:      { label:'Previous Team',       color:'#a855f7', bg:'#f3e8ff', border:'#7e22ce', text:'#6b21a8' },
  phase2:    { label:'Phase 2',             color:'#6b7280', bg:'#f3f4f6', border:'#4b5563', text:'#374151' },
};

function getPlotStatus(plotNo) {
  const pn = parseInt(plotNo);
  if (S.prev.find(x => parseInt(x.plot_no) === pn)) return 'prev';
  const bk = S.bookings.find(b => parseInt(b.plot_no) === pn);
  if (!bk) return 'available';
  if (bk.loan_status === 'Agreement Completed') return 'completed';
  if (bk.loan_status === 'Sanction Received')   return 'sanction';
  if (bk.bank_name === 'Phase 2')               return 'phase2';
  return 'booked';
}

function renderPlotMap() {
  if (!S.curProj) return;
  const totalPlots = S.curProj.total_plots || 92;
  el('plotMapTitle').textContent = S.curProj.name + ' — Plot Map';
  el('plotMapSub').textContent   = totalPlots + ' plots total · click any plot to view details';

  const counts = { available:0, booked:0, sanction:0, completed:0, prev:0, phase2:0 };
  for (let i = 1; i <= totalPlots; i++) counts[getPlotStatus(i)]++;

  el('plotSummaryBar').innerHTML = Object.entries(counts).map(([st, cnt]) => {
    if (!cnt) return '';
    const cfg = PLOT_STATUS[st];
    return '<div style="display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;background:' + cfg.bg + ';border:1.5px solid ' + cfg.border + '">'
      + '<div style="width:10px;height:10px;border-radius:50%;background:' + cfg.color + '"></div>'
      + '<span style="font-size:12px;font-weight:600;color:' + cfg.text + '">' + cfg.label + ': ' + cnt + '</span>'
      + '</div>';
  }).join('');

  drawPlotGrid(totalPlots);
}

function drawPlotGrid(totalPlots) {
  const grid   = el('plotGrid');
  const filter = PM.filter;
  if (!grid) return;
  grid.innerHTML = '';
  const cols = Math.min(10, totalPlots);
  grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';

  for (let i = 1; i <= totalPlots; i++) {
    const st  = getPlotStatus(i);
    const cfg = PLOT_STATUS[st];
    let hide  = false;
    if (filter.num    && parseInt(filter.num)  !== i)  hide = true;
    if (filter.status && filter.status          !== st) hide = true;

    const bk = S.bookings.find(b => parseInt(b.plot_no) === i);
    const pv = S.prev.find(x => parseInt(x.plot_no) === i);

    const cell = document.createElement('div');
    cell.className = 'plot-cell';
    cell.title     = 'Plot ' + i + ' — ' + cfg.label + (bk ? ' · ' + (bk.client_name||'') : '');
    cell.style.cssText = [
      'border-radius:8px',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'cursor:pointer',
      'background:' + cfg.bg,
      'border:2px solid ' + cfg.border,
      'transition:transform .15s,box-shadow .15s',
      'position:relative',
      'min-height:48px',
      'padding:4px 2px',
      'opacity:' + (hide ? '0.12' : '1'),
      'pointer-events:' + (hide ? 'none' : 'auto'),
    ].join(';');

    const bankLabel = bk ? (bk.bank_name||'') : (pv ? 'Prev' : '');
    cell.innerHTML =
      '<div style="font-size:clamp(9px,1.1vw,13px);font-weight:700;color:' + cfg.text + ';line-height:1.1">' + i + '</div>' +
      (bankLabel ? '<div style="font-size:clamp(7px,0.75vw,9px);color:' + cfg.text + ';opacity:.65;margin-top:1px;text-align:center;max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(bankLabel) + '</div>' : '');

    cell.onmouseover  = function() { this.style.transform='scale(1.1)'; this.style.boxShadow='0 4px 16px '+cfg.color+'55'; this.style.zIndex='10'; };
    cell.onmouseleave = function() { this.style.transform=''; this.style.boxShadow=''; this.style.zIndex=''; };
    cell.onclick      = function() { openPlotDetail(i, st, bk, pv); };
    grid.appendChild(cell);
  }
}

function openPlotDetail(plotNo, status, bk, pv) {
  const cfg = PLOT_STATUS[status];
  el('pdTitle').textContent = 'Plot ' + plotNo;
  el('pdSub').innerHTML = '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 12px;border-radius:12px;background:' + cfg.bg + ';border:1px solid ' + cfg.border + ';color:' + cfg.text + ';font-size:12px;font-weight:600">'
    + '<span style="width:8px;height:8px;border-radius:50%;background:' + cfg.color + '"></span>'
    + cfg.label + '</span>';

  const fmt = function(n){ return n ? '\u20B9' + (+n).toLocaleString('en-IN') : '\u2014'; };

  if (status === 'available') {
    el('pdBody').innerHTML = '<div style="text-align:center;padding:28px 0">'
      + '<div style="font-size:44px;margin-bottom:12px">\u2705</div>'
      + '<div style="font-size:18px;font-weight:700;color:var(--sage);margin-bottom:6px">Available for Booking</div>'
      + '<div style="font-size:13px;color:var(--inkf)">This plot has not been booked yet</div>'
      + '</div>';
    el('pdFoot').innerHTML = `<button class="btn btn-outline" onclick="closeM('plotDetailModal')">Close</button><button class="btn btn-gold" onclick="closeM('plotDetailModal');openBkModal({plot_no:'${plotNo}'})">+ Book This Plot</button>`;
  } else {
    const data  = bk || pv;
    const isPrev = !bk && !!pv;
    const detailRows = [
      ['Client Name',   data ? (data.client_name||'\u2014') : '\u2014'],
      ['Plot Size',     data && data.plot_size ? data.plot_size + ' sqft' : '\u2014'],
      ['Agr. Value',    fmt(data && data.agreement_value)],
    ];
    if (!isPrev) {
      detailRows.push(
        ['Basic Rate',      data && data.basic_rate ? '\u20B9' + data.basic_rate + '/sqft' : '\u2014'],
        ['Infra',           data && data.infra ? '\u20B9' + data.infra + '/sqft' : '\u2014'],
        ['SDR',             fmt(data && data.sdr)],
        ['Bank',            (data && data.bank_name) || '\u2014'],
        ['Loan Status',     (data && data.loan_status) || '\u2014'],
        ['Sanction',        (data && data.sanction_received) || '\u2014'],
        ['Disbursement',    data && data.disbursement_status === 'done' ? '\u2713 Done' : 'Pending'],
        ['Contact',         (data && data.contact) || '\u2014'],
        ['Banker Contact',  (data && data.banker_contact) || '\u2014'],
      );
      if (data && data.remark) detailRows.push(['Remark', data.remark]);
    }
    el('pdBody').innerHTML = detailRows.map(function(r) {
      return '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--border)">'
        + '<div style="font-size:12px;color:var(--inkf);font-weight:500;flex-shrink:0;margin-right:12px">' + r[0] + '</div>'
        + '<div style="font-size:13px;font-weight:600;text-align:right;max-width:60%">' + esc(String(r[1]||'\u2014')) + '</div>'
        + '</div>';
    }).join('');
    el('pdFoot').innerHTML = `<button class="btn btn-outline" onclick="closeM('plotDetailModal')">Close</button>${bk ? `<button class="btn btn-gold" onclick="closeM('plotDetailModal');editBk('${bk.id}')">✏ Edit Booking</button>` : ''}`;
  }
  openM('plotDetailModal');
}

function openPlotFilter()  { openM('plotFilterModal'); }

function applyPlotFilter() {
  PM.filter.num    = (el('pf-num')?.value    || '').trim();
  PM.filter.status = (el('pf-status')?.value || '').trim();
  closeM('plotFilterModal');
  drawPlotGrid(S.curProj?.total_plots || 92);
}

function resetPlotFilter() {
  PM.filter = { num:'', status:'' };
  if (el('pf-num'))    el('pf-num').value    = '';
  if (el('pf-status')) el('pf-status').value = '';
  closeM('plotFilterModal');
  if (S.curProj) renderPlotMap();
}
