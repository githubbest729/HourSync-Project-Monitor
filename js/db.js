/* HourSync DB — IndexedDB engine, storage manager, seed data, import/export, archiver */
(function (g) {
  'use strict';
  const DB_NAME = 'HourSyncDB_v1', DB_VER = 1;
  const STORES = {
    projects: { idx: [['by_status', 'status'], ['by_phase', 'phase'], ['by_code', 'code']] },
    time_logs: { idx: [['by_date', 'date'], ['by_project', 'projectId'], ['by_category', 'category']] },
    expenditures: { idx: [['by_date', 'date'], ['by_project', 'projectId'], ['by_status', 'approval']] },
    blockers: { idx: [['by_date', 'createdDate'], ['by_project', 'projectId'], ['by_status', 'status'], ['by_severity', 'severity']] },
    pm_sync_notes: { idx: [['by_date', 'date'], ['by_project', 'projectId']] },
    qhse: { key: 'projectId', idx: [] },
    archive_summaries: { idx: [['by_project', 'projectId'], ['by_date', 'archivedOn']] },
    settings: { key: 'key', idx: [] }
  };
  const DEFAULTS = { currency: 'AED', vat: false, theme: 'auto', engineer: 'SCADA Engineer', rate: 185, usdRate: 3.6725, seeded: false };
  let db = null;

  const TZ = 'Asia/Dubai';
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
  const nowGST = () => new Date().toLocaleString('en-GB', { timeZone: TZ, hour12: false }) + ' GST';

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((res, rej) => {
      const rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = e => {
        const d = e.target.result;
        for (const [name, cfg] of Object.entries(STORES)) {
          if (d.objectStoreNames.contains(name)) continue;
          const s = cfg.key ? d.createObjectStore(name, { keyPath: cfg.key }) : d.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
          cfg.idx.forEach(([n, p]) => s.createIndex(n, p, { unique: false }));
        }
      };
      rq.onsuccess = () => { db = rq.result; db.onversionchange = () => db.close(); res(db); };
      rq.onerror = () => rej(rq.error);
    });
  }
  const wrap = rq => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  const tx = (store, mode = 'readonly') => open().then(d => d.transaction(store, mode).objectStore(store));
  const all = s => tx(s).then(o => wrap(o.getAll()));
  const get = (s, k) => tx(s).then(o => wrap(o.get(k)));
  const add = (s, v) => tx(s, 'readwrite').then(o => wrap(o.add(v)));
  const put = (s, v) => tx(s, 'readwrite').then(o => wrap(o.put(v)));
  const del = (s, k) => tx(s, 'readwrite').then(o => wrap(o.delete(k)));
  const clear = s => tx(s, 'readwrite').then(o => wrap(o.clear()));
  const count = s => tx(s).then(o => wrap(o.count()));
  const byIndex = (s, idx, val) => tx(s).then(o => wrap(o.index(idx).getAll(val)));
  /* cursor over an index (range optional); cb returns false to stop */
  const cursor = (s, idx, range, cb) => tx(s).then(o => new Promise((res, rej) => {
    const rq = (idx ? o.index(idx) : o).openCursor(range);
    rq.onsuccess = () => { const c = rq.result; if (!c) return res(); if (cb(c.value) === false) return res(); c.continue(); };
    rq.onerror = () => rej(rq.error);
  }));

  /* settings */
  async function loadSettings() {
    const rows = await all('settings'); const o = Object.assign({}, DEFAULTS);
    rows.forEach(r => { o[r.key] = r.value; }); return o;
  }
  const setSetting = (key, value) => put('settings', { key, value });

  /* ---------- seed ---------- */
  function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
  async function seedIfEmpty() {
    if ((await count('projects')) > 0) return false;
    const rnd = lcg(20261026), pick = a => a[Math.floor(rnd() * a.length)];
    const t = today();
    const P = [
      { code: 'AGAC-DEWA-2601', name: 'DEWA Substation Telemetry Upgrade', client: 'DEWA', pm: 'Rashid Al Mansoori', phase: 'PLC-OPC', rate: 195, hb: .62, bb: .78, prog: 58, plan: 64, d: { hmi: 70, plc: 55, sql: 40, qa: 20 }, w: 3 },
      { code: 'AGAC-JAWT-2602', name: 'Jebel Ali Water Treatment — Wonderware System Platform Migration', client: 'Jebel Ali Free Zone Utilities', pm: 'Priya Nair', phase: 'HMI', rate: 185, hb: .48, bb: .52, prog: 44, plan: 46, d: { hmi: 55, plc: 45, sql: 35, qa: 10 }, w: 4 },
      { code: 'AGAC-DMDC-2603', name: 'Dubai Marina District Cooling — Modbus/OPC Integration', client: 'Marina District Cooling', pm: 'Omar Haddad', phase: 'FAT', rate: 175, hb: .91, bb: .93, prog: 80, plan: 90, d: { hmi: 95, plc: 85, sql: 70, qa: 55 }, w: 3 },
      { code: 'AGAC-SEWA-2604', name: 'Sharjah Pump Station PLC Refit & SQL Historian', client: 'SEWA', pm: 'Rashid Al Mansoori', phase: 'Design', rate: 180, hb: .22, bb: .3, prog: 14, plan: 20, d: { hmi: 15, plc: 10, sql: 20, qa: 0 }, w: 2 }
    ];
    const ids = [];
    for (const p of P) {
      ids.push(await add('projects', {
        code: p.code, name: p.name, client: p.client, pm: p.pm, phase: p.phase, status: 'Active', currency: 'AED',
        budgetAED: 1, allocatedHours: 1, progressPct: p.prog, plannedPct: p.plan, deliverables: p.d,
        annexureStatus: 'In Progress', startDate: addDays(t, -120), createdAt: new Date().toISOString(), demo: true
      }));
    }
    const wsum = P.reduce((a, p) => a + p.w, 0);
    const hrs = P.map(() => 0), cost = P.map(() => 0);
    const cats = ['Wonderware HMI', 'ArchestrA Scripting', 'PLC-Modbus/OPC Comms', 'SQL Optimization', 'Site Survey/BOM', 'FAT/SAT QA'];
    const phaseCat = { Design: [4, 0, 1, 3], HMI: [0, 1, 0, 3], 'PLC-OPC': [2, 2, 0, 1], FAT: [5, 2, 0, 1], SAT: [5, 4], Handover: [5, 0] };
    for (let i = 120; i >= 0; i--) {
      const day = addDays(t, -i), dow = new Date(day + 'T00:00:00Z').getUTCDay();
      if (dow === 0 || dow === 6) continue;
      let hoursLeft = 8, guard = 0;
      while (hoursLeft > 0.5 && guard++ < 3) {
        let r = rnd() * wsum, k = 0; while (r > P[k].w && k < P.length - 1) { r -= P[k].w; k++; }
        const h = Math.min(hoursLeft, [1.5, 2, 2.5, 3, 4][Math.floor(rnd() * 5)]); hoursLeft -= h;
        const wt = rnd() < .62 ? 'Billable Engineering' : rnd() < .6 ? 'Troubleshooting' : 'PM Coordination';
        const cat = wt === 'PM Coordination' ? 'Site Survey/BOM' : cats[pick(phaseCat[P[k].phase] || [0, 1, 2])];
        hrs[k] += h; cost[k] += h * P[k].rate;
        await add('time_logs', { engineer: 'SCADA Engineer', projectId: ids[k], category: cat, workType: wt, billable: wt !== 'PM Coordination', hours: h, rate: P[k].rate, date: day, notes: '', createdAt: day + 'T08:00:00.000Z' });
      }
    }
    const vendors = ['Siemens UAE', 'Rockwell Automation Dubai', 'AVEVA Partner ME', 'Schneider Electric', 'RS Components', 'Phoenix Contact'];
    const exps = [['Hardware/BOM', 'Siemens S7-1500 CPU + I/O modules', 14500], ['Software Licenses', 'Wonderware InTouch / System Platform licences', 22800], ['Site Logistics', 'Site transport & accommodation', 2600], ['Subcontractor', 'Panel wiring subcontractor', 9800], ['Variation Order', 'VO-02 additional RTU points', 6400], ['Hardware/BOM', 'Managed industrial switches & firewall', 7200], ['Software Licenses', 'SQL Server Standard core licences', 11800], ['Site Logistics', 'Calibration equipment hire', 1800]];
    for (let k = 0; k < P.length; k++) {
      const n = 3 + Math.floor(rnd() * 3);
      for (let j = 0; j < n; j++) {
        const e = exps[Math.floor(rnd() * exps.length)], amt = Math.round(e[2] * (0.7 + rnd() * .6) / 50) * 50;
        cost[k] += amt;
        await add('expenditures', { projectId: ids[k], category: e[0], item: e[1], amountAED: amt, vendor: pick(vendors), invoiceRef: 'INV-' + (2600 + k * 40 + j * 3), approval: rnd() < .75 ? 'Approved' : 'Pending', date: addDays(t, -Math.floor(rnd() * 100)), timestamp: new Date().toISOString() });
      }
    }
    for (let k = 0; k < P.length; k++) {
      const proj = await get('projects', ids[k]);
      proj.budgetAED = Math.round(cost[k] / P[k].bb / 1000) * 1000;
      proj.allocatedHours = Math.round(hrs[k] / P[k].hb / 10) * 10;
      await put('projects', proj);
    }
    const B = [
      [0, 'OPC UA tag quality BAD on RTU gateway after firmware update', 'Field Comms/OPC', 'Critical', 'Vendor', 3, 'In Progress', 'Firmware 4.2 changed certificate trust list', 'Roll back to 4.1 on test unit; vendor patch ETA this week', 24, 12000, 9],
      [0, 'Client IT blocking port 4840 between OT and DMZ', 'IT/Firewall Security', 'High', 'Client', -2, 'Escalated', 'Firewall change request not approved', 'PM to escalate to client IT manager; attach network diagram', 16, 6000, 14],
      [1, 'Galaxy migration: legacy scripts fail on System Platform 2023 R2', 'SQL/Database', 'High', 'SCADA Engineer', 5, 'In Progress', 'Deprecated QuickScript functions', 'Refactor 14 scripts; regression-test on staging galaxy', 32, 5900, 6],
      [1, 'Plant access permit for SAT window not issued', 'HSE/Site Access', 'Medium', 'Project Manager', 4, 'Open', 'Permit-to-work awaiting client HSE sign-off', 'Submit method statement & RA; chase client HSE', 8, 1500, 3],
      [2, 'Modbus TCP gateway BOM delayed — 3 weeks lead time', 'Panel/BOM Procurement', 'Critical', 'Vendor', -5, 'Escalated', 'Supplier allocation shortage', 'Source alternate gateway or expedite via distributor', 40, 18000, 11],
      [2, 'Client approval pending for revised HMI faceplates', 'Client Approval', 'Medium', 'Client', 1, 'Open', 'Review comments outstanding', 'Walk-through meeting booked', 12, 2200, 5],
      [2, 'Historian tags lagging >30s during FAT dry-run', 'SQL/Database', 'High', 'SCADA Engineer', -1, 'In Progress', 'Index fragmentation on history table', 'Rebuild indexes, tune batch size', 10, 1850, 4],
      [3, 'Site survey data incomplete for pump skid P-203', 'Field Comms/OPC', 'Low', 'SCADA Engineer', 9, 'Open', 'Survey sheets missing I/O addresses', 'Request as-built drawings', 4, 740, 1],
      [0, 'Licence dongle mismatch on engineering laptop', 'IT/Firewall Security', 'Low', 'SCADA Engineer', 0, 'Resolved', 'Wrong licence server host ID', 'Re-hosted licence', 2, 390, 18],
      [1, 'HMI client cannot browse OPC server by hostname', 'Field Comms/OPC', 'Medium', 'SCADA Engineer', 0, 'Resolved', 'DNS entry missing', 'Added hosts mapping; DNS ticket closed', 3, 555, 22]
    ];
    for (const b of B) {
      const created = addDays(t, -b[11]);
      await add('blockers', {
        projectId: ids[b[0]], title: b[1], category: b[2], severity: b[3], assignedTo: b[4], slaDate: addDays(t, b[5]), status: b[6],
        escalated: b[6] === 'Escalated', rootCause: b[7], actionPlan: b[8], impactHours: b[9], impactAED: b[10], createdDate: created,
        resolvedDate: b[6] === 'Resolved' ? addDays(created, 2 + Math.floor(rnd() * 4)) : null, createdAt: created + 'T06:00:00.000Z'
      });
    }
    await add('pm_sync_notes', { date: addDays(t, -7), pmName: 'Rashid Al Mansoori', projectId: ids[0], actionItems: 'Client IT firewall request; vendor firmware call Thu', blockersCleared: 1, variance: 'SPI 0.91 — 2 days behind on RTU comms; recovery via weekend FAT prep' });
    await add('pm_sync_notes', { date: addDays(t, -14), pmName: 'Omar Haddad', projectId: ids[2], actionItems: 'Approve VO-02; expedite gateway order', blockersCleared: 2, variance: 'Budget at 91% — VO pending approval' });
    await put('qhse', { projectId: ids[0], items: { 1: true, 2: true, 3: true, 4: false, 5: true, 6: false, 7: false, 8: true, 9: true, 10: true }, updated: t });
    await put('qhse', { projectId: ids[2], items: { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true, 8: true, 9: true, 10: false }, updated: t });
    await setSetting('seeded', true);
    return true;
  }

  /* ---------- storage manager ---------- */
  async function storageInfo() {
    const out = { persisted: false, usage: 0, quota: 0, pct: 0, supported: !!(navigator.storage && navigator.storage.estimate), counts: {} };
    try { if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted(); } catch (e) {}
    try { if (out.supported) { const e = await navigator.storage.estimate(); out.usage = e.usage || 0; out.quota = e.quota || 0; out.pct = out.quota ? out.usage / out.quota * 100 : 0; } } catch (e) {}
    for (const s of Object.keys(STORES)) out.counts[s] = await count(s);
    return out;
  }
  async function requestPersist() { try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (e) { return false; } }

  /* ---------- backup / restore ---------- */
  async function exportAll() {
    const o = { app: 'HourSync Project Monitor', dbName: DB_NAME, version: DB_VER, exportedAt: new Date().toISOString(), exportedGST: nowGST(), stores: {} };
    for (const s of Object.keys(STORES)) o.stores[s] = await all(s);
    return o;
  }
  async function importAll(obj, replace = true) {
    if (!obj || obj.dbName !== DB_NAME || !obj.stores) throw new Error('Not a HourSync snapshot file');
    for (const [s, rows] of Object.entries(obj.stores)) {
      if (!STORES[s]) continue;
      if (replace) await clear(s);
      for (const r of rows) await put(s, r);
    }
  }
  async function resetAll() { for (const s of Object.keys(STORES)) await clear(s); }

  /* ---------- CSV ---------- */
  function toCSV(rows, cols) {
    const q = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return '﻿' + [cols.map(c => q(c[0])).join(',')].concat(rows.map(r => cols.map(c => q(typeof c[1] === 'function' ? c[1](r) : r[c[1]])).join(','))).join('\r\n');
  }
  function download(name, text, type = 'text/csv;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  /* ---------- fiscal archiver ---------- */
  /* Rolls up time logs + expenditures + resolved blockers older than N months into
     per-project summary rows (KPIs stay intact), then removes the raw rows. */
  async function archiveOlderThan(months) {
    const t = today(), d = new Date(t + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - months);
    const cutoff = d.toISOString().slice(0, 10);
    const sums = {}; const S = pid => sums[pid] || (sums[pid] = { projectId: pid, hours: 0, billable: 0, laborAED: 0, expAED: 0, logs: 0, exps: 0, blockersResolved: 0, mttrDaysSum: 0 });
    const logs = (await all('time_logs')).filter(l => l.date < cutoff);
    const exps = (await all('expenditures')).filter(e => e.date < cutoff);
    const bl = (await all('blockers')).filter(b => b.status === 'Resolved' && (b.resolvedDate || b.createdDate) < cutoff);
    logs.forEach(l => { const s = S(l.projectId); s.hours += l.hours; if (l.billable) s.billable += l.hours; s.laborAED += l.hours * l.rate; s.logs++; });
    exps.forEach(e => { if (e.approval === 'Rejected') return; const s = S(e.projectId); s.expAED += e.amountAED; s.exps++; });
    bl.forEach(b => { const s = S(b.projectId); s.blockersResolved++; s.mttrDaysSum += daysBetween(b.createdDate, b.resolvedDate || b.createdDate); });
    for (const s of Object.values(sums)) { s.archivedOn = t; s.cutoff = cutoff; s.months = months; await add('archive_summaries', s); }
    for (const l of logs) await del('time_logs', l.id);
    for (const e of exps) await del('expenditures', e.id);
    for (const b of bl) await del('blockers', b.id);
    return { cutoff, logs: logs.length, exps: exps.length, blockers: bl.length };
  }

  g.HSDB = { open, all, get, add, put, del, clear, count, byIndex, cursor, loadSettings, setSetting, seedIfEmpty, storageInfo, requestPersist, exportAll, importAll, resetAll, toCSV, download, archiveOlderThan, today, addDays, daysBetween, nowGST, STORES, DEFAULTS, TZ };
})(window);
