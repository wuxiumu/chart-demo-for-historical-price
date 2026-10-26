"use strict";
/* ================================================================
 * charts.js —— 图表层（同花顺风格日K / 分时 / 迷你走势）
 * 依赖 app.js 的全局：state, fmt, cls, sign, $（函数声明提升，加载顺序无关）
 * ================================================================ */

/* ================= 图表公共 ================= */
function setupCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext("2d");
  ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
function niceTicks(min, max, n = 5) {
  const span = max - min || 1, step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const t = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) t.push(v);
  return t;
}
function calcMA(closes, n) {
  const out = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= n) sum -= closes[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}
function drawSpark(cv, data, isUp, color) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h || !data || data.length < 2) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1;
  const x = (i) => 1 + (i / (data.length - 1)) * (w - 2);
  const y = (v) => h - 3 - ((v - min) / rng) * (h - 6);
  ctx.beginPath();
  data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.strokeStyle = color || (isUp ? "#ff4d57" : "#22c584");
  ctx.lineWidth = 1.4; ctx.stroke();
  if (!color) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, isUp ? "rgba(255,77,87,.28)" : "rgba(34,197,132,.28)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.lineTo(x(data.length - 1), h); ctx.lineTo(x(0), h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  }
}

/* ================= 日K（同花顺风格） ================= */
const MA_DEFS = [ [5, "#ffffff"], [10, "#f4d03f"], [20, "#e05ffd"], [30, "#4adfae"] ];
function drawDaily() {
  const code = state.modal, cv = $("#chart");
  const bars = state.daily[code];
  const { ctx, w, h } = setupCanvas(cv);
  if (!bars || bars.length < 2) {
    ctx.fillStyle = "#6a7089"; ctx.font = "13px -apple-system"; ctx.textAlign = "center";
    ctx.fillText("加载中…", w / 2, h / 2); return;
  }
  const closes = bars.map((b) => b[4]);
  const mas = Object.fromEntries(MA_DEFS.map(([n]) => [n, calcMA(closes, n)]));
  const N = Math.min(state.zoom, bars.length);
  const maxOff = Math.max(0, bars.length - N);
  const off = Math.min(Math.max(state.viewOffset || 0, 0), maxOff);
  state.viewOffset = off;
  const end = bars.length - off;
  const start = Math.max(0, end - N);
  const view = bars.slice(start, end);
  const vMA = Object.fromEntries(MA_DEFS.map(([n]) => [n, mas[n].slice(start, end)]));

  const padL = 6, padR = 62, padT = 8, volH = 64, axisH = 16, gap = 10;
  const priceH = h - padT - volH - axisH - gap;
  let min = Infinity, max = -Infinity, maxVol = 0;
  view.forEach((b, i) => {
    min = Math.min(min, b[3]); max = Math.max(max, b[2]); maxVol = Math.max(maxVol, b[5] || 0);
    MA_DEFS.forEach(([n]) => { const v = vMA[n][i]; if (v != null) { min = Math.min(min, v); max = Math.max(max, v); } });
  });
  const pad = (max - min) * 0.06 || 1; min -= pad; max += pad; maxVol = maxVol || 1;
  const cw = (w - padL - padR) / view.length;
  const X = (i) => padL + i * cw + cw / 2;
  const Y = (v) => padT + (max - v) / (max - min) * priceH;
  const VY = (v) => padT + priceH + gap + volH - (v / maxVol) * volH;
  const volTop = padT + priceH + gap;

  // 网格 + 右侧价格轴
  ctx.font = "10px -apple-system"; ctx.textAlign = "left";
  for (const t of niceTicks(min, max, 5)) {
    ctx.strokeStyle = "#232738"; ctx.beginPath(); ctx.moveTo(padL, Y(t)); ctx.lineTo(w - padR, Y(t)); ctx.stroke();
    ctx.fillStyle = "#6a7089"; ctx.fillText(fmt(t), w - padR + 6, Y(t) + 3);
  }
  // 成交量面板基线
  ctx.strokeStyle = "#232738"; ctx.beginPath(); ctx.moveTo(padL, volTop + volH); ctx.lineTo(w - padR, volTop + volH); ctx.stroke();

  // MA 线
  MA_DEFS.forEach(([n, color]) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
    let started = false;
    vMA[n].forEach((v, i) => { if (v == null) return; started ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); started = true; });
    ctx.stroke();
  });
  // 蜡烛 + 成交量
  view.forEach((b, i) => {
    const [dt, o, hg, l, c, vol] = b;
    const up = c >= o, col = up ? "#ff4d57" : "#22c584";
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(i), Y(hg)); ctx.lineTo(X(i), Y(l)); ctx.stroke();
    const bw = Math.max(cw * 0.62, 1.5), yo = Y(o), yc = Y(c);
    ctx.fillRect(X(i) - bw / 2, Math.min(yo, yc), bw, Math.max(Math.abs(yc - yo), 1));
    if (vol) { ctx.globalAlpha = .6; ctx.fillRect(X(i) - bw / 2, VY(vol), bw, volTop + volH - VY(vol)); ctx.globalAlpha = 1; }
  });
  // 日期轴
  ctx.fillStyle = "#6a7089"; ctx.textAlign = "center";
  view.forEach((b, i) => {
    if (i % Math.ceil(N / 8) === 0) ctx.fillText(String(b[0]).slice(4, 6) + "/" + String(b[0]).slice(6, 8), X(i), h - 4);
  });
  // 最新价虚线 + 右侧标签（仅当视图包含最新一根时绘制；平移查看历史时显示标注）
  if (off === 0) {
    const last = view[view.length - 1], lastUp = last[4] >= (view[view.length - 2] ? view[view.length - 2][4] : last[4]);
    const ly = Y(last[4]);
    ctx.strokeStyle = lastUp ? "#ff4d57" : "#22c584"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(w - padR, ly); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = lastUp ? "#ff4d57" : "#22c584";
    ctx.fillRect(w - padR + 1, ly - 8, padR - 4, 16);
    ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.fillText(fmt(last[4]), w - padR + 5, ly + 3);
  } else {
    ctx.fillStyle = "#6a7089"; ctx.textAlign = "left";
    ctx.fillText(`历史视图 · ${String(view[0][0]).slice(4, 6)}/${String(view[0][0]).slice(6, 8)} - ${String(view[view.length - 1][0]).slice(4, 6)}/${String(view[view.length - 1][0]).slice(6, 8)}`, padL + 2, padT + 10);
  }
  // 成交量面板标注
  ctx.fillStyle = "#6a7089"; ctx.textAlign = "left";
  ctx.fillText(`成交量(万手)`, padL + 2, volTop + 10);

  // 十字光标
  const ci = state.cross;
  if (ci != null && ci >= 0 && ci < N) {
    ctx.strokeStyle = "#8a8fa3"; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(X(ci), padT); ctx.lineTo(X(ci), volTop + volH); ctx.stroke();
    const cp = view[ci][4];
    ctx.beginPath(); ctx.moveTo(padL, Y(cp)); ctx.lineTo(w - padR, Y(cp)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#39415c";
    ctx.fillRect(w - padR + 1, Y(cp) - 8, padR - 4, 16);
    ctx.fillStyle = "#fff"; ctx.fillText(fmt(cp), w - padR + 5, Y(cp) + 3);
    const dstr = String(view[ci][0]);
    const tagW = 62, tagX = Math.min(Math.max(X(ci) - tagW / 2, padL), w - padR - tagW);
    ctx.fillStyle = "#39415c";
    ctx.fillRect(tagX, h - 18, tagW, 16);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "bold 11px -apple-system";
    ctx.fillText(dstr.slice(0, 4) + "/" + dstr.slice(4, 6) + "/" + dstr.slice(6, 8), tagX + tagW / 2, h - 6);
    ctx.textAlign = "left"; ctx.font = "10px -apple-system";
  }
  cv._daily = { view, vMA, X, cw, start };
}
/* 日K成交量单位归一：上游盘中动态 bar 为「手」、收盘完成 bar 为「股」。
   用 成交额/收盘价 推算股数，与 vol 的比值判定单位，统一返回「万手」。 */
function volWanShou(b) {
  const vol = b[5], amt = b[6], c = b[4];
  if (!vol || !amt || !c) return vol ? vol / 1e4 : 0;
  const implied = amt / c;
  const shares = (implied / vol) > 0.5 ? vol : vol * 100;
  return shares / 1e6;
}
function updateChartInfo(hoverIdx) {
  const code = state.modal, bars = state.daily[code];
  const el = $("#chartInfo");
  if (!bars || !bars.length) { el.textContent = "--"; return; }
  const N = Math.min(state.zoom, bars.length);
  const maxOff = Math.max(0, bars.length - N);
  const off = Math.min(Math.max(state.viewOffset || 0, 0), maxOff);
  const end = bars.length - off;
  const start = Math.max(0, end - N);
  const idx = hoverIdx != null ? start + hoverIdx : end - 1;
  const b = bars[idx];
  const prev = bars[idx - 1] || b;
  const chgPct = prev[4] ? (b[4] / prev[4] - 1) * 100 : 0;
  const closes = bars.map((x) => x[4]);
  const maStr = MA_DEFS.map(([n, color]) => {
    const v = calcMA(closes, n)[idx];
    return `<span class="mi" style="color:${color}">MA${n} ${v == null ? "--" : fmt(v)}</span>`;
  }).join("");
  el.innerHTML =
    `<span class="mi">${String(b[0]).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")}</span>` +
    `<span class="mi">开 <b>${fmt(b[1])}</b></span><span class="mi">高 <b>${fmt(b[2])}</b></span>` +
    `<span class="mi">低 <b>${fmt(b[3])}</b></span>` +
    `<span class="mi">收 <b style="color:${cls(b[4] - prev[4]) === "up" ? "var(--up)" : cls(b[4] - prev[4]) === "down" ? "var(--down)" : "var(--txt)"}">${fmt(b[4])}</b></span>` +
    `<span class="mi ${cls(chgPct)}">涨跌 ${sign(chgPct)}%</span>` +
    `<span class="mi">量 ${fmt(volWanShou(b), 2)}万手</span><span class="mi">额 ${fmt(b[6] / 1e8, 2)}亿</span>` + maStr;
}

/* ================= 分时（同花顺风格：均价线 + 百分比轴） ================= */
function drawIntradayTHS() {
  const code = state.modal, cv = $("#chart");
  const pts = state.intraday[code];
  const { ctx, w, h } = setupCanvas(cv);
  const row = state.rows.find((r) => r.code === code);
  const bars = state.daily[code];
  const prevClose = bars && bars.length > 1 ? bars[bars.length - 2][4] : (row && row.price) || null;
  if (!pts || pts.length < 2) {
    ctx.fillStyle = "#6a7089"; ctx.font = "13px -apple-system"; ctx.textAlign = "center";
    ctx.fillText(state.intradayLoading ? "分时数据加载中…" : (state.mode === "demo" ? "演示模式无分时数据" : "暂无分时数据（可能已收盘或非交易日）"), w / 2, h / 2);
    return;
  }
  const padL = 40, padR = 62, padT = 8, volH = 56, axisH = 16, gap = 10;
  const priceH = h - padT - volH - axisH - gap;
  const closes = pts.map((p) => p[4]);
  // 均价线：累计成交额 / 累计成交量
  let ca = 0, cv2 = 0;
  const avg = pts.map((p) => { ca += p[6] || 0; cv2 += p[5] || 0; return cv2 ? ca / cv2 : p[4]; });
  let min = Math.min(...closes, ...avg, prevClose || Infinity), max = Math.max(...closes, ...avg, prevClose || -Infinity);
  const pad = (max - min) * 0.08 || 1; min -= pad; max += pad;
  const mid = prevClose || (min + max) / 2;
  // X 轴固定全天 240 分钟（09:30-11:30 / 13:00-15:00，午休压缩）：数据画到当前时刻，右侧留白；
  // 若按已有数据的时间跨度拉伸，盘中看会失真（11:20 被拉到 15:00 的位置）
  const mins = pts._mins || (pts._mins = pts.map((p) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hourCycle: "h23", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(p[0] * 1000));
    const get = (t) => +((parts.find((x) => x.type === t) || {}).value || 0);
    const hm = get("hour") * 60 + get("minute");
    return Math.max(0, Math.min(240, hm < 780 ? hm - 570 : 120 + hm - 780)); // 09:30=570, 13:00=780
  }));
  const X = (m) => padL + (m / 240) * (w - padL - padR);
  const MX = (i) => X(mins[i]);
  const Y = (v) => padT + (max - v) / (max - min) * priceH;
  const VY = (v) => padT + priceH + gap + volH - (v / Math.max(...pts.map((p) => p[5] || 0)) || 1) * volH;
  const volTop = padT + priceH + gap;
  const maxVol = Math.max(...pts.map((p) => p[5] || 0)) || 1;

  // 中轴(昨收) + 上下网格，左侧百分比 / 右侧价格
  ctx.font = "10px -apple-system"; ctx.textAlign = "center";
  const pctTicks = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5].filter((p) => { const v = mid * (1 + p / 100); return v >= min && v <= max; });
  if (!pctTicks.includes(0)) pctTicks.push(0);
  for (const p of pctTicks) {
    const v = mid * (1 + p / 100), yy = Y(v);
    ctx.strokeStyle = p === 0 ? "#8a6f33" : "#232738";
    ctx.setLineDash(p === 0 ? [4, 4] : []);
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#6a7089"; ctx.textAlign = "right";
    ctx.fillText((p > 0 ? "+" : "") + p.toFixed(2) + "%", padL - 4, yy + 3);
    ctx.textAlign = "left"; ctx.fillText(fmt(v), w - padR + 6, yy + 3);
  }
  // 时间轴刻度：上午/午休/下午（按全天 240 分钟精确定位）
  ctx.fillStyle = "#6a7089"; ctx.textAlign = "center";
  const labels = [[0, "09:30"], [60, "10:30"], [120, "11:30/13:00"], [180, "14:00"], [240, "15:00"]];
  for (const [m, txt] of labels) ctx.fillText(txt, X(m), h - 4);
  // 成交量
  pts.forEach((p, i) => {
    if (!p[5]) return;
    const col = i ? (p[4] >= pts[i - 1][4] ? "#ff4d57" : "#22c584") : "#8a8fa3";
    ctx.fillStyle = col; ctx.globalAlpha = .5;
    const bx = MX(i);
    ctx.fillRect(bx - 1.5, padT + priceH + gap + volH - (p[5] / maxVol) * volH, 3, (p[5] / maxVol) * volH);
    ctx.globalAlpha = 1;
  });
  // 均价线（黄）+ 价格线（白）
  const line = (arr, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    arr.forEach((v, i) => (i ? ctx.lineTo(MX(i), Y(v)) : ctx.moveTo(MX(i), Y(v))));
    ctx.stroke();
  };
  line(avg, "#ffd54d", 1);
  line(closes, "#e9e7e1", 1.4);
  // 最新价虚线贯穿全宽 + 右侧价格标签
  const lc = closes[closes.length - 1];
  ctx.strokeStyle = "rgba(233,231,225,.5)"; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, Y(lc)); ctx.lineTo(w - padR, Y(lc)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = "#39415c"; ctx.fillRect(w - padR + 1, Y(lc) - 8, padR - 4, 16);
  ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.fillText(fmt(lc), w - padR + 5, Y(lc) + 3);
  // 十字光标
  const ci = state.cross;
  if (ci != null && ci >= 0 && ci < pts.length) {
    ctx.strokeStyle = "#8a8fa3"; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(MX(ci), padT); ctx.lineTo(MX(ci), volTop + volH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padL, Y(pts[ci][4])); ctx.lineTo(w - padR, Y(pts[ci][4])); ctx.stroke();
    ctx.setLineDash([]);
  }
  cv._intra = { pts, avg, MX };
}
function updateIntraInfo(hoverIdx) {
  const code = state.modal, pts = state.intraday[code];
  const el = $("#chartInfo");
  if (!pts || !pts.length) { el.textContent = state.intradayLoading ? "分时加载中…" : "暂无分时数据"; return; }
  const i = hoverIdx != null ? hoverIdx : pts.length - 1;
  const p = pts[i], bars = state.daily[code];
  const prevClose = bars && bars.length > 1 ? bars[bars.length - 2][4] : p[4];
  const d = new Date(p[0] * 1000);
  const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
  el.innerHTML =
    `<span class="mi">${hh}:${mm}</span>` +
    `<span class="mi">价 <b>${fmt(p[4])}</b></span>` +
    `<span class="mi ${cls(p[4] - prevClose)}">${sign((p[4] / prevClose - 1) * 100)}%</span>` +
    `<span class="mi" style="color:#ffd54d">均价 ${fmt(avgAt(i))}</span>` +
    `<span class="mi">量 ${fmt(p[5] / 1e6, 2)}万手</span><span class="mi">额 ${fmt(p[6] / 1e8, 2)}亿</span>`;
  function avgAt(ix) { let a = 0, v = 0; for (let k = 0; k <= ix; k++) { a += pts[k][6] || 0; v += pts[k][5] || 0; } return v ? a / v : pts[ix][4]; }
}
