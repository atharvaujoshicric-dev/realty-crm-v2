/* ================================================================
   RealtyFlow CRM v2 — app.js
   Full Supabase integration · Charts · Custom Fields · Export
   ================================================================ */

'use strict';

// ── SUPABASE CLIENT ───────────────────────────────────────────
// Credentials are hardcoded so all users connect automatically
const SUPABASE_URL = 'https://pwofvcxritpiauqbdkty.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3b2Z2Y3hyaXRwaWF1cWJka3R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzMyODgsImV4cCI6MjA4OTQwOTI4OH0.Qc5QREC1yFwQq0NWTGotDRPUkiqAn38OpmkC-M7pvR0';

let sb = null;
function initSB() {
  const url = SUPABASE_URL;
  const key = SUPABASE_KEY;
  if (!url || !key) return false;
  sb = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  return true;
}

// ── STATE ─────────────────────────────────────────────────────
const S = {
  user: null, profile: null,
  projects: [], curProj: null,
  bookings: [], cheques: [], prev: [],
  customFields: [],
  allUsers: [],
  charts: {},          // chart instances keyed by canvas id
  editBkId: null, editChqId: null, editProjId: null,
};

// ── BOOT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // Always hide the global loader first so login screen is interactive
  if (!initSB()) {
    showLoader(false);
    showCfgBanner();
    return;
  }

  // Supabase is configured — check for existing session
  const { data: { session } } = await sb.auth.getSession().catch(() => ({ data:{ session:null } }));
  if (session) {
    await boot(session.user);
  } else {
    showLoader(false);
  }

  sb.auth.onAuthStateChange(async (ev, sess) => {
    if (ev === 'SIGNED_IN'  && sess) await boot(sess.user);
    if (ev === 'SIGNED_OUT')          showLoginScreen();
  });
});

async function boot(authUser) {
  showLoader(true);
  const { data: prof, error } = await sb.from('profiles').select('*').eq('id', authUser.id).single();
  if (error || !prof) { showLoader(false); showErr('Profile not found. Contact admin.'); return; }

  S.user = authUser; S.profile = prof;
  el('uc-name').textContent = shortName(prof.full_name);
  el('uc-avatar').textContent = prof.full_name.charAt(0).toUpperCase();
  el('loginScreen').style.display = 'none';
  el('app').classList.add('on');

  if (prof.role === 'superadmin') {
    buildNav('superadmin');
    await renderSAProjects();
    goPage('p-sa-projects');
  } else {
    await loadMyProjects();
    buildNav(prof.role);
    if (S.projects.length > 1) el('projSwitcher').style.display = 'flex';
    if (S.curProj) {
      await loadProjData();
      renderDash();
      goPage('p-dash');
    } else { showErr('No projects assigned. Contact admin.'); }
  }
  showLoader(false);
}

async function loadMyProjects() {
  const { data } = await sb.from('project_members')
    .select('role, projects(*)')
    .eq('user_id', S.profile.id);
  S.projects = (data || []).map(m => ({ ...m.projects, myRole: m.role }));
  if (S.projects.length) S.curProj = S.projects[0];
}

async function loadProjData() {
  if (!S.curProj) return;
  const pid = S.curProj.id;
  const [b, c, p, cf] = await Promise.all([
    sb.from('bookings').select('*').eq('project_id', pid).order('serial_no', { nullsLast: true }).order('created_at'),
    sb.from('cheques').select('*').eq('project_id', pid).order('cheque_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }),
    sb.from('prev_bookings').select('*').eq('project_id', pid).order('created_at'),
    sb.from('custom_fields').select('*').eq('project_id', pid).order('sort_order'),
  ]);
  S.bookings = b.data || [];
  S.cheques  = c.data || [];
  S.prev     = p.data || [];
  S.customFields = cf.data || [];
}

// ── LOGIN ─────────────────────────────────────────────────────
async function doLogin() {
  if (!sb) {
    openCfg();
    toast('Please connect Supabase first', 'err');
    return;
  }
  const email = v('li-email').trim(), pass = v('li-pass');
  if (!email || !pass) { showErr('Email and password required'); return; }
  setBtn('loginBtn', true);
  hideErr();
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  setBtn('loginBtn', false);
  if (error) showErr(error.message);
}
function doLogout() { sb?.auth.signOut(); }

function showLoginScreen() {
  S.user = null; S.profile = null; S.curProj = null;
  el('loginScreen').style.display = 'flex';
  el('app').classList.remove('on');
  el('navTabs').innerHTML = '';
}

// ── NAV ───────────────────────────────────────────────────────
const TABS = {
  superadmin: [
    { id:'p-sa-projects', i:'🏗', l:'Projects' },
    { id:'p-sa-users',    i:'👥', l:'Users' },
  ],
  admin: [
    { id:'p-dash',      i:'📊', l:'Dashboard' },
    { id:'p-bookings',  i:'🏡', l:'Bookings' },
    { id:'p-pipeline',  i:'🔄', l:'Pipeline' },
    { id:'p-cheques',   i:'🧾', l:'Cheques' },
    { id:'p-prev',      i:'📁', l:'Prev Team' },
    { id:'p-analytics', i:'📈', l:'Analytics' },
    { id:'p-settings',  i:'⚙️', l:'Settings' },
  ],
  sales: [
    { id:'p-dash',      i:'📊', l:'Dashboard' },
    { id:'p-bookings',  i:'🏡', l:'Bookings' },
    { id:'p-pipeline',  i:'🔄', l:'Pipeline' },
    { id:'p-cheques',   i:'🧾', l:'Cheques' },
    { id:'p-analytics', i:'📈', l:'Analytics' },
  ],
};

function buildNav(role) {
  const tabs = TABS[role] || TABS.sales;
  const c = el('navTabs');
  c.innerHTML = '';
  tabs.forEach(t => {
    const d = mk('div', 'nav-tab');
    d.dataset.page = t.id;
    d.innerHTML = `<span class="ti">${t.i}</span>${t.l}`;
    d.onclick = () => navigate(t.id);
    c.appendChild(d);
  });
  const canEdit = role !== 'sales';
  ['newBkBtn','newChqBtn','dashNewBk','prevNewBtn'].forEach(id => {
    const b = el(id); if (b) b.style.display = canEdit ? '' : 'none';
  });
}

async function navigate(pageId) {
  goPage(pageId);
  const reloadPages = { 'p-dash': renderDash, 'p-bookings': renderBookings,
    'p-pipeline': renderPipeline, 'p-cheques': renderCheques,
    'p-prev': renderPrev, 'p-analytics': renderAnalytics,
    'p-settings': renderSettings, 'p-sa-projects': renderSAProjects, 'p-sa-users': renderSAUsers };
  if (pageId !== 'p-sa-projects' && pageId !== 'p-sa-users' && S.curProj) await loadProjData();
  reloadPages[pageId]?.();
}

function goPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  el(id)?.classList.add('active');
  document.querySelector(`[data-page="${id}"]`)?.classList.add('active');
}

function updateProjHeader() {
  const p = S.curProj; if (!p) return;
  el('ps-name').textContent  = p.name;
  el('ps-role').textContent  = S.profile?.role || '';
  el('dash-title').textContent = p.name;
  el('dash-sub').textContent   = `${p.location||''} · ${S.bookings.length} bookings`;
}

async function openSwitcher() {
  const list = el('switcherList');
  list.innerHTML = '';
  S.projects.forEach(p => {
    const row = mk('div');
    row.style.cssText = 'padding:13px 20px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:11px;transition:background .2s;';
    row.innerHTML = `<div style="width:34px;height:34px;border-radius:8px;background:var(--ink);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;">🏘</div>
      <div><div style="font-weight:600;font-size:13px;">${p.name}</div><div style="font-size:11px;color:var(--ink-faint);">${p.location||''}</div></div>`;
    if (S.curProj?.id === p.id) row.style.background = 'var(--gold-lt)';
    row.onclick = async () => {
      S.curProj = p; closeM('switcherM');
      await loadProjData(); updateProjHeader(); renderDash(); goPage('p-dash');
    };
    list.appendChild(row);
  });
  openM('switcherM');
}

// ── SA: PROJECTS ──────────────────────────────────────────────
async function renderSAProjects() {
  const grid = el('saGrid');
  grid.innerHTML = `<div class="loading-cell"><div class="spin spin-ink"></div> Loading…</div>`;

  const { data: projs } = await sb.from('projects').select('*').order('created_at');
  const { data: cnts  } = await sb.from('bookings').select('project_id');
  const cntMap = {};
  (cnts||[]).forEach(b => { cntMap[b.project_id] = (cntMap[b.project_id]||0)+1; });

  if (!projs?.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="ei">🏗</div><h3>No projects yet</h3><p>Create your first real estate project</p></div>`;
    return;
  }
  grid.innerHTML = '';
  projs.forEach((p, i) => {
    const bk = cntMap[p.id]||0;
    const d = mk('div','proj-card');
    d.innerHTML = `
      <div class="proj-hero sw${(p.swatch??i)%5}"><span style="font-size:38px;opacity:.55;z-index:1;position:relative;">🏘</span>
        <div style="position:absolute;top:9px;right:11px;z-index:2;"><span class="badge b-gold">${bk} bookings</span></div>
      </div>
      <div class="proj-body">
        <div class="proj-name">${p.name}</div>
        <div class="proj-loc">📍 ${p.location||'—'}</div>
        <div class="proj-stats">
          <div class="pst"><div class="v">${bk}</div><div class="l">Bookings</div></div>
          <div class="pst"><div class="v">${p.total_plots||'—'}</div><div class="l">Plots</div></div>
          <div class="pst"><div class="v">${p.rera?'✓':'—'}</div><div class="l">RERA</div></div>
        </div>
      </div>
      <div class="proj-foot">
        <span class="badge b-gray" style="font-size:11px;">${p.developer||'No developer'}</span>
        <div style="display:flex;gap:7px;">
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();editProj('${p.id}')">✏️ Edit</button>
          <button class="btn btn-gold btn-sm" onclick="event.stopPropagation();viewProjAsAdmin('${p.id}')">Open →</button>
        </div>
      </div>`;
    grid.appendChild(d);
  });
}

async function viewProjAsAdmin(pid) {
  const { data: p } = await sb.from('projects').select('*').eq('id', pid).single();
  if (!p) return;
  S.curProj = p;
  buildNav('admin');
  el('projSwitcher').style.display = 'flex';
  await loadProjData(); updateProjHeader(); renderDash(); goPage('p-dash');
  toast(`Viewing: ${p.name}`, 'inf');
}

// ── SA: USERS ─────────────────────────────────────────────────
async function renderSAUsers() {
  const list = el('saUsersList');
  list.innerHTML = `<div class="loading-cell"><div class="spin spin-ink"></div></div>`;
  const { data, error } = await sb.rpc('list_all_users');
  if (error) { list.innerHTML = `<div class="empty"><p style="color:var(--rose);">${error.message}</p></div>`; return; }
  list.innerHTML = '';
  (data||[]).forEach(u => {
    const pnames = (u.project_names||[]).filter(Boolean);
    const row = mk('div','u-row');
    row.innerHTML = `
      <div class="avatar">${u.full_name.charAt(0)}</div>
      <div><div class="ui-n">${u.full_name}</div><div class="ui-e">${u.email}</div></div>
      <div class="u-tags">${pnames.map(n=>`<span class="u-tag">${n}</span>`).join('')}</div>
      <span class="role-pill ${rpClass(u.role)}">${u.role}</span>
      ${u.role!=='superadmin'?`<button class="btn btn-ghost btn-sm" style="color:var(--rose);margin-left:6px;" onclick="removeUser('${u.id}')">Remove</button>`:''}`;
    list.appendChild(row);
  });
}

// ── PROJECT MODAL ─────────────────────────────────────────────
function openProjModal() {
  S.editProjId = null;
  el('pm-title').textContent = 'New Project';
  el('pm-savebtn').textContent = '🏗 Create Project';
  clearFields(['pm-name','pm-loc','pm-dev','pm-rera','pm-aname','pm-amail','pm-apass','pm-sname','pm-smail','pm-spass']);
  setField('pm-plots',100); setField('pm-infra',100); setField('pm-legal',25000); setField('pm-sdr',6); setField('pm-maint',0);
  openM('projM');
}

async function editProj(pid) {
  const { data:p } = await sb.from('projects').select('*').eq('id',pid).single();
  if (!p) return;
  S.editProjId = pid;
  el('pm-title').textContent = 'Edit Project';
  el('pm-savebtn').textContent = '💾 Save Changes';
  setField('pm-name',p.name); setField('pm-loc',p.location||''); setField('pm-dev',p.developer||'');
  setField('pm-rera',p.rera||''); setField('pm-plots',p.total_plots||100);
  setField('pm-infra',p.infra_rate||100); setField('pm-legal',p.legal_charges||25000);
  setField('pm-sdr',p.sdr_rate||6); setField('pm-maint',p.maintenance||0);
  openM('projM');
}

async function saveProj() {
  const name = v('pm-name').trim();
  if (!name) { toast('Project name required','err'); return; }
  const data = {
    name, location:v('pm-loc'), developer:v('pm-dev'), rera:v('pm-rera'),
    total_plots: int('pm-plots'), launch_date: v('pm-launch')||null,
    infra_rate: num('pm-infra'), legal_charges: num('pm-legal'),
    sdr_rate: num('pm-sdr'), maintenance: num('pm-maint'),
  };
  setBtn('pm-savebtn', true);

  if (S.editProjId) {
    const { error } = await sb.from('projects').update(data).eq('id', S.editProjId);
    setBtn('pm-savebtn', false);
    if (error) { toast(error.message,'err'); return; }
    toast('Project updated!');
  } else {
    const aname = v('pm-aname').trim(), amail = v('pm-amail').trim(), apass = v('pm-apass').trim();
    if (!aname||!amail||!apass) { setBtn('pm-savebtn',false); toast('Admin details required','err'); return; }
    data.swatch = ((await sb.from('projects').select('id')).data?.length||0) % 5;
    const { data:proj, error:pe } = await sb.from('projects').insert(data).select().single();
    if (pe) { setBtn('pm-savebtn',false); toast(pe.message,'err'); return; }

    const { data:aId, error:ae } = await sb.rpc('create_crm_user',{p_email:amail,p_password:apass,p_name:aname,p_role:'admin'});
    if (ae) { setBtn('pm-savebtn',false); toast(ae.message,'err'); return; }
    await sb.rpc('assign_to_project',{p_user_id:aId,p_project_id:proj.id,p_role:'admin'});

    const sname = v('pm-sname').trim(), smail = v('pm-smail').trim(), spass = v('pm-spass').trim();
    if (smail && spass && sname) {
      const { data:sId } = await sb.rpc('create_crm_user',{p_email:smail,p_password:spass,p_name:sname,p_role:'sales'});
      if (sId) await sb.rpc('assign_to_project',{p_user_id:sId,p_project_id:proj.id,p_role:'sales'});
    }
    setBtn('pm-savebtn',false);
    toast('Project created & users provisioned!');
  }
  closeM('projM');
  await renderSAProjects();
}

// ── USER MODAL ────────────────────────────────────────────────
async function openUserModal(forCurProj) {
  clearFields(['um-name','um-email','um-pass']);
  el('um-role').value = 'admin';
  const psel = el('um-proj'), pgrp = el('um-proj-grp');
  if (S.profile?.role === 'superadmin' && !forCurProj) {
    const { data:ps } = await sb.from('projects').select('id,name').order('name');
    psel.innerHTML = (ps||[]).map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
    pgrp.style.display = '';
  } else {
    psel.innerHTML = `<option value="${S.curProj?.id}">${S.curProj?.name}</option>`;
    pgrp.style.display = S.curProj?'':'none';
  }
  openM('userM');
}

async function saveUser() {
  const name=v('um-name').trim(),email=v('um-email').trim(),pass=v('um-pass').trim(),role=el('um-role').value,projId=el('um-proj').value;
  if (!name||!email||!pass) { toast('All fields required','err'); return; }
  if (pass.length<8) { toast('Password min 8 characters','err'); return; }
  setBtn('um-savebtn',true);

  // Use Supabase Auth Admin API via edge function workaround
  // First sign up the user
  const { data: signupData, error: signupErr } = await sb.auth.admin
    ? await sb.auth.admin.createUser({ email, password: pass, email_confirm: true, user_metadata: { full_name: name } })
    : { data: null, error: { message: 'Admin API not available' } };

  let uid = signupData?.user?.id;

  // Fallback: use our SQL function
  if (!uid) {
    const { data: rpcId, error: rpcErr } = await sb.rpc('create_crm_user', {
      p_email: email, p_password: pass, p_name: name, p_role: role
    });
    if (rpcErr) { setBtn('um-savebtn',false); toast(rpcErr.message,'err'); return; }
    uid = rpcId;
  } else {
    // Insert profile manually
    const { error: profErr } = await sb.from('profiles').insert({ id: uid, full_name: name, role });
    if (profErr) { setBtn('um-savebtn',false); toast(profErr.message,'err'); return; }
  }

  if (projId && uid) await sb.rpc('assign_to_project',{p_user_id:uid,p_project_id:projId,p_role:role});
  setBtn('um-savebtn',false);
  closeM('userM');
  if (S.profile?.role==='superadmin') await renderSAUsers(); else renderSettings();
  toast('User created! They can now log in.');
}

async function removeUser(uid) {
  if (!confirm('Remove this user from the platform?')) return;
  await sb.from('profiles').delete().eq('id',uid);
  if (S.profile?.role==='superadmin') await renderSAUsers(); else renderSettings();
  toast('User removed','err');
}

// ── DASHBOARD ─────────────────────────────────────────────────
function renderDash() {
  const bk = S.bookings;
  updateProjHeader();
  const totalVal = sum(bk,'agreement_value');
  const disb = bk.filter(b=>b.disbursement_status==='done').length;
  const sanc = bk.filter(b=>b.sanction_received==='Yes').length;
  const pend = bk.filter(b=>b.loan_status!=='Cancelled'&&b.disbursement_status!=='done'&&b.sanction_received!=='Yes').length;

  el('dash-stats').innerHTML = `
    ${sc('sc-gold','🏡',bk.length,'Total Bookings','Active agreements')}
    ${sc('sc-teal','💰','₹'+fmt_cr(totalVal),'Total Value','Agreement value')}
    ${sc('sc-sky','✅',disb,'Disbursed','Loans completed')}
    ${sc('sc-rose','⏳',pend,'Pending Files','Awaiting action')}`;

  const tbody = el('dash-recent');
  tbody.innerHTML = [...bk].reverse().slice(0,7).map(b=>`<tr>
    <td class="td-link" onclick="viewBk('${b.id}')">${b.client_name}</td>
    <td>Plot ${b.plot_no}</td>
    <td style="font-weight:700;">₹${fmt_l(b.agreement_value)}</td>
    <td>${b.bank_name||'—'}</td>
    <td>${statusBadge(b.loan_status)}</td>
  </tr>`).join('');

  const bankMap = groupCount(bk,'bank_name');
  el('dash-bank').innerHTML = Object.entries(bankMap).sort((a,b)=>b[1]-a[1]).map(([bank,cnt])=>{
    const pct = bk.length? Math.round(cnt/bk.length*100):0;
    return `<div style="margin-bottom:11px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;"><span style="font-weight:600;">${bank||'—'}</span><span style="color:var(--ink-faint);">${cnt} (${pct}%)</span></div>
      <div style="height:5px;background:var(--paper-2);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:var(--gold);border-radius:3px;transition:width .6s;"></div></div>
    </div>`;
  }).join('');

  const done=disb, pndD=bk.filter(b=>b.disbursement_status!=='done'&&b.loan_status!=='Cancelled').length, canc=bk.filter(b=>b.loan_status==='Cancelled').length;
  el('dash-disb').innerHTML = triplet([
    {v:done, l:'Done', bg:'var(--sage-lt)', c:'var(--sage)'},
    {v:pndD, l:'Pending', bg:'var(--gold-lt)', c:'var(--gold)'},
    {v:canc, l:'Cancelled', bg:'var(--rose-lt)', c:'var(--rose)'}
  ]);

  const selfC=bk.filter(b=>b.bank_name==='Self').length;
  const bankC=bk.filter(b=>b.bank_name!=='Self'&&b.bank_name!=='Phase 2').length;
  const pct2=bk.length?Math.round(bankC/bk.length*100):0;
  el('dash-fin').innerHTML = `
    <div style="margin-bottom:13px;"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px;"><span>🏦 Bank Financed</span><span style="font-weight:600;">${bankC} · ${pct2}%</span></div><div style="height:7px;background:var(--paper-2);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${pct2}%;background:var(--ink);border-radius:4px;transition:width .6s;"></div></div></div>
    <div><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px;"><span>💵 Self Funded</span><span style="font-weight:600;">${selfC} · ${100-pct2}%</span></div><div style="height:7px;background:var(--paper-2);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${100-pct2}%;background:var(--gold);border-radius:4px;transition:width .6s;"></div></div></div>`;
}

// ── BOOKINGS ──────────────────────────────────────────────────
function renderBookings() {
  let d = [...S.bookings];
  const srch=v('bk-srch').toLowerCase(), bank=v('bk-bank'), sts=v('bk-sts'), dis=v('bk-dis');
  if (srch) d=d.filter(b=>b.client_name.toLowerCase().includes(srch)||String(b.plot_no).includes(srch)||(b.contact||'').includes(srch));
  if (bank) d=d.filter(b=>(b.bank_name||'').toLowerCase()===bank.toLowerCase());
  if (sts)  d=d.filter(b=>b.loan_status===sts);
  if (dis==='Done')    d=d.filter(b=>b.disbursement_status==='done');
  if (dis==='Pending') d=d.filter(b=>b.disbursement_status!=='done');
  el('bk-cnt').textContent = `${d.length} of ${S.bookings.length}`;

  const cf = S.customFields.filter(f=>f.applies_to==='booking');
  const canEdit = S.profile?.role !== 'sales';
  const canDel  = S.profile?.role === 'admin' || S.profile?.role === 'superadmin';

  // Build table headers including custom fields
  el('bk-thead').innerHTML = `<tr>
    <th>#</th><th>Date</th><th>Client</th><th>Contact</th><th>Plot</th>
    <th>Area</th><th>Rate</th><th>Agr. Value</th><th>SDR</th>
    <th>Bank</th><th>Sanction</th><th>Disbursement</th><th>Status</th>
    ${cf.map(f=>`<th>${escH(f.field_label)}</th>`).join('')}
    <th>Actions</th>
  </tr>`;

  const tbody = el('bk-tbody');
  if (!d.length) { tbody.innerHTML=`<tr><td colspan="${14+cf.length}"><div class="empty"><div class="ei">🔍</div><h3>No bookings found</h3><p>Try adjusting filters</p></div></td></tr>`; return; }
  tbody.innerHTML = d.map((b,i) => `<tr>
    <td class="td-dim">${b.serial_no||i+1}</td>
    <td class="td-dim">${b.booking_date||'—'}</td>
    <td class="td-link td-name" onclick="viewBk('${b.id}')">${escH(b.client_name)}</td>
    <td class="td-mono">${b.contact||'—'}</td>
    <td><strong>Plot ${b.plot_no}</strong></td>
    <td class="td-dim">${num_fmt(b.plot_size)}</td>
    <td class="td-dim">₹${b.basic_rate||0}</td>
    <td style="font-weight:700;">₹${num_fmt(b.agreement_value)}</td>
    <td class="td-dim">₹${num_fmt(b.sdr)}</td>
    <td>${escH(b.bank_name||'—')}</td>
    <td>${b.sanction_received?`<span class="badge b-green">${escH(b.sanction_received)}</span>`:'<span class="badge b-gray">—</span>'}</td>
    <td>${b.disbursement_status==='done'?'<span class="badge b-teal">✓ Done</span>':'<span class="badge b-gray">Pending</span>'}</td>
    <td>${statusBadge(b.loan_status)}</td>
    ${cf.map(f=>`<td class="td-dim">${escH(String((b.custom_data||{})[f.field_name]||'—'))}</td>`).join('')}
    <td><div style="display:flex;gap:4px;">
      ${canEdit?`<button class="btn btn-ghost btn-sm btn-icon" onclick="editBk('${b.id}')" title="Edit">✏️</button>`:''}
      ${canDel?`<button class="btn btn-ghost btn-sm btn-icon" onclick="delBk('${b.id}')" title="Delete" style="color:var(--rose);">🗑</button>`:''}
    </div></td>
  </tr>`).join('');
}

function clearBkF() {
  ['bk-srch','bk-bank','bk-sts','bk-dis'].forEach(id=>{const e=el(id);if(e)e.value='';});
  renderBookings();
}

// ── PIPELINE ──────────────────────────────────────────────────
function renderPipeline() {
  const bk = S.bookings;
  const stages = {'File Given':[],'Under Process':[],'Sanction Received':[],'Disbursement Done':[],'Agreement Completed':[]};
  bk.forEach(b => {
    if (b.loan_status==='Cancelled') return;
    const k = b.disbursement_status==='done'?'Disbursement Done':b.loan_status;
    (stages[k]||stages['Under Process']).push(b);
  });
  const total=bk.filter(b=>b.loan_status!=='Cancelled').length;
  const sanc=bk.filter(b=>b.sanction_received==='Yes').length;
  const disb=bk.filter(b=>b.disbursement_status==='done').length;

  el('pipe-stats').innerHTML = `
    <div class="card" style="padding:14px 18px;border-left:3px solid var(--gold);">
      <div style="font-size:10px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:1px;">Active Files</div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:700;margin-top:3px;">${total}</div>
    </div>
    <div class="card" style="padding:14px 18px;border-left:3px solid var(--sky);">
      <div style="font-size:10px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:1px;">Sanctions Received</div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:700;margin-top:3px;">${sanc}</div>
    </div>
    <div class="card" style="padding:14px 18px;border-left:3px solid var(--sage);">
      <div style="font-size:10px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:1px;">Disbursements Done</div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:700;margin-top:3px;">${disb}</div>
    </div>`;

  const stageC = {'File Given':'var(--gold)','Under Process':'var(--teal)','Sanction Received':'var(--sky)','Disbursement Done':'var(--sage)','Agreement Completed':'#2a5c30'};
  const board = el('kanban');
  board.innerHTML = '';
  Object.entries(stages).forEach(([stage,items]) => {
    const col = mk('div','kb-col');
    const c = stageC[stage];
    col.innerHTML = `<div class="kb-col-hd" style="color:${c};border-left:3px solid ${c};">${stage}<span class="kb-cnt">${items.length}</span></div><div class="kb-cards">${
      items.length ? items.map(b=>`<div class="kb-card" onclick="viewBk('${b.id}')">
        <div class="kc-n">${escH(b.client_name)}</div>
        <div class="kc-i">Plot ${b.plot_no} · ${escH(b.bank_name||'')}</div>
        <div class="kc-v">₹${fmt_l(b.agreement_value)}</div>
      </div>`).join('') : '<div style="text-align:center;padding:18px;font-size:12px;color:var(--ink-faint);">Empty</div>'
    }</div>`;
    board.appendChild(col);
  });
}

// ── CHEQUES ───────────────────────────────────────────────────
function renderCheques() {
  let d = [...S.cheques];
  const srch=v('chq-srch').toLowerCase(), typ=v('chq-typ');
  if (srch) d=d.filter(c=>c.cust_name.toLowerCase().includes(srch)||(c.cheque_no||'').toLowerCase().includes(srch));
  if (typ)  d=d.filter(c=>c.entry_type===typ);

  const total=d.reduce((s,c)=>s+(+c.amount||0),0);
  const rpm=d.filter(c=>c.entry_type==='RPM').reduce((s,c)=>s+(+c.amount||0),0);
  const sm =d.filter(c=>c.entry_type==='SM').reduce((s,c)=>s+(+c.amount||0),0);

  el('chq-summary').innerHTML = `
    <div class="card" style="padding:13px 16px;"><div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700;">₹${fmt_l(total)}</div><div style="font-size:10.5px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:1px;margin-top:2px;">Total Collected</div></div>
    <div class="card" style="padding:13px 16px;border-left:3px solid var(--sky);"><div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700;">₹${fmt_l(rpm)}</div><div style="font-size:10.5px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:1px;margin-top:2px;">RPM (Revenue)</div></div>
    <div class="card" style="padding:13px 16px;border-left:3px solid var(--gold);"><div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700;">₹${fmt_l(sm)}</div><div style="font-size:10.5px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:1px;margin-top:2px;">SM (Infra)</div></div>`;

  const cf = S.customFields.filter(f=>f.applies_to==='cheque');
  const canEdit = S.profile?.role!=='sales', canDel = S.profile?.role==='admin'||S.profile?.role==='superadmin';

  el('chq-thead').innerHTML = `<tr><th>Customer</th><th>Plot</th><th>Bank Detail</th><th>Cheque/Ref</th><th>Date</th><th>Amount</th><th>Type</th>${cf.map(f=>`<th>${escH(f.field_label)}</th>`).join('')}<th>Actions</th></tr>`;

  const tbody=el('chq-tbody');
  if(!d.length){tbody.innerHTML=`<tr><td colspan="${8+cf.length}"><div class="empty"><div class="ei">🧾</div><h3>No entries</h3></div></td></tr>`;return;}
  tbody.innerHTML = d.map(c=>`<tr>
    <td class="td-name">${escH(c.cust_name)}</td>
    <td>${c.plot_no||'—'}</td>
    <td class="td-dim" style="font-size:12px;">${escH(c.bank_detail||'—')}</td>
    <td class="td-mono">${c.cheque_no||'—'}</td>
    <td class="td-dim">${c.cheque_date||'—'}</td>
    <td style="font-weight:700;">₹${num_fmt(c.amount)}</td>
    <td><span class="badge ${chqBadge(c.entry_type)}">${c.entry_type}</span></td>
    ${cf.map(f=>`<td class="td-dim">${escH(String((c.custom_data||{})[f.field_name]||'—'))}</td>`).join('')}
    <td><div style="display:flex;gap:4px;">
      ${canEdit?`<button class="btn btn-ghost btn-sm btn-icon" onclick="editChq('${c.id}')">✏️</button>`:''}
      ${canDel?`<button class="btn btn-ghost btn-sm btn-icon" onclick="delChq('${c.id}')" style="color:var(--rose);">🗑</button>`:''}
    </div></td>
  </tr>`).join('');
}

// ── PREV TEAM ─────────────────────────────────────────────────
function renderPrev() {
  const tbody=el('prev-tbody');
  if(!S.prev.length){tbody.innerHTML=`<tr><td colspan="6"><div class="empty"><div class="ei">📁</div><h3>No records</h3></div></td></tr>`;return;}
  tbody.innerHTML = S.prev.map((x,i)=>`<tr>
    <td class="td-dim">${i+1}</td>
    <td class="td-name">${escH(x.client_name)}</td>
    <td>${x.plot_no||'—'}</td>
    <td class="td-dim">${num_fmt(x.plot_size)}</td>
    <td style="font-weight:700;">₹${num_fmt(x.agreement_value)}</td>
    <td class="td-dim">${x.notes||'—'}</td>
  </tr>`).join('');
}

// ── ANALYTICS PAGE ────────────────────────────────────────────
function renderAnalytics() {
  const bk=S.bookings, chq=S.cheques;

  // Destroy old charts to prevent canvas reuse errors
  Object.values(S.charts).forEach(c => { try{c.destroy();}catch(e){} });
  S.charts = {};

  // 1. Loan Status Distribution (Doughnut)
  const statusGroups = groupCount(bk,'loan_status');
  S.charts.c1 = makeChart('c-status','doughnut',
    Object.keys(statusGroups), Object.values(statusGroups),
    ['#c47d1a','#196060','#1a4870','#3a6040','#a83030','#8fa5b5']);

  // 2. Bank-wise Bookings (Bar)
  const bankGroups = groupCount(bk,'bank_name');
  S.charts.c2 = makeChart('c-bank','bar',
    Object.keys(bankGroups), Object.values(bankGroups),
    '#c47d1a', 'Count');

  // 3. Monthly Bookings Trend (Line)
  const mMap = {};
  bk.forEach(b=>{ if(b.booking_date){ const m=b.booking_date.slice(0,7); mMap[m]=(mMap[m]||0)+1; } });
  const months = Object.keys(mMap).sort();
  S.charts.c3 = makeChart('c-monthly','line',
    months, months.map(m=>mMap[m]),
    '#196060','Bookings per Month');

  // 4. Agreement Value by Bank (Bar)
  const bvMap = {};
  bk.forEach(b=>{ const k=b.bank_name||'Unknown'; bvMap[k]=(bvMap[k]||0)+(+b.agreement_value||0); });
  S.charts.c4 = makeChart('c-value','bar',
    Object.keys(bvMap), Object.values(bvMap).map(v=>Math.round(v/100000)),
    '#1a4870','Value (₹ Lakhs)');

  // 5. Disbursement Status (Doughnut)
  const disbD = {Done:0,Pending:0,Cancelled:0};
  bk.forEach(b=>{ if(b.loan_status==='Cancelled')disbD.Cancelled++; else if(b.disbursement_status==='done')disbD.Done++; else disbD.Pending++; });
  S.charts.c5 = makeChart('c-disb','doughnut',
    Object.keys(disbD), Object.values(disbD),
    ['#3a6040','#c47d1a','#a83030']);

  // 6. Payment Collection by Type (Bar)
  const ptMap = groupSum(chq,'entry_type','amount');
  S.charts.c6 = makeChart('c-payment','bar',
    Object.keys(ptMap), Object.values(ptMap).map(v=>Math.round(v/100000)),
    '#4a2a70','Amount (₹ Lakhs)');
}

function makeChart(canvasId, type, labels, data, colors, label) {
  const canvas = el(canvasId); if(!canvas) return null;
  const ctx = canvas.getContext('2d');
  const isMultiColor = Array.isArray(colors);
  return new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{
        label: label||'',
        data,
        backgroundColor: isMultiColor ? colors : (type==='line'?'transparent':colors+'33'),
        borderColor: isMultiColor ? colors : colors,
        borderWidth: type==='line'?2.5:1.5,
        pointBackgroundColor: colors,
        pointRadius: type==='line'?4:0,
        tension: 0.4,
        fill: type==='line',
      }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend: { display: type==='doughnut', position:'bottom',
          labels:{font:{family:'Outfit',size:11},padding:16,color:'#4a6070'}},
        tooltip: { bodyFont:{family:'Outfit'}, titleFont:{family:'Outfit'} }
      },
      scales: type!=='doughnut' ? {
        x: { grid:{color:'rgba(0,0,0,.04)'}, ticks:{font:{family:'Outfit',size:11},color:'#8fa5b5'}, border:{color:'var(--border)'} },
        y: { grid:{color:'rgba(0,0,0,.04)'}, ticks:{font:{family:'Outfit',size:11},color:'#8fa5b5'}, border:{color:'var(--border)'} }
      } : {}
    }
  });
}

// ── CHART DOWNLOADS ───────────────────────────────────────────
function dlChart(canvasId, filename) {
  const canvas = el(canvasId); if(!canvas) return;
  const url = canvas.toDataURL('image/png');
  const a = mk('a'); a.href=url; a.download=filename+'.png'; a.click();
}

function dlTableCSV(type) {
  let rows, filename;
  if (type==='bookings') {
    const cf = S.customFields.filter(f=>f.applies_to==='booking');
    const headers = ['#','Date','Client','Contact','Plot No','Area (sqft)','Basic Rate','Agreement Value','SDR','Bank','Sanction','Disbursement','Status','Disburse Date','Banker Remark','Remark',...cf.map(f=>f.field_label)];
    rows = [headers, ...S.bookings.map((b,i)=>[
      b.serial_no||i+1, b.booking_date||'', b.client_name, b.contact||'',
      b.plot_no||'', b.plot_size||'', b.basic_rate||'', b.agreement_value||'',
      b.sdr||'', b.bank_name||'', b.sanction_received||'', b.disbursement_status||'',
      b.loan_status, b.disbursement_date||'', b.disbursement_remark||'', b.remark||'',
      ...cf.map(f=>(b.custom_data||{})[f.field_name]||'')
    ])];
    filename = `${S.curProj?.name||'project'}_bookings_${today()}`;
  } else if (type==='cheques') {
    const cf = S.customFields.filter(f=>f.applies_to==='cheque');
    rows = [['Customer','Plot','Bank Detail','Cheque No','Date','Amount','Type',...cf.map(f=>f.field_label)],
      ...S.cheques.map(c=>[c.cust_name,c.plot_no||'',c.bank_detail||'',c.cheque_no||'',c.cheque_date||'',c.amount,c.entry_type,...cf.map(f=>(c.custom_data||{})[f.field_name]||'')])];
    filename = `${S.curProj?.name||'project'}_cheques_${today()}`;
  } else if (type==='prev') {
    rows = [['#','Customer','Plot','Size (sqft)','Agr. Value','Notes'],
      ...S.prev.map((x,i)=>[i+1,x.client_name,x.plot_no||'',x.plot_size||'',x.agreement_value||'',x.notes||''])];
    filename = `${S.curProj?.name||'project'}_prev_team_${today()}`;
  }
  const csv = rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = mk('a'); a.href=url; a.download=filename+'.csv'; a.click();
  URL.revokeObjectURL(url);
  toast('CSV downloaded!');
}

// ── SETTINGS ─────────────────────────────────────────────────
async function renderSettings() {
  const p=S.curProj; if(!p) return;
  setField('set-name',p.name||''); setField('set-loc',p.location||'');
  setField('set-dev',p.developer||''); setField('set-rera',p.rera||'');
  setField('set-plots',p.total_plots||''); setField('set-infra',p.infra_rate||100);
  setField('set-legal',p.legal_charges||25000); setField('set-sdr',p.sdr_rate||6);

  // Project users
  const ul=el('proj-users-list');
  ul.innerHTML=`<div class="loading-cell"><div class="spin spin-ink"></div></div>`;
  const { data } = await sb.from('project_members').select('role,profiles(id,full_name)').eq('project_id',p.id);
  ul.innerHTML='';
  (data||[]).forEach(m=>{
    const row=mk('div','u-row');
    row.innerHTML=`<div class="avatar">${(m.profiles?.full_name||'?').charAt(0)}</div>
      <div><div class="ui-n">${escH(m.profiles?.full_name||'')}</div></div>
      <span class="role-pill ${rpClass(m.role)}" style="margin-left:auto;">${m.role}</span>
      <button class="btn btn-ghost btn-sm" style="color:var(--rose);" onclick="removeProjUser('${m.profiles?.id}','${p.id}')">Remove</button>`;
    ul.appendChild(row);
  });

  // Custom fields
  renderCFList();
}

async function saveSettings() {
  const p=S.curProj; if(!p) return;
  const {error}=await sb.from('projects').update({
    name:v('set-name'), location:v('set-loc'), developer:v('set-dev'), rera:v('set-rera'),
    total_plots:int('set-plots'), infra_rate:num('set-infra'), legal_charges:num('set-legal'), sdr_rate:num('set-sdr'),
  }).eq('id',p.id);
  if(error){toast(error.message,'err');return;}
  S.curProj.name=v('set-name'); updateProjHeader();
  toast('Settings saved!');
}

async function removeProjUser(uid,pid) {
  if(!confirm('Remove user from this project?')) return;
  await sb.rpc('remove_from_project',{p_user_id:uid,p_project_id:pid});
  renderSettings();
  toast('User removed','err');
}

// ── CUSTOM FIELDS ─────────────────────────────────────────────
function renderCFList() {
  const list = el('cf-list');
  if(!S.customFields.length){
    list.innerHTML='<div style="font-size:13px;color:var(--ink-faint);padding:12px 0;">No custom fields yet. Add one below.</div>';
    return;
  }
  list.innerHTML = S.customFields.map(f=>`
    <div class="cf-item">
      <div style="flex:1;">
        <div class="ci-label">${escH(f.field_label)}</div>
        <div class="ci-meta">${f.field_type} · ${f.applies_to}${f.is_required?' · required':''}</div>
      </div>
      <span class="badge b-gray" style="font-size:10px;">${f.field_type}</span>
      <button class="btn btn-ghost btn-sm" style="color:var(--rose);" onclick="deleteCF('${f.id}')">🗑</button>
    </div>`).join('');
}

function openCFModal() {
  clearFields(['cf-label','cf-name','cf-options']);
  el('cf-type').value='text'; el('cf-applies').value='booking'; el('cf-required').checked=false;
  el('cf-options-grp').style.display='none';
  openM('cfM');
}

el_ = function(id){return document.getElementById(id);}; // forward decl hack

async function addCustomField() {
  const label=v('cf-label').trim(), name_raw=v('cf-name').trim();
  if(!label){toast('Label required','err');return;}
  const fname = name_raw || label.toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/__+/g,'_');
  const opts = v('cf-options').split(',').map(s=>s.trim()).filter(Boolean);
  const {error}=await sb.from('custom_fields').insert({
    project_id:S.curProj.id, field_name:fname, field_label:label,
    field_type:v('cf-type'), applies_to:v('cf-applies'),
    field_options:opts.length?opts:null,
    is_required:el('cf-required').checked,
    sort_order:S.customFields.length
  });
  if(error){toast(error.message,'err');return;}
  await loadProjData(); renderCFList(); closeM('cfM');
  toast('Custom field added!');
}

async function deleteCF(id) {
  if(!confirm('Delete this custom field? Data stored in it will remain but not be shown.')) return;
  await sb.from('custom_fields').delete().eq('id',id);
  await loadProjData(); renderCFList();
  toast('Field removed','err');
}

// Toggle options input for select type
window.onCFTypeChange = function() {
  el('cf-options-grp').style.display = v('cf-type')==='select'?'':'none';
};

// ── BOOKING MODAL ─────────────────────────────────────────────
function openBkModal(bk) {
  S.editBkId = bk?.id||null;
  el('bk-modal-title').textContent = bk?'Edit Booking':'New Booking';
  el('bk-modal-sub').textContent   = bk?bk.client_name:'Add a plot booking';
  const p=S.curProj;
  const map={
    'bk-serial':'serial_no','bk-date':'booking_date','bk-name':'client_name','bk-contact':'contact',
    'bk-plot':'plot_no','bk-size':'plot_size','bk-rate':'basic_rate','bk-infra':'infra',
    'bk-basic':'','bk-basicinfra':'','bk-agr':'agreement_value','bk-sdr':'sdr',
    'bk-sdrminus':'sdr_minus','bk-maint':'maintenance','bk-legal':'legal_charges',
    'bk-bank':'bank_name','bk-bankercont':'banker_contact','bk-status':'loan_status',
    'bk-sancrecv':'sanction_received','bk-sancdate':'sanction_date',
    'bk-sancletter':'sanction_letter','bk-sdrrecv':'sdr_received','bk-sdrdate':'sdr_received_date',
    'bk-disbstatus':'disbursement_status','bk-disbdate':'disbursement_date',
    'bk-docsubmit':'doc_submitted','bk-disbremark':'disbursement_remark','bk-remark':'remark'
  };
  const defaults={'bk-infra':p?.infra_rate||100,'bk-legal':p?.legal_charges||25000,'bk-maint':p?.maintenance||0};
  Object.entries(map).forEach(([fid,col])=>{
    const e=el(fid); if(!e) return;
    e.value = bk?(bk[col]??''):(defaults[fid]??'');
  });

  // Build custom field inputs
  const cf = S.customFields.filter(f=>f.applies_to==='booking');
  const cfWrap = el('bk-custom-fields');
  cfWrap.innerHTML = '';
  if(cf.length) {
    const sec=mk('div'); sec.className='f-section full'; sec.textContent='Custom Fields';
    cfWrap.appendChild(sec);
    cf.forEach(f=>{
      const div=mk('div','fg'); if(cf.length===1||true) div.classList.add('');
      const val = bk?(bk.custom_data||{})[f.field_name]||'':'';
      div.innerHTML=`<label>${escH(f.field_label)}${f.is_required?' *':''}</label>${buildCFInput(f,val,'bkcf-'+f.field_name)}`;
      cfWrap.appendChild(div);
    });
  }

  if(bk) calcBkVals(); // pre-calc for edits
  openM('bkM');
}

function buildCFInput(f,val,id){
  if(f.field_type==='select'&&f.field_options?.length){
    return `<select id="${id}"><option value="">—</option>${f.field_options.map(o=>`<option value="${o}"${val===o?' selected':''}>${o}</option>`).join('')}</select>`;
  } else if(f.field_type==='textarea'){
    return `<textarea id="${id}">${escH(val)}</textarea>`;
  } else if(f.field_type==='boolean'){
    return `<select id="${id}"><option value="">—</option><option value="Yes"${val==='Yes'?' selected':''}>Yes</option><option value="No"${val==='No'?' selected':''}>No</option></select>`;
  } else {
    return `<input type="${f.field_type==='number'?'number':f.field_type==='date'?'date':'text'}" id="${id}" value="${escH(val)}">`;
  }
}

function editBk(id){ const b=S.bookings.find(x=>x.id===id); if(b) openBkModal(b); }

function calcBkVals() {
  const sz=parseFloat(v('bk-size'))||0, rt=parseFloat(v('bk-rate'))||0, inf=parseFloat(v('bk-infra'))||0;
  const sdrRate=(S.curProj?.sdr_rate||6)/100;
  setField('bk-basic',Math.round(sz*rt));
  setField('bk-basicinfra',Math.round(sz*(rt+inf)));
  setField('bk-agr',Math.round(sz*(rt+inf)));
  setField('bk-sdr',Math.round(sz*(rt+inf)*sdrRate));
}

async function saveBk() {
  const name=v('bk-name').trim(); if(!name){toast('Client name required','err');return;}
  const gv2=fid=>{ const e=el(fid); return e?e.value:''; };
  const gn2=fid=>parseFloat(gv2(fid))||null;
  const bkData={
    project_id:S.curProj.id, serial_no:int('bk-serial')||null,
    booking_date:gv2('bk-date')||null, client_name:name, contact:gv2('bk-contact'),
    plot_no:gv2('bk-plot'), plot_size:gn2('bk-size'), basic_rate:gn2('bk-rate'), infra:gn2('bk-infra'),
    agreement_value:gn2('bk-agr'), sdr:gn2('bk-sdr'), sdr_minus:gn2('bk-sdrminus'),
    maintenance:gn2('bk-maint'), legal_charges:gn2('bk-legal'),
    bank_name:gv2('bk-bank'), banker_contact:gv2('bk-bankercont'),
    loan_status:gv2('bk-status')||'File Given',
    sanction_received:gv2('bk-sancrecv')||null, sanction_date:gv2('bk-sancdate')||null,
    sanction_letter:gv2('bk-sancletter')||null, sdr_received:gn2('bk-sdrrecv'),
    sdr_received_date:gv2('bk-sdrdate')||null, disbursement_status:gv2('bk-disbstatus')||null,
    disbursement_date:gv2('bk-disbdate')||null, doc_submitted:gv2('bk-docsubmit'),
    disbursement_remark:gv2('bk-disbremark'), remark:gv2('bk-remark'),
    created_by:S.profile.id,
  };
  // Collect custom field values
  const cf=S.customFields.filter(f=>f.applies_to==='booking');
  if(cf.length){
    const existing = S.editBkId ? (S.bookings.find(b=>b.id===S.editBkId)?.custom_data||{}) : {};
    const customData={...existing};
    cf.forEach(f=>{ const e=el('bkcf-'+f.field_name); if(e) customData[f.field_name]=e.value; });
    bkData.custom_data=customData;
  }
  setBtn('bk-savebtn',true);
  let err;
  if(S.editBkId){ ({error:err}=await sb.from('bookings').update(bkData).eq('id',S.editBkId)); }
  else { ({error:err}=await sb.from('bookings').insert(bkData)); }
  setBtn('bk-savebtn',false);
  if(err){toast(err.message,'err');return;}
  closeM('bkM'); await loadProjData(); renderBookings();
  toast(S.editBkId?'Booking updated!':'Booking added!');
}

async function delBk(id) {
  if(!confirm('Delete this booking permanently?')) return;
  const {error}=await sb.from('bookings').delete().eq('id',id);
  if(error){toast(error.message,'err');return;}
  await loadProjData(); renderBookings(); toast('Deleted','err');
}

// ── DETAIL MODAL ──────────────────────────────────────────────
function viewBk(id) {
  const b=S.bookings.find(x=>x.id===id); if(!b) return;
  el('detail-title').textContent=b.client_name;
  el('detail-sub').textContent=`Plot ${b.plot_no} · ${b.bank_name||''} · ${b.loan_status}`;
  const canEdit=S.profile?.role!=='sales';
  el('detail-edit').style.display=canEdit?'':'none';
  el('detail-edit').onclick=()=>{closeM('detailM');editBk(id);};

  const fmt=n=>n?'₹'+num_fmt(n):'—';
  const sections=[
    {t:'Client',rows:[['Date',b.booking_date||'—'],['Plot No.',b.plot_no],['Size',num_fmt(b.plot_size)+' sqft'],['Contact',b.contact||'—']]},
    {t:'Financials',rows:[['Basic Rate','₹'+(b.basic_rate||0)+'/sqft'],['Infra','₹'+(b.infra||0)+'/sqft'],['Agreement Value',fmt(b.agreement_value)],['SDR',fmt(b.sdr)],['SDR-',fmt(b.sdr_minus)],['Maintenance',fmt(b.maintenance)],['Legal',fmt(b.legal_charges)]]},
    {t:'Loan & Bank',rows:[['Bank',b.bank_name||'—'],['Banker Contact',b.banker_contact||'—'],['Status',b.loan_status],['Sanction Recv.',b.sanction_received||'—'],['Sanction Date',b.sanction_date||'—'],['Sanction Letter',b.sanction_letter||'—'],['SDR Received',fmt(b.sdr_received)],['SDR Date',b.sdr_received_date||'—'],['Disbursement',b.disbursement_status||'Pending'],['Disb. Date',b.disbursement_date||'—'],['Doc for Draft',b.doc_submitted||'—']]},
  ];
  const cf=S.customFields.filter(f=>f.applies_to==='booking');
  if(cf.length) sections.push({t:'Custom Fields',rows:cf.map(f=>[(f.field_label),(b.custom_data||{})[f.field_name]||'—'])});

  let html=sections.map(s=>`<div class="d-section"><div class="d-section-title">${s.t}</div><div class="d-grid">${
    s.rows.map(([l,val])=>`<div class="d-item"><div class="dl">${l}</div><div class="dv">${escH(String(val))}</div></div>`).join('')
  }</div></div>`).join('');
  if(b.disbursement_remark) html+=`<div class="remark-box rb-sky" style="margin-bottom:9px;"><strong>Disbursement Remark:</strong><br>${escH(b.disbursement_remark)}</div>`;
  if(b.remark) html+=`<div class="remark-box rb-gold"><strong>Remark:</strong><br>${escH(b.remark)}</div>`;
  el('detail-body').innerHTML=html;
  openM('detailM');
}

// ── CHEQUE MODAL ──────────────────────────────────────────────
function openChqModal(c) {
  S.editChqId=c?.id||null;
  el('chq-modal-title').textContent=c?'Edit Entry':'Add Payment Entry';
  const map={'chq-cname':'cust_name','chq-plot':'plot_no','chq-bank':'bank_detail','chq-no':'cheque_no','chq-date':'cheque_date','chq-amount':'amount','chq-type':'entry_type'};
  Object.entries(map).forEach(([fid,col])=>{ const e=el(fid); if(e) e.value=c?(c[col]??''):''; });

  const cf=S.customFields.filter(f=>f.applies_to==='cheque');
  const cfw=el('chq-custom-fields');
  cfw.innerHTML='';
  if(cf.length){
    const sec=mk('div'); sec.className='f-section full'; sec.textContent='Custom Fields';
    cfw.appendChild(sec);
    cf.forEach(f=>{
      const div=mk('div','fg');
      const val=c?(c.custom_data||{})[f.field_name]||'':'';
      div.innerHTML=`<label>${escH(f.field_label)}</label>${buildCFInput(f,val,'chqcf-'+f.field_name)}`;
      cfw.appendChild(div);
    });
  }
  openM('chqM');
}

function editChq(id){ const c=S.cheques.find(x=>x.id===id); if(c) openChqModal(c); }

async function saveChq() {
  const name=v('chq-cname').trim(); if(!name){toast('Name required','err');return;}
  const chqData={
    project_id:S.curProj.id, cust_name:name, plot_no:v('chq-plot'),
    bank_detail:v('chq-bank'), cheque_no:v('chq-no'),
    cheque_date:v('chq-date')||null, amount:parseFloat(v('chq-amount'))||0,
    entry_type:v('chq-type'), created_by:S.profile.id,
  };
  const cf=S.customFields.filter(f=>f.applies_to==='cheque');
  if(cf.length){
    const existing=S.editChqId?(S.cheques.find(c=>c.id===S.editChqId)?.custom_data||{}):{};
    const cd={...existing};
    cf.forEach(f=>{ const e=el('chqcf-'+f.field_name); if(e) cd[f.field_name]=e.value; });
    chqData.custom_data=cd;
  }
  setBtn('chq-savebtn',true);
  let err;
  if(S.editChqId){ ({error:err}=await sb.from('cheques').update(chqData).eq('id',S.editChqId)); }
  else { ({error:err}=await sb.from('cheques').insert(chqData)); }
  setBtn('chq-savebtn',false);
  if(err){toast(err.message,'err');return;}
  closeM('chqM'); await loadProjData(); renderCheques();
  toast(S.editChqId?'Updated!':'Entry added!');
}

async function delChq(id) {
  if(!confirm('Delete this entry?')) return;
  await sb.from('cheques').delete().eq('id',id);
  await loadProjData(); renderCheques(); toast('Deleted','err');
}

// ── PREV MODAL ────────────────────────────────────────────────
function openPrevModal(){
  clearFields(['pv-name','pv-plot','pv-size','pv-val','pv-notes']);
  openM('prevM');
}

async function savePrev() {
  const name=v('pv-name').trim(); if(!name){toast('Name required','err');return;}
  const {error}=await sb.from('prev_bookings').insert({
    project_id:S.curProj.id, client_name:name,
    plot_no:v('pv-plot'), plot_size:num('pv-size')||null,
    agreement_value:num('pv-val')||null, notes:v('pv-notes'),
  });
  if(error){toast(error.message,'err');return;}
  closeM('prevM'); await loadProjData(); renderPrev(); toast('Entry added!');
}

// ── CONFIG ────────────────────────────────────────────────────
function openCfg() {
  setField('cfg-url', ls('rf_url')||'');
  setField('cfg-key', ls('rf_key')||'');
  openM('cfgM');
}
function saveCfg() {
  const url=v('cfg-url').trim(), key=v('cfg-key').trim();
  if(!url || !key){ toast('Both URL and key are required','err'); return; }
  if(!url.startsWith('https://')){ toast('URL must start with https://','err'); return; }
  localStorage.setItem('rf_url', url);
  localStorage.setItem('rf_key', key);
  sb = window.supabase.createClient(url, key, { auth:{ persistSession:true, autoRefreshToken:true } });
  closeM('cfgM');
  el('cfgBanner').style.display = 'none';
  toast('Supabase connected! You can now sign in.');
}
function showCfgBanner(){
  showLoader(false);
  el('cfgBanner').style.display = 'block';
}

// ── HELPERS ───────────────────────────────────────────────────
function el(id){ return document.getElementById(id); }
function mk(tag,cls){ const e=document.createElement(tag||'div'); if(cls) e.className=cls; return e; }
function v(id){ return el(id)?.value||''; }
function num(id){ return parseFloat(v(id))||0; }
function int(id){ return parseInt(v(id))||0; }
function setField(id,val){ const e=el(id); if(e) e.value=val??''; }
function clearFields(ids){ ids.forEach(id=>setField(id,'')); }
function ls(k){ return localStorage.getItem(k); }
function escH(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function shortName(n){ return n.split(/[\s—–-]/)[0]; }
function today(){ return new Date().toISOString().slice(0,10); }
function num_fmt(n){ return (+n||0).toLocaleString('en-IN'); }
function fmt_l(n){ return ((+n||0)/100000).toFixed(1)+'L'; }
function fmt_cr(n){ return ((+n||0)/10000000).toFixed(1)+'Cr'; }
function sum(arr,k){ return arr.reduce((s,x)=>s+(+x[k]||0),0); }
function groupCount(arr,k){ const m={}; arr.forEach(x=>{ const v=x[k]||'Unknown'; m[v]=(m[v]||0)+1; }); return m; }
function groupSum(arr,k,vk){ const m={}; arr.forEach(x=>{ const kv=x[k]||'Other'; m[kv]=(m[kv]||0)+(+x[vk]||0); }); return m; }

function sc(cls,icon,val,label,sub){
  return `<div class="sc ${cls}"><div class="sc-blob"></div><div class="sc-icon">${icon}</div><div class="sc-val">${val}</div><div class="sc-label">${label}</div><div class="sc-sub">${sub}</div></div>`;
}
function triplet(items){
  return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px;">${items.map(x=>`<div style="text-align:center;padding:13px 7px;background:${x.bg};border-radius:9px;"><div style="font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:700;color:${x.c};">${x.v}</div><div style="font-size:9.5px;text-transform:uppercase;letter-spacing:1px;color:var(--ink-faint);margin-top:3px;">${x.l}</div></div>`).join('')}</div>`;
}
function statusBadge(s){
  const m={'Agreement Completed':'b-green','Disbursement Done':'b-green','Sanction Received':'b-blue','File Given':'b-gold','Under Process':'b-teal','Cancelled':'b-rose'};
  return `<span class="badge ${m[s]||'b-gray'}">${s||'—'}</span>`;
}
function chqBadge(t){ return {RPM:'b-blue',SM:'b-gold',BOUNCE:'b-rose',NILL:'b-gray',cash:'b-purple',Other:'b-gray'}[t]||'b-gray'; }
function rpClass(r){ return {superadmin:'rp-sa',admin:'rp-admin',sales:'rp-sales'}[r]||''; }

function openM(id){ el(id)?.classList.add('on'); }
function closeM(id){ el(id)?.classList.remove('on'); }
window.addEventListener('click',e=>{ if(e.target.classList.contains('overlay')) e.target.classList.remove('on'); });

function toast(msg,type='ok'){
  const t=el('toast');
  t.textContent=(type==='ok'?'✓  ':type==='err'?'✕  ':'ℹ  ')+msg;
  t.className='on t-'+type;
  clearTimeout(t._t); t._t=setTimeout(()=>t.className='',3400);
}

function setBtn(id,loading){
  const b=el(id); if(!b) return;
  b.disabled=loading;
  if(loading){ if(!b.querySelector('.spin')) b.insertAdjacentHTML('beforeend','<span class="spin"></span>'); }
  else b.querySelector('.spin')?.remove();
}

function showLoader(on){
  const l=el('globalLoader'); if(!l) return;
  if(on){ l.classList.remove('hide','gone'); }
  else {
    l.classList.add('hide');
    setTimeout(()=>{ l.classList.add('gone'); },380);
  }
}
function showErr(msg){ const e=el('loginError'); if(!e) return; e.textContent=msg; e.style.display='block'; }
function hideErr(){ const e=el('loginError'); if(e) e.style.display='none'; }
