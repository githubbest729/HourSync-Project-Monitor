/* HourSync charts — zero-dependency Canvas engine (works fully offline) */
(function (g) {
  'use strict';
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const C = () => ({ text: css('--text'), muted: css('--muted'), line: css('--line'), cyan: css('--cyan'), amber: css('--amber'), green: css('--green'), rose: css('--rose'), panel: css('--panel') });
  function setup(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth || 300, h = cv.clientHeight || 200;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    x.font = '11px system-ui,sans-serif'; return { x, w, h, c: C() };
  }
  const short = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  const nice = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
  const fmtK = v => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k' : String(Math.round(v));

  /* semicircle gauge. mode 'burn' (lower better) or 'index' (CPI/SPI, higher better) */
  function gauge(cv, o) {
    const { x, w, h, c } = setup(cv); const cx = w / 2, cy = h - 22, r = Math.min(w / 2 - 10, h - 34);
    const max = o.max || 100, v = Math.max(0, Math.min(o.value, max)), a0 = Math.PI, a1 = 2 * Math.PI;
    let col; if (o.mode === 'index') col = o.value >= 1 ? c.green : o.value >= .9 ? c.amber : c.rose; else { const p = o.value / max * 100; col = p < 75 ? c.green : p < 90 ? c.amber : c.rose; }
    x.lineWidth = Math.max(8, r * .2); x.lineCap = 'round';
    x.strokeStyle = c.line; x.beginPath(); x.arc(cx, cy, r, a0, a1); x.stroke();
    x.strokeStyle = col; x.beginPath(); x.arc(cx, cy, r, a0, a0 + (a1 - a0) * v / max); x.stroke();
    if (o.mode === 'index') { const m = a0 + (a1 - a0) * (1 / max); x.strokeStyle = c.text; x.lineWidth = 2; x.beginPath(); x.moveTo(cx + Math.cos(m) * (r - 14), cy + Math.sin(m) * (r - 14)); x.lineTo(cx + Math.cos(m) * (r + 14), cy + Math.sin(m) * (r + 14)); x.stroke(); }
    x.fillStyle = c.text; x.textAlign = 'center'; x.font = '700 ' + Math.max(15, r * .36) + 'px ui-monospace,Menlo,monospace'; x.fillText(o.text, cx, cy - 2);
    x.fillStyle = c.muted; x.font = '11px system-ui,sans-serif'; x.fillText(o.label, cx, cy + 16);
  }

  /* grouped vertical bars: {labels, series:[{name,color,values}], fmt} */
  function groupedBars(cv, o) {
    const { x, w, h, c } = setup(cv), L = 44, B = 40, T = 22, R = 8, n = o.labels.length, k = o.series.length;
    const max = nice(Math.max(1, ...o.series.flatMap(s => s.values)) * 1.05), pw = w - L - R, ph = h - T - B;
    x.strokeStyle = c.line; x.fillStyle = c.muted; x.textAlign = 'right'; x.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = T + ph - ph * i / 4; x.beginPath(); x.moveTo(L, y); x.lineTo(w - R, y); x.stroke(); x.fillText(fmtK(max * i / 4), L - 5, y + 4); }
    const gw = pw / n, bw = Math.min(34, gw * .7 / k);
    o.labels.forEach((lb, i) => {
      const gx = L + gw * i + gw / 2 - bw * k / 2;
      o.series.forEach((s, j) => { const v = s.values[i], bh = ph * v / max; x.fillStyle = s.colors ? s.colors[i] : s.color; x.fillRect(gx + j * bw, T + ph - bh, bw - 2, bh); });
      x.fillStyle = c.muted; x.textAlign = 'center'; x.fillText(short(lb, Math.max(6, Math.floor(gw / 6.5))), L + gw * i + gw / 2, h - B + 14);
    });
    x.textAlign = 'left'; let lx = L;
    o.series.forEach(s => { x.fillStyle = s.color; x.fillRect(lx, 5, 10, 10); x.fillStyle = c.text; x.fillText(s.name, lx + 14, 14); lx += x.measureText(s.name).width + 32; });
  }

  /* stacked bars: same shape as grouped but stacked */
  function stackedBars(cv, o) {
    const { x, w, h, c } = setup(cv), L = 36, B = 28, T = 22, R = 8, n = o.labels.length;
    const tot = o.labels.map((_, i) => o.series.reduce((a, s) => a + s.values[i], 0)), max = nice(Math.max(1, ...tot) * 1.05), pw = w - L - R, ph = h - T - B;
    x.strokeStyle = c.line; x.fillStyle = c.muted; x.textAlign = 'right';
    for (let i = 0; i <= 4; i++) { const y = T + ph - ph * i / 4; x.beginPath(); x.moveTo(L, y); x.lineTo(w - R, y); x.stroke(); x.fillText(fmtK(max * i / 4), L - 5, y + 4); }
    const gw = pw / n, bw = Math.min(46, gw * .7);
    o.labels.forEach((lb, i) => {
      let y = T + ph; o.series.forEach(s => { const bh = ph * s.values[i] / max; y -= bh; x.fillStyle = s.color; x.fillRect(L + gw * i + (gw - bw) / 2, y, bw, bh); });
      x.fillStyle = c.muted; x.textAlign = 'center'; x.fillText(lb, L + gw * i + gw / 2, h - B + 14);
    });
    x.textAlign = 'left'; let lx = L; o.series.forEach(s => { x.fillStyle = s.color; x.fillRect(lx, 5, 10, 10); x.fillStyle = c.text; x.fillText(s.name, lx + 14, 14); lx += x.measureText(s.name).width + 30; });
  }

  /* heat map: rows × cols matrix of counts */
  function heatmap(cv, o) {
    const { x, w, h, c } = setup(cv), L = Math.min(150, w * .34), T = 26, cw = (w - L - 4) / o.cols.length, rh = (h - T - 4) / o.rows.length;
    const max = Math.max(1, ...o.data.flat());
    x.textAlign = 'center'; x.fillStyle = c.muted; o.cols.forEach((cl, j) => x.fillText(cl, L + cw * j + cw / 2, 16));
    o.rows.forEach((rw, i) => {
      x.textAlign = 'right'; x.fillStyle = c.muted; x.fillText(short(rw, Math.floor(L / 6.2)), L - 6, T + rh * i + rh / 2 + 4);
      o.cols.forEach((cl, j) => {
        const v = o.data[i][j], base = o.colors[j]; x.fillStyle = c.line; x.globalAlpha = .35; x.fillRect(L + cw * j + 2, T + rh * i + 2, cw - 4, rh - 4);
        if (v) { x.globalAlpha = .25 + .75 * v / max; x.fillStyle = base; x.fillRect(L + cw * j + 2, T + rh * i + 2, cw - 4, rh - 4); }
        x.globalAlpha = 1; if (v) { x.fillStyle = c.text; x.font = '700 12px ui-monospace,monospace'; x.textAlign = 'center'; x.fillText(v, L + cw * j + cw / 2, T + rh * i + rh / 2 + 4); x.font = '11px system-ui,sans-serif'; }
      });
    });
  }

  /* horizontal bars with 0-100 scale */
  function hbars(cv, o) {
    const { x, w, h, c } = setup(cv), L = Math.min(130, w * .36), R = 38, n = o.labels.length, rh = h / n, max = o.max || 100;
    o.labels.forEach((lb, i) => {
      const y = rh * i + rh * .22, bh = rh * .5, v = o.values[i], col = o.colors ? o.colors[i] : (v >= 75 ? c.green : v >= 40 ? c.amber : c.rose);
      x.fillStyle = c.muted; x.textAlign = 'right'; x.fillText(short(lb, Math.floor(L / 6.2)), L - 6, y + bh / 2 + 4);
      x.fillStyle = c.line; x.globalAlpha = .6; x.fillRect(L, y, w - L - R, bh); x.globalAlpha = 1;
      x.fillStyle = col; x.fillRect(L, y, (w - L - R) * Math.min(v, max) / max, bh);
      x.fillStyle = c.text; x.textAlign = 'left'; x.fillText(Math.round(v) + (o.unit || '%'), w - R + 5, y + bh / 2 + 4);
    });
  }

  function donut(cv, o) {
    const { x, w, h, c } = setup(cv), r = Math.min(h / 2 - 8, w / 3), cx = r + 12, cy = h / 2, tot = o.values.reduce((a, b) => a + b, 0) || 1;
    let a = -Math.PI / 2; x.lineWidth = r * .38;
    o.values.forEach((v, i) => { const da = 2 * Math.PI * v / tot; x.strokeStyle = o.colors[i]; x.beginPath(); x.arc(cx, cy, r * .8, a, a + da); x.stroke(); a += da; });
    x.fillStyle = c.text; x.textAlign = 'center'; x.font = '700 15px ui-monospace,monospace'; x.fillText(o.center, cx, cy + 5); x.font = '11px system-ui,sans-serif';
    x.textAlign = 'left'; o.labels.forEach((lb, i) => { const y = 24 + i * 22; x.fillStyle = o.colors[i]; x.fillRect(cx + r + 18, y - 9, 10, 10); x.fillStyle = c.text; x.fillText(lb + ' — ' + o.values[i].toFixed(1) + ' h (' + Math.round(o.values[i] / tot * 100) + '%)', cx + r + 34, y); });
  }

  g.HSCharts = { gauge, groupedBars, stackedBars, heatmap, hbars, donut, fmtK };
})(window);
