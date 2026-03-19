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

// ── User Management — Edge Function with SQL RPC fallback ────
async function api(action, payload = {}) {
  // Try edge function first
  try {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`${SB_URL}/functions/v1/manage-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SB_KEY
      },
      body: JSON.stringify({ action, ...payload })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  } catch(e) {
    // Edge function not deployed or network error — fall back to SQL RPC
    if (e.message === 'Failed to fetch' || e.message.includes('NetworkError') || e.message.includes('fetch')) {
      return await apiRPC(action, payload);
    }
    throw e;
  }
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

window.addEventListener('click', e => {
  if (e.target.classList.contains('overlay')) e.target.classList.remove('on');
});

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
    if (ev === 'SIGNED_IN'  && sess?.user && !S.user) await boot(sess.user);
    if (ev === 'SIGNED_OUT') showLogin();
  });
});

async function boot(authUser) {
  if (S.user?.id === authUser.id) return; // already booted
  showLoader(true);
  try {
    const { data: prof, error } = await sb.from('profiles').select('*').eq('id', authUser.id).single();
    if (error || !prof) {
      await sb.auth.signOut();
      showLogin('Account not configured. Contact your administrator.');
      return;
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
      else showLogin('No projects assigned. Contact admin.');
    }
  } catch(e) {
    console.error('Boot error:', e);
    showLogin('Connection error: ' + e.message);
  }
  showLoader(false);
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
  S.bookings = []; S.cheques = []; S.prev = [];
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
    {id:'p-sa-import',i:'📥',l:'Import Excel'},
  ],
  admin: [
    {id:'p-dash',i:'📊',l:'Dashboard'},
    {id:'p-bookings',i:'🏡',l:'Bookings'},
    {id:'p-pipeline',i:'🔄',l:'Pipeline'},
    {id:'p-cheques',i:'🧾',l:'Cheques'},
    {id:'p-prev',i:'📁',l:'Prev Team'},
    {id:'p-analytics',i:'📈',l:'Analytics'},
    {id:'p-settings',i:'⚙️',l:'Settings'},
  ],
  sales: [
    {id:'p-dash',i:'📊',l:'Dashboard'},
    {id:'p-bookings',i:'🏡',l:'Bookings'},
    {id:'p-pipeline',i:'🔄',l:'Pipeline'},
    {id:'p-cheques',i:'🧾',l:'Cheques'},
    {id:'p-analytics',i:'📈',l:'Analytics'},
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
  const canEdit = role !== 'sales';
  ['dashNewBk','bkNewBtn','chqNewBtn','prevNewBtn'].forEach(id => {
    const e = el(id); if (e) e.style.display = canEdit ? '' : 'none';
  });
}

async function navigate(pid) {
  goPage(pid);
  const isSA = pid.startsWith('p-sa-');
  if (!isSA && S.curProj) await loadProjData();
  const map = {
    'p-sa-proj': renderSAProj, 'p-sa-users': renderSAUsers, 'p-sa-import': renderImportPage,
    'p-dash': renderDash, 'p-bookings': renderBookings, 'p-pipeline': renderPipeline,
    'p-cheques': renderCheques, 'p-prev': renderPrev, 'p-analytics': renderAnalytics,
    'p-settings': renderSettings,
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
  el('backBtn').style.display = S.profile?.role === 'superadmin' ? '' : 'none';
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

function backToProjects() {
  S.curProj = null; S.bookings = []; S.cheques = []; S.prev = [];
  el('projChip').style.display = 'none';
  el('backBtn').style.display = 'none';
  buildNav('superadmin');
  goPage('p-sa-proj'); renderSAProj();
}

async function viewProjAsAdmin(pid) {
  const { data: p } = await sb.from('projects').select('*').eq('id', pid).single();
  if (!p) return;
  S.curProj = p;
  buildNav('admin');
  el('backBtn').style.display = '';
  el('projChip').style.display = 'none';
  goPage('p-dash');
  await loadProjData(); updateProjHeader(); renderDash();
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
async function renderSAProj() {
  const grid = el('saGrid');
  grid.innerHTML = `<div class="lc"><div class="spin spin-dk"></div> Loading…</div>`;
  const [{ data: projs }, { data: cnts }] = await Promise.all([
    sb.from('projects').select('*').order('created_at'),
    sb.from('bookings').select('project_id'),
  ]);
  const cntMap = {};
  (cnts||[]).forEach(b => { cntMap[b.project_id] = (cntMap[b.project_id]||0)+1; });
  if (!projs?.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="ei">🏗</div><h3>No projects yet</h3><p>Create your first project</p></div>`;
    return;
  }
  grid.innerHTML = '';
  projs.forEach((p, i) => {
    const bk = cntMap[p.id] || 0;
    const d = document.createElement('div'); d.className = 'proj-card';
    d.innerHTML = `
      <div class="proj-hero sw${(p.swatch??i)%5}">
        <span style="font-size:36px;opacity:.55;z-index:1;position:relative">🏘</span>
        <div style="position:absolute;top:8px;right:10px;z-index:2"><span class="badge b-gold">${bk} bookings</span></div>
      </div>
      <div class="proj-body">
        <div class="proj-name">${esc(p.name)}</div>
        <div class="proj-loc">📍 ${esc(p.location||'—')}</div>
        <div class="proj-stats">
          <div class="pst"><div class="v">${bk}</div><div class="l">Bookings</div></div>
          <div class="pst"><div class="v">${p.total_plots||'—'}</div><div class="l">Plots</div></div>
          <div class="pst"><div class="v">${p.rera?'✓':'—'}</div><div class="l">RERA</div></div>
        </div>
      </div>
      <div class="proj-foot">
        <span class="badge b-gray" style="font-size:11px">${esc(p.developer||'No developer')}</span>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();editProject('${p.id}')" title="Edit">✏️</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--gold)" onclick="event.stopPropagation();openClearDataModal('${p.id}','${esc(p.name)}')" title="Clear Data">🗑 Data</button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteProject('${p.id}','${p.name.replace(/'/g,"\\'")}')">Delete</button>
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
  const disb = bk.filter(b => b.disbursement_status === 'done').length;
  const pend = bk.filter(b => b.loan_status!=='Cancelled' && b.disbursement_status!=='done' && b.sanction_received!=='Yes').length;
  el('dashStats').innerHTML = `
    ${sc('sc-gold','🏡',bk.length,'Total Bookings','Active agreements')}
    ${sc('sc-teal','💰','₹'+fmtCr(totalVal),'Total Value','Agreement value')}
    ${sc('sc-sky','✅',disb,'Disbursed','Loans completed')}
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
  const canEdit = S.profile?.role !== 'sales';
  const canDel  = S.profile?.role === 'admin' || S.profile?.role === 'superadmin';
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
    const k = b.disbursement_status==='done' ? 'Disbursement Done' : b.loan_status;
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
  const canEdit = S.profile?.role !== 'sales', canDel = S.profile?.role==='admin'||S.profile?.role==='superadmin';
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
  const canEdit = S.profile?.role !== 'sales';
  tbody.innerHTML = S.prev.map((x,i)=>`<tr>
    <td class="td-dim">${i+1}</td><td class="td-name">${esc(x.client_name)}</td>
    <td>${esc(x.plot_no||'—')}</td><td class="td-dim">${numFmt(x.plot_size)}</td>
    <td style="font-weight:700">₹${numFmt(x.agreement_value)}</td>
    <td class="td-dim">${esc(x.notes||'—')}</td>
    <td>${canEdit?`<button class="btn btn-ghost btn-sm btn-icon" style="color:var(--rose)" onclick="delPrev('${x.id}')">🗑</button>`:''}</td>
  </tr>`).join('');
}

// ── ANALYTICS ────────────────────────────────────────────────
function renderAnalytics() {
  const bk=S.bookings, chq=S.cheques;
  Object.values(S.charts).forEach(c=>{ try{c.destroy()}catch(e){} }); S.charts={};
  const totalVal=sum(bk,'agreement_value'), disb=bk.filter(b=>b.disbursement_status==='done').length;
  const chqTotal=sum(chq,'amount');
  el('analStats').innerHTML = `
    ${sc('sc-gold','🏡',bk.length,'Bookings','')}
    ${sc('sc-teal','💰','₹'+fmtCr(totalVal),'Total Value','')}
    ${sc('sc-sky','✅',disb,'Disbursed','')}
    ${sc('sc-sage','🧾','₹'+fmtL(chqTotal),'Collected','')}`;
  const sg=groupCount(bk,'loan_status');
  S.charts.c1=mkChart('c-status','doughnut',Object.keys(sg),Object.values(sg),['#c47d1a','#196060','#1a4870','#3a6040','#a83030','#8fa5b5']);
  const bg=groupCount(bk,'bank_name');
  S.charts.c2=mkChart('c-bank','bar',Object.keys(bg),Object.values(bg),'#c47d1a','Count');
  const mg={}; bk.forEach(b=>{if(b.booking_date){const m=b.booking_date.slice(0,7);mg[m]=(mg[m]||0)+1;}});
  const months=Object.keys(mg).sort();
  S.charts.c3=mkChart('c-monthly','line',months,months.map(m=>mg[m]),'#196060','Bookings');
  const bvg={}; bk.forEach(b=>{const k=b.bank_name||'Unknown';bvg[k]=(bvg[k]||0)+(+b.agreement_value||0);});
  S.charts.c4=mkChart('c-value','bar',Object.keys(bvg),Object.values(bvg).map(v=>Math.round(v/100000)),'#1a4870','₹L');
  const dg={Done:0,Pending:0,Cancelled:0}; bk.forEach(b=>{if(b.loan_status==='Cancelled')dg.Cancelled++;else if(b.disbursement_status==='done')dg.Done++;else dg.Pending++;});
  S.charts.c5=mkChart('c-disb','doughnut',Object.keys(dg),Object.values(dg),['#3a6040','#c47d1a','#a83030']);
  const pg=groupSum(chq,'entry_type','amount');
  S.charts.c6=mkChart('c-pay','bar',Object.keys(pg),Object.values(pg).map(v=>Math.round(v/100000)),'#4a2a70','₹L');
}
function mkChart(id,type,labels,data,colors,label) {
  const canvas=el(id); if(!canvas) return null;
  const isMulti=Array.isArray(colors);
  return new Chart(canvas.getContext('2d'),{
    type, data:{labels,datasets:[{label:label||'',data,
      backgroundColor:isMulti?colors:(type==='line'?'transparent':colors+'33'),
      borderColor:isMulti?colors:colors, borderWidth:type==='line'?2.5:1.5,
      pointBackgroundColor:colors, pointRadius:type==='line'?4:0, tension:.4, fill:type==='line'}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:type==='doughnut',position:'bottom',labels:{font:{family:'Outfit',size:11},padding:16}},
               tooltip:{bodyFont:{family:'Outfit'},titleFont:{family:'Outfit'}}},
      scales:type!=='doughnut'?{x:{grid:{color:'rgba(0,0,0,.04)'},ticks:{font:{family:'Outfit',size:11}}},y:{grid:{color:'rgba(0,0,0,.04)'},ticks:{font:{family:'Outfit',size:11}}}}:{}}
  });
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
  S.editBkId = bk?.id || null;
  el('bkMTitle').textContent = bk ? 'Edit Booking' : 'New Booking';
  el('bkMSub').textContent   = bk ? bk.client_name : 'Add a plot booking';
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
    e.value = bk ? (bk[col]??'') : (defaults[fid]??'');
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
  closeM('bkModal'); await loadProjData(); renderBookings();
  toast(S.editBkId?'Booking updated!':'Booking added!');
}

async function delBk(id){
  if(!confirm('Delete this booking permanently?')) return;
  const {error}=await sb.from('bookings').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  await loadProjData(); renderBookings(); toast('Deleted');
}

function viewBk(id){
  const b=S.bookings.find(x=>x.id===id); if(!b) return;
  el('detailTitle').textContent=b.client_name;
  el('detailSub').textContent=`Plot ${b.plot_no} · ${b.bank_name||''} · ${b.loan_status}`;
  const canEdit=S.profile?.role!=='sales';
  el('detailEdit').style.display=canEdit?'':'none';
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
  closeM('chqModal'); await loadProjData(); renderCheques();
  toast(S.editChqId?'Updated!':'Entry added!');
}

async function delChq(id){
  if(!confirm('Delete this entry?')) return;
  await sb.from('cheques').delete().eq('id',id);
  await loadProjData(); renderCheques(); toast('Deleted');
}

// ── PREV MODAL ───────────────────────────────────────────────
function openPrevModal(){clearF(['pv-name','pv-plot','pv-size','pv-val','pv-notes']);openM('prevModal');}

async function savePrev(){
  const name=v('pv-name').trim(); if(!name){toast('Name required','err');return;}
  const {error}=await sb.from('prev_bookings').insert({project_id:S.curProj.id,client_name:name,plot_no:v('pv-plot'),plot_size:parseFloat(v('pv-size'))||null,agreement_value:parseFloat(v('pv-val'))||null,notes:v('pv-notes')});
  if(error){toast(error.message,'err');return;}
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

// ── EXCEL IMPORT ─────────────────────────────────────────────
const IMP = { wb:null, sheets:[], maps:{}, projId:null, parsed:{} };

function renderImportPage(){
  sb.from('projects').select('id,name').order('name').then(({data})=>{
    const sel=el('imp-proj');
    sel.innerHTML='<option value="">— Select Project —</option>'+(data||[]).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  });
  resetImport();
}

function resetImport(){
  IMP.wb=null; IMP.sheets=[]; IMP.maps={}; IMP.projId=null; IMP.parsed={};
  showEl('imp-s1'); hideEl('imp-s2'); hideEl('imp-s3'); hideEl('imp-result');
  const fi=el('imp-file'); if(fi) fi.value='';
  el('imp-fname').textContent=''; el('imp-parse-btn').disabled=true;
}

function onFileChange(input){
  const file=input.files[0]; if(!file) return;
  el('imp-fname').textContent='📄 '+file.name; el('imp-parse-btn').disabled=false;
}

// SOTR EXACT COLUMN MAPPING (hardcoded from actual file analysis)
const SOTR_MAP = {
  serial_no:0, booking_date:1, client_name:2, contact:3,
  plot_no:4, plot_size:5, basic_rate:6, infra:7,
  // col 8=basic amount, 9=basic+infra (calculated, skip)
  agreement_value:10, sdr:11, sdr_minus:12, maintenance:13, legal_charges:14,
  // col 15=total cost, 16=received, 17=remaining (skip)
  loan_status:18,
  // col 19=financing option, 20=loan amount sanctioned
  bank_name:21,
  // col 22=OCR received, 23=OCR amount, 24=OCR expected, 25=OCR date
  // col 26=file submitted to bank, 27=file submitted date
  sdr_received:28, sdr_received_date:29,
  sanction_received:30, sanction_date:31, sanction_letter:32,
  banker_contact:33,
  disbursement_status:34, disbursement_date:35,
  remark:36, doc_submitted:37,
};

const CHEQUE_MAP = { cust_name:0, plot_no:1, bank_detail:2, cheque_no:3, cheque_date:4, amount:5, entry_type:6 };
const PREV_MAP   = { client_name:0, plot_no:1, plot_size:2, agreement_value:3 };

function detectSheetType(sheetName, headers){
  const nl=sheetName.toLowerCase();
  const hstr=headers.map(h=>String(h||'').toLowerCase()).join(' ');
  if(nl.includes('bw')||nl.includes('sotr')) return 'bookings';
  if(nl.includes('cheque')||nl.includes('payment')) return 'cheques';
  if(nl.includes('prev')||nl.includes('previous')) return 'prev';
  if(nl==='sheet4') return 'bookings';
  // Skip summary/pivot sheets
  if(nl.includes('summary')||nl.includes('sheet1')||nl.includes('sheet2')||nl.includes('sheet3')) return 'skip';
  if(hstr.includes('agreement value')&&hstr.includes('name')) return 'bookings';
  if(hstr.includes('amount')&&hstr.includes('cust')) return 'cheques';
  return 'skip';
}

function getColMap(sheetName, headers, type){
  // Check if this looks like SOTR BWxSOTR (38+ cols with "Name" at col 2)
  if(type==='bookings' && headers.length>=30 && String(headers[2]||'').trim()==='Name'){
    return {...SOTR_MAP};
  }
  if(type==='cheques' && headers.length>=6 && String(headers[0]||'').toUpperCase().includes('CUST')){
    return {...CHEQUE_MAP};
  }
  if(type==='prev' && headers.length>=3 && String(headers[0]||'').toLowerCase().includes('customer')){
    return {...PREV_MAP};
  }
  // Generic fuzzy fallback
  const cols={};
  const n=h=>String(h||'').toLowerCase().replace(/[\n\r\t]+/g,' ').replace(/\s+/g,' ').trim();
  headers.forEach((h,idx)=>{
    const hn=n(h); if(!hn) return;
    if(type==='bookings'){
      if(cols.serial_no===undefined&&(hn==='no'||hn.startsWith('serial'))) cols.serial_no=idx;
      if(cols.booking_date===undefined&&hn==='date') cols.booking_date=idx;
      if(cols.client_name===undefined&&(hn==='name'||hn.includes('client name')||hn.includes('customer name'))) cols.client_name=idx;
      if(cols.contact===undefined&&(hn.includes('contact')||hn.includes('mobile'))) cols.contact=idx;
      if(cols.plot_no===undefined&&hn.includes('plot')&&!hn.includes('size')) cols.plot_no=idx;
      if(cols.plot_size===undefined&&(hn.includes('plot size')||hn.includes('sqft'))) cols.plot_size=idx;
      if(cols.basic_rate===undefined&&hn.includes('basic rate')) cols.basic_rate=idx;
      if(cols.infra===undefined&&hn==='infra') cols.infra=idx;
      if(cols.agreement_value===undefined&&hn.includes('agreement value')) cols.agreement_value=idx;
      if(cols.sdr===undefined&&hn.trim()==='sdr') cols.sdr=idx;
      if(cols.maintenance===undefined&&hn.includes('maintenance')) cols.maintenance=idx;
      if(cols.legal_charges===undefined&&hn.includes('legal')) cols.legal_charges=idx;
      if(cols.bank_name===undefined&&hn.startsWith('bank')) cols.bank_name=idx;
      if(cols.loan_status===undefined&&(hn.includes('agreement status')||hn.includes('loan status'))) cols.loan_status=idx;
      if(cols.sanction_received===undefined&&hn.includes('sanction received')&&!hn.includes('date')) cols.sanction_received=idx;
      if(cols.sanction_date===undefined&&hn.includes('sanction received on date')) cols.sanction_date=idx;
      if(cols.disbursement_status===undefined&&hn.includes('disbursement status')) cols.disbursement_status=idx;
      if(cols.disbursement_date===undefined&&hn.includes('disbursement done on date')) cols.disbursement_date=idx;
      if(cols.remark===undefined&&hn==='remark') cols.remark=idx;
    }
    if(type==='cheques'){
      if(cols.cust_name===undefined&&(hn.includes('cust')||hn==='name')) cols.cust_name=idx;
      if(cols.plot_no===undefined&&hn.includes('plot')) cols.plot_no=idx;
      if(cols.bank_detail===undefined&&hn.includes('bank')) cols.bank_detail=idx;
      if(cols.cheque_no===undefined&&(hn.includes('chq no')||hn.includes('cheque no'))) cols.cheque_no=idx;
      if(cols.cheque_date===undefined&&(hn.includes('chq date')||hn==='date')) cols.cheque_date=idx;
      if(cols.amount===undefined&&hn.includes('amount')) cols.amount=idx;
      if(cols.entry_type===undefined&&hn==='remark') cols.entry_type=idx;
    }
    if(type==='prev'){
      if(cols.client_name===undefined&&(hn.includes('customer')||hn==='name')) cols.client_name=idx;
      if(cols.plot_no===undefined&&(hn.includes('plot number')||hn.includes('plot no'))) cols.plot_no=idx;
      if(cols.plot_size===undefined&&hn.includes('size')) cols.plot_size=idx;
      if(cols.agreement_value===undefined&&hn.includes('agreement value')) cols.agreement_value=idx;
    }
  });
  return cols;
}

async function parseFile(){
  const file=el('imp-file').files[0], projId=el('imp-proj').value;
  if(!file){toast('Select a file','err');return;}
  if(!projId){toast('Select a project','err');return;}
  if(typeof XLSX==='undefined'){toast('Excel library not loaded. Refresh page.','err');return;}
  IMP.projId=projId;
  setBtn('imp-parse-btn',true); el('imp-fname').textContent='⏳ Reading…';
  try{const buf=await file.arrayBuffer(); IMP.wb=XLSX.read(buf,{type:'array',cellDates:true,raw:false}); IMP.sheets=IMP.wb.SheetNames;}
  catch(e){toast('Error reading file: '+e.message,'err');setBtn('imp-parse-btn',false);return;}
  setBtn('imp-parse-btn',false); hideEl('imp-s1'); showEl('imp-s2');
  const container=el('sheetMaps'); container.innerHTML='';

  IMP.sheets.forEach(sheetName=>{
    const sid=sheetName.replace(/[^a-zA-Z0-9]/g,'_');
    const ws=IMP.wb.Sheets[sheetName];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
    const headers=(rows[0]||[]).map(h=>String(h||'').trim());
    const dataRows=rows.slice(1).filter(r=>r.some(c=>c!==''));
    const prevRows=dataRows.slice(0,3);
    const autoType=detectSheetType(sheetName,headers);
    const autoMap=getColMap(sheetName,headers,autoType);
    IMP.maps[sheetName]={type:autoType,cols:autoMap};

    const wrap=document.createElement('div');
    wrap.style.cssText='background:#fff;border:1px solid var(--border);border-radius:12px;margin-bottom:14px;overflow:hidden';
    const vis=headers.slice(0,7).filter(Boolean);

    const colMapHTML=()=>{
      const t=IMP.maps[sheetName].type; if(t==='skip') return '';
      const defs={bookings:[['serial_no','#',false],['booking_date','Date',false],['client_name','Client Name',true],['contact','Contact',false],['plot_no','Plot No.',false],['plot_size','Size (sqft)',false],['basic_rate','Basic Rate',false],['infra','Infra',false],['agreement_value','Agr. Value',false],['sdr','SDR',false],['sdr_minus','SDR-',false],['maintenance','Maintenance',false],['legal_charges','Legal',false],['bank_name','Bank',false],['loan_status','Loan Status',false],['sanction_received','Sanction Recv.',false],['sanction_date','Sanction Date',false],['sanction_letter','Sanction Letter',false],['banker_contact','Banker Contact',false],['sdr_received','SDR Received',false],['sdr_received_date','SDR Recv. Date',false],['disbursement_status','Disb. Status',false],['disbursement_date','Disb. Date',false],['remark','Remark',false],['doc_submitted','Doc Submitted',false]],cheques:[['cust_name','Customer Name',true],['plot_no','Plot No.',false],['bank_detail','Bank Detail',false],['cheque_no','Cheque/Ref No.',false],['cheque_date','Date',false],['amount','Amount',true],['entry_type','Type (RPM/SM)',false]],prev:[['client_name','Customer Name',true],['plot_no','Plot No.',false],['plot_size','Plot Size',false],['agreement_value','Agr. Value',false]]}[t]||[];
      const cols=IMP.maps[sheetName].cols;
      const opts='<option value="">— Skip —</option>'+headers.map((h,i)=>`<option value="${i}">${i+1}. ${esc(h||'(empty)')}</option>`).join('');
      const mkSel=(key,req)=>{
        const val=cols[key];
        const selected=opts.replace(`value="${val}"`,`value="${val}" selected`);
        return `<div style="display:flex;flex-direction:column;gap:4px"><label style="font-size:10px;font-weight:700;color:${req?'var(--gold)':'var(--inkf)'};text-transform:uppercase;letter-spacing:.8px">${key.replace(/_/g,' ')}${req?' *':''}</label><select id="cm_${sid}_${key}" style="padding:5px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:11px;font-family:'Outfit',sans-serif" onchange="IMP.maps['${sheetName.replace(/'/g,"\\'")  }'].cols['${key}']=this.value===''?undefined:parseInt(this.value)">${selected}</select></div>`;
      };
      return `<div style="margin-bottom:8px;font-size:10.5px;color:var(--inkf)">Map columns to CRM fields — auto-detected for SOTR format.</div><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${defs.map(([k,,r])=>mkSel(k,r)).join('')}</div>`;
    };

    wrap.innerHTML=`
      <div style="padding:11px 16px;background:var(--paper);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-weight:600;font-size:13px">📄 ${esc(sheetName)}</span>
        <span style="font-size:12px;color:var(--inkf)">${dataRows.length} rows · ${headers.filter(Boolean).length} cols</span>
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
          <label style="font-size:12px;color:var(--inkl)">Import as:</label>
          <select id="stype_${sid}" style="padding:5px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:12px;font-family:'Outfit',sans-serif">
            <option value="skip" ${autoType==='skip'?'selected':''}>⏭ Skip</option>
            <option value="bookings" ${autoType==='bookings'?'selected':''}>🏡 Bookings</option>
            <option value="cheques"  ${autoType==='cheques'?'selected':''}>🧾 Cheques</option>
            <option value="prev"     ${autoType==='prev'?'selected':''}>📁 Prev Team</option>
          </select>
        </div>
      </div>
      <div id="maparea_${sid}" style="padding:13px 16px;${autoType==='skip'?'display:none':''}">${colMapHTML()}</div>
      ${prevRows.length?`<div style="padding:0 16px 13px;overflow-x:auto">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--inkf);margin-bottom:5px">Preview (first 3 rows)</div>
        <table style="font-size:11px;border-collapse:collapse;min-width:100%"><thead><tr>${vis.map(h=>`<th style="padding:3px 7px;background:var(--paper);border:1px solid var(--border);white-space:nowrap">${esc(h)}</th>`).join('')}</tr></thead><tbody>${prevRows.map(row=>`<tr>${vis.map((h,i)=>`<td style="padding:3px 7px;border:1px solid var(--border);white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis">${esc(String(row[i]||''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:''}`;
    container.appendChild(wrap);

    const sel=el('stype_'+sid);
    if(sel) sel.addEventListener('change',function(){
      const t=this.value;
      IMP.maps[sheetName].type=t;
      IMP.maps[sheetName].cols=getColMap(sheetName,headers,t);
      const ma=el('maparea_'+sid);
      if(t==='skip'){ma.style.display='none';}
      else{ma.style.display=''; ma.innerHTML=colMapHTML();}
    });
  });
}

function previewImport(){
  let total=0; const summary=[]; IMP.parsed={};
  IMP.sheets.forEach(sheetName=>{
    const mapping=IMP.maps[sheetName]; if(!mapping||mapping.type==='skip') return;
    const ws=IMP.wb.Sheets[sheetName];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
    const dataRows=rows.slice(1).filter(r=>r.some(c=>c!==''&&c!==null&&c!==undefined));
    const parsed=dataRows.map(row=>{
      const obj={};
      Object.entries(mapping.cols).forEach(([field,colIdx])=>{
        if(colIdx!==undefined&&colIdx!==''){const val=row[parseInt(colIdx)];obj[field]=(val!==undefined&&val!==null)?String(val).trim():'';}
      });
      return obj;
    }).filter(obj=>obj.client_name||obj.cust_name);
    IMP.parsed[sheetName]=parsed; total+=parsed.length;
    summary.push({sheet:sheetName,type:mapping.type,count:parsed.length});
  });
  hideEl('imp-s2'); showEl('imp-s3');
  el('imp-summary').innerHTML=summary.length?summary.map(s=>`<div style="display:flex;align-items:center;gap:11px;padding:11px 15px;background:#fff;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
    <span style="font-size:18px">${s.type==='bookings'?'🏡':s.type==='cheques'?'🧾':'📁'}</span>
    <div><div style="font-weight:600;font-size:13px">${esc(s.sheet)}</div><div style="font-size:11px;color:var(--inkf)">→ ${s.type}</div></div>
    <div style="margin-left:auto;font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700">${s.count}</div>
    <div style="font-size:11px;color:var(--inkf)">rows</div></div>`).join('')
    :`<div style="color:var(--rose);font-size:13px;padding:12px">No valid rows found. Check column mappings and make sure Client Name is mapped.</div>`;
  el('imp-total').textContent=total;
  el('imp-confirm').disabled=total===0;
}

async function runImport(){
  const projId=IMP.projId; if(!projId) return;
  setBtn('imp-confirm',true); showEl('imp-progress');
  let imported=0, errors=0;
  const entries=Object.entries(IMP.parsed);
  for(let ei=0;ei<entries.length;ei++){
    const [sheetName,rows]=entries[ei];
    const type=IMP.maps[sheetName].type; if(!rows.length) continue;
    el('imp-prog-text').textContent=`Importing "${sheetName}" (${rows.length} rows)…`;
    const CHUNK=50;
    for(let i=0;i<rows.length;i+=CHUNK){
      const chunk=rows.slice(i,i+CHUNK).map(row=>buildImpRow(row,type,projId)).filter(Boolean);
      if(!chunk.length) continue;
      const table=type==='bookings'?'bookings':type==='cheques'?'cheques':'prev_bookings';
      const {error}=await sb.from(table).insert(chunk);
      if(error){errors+=chunk.length;console.error(sheetName,i,error.message);}
      else imported+=chunk.length;
      el('imp-prog-bar').style.width=Math.min(Math.round(((ei/entries.length)+(i/rows.length/entries.length))*100),99)+'%';
    }
  }
  el('imp-prog-bar').style.width='100%';
  await new Promise(r=>setTimeout(r,400));
  setBtn('imp-confirm',false); hideEl('imp-s3'); hideEl('imp-progress'); showEl('imp-result');
  el('imp-ok').textContent=imported; el('imp-err').textContent=errors;
  if(imported>0&&S.curProj?.id===projId) await loadProjData();
  toast(imported>0?`✓ Imported ${imported} records!`:'No records imported',imported>0?'ok':'err');
}

function buildImpRow(row,type,projId){
  if(type==='bookings'){
    const name=row.client_name||''; if(!name) return null;
    // Agreement Status (col 18): "done" = Agreement Completed AND Disbursed
    // Disbursement Status (col 34): "done" = disbursed; rest = banker remark
    const agreeRaw=String(row.loan_status||'').trim().toLowerCase().replace(/[^a-z]/g,'');
    const disbRaw =String(row.disbursement_status||'').trim();
    const disbRawL=disbRaw.toLowerCase().replace(/[^a-z]/g,'');
    const isDisbDone = disbRawL==='done' || agreeRaw==='done';
    const disbRemark = (!isDisbDone && disbRaw && disbRawL!=='') ? disbRaw : '';
    const sancRecv   = String(row.sanction_received||'').trim();
    return {
      project_id:projId,
      serial_no:   toInt(row.serial_no),
      booking_date:toDate(row.booking_date),
      client_name: name,
      contact:     row.contact||'',
      plot_no:     row.plot_no||'',
      plot_size:   toNum(row.plot_size),
      basic_rate:  toNum(row.basic_rate),
      infra:       toNum(row.infra)||100,
      agreement_value: toNum(row.agreement_value),
      sdr:         toNum(row.sdr),
      sdr_minus:   toNum(row.sdr_minus)||0,
      maintenance: toNum(row.maintenance)||0,
      legal_charges: toNum(row.legal_charges)||25000,
      bank_name:   row.bank_name||'',
      banker_contact: row.banker_contact||'',
      loan_status: normLoanStatus(row.loan_status),
      sanction_received: sancRecv.toLowerCase().startsWith('y') ? 'Yes' : null,
      sanction_date:  toDate(row.sanction_date),
      sanction_letter: row.sanction_letter||null,
      sdr_received:    toNum(row.sdr_received),
      sdr_received_date: toDate(row.sdr_received_date),
      disbursement_status: isDisbDone ? 'done' : null,
      disbursement_date:   toDate(row.disbursement_date),
      disbursement_remark: disbRemark,
      doc_submitted: row.doc_submitted||'',
      remark:        row.remark||'',
    };
  }
  if(type==='cheques'){
    const name=row.cust_name||''; if(!name) return null;
    return {project_id:projId,cust_name:name,plot_no:row.plot_no||'',bank_detail:row.bank_detail||'',cheque_no:row.cheque_no||'',cheque_date:toDate(row.cheque_date),amount:toNum(row.amount)||0,entry_type:normEntry(row.entry_type)};
  }
  if(type==='prev'){
    const name=row.client_name||''; if(!name) return null;
    return {project_id:projId,client_name:name,plot_no:row.plot_no||'',plot_size:toNum(row.plot_size),agreement_value:toNum(row.agreement_value),notes:row.notes||''};
  }
  return null;
}

// ── IMPORT NORMALIZERS ───────────────────────────────────────
function normLoanStatus(v){
  if(!v) return 'File Given';
  const vl=String(v).toLowerCase().trim();
  if(vl==='done'||vl.includes('agreement completed')) return 'Agreement Completed';
  if(vl.includes('disburs')&&vl.includes('done')) return 'Disbursement Done';
  if(vl.includes('sanction received')||vl.includes('sanction reciv')||vl.includes('sanction recieved')) return 'Sanction Received';
  if(vl.includes('cancel')) return 'Cancelled';
  if(vl.includes('phase 2')||vl.includes('under process')||vl.includes('file under process')) return 'Under Process';
  if(vl.includes('self fund')) return 'Under Process';
  if(vl.includes('file given')||vl.includes('file submitted')||vl.includes('file subm')||vl.includes('bank')) return 'File Given';
  return 'File Given';
}
function normEntry(v){
  if(!v) return 'RPM';
  const vl=String(v).toUpperCase().trim();
  if(['RPM','SM','NILL','BOUNCE','Other'].includes(vl)||vl==='OTHER') return vl==='OTHER'?'Other':vl;
  if(vl.includes('CASH')) return 'cash';
  return 'RPM';
}
function toNum(v){ if(!v&&v!==0) return null; const n=parseFloat(String(v).replace(/[₹,\s]/g,'')); return isNaN(n)?null:n; }
function toInt(v){ if(!v) return null; const n=parseInt(v); return isNaN(n)?null:n; }
function toDate(v){
  if(!v) return null;
  const s=String(v).trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0,10);
  const m=s.match(/(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})/);
  if(m){const y=m[3].length===2?'20'+m[3]:m[3];return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;}
  const n=parseFloat(v);
  if(!isNaN(n)&&n>40000){const d=new Date(Math.round((n-25569)*86400*1000));return d.toISOString().substring(0,10);}
  return null;
}

// ── CUSTOM FIELD INPUT ───────────────────────────────────────
function cfInput(f,val,id){
  if(f.field_type==='select'&&f.field_options?.length)
    return `<select id="${id}"><option value="">—</option>${f.field_options.map(o=>`<option value="${o}"${val===o?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
  if(f.field_type==='textarea') return `<textarea id="${id}" rows="2">${esc(val)}</textarea>`;
  if(f.field_type==='boolean')
    return `<select id="${id}"><option value="">—</option><option value="Yes"${val==='Yes'?' selected':''}>Yes</option><option value="No"${val==='No'?' selected':''}>No</option></select>`;
  return `<input type="${f.field_type==='number'?'number':f.field_type==='date'?'date':'text'}" id="${id}" value="${esc(val)}">`;
}

// ── UI COMPONENTS ────────────────────────────────────────────
function sc(cls,icon,val,label,sub){ return `<div class="sc ${cls}"><div class="sc-blob"></div><div class="sc-icon">${icon}</div><div class="sc-val">${val}</div><div class="sc-label">${label}</div><div class="sc-sub">${sub}</div></div>`; }
function triplet(items){ return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px">${items.map(x=>`<div style="text-align:center;padding:12px 7px;background:${x.bg};border-radius:9px"><div style="font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:700;color:${x.c}">${x.v}</div><div style="font-size:9.5px;text-transform:uppercase;letter-spacing:1px;color:var(--inkf);margin-top:3px">${x.l}</div></div>`).join('')}</div>`; }
function statusBadge(s){ const m={'Agreement Completed':'b-green','Disbursement Done':'b-green','Sanction Received':'b-blue','File Given':'b-gold','Under Process':'b-teal','Cancelled':'b-rose'}; return `<span class="badge ${m[s]||'b-gray'}">${s||'—'}</span>`; }
function chqBadge(t){ return {RPM:'b-blue',SM:'b-gold',BOUNCE:'b-rose',NILL:'b-gray',cash:'b-teal',Other:'b-gray'}[t]||'b-gray'; }
