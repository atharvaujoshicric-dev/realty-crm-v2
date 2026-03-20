'use strict';
// ═══════════════════════════════════════════════════════════
//  RealtyFlow CRM v3.1 — Optimized for Song of the River
//  Focus: BWxSOTR Sheet Import + Smooth User/Client Workflows
// ═══════════════════════════════════════════════════════════

const SB_URL = 'https://pwofvcxritpiauqbdkty.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3b2Z2Y3hyaXRwaWF1cWJka3R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzMyODgsImV4cCI6MjA4OTQwOTI4OH0.Qc5QREC1yFwQq0NWTGotDRPUkiqAn38OpmkC-M7pvR0';

// ── Safe localStorage ──
const sto = {
  get:    k => { try { return localStorage.getItem(k); }    catch(e){ return null; } },
  set:    (k,v)=>{ try { localStorage.setItem(k,v); }       catch(e){} },
  del:    k => { try { localStorage.removeItem(k); }        catch(e){} }
};

// ── Supabase client ──
const sb = window.supabase.createClient(SB_URL, SB_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: { getItem: sto.get, setItem: sto.set, removeItem: sto.del }
  }
});

// ── User Management API ──
async function api(action, payload = {}) {
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
    if (e.message === 'Failed to fetch' || e.message.includes('NetworkError') || e.message.includes('fetch')) {
      return await apiRPC(action, payload);
    }
    throw e;
  }
}

// SQL RPC fallback
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

// ── State Management ──
const S = {
  user: null, profile: null,
  projects: [], curProj: null,
  bookings: [], cheques: [], prev: [], customFields: [],
  charts: {},
  editBkId: null, editChqId: null, editProjId: null, editUserId: null,
  clearProjId: null,
};

// ── DOM Helpers ──
const el   = id => document.getElementById(id);
const v    = id => el(id)?.value ?? '';
const num  = id => parseFloat(v(id)) || 0;
const esc  = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const setBtn = (id,busy) => { const b=el(id); if(!b) return; b.disabled=busy; b.style.opacity=busy?'0.5':'1'; b.style.cursor=busy?'not-allowed':'pointer'; };
const showEl = id => { const e=el(id); if(e) e.style.display=''; };
const hideEl = id => { const e=el(id); if(e) e.style.display='none'; };
const toast = (msg,type='info') => { const t=el('toast'); if(!t) return; t.innerHTML=`<div class="toast toast-${type}">${esc(msg)}</div>`; t.style.display=''; setTimeout(()=>t.style.display='none',4000); };
const randId = () => Math.random().toString(36).substring(2,11);
const openM = (id) => { const m=el(id); if(m) m.style.display='flex'; };
const closeM = (id) => { const m=el(id); if(m) m.style.display='none'; };

// ═══════════════════════════════════════════════════════════
//  EXCEL IMPORT - OPTIMIZED FOR BWXSOTR SHEET
// ═══════════════════════════════════════════════════════════

const IMP = { wb:null, sheets:[], maps:{}, projId:null, parsed:{}, mapping: null };

// BWxSOTR EXACT COLUMN MAPPING (Song of the River)
const BWXSOTR_MAP = {
  serial_no:0, booking_date:1, client_name:2, contact:3,
  plot_no:4, plot_size:5, basic_rate:6, infra:7,
  // Skip: 8=basic amount, 9=basic+infra (calculated)
  agreement_value:10, sdr:11, sdr_minus:12, maintenance:13, legal_charges:14,
  // Skip: 15=total cost, 16=received, 17=remaining
  loan_status:18,
  // Skip: 19=financing, 20=loan sanctioned
  bank_name:21,
  // Skip: 22-27=OCR and file tracking
  sdr_received:28, sdr_received_date:29,
  sanction_received:30, sanction_date:31, sanction_letter:32,
  banker_contact:33,
  disbursement_status:34, disbursement_date:35,
  remark:36, doc_submitted:37,
};

const CHEQUE_MAP = { cust_name:0, plot_no:1, bank_detail:2, cheque_no:3, cheque_date:4, amount:5, entry_type:6 };
const PREV_MAP   = { client_name:0, plot_no:1, plot_size:2, agreement_value:3 };

function detectSheetType(sheetName, headers) {
  const nl = sheetName.toLowerCase().trim();
  if(nl==='bwxsotr'||nl==='song of the river') return 'bookings';
  if(nl.includes('cheque')) return 'cheques';
  if(nl.includes('prev')||nl.includes('previous')||nl.includes('team')) return 'prev';
  return 'skip';
}

function getColMap(sheetName, headers, type) {
  if(type==='bookings' && headers.length>=38 && String(headers[2]||'').trim()==='Name') {
    return {...BWXSOTR_MAP};
  }
  if(type==='cheques' && headers.length>=7) {
    return {...CHEQUE_MAP};
  }
  if(type==='prev' && headers.length>=4) {
    return {...PREV_MAP};
  }
  // Fuzzy matching fallback
  const cols={};
  const n=h=>String(h||'').toLowerCase().replace(/[\n\r\t]+/g,' ').replace(/\s+/g,' ').trim();
  headers.forEach((h,idx)=>{
    const hn=n(h); if(!hn) return;
    if(type==='bookings'){
      if(cols.serial_no===undefined&&(hn==='no'||hn.startsWith('serial'))) cols.serial_no=idx;
      if(cols.booking_date===undefined&&hn==='date') cols.booking_date=idx;
      if(cols.client_name===undefined&&(hn==='name'||hn.includes('customer'))) cols.client_name=idx;
      if(cols.contact===undefined&&(hn.includes('contact')||hn.includes('mobile'))) cols.contact=idx;
      if(cols.plot_no===undefined&&hn.includes('plot')) cols.plot_no=idx;
      if(cols.plot_size===undefined&&(hn.includes('plot size')||hn.includes('sqft'))) cols.plot_size=idx;
      if(cols.basic_rate===undefined&&hn.includes('basic rate')) cols.basic_rate=idx;
      if(cols.agreement_value===undefined&&hn.includes('agreement')) cols.agreement_value=idx;
      if(cols.sdr===undefined&&hn==='sdr') cols.sdr=idx;
      if(cols.bank_name===undefined&&hn.startsWith('bank')) cols.bank_name=idx;
      if(cols.loan_status===undefined&&(hn.includes('status')||hn.includes('agreement status'))) cols.loan_status=idx;
    }
  });
  return cols;
}

async function parseFile() {
  const file=el('imp-file').files[0], projId=el('imp-proj').value;
  if(!file){toast('Select a file','err');return;}
  if(!projId){toast('Select a project','err');return;}
  if(typeof XLSX==='undefined'){toast('Excel library not loaded. Refresh page.','err');return;}
  
  IMP.projId=projId;
  setBtn('imp-parse-btn',true); 
  el('imp-fname').textContent='⏳ Reading…';
  
  try{
    const buf=await file.arrayBuffer(); 
    IMP.wb=XLSX.read(buf,{type:'array',cellDates:true,raw:false}); 
    IMP.sheets=IMP.wb.SheetNames;
  }
  catch(e){
    toast('Error reading file: '+e.message,'err');
    setBtn('imp-parse-btn',false);
    return;
  }
  
  setBtn('imp-parse-btn',false); 
  hideEl('imp-s1'); 
  showEl('imp-s2');
  
  const container=el('sheetMaps'); 
  container.innerHTML='';

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

    const colMapHTML=()=>{
      const t=IMP.maps[sheetName].type; 
      if(t==='skip') return '';
      const defs={
        bookings:[['serial_no','#',false],['booking_date','Date',false],['client_name','Client Name',true],['contact','Contact',false],['plot_no','Plot No.',false],['plot_size','Size (sqft)',false],['basic_rate','Basic Rate',false],['agreement_value','Agr. Value',false],['sdr','SDR',false],['bank_name','Bank',false],['loan_status','Loan Status',false],['sanction_received','Sanction Recv.',false],['disbursement_status','Disb. Status',false],['remark','Remark',false]],
        cheques:[['cust_name','Customer Name',true],['plot_no','Plot No.',false],['amount','Amount',true],['cheque_no','Cheque No.',false],['cheque_date','Date',false]],
        prev:[['client_name','Customer Name',true],['plot_no','Plot No.',false],['agreement_value','Agr. Value',false]]
      }[t]||[];
      const cols=IMP.maps[sheetName].cols;
      const opts='<option value="">— Skip —</option>'+headers.map((h,i)=>`<option value="${i}">${i+1}. ${esc(h||'(empty)')}</option>`).join('');
      const mkSel=(key,req)=>{
        const val=cols[key];
        const selected=opts.replace(`value="${val}"`,`value="${val}" selected`);
        return `<div style="display:flex;flex-direction:column;gap:4px"><label style="font-size:10px;font-weight:700;color:${req?'var(--gold)':'var(--inkf)'};text-transform:uppercase;letter-spacing:.8px">${key.replace(/_/g,' ')}${req?' *':''}</label><select id="cm_${sid}_${key}" data-field="${key}" data-sheet="${sid}" style="padding:5px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:11px;font-family:'Outfit',sans-serif">${selected}</select></div>`;
      };
      return `<div style="margin-bottom:8px;font-size:10.5px;color:var(--inkf)">Map columns to CRM fields</div><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${defs.map(([k,,r])=>mkSel(k,r)).join('')}</div>`;
    };

    wrap.innerHTML=`
      <div style="padding:11px 16px;background:var(--paper);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-weight:600;font-size:13px">📄 ${esc(sheetName)}</span>
        <span style="font-size:12px;color:var(--inkf)">${dataRows.length} rows</span>
        <div style="margin-left:auto">
          <select id="stype_${sid}" style="padding:5px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:12px;font-family:'Outfit',sans-serif">
            <option value="skip" ${autoType==='skip'?'selected':''}>⏭ Skip</option>
            <option value="bookings" ${autoType==='bookings'?'selected':''}>🏡 Bookings</option>
            <option value="cheques"  ${autoType==='cheques'?'selected':''}>🧾 Cheques</option>
            <option value="prev"     ${autoType==='prev'?'selected':''}>📁 Prev</option>
          </select>
        </div>
      </div>
      <div id="maparea_${sid}" style="padding:13px 16px;${autoType==='skip'?'display:none':''}">${colMapHTML()}</div>`;
    
    container.appendChild(wrap);
    
    // Attach delegated listener
    wrap.addEventListener('change',function(e){
      if(!e.target.id.startsWith('cm_')) return;
      const field=e.target.getAttribute('data-field');
      if(field && sheetName) {
        IMP.maps[sheetName].cols[field]=e.target.value===''?undefined:parseInt(e.target.value,10);
      }
    });

    // Type change handler
    const sel=el('stype_'+sid);
    if(sel) sel.addEventListener('change',function(){
      const t=this.value;
      IMP.maps[sheetName].type=t;
      IMP.maps[sheetName].cols=getColMap(sheetName,headers,t);
      const ma=el('maparea_'+sid);
      if(t==='skip'){ma.style.display='none';}
      else{
        ma.style.display=''; 
        ma.innerHTML=colMapHTML();
        setTimeout(()=>{
          document.querySelectorAll(`select[id^="cm_${sid}_"]`).forEach(sel=>{
            sel.addEventListener('change',function(){
              const key=this.id.substring(this.id.lastIndexOf('_')+1);
              IMP.maps[sheetName].cols[key]=this.value===''?undefined:parseInt(this.value,10);
            });
          });
        },0);
      }
    });
  });
}

function previewImport(){
  let total=0; 
  const summary=[]; 
  IMP.parsed={};
  
  IMP.sheets.forEach(sheetName=>{
    const mapping=IMP.maps[sheetName];
    if(!mapping){
      console.warn(`No mapping for sheet: ${sheetName}`);
      return;
    }
    if(mapping.type==='skip') return;
    
    const ws=IMP.wb.Sheets[sheetName];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
    const dataRows=rows.slice(1).filter(r=>r.some(c=>c!==''&&c!==null&&c!==undefined));
    
    let parsed;
    if(mapping.type==='cheques'){
      let lastCustName='';
      parsed=[];
      dataRows.forEach(row=>{
        const obj={};
        Object.entries(mapping.cols).forEach(([field,colIdx])=>{
          if(colIdx!==undefined&&colIdx!==''&&colIdx!==null){
            const idx=typeof colIdx==='string'?parseInt(colIdx,10):colIdx;
            const val=row[idx];
            obj[field]=(val!==undefined&&val!==null)?String(val).trim():'';
          }
        });
        if(obj.cust_name && obj.cust_name.trim()) {
          lastCustName = obj.cust_name.trim();
        } else {
          obj._custName = lastCustName;
        }
        parsed.push(obj);
      });
      parsed = parsed.filter(obj=>{
        const name = obj.cust_name || obj._custName || '';
        const amount = parseFloat(String(obj.amount||'').replace(/[₹,\s]/g,''))||0;
        return name && amount > 0;
      });
    } else {
      parsed=dataRows.map(row=>{
        const obj={};
        Object.entries(mapping.cols).forEach(([field,colIdx])=>{
          if(colIdx!==undefined&&colIdx!==''&&colIdx!==null){
            const idx=typeof colIdx==='string'?parseInt(colIdx,10):colIdx;
            const val=row[idx];
            obj[field]=(val!==undefined&&val!==null)?String(val).trim():'';
          }
        });
        return obj;
      }).filter(obj=>obj.client_name);
    }
    
    IMP.parsed[sheetName]=parsed; 
    total+=parsed.length;
    summary.push({sheet:sheetName,type:mapping.type,count:parsed.length});
  });
  
  hideEl('imp-s2'); 
  showEl('imp-s3');
  el('imp-summary').innerHTML=summary.length?summary.map(s=>`<div style="display:flex;align-items:center;gap:11px;padding:11px 15px;background:#fff;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
    <span style="font-size:18px">${s.type==='bookings'?'🏡':s.type==='cheques'?'🧾':'📁'}</span>
    <div><div style="font-weight:600;font-size:13px">${esc(s.sheet)}</div><div style="font-size:11px;color:var(--inkf)">→ ${s.type}</div></div>
    <div style="margin-left:auto;font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700">${s.count}</div><div style="font-size:11px;color:var(--inkf)">rows</div></div>`).join('')
    :`<div style="color:var(--rose);font-size:13px;padding:12px">No valid rows found.</div>`;
  el('imp-total').textContent=total;
  el('imp-confirm').disabled=total===0;
}

async function runImport(){
  const projId=IMP.projId; 
  if(!projId) return;
  setBtn('imp-confirm',true); 
  showEl('imp-progress');
  
  let imported=0, errors=0;
  const entries=Object.entries(IMP.parsed);
  
  for(let ei=0;ei<entries.length;ei++){
    const [sheetName,rows]=entries[ei];
    const type=IMP.maps[sheetName].type; 
    if(!rows.length) continue;
    
    el('imp-prog-text').textContent=`Importing "${sheetName}"…`;
    const CHUNK=50;
    
    for(let i=0;i<rows.length;i+=CHUNK){
      const chunk=rows.slice(i,i+CHUNK).map(row=>buildImpRow(row,type,projId)).filter(Boolean);
      if(!chunk.length) continue;
      
      const table=type==='bookings'?'bookings':type==='cheques'?'cheques':'prev_bookings';
      const {error}=await sb.from(table).insert(chunk);
      
      if(error){errors+=chunk.length;console.error(sheetName,error);}
      else imported+=chunk.length;
      
      el('imp-prog-bar').style.width=Math.min(Math.round(((ei/entries.length)+(i/rows.length/entries.length))*100),99)+'%';
    }
  }
  
  el('imp-prog-bar').style.width='100%';
  await new Promise(r=>setTimeout(r,400));
  setBtn('imp-confirm',false); 
  hideEl('imp-s3'); 
  hideEl('imp-progress'); 
  showEl('imp-result');
  el('imp-ok').textContent=imported; 
  el('imp-err').textContent=errors;
  
  if(imported>0&&S.curProj?.id===projId) await loadProjData();
  toast(imported>0?`✓ Imported ${imported} records!`:'No records imported',imported>0?'ok':'err');
}

function buildImpRow(row, type, projId){
  if(type==='bookings'){
    const name = row.client_name||''; 
    if(!name) return null;
    
    return {
      project_id: projId,
      serial_no: toInt(row.serial_no),
      booking_date: toDate(row.booking_date),
      client_name: name,
      contact: row.contact||'',
      plot_no: row.plot_no||'',
      plot_size: toNum(row.plot_size),
      basic_rate: toNum(row.basic_rate),
      infra: toNum(row.infra)||100,
      agreement_value: toNum(row.agreement_value),
      sdr: toNum(row.sdr),
      sdr_minus: toNum(row.sdr_minus)||0,
      maintenance: toNum(row.maintenance)||0,
      legal_charges: toNum(row.legal_charges)||25000,
      bank_name: normBank(row.bank_name),
      banker_contact: row.banker_contact||'',
      loan_status: normLoanStatus(row.loan_status),
      sanction_received: String(row.sanction_received||'').toLowerCase().startsWith('y') ? 'Yes' : null,
      sanction_date: toDate(row.sanction_date),
      sanction_letter: row.sanction_letter||null,
      sdr_received: toNum(row.sdr_received),
      sdr_received_date: toDate(row.sdr_received_date),
      disbursement_status: normDisbStatus(row.disbursement_status),
      disbursement_date: toDate(row.disbursement_date),
      remark: row.remark||'',
      doc_submitted: row.doc_submitted||'',
    };
  }
  if(type==='cheques'){
    const name = row.cust_name || row._custName || '';
    if(!name) return null;
    const amount = toNum(row.amount)||0;
    if(amount <= 0) return null;
    
    return {
      project_id: projId,
      cust_name: name,
      plot_no: row.plot_no||'',
      bank_detail: row.bank_detail||'',
      cheque_no: row.cheque_no||'',
      cheque_date: toDate(row.cheque_date),
      amount: amount,
      entry_type: normEntry(row.entry_type),
    };
  }
  if(type==='prev'){
    const name = row.client_name||''; 
    if(!name) return null;
    return {
      project_id: projId,
      client_name: name,
      plot_no: row.plot_no||'',
      plot_size: toNum(row.plot_size),
      agreement_value: toNum(row.agreement_value),
      notes: row.notes||'',
    };
  }
  return null;
}

// ── Normalizers ──
function normBank(v){
  if(!v) return '';
  const vl=String(v).toLowerCase().trim();
  if(vl.startsWith('hdfc')) return 'HDFC';
  if(vl.startsWith('axis')) return 'Axis';
  if(vl.startsWith('idbi')) return 'IDBI';
  if(vl.startsWith('icici')) return 'ICICI';
  if(vl.startsWith('sbi')) return 'SBI';
  if(vl.startsWith('self')) return 'Self';
  return String(v).trim();
}

function normLoanStatus(v){
  if(!v) return 'File Given';
  const vl=String(v).toLowerCase().trim();
  if(vl==='done'||vl.includes('completed')) return 'Agreement Completed';
  if(vl.includes('disburs')&&vl.includes('done')) return 'Disbursement Done';
  if(vl.includes('sanction')) return 'Sanction Received';
  if(vl.includes('cancel')) return 'Cancelled';
  if(vl.includes('process')) return 'Under Process';
  return 'File Given';
}

function normDisbStatus(v){
  if(!v) return null;
  const vl=String(v).toLowerCase().trim();
  return (vl==='done'||vl.includes('done')) ? 'done' : null;
}

function normEntry(v){
  if(!v) return 'RPM';
  const vl=String(v).toUpperCase().trim();
  return ['RPM','SM','NILL','BOUNCE','Other','cash'].includes(vl) ? vl : 'RPM';
}

function toNum(v){ 
  if(!v&&v!==0) return null; 
  const n=parseFloat(String(v).replace(/[₹,\s]/g,'')); 
  return isNaN(n)?null:n; 
}

function toInt(v){ 
  if(!v) return null; 
  const n=parseInt(v); 
  return isNaN(n)?null:n; 
}

function toDate(v){
  if(!v) return null;
  const s=String(v).trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0,10);
  const m=s.match(/(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})/);
  if(m){
    const y=m[3].length===2?'20'+m[3]:m[3];
    return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  const n=parseFloat(v);
  if(!isNaN(n)&&n>40000){
    const d=new Date(Math.round((n-25569)*86400*1000));
    return d.toISOString().substring(0,10);
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════
//  SMOOTH WORKFLOWS: USER CREATION & CLIENT ADDITION
// ════════════════════════════════════════════════════════════════════════

async function quickAddUser(){
  const email = v('qu-email').trim();
  const name = v('qu-name').trim();
  const password = v('qu-pass');
  
  if(!email || !name || !password) {
    toast('All fields required','err');
    return;
  }
  
  setBtn('qu-save',true);
  try {
    const user = await api('create', {
      email, password, name,
      role: 'sales',
      project_id: S.curProj?.id
    });
    
    toast(`✓ User ${name} created!`,'ok');
    el('qu-email').value = '';
    el('qu-name').value = '';
    el('qu-pass').value = '';
    closeM('quickUserModal');
    
    if(S.curProj) await loadProjData();
  } catch(e) {
    toast('Error: ' + e.message,'err');
  }
  setBtn('qu-save',false);
}

async function quickAddClient(){
  const clientName = v('qc-name').trim();
  const plotNo = v('qc-plot').trim();
  const contact = v('qc-contact').trim();
  
  if(!clientName || !plotNo) {
    toast('Client name and plot required','err');
    return;
  }
  
  if(!S.curProj) {
    toast('Select a project first','err');
    return;
  }
  
  setBtn('qc-save',true);
  try {
    const { error } = await sb.from('bookings').insert({
      project_id: S.curProj.id,
      client_name: clientName,
      plot_no: plotNo,
      contact: contact,
      booking_date: new Date().toISOString().substring(0,10),
      agreement_value: 0,
      sdr: 0,
      loan_status: 'File Given'
    });
    
    if(error) throw error;
    
    toast(`✓ Client ${clientName} added!`,'ok');
    el('qc-name').value = '';
    el('qc-plot').value = '';
    el('qc-contact').value = '';
    closeM('quickClientModal');
    
    await loadProjData();
  } catch(e) {
    toast('Error: ' + e.message,'err');
  }
  setBtn('qc-save',false);
}

// ════════════════════════════════════════════════════════════════════════
//  INITIALIZATION & MAIN FLOWS
// ════════════════════════════════════════════════════════════════════════

async function init(){
  try {
    const { data: { session } } = await sb.auth.getSession();
    if(!session) {
      showEl('loginWrap');
      hideEl('app');
      return;
    }
    
    S.user = session.user;
    const { data: prof } = await sb.from('profiles').select('*').eq('id', S.user.id).single();
    if(!prof) {
      toast('Profile not found','err');
      return;
    }
    
    S.profile = prof;
    el('ucName').textContent = prof.full_name || 'User';
    el('ucAvatar').textContent = (prof.full_name || 'U')[0].toUpperCase();
    
    const { data: projs } = await sb.from('projects').select('*').order('name');
    S.projects = projs || [];
    
    if(prof.role === 'superadmin') {
      showEl('p-sa-proj');
      await loadAllProjects();
    } else {
      showEl('p-dash');
      if(S.projects.length > 0) {
        S.curProj = S.projects[0];
        await loadProjData();
      }
    }
    
    hideEl('loginWrap');
    showEl('app');
    clearTimeout(window._lk);
    hideEl('loader');
  } catch(e) {
    toast('Init error: ' + e.message,'err');
  }
}

async function doLogin(){
  const email = v('li-email'), pass = v('li-pass');
  if(!email || !pass) {
    el('loginErr').textContent = 'Email and password required';
    return;
  }
  
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if(error) {
    el('loginErr').textContent = error.message;
    return;
  }
  
  await init();
}

function doLogout(){
  sb.auth.signOut().then(() => {
    location.reload();
  });
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

function renderImportPage(){
  sb.from('projects').select('id,name').order('name').then(({data})=>{
    const sel=el('imp-proj');
    sel.innerHTML='<option value="">— Select Project —</option>'+(data||[]).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  });
  resetImport();
}

async function loadAllProjects(){
  try {
    const { data: projs } = await sb.from('projects').select('*').order('created_at','desc');
    const grid = el('saGrid');
    grid.innerHTML = (projs||[]).map(p=>`<div class="card" onclick="selectProject('${p.id}')">
      <div class="card-hd"><span>${esc(p.name)}</span></div>
      <div class="card-body" style="font-size:13px;color:var(--inkf)">
        <div>Location: ${esc(p.location||'—')}</div>
        <div>Developer: ${esc(p.developer||'—')}</div>
      </div>
    </div>`).join('');
  } catch(e) {
    toast('Error loading projects: '+e.message,'err');
  }
}

async function loadProjData(){
  if(!S.curProj) return;
  
  try {
    const { data: bk } = await sb.from('bookings').select('*').eq('project_id', S.curProj.id).order('serial_no');
    S.bookings = bk || [];
    
    const { data: chq } = await sb.from('cheques').select('*').eq('project_id', S.curProj.id).order('created_at');
    S.cheques = chq || [];
    
    renderBookingsTable();
    updateDashboard();
  } catch(e) {
    toast('Error loading data: '+e.message,'err');
  }
}

function renderBookingsTable(){
  const tbody = document.querySelector('#bookings-table tbody');
  if(!tbody) return;
  
  tbody.innerHTML = S.bookings.map(bk=>`<tr>
    <td>${bk.serial_no||'—'}</td>
    <td>${bk.client_name}</td>
    <td>${bk.plot_no}</td>
    <td>₹${(bk.agreement_value||0).toLocaleString()}</td>
    <td>${bk.bank_name||'—'}</td>
    <td><span class="badge badge-${bk.loan_status==='File Given'?'gold':bk.loan_status==='Agreement Completed'?'green':'blue'}">${bk.loan_status||'File Given'}</span></td>
    <td><button class="btn btn-sm btn-ghost" onclick="editBooking('${bk.id}')">✏️</button></td>
  </tr>`).join('');
}

function updateDashboard(){
  const totalValue = S.bookings.reduce((sum,bk)=>sum+(bk.agreement_value||0),0);
  const completedCount = S.bookings.filter(bk=>bk.loan_status==='Agreement Completed').length;
  
  const stats = el('dashStats');
  if(stats) stats.innerHTML = `
    <div class="sc"><div class="sc-val">${S.bookings.length}</div><div class="sc-label">Total Bookings</div></div>
    <div class="sc"><div class="sc-val">₹${(totalValue/10000000).toFixed(1)}Cr</div><div class="sc-label">Booking Value</div></div>
    <div class="sc"><div class="sc-val">${completedCount}</div><div class="sc-label">Agreements Done</div></div>
  `;
}

function selectProject(projId){
  S.curProj = S.projects.find(p=>p.id===projId);
  if(S.curProj) {
    navigate('p-dash');
    loadProjData();
  }
}

function navigate(pageId){
  document.querySelectorAll('.page').forEach(p=>p.style.display='none');
  el(pageId).style.display='block';
  
  if(pageId === 'p-sa-import') renderImportPage();
  else if(pageId === 'p-dash') loadProjData();
}

function backToProjects(){
  if(S.profile?.role === 'superadmin') {
    navigate('p-sa-proj');
  } else {
    navigate('p-dash');
  }
}

// Init on load
window.addEventListener('load', init);
