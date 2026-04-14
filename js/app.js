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
    {id:'p-plotmap',i:'🗺',l:'Plot Map'},
    {id:'p-bookings',i:'🏡',l:'Bookings'},
    {id:'p-pipeline',i:'🔄',l:'Pipeline'},
    {id:'p-cheques',i:'🧾',l:'Cheques'},
    {id:'p-prev',i:'📁',l:'Prev Team'},
    {id:'p-analytics',i:'📈',l:'Analytics'},
    {id:'p-audit',i:'📋',l:'Audit Log'},
    {id:'p-sa-import',i:'📥',l:'Import'},
    {id:'p-settings',i:'⚙️',l:'Settings'},
  ],
  sales: [
    {id:'p-dash',i:'📊',l:'Dashboard'},
    {id:'p-plotmap',i:'🗺',l:'Plot Map'},
    {id:'p-bookings',i:'🏡',l:'Bookings'},
    {id:'p-pipeline',i:'🔄',l:'Pipeline'},
    {id:'p-cheques',i:'🧾',l:'Cheques'},
    {id:'p-prev',i:'📁',l:'Prev Team'},
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
  try { map[pid]?.(); } catch(e) { console.error('Navigate render error:', pid, e.message); toast('Page error: '+e.message,'err'); }
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
  try {
    const [b, c, p, cf] = await Promise.all([
      sb.from('bookings').select('*').eq('project_id', pid).order('serial_no', {nullsLast:true}).order('created_at'),
      sb.from('cheques').select('*').eq('project_id', pid).order('cheque_date', {ascending:false,nullsFirst:false}).order('created_at', {ascending:false}),
      sb.from('prev_bookings').select('*').eq('project_id', pid).order('created_at'),
      sb.from('custom_fields').select('*').eq('project_id', pid).order('sort_order'),
    ]);
    S.bookings = b.data || []; S.cheques = c.data || [];
    S.prev = p.data || []; S.customFields = cf.data || [];
  } catch(e) {
    console.error('loadProjData error:', e.message);
    S.bookings = []; S.cheques = []; S.prev = []; S.customFields = [];
    toast('Error loading project data: ' + e.message, 'err');
  }
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
  let projs, allBk, allChq;
  try {
    const results = await Promise.all([
      sb.from('projects').select('*').order('created_at'),
      sb.from('bookings').select('project_id,agreement_value,disbursement_status'),
      sb.from('cheques').select('project_id,amount'),
    ]);
    projs = results[0].data; allBk = results[1].data; allChq = results[2].data;
    if (results[0].error) throw new Error(results[0].error.message);
  } catch(err) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="ei">⚠️</div><h3>Error loading projects</h3><p>${esc(err.message)}</p><button class="btn btn-gold" onclick="renderSAProj()" style="margin-top:12px">↻ Retry</button></div>`;
    return;
  }
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
  // Cache for chart type switcher
  S._saProjs = projs; S._saAllBk = allBk||[]; S._saAllChq = allChq||[];
}
function renderSACharts() {
  if (!S._saProjs) return;
  const projs = S._saProjs, allBk = S._saAllBk || [];
  try {
    ['saC1','saC2','saC3'].forEach(id=>{const cv=el(id);if(cv){const ex=Chart.getChart(cv);if(ex)ex.destroy();}});
    const pNames=projs.map(p=>p.name);
    const pBk=projs.map(p=>(allBk.filter(b=>b.project_id===p.id)).length);
    const pVal=projs.map(p=>Math.round(allBk.filter(b=>b.project_id===p.id).reduce((s,b)=>s+(+b.agreement_value||0),0)/10000000*100)/100);
    const ct1=el('saC1-type')?.value||'bar';
    const ct3=el('saC3-type')?.value||'bar';
    if(el('saC1')) mkChart('saC1',ct1,pNames,pBk,'#c47d1a','Bookings');
    if(el('saC2')){const sg=groupCount(allBk,'loan_status');mkChart('saC2','doughnut',Object.keys(sg),Object.values(sg),['#c47d1a','#196060','#1a4870','#3a6040','#a83030','#8fa5b5'],'Count');}
    if(el('saC3')) mkChart('saC3',ct3,pNames,pVal,'#196060','₹Cr');
  } catch(e) { console.warn('SA charts error:', e.message); }
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
  if (!el('dashStats')) return;
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
  if (s) d=d.filter(b=>(b.client_name||'').toLowerCase().includes(s)||String(b.plot_no).includes(s)||(b.contact||'').toLowerCase().includes(s)||(b.bank_name||'').toLowerCase().includes(s));
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
  if (s) d=d.filter(c=>(c.cust_name||'').toLowerCase().includes(s)||(c.cheque_no||'').toLowerCase().includes(s)||(c.plot_no||'').toLowerCase().includes(s)||(c.bank_detail||'').toLowerCase().includes(s));
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
  // Block if plot already booked (not editing, just new booking from plot map)
  if (bk && !bk.id && bk.plot_no) {
    const plotNo = String(bk.plot_no).trim();
    const existing = S.bookings.find(b => String(b.plot_no).trim() === plotNo && b.loan_status !== 'Cancelled');
    const prevExisting = S.prev.find(p => String(p.plot_no).trim() === plotNo);
    if (existing || prevExisting) {
      const who = existing?.client_name || prevExisting?.client_name || 'another customer';
      toast(`Plot ${plotNo} is already booked by ${who}`, 'err');
      return;
    }
  }
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
  const editId  = S.editBkId;
  const oldBk   = isEdit ? S.bookings.find(b=>b.id===editId) : null;
  closeM('bkModal'); await loadProjData(); renderBookings();
  toast(isEdit?'Booking updated!':'Booking added!');
  // Build changes object for audit
  const changes = {};
  if (isEdit && oldBk) {
    ['loan_status','bank_name','disbursement_status','sanction_received','agreement_value','contact'].forEach(f=>{
      if (String(oldBk[f]||'') !== String(data[f]||'')) changes[f]={old:oldBk[f]||'',new:data[f]||''};
    });
  }
  const saved = S.bookings.find(b => isEdit ? b.id===editId : b.client_name===name);
  await logAudit(
    isEdit?'update':'create', 'booking', saved?.id||null,
    `${name} — Plot ${data.plot_no}`,
    isEdit ? `Updated Plot ${data.plot_no} (${name})` : `New booking — Plot ${data.plot_no}, ${name}, ₹${(data.agreement_value||0).toLocaleString('en-IN')}`,
    Object.keys(changes).length ? changes : null
  );
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
  await logAudit(wasEdit?'UPDATE':'CREATE','cheque',null,`${data.cust_name} Plot ${data.plot_no||'?'}`,    
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
      entity_label: entityLabel || '',
      detail:       detail || entityLabel || '',
      changes:      changes ? JSON.stringify(changes) : null,
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
      <td style="font-size:12px;max-width:240px">
        <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(log.entity_label||'—')}</div>
        ${log.detail&&log.detail!==log.entity_label?`<div style="font-size:11px;color:var(--inkf);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(log.detail)}</div>`:''}
      </td>
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
  available: { label:'Available',           color:'#94a3b8', bg:'#ffffff', border:'#cbd5e1', text:'#475569', top3d:'#ffffff', side3d:'#e2e8f0' },
  booked:    { label:'Booked / Processing', color:'#f59e0b', bg:'#fef3c7', border:'#d97706', text:'#92400e', top3d:'#fde68a', side3d:'#ca8a04' },
  sanction:  { label:'Sanction Received',   color:'#3b82f6', bg:'#dbeafe', border:'#1d4ed8', text:'#1e40af', top3d:'#93c5fd', side3d:'#1d4ed8' },
  completed: { label:'Agreement Completed', color:'#059669', bg:'#d1fae5', border:'#065f46', text:'#064e3b', top3d:'#6ee7b7', side3d:'#065f46' },
  prev:      { label:'Previous Team',       color:'#a855f7', bg:'#f3e8ff', border:'#7e22ce', text:'#6b21a8', top3d:'#d8b4fe', side3d:'#7e22ce' },
  phase2:    { label:'Phase 2',             color:'#6b7280', bg:'#f1f5f9', border:'#475569', text:'#374151', top3d:'#cbd5e1', side3d:'#475569' },
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


// ── ISOMETRIC PLOT MAP ─────────────────────────────────────

// Plot areas from PDF (sqm) — used to scale block heights
const PLOT_AREAS = {
  4:288,5:206,6:206,7:206,8:206,9:206,
  11:237,12:237,13:237,14:237,15:237,16:237,17:237,18:237,19:237,20:237,
  21:233,22:231,23:226,24:226,25:226,26:232,27:238,28:241,29:245,30:251,
  31:392,32:230,33:230,34:230,35:227,36:227,37:230,38:230,39:230,40:394,
  41:231,42:230,43:230,44:230,45:230,46:230,47:478,48:478,49:230,50:230,
  51:230,52:230,53:230,54:231,
  55:189,56:190,57:190,58:382,59:195,60:190,61:190,62:190,63:189,
  64:191,65:190,66:190,67:190,68:190,69:190,70:396,71:396,
  72:190,73:190,74:190,75:190,76:190,77:191,
  78:175,79:177,80:177,81:177,82:182,83:183,84:177,85:177,86:177,87:175,
  88:177,89:177,90:177,91:177,92:177
};

// Exact layout: [plotNo, col, row, wScale, dScale]
// Matches PDF master plan positions exactly
const PLOT_LAYOUT = [
  // Entry strip (plots 4-9)
  [4,0,0,1,0.8],[5,1,0,1,0.8],[6,2,0,1,0.8],[7,3,0,1,0.8],[8,4,0,1,0.8],[9,5,0,1,0.8],
  // Block 1: cols 6-7, plots 11-30
  [11,6,0,1,1.45],[12,6,1,1,1.45],[13,6,2,1,1.45],[14,6,3,1,1.45],[15,6,4,1,1.45],
  [16,6,5,1,1.45],[17,6,6,1,1.45],[18,6,7,1,1.45],[19,6,8,1,1.45],[20,6,9,1,1.45],
  [21,7,0,1,1.45],[22,7,1,1,1.45],[23,7,2,1,1.45],[24,7,3,1,1.45],[25,7,4,1,1.45],
  [26,7,5,1,1.45],[27,7,6,1,1.45],[28,7,7,1,1.45],[29,7,8,1,1.45],[30,7,9,1,1.45],
  // Block 2: cols 9-11, plots 31-54
  [31,9,0,1.65,1.5],[32,9,1,1,1.5],[33,9,2,1,1.5],[34,9,3,1,1.5],[35,9,4,1,1.5],
  [36,9,5,1,1.5],[37,9,6,1,1.5],[38,9,7,1,1.5],[39,9,8,1,1.5],[40,9,9,1.65,1.5],
  [41,10,0,1,1.5],[42,10,1,1,1.5],[43,10,2,1,1.5],[44,10,3,1,1.5],[45,10,4,1,1.5],
  [46,10,5,1,1.5],[47,10,6,2,1.5],[48,10,7,2,1.5],[49,10,8,1,1.5],[50,10,9,1,1.5],
  [51,11,0,1,1.5],[52,11,1,1,1.5],[53,11,2,1,1.5],[54,11,3,1,1.5],
  // Block 3: cols 13-15, plots 55-77
  [55,13,0,1,1.25],[56,13,1,1,1.25],[57,13,2,1,1.25],[58,13,3,2,1.25],
  [59,13,4,1,1.25],[60,13,5,1,1.25],[61,13,6,1,1.25],[62,13,7,1,1.25],[63,13,8,1,1.25],
  [64,14,0,1,1.25],[65,14,1,1,1.25],[66,14,2,1,1.25],[67,14,3,1,1.25],
  [68,14,4,1,1.25],[69,14,5,1,1.25],[70,14,6,2,1.25],[71,14,7,2,1.25],
  [72,15,0,1,1.25],[73,15,1,1,1.25],[74,15,2,1,1.25],[75,15,3,1,1.25],[76,15,4,1,1.25],[77,15,5,1,1.25],
  // Block 4: cols 17-18, plots 78-92
  [78,17,0,1,1.15],[79,17,1,1,1.15],[80,17,2,1,1.15],[81,17,3,1,1.15],[82,17,4,1.1,1.15],
  [83,17,5,1.1,1.15],[84,17,6,1,1.15],[85,17,7,1,1.15],[86,17,8,1,1.15],[87,17,9,1,1.15],
  [88,18,0,1,1.15],[89,18,1,1,1.15],[90,18,2,1,1.15],[91,18,3,1,1.15],[92,18,4,1,1.15],
];

function renderPlotMap() {
  if (!S.curProj) return;

  const PLOT_NUMS = PLOT_LAYOUT.map(p => p[0]);
  const plotData = {};

  PLOT_NUMS.forEach(i => {
    const bk = S.bookings.find(b => parseInt(b.plot_no) === i);
    const pv = S.prev.find(x => parseInt(x.plot_no) === i);
    let status = 'available';
    if (pv) status = 'prev';
    else if (bk) {
      if (bk.loan_status === 'Agreement Completed') status = 'completed';
      else if (bk.loan_status === 'Sanction Received') status = 'sanction';
      else if (bk.bank_name === 'Phase 2') status = 'phase2';
      else status = 'booked';
    }
    plotData[i] = {
      status, plot_no: i,
      client_name:     bk?.client_name || pv?.client_name || '',
      contact:         bk?.contact || '',
      plot_size:       bk?.plot_size   || pv?.plot_size   || String(PLOT_AREAS[i]||''),
      agreement_value: bk?.agreement_value || pv?.agreement_value || '',
      bank_name:       bk?.bank_name || '',
      loan_status:     bk?.loan_status || '',
    };
  });

  // Summary counts
  const counts = {};
  Object.values(plotData).forEach(p => counts[p.status] = (counts[p.status]||0)+1);
  const smBar = el('plotSummaryBar');
  if (smBar) smBar.innerHTML = Object.entries(counts).map(([st,cnt]) => {
    const cfg = PLOT_STATUS[st]; if(!cfg||!cnt) return '';
    return `<div style="display:flex;align-items:center;gap:6px;padding:5px 12px;border-radius:20px;background:${cfg.bg};border:1.5px solid ${cfg.border};cursor:pointer" onclick="filterByStatus('${st}')">
      <div style="width:9px;height:9px;border-radius:50%;background:${cfg.color}"></div>
      <span style="font-size:12px;font-weight:600;color:${cfg.text}">${cfg.label}: ${cnt}</span></div>`;
  }).join('');

  drawIsometricMap(plotData);
}

function filterByStatus(status) {
  PM.filter.status = PM.filter.status === status ? '' : status;
  renderPlotMap();
}

function pmSearch(val) {
  const v = val.trim().toLowerCase();
  if (!v) { PM.filter.num = ''; PM.filter.clientSearch = ''; renderPlotMap(); return; }
  // If numeric: filter by plot number
  if (/^\d+$/.test(v)) {
    PM.filter.num = v;
    PM.filter.clientSearch = '';
  } else {
    PM.filter.clientSearch = v;
    PM.filter.num = '';
  }
  renderPlotMap();
}

function drawIsometricMap(plotData) {
  const container = el('plot3dContainer');
  if (!container) return;

  // Unit sizes in px
  const U = 46;  // base unit
  const ROAD_GAP = 32;
  const COL_GAP  = 4;

  // Build column X positions
  const COL_ROAD_AFTER = new Set([7, 11, 15]); // road after these cols
  const COL_X = {};
  let xAcc = 0;
  const allCols = [...new Set(PLOT_LAYOUT.map(p => p[1]))].sort((a,b) => a-b);
  let prevCol = -1;
  allCols.forEach(col => {
    if (prevCol >= 0) {
      xAcc += COL_ROAD_AFTER.has(prevCol) ? ROAD_GAP + COL_GAP : COL_GAP;
    }
    COL_X[col] = xAcc;
    xAcc += U;
    prevCol = col;
  });

  const totalW = xAcc + U + 40;
  const totalH = 10 * (U + COL_GAP) + 80;

  // Filter
  const filterNum    = PM.filter.num ? parseInt(PM.filter.num) : null;
  const filterSt     = PM.filter.status || null;
  const filterClient = PM.filter.clientSearch || null;

  let html = `<div style="position:relative;width:${totalW}px;min-height:${totalH}px;padding:20px 20px 40px;">`;

  // Road strips between blocks
  COL_ROAD_AFTER.forEach(col => {
    if (COL_X[col] === undefined) return;
    const rx = COL_X[col] + U + COL_GAP/2;
    html += `<div style="position:absolute;left:${rx+20}px;top:16px;width:${ROAD_GAP-COL_GAP}px;height:${totalH-20}px;background:#c8c2b8;border-radius:4px;z-index:0">
      <div style="position:absolute;left:50%;top:0;bottom:0;width:2px;background:repeating-linear-gradient(to bottom,#f5edd8 0,#f5edd8 12px,transparent 12px,transparent 22px);transform:translateX(-50%)"></div>
    </div>`;
  });

  // Plot blocks
  PLOT_LAYOUT.forEach(([pn, col, row, ws, ds]) => {
    const pd  = plotData[pn];
    if (!pd) return;
    const cfg = PLOT_STATUS[pd.status] || PLOT_STATUS.available;

    const clientMatch = filterClient ? (pd.client_name||'').toLowerCase().includes(filterClient) : true;
    const dim = filterNum   ? (filterNum === pn ? 1 : 0.15)
              : filterSt    ? (filterSt   === pd.status ? 1 : 0.15)
              : filterClient? (clientMatch ? 1 : 0.15)
              : 1;

    const x = (COL_X[col] || 0) + 20;
    const y = row * (U + COL_GAP) + 20;
    const w = Math.round(U * (ws||1) - COL_GAP);
    const h = Math.round(U * (ds||1) * 0.55 - COL_GAP);

    // Height of the 3D block (taller = more important/booked)
    const blockH = pd.status === 'completed' ? 20
                 : pd.status === 'booked'    ? 14
                 : pd.status === 'sanction'  ? 17
                 : pd.status === 'prev'      ? 11
                 : 6;

    // CSS isometric box using pseudo-elements via inline divs
    const topC  = cfg.top3d  || cfg.bg;
    const sideC = cfg.side3d || cfg.border;
    const darkC = darkenHex(sideC, 20);

    html += `<div class="iso-plot" 
      data-pn="${pn}"
      title="Plot ${pn}"
      style="position:absolute;left:${x}px;top:${y}px;width:${w}px;cursor:pointer;opacity:${dim};transition:opacity .2s,transform .15s;"
      onmouseenter="plotHover(this,${pn},true)"
      onmouseleave="plotHover(this,${pn},false)"
      onclick="plotClick(${pn})">
      <!-- Top face -->
      <div style="position:relative;width:${w}px;height:${h}px;background:${topC};border:1.5px solid ${sideC};border-radius:3px 3px 0 0;display:flex;align-items:center;justify-content:center;z-index:3;box-shadow:inset 0 1px 2px rgba(255,255,255,.4)">
        <span style="font-size:${w>42?12:w>30?10:9}px;font-weight:700;color:${cfg.text||'#374151'};user-select:none;text-align:center;line-height:1.1">${pn}</span>
      </div>
      <!-- Front face (3D depth) -->
      <div style="width:${w}px;height:${blockH}px;background:linear-gradient(to bottom,${sideC},${darkC});border:1px solid ${darkC};border-top:none;border-radius:0 0 3px 3px;position:relative;z-index:2"></div>
    </div>`;
  });

  html += `</div>`;

  // Tooltip div
  html += `<div id="plotTooltip" style="position:fixed;display:none;background:#fff;border-radius:12px;padding:14px 18px;box-shadow:0 8px 32px rgba(0,0,0,.16);border:1px solid #e2e8f0;font-family:Outfit,sans-serif;min-width:215px;max-width:280px;z-index:9999;pointer-events:none;"></div>`;

  container.style.overflowX = 'auto';
  container.style.overflowY = 'auto';
  container.style.background = '#f0ede6';
  container.style.cursor = 'default';
  container.innerHTML = html;
}

function darkenHex(hex, pct) {
  hex = hex.replace('#','');
  if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
  const num = parseInt(hex,16);
  const r = Math.max(0, (num>>16) - pct);
  const g = Math.max(0, ((num>>8)&0xff) - pct);
  const b = Math.max(0, (num&0xff) - pct);
  return '#' + [r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}

function plotHover(el_div, pn, entering) {
  const pd = (() => {
    const bk = S.bookings.find(b => parseInt(b.plot_no) === pn);
    const pv = S.prev.find(x => parseInt(x.plot_no) === pn);
    let status = 'available';
    if (pv) status = 'prev';
    else if (bk) {
      if (bk.loan_status === 'Agreement Completed') status = 'completed';
      else if (bk.loan_status === 'Sanction Received') status = 'sanction';
      else if (bk.bank_name === 'Phase 2') status = 'phase2';
      else status = 'booked';
    }
    return { status, plot_no:pn,
      client_name: bk?.client_name || pv?.client_name || '',
      contact: bk?.contact || '',
      plot_size: bk?.plot_size || pv?.plot_size || String(PLOT_AREAS[pn]||''),
      agreement_value: bk?.agreement_value || pv?.agreement_value || '',
    };
  })();

  const tip = document.getElementById('plotTooltip');
  if (!tip) return;

  if (!entering) {
    tip.style.display = 'none';
    el_div.style.transform = '';
    return;
  }

  el_div.style.transform = 'translateY(-3px)';
  const cfg = PLOT_STATUS[pd.status] || PLOT_STATUS.available;
  const fmt = n => n ? '₹'+Number(n).toLocaleString('en-IN') : '—';
  const sqft = pd.plot_size ? (+pd.plot_size > 100 ? pd.plot_size + ' sqft' : Math.round(+pd.plot_size * 10.76) + ' sqft') : '—';

  tip.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #f1f5f9">
      <div style="width:11px;height:11px;border-radius:50%;background:${cfg.color};flex-shrink:0;box-shadow:0 0 0 2px ${cfg.border}50"></div>
      <span style="font-size:15px;font-weight:700">Plot ${pd.plot_no}</span>
      <span style="margin-left:auto;font-size:10px;padding:2px 9px;border-radius:10px;background:${cfg.bg};color:${cfg.text};font-weight:700;border:1px solid ${cfg.border}">${cfg.label}</span>
    </div>
    ${pd.client_name
      ? `<div style="margin-bottom:6px"><div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Client</div>
         <div style="font-size:13px;font-weight:600;margin-top:2px">${esc(pd.client_name)}</div>
         ${pd.contact ? `<div style="font-size:12px;color:#64748b;margin-top:1px">📞 ${esc(pd.contact)}</div>` : ''}</div>`
      : `<div style="color:#94a3b8;font-size:12px;margin-bottom:6px;font-style:italic">Available for booking</div>`}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div><div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase">Area</div><div style="font-size:13px;font-weight:700;margin-top:2px">${sqft}</div></div>
      ${pd.agreement_value ? `<div><div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase">Value</div><div style="font-size:13px;font-weight:700;margin-top:2px">${fmt(pd.agreement_value)}</div></div>` : ''}
    </div>
    <div style="margin-top:9px;font-size:10px;color:#94a3b8;text-align:center">${pd.status === 'available' ? 'Click to book this plot' : 'Click to view details'}</div>`;

  // Position tooltip near mouse — use a stored mouse position
  const rect = el_div.closest('#plot3dContainer').getBoundingClientRect();
  const elRect = el_div.getBoundingClientRect();
  let tx = elRect.left + elRect.width + 12;
  let ty = elRect.top - 10;
  if (tx + 290 > window.innerWidth) tx = elRect.left - 295;
  if (ty + 220 > window.innerHeight) ty = window.innerHeight - 230;
  tip.style.left  = tx + 'px';
  tip.style.top   = ty + 'px';
  tip.style.display = 'block';
}

function plotClick(pn) {
  const bk = S.bookings.find(b => parseInt(b.plot_no) === pn);
  const pv = S.prev.find(x => parseInt(x.plot_no) === pn);
  let status = 'available';
  if (pv) status = 'prev';
  else if (bk) {
    if (bk.loan_status === 'Agreement Completed') status = 'completed';
    else if (bk.loan_status === 'Sanction Received') status = 'sanction';
    else if (bk.bank_name === 'Phase 2') status = 'phase2';
    else status = 'booked';
  }
  // Hide tooltip
  const tip = document.getElementById('plotTooltip');
  if (tip) tip.style.display = 'none';
  openPlotDetail(pn, status, bk, pv);
}


function openPlotFilter() { openM('plotFilterModal'); }
function applyPlotFilter() {
  PM.filter.num    = (el('pf-num')?.value || '').trim();
  PM.filter.status = (el('pf-status')?.value || '').trim();
  closeM('plotFilterModal');
  renderPlotMap();
}
function resetPlotFilter() {
  PM.filter = { num:'', status:'' };
  if(el('pf-num'))    el('pf-num').value='';
  if(el('pf-status')) el('pf-status').value='';
  closeM('plotFilterModal');
  if(S.curProj) renderPlotMap();
}


// ── IMPORT SYSTEM ────────────────────────────────────────────
const IMP = { wb: null, projId: '', parsed: {}, role: '' };

function renderImportPage() {
  // Only superadmin sees all projects; admin sees only their project
  const role = S.profile?.role;
  IMP.role = role;
  const sel = el('imp-proj');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select Project —</option>';

  if (role === 'superadmin') {
    sb.from('projects').select('id,name').order('name').then(({ data }) => {
      sel.innerHTML = '<option value="">— Select Project —</option>' +
        (data||[]).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    });
  } else if (role === 'admin' && S.curProj) {
    sel.innerHTML = `<option value="${S.curProj.id}" selected>${esc(S.curProj.name)}</option>`;
  }
  resetImport();
}

function resetImport() {
  IMP.wb = null; IMP.projId = ''; IMP.parsed = {};
  const s1=el('imp-s1'), s2=el('imp-s2'), s3=el('imp-result'), pb=el('imp-progress');
  if(s1) s1.style.display='';
  if(s2) s2.style.display='none';
  if(s3) s3.style.display='none';
  if(pb) pb.style.display='none';
  const fi=el('imp-file'); if(fi) fi.value='';
  const fn=el('imp-fname'); if(fn) fn.textContent='';
  const pb2=el('imp-parse-btn'); if(pb2) pb2.disabled=true;
  const ic=el('imp-confirm'); if(ic) ic.disabled=true;
}

function onFileChange(input) {
  const file=input.files[0]; if(!file) return;
  const fn=el('imp-fname'); if(fn) fn.textContent='📊 '+file.name;
  const pb=el('imp-parse-btn'); if(pb) pb.disabled=false;
}

async function parseFile() {
  const file=el('imp-file')?.files[0];
  const projId=el('imp-proj')?.value;
  if(!file)   { toast('Select an Excel file','err'); return; }
  if(!projId) { toast('Select a project','err'); return; }
  if(typeof XLSX==='undefined') { toast('Excel library not loaded — refresh page','err'); return; }
  IMP.projId=projId;
  const pb=el('imp-parse-btn'); if(pb) pb.disabled=true;
  const fn=el('imp-fname'); if(fn) fn.textContent='⏳ Reading workbook…';
  try {
    const buf=await file.arrayBuffer();
    IMP.wb=XLSX.read(buf,{type:'array',cellDates:true,raw:false});
  } catch(e) {
    toast('Could not read file: '+e.message,'err');
    if(pb) pb.disabled=false;
    return;
  }
  IMP.parsed={};
  const sheets=IMP.wb.SheetNames;
  const bwSheet=sheets.find(s=>s.toLowerCase().includes('bwxsotr')||s.toLowerCase().includes('bw'));
  if(bwSheet) IMP.parsed.bookings=parseBWxSOTR(IMP.wb.Sheets[bwSheet]);
  const chqSheet=sheets.find(s=>s.toLowerCase().includes('cheque'));
  if(chqSheet) IMP.parsed.cheques=parseCheques(IMP.wb.Sheets[chqSheet]);
  const prevSheet=sheets.find(s=>s.toLowerCase().includes('previous')||s.toLowerCase().includes('prev team'));
  if(prevSheet) IMP.parsed.prev=parsePrevTeam(IMP.wb.Sheets[prevSheet]);
  if(pb) pb.disabled=false;
  const bkC=IMP.parsed.bookings?.length||0, chqC=IMP.parsed.cheques?.length||0, pvC=IMP.parsed.prev?.length||0;
  const total=bkC+chqC+pvC;
  if(!total){ toast('No valid data found','err'); return; }
  const sm=el('imp-summary');
  if(sm) sm.innerHTML=`
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
      ${bkC?`<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--paper);border:1px solid var(--border);border-radius:8px">
        <span style="font-size:20px">🏡</span><div style="flex:1"><div style="font-weight:600">Bookings (BWxSOTR)</div><div style="font-size:12px;color:var(--inkf)">Sheet: ${bwSheet}</div></div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:700">${bkC}</div><div style="font-size:12px;color:var(--inkf)">rows</div></div>`:'<div style="padding:10px;color:var(--rose);font-size:13px;border:1px solid var(--border);border-radius:8px">⚠️ No BWxSOTR sheet found</div>'}
      ${chqC?`<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--paper);border:1px solid var(--border);border-radius:8px">
        <span style="font-size:20px">🧾</span><div style="flex:1"><div style="font-weight:600">Cheques</div><div style="font-size:12px;color:var(--inkf)">Sheet: ${chqSheet}</div></div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:700">${chqC}</div><div style="font-size:12px;color:var(--inkf)">rows</div></div>`:''}
      ${pvC?`<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--paper);border:1px solid var(--border);border-radius:8px">
        <span style="font-size:20px">📁</span><div style="flex:1"><div style="font-weight:600">Previous Team</div><div style="font-size:12px;color:var(--inkf)">Sheet: ${prevSheet}</div></div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:700">${pvC}</div><div style="font-size:12px;color:var(--inkf)">rows</div></div>`:''}
    </div>
    <div style="padding:12px 16px;background:var(--goldl);border:1px solid var(--goldb);border-radius:8px">
      <strong>Total: ${total} records</strong> — duplicates will be skipped automatically
    </div>`;
  const tot=el('imp-total'); if(tot) tot.textContent=total;
  const ic=el('imp-confirm'); if(ic) ic.disabled=false;
  const s1=el('imp-s1'), s2=el('imp-s2');
  if(s1) s1.style.display='none';
  if(s2) s2.style.display='';
}

// ── SHEET PARSERS ─────────────────────────────────────────────
function sheetToRows(ws){ return XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false}); }
function cellVal(row,idx){ const v=row[idx]; if(v===undefined||v===null) return ''; return String(v).replace(/[\u202a\u202c]/g,'').replace(/\u00a0/g,' ').trim(); }
function cellNum(row,idx){ const v=cellVal(row,idx); if(!v||v==='nan') return null; const n=parseFloat(v.replace(/[₹,\s]/g,'')); return isNaN(n)?null:n; }
function cellDate(row,idx){
  const v=cellVal(row,idx); if(!v||v==='nan'||v==='NaT') return null;
  if(/^\d{4}-\d{2}-\d{2}/.test(v)) return v.substring(0,10);
  const m=v.match(/^(\d{1,2})[.\\/\-](\d{1,2})[.\\/\-](\d{2,4})$/);
  if(m){ const d=m[1].padStart(2,'0'),mo=m[2].padStart(2,'0'),y=m[3].length===2?'20'+m[3]:m[3]; if(parseInt(mo)>12||parseInt(d)>31) return null; return `${y}-${mo}-${d}`; }
  const n=parseFloat(v); if(!isNaN(n)&&n>40000&&n<60000) return new Date(Math.round((n-25569)*86400000)).toISOString().substring(0,10);
  return null;
}
function normBank(v){ if(!v) return ''; const vl=v.toLowerCase(); if(vl.includes('axis')) return 'Axis'; if(vl.includes('hdfc')) return 'HDFC'; if(vl.includes('idbi')) return 'IDBI'; if(vl.includes('icici')) return 'ICICI'; if(vl.includes('sbi')) return 'SBI'; if(vl.includes('tata')) return 'Tata Capital'; if(vl==='self'||vl==='...'||vl==='---') return 'Self'; if(vl.includes('phase 2')) return 'Phase 2'; return v.trim(); }

function parseBWxSOTR(ws){
  const allRows=sheetToRows(ws);
  const rows=allRows.slice(2).filter(r=>{ const n=cellVal(r,2); return n&&n!=='nan'&&n.trim()!==''; });
  return rows.map(r=>{
    const agreeRaw=cellVal(r,18), disbRaw=cellVal(r,34);
    const agreeL=agreeRaw.toLowerCase().trim(), disbL=disbRaw.toLowerCase().trim().replace(/[^a-z]/g,'');
    const isDone=agreeL==='done'||disbL==='done';
    return {
      serial_no:cellNum(r,0)?parseInt(cellVal(r,0)):null, booking_date:cellDate(r,1),
      client_name:cellVal(r,2), contact:cellVal(r,3), plot_no:cellVal(r,4),
      plot_size:cellNum(r,5), basic_rate:cellNum(r,6), infra:cellNum(r,7)??100,
      agreement_value:cellNum(r,10), sdr:cellNum(r,11), sdr_minus:cellNum(r,12)??0,
      maintenance:cellNum(r,13)??0, legal_charges:cellNum(r,14)??25000,
      bank_name:normBank(cellVal(r,21)), banker_contact:cellVal(r,33),
      loan_status:isDone?'Agreement Completed':normLoanStatus(agreeRaw),
      sanction_received:cellVal(r,30).toLowerCase().startsWith('y')?'Yes':null,
      sanction_date:cellDate(r,31), sanction_letter:cellVal(r,32)||null,
      sdr_received:cellNum(r,28), sdr_received_date:cellDate(r,29),
      disbursement_status:isDone?'done':null, disbursement_date:cellDate(r,35),
      disbursement_remark:(!isDone&&disbRaw&&disbL!=='')?disbRaw:'',
      doc_submitted:cellVal(r,37), remark:cellVal(r,36),
    };
  }).filter(r=>r.client_name);
}

function parseCheques(ws){
  const rows=sheetToRows(ws).slice(1);
  const result=[]; let lastName='', lastPlot='';
  rows.forEach(r=>{
    const name=cellVal(r,0), plot=cellVal(r,1), bank=cellVal(r,2), chqno=cellVal(r,3), date=cellVal(r,4), amtRaw=cellVal(r,5), remark=cellVal(r,6);
    if(name&&name!=='nan'){ lastName=name; if(plot&&!['infra chrg','infra charge'].includes(plot.toLowerCase())&&plot!=='nan') lastPlot=plot; }
    const amount=parseFloat(amtRaw.replace(/[₹,\s]/g,''))||0;
    const entryType=normEntry(remark);
    if(entryType==='NILL'&&!bank&&!date) return;
    if(amount<=0||!lastName) return;
    let chequeDate=null;
    if(date&&!['cash recv','rtgs done','nan',''].includes(date.toLowerCase())){
      const dm=date.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
      if(dm){ const y=dm[3].length===2?'20'+dm[3]:dm[3]; chequeDate=`${y}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`; }
    }
    result.push({cust_name:lastName,plot_no:lastPlot,bank_detail:bank,cheque_no:chqno,cheque_date:chequeDate,amount,entry_type:entryType});
  });
  return result;
}

function parsePrevTeam(ws){
  return sheetToRows(ws).slice(1)
    .filter(r=>cellVal(r,0)&&cellVal(r,0)!=='nan')
    .map(r=>({client_name:cellVal(r,0),plot_no:cellVal(r,1),plot_size:cellNum(r,2),agreement_value:cellNum(r,3),notes:''}));
}

// ── DEDUPLICATION LOGIC ───────────────────────────────────────
async function dedupeBookings(rows, projId) {
  const { data: existing } = await sb.from('bookings').select('plot_no').eq('project_id', projId);
  const existingPlots = new Set((existing||[]).map(b => String(b.plot_no).trim()));
  const fresh = rows.filter(r => !existingPlots.has(String(r.plot_no).trim()));
  console.log(`Bookings: ${rows.length} total, ${rows.length - fresh.length} duplicates skipped, ${fresh.length} to import`);
  return fresh;
}

async function dedupeCheques(rows, projId) {
  const { data: existing } = await sb.from('cheques').select('cheque_no,cust_name,amount').eq('project_id', projId);
  const existingKeys = new Set((existing||[]).map(c => `${c.cheque_no}|${c.cust_name}|${c.amount}`));
  const fresh = rows.filter(r => !existingKeys.has(`${r.cheque_no}|${r.cust_name}|${r.amount}`));
  console.log(`Cheques: ${rows.length} total, ${rows.length - fresh.length} duplicates skipped, ${fresh.length} to import`);
  return fresh;
}

async function dedupePrev(rows, projId) {
  const { data: existing } = await sb.from('prev_bookings').select('plot_no,client_name').eq('project_id', projId);
  const existingKeys = new Set((existing||[]).map(p => `${p.plot_no}|${p.client_name}`));
  const fresh = rows.filter(r => !existingKeys.has(`${r.plot_no}|${r.client_name}`));
  return fresh;
}

async function runImport() {
  const projId=IMP.projId; if(!projId) return;
  const ic=el('imp-confirm'); if(ic) ic.disabled=true;
  const pb=el('imp-progress'), pt=el('imp-prog-text'), pbar=el('imp-prog-bar');
  if(pb) pb.style.display='';
  const s2=el('imp-s2'); if(s2) s2.style.display='none';

  let imported=0, skipped=0, errors=0;
  const setProgress=(pct,msg)=>{ if(pbar) pbar.style.width=Math.min(pct,98)+'%'; if(pt) pt.textContent=msg; };

  try {
    // Dedup before insert
    setProgress(10,'Checking for existing data…');
    const bkRows  = IMP.parsed.bookings?.length ? await dedupeBookings(IMP.parsed.bookings, projId) : [];
    const chqRows = IMP.parsed.cheques?.length  ? await dedupeCheques(IMP.parsed.cheques, projId)  : [];
    const pvRows  = IMP.parsed.prev?.length     ? await dedupePrev(IMP.parsed.prev, projId)        : [];

    skipped = (IMP.parsed.bookings?.length||0) - bkRows.length
            + (IMP.parsed.cheques?.length||0)  - chqRows.length
            + (IMP.parsed.prev?.length||0)     - pvRows.length;

    const tasks=[
      {table:'bookings',     rows:bkRows,  label:'Bookings'},
      {table:'cheques',      rows:chqRows, label:'Cheques'},
      {table:'prev_bookings',rows:pvRows,  label:'Prev Team'},
    ];
    let taskIdx=0;
    for(const task of tasks){
      taskIdx++;
      if(!task.rows.length){ continue; }
      setProgress(10+taskIdx*25, `Importing ${task.label} (${task.rows.length} rows)…`);
      const CHUNK=50;
      for(let i=0;i<task.rows.length;i+=CHUNK){
        const chunk=task.rows.slice(i,i+CHUNK).map(r=>({...r,project_id:projId}));
        const {error}=await sb.from(task.table).insert(chunk);
        if(error){ errors+=chunk.length; console.error(task.table,error.message); }
        else imported+=chunk.length;
      }
    }
  } catch(e) {
    errors++; console.error('Import error:',e.message);
  }

  if(pbar) pbar.style.width='100%';
  await new Promise(r=>setTimeout(r,300));
  if(ic) ic.disabled=false;
  if(pb) pb.style.display='none';
  const res=el('imp-result'); if(res) res.style.display='';
  const ok=el('imp-ok'); if(ok) ok.textContent=imported;
  const sk=el('imp-skip'); if(sk) sk.textContent=skipped;
  const er=el('imp-err'); if(er) er.textContent=errors;
  if(imported>0&&S.curProj?.id===projId) await loadProjData();
  if(imported>0) await logAudit('import','workbook',null,`${imported} records imported, ${skipped} duplicates skipped`,'import');
  toast(imported>0?`✓ ${imported} imported, ${skipped} skipped`:'Nothing new to import', imported>0?'ok':'inf');
}
function openPlotDetail(plotNo, status, bk, pv) {
  const cfg = PLOT_STATUS[status] || PLOT_STATUS.available;
  el('pdTitle').textContent = 'Plot ' + plotNo;
  el('pdSub').innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 12px;border-radius:12px;background:${cfg.bg};border:1px solid ${cfg.border};color:${cfg.text};font-size:12px;font-weight:600">
    <span style="width:8px;height:8px;border-radius:50%;background:${cfg.color}"></span>${cfg.label}</span>`;
  const fmt = n => n ? '₹'+Number(n).toLocaleString('en-IN') : '—';
  const sqft = v => v ? (+v>100 ? v+' sqft' : Math.round(+v*10.76)+' sqft') : '—';

  if (status === 'available') {
    el('pdBody').innerHTML = `<div style="text-align:center;padding:28px 0">
      <div style="font-size:44px;margin-bottom:12px">✅</div>
      <div style="font-size:18px;font-weight:700;color:var(--sage);margin-bottom:6px">Available for Booking</div>
      <div style="font-size:13px;color:var(--inkf)">This plot has not been booked yet</div></div>`;
    el('pdFoot').innerHTML = `
      <button class="btn btn-outline" onclick="closeM('plotDetailModal')">Close</button>
      <button class="btn btn-gold" onclick="closeM('plotDetailModal');openBkModal({plot_no:'${plotNo}'})">＋ Book This Plot</button>`;
  } else {
    const data  = bk || pv;
    const isPrev = !bk && !!pv;
    const rows = [
      ['Client Name',   esc(data?.client_name || '—')],
      ['Plot Size',     sqft(data?.plot_size)],
      ['Agreement Value', fmt(data?.agreement_value)],
    ];
    if (!isPrev) rows.push(
      ['Basic Rate',     data?.basic_rate ? '₹'+data.basic_rate+'/sqft' : '—'],
      ['Bank',           data?.bank_name || '—'],
      ['Loan Status',    data?.loan_status || '—'],
      ['Sanction',       data?.sanction_received || '—'],
      ['Disbursement',   data?.disbursement_status === 'done' ? '✓ Done' : 'Pending'],
      ['Contact',        esc(data?.contact || '—')],
      ['Banker Contact', esc(data?.banker_contact || '—')],
    );
    if (!isPrev && data?.remark) rows.push(['Remark', esc(data.remark)]);
    el('pdBody').innerHTML = rows.map(([l,v]) =>
      `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--border)">
        <div style="font-size:12px;color:var(--inkf);font-weight:500;flex-shrink:0;margin-right:12px">${l}</div>
        <div style="font-size:13px;font-weight:600;text-align:right;max-width:60%">${v}</div></div>`).join('');
    // Block re-booking — only allow editing, not new booking
    const isBooked = ['booked','sanction','completed','prev','phase2'].includes(status);
    el('pdFoot').innerHTML = `
      <button class="btn btn-outline" onclick="closeM('plotDetailModal')">Close</button>
      ${bk ? `<button class="btn btn-gold" onclick="closeM('plotDetailModal');editBk('${bk.id}')">✏ Edit Booking</button>` : ''}
      ${isBooked && !bk ? `<div style="font-size:12px;color:var(--rose);padding:4px 0">This plot is already ${cfg.label}</div>` : ''}`;
  }
  openM('plotDetailModal');
}


