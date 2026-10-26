/* HourSync Project Monitor — application controller */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = window.HSDB, CH = window.HSCharts;

  const PHASES = ['Design', 'HMI', 'PLC-OPC', 'FAT', 'SAT', 'Handover'];
  const TASKS = ['Wonderware HMI', 'ArchestrA Scripting', 'PLC-Modbus/OPC Comms', 'SQL Optimization', 'Site Survey/BOM', 'FAT/SAT QA'];
  const WORK = ['Billable Engineering', 'Troubleshooting', 'PM Coordination'];
  const EXP_CATS = ['Hardware/BOM', 'Software Licenses', 'Site Logistics', 'Subcontractor', 'Variation Order'];
  const APPROVAL = ['Pending', 'Approved', 'Rejected'];
  const BL_CATS = ['Field Comms/OPC', 'Panel/BOM Procurement', 'Client Approval', 'IT/Firewall Security', 'SQL/Database', 'HSE/Site Access'];
  const SEV = ['Critical', 'High', 'Medium', 'Low'];
  const ASSIGN = ['SCADA Engineer', 'Project Manager', 'Vendor', 'Client'];
  const STAT = ['Open', 'In Progress', 'Escalated', 'Resolved'];
  const STAT_LBL = { Open: 'Open', 'In Progress': 'In Progress', Escalated: 'Escalated to PM', Resolved: 'Resolved' };
  const DELIV = { hmi: 'Wonderware Graphics', plc: 'PLC Comms', sql: 'SQL Historians', qa: 'QA / FAT' };
  const QHSE = ['Site induction & HSE briefing completed', 'PPE and permit-to-work verified for site visits', 'Risk assessment / method statement approved', 'OT/IT firewall & cybersecurity change approvals logged', 'PLC / SCADA project backups taken before changes', 'FAT / SAT procedure and test sheets reviewed', 'Documentation sign-offs (I/O list, network diagram, as-built)', 'Client approval / minutes of meeting filed', 'Timesheet submitted & approved', 'Weekly PM alignment meeting held'];
  const TABS = [['dashboard', 'Dashboard'], ['blockers', 'Blockers'], ['time', 'Timesheet'], ['spend', 'Spend & BOM'], ['sync', 'PM Sync & QHSE'], ['settings', 'Settings']];
  const SEVRANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };

  let S = { settings: {}, projects: [], time_logs: [], expenditures: [], blockers: [], pm_sync_notes: [], qhse: [], archive_summaries: [] };
  let view = 'dashboard', draws = [], blView = 'kanban', blF = { project: '', severity: '', q: '', resolved: false }, sel = new Set(), tsRange = 'week', qProject = null, spF = { project: '', cat: '' }, deferred = null, memTimer = null;

  /* ---------- helpers ---------- */
  const today = () => D.today();
  const vatF = () => S.settings.vat ? 1.05 : 1;
  function money(aed, dec = 0) { const u = S.settings.currency === 'USD', v = u ? aed / S.settings.usdRate : aed; return (u ? '$' : 'AED ') + v.toLocaleString('en-US', { maximumFractionDigits: dec, minimumFractionDigits: dec }); }
  const n1 = v => (Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
  const pct = (a, b) => b ? a / b * 100 : 0;
  const proj = id => S.projects.find(p => p.id === Number(id));
  const pcode = id => (proj(id) || { code: '—' }).code;
  const fmtD = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return d + '/' + m + '/' + y; };
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); }
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const opt = (arr, v) => arr.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('');
  const projOpts = (v, all) => (all ? `<option value="">${all}</option>` : '') + S.projects.map(p => `<option value="${p.id}" ${String(p.id) === String(v) ? 'selected' : ''}>${esc(p.code)} — ${esc(p.name.slice(0, 40))}</option>`).join('');
  const badge = (t, c) => `<span class="b ${c || t}">${esc(t)}</span>`;

  /* ---------- data ---------- */
  async function loadAll() {
    await D.open(); S.settings = await D.loadSettings();
    for (const s of Object.keys(S)) if (s !== 'settings') S[s] = await D.all(s);
  }
  async function refresh() { await loadAll(); applyTheme(); render(); updateMini(); }

  function pcalc(p) {
    const logs = S.time_logs.filter(l => l.projectId === p.id), ex = S.expenditures.filter(e => e.projectId === p.id && e.approval !== 'Rejected'), ar = S.archive_summaries.filter(a => a.projectId === p.id);
    const hours = sum(logs, l => l.hours) + sum(ar, a => a.hours), billable = sum(logs.filter(l => l.billable), l => l.hours) + sum(ar, a => a.billable);
    const labor = sum(logs, l => l.hours * l.rate) + sum(ar, a => a.laborAED), spend = (sum(ex, e => e.amountAED) + sum(ar, a => a.expAED)) * vatF();
    const AC = labor + spend, EV = p.budgetAED * p.progressPct / 100, PV = p.budgetAED * p.plannedPct / 100;
    return { hours, billable, labor, spend, AC, EV, PV, CV: EV - AC, CPI: AC ? EV / AC : 0, SPI: PV ? EV / PV : 0, burn: pct(AC, p.budgetAED), hrBurn: pct(hours, p.allocatedHours) };
  }
  const active = () => S.projects.filter(p => p.status !== 'Closed');
  function portfolio() {
    const ps = active(), cs = ps.map(pcalc);
    const AC = sum(cs, c => c.AC), EV = sum(cs, c => c.EV), PV = sum(cs, c => c.PV), B = sum(ps, p => p.budgetAED), H = sum(cs, c => c.hours), A = sum(ps, p => p.allocatedHours);
    return { ps, cs, AC, EV, PV, B, H, A, CPI: AC ? EV / AC : 0, SPI: PV ? EV / PV : 0, burn: pct(AC, B), hrBurn: pct(H, A) };
  }
  const bAge = b => D.daysBetween(b.createdDate, b.status === 'Resolved' && b.resolvedDate ? b.resolvedDate : today());
  const bOverdue = b => b.status !== 'Resolved' && b.slaDate && b.slaDate < today();
  function mttr() {
    const r = S.blockers.filter(b => b.status === 'Resolved' && b.resolvedDate), ar = S.archive_summaries;
    const n = r.length + sum(ar, a => a.blockersResolved || 0), d = sum(r, b => D.daysBetween(b.createdDate, b.resolvedDate)) + sum(ar, a => a.mttrDaysSum || 0);
    return n ? d / n : 0;
  }

  /* ---------- theme / chrome ---------- */
  function applyTheme() {
    const t = S.settings.theme, r = document.documentElement;
    if (t === 'dark' || t === 'light') r.setAttribute('data-theme', t); else r.removeAttribute('data-theme');
    const dark = t === 'dark' || (t === 'auto' && !matchMedia('(prefers-color-scheme: light)').matches);
    $$('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#0f172a' : '#f1f5f9'));
    $('#bCur').textContent = S.settings.currency; $('#bVat').setAttribute('aria-pressed', S.settings.vat ? 'true' : 'false'); $('#bCur').setAttribute('aria-pressed', S.settings.currency === 'USD' ? 'true' : 'false');
  }
  function tickClock() {
    const d = new Date(); $('#clock').innerHTML = d.toLocaleTimeString('en-GB', { timeZone: D.TZ, hour12: false }) + '<small>' + d.toLocaleDateString('en-GB', { timeZone: D.TZ, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) + ' · GST (UTC+4)</small>';
    const t = timerGet(); const el = $('#timerDisp'); if (el && t) { el.textContent = hms(elapsed(t)); }
  }
  async function updateMini() {
    const i = await D.storageInfo(); $('#miniTxt').textContent = i.supported ? bytes(i.usage) : S.blockers.length + ' recs';
    $('#miniBar').style.width = Math.max(2, Math.min(100, i.pct)) + '%'; $('#miniStore').title = 'Storage: ' + bytes(i.usage) + ' of ' + bytes(i.quota) + (i.persisted ? ' · persistent' : ' · not persistent');
  }
  function bytes(b) { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(4, Math.floor(Math.log(b) / Math.log(1024))); return (b / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i]; }
  function netState() { const o = navigator.onLine; $('#net').textContent = o ? '● Online' : '● Offline'; $('#net').style.color = o ? 'var(--green)' : 'var(--amber)'; }

  /* ---------- modal / forms ---------- */
  function modal(html, wide) {
    closeModal(); const ov = document.createElement('div'); ov.className = 'ov'; ov.id = 'ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="md fade">${html}</div>`; document.body.appendChild(ov);
    ov.addEventListener('mousedown', e => { if (e.target === ov) closeModal(); });
    const f = $('input,select,textarea,button', ov); if (f) f.focus(); return ov;
  }
  function closeModal() { const o = $('#ov'); if (o) o.remove(); }
  function fieldHTML(f, v) {
    const val = v[f.name] != null ? v[f.name] : (f.def != null ? f.def : ''), w = f.wide ? ' wide' : '';
    if (f.type === 'select') return `<label class="f${w}">${esc(f.label)}<select name="${f.name}">${f.options.map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select></label>`;
    if (f.type === 'textarea') return `<label class="f${w}">${esc(f.label)}<textarea name="${f.name}">${esc(val)}</textarea></label>`;
    if (f.type === 'checkbox') return `<label class="f chk${w}"><input type="checkbox" name="${f.name}" ${val ? 'checked' : ''}>${esc(f.label)}</label>`;
    return `<label class="f${w}">${esc(f.label)}<input name="${f.name}" type="${f.type || 'text'}" value="${esc(val)}" ${f.step ? `step="${f.step}"` : ''} ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.req ? 'required' : ''}></label>`;
  }
  function openForm(title, fields, vals, onSave, extra) {
    const ov = modal(`<h3>${esc(title)}</h3><form id="frm"><div class="form">${fields.map(f => fieldHTML(f, vals || {})).join('')}</div><div class="acts">${extra || ''}<button type="button" class="btn" data-close>Cancel</button><button class="btn pri">Save</button></div></form>`);
    $('#frm', ov).addEventListener('submit', async e => {
      e.preventDefault(); const fd = new FormData(e.target), o = {};
      fields.forEach(f => { let v = fd.get(f.name); if (f.type === 'checkbox') v = $(`[name="${f.name}"]`, ov).checked; else if (f.type === 'number') v = parseFloat(v) || 0; else if (f.num) v = Number(v); else v = (v || '').trim(); o[f.name] = v; });
      try { await onSave(o); closeModal(); } catch (err) { toast('Save failed: ' + err.message); }
    });
    return ov;
  }

  /* ---------- timer ---------- */
  function timerGet() { try { const v = localStorage.getItem('hs_timer'); return v ? JSON.parse(v) : null; } catch (e) { return memTimer; } }
  function timerSet(v) { memTimer = v; try { v ? localStorage.setItem('hs_timer', JSON.stringify(v)) : localStorage.removeItem('hs_timer'); } catch (e) {} }
  const elapsed = t => t.acc + (t.since ? Date.now() - t.since : 0);
  const hms = ms => { const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(x => String(x).padStart(2, '0')).join(':'); };

  /* ---------- views ---------- */
  function render() {
    draws = []; const v = $('#view'); $$('nav.tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.v === view ? 'page' : 'false'));
    const fn = { dashboard: vDash, blockers: vBlock, time: vTime, spend: vSpend, sync: vSync, settings: vSet }[view];
    const ae = document.activeElement, key = ae && ae.dataset && ae.dataset.filter, pos = ae && ae.selectionStart;
    v.innerHTML = S.projects.length || view === 'settings' ? fn() : emptyHTML();
    requestAnimationFrame(() => { draws.forEach(f => { try { f(); } catch (e) { console.error(e); } }); });
    if (key) { const el = $(`[data-filter="${key}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
    if (view === 'settings') loadStorageCard();
  }
  const emptyHTML = () => `<div class="card empty"><h2>No projects yet</h2><p>Add your first project or load the demo SCADA portfolio.</p><button class="btn pri" data-act="addProject">＋ New project</button> <button class="btn" data-act="demo">Load demo data</button></div>`;
  const redraw = () => { clearTimeout(redraw.t); redraw.t = setTimeout(() => draws.forEach(f => { try { f(); } catch (e) {} }), 120); };

  function kpi(l, v, s, cls) { return `<div class="card kpi ${cls || ''}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || ''}</div></div>`; }

  function vDash() {
    const P = portfolio(), open = S.blockers.filter(b => b.status !== 'Resolved'), crit = open.filter(b => b.severity === 'Critical'), over = open.filter(bOverdue), esc_ = open.filter(b => b.status === 'Escalated');
    const alerts = [];
    P.ps.forEach((p, i) => { const c = P.cs[i]; const lv = c.burn >= 100 ? ['bad', '100%'] : c.burn >= 90 ? ['bad', '90%'] : c.burn >= 75 ? ['warn', '75%'] : null; if (lv) alerts.push(`<div class="alert ${lv[0]}"><b>💰 ${lv[1]} budget threshold</b><span>${esc(p.code)} at ${n1(c.burn)}% of ${money(p.budgetAED)}</span></div>`); if (c.hrBurn >= 90) alerts.push(`<div class="alert warn"><b>⏱ Hours</b><span>${esc(p.code)} has used ${n1(c.hrBurn)}% of allocated hours</span></div>`); if (c.SPI && c.SPI < .9) alerts.push(`<div class="alert warn"><b>📉 Schedule</b><span>${esc(p.code)} SPI ${c.SPI.toFixed(2)} — behind plan</span></div>`); });
    over.forEach(b => alerts.push(`<div class="alert bad"><b>🚧 SLA breached</b><span>${esc(pcode(b.projectId))}: ${esc(b.title)} (due ${fmtD(b.slaDate)})</span></div>`));
    const cc = (v, g, a) => v >= g ? 'ok' : v >= a ? 'warn' : 'bad';
    draws.push(() => {
      CH.gauge($('#gH'), { value: P.hrBurn, max: 120, text: n1(P.hrBurn) + '%', label: 'Hours burn' });
      CH.gauge($('#gB'), { value: P.burn, max: 120, text: n1(P.burn) + '%', label: 'Budget burn' });
      CH.gauge($('#gC'), { value: P.CPI, max: 1.5, mode: 'index', text: P.CPI.toFixed(2), label: 'Portfolio CPI' });
      CH.gauge($('#gS'), { value: P.SPI, max: 1.5, mode: 'index', text: P.SPI.toFixed(2), label: 'Portfolio SPI' });
      const cs = getComputedStyle(document.documentElement), cy = cs.getPropertyValue('--cyan').trim(), am = cs.getPropertyValue('--amber').trim(), gr = cs.getPropertyValue('--green').trim();
      const lab = P.ps.map(p => p.code.replace('AGAC-', ''));
      CH.groupedBars($('#cH'), { labels: lab, series: [{ name: 'Logged h', color: cy, values: P.cs.map(c => c.hours) }, { name: 'Allocated h', color: am, values: P.ps.map(p => p.allocatedHours) }] });
      CH.groupedBars($('#cC'), { labels: lab, series: [{ name: 'Budget', color: am, values: P.ps.map(p => p.budgetAED) }, { name: 'Earned (EV)', color: gr, values: P.cs.map(c => c.EV) }, { name: 'Actual (AC)', color: cy, values: P.cs.map(c => c.AC) }] });
      const rows = BL_CATS, cols = SEV, data = rows.map(r => cols.map(s => open.filter(b => b.category === r && b.severity === s).length));
      CH.heatmap($('#cB'), { rows, cols, data, colors: [cs.getPropertyValue('--rose').trim(), am, cy, gr] });
      const keys = Object.keys(DELIV); CH.hbars($('#cD'), { labels: keys.map(k => DELIV[k]), values: keys.map(k => P.ps.length ? sum(P.ps, p => (p.deliverables || {})[k] || 0) / P.ps.length : 0) });
    });
    const queue = open.filter(b => b.status === 'Escalated' || b.severity === 'Critical').sort((a, b) => SEVRANK[a.severity] - SEVRANK[b.severity]);
    return `<div class="fade"><div class="pagehd"><h2>Executive Dashboard</h2><div class="acts"><button class="btn" data-act="addProject">＋ Project</button><button class="btn" data-act="exp" data-k="burn">⬇ Burn-rate CSV</button><button class="btn" onclick="window.print()">🖨 Print</button></div></div>
    ${alerts.length ? `<div style="margin-bottom:12px">${alerts.join('')}</div>` : ''}
    <div class="grid g4" style="margin-bottom:14px">
      ${kpi('Active projects', P.ps.length, 'Phases: ' + [...new Set(P.ps.map(p => p.phase))].join(' · '))}
      ${kpi('Hours logged', n1(P.H) + ' h', 'of ' + n1(P.A) + ' h allocated', P.hrBurn < 90 ? 'ok' : 'warn')}
      ${kpi('Actual cost', money(P.AC), 'of ' + money(P.B) + (S.settings.vat ? ' · incl. 5% VAT on spend' : ''), P.burn < 75 ? 'ok' : P.burn < 90 ? 'warn' : 'bad')}
      ${kpi('Cost variance (CV)', (P.EV - P.AC >= 0 ? '+' : '−') + money(Math.abs(P.EV - P.AC)), 'EV ' + money(P.EV), P.EV >= P.AC ? 'ok' : 'bad')}
      ${kpi('Open blockers', open.length, crit.length + ' critical · ' + over.length + ' past SLA', crit.length ? 'bad' : open.length ? 'warn' : 'ok')}
      ${kpi('Escalated to PM', esc_.length, 'Awaiting PM action', esc_.length ? 'warn' : 'ok')}
      ${kpi('MTTR', n1(mttr()) + ' d', 'Mean time to resolution', 'ok')}
      ${kpi('CPI / SPI', P.CPI.toFixed(2) + ' / ' + P.SPI.toFixed(2), '≥ 1.00 is on track', cc(Math.min(P.CPI, P.SPI), 1, .9))}
    </div>
    <div class="grid g2" style="margin-bottom:14px">
      <div class="card"><header><h3>Burn gauges — portfolio</h3></header><div class="gauges"><canvas id="gH" aria-label="Hours burn gauge"></canvas><canvas id="gB" aria-label="Budget burn gauge"></canvas><canvas id="gC" aria-label="CPI gauge"></canvas><canvas id="gS" aria-label="SPI gauge"></canvas></div></div>
      <div class="card"><header><h3>PM escalation queue</h3><button class="btn sm" data-act="nav" data-v="blockers">Open board →</button></header>${queue.length ? queue.slice(0, 6).map(b => `<div class="alert ${b.severity === 'Critical' ? 'bad' : 'warn'}"><b>${esc(b.severity)}</b><span>${esc(pcode(b.projectId))} — ${esc(b.title)} <span class="muted">· ${esc(STAT_LBL[b.status])} · ${bAge(b)}d${bOverdue(b) ? ' · SLA breached' : ''}</span></span></div>`).join('') : '<div class="empty">No critical or escalated blockers 🎉</div>'}</div>
    </div>
    <div class="grid g2" style="margin-bottom:14px">
      <div class="card"><header><h3>Hours burn rate — logged vs budgeted</h3></header><canvas class="cv" id="cH" role="img" aria-label="Logged versus allocated hours per project"></canvas></div>
      <div class="card"><header><h3>Cost: budget vs earned vs actual (${S.settings.currency === 'USD' ? 'AED shown' : 'AED'})</h3></header><canvas class="cv" id="cC" role="img" aria-label="Budget, earned value and actual cost per project"></canvas></div>
      <div class="card"><header><h3>Active blockers heatmap</h3></header><canvas class="cv lg" id="cB" role="img" aria-label="Open blockers by category and severity"></canvas></div>
      <div class="card"><header><h3>Schedule & deliverable health</h3></header><canvas class="cv lg" id="cD" role="img" aria-label="Average deliverable completion"></canvas></div>
    </div>
    <div class="card"><header><h3>Project earned-value register</h3></header><div class="tw"><table><thead><tr><th>Project</th><th>Phase</th><th class="n">Hours</th><th>Hrs burn</th><th class="n">Budget</th><th class="n">Actual</th><th>Burn</th><th class="n">CV</th><th class="n">CPI</th><th class="n">SPI</th><th>Annexure</th><th></th></tr></thead><tbody>
    ${P.ps.map((p, i) => { const c = P.cs[i]; return `<tr><td><b>${esc(p.code)}</b><br><span class="muted small">${esc(p.name)} · ${esc(p.client)}</span></td><td>${esc(p.phase)}</td><td class="n">${n1(c.hours)}/${p.allocatedHours}</td><td><div class="prog ${c.hrBurn >= 100 ? 'bad' : c.hrBurn >= 85 ? 'warn' : ''}"><i style="width:${Math.min(100, c.hrBurn)}%"></i></div></td><td class="n">${money(p.budgetAED)}</td><td class="n">${money(c.AC)}</td><td><div class="prog ${c.burn >= 90 ? 'bad' : c.burn >= 75 ? 'warn' : ''}"><i style="width:${Math.min(100, c.burn)}%"></i></div><span class="small mono">${n1(c.burn)}%</span></td><td class="n" style="color:var(--${c.CV >= 0 ? 'green' : 'rose'})">${c.CV >= 0 ? '+' : '−'}${money(Math.abs(c.CV))}</td><td class="n">${c.CPI.toFixed(2)}</td><td class="n">${c.SPI.toFixed(2)}</td><td>${badge(p.annexureStatus || 'Pending', p.annexureStatus === 'Compliant' ? 'ok' : p.annexureStatus === 'Non-Compliant' ? 'bad' : 'warn')}</td><td><button class="btn sm" data-act="editProject" data-id="${p.id}">Edit</button></td></tr>`; }).join('')}
    </tbody></table></div></div></div>`;
  }

  /* --- blockers --- */
  function blFiltered() {
    return S.blockers.filter(b => (!blF.project || String(b.projectId) === blF.project) && (!blF.severity || b.severity === blF.severity) && (blF.resolved || b.status !== 'Resolved' || blView === 'kanban') && (!blF.q || (b.title + b.rootCause + b.actionPlan + b.category).toLowerCase().includes(blF.q.toLowerCase())))
      .sort((a, b) => SEVRANK[a.severity] - SEVRANK[b.severity] || bAge(b) - bAge(a));
  }
  function bCard(b) {
    const od = bOverdue(b), a = bAge(b), idx = STAT.indexOf(b.status);
    return `<div class="bc ${esc(b.severity)}" draggable="true" data-id="${b.id}"><div class="row" style="margin:0;justify-content:space-between"><label class="small"><input type="checkbox" data-act="selB" data-id="${b.id}" ${sel.has(b.id) ? 'checked' : ''} aria-label="Select blocker"> ${esc(pcode(b.projectId))}</label>${badge(b.severity)}</div><div class="t">${esc(b.title)}</div><div class="muted small">${esc(b.category)} · → ${esc(b.assignedTo)}</div><div class="row">${badge(a + 'd old', a > 7 ? 'bad' : a > 3 ? 'warn' : 'dim')}${b.status !== 'Resolved' ? badge('SLA ' + fmtD(b.slaDate), od ? 'bad' : 'dim') : ''}${b.impactHours ? badge(b.impactHours + ' h · ' + money(b.impactAED), 'info') : ''}</div><div class="row">${idx > 0 ? `<button class="btn sm" data-act="mvB" data-id="${b.id}" data-d="-1" title="Move back">◀</button>` : ''}<button class="btn sm" data-act="editBlocker" data-id="${b.id}">Edit</button>${idx < 3 ? `<button class="btn sm pri" data-act="mvB" data-id="${b.id}" data-d="1" title="Advance">${esc(STAT_LBL[STAT[idx + 1]])} ▶</button>` : ''}</div></div>`;
  }
  function vBlock() {
    const list = blFiltered(), open = S.blockers.filter(b => b.status !== 'Resolved'), over = open.filter(bOverdue), aged = open.filter(b => bAge(b) > 7);
    return `<div class="fade"><div class="pagehd"><h2>Blocker Elimination & PM Escalation Board</h2><div class="acts"><button class="btn pri" data-act="addBlocker">＋ Blocker</button><button class="btn amb" data-act="brief">📋 PM Escalation Brief${sel.size ? ' (' + sel.size + ')' : ''}</button><button class="btn" data-act="escSel" ${sel.size ? '' : 'disabled'}>⬆ Escalate selected</button><button class="btn" data-act="exp" data-k="blockers">⬇ CSV</button></div></div>
    <div class="grid g4" style="margin-bottom:12px">${kpi('Open', open.length, 'unresolved', open.length ? 'warn' : 'ok')}${kpi('MTTR', n1(mttr()) + ' d', 'mean time to resolve', 'ok')}${kpi('Past SLA', over.length, 'needs action', over.length ? 'bad' : 'ok')}${kpi('Aging > 7 d', aged.length, 'aging alerts', aged.length ? 'warn' : 'ok')}</div>
    ${aged.slice(0, 3).map(b => `<div class="alert warn"><b>⏳ Aging</b><span>${esc(pcode(b.projectId))}: ${esc(b.title)} — open ${bAge(b)} days</span></div>`).join('')}
    <div class="filters"><select class="inp" data-filter="project" aria-label="Project">${projOpts(blF.project, 'All projects')}</select><select class="inp" data-filter="severity" aria-label="Severity"><option value="">All severities</option>${opt(SEV, blF.severity)}</select><input class="inp" data-filter="q" placeholder="Search…" value="${esc(blF.q)}" aria-label="Search"><label class="chip" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-filter="resolved" ${blF.resolved ? 'checked' : ''}> Show resolved (table)</label><span class="sp" style="flex:1"></span><button class="chip" aria-pressed="${blView === 'kanban'}" data-act="blView" data-v="kanban">Board</button><button class="chip" aria-pressed="${blView === 'table'}" data-act="blView" data-v="table">Table</button></div>
    ${blView === 'kanban' ? `<div class="kan">${STAT.map(s => { const cs = list.filter(b => b.status === s); return `<div class="col" data-status="${s}"><h4><span>${esc(STAT_LBL[s])}</span><span class="muted">${cs.length}</span></h4>${cs.map(bCard).join('') || '<div class="muted small">Drop here</div>'}</div>`; }).join('')}</div>` :
        `<div class="card tw"><table><thead><tr><th></th><th>Sev</th><th>Project</th><th>Blocker</th><th>Category</th><th>Owner</th><th>Status</th><th class="n">Age</th><th>SLA</th><th class="n">Impact</th><th></th></tr></thead><tbody>${list.map(b => `<tr><td><input type="checkbox" data-act="selB" data-id="${b.id}" ${sel.has(b.id) ? 'checked' : ''} aria-label="Select"></td><td>${badge(b.severity)}</td><td>${esc(pcode(b.projectId))}</td><td>${esc(b.title)}</td><td>${esc(b.category)}</td><td>${esc(b.assignedTo)}</td><td>${badge(STAT_LBL[b.status], b.status === 'Resolved' ? 'ok' : b.status === 'Escalated' ? 'bad' : 'info')}</td><td class="n">${bAge(b)}d</td><td style="color:var(--${bOverdue(b) ? 'rose' : 'muted'})">${fmtD(b.slaDate)}</td><td class="n">${b.impactHours || 0} h / ${money(b.impactAED || 0)}</td><td><button class="btn sm" data-act="editBlocker" data-id="${b.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="11" class="empty">No blockers match</td></tr>'}</tbody></table></div>`}</div>`;
  }
  function blockerForm(b) {
    const v = b || { projectId: (S.projects[0] || {}).id, severity: 'Medium', status: 'Open', assignedTo: 'SCADA Engineer', category: BL_CATS[0], slaDate: D.addDays(today(), 5), impactHours: 0, impactAED: 0 };
    openForm(b ? 'Edit blocker' : 'New blocker', [
      { name: 'projectId', label: 'Project', type: 'select', num: true, options: S.projects.map(p => [p.id, p.code + ' — ' + p.name]), wide: true }, { name: 'title', label: 'Blocker title', req: true, wide: true },
      { name: 'category', label: 'Category', type: 'select', options: BL_CATS }, { name: 'severity', label: 'Severity', type: 'select', options: SEV }, { name: 'assignedTo', label: 'Assigned to', type: 'select', options: ASSIGN }, { name: 'status', label: 'Status', type: 'select', options: STAT.map(s => [s, STAT_LBL[s]]) },
      { name: 'slaDate', label: 'SLA target date', type: 'date' }, { name: 'impactHours', label: 'Est. impact (hours)', type: 'number', step: '0.5', min: 0 }, { name: 'impactAED', label: 'Est. impact (AED)', type: 'number', step: '50', min: 0 },
      { name: 'rootCause', label: 'Root cause', type: 'textarea', wide: true }, { name: 'actionPlan', label: 'Action plan', type: 'textarea', wide: true }], v, async o => {
      const rec = Object.assign({}, b || { createdDate: today(), createdAt: new Date().toISOString(), resolvedDate: null }, o); applyStatus(rec, b && b.status); rec.escalated = rec.status === 'Escalated' || rec.escalated && rec.status !== 'Resolved'; await D.put('blockers', rec); await refresh(); toast('Blocker saved');
    }, b ? `<button type="button" class="btn dng" data-act="delBlocker" data-id="${b.id}">Delete</button>` : '');
  }
  function applyStatus(rec, old) { if (rec.status === 'Resolved' && old !== 'Resolved') rec.resolvedDate = today(); if (rec.status !== 'Resolved') rec.resolvedDate = null; if (rec.status === 'Escalated') { rec.escalated = true; rec.escalatedOn = rec.escalatedOn || today(); } }
  async function moveBlocker(id, status) { const b = S.blockers.find(x => x.id === Number(id)); if (!b || b.status === status) return; const old = b.status; b.status = status; applyStatus(b, old); await D.put('blockers', b); await refresh(); toast(pcode(b.projectId) + ' → ' + STAT_LBL[status]); }
  function briefText() {
    let list = S.blockers.filter(b => sel.has(b.id)); if (!list.length) list = S.blockers.filter(b => b.status !== 'Resolved'); list.sort((a, b) => SEVRANK[a.severity] - SEVRANK[b.severity]);
    const pms = [...new Set(list.map(b => (proj(b.projectId) || {}).pm).filter(Boolean))].join(', ') || 'Project Manager';
    const th = sum(list, b => b.impactHours || 0), ta = sum(list, b => b.impactAED || 0);
    let t = `ESCALATION BRIEF — ${D.nowGST()}\nFrom: ${S.settings.engineer}, Al Gurg Automation and Controls (Dubai, UAE)\nTo: ${pms}\nRef: QHSE Annexure-SCT-HR-001\n\nSUMMARY: ${list.length} blocker(s) · ${list.filter(b => b.severity === 'Critical').length} critical · est. impact ${th} h / ${money(ta)}\n${'─'.repeat(46)}\n`;
    list.forEach((b, i) => { t += `\n${i + 1}. [${b.severity.toUpperCase()}] ${b.title}\n   Project : ${pcode(b.projectId)} — ${(proj(b.projectId) || {}).name || ''}\n   Status  : ${STAT_LBL[b.status]} · open ${bAge(b)} d · owner: ${b.assignedTo}\n   SLA     : ${fmtD(b.slaDate)}${bOverdue(b) ? '  ⚠ BREACHED' : ''}\n   Cause   : ${b.rootCause || 'TBC'}\n   Action  : ${b.actionPlan || 'TBC'}\n   Impact  : ${b.impactHours || 0} h / ${money(b.impactAED || 0)}\n   Ask     : ${b.assignedTo === 'Project Manager' ? 'PM decision / action required' : 'PM support to unblock with ' + b.assignedTo}\n`; });
    return t + `\nPlease confirm owners & dates in the next PM sync.\n— ${S.settings.engineer}`;
  }

  /* --- timesheet --- */
  function vTime() {
    const t = timerGet(), run = t && t.since, td = today();
    const rangeDays = tsRange === 'week' ? 7 : 35; const from = D.addDays(td, -(rangeDays - 1));
    const logs = S.time_logs.filter(l => l.date >= from), byW = WORK.map(w => sum(logs.filter(l => l.workType === w), l => l.hours));
    const cats = TASKS.map(c => sum(logs.filter(l => l.category === c), l => l.hours));
    draws.push(() => {
      const cs = getComputedStyle(document.documentElement), col = [cs.getPropertyValue('--cyan').trim(), cs.getPropertyValue('--amber').trim(), cs.getPropertyValue('--green').trim()];
      CH.donut($('#cU'), { labels: WORK, values: byW, colors: col, center: n1(sum(byW, x => x)) + ' h' });
      let labels = [], buckets = [];
      if (tsRange === 'week') for (let i = 6; i >= 0; i--) { const d = D.addDays(td, -i); labels.push(new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })); buckets.push([d, d]); }
      else for (let i = 4; i >= 0; i--) { const e = D.addDays(td, -i * 7), s = D.addDays(e, -6); labels.push(s.slice(8) + '/' + s.slice(5, 7)); buckets.push([s, e]); }
      CH.stackedBars($('#cW'), { labels, series: WORK.map((w, j) => ({ name: w, color: col[j], values: buckets.map(([s, e]) => sum(S.time_logs.filter(l => l.date >= s && l.date <= e && l.workType === w), l => l.hours)) })) });
      CH.hbars($('#cT'), { labels: TASKS, values: cats, max: Math.max(1, ...cats), unit: ' h', colors: TASKS.map(() => col[0]) });
    });
    const recent = [...S.time_logs].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 40);
    const totalH = sum(logs, l => l.hours), billH = sum(logs.filter(l => l.billable), l => l.hours);
    return `<div class="fade"><div class="pagehd"><h2>Working Hours & Timesheet Monitor</h2><div class="acts"><button class="btn" data-act="exp" data-k="time">⬇ Timesheet CSV</button></div></div>
    <div class="grid g2" style="margin-bottom:14px">
      <div class="card"><header><h3>Live work timer</h3>${t ? badge(run ? 'RUNNING' : 'PAUSED', run ? 'ok' : 'warn') : ''}</header><div id="timerDisp" class="timer ${run ? 'run' : ''}">${hms(t ? elapsed(t) : 0)}</div>
        <div class="form" style="margin:12px 0"><label class="f">Project<select id="tP" ${t ? 'disabled' : ''}>${projOpts(t ? t.projectId : qProject)}</select></label><label class="f">SCADA task<select id="tC" ${t ? 'disabled' : ''}>${opt(TASKS, t && t.category)}</select></label><label class="f">Work type<select id="tW" ${t ? 'disabled' : ''}>${opt(WORK, t && t.workType)}</select></label></div>
        <div class="acts" style="justify-content:center;margin:0">${run ? '<button class="btn amb" data-act="tPause">⏸ Pause</button>' : `<button class="btn pri" data-act="tStart">▶ ${t ? 'Resume' : 'Start'}</button>`}<button class="btn" data-act="tLog" ${t ? '' : 'disabled'}>✔ Stop & log</button><button class="btn dng" data-act="tDiscard" ${t ? '' : 'disabled'}>Discard</button></div></div>
      <div class="card"><header><h3>Quick manual log</h3></header><form id="qlog" class="form"><label class="f">Project<select name="projectId">${projOpts(qProject)}</select></label><label class="f">Date<input type="date" name="date" value="${td}" required></label><label class="f">Hours<input type="number" name="hours" step="0.25" min="0.25" max="24" value="1" required></label><label class="f">SCADA task<select name="category">${opt(TASKS)}</select></label><label class="f">Work type<select name="workType">${opt(WORK)}</select></label><label class="f">Rate (AED/h)<input type="number" name="rate" min="0" step="5" value="${S.settings.rate}"></label><label class="f wide">Notes<input name="notes" placeholder="What was done?"></label><div class="wide"><button class="btn pri">＋ Add log</button></div></form></div>
    </div>
    <div class="pagehd"><h3 class="muted">Utilization</h3><div class="acts"><button class="chip" aria-pressed="${tsRange === 'week'}" data-act="tsRange" data-v="week">Weekly</button><button class="chip" aria-pressed="${tsRange === 'month'}" data-act="tsRange" data-v="month">Monthly</button></div></div>
    <div class="grid g3" style="margin-bottom:14px"><div class="card"><header><h3>Work type split</h3></header><canvas class="cv sm" id="cU" role="img" aria-label="Utilization by work type"></canvas><div class="small muted">Billable ${n1(billH)} h of ${n1(totalH)} h (${n1(pct(billH, totalH))}%)</div></div><div class="card"><header><h3>${tsRange === 'week' ? 'Daily' : 'Weekly'} hours</h3></header><canvas class="cv" id="cW" role="img" aria-label="Hours by period"></canvas></div><div class="card"><header><h3>Hours by SCADA task</h3></header><canvas class="cv" id="cT" role="img" aria-label="Hours by task category"></canvas></div></div>
    <div class="card"><header><h3>Recent time logs</h3></header><div class="tw"><table><thead><tr><th>Date</th><th>Project</th><th>Task</th><th>Type</th><th class="n">Hours</th><th class="n">Cost</th><th>Notes</th><th></th></tr></thead><tbody>${recent.map(l => `<tr><td>${fmtD(l.date)}</td><td>${esc(pcode(l.projectId))}</td><td>${esc(l.category)}</td><td>${esc(l.workType || '')}${l.billable ? '' : ' <span class="muted">(non-bill.)</span>'}</td><td class="n">${n1(l.hours)}</td><td class="n">${money(l.hours * l.rate)}</td><td>${esc(l.notes)}</td><td><button class="btn sm" data-act="editLog" data-id="${l.id}">Edit</button> <button class="btn sm dng" data-act="delLog" data-id="${l.id}" aria-label="Delete">✕</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">No logs yet</td></tr>'}</tbody></table></div></div></div>`;
  }
  function logForm(l) {
    openForm('Edit time log', [{ name: 'projectId', label: 'Project', type: 'select', num: true, options: S.projects.map(p => [p.id, p.code]) }, { name: 'date', label: 'Date', type: 'date', req: true }, { name: 'hours', label: 'Hours', type: 'number', step: '0.25', min: 0 }, { name: 'rate', label: 'Rate AED/h', type: 'number', step: '5' }, { name: 'category', label: 'SCADA task', type: 'select', options: TASKS }, { name: 'workType', label: 'Work type', type: 'select', options: WORK }, { name: 'billable', label: 'Billable', type: 'checkbox' }, { name: 'notes', label: 'Notes', wide: true }], l, async o => { await D.put('time_logs', Object.assign({}, l, o)); await refresh(); toast('Log updated'); });
  }

  /* --- spend --- */
  function vSpend() {
    const P = portfolio(), list = S.expenditures.filter(e => (!spF.project || String(e.projectId) === spF.project) && (!spF.cat || e.category === spF.cat)).sort((a, b) => b.date.localeCompare(a.date));
    const tot = sum(list.filter(e => e.approval !== 'Rejected'), e => e.amountAED) * vatF(), pend = sum(list.filter(e => e.approval === 'Pending'), e => e.amountAED) * vatF(), vo = sum(list.filter(e => e.category === 'Variation Order' && e.approval !== 'Rejected'), e => e.amountAED) * vatF();
    return `<div class="fade"><div class="pagehd"><h2>Expenditure, BOM & Procurement Tracker</h2><div class="acts"><button class="btn pri" data-act="addExp">＋ Expenditure</button><button class="btn" data-act="exp" data-k="spend">⬇ CSV</button></div></div>
    <div class="grid g4" style="margin-bottom:12px">${kpi('Filtered spend', money(tot), S.settings.vat ? 'incl. 5% UAE VAT' : 'excl. VAT')}${kpi('Pending approval', money(pend), 'awaiting PM / client', pend ? 'warn' : 'ok')}${kpi('Variation orders', money(vo), 'approved + pending')}${kpi('Line items', list.length, 'in current filter')}</div>
    <div class="card" style="margin-bottom:14px"><header><h3>Budget burn per project (labour + procurement)</h3></header><div class="bars">${P.ps.map((p, i) => { const c = P.cs[i], cl = c.burn >= 90 ? 'bad' : c.burn >= 75 ? 'warn' : ''; return `<div class="row"><span class="lb"><b>${esc(p.code.replace('AGAC-', ''))}</b></span><div class="prog ${cl}"><i style="width:${Math.min(100, c.burn)}%"></i></div><span class="vl">${n1(c.burn)}%</span>${c.burn >= 100 ? badge('≥100%', 'bad') : c.burn >= 90 ? badge('≥90%', 'bad') : c.burn >= 75 ? badge('≥75%', 'warn') : badge('OK', 'ok')}<span class="muted small">${money(c.AC)} / ${money(p.budgetAED)}</span></div>`; }).join('')}</div></div>
    <div class="filters"><select class="inp" data-filter="sp_project" aria-label="Project">${projOpts(spF.project, 'All projects')}</select><select class="inp" data-filter="sp_cat" aria-label="Category"><option value="">All categories</option>${opt(EXP_CATS, spF.cat)}</select></div>
    <div class="card tw"><table><thead><tr><th>Date</th><th>Project</th><th>Category</th><th>Item</th><th>Vendor</th><th>Invoice</th><th class="n">Amount</th><th>Approval</th><th></th></tr></thead><tbody>${list.map(e => `<tr><td>${fmtD(e.date)}</td><td>${esc(pcode(e.projectId))}</td><td>${esc(e.category)}</td><td>${esc(e.item || '')}</td><td>${esc(e.vendor)}</td><td class="mono small">${esc(e.invoiceRef)}</td><td class="n">${money(e.amountAED * vatF())}</td><td>${badge(e.approval, e.approval === 'Approved' ? 'ok' : e.approval === 'Rejected' ? 'bad' : 'warn')}</td><td><button class="btn sm" data-act="editExp" data-id="${e.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="9" class="empty">No expenditure</td></tr>'}</tbody></table></div></div>`;
  }
  function expForm(e) {
    const v = e || { projectId: (S.projects[0] || {}).id, date: today(), category: EXP_CATS[0], approval: 'Pending' };
    openForm(e ? 'Edit expenditure' : 'New expenditure', [{ name: 'projectId', label: 'Project', type: 'select', num: true, options: S.projects.map(p => [p.id, p.code + ' — ' + p.name]), wide: true }, { name: 'item', label: 'Item / description', req: true, wide: true }, { name: 'category', label: 'Category', type: 'select', options: EXP_CATS }, { name: 'amountAED', label: 'Amount (AED, excl. VAT)', type: 'number', step: '0.01', min: 0, req: true }, { name: 'vendor', label: 'Vendor' }, { name: 'invoiceRef', label: 'Invoice ref' }, { name: 'date', label: 'Date', type: 'date' }, { name: 'approval', label: 'Approval status', type: 'select', options: APPROVAL }], v, async o => { await D.put('expenditures', Object.assign({ timestamp: new Date().toISOString() }, e || {}, o)); await refresh(); toast('Expenditure saved'); }, e ? `<button type="button" class="btn dng" data-act="delExp" data-id="${e.id}">Delete</button>` : '');
  }

  /* --- sync / qhse --- */
  const qState = id => { const r = S.qhse.find(q => q.projectId === id); return r || { projectId: id, items: {} }; };
  function annexure(id) { const n = QHSE.filter((_, i) => qState(id).items[i + 1]).length; return n === QHSE.length ? 'Compliant' : n === 0 ? 'Pending' : 'In Progress'; }
  function vSync() {
    const pid = qProject && proj(qProject) ? qProject : (S.projects[0] || {}).id, q = qState(pid), done = QHSE.filter((_, i) => q.items[i + 1]).length;
    const notes = [...S.pm_sync_notes].sort((a, b) => b.date.localeCompare(a.date));
    return `<div class="fade"><div class="pagehd"><h2>PM Weekly Sync & Annexure-SCT-HR-001 Checklist</h2><div class="acts"><button class="btn pri" data-act="addNote">＋ Sync note</button></div></div><div class="grid g2">
      <div class="card"><header><h3>QHSE / documentation checklist</h3><select class="inp" style="width:auto" data-filter="qproj" aria-label="Project">${projOpts(pid)}</select></header>
      <div class="hd"><span class="small muted">Tracking markers aligned with Annexure-SCT-HR-001 — adapt wording to the controlled document.</span>${badge(annexure(pid), annexure(pid) === 'Compliant' ? 'ok' : annexure(pid) === 'Pending' ? 'bad' : 'warn')}</div>
      <div class="prog ${done === QHSE.length ? '' : 'warn'}" style="margin-bottom:6px"><i style="width:${done / QHSE.length * 100}%"></i></div><div class="small muted" style="margin-bottom:6px">${done}/${QHSE.length} complete${q.updated ? ' · updated ' + fmtD(q.updated) : ''}</div>
      ${QHSE.map((t, i) => `<label class="ck"><input type="checkbox" data-act="qTog" data-i="${i + 1}" data-p="${pid}" ${q.items[i + 1] ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div>
      <div class="card"><header><h3>Weekly PM alignment log</h3></header>${notes.map(n => `<div class="card" style="margin-bottom:10px;background:var(--panel2)"><div class="hd" style="margin-bottom:4px"><b>${fmtD(n.date)} · ${esc(n.pmName)}</b><span>${n.projectId ? badge(pcode(n.projectId), 'info') : ''} ${badge(n.blockersCleared + ' cleared', 'ok')} <button class="btn sm dng" data-act="delNote" data-id="${n.id}" aria-label="Delete">✕</button></span></div><div class="small"><b>Actions:</b> ${esc(n.actionItems)}</div><div class="small"><b>Schedule variance:</b> ${esc(n.variance)}</div></div>`).join('') || '<div class="empty">No sync notes yet</div>'}</div></div></div>`;
  }
  function noteForm() {
    openForm('PM sync note', [{ name: 'date', label: 'Meeting date', type: 'date', req: true }, { name: 'pmName', label: 'PM name', req: true }, { name: 'projectId', label: 'Project', type: 'select', num: true, options: [[0, 'All / portfolio']].concat(S.projects.map(p => [p.id, p.code])) }, { name: 'blockersCleared', label: 'Blockers cleared', type: 'number', min: 0 }, { name: 'actionItems', label: 'Action items', type: 'textarea', wide: true }, { name: 'variance', label: 'Schedule variance summary', type: 'textarea', wide: true }], { date: today(), pmName: (S.projects[0] || {}).pm || '', projectId: 0, blockersCleared: 0 }, async o => { await D.add('pm_sync_notes', o); await refresh(); toast('Sync note saved'); });
  }

  /* --- settings --- */
  function vSet() {
    const s = S.settings;
    return `<div class="fade"><div class="pagehd"><h2>Settings, Storage & Data Lifecycle</h2></div><div class="grid g2">
    <div class="card"><header><h3>Preferences</h3></header><div class="form"><label class="f">Engineer name<input data-set="engineer" value="${esc(s.engineer)}"></label><label class="f">Default rate (AED/h)<input data-set="rate" type="number" value="${s.rate}" min="0"></label><label class="f">USD per AED rate (AED→USD uses 1 USD = ? AED)<input data-set="usdRate" type="number" step="0.0001" value="${s.usdRate}"></label><label class="f">Theme<select data-set="theme">${['auto', 'dark', 'light'].map(t => `<option ${t === s.theme ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label class="f">Currency<select data-set="currency"><option ${s.currency === 'AED' ? 'selected' : ''}>AED</option><option ${s.currency === 'USD' ? 'selected' : ''}>USD</option></select></label><label class="f chk"><input type="checkbox" data-set="vat" ${s.vat ? 'checked' : ''}> Add 5% UAE VAT to expenditure</label></div><p class="small muted">AED is pegged at 3.6725 per USD. All values are stored in AED and converted for display. Timestamps use Gulf Standard Time (UTC+4).</p></div>
    <div class="card"><header><h3>Storage health & 3-year capacity</h3></header><div id="stor">Loading…</div></div>
    <div class="card"><header><h3>Backup & restore</h3></header><p class="small muted">Full snapshot of all IndexedDB stores as a single .json file. Export weekly; keep a copy off-device.</p><div class="acts" style="justify-content:flex-start"><button class="btn pri" data-act="backup">⬇ Export JSON snapshot</button><label class="btn">⬆ Restore snapshot<input type="file" id="restore" accept=".json,application/json" hidden></label></div></div>
    <div class="card"><header><h3>Excel-ready reports (CSV)</h3></header><div class="acts" style="justify-content:flex-start"><button class="btn" data-act="exp" data-k="time">Timesheets</button><button class="btn" data-act="exp" data-k="burn">Burn-rate ledger</button><button class="btn" data-act="exp" data-k="blockers">PM blocker escalation log</button><button class="btn" data-act="exp" data-k="spend">Expenditures</button></div></div>
    <div class="card"><header><h3>Multi-year fiscal archiver</h3></header><p class="small muted">Rolls timesheets, expenditures and resolved blockers older than the chosen period into per-project summary rows. Hours, cost, CPI and MTTR stay accurate; raw rows are removed to keep the database fast. A backup is downloaded first.</p><div class="acts" style="justify-content:flex-start"><select id="arcM" class="inp" style="width:auto"><option value="12">Older than 12 months</option><option value="24">Older than 24 months</option><option value="36">Older than 36 months</option></select><button class="btn amb" data-act="archive">Archive now</button></div>
      <div class="small muted" style="margin-top:8px">Archive summaries: ${S.archive_summaries.length}</div></div>
    <div class="card"><header><h3>Data</h3></header><div class="acts" style="justify-content:flex-start"><button class="btn" data-act="demo">Reload demo data</button><button class="btn dng" data-act="wipe">Erase all data</button></div><p class="small muted">HourSync stores everything locally on this device (IndexedDB). Nothing is uploaded. Sample projects are illustrative demo data — replace with your real figures.</p></div></div></div>`;
  }
  async function loadStorageCard() {
    const i = await D.storageInfo(), el = $('#stor'); if (!el) return;
    const recs = Object.entries(i.counts).filter(([k]) => k !== 'settings'), total = sum(recs, r => r[1]);
    const snap = JSON.stringify(await D.exportAll()).length; const span = Math.max(30, S.time_logs.length ? D.daysBetween(S.time_logs.reduce((m, l) => l.date < m ? l.date : m, D.today()), D.today()) : 30);
    const proj3 = snap / span * 1095;
    el.innerHTML = `<div class="meter" role="progressbar" aria-valuenow="${i.pct.toFixed(2)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(1, Math.min(100, i.pct))}%"></i></div><div class="hd" style="margin:6px 0"><span class="mono">${bytes(i.usage)} / ${bytes(i.quota)}</span><span class="mono">${i.pct.toFixed(3)}%</span></div>
    <div>${i.persisted ? badge('Persistent storage granted', 'ok') : badge('Not yet persistent', 'warn')} ${i.persisted ? '' : '<button class="btn sm" data-act="persist">Request persistence</button>'}</div>
    <p class="small">Dataset size ≈ <b>${bytes(snap)}</b> for ${total} records over ~${span} days. Projected 3-year size ≈ <b>${bytes(proj3)}</b> ${i.quota ? '(' + (proj3 / i.quota * 100).toFixed(2) + '% of quota)' : ''}. IndexedDB has no 5 MB limit.</p>
    <div class="tw"><table><tbody>${recs.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${v}</td></tr>`).join('')}</tbody></table></div>`;
  }

  /* ---------- CSV exports ---------- */
  function exportCSV(k) {
    const stamp = today(); let name, csv;
    if (k === 'time') { name = 'HourSync_Timesheets_' + stamp; csv = D.toCSV([...S.time_logs].sort((a, b) => a.date.localeCompare(b.date)), [['Date', 'date'], ['Engineer', l => l.engineer || S.settings.engineer], ['Project', l => pcode(l.projectId)], ['Task', 'category'], ['Work type', 'workType'], ['Billable', l => l.billable ? 'Yes' : 'No'], ['Hours', 'hours'], ['Rate AED', 'rate'], ['Cost AED', l => (l.hours * l.rate).toFixed(2)], ['Notes', 'notes']]); }
    else if (k === 'spend') { name = 'HourSync_Expenditures_' + stamp; csv = D.toCSV(S.expenditures, [['Date', 'date'], ['Project', e => pcode(e.projectId)], ['Category', 'category'], ['Item', 'item'], ['Vendor', 'vendor'], ['Invoice', 'invoiceRef'], ['Amount AED (excl VAT)', 'amountAED'], ['VAT 5%', e => (e.amountAED * .05).toFixed(2)], ['Approval', 'approval']]); }
    else if (k === 'blockers') { name = 'HourSync_PM_Blocker_Escalation_Log_' + stamp; csv = D.toCSV(S.blockers, [['Project', b => pcode(b.projectId)], ['Title', 'title'], ['Category', 'category'], ['Severity', 'severity'], ['Assigned to', 'assignedTo'], ['Status', 'status'], ['Escalated to PM', b => b.escalated ? 'Yes' : 'No'], ['Created', 'createdDate'], ['SLA', 'slaDate'], ['Resolved', 'resolvedDate'], ['Age days', bAge], ['Root cause', 'rootCause'], ['Action plan', 'actionPlan'], ['Impact h', 'impactHours'], ['Impact AED', 'impactAED']]); }
    else { name = 'HourSync_Burn_Rate_Ledger_' + stamp; csv = D.toCSV(S.projects.map(p => Object.assign({ p }, pcalc(p))), [['Code', r => r.p.code], ['Project', r => r.p.name], ['Client', r => r.p.client], ['PM', r => r.p.pm], ['Phase', r => r.p.phase], ['Budget AED', r => r.p.budgetAED], ['Allocated h', r => r.p.allocatedHours], ['Logged h', r => r.hours.toFixed(2)], ['Hours burn %', r => r.hrBurn.toFixed(1)], ['Labour AED', r => r.labor.toFixed(2)], ['Spend AED', r => r.spend.toFixed(2)], ['Actual cost AED', r => r.AC.toFixed(2)], ['Earned value AED', r => r.EV.toFixed(2)], ['CV AED', r => r.CV.toFixed(2)], ['CPI', r => r.CPI.toFixed(2)], ['SPI', r => r.SPI.toFixed(2)], ['Budget burn %', r => r.burn.toFixed(1)], ['Annexure-SCT-HR-001', r => r.p.annexureStatus]]); }
    D.download(name + '.csv', csv); toast('Exported ' + name + '.csv');
  }

  /* ---------- projects form ---------- */
  function projectForm(p) {
    const d = (p && p.deliverables) || {}, v = p ? Object.assign({ dHmi: d.hmi, dPlc: d.plc, dSql: d.sql, dQa: d.qa }, p) : { phase: 'Design', status: 'Active', progressPct: 0, plannedPct: 0, pm: '', budgetAED: 100000, allocatedHours: 400, startDate: today(), dHmi: 0, dPlc: 0, dSql: 0, dQa: 0 };
    openForm(p ? 'Edit project' : 'New project', [{ name: 'code', label: 'Project code', req: true }, { name: 'name', label: 'Project name', req: true }, { name: 'client', label: 'Client (UAE)' }, { name: 'pm', label: 'PM name' }, { name: 'budgetAED', label: 'Total budget (AED)', type: 'number', min: 0, step: '100' }, { name: 'allocatedHours', label: 'Allocated hours', type: 'number', min: 0 }, { name: 'phase', label: 'Phase', type: 'select', options: PHASES }, { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Closed'] }, { name: 'progressPct', label: 'Actual progress % (earned)', type: 'number', min: 0, max: 100 }, { name: 'plannedPct', label: 'Planned progress %', type: 'number', min: 0, max: 100 }, { name: 'dHmi', label: 'Wonderware Graphics %', type: 'number', min: 0, max: 100 }, { name: 'dPlc', label: 'PLC Comms %', type: 'number', min: 0, max: 100 }, { name: 'dSql', label: 'SQL Historians %', type: 'number', min: 0, max: 100 }, { name: 'dQa', label: 'QA / FAT %', type: 'number', min: 0, max: 100 }, { name: 'startDate', label: 'Start date', type: 'date' }], v, async o => {
      const rec = Object.assign({ annexureStatus: 'Pending', createdAt: new Date().toISOString(), currency: 'AED' }, p || {}, o); rec.deliverables = { hmi: o.dHmi, plc: o.dPlc, sql: o.dSql, qa: o.dQa }; ['dHmi', 'dPlc', 'dSql', 'dQa'].forEach(k => delete rec[k]);
      await D.put('projects', rec); await refresh(); toast('Project saved');
    });
  }

  /* ---------- events ---------- */
  document.addEventListener('click', async e => {
    const c = e.target.closest('[data-close]'); if (c) return closeModal();
    const el = e.target.closest('[data-act]'); if (!el) return; const a = el.dataset.act, id = Number(el.dataset.id);
    try {
      switch (a) {
        case 'nav': go(el.dataset.v); break;
        case 'addProject': projectForm(); break;
        case 'editProject': projectForm(proj(id)); break;
        case 'addBlocker': blockerForm(); break;
        case 'editBlocker': blockerForm(S.blockers.find(b => b.id === id)); break;
        case 'delBlocker': if (confirm('Delete this blocker?')) { await D.del('blockers', id); closeModal(); await refresh(); } break;
        case 'mvB': { const b = S.blockers.find(x => x.id === id); await moveBlocker(id, STAT[Math.max(0, Math.min(3, STAT.indexOf(b.status) + Number(el.dataset.d)))]); break; }
        case 'blView': blView = el.dataset.v; render(); break;
        case 'brief': { const t = briefText(); const ov = modal(`<h3>PM Escalation Brief</h3><pre class="brief" id="briefTxt">${esc(t)}</pre><div class="acts"><button class="btn" data-close>Close</button><button class="btn" id="bDl">⬇ .txt</button>${navigator.share ? '<button class="btn" id="bSh">Share</button>' : ''}<button class="btn pri" id="bCp">Copy</button></div>`);
          $('#bCp', ov).onclick = async () => { try { await navigator.clipboard.writeText(t); } catch (er) { const r = document.createRange(); r.selectNodeContents($('#briefTxt')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('copy'); } toast('Brief copied'); };
          $('#bDl', ov).onclick = () => D.download('PM_Escalation_Brief_' + today() + '.txt', t, 'text/plain;charset=utf-8'); const sh = $('#bSh', ov); if (sh) sh.onclick = () => navigator.share({ title: 'PM Escalation Brief', text: t }).catch(() => {}); break; }
        case 'escSel': for (const bid of sel) await moveBlocker(bid, 'Escalated'); sel.clear(); render(); break;
        case 'tStart': { let t = timerGet(); if (!t) { const p = Number($('#tP').value); if (!p) return toast('Add a project first'); t = { projectId: p, category: $('#tC').value, workType: $('#tW').value, acc: 0, since: null }; qProject = p; } t.since = Date.now(); timerSet(t); render(); break; }
        case 'tPause': { const t = timerGet(); if (t && t.since) { t.acc += Date.now() - t.since; t.since = null; timerSet(t); render(); } break; }
        case 'tLog': { const t = timerGet(); if (!t) break; const h = Math.round(elapsed(t) / 36e5 * 100) / 100; if (h < 0.01) { timerSet(null); render(); return toast('Timer too short — discarded'); } await D.add('time_logs', { engineer: S.settings.engineer, projectId: t.projectId, category: t.category, workType: t.workType, billable: t.workType !== 'PM Coordination', hours: h, rate: S.settings.rate, date: today(), notes: 'Logged from timer', createdAt: new Date().toISOString() }); timerSet(null); await refresh(); toast('Logged ' + h.toFixed(2) + ' h'); break; }
        case 'tDiscard': if (confirm('Discard running timer?')) { timerSet(null); render(); } break;
        case 'tsRange': tsRange = el.dataset.v; render(); break;
        case 'editLog': logForm(S.time_logs.find(l => l.id === id)); break;
        case 'delLog': if (confirm('Delete this time log?')) { await D.del('time_logs', id); await refresh(); } break;
        case 'addExp': expForm(); break;
        case 'editExp': expForm(S.expenditures.find(x => x.id === id)); break;
        case 'delExp': if (confirm('Delete this expenditure?')) { await D.del('expenditures', id); closeModal(); await refresh(); } break;
        case 'addNote': noteForm(); break;
        case 'delNote': if (confirm('Delete this note?')) { await D.del('pm_sync_notes', id); await refresh(); } break;
        case 'exp': exportCSV(el.dataset.k); break;
        case 'backup': { const o = await D.exportAll(); D.download('HourSync_Snapshot_' + today() + '.json', JSON.stringify(o), 'application/json'); toast('Snapshot exported'); break; }
        case 'persist': { const ok = await D.requestPersist(); toast(ok ? 'Persistent storage granted' : 'Browser declined persistence (install the app to improve odds)'); loadStorageCard(); updateMini(); break; }
        case 'archive': { const m = Number($('#arcM').value); if (!confirm(`Archive all logs older than ${m} months? A backup will be downloaded first.`)) break; D.download('HourSync_PreArchive_' + today() + '.json', JSON.stringify(await D.exportAll()), 'application/json'); const r = await D.archiveOlderThan(m); await refresh(); toast(`Archived ${r.logs} logs, ${r.exps} expenditures, ${r.blockers} blockers (before ${fmtD(r.cutoff)})`); break; }
        case 'demo': if (!S.projects.length || confirm('Replace ALL current data with demo data?')) { for (const s of Object.keys(D.STORES)) if (s !== 'settings') await D.clear(s); await D.setSetting('seeded', false); await D.seedIfEmpty(); await refresh(); toast('Demo data loaded'); } break;
        case 'wipe': if (confirm('Erase ALL data on this device? This cannot be undone.') && confirm('Really erase everything? Consider exporting a snapshot first.')) { for (const s of Object.keys(D.STORES)) if (s !== 'settings') await D.clear(s); await D.setSetting('seeded', true); await refresh(); toast('All data erased'); } break;
        case 'cur': await D.setSetting('currency', S.settings.currency === 'AED' ? 'USD' : 'AED'); await refresh(); break;
        case 'vat': await D.setSetting('vat', !S.settings.vat); await refresh(); break;
        case 'theme': { const order = ['auto', 'dark', 'light']; await D.setSetting('theme', order[(order.indexOf(S.settings.theme) + 1) % 3]); await refresh(); toast('Theme: ' + S.settings.theme); break; }
        case 'install': if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; $('#install').classList.remove('on'); } break;
        case 'dismissInstall': $('#install').classList.remove('on'); try { localStorage.setItem('hs_noinstall', '1'); } catch (er) {} break;
      }
    } catch (err) { console.error(err); toast('Error: ' + err.message); }
  });
  document.addEventListener('change', async e => {
    const t = e.target;
    if (t.dataset.act === 'selB') { const id = Number(t.dataset.id); t.checked ? sel.add(id) : sel.delete(id); const b = $('[data-act="brief"]'); if (b) b.textContent = '📋 PM Escalation Brief' + (sel.size ? ' (' + sel.size + ')' : ''); const es = $('[data-act="escSel"]'); if (es) es.disabled = !sel.size; return; }
    if (t.dataset.act === 'qTog') { const pid = Number(t.dataset.p), q = qState(pid); q.items[t.dataset.i] = t.checked; q.updated = today(); await D.put('qhse', q); const p = proj(pid); S.qhse = await D.all('qhse'); if (p) { p.annexureStatus = annexure(pid); await D.put('projects', p); } await refresh(); return; }
    if (t.dataset.set) { let v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? parseFloat(t.value) || 0 : t.value; await D.setSetting(t.dataset.set, v); await refresh(); toast('Saved'); return; }
    if (t.id === 'restore') { const f = t.files[0]; if (!f) return; try { const obj = JSON.parse(await f.text()); if (!confirm('Replace all current data with this snapshot?')) return; await D.importAll(obj, true); await refresh(); toast('Snapshot restored'); } catch (err) { toast('Restore failed: ' + err.message); } t.value = ''; return; }
    if (t.dataset.filter) filt(t);
  });
  document.addEventListener('input', e => { const t = e.target; if (t.dataset.filter === 'q') filt(t); });
  function filt(t) { const k = t.dataset.filter, v = t.type === 'checkbox' ? t.checked : t.value; if (k === 'project') blF.project = v; else if (k === 'severity') blF.severity = v; else if (k === 'q') blF.q = v; else if (k === 'resolved') blF.resolved = v; else if (k === 'sp_project') spF.project = v; else if (k === 'sp_cat') spF.cat = v; else if (k === 'qproj') qProject = Number(v); render(); }
  document.addEventListener('submit', async e => {
    if (e.target.id === 'qlog') { e.preventDefault(); const fd = new FormData(e.target), pid = Number(fd.get('projectId')); if (!pid) return toast('Add a project first'); qProject = pid; await D.add('time_logs', { engineer: S.settings.engineer, projectId: pid, category: fd.get('category'), workType: fd.get('workType'), billable: fd.get('workType') !== 'PM Coordination', hours: parseFloat(fd.get('hours')) || 0, rate: parseFloat(fd.get('rate')) || S.settings.rate, date: fd.get('date'), notes: (fd.get('notes') || '').trim(), createdAt: new Date().toISOString() }); await refresh(); toast('Time logged'); }
  });
  /* drag & drop kanban */
  let dragId = null;
  document.addEventListener('dragstart', e => { const c = e.target.closest && e.target.closest('.bc'); if (!c) return; dragId = Number(c.dataset.id); c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(dragId)); } catch (er) {} });
  document.addEventListener('dragend', () => { $$('.dragging').forEach(x => x.classList.remove('dragging')); $$('.col.over').forEach(x => x.classList.remove('over')); });
  document.addEventListener('dragover', e => { const c = e.target.closest && e.target.closest('.col'); if (c && dragId) { e.preventDefault(); $$('.col.over').forEach(x => x !== c && x.classList.remove('over')); c.classList.add('over'); } });
  document.addEventListener('drop', e => { const c = e.target.closest && e.target.closest('.col'); if (c && dragId) { e.preventDefault(); const id = dragId; dragId = null; moveBlocker(id, c.dataset.status); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  function go(v) { view = v; if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v); render(); window.scrollTo(0, 0); }
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.some(t => t[0] === h) && h !== view) go(h); });
  window.addEventListener('resize', redraw);
  matchMedia('(prefers-color-scheme: light)').addEventListener && matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { applyTheme(); redraw(); });
  window.addEventListener('online', netState); window.addEventListener('offline', netState);
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; try { if (localStorage.getItem('hs_noinstall')) return; } catch (er) {} $('#installTxt').textContent = 'Install HourSync on this device for full-screen, offline use.'; $('#installBtn').style.display = ''; $('#install').classList.add('on'); });
  window.addEventListener('appinstalled', () => { $('#install').classList.remove('on'); toast('HourSync installed'); });

  /* ---------- init ---------- */
  async function init() {
    $('#tabs').innerHTML = TABS.map(t => `<button data-act="nav" data-v="${t[0]}">${t[1]}</button>`).join('');
    const h = location.hash.slice(1); if (TABS.some(t => t[0] === h)) view = h;
    try { await D.open(); await D.loadSettings().then(async s => { if (!s.seeded) await D.seedIfEmpty(); }); await loadAll(); } catch (err) { $('#view').innerHTML = `<div class="card"><h2>Storage unavailable</h2><p>IndexedDB could not be opened (${esc(err.message)}). Private browsing or blocked site data can cause this.</p></div>`; return; }
    applyTheme(); netState(); tickClock(); setInterval(tickClock, 1000); render(); updateMini();
    D.requestPersist().then(() => updateMini());
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone; let dis = false; try { dis = !!localStorage.getItem('hs_noinstall'); } catch (er) {}
    if (ios && !dis) { $('#installTxt').textContent = 'To install on iPhone/iPad: tap Share → “Add to Home Screen”.'; $('#installBtn').style.display = 'none'; $('#install').classList.add('on'); }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW registration failed', err));
  }
  init();
})();
