"use strict";
/* ================================================================
 * K线看板 v3 —— 多独立页面架构
 *   index.html  图文K线（海报风格，默认页）
 *   cards.html  经典看板（暗色卡片）
 *   text.html   纯文本行情（多选看板 / 全表头排序 / 全市场搜索）
 *   kline.html  独立K线页（?s=代码&m=市场&t=DAILY|INTRADAY，可直链分享）
 * 页面状态走 URL query（?s=&m=&t=）；看板选股走 localStorage（各页共用）
 * 数据层三模式：proxy（本地 server.js 注入 token）/ direct / demo（内置快照）
 * ================================================================ */

/* ---------- 页面识别与旧链接迁移 ---------- */
const PAGE = document.body.dataset.page || "board";
(function migrateLegacyHash() {
  const h = location.hash;
  if (!h || h.length < 3) return;
  const m = h.match(/^#\/?(board|cards|text)?(?:\?(.*))?$/);
  if (!m) { history.replaceState(null, "", location.pathname + location.search); return; }
  const page = { board: "index.html", cards: "cards.html", text: "text.html" }[m[1] || "board"];
  const u = new URL(location.href); u.hash = "";
  u.pathname = u.pathname.replace(/[^/]*$/, page);
  new URLSearchParams(m[2] || "").forEach((v, k) => u.searchParams.set(k, v));
  history.replaceState(null, "", u);
})();
const pageParams = () => { const p = new URLSearchParams(location.search); return { s: p.get("s"), m: p.get("m"), t: p.get("t") }; };
function setPageParams(obj) {
  const u = new URL(location.href);
  for (const k of ["s", "m", "t"]) {
    if (obj[k]) u.searchParams.set(k, obj[k]); else u.searchParams.delete(k);
  }
  history.replaceState(null, "", u);
}

/* ---------- 海报股配置（hist = 海报基准历史价，可被本地自定义覆盖） ---------- */
const STOCKS = [
  { code: "300308", market: "33", name: "中际旭创", hist: 1414.69 },
  { code: "300502", market: "33", name: "新易盛",   hist: 618.87 },
  { code: "300750", market: "33", name: "宁德时代", hist: 467.65 },
  { code: "002384", market: "33", name: "东山精密", hist: 280.08 },
  { code: "000858", market: "33", name: "五粮液",   hist: 296.24 },
  { code: "601012", market: "17", name: "隆基绿能", hist: 171.68, warn: "海报口径存疑：接口区间最高 23.57，海报折扣自相矛盾" },
  { code: "688347", market: "17", name: "华虹公司", alias: "华虹宏力", hist: 413.13 },
  { code: "600487", market: "17", name: "亨通光电", hist: 124.85 },
  { code: "603986", market: "17", name: "兆易创新", hist: 846.66 },
  { code: "601888", market: "17", name: "中国中免", hist: 376.00 },
];
const POSTER_REF = { 300308: 590.11, 300502: 258.01, 300750: 220.41, "002384": 113.51, "000858": 71.73, "601012": 11.16, "688347": 163.89, "600487": 51.42, "603986": 276.75, "601888": 48.92 };

/* 公司 Logo：本地 assets/logos/{code}.svg（scripts/fetch-logos.js 预下载）→ 远程公开 CDN → 首字头像 */
const logoUrl = (code) => `assets/logos/${code}.svg`;
const LOGO_REMOTE = (code) => `https://baidu-finance.cdn.bcebos.com/imgs/logo/stocks/stock_ab_${code}.svg`;
const LOGO_ONERR = "if(this.dataset.step==='2'){this.style.display='none';var n=this.nextElementSibling;if(n){n.textContent=(this.dataset.name||'?')[0];n.style.display='inline-flex'}}else{this.dataset.step='2';this.src=this.dataset.remote}";
const logoImg = (code, cls = "", name = "") =>
  `<img class="${cls}" loading="lazy" src="${logoUrl(code)}" data-remote="${LOGO_REMOTE(code)}" data-name="${esc(name)}" alt="" onerror="${LOGO_ONERR}"><span class="lchar ${cls}" style="display:none">${esc((name || "?")[0])}</span>`;

const DEFAULT_BANNER = { title: "双十一来啦", sub: "白马股秒杀活动正式启动" };
const LS = { token: "kb_token", banner: "kb_banner", custom: "kb_custom", sel: "kb_sel", wl: "kb_watchlist", cache: "kb_cache" };
const SEL_MAX = 12;
function getSel() {
  const sel = store.get(LS.sel, null);
  if (sel === null) return STOCKS.map((s) => ({ code: s.code, market: s.market, name: s.alias || s.name }));
  return Array.isArray(sel) ? sel.slice(0, SEL_MAX) : getSelDefaults();
}
function getSelDefaults() {
  return STOCKS.map((s) => ({ code: s.code, market: s.market, name: s.alias || s.name }));
}
function setSel(arr) {
  if (arr === null) store.del(LS.sel);
  else store.set(LS.sel, arr.slice(0, SEL_MAX));
}
const DEFAULT_HIST = (code) => (STOCKS.find((s) => s.code === code) || {}).hist || null;
function intervalHigh(bars) {
  let hi = null;
  if (bars) for (const b of bars) if (b[2] != null && (hi == null || b[2] > hi)) hi = b[2];
  return hi;
}
async function ensureBars(list, silent) {
  const miss = list.filter((x) => !state.daily[x.code]);
  if (!miss.length) return;
  if (!silent) toast(`正在加载新选股票的日K…`);
  const rs = await Promise.allSettled(miss.map((x) => fetchKline(x.market, x.code, "DAILY")));
  const ok = rs.filter((r) => r.status === "fulfilled").length;
  if (ok < miss.length) toast(`有 ${miss.length - ok} 只加载失败（演示模式仅支持内置 10 只）`);
}

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  del(k) { localStorage.removeItem(k); },
};

/* 前端持久缓存：实时拉取失败自动回退；启动先用缓存即时渲染，提升页面来回切换性能 */
const cache = {
  data: store.get(LS.cache, { daily: {}, wl: null }),
  timer: null,
  staleHit: false,
  putDaily(code, bars) {
    this.data.daily[code] = { t: Date.now(), bars: bars.slice(-260) };
    this.schedule();
  },
  getDaily(code) { const e = this.data.daily[code]; return e ? e.bars : null; },
  putWL(data) { this.data.wl = { t: Date.now(), data }; this.schedule(); },
  getWL() { const e = this.data.wl; return e ? e.data : null; },
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 3000);
  },
  flush() {
    clearTimeout(this.timer); this.timer = null;
    // 容量裁剪：超过 40 只时淘汰最旧的
    const keys = Object.keys(this.data.daily);
    if (keys.length > 40) {
      keys.sort((a, b) => (this.data.daily[a].t || 0) - (this.data.daily[b].t || 0));
      for (const k of keys.slice(0, keys.length - 40)) delete this.data.daily[k];
    }
    try { store.set(LS.cache, this.data); } catch (e) { /* 配额满则放弃本次 */ }
  },
};
window.addEventListener("pagehide", () => cache.flush());

const state = {
  mode: "detect",
  daily: {}, intraday: {},
  rows: [], prev: {},
  sortKey: "chgPct", sortDir: -1, filter: "",
  selStock: { s: null, m: null },   // 当前选中（URL ?s=&m=）
  modal: null, modalType: "DAILY",
  klineMarket: "17",
  zoom: 90, cross: null, viewOffset: 0, drag: null,
  errStreak: 0, intradayLoading: false,
  demo: null,
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmt = (v, d = 2) => (v == null || isNaN(v)) ? "--" : Number(v).toFixed(d);
const cls = (v) => v > 0 ? "up" : v < 0 ? "down" : "flat";
const sign = (v) => (v > 0 ? "+" : "") + fmt(v);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ================= 数据源三模式 ================= */
async function detectMode() {
  if (localStorage.getItem(LS.token)) {
    const t = JSON.parse(localStorage.getItem(LS.token));
    if (t && t.trim()) return { mode: "direct", base: "https://live.yjnt111.top", token: t.trim() };
  }
  try {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch("/api/health", { cache: "no-store", signal: ctrl.signal });
    clearTimeout(timer);
    const j = await r.json();
    if (j.code === 200) return { mode: "proxy" };
  } catch (e) { /* 无本地代理 */ }
  return { mode: "demo" };
}
async function getJSON(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    const j = await r.json();
    if (j.code !== 200) throw new Error(j.msg || ("HTTP " + r.status));
    return j;
  } finally { clearTimeout(timer); }
}
const api = {
  async stockList() {
    const M = state.modeInfo;
    if (M.mode === "demo") return state.demo.watchlist;
    let data;
    if (M.mode === "direct") data = (await getJSON(`${M.base}/api/live/stock/market/live`)).data;
    else data = (await getJSON("/api/stock-list")).data;
    // 非交易时段上游可能返回空列表 → 回退：本机缓存 → 内置演示快照的自选池
    if (Array.isArray(data) && data.length) { store.set(LS.wl, { t: Date.now(), data }); return data; }
    const cached = store.get(LS.wl, null);
    if (cached && Array.isArray(cached.data) && cached.data.length) return cached.data;
    try {
      const demo = await (await fetch("assets/demo-data.json")).json();
      if (Array.isArray(demo.watchlist) && demo.watchlist.length) return demo.watchlist;
    } catch (e) {}
    return Array.isArray(data) ? data : [];
  },
  async klineRaw(market, code, type = "DAILY") {
    const M = state.modeInfo;
    if (M.mode === "demo") {
      const p = state.demo.poster.find((x) => x.code === code);
      if (!p) throw new Error("演示模式仅内置 10 只海报股数据");
      if (type === "INTRADAY") return [];
      return p.bars.map((b) => [...b, null]);
    }
    if (M.mode === "direct") {
      const j = await getJSON(`${M.base}/api/live/kline/getKline`);
      return j.data?.[0]?.klineData || [];
    }
    const j = await getJSON(`/api/kline?market=${market}&code=${code}&type=${type}`);
    return j.data?.[0]?.klineData || [];
  },
};
async function fetchKline(market, code, type = "DAILY") {
  let raw, fromCache = false;
  try {
    raw = await api.klineRaw(market, code, type);
  } catch (e) {
    // 实时异常 → 回退本地持久缓存；缓存也没有才向上抛（页面显示异常）
    const cached = type === "DAILY" ? cache.getDaily(code) : null;
    if (!cached || cached.length < 2) throw e;
    raw = cached; fromCache = true;
  }
  if (type === "INTRADAY") {
    // 上游实时动态点时间戳为毫秒、历史分钟点为秒 → 统一秒；过滤脏点
    const arr = raw.filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[4]))
      .map((p) => { const t = p[0] > 1e12 ? Math.round(p[0] / 1000) : p[0]; return [t, ...p.slice(1)]; });
    arr.sort((a, b) => a[0] - b[0]);
    state.intraday[code] = arr;
  } else {
    state.daily[code] = raw;
    if (fromCache) cache.staleHit = true;
    else cache.putDaily(code, raw);
  }
  return raw;
}
/* 全市场搜索：优先本地代理；无代理时直连 dapanv3（仅 http 页面可用） */
async function searchMarket(q) {
  const qs = `query=${encodeURIComponent(q)}&associate=1&json=1&isrealcode=1`;
  const parse = (j) => {
    const head = j?.result?.data?.head || [], body = j?.result?.data?.body || [];
    const i = Object.fromEntries(head.map((h, ix) => [h.id, ix]));
    return body.map((r) => ({ code: r[i.hq_code], name: r[i.stock_name], market: r[i.hq_market], label: r[i.market_label] }))
      .filter((r) => r.market === "17" || r.market === "33").slice(0, 10);
  };
  const withTimeout = async (url) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      return parse(await r.json());
    } catch (e) { return null; }
    finally { clearTimeout(timer); }
  };
  const viaProxy = await withTimeout(`/api/search?q=${encodeURIComponent(q)}`);
  if (viaProxy) return viaProxy;
  const viaDirect = await withTimeout(`http://121.43.127.134:8066/dapanv3/quota/stockDictSearch?${qs}`);
  if (viaDirect) return viaDirect;
  return null;
}

/* ================= 交易时段（Asia/Shanghai） ================= */
function shNow() {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hourCycle: "h23",
    weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t)?.value || "";
  const hm = (+get("hour") % 24) * 60 + +get("minute");
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get("weekday")] ?? 0;
  const inSession = wd >= 1 && wd <= 5 && ((hm >= 565 && hm <= 691) || (hm >= 775 && hm <= 905));
  return { inSession, hms: `${get("hour")}:${get("minute")}:${get("second")}` };
}
const nextDelay = () => (shNow().inSession ? 15000 : 120000);

/* ================= 行情汇总 ================= */
function statFromBars(bars) {
  if (!bars || bars.length < 2) return null;
  const n = bars.length, last = bars[n - 1], prev = bars[n - 2];
  const price = last[4], prevClose = prev[4] || last[4];
  return { price, prevClose, open: last[1], high: last[2], low: last[3],
    chg: price - prevClose, chgPct: (price / prevClose - 1) * 100,
    turnover: last[6], spark: bars.slice(-120).map((b) => b[4]) };
}
function rebuildRows() {
  const map = new Map();
  for (const w of state.watchlist || []) {
    map.set(w.stockCode, { code: w.stockCode, market: w.market, name: w.stockName,
      price: w.currentPrice, chg: w.changePrice, chgPct: w.changePercent,
      amplitude: w.fluctuationPercent, turnoverRate: w.turnoverRate, turnover: w.turnover, hero: false });
  }
  for (const s of STOCKS) {
    const st = statFromBars(state.daily[s.code]);
    if (!st) continue;
    map.set(s.code, { code: s.code, market: s.market, name: s.alias || s.name, price: st.price,
      chg: st.chg, chgPct: st.chgPct, amplitude: st.high && st.low ? (st.high - st.low) / st.prevClose * 100 : null,
      turnoverRate: null, turnover: st.turnover, hero: true });
  }
  state.rows = [...map.values()];
}

/* ================= 图文看板（内容 = 看板选股） ================= */
function posterCfg() {
  const base = {};
  for (const s of STOCKS) base[s.code] = { hist: s.hist };
  return { ...base, ...store.get(LS.custom, {}) };
}
function posterCardHTML(s) {
  return `
    <div class="pcard" id="pc-${s.code}" data-code="${s.code}">
      <canvas class="pbg"></canvas>
      <div class="pct"><span id="pdisc-${s.code}">--折</span></div>
      <div>
        <div><span class="pname">${esc(s.name)}</span><span class="pcode">${s.code}</span></div>
        <div class="phist" id="phistline-${s.code}">历史价 ¥<s id="phist-${s.code}">--</s></div>
        <div class="pprice-l">现价</div>
        <div class="pprice"><small>¥</small><span id="pprice-${s.code}">--</span></div>
        <span class="plive flat" id="plive-${s.code}">--</span>
      </div>
      <div class="pvis"><span class="emoji" style="display:none">📈</span>${logoImg(s.code, "plogo", s.name)}</div>
    </div>`;
}
function bindPosterCardEvents(grid) {
  grid.querySelectorAll(".pcard").forEach((c) => c.addEventListener("click", (e) => {
    const code = c.dataset.code;
    const meta = getSel().find((x) => x.code === code) || {};
    openStock(code, meta.market);
  }));
  const saveBn = () => { store.set(LS.banner, { title: $("#bnTitle").textContent.trim() || DEFAULT_BANNER.title, sub: $("#bnSub").textContent.trim() || DEFAULT_BANNER.sub }); toast("文案已保存（仅本机生效）"); };
  ["#bnTitle", "#bnSub"].forEach((sel) => {
    $(sel).addEventListener("dblclick", () => $(sel).setAttribute("contenteditable", "true"));
    $(sel).addEventListener("blur", () => { if ($(sel).getAttribute("contenteditable") === "true") { $(sel).setAttribute("contenteditable", "false"); saveBn(); } });
  });
}
function renderBoard() {
  const sel = getSel();
  const cfg = posterCfg();
  const bn = store.get(LS.banner, DEFAULT_BANNER);
  $("#bnTitle").textContent = bn.title; $("#bnSub").textContent = bn.sub;

  const grid = $("#posterGrid");
  const sig = sel.map((x) => x.code).join(",");
  if (!sel.length) {
    grid.dataset.sig = "";
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:#ffdca0;padding:40px 0;font-size:15px;letter-spacing:1px">看板为空 —— 去「📝 纯文本」页勾选股票，或点「恢复默认海报股」</div>`;
    $("#posterNote").innerHTML = `数据源：第三方公开行情接口 · 不构成投资建议`;
    return;
  }
  if (grid.dataset.sig !== sig) {
    grid.dataset.sig = sig;
    grid.innerHTML = sel.map(posterCardHTML).join("");
    bindPosterCardEvents(grid);
  }

  for (const s of sel) {
    const bars = state.daily[s.code], card = $(`#pc-${s.code}`);
    if (!card) continue;
    const custom = cfg[s.code] || {};
    const defHist = DEFAULT_HIST(s.code);
    const hi = intervalHigh(bars);
    const hist = custom.hist || defHist || (isFinite(hi) ? hi : null);
    $(`#phistline-${s.code}`).innerHTML = `${defHist ? "历史价" : "历史价(区间)"} ¥<s id="phist-${s.code}">${fmt(hist)}</s>`;
    if (!bars) { card.style.opacity = .55; continue; }
    card.style.opacity = 1;
    const st = statFromBars(bars);
    $(`#pprice-${s.code}`).textContent = fmt(st.price);
    const live = $(`#plive-${s.code}`);
    live.textContent = `${sign(st.chg)} ${sign(st.chgPct)}%`;
    live.className = "plive " + cls(st.chg);
    if (hist) $(`#pdisc-${s.code}`).textContent = "约" + fmt(st.price / hist * 10, 1) + "折";
    card.title = (STOCKS.find((x) => x.code === s.code) || {}).warn || "";
    drawSpark(makeSparkIn(card), st.spark, st.chg >= 0, "#d9a441");
    drawCardBg(card.querySelector(".pbg"), bars);
    if (state.selStock.s === s.code) card.classList.add("sel"); else card.classList.remove("sel");
  }
  const up = shNow();
  $("#posterNote").innerHTML =
    `价格截至 <b>${up.hms}</b> · 单位：元/股 · 盘中实时刷新 · 公司 Logo 来自公开数据<br>` +
    `历史价可在卡片上自定义（默认取海报基准或区间最高） · <b>折扣 = 现价 ÷ 历史价 × 10</b><br>` +
    `数据源：第三方公开行情接口 · 价格回落不代表估值便宜，不构成投资建议`;
}
/* 卡片背景：K线收盘价走势水印（低透明度 + 渐变，不影响前景文字） */
function drawCardBg(cv, bars) {
  if (!cv || !bars || bars.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const data = bars.slice(-120).map((b) => b[4]);
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1;
  const x = (i) => 4 + (i / (data.length - 1)) * (w - 8);
  const y = (v) => h - 8 - ((v - min) / rng) * (h - 20);
  const up = data[data.length - 1] >= data[0];
  const col = up ? "214,64,72" : "32,148,106";
  ctx.beginPath();
  data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.strokeStyle = `rgba(${col},.35)`; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.lineTo(x(data.length - 1), h); ctx.lineTo(x(0), h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(${col},.15)`); g.addColorStop(1, `rgba(${col},.02)`);
  ctx.fillStyle = g; ctx.fill();
}
function makeSparkIn(card) {
  let cv = card.querySelector("canvas");
  if (!cv) { cv = document.createElement("canvas"); card.querySelector(".pvis").appendChild(cv); }
  return cv;
}

/* ================= 经典看板（内容 = 看板选股） ================= */
function cardHTML(s) {
  return `
    <div class="card" id="cd-${s.code}" data-code="${s.code}">
      <div class="r1">
        ${logoImg(s.code, "clogo", s.name)}<span class="cchar" style="display:none;color:var(--gold);font-weight:800">${esc((s.name)[0])}</span>
        <span class="name">${esc(s.name)}</span>
        <span class="code">${s.code}</span>
        <span class="mkt">${s.market === "17" ? "沪" : "深"}</span>
        <span class="disc" id="cdisc-${s.code}">--折</span>
      </div>
      <div class="r2"><span class="price" id="cprice-${s.code}">--</span><span class="chg" id="cchg-${s.code}"></span></div>
      <div class="ohlc">
        <div>开盘<b id="co-${s.code}">--</b></div><div>最高<b id="ch-${s.code}">--</b></div>
        <div>最低<b id="cl-${s.code}">--</b></div><div>昨收<b id="cpc-${s.code}">--</b></div>
      </div>
      <canvas class="spark" id="csp-${s.code}"></canvas>
      <div class="meta"><span>区间最高 <b id="chi-${s.code}">--</b></span><span id="chid-${s.code}"></span></div>
      <div class="posterline" id="cline-${s.code}"></div>
    </div>`;
}
function renderCards() {
  const sel = getSel();
  const grid = $("#cardsGrid");
  const sig = sel.map((x) => x.code).join(",");
  if (!sel.length) {
    grid.dataset.sig = "";
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px 0">看板为空 —— 去「📝 纯文本」页勾选股票</div>`;
    return;
  }
  if (grid.dataset.sig !== sig) {
    grid.dataset.sig = sig;
    grid.innerHTML = sel.map(cardHTML).join("");
    grid.querySelectorAll(".card").forEach((c) =>
      c.addEventListener("click", () => {
        const meta = getSel().find((x) => x.code === c.dataset.code) || {};
        openStock(c.dataset.code, meta.market);
      }));
    enableCardDrag(grid);
  }
  for (const s of sel) {
    const st = statFromBars(state.daily[s.code]), card = $(`#cd-${s.code}`);
    if (!card) continue;
    const custom = (store.get(LS.custom, {})[s.code]) || {};
    if (custom.name) card.querySelector(".name").textContent = custom.name;
    if (!st) { card.classList.add("err"); continue; }
    card.classList.remove("err");
    const hist = custom.hist || DEFAULT_HIST(s.code) || intervalHigh(state.daily[s.code]) || st.price;
    const pcEl = $(`#cprice-${s.code}`);
    pcEl.textContent = fmt(st.price);
    pcEl.className = "price " + cls(st.chg);
    const chgEl = $(`#cchg-${s.code}`);
    chgEl.textContent = `${sign(st.chg)}  ${sign(st.chgPct)}%`;
    chgEl.className = "chg " + cls(st.chg);
    $(`#co-${s.code}`).textContent = fmt(st.open);
    $(`#ch-${s.code}`).textContent = fmt(st.high);
    $(`#cl-${s.code}`).textContent = fmt(st.low);
    $(`#cpc-${s.code}`).textContent = fmt(st.prevClose);
    const hi = intervalHigh(state.daily[s.code]);
    $(`#chi-${s.code}`).textContent = fmt(hi);
    let hiDate = "";
    for (const b of state.daily[s.code]) if (b[2] != null && b[2] === hi) { hiDate = String(b[0]).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"); break; }
    $(`#chid-${s.code}`).textContent = hiDate;
    $(`#cdisc-${s.code}`).textContent = fmt(st.price / hist * 10, 2) + " 折";
    const ref = POSTER_REF[s.code];
    const cline = $(`#cline-${s.code}`);
    if (ref) {
      cline.style.display = "";
      cline.innerHTML = `海报基准(10-22)：历史 <em>${fmt(hist)}</em> → ${fmt(ref)} ≈ <em>${fmt(ref / hist * 10, 1)} 折</em>${(STOCKS.find((x) => x.code === s.code) || {}).warn ? ' <span class="warn-tri" title="海报口径存疑">⚠</span>' : ""}`;
    } else {
      cline.style.display = "none";
    }
    drawSpark($(`#csp-${s.code}`), st.spark, st.chg > 0, st.chg === 0 ? "#8b90a5" : undefined);
    flashIfChanged(s.code, st.price, pcEl);
    card.classList.toggle("sel", state.selStock.s === s.code);
  }
}
/* 拖拽排序：顺序即看板选股顺序，持久化并同步到图文看板 */
function enableCardDrag(grid) {
  let dragIdx = -1;
  grid.querySelectorAll(".card").forEach((c, i) => {
    c.draggable = true;
    c.addEventListener("dragstart", (e) => {
      dragIdx = i;
      c.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", c.dataset.code); } catch (_) {}
    });
    c.addEventListener("dragend", () => {
      dragIdx = -1;
      c.classList.remove("dragging");
      grid.querySelectorAll(".card").forEach((x) => x.classList.remove("drag-over"));
    });
    c.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (i !== dragIdx) c.classList.add("drag-over");
    });
    c.addEventListener("dragleave", () => c.classList.remove("drag-over"));
    c.addEventListener("drop", (e) => {
      e.preventDefault();
      c.classList.remove("drag-over");
      if (dragIdx < 0 || dragIdx === i) return;
      const sel = getSel();
      if (dragIdx >= sel.length || i >= sel.length) return;
      const [moved] = sel.splice(dragIdx, 1);
      sel.splice(i, 0, moved);
      setSel(sel);
      renderCards();
      toast("顺序已保存，图文看板同步更新");
    });
  });
}
function flashIfChanged(code, price, el) {
  const prev = state.prev[code];
  if (prev != null && prev !== price) {
    el.classList.remove("flash-up", "flash-down");
    void el.offsetWidth;
    el.classList.add(price > prev ? "flash-up" : "flash-down");
  }
  state.prev[code] = price;
}

/* ================= 纯文本（多选看板 + 全表头排序） ================= */
function textRows() {
  let rows = state.rows;
  const f = state.filter.trim().toLowerCase();
  if (f) rows = rows.filter((r) => r.code.includes(f) || r.name.toLowerCase().includes(f));
  const cmp = (a, b) => {
    const va = a[state.sortKey], vb = b[state.sortKey];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (typeof va === "string" ? String(va).localeCompare(String(vb), "zh") : va - vb) * state.sortDir;
  };
  // 看板选股按看板顺序置顶，其余按当前排序
  const selOrder = getSel().map((x) => x.code);
  const selSet = new Set(selOrder);
  const chosen = [], rest = [];
  for (const r of rows) (selSet.has(r.code) ? chosen : rest).push(r);
  chosen.sort((a, b) => selOrder.indexOf(a.code) - selOrder.indexOf(b.code));
  rest.sort(cmp);
  return [...chosen, ...rest];
}
function renderText() {
  const rows = textRows();
  const selCodes = new Set(getSel().map((x) => x.code));
  $("#countChip").textContent = `${state.rows.length} 只${state.filter ? `（过滤后 ${rows.length}）` : ""}`;
  $("#selChip").textContent = `看板 ${selCodes.size} 只（图文/经典页展示）`;
  $("#tbody").innerHTML = rows.map((r) => {
    const pk = "P" + r.code;
    const flash = state.prev[pk] != null && state.prev[pk] !== r.price ? (r.price > state.prev[pk] ? "flash-up" : "flash-down") : "";
    state.prev[pk] = r.price;
    return `<tr data-code="${r.code}" data-market="${r.market}" class="${selCodes.has(r.code) ? "hero " : ""}${state.selStock.s === r.code ? "sel" : ""}">
      <td class="selcell"><label class="selwrap"><input type="checkbox" class="selcb" data-code="${r.code}" data-market="${r.market}" data-name="${esc(r.name)}" ${selCodes.has(r.code) ? "checked" : ""}></label></td>
      <td class="namecell"><span class="nm">${logoImg(r.code, "nmlogo", r.name)}<b>${esc(r.name)}</b></span></td>
      <td style="color:var(--muted)">${r.code}</td>
      <td class="${cls(r.chg)} ${flash}">${fmt(r.price)}</td>
      <td class="${cls(r.chg)}">${sign(r.chgPct)}%</td>
      <td class="${cls(r.chg)}">${sign(r.chg)}</td>
      <td style="color:var(--muted)">${fmt(r.amplitude)}%</td>
      <td style="color:var(--muted)">${fmt(r.turnoverRate)}%</td>
      <td style="color:var(--muted)">${fmt(r.turnover / 1e8)} 亿</td>
    </tr>`;
  }).join("") || `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:24px">无匹配</td></tr>`;
  // 表头排序箭头
  $$("#tbl thead th").forEach((th) => {
    th.classList.remove("asc", "desc");
    if (th.dataset.k === state.sortKey) th.classList.add(state.sortDir < 0 ? "desc" : "asc");
  });
  // 事件
  $("#tbody").querySelectorAll("tr[data-code]").forEach((tr) =>
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".selcell")) return;
      openStock(tr.dataset.code, tr.dataset.market);
    }));
  $("#tbody").querySelectorAll("input.selcb").forEach((cb) =>
    cb.addEventListener("change", () => toggleSel(cb.dataset, cb.checked, cb)));
}
/* 勾选/取消：只更新必要 UI，不整表重绘（避免点选闪烁感） */
async function toggleSel(meta, on, cbEl) {
  let sel = getSel();
  if (on) {
    if (sel.some((x) => x.code === meta.code)) return;
    if (sel.length >= SEL_MAX) {
      if (cbEl) cbEl.checked = false;
      toast(`看板最多 ${SEL_MAX} 只，请在卡片上移出后再加`);
      return;
    }
    sel = [...sel, { code: meta.code, market: meta.market, name: meta.name }];
    setSel(sel);
    await ensureBars([{ code: meta.code, market: meta.market }]);
    toast(`已加入看板（${getSel().length}/${SEL_MAX}）`);
  } else {
    sel = sel.filter((x) => x.code !== meta.code);
    setSel(sel);
    if (!sel.length) toast("看板已清空，勾选股票即可重新添加");
  }
  updateSelChip();
}
function updateSelChip() {
  const chip = $("#selChip");
  if (chip) chip.textContent = `看板 ${getSel().length} 只（图文/经典页展示）`;
}
/* 全选：按当前排序从第一行起依次加入看板（受上限约束） */
async function selectFromTop() {
  const rows = textRows();
  if (!rows.length) { toast("当前筛选为空"); return; }
  const selCodes = new Set(getSel().map((x) => x.code));
  const add = rows.filter((r) => !selCodes.has(r.code));
  if (!add.length) { toast("当前筛选的股票都已加入看板"); return; }
  const sel = getSel();
  const room = SEL_MAX - sel.length;
  if (room <= 0) { toast(`看板已满 ${SEL_MAX} 只，请先「全部取消」或移出部分`); return; }
  if (add.length > room) toast(`看板上限 ${SEL_MAX} 只，已从第一行起依次加入 ${room} 只`);
  else toast("已从第一行起依次加入看板");
  const adding = add.slice(0, room).map((r) => ({ code: r.code, market: r.market, name: r.name }));
  setSel([...sel, ...adding]);
  await ensureBars(adding);
  renderText();
  updateSelChip();
}
$("#selAllBtn") && $("#selAllBtn").addEventListener("click", selectFromTop);
$("#headAll") && $("#headAll").addEventListener("click", selectFromTop);
/* 不选：只取消当前筛选行的勾选（不影响筛选外的看板股） */
$("#headNone") && $("#headNone").addEventListener("click", () => {
  const rows = textRows();
  const rm = new Set(rows.map((r) => r.code));
  const next = getSel().filter((x) => !rm.has(x.code));
  setSel(next);
  renderText();
  updateSelChip();
  toast(next.length ? "已取消当前筛选的勾选" : "已取消当前筛选的勾选，看板已清空");
});
/* 全部取消：清空看板 */
$("#selNoneBtn") && $("#selNoneBtn").addEventListener("click", () => {
  setSel([]);
  document.querySelectorAll("input.selcb").forEach((cb) => { cb.checked = false; });
  renderText();
  updateSelChip();
  toast("已清空看板，勾选股票即可重新添加");
});
$("#selReset") && $("#selReset").addEventListener("click", async () => {
  setSel(null);
  await ensureBars(getSel());
  renderText();
  updateSelChip();
  toast("已恢复默认海报股");
});
$("#searchInput") && $("#searchInput").addEventListener("input", (e) => { state.filter = e.target.value; renderText(); });
$("#searchInput") && $("#searchInput").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim(); if (!q) return;
  const res = await searchMarket(q);
  if (res && res.length) { pickSearch(res[0]); const d = $("#searchDrop"); if (d) d.classList.remove("show"); }
  else toast(res === null ? "全市场搜索需要本地代理（node server.js）" : "未找到该股票");
});
let searchTimer = null;
$("#searchInput") && $("#searchInput").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { const d = $("#searchDrop"); if (d) d.classList.remove("show"); return; }
  searchTimer = setTimeout(async () => {
    const res = await searchMarket(q);
    const drop = $("#searchDrop");
    if (!drop) return;
    if (!res || !res.length) { drop.classList.remove("show"); return; }
    drop.innerHTML = res.map((r) => `<div class="sr" data-code="${r.code}" data-market="${r.market}" data-name="${esc(r.name)}">${logoImg(r.code, "slogo", r.name)}<b>${esc(r.name)}</b><span style="color:var(--muted)">${r.code}</span><span class="mkt">${esc(r.label)}</span></div>`).join("");
    drop.classList.add("show");
    drop.querySelectorAll(".sr").forEach((el) => el.addEventListener("click", () => { pickSearch(el.dataset); drop.classList.remove("show"); }));
  }, 350);
});
document.addEventListener("click", (e) => { const d = $("#searchDrop"); if (d && !e.target.closest(".searchbox")) d.classList.remove("show"); });
async function pickSearch(r) {
  toast(`正在加载 ${r.name} ${r.code} …`);
  try { await fetchKline(r.market, r.code, "DAILY"); openStock(r.code, r.market); }
  catch (e) { toast("加载失败：" + e.message); }
}
/* 排序：所有数据表头（事件委托，点击「选」列除外），箭头指示当前排序 */
const tblHead = document.querySelector("#tbl thead");
tblHead && tblHead.addEventListener("click", (e) => {
  if (e.target.closest(".selcell")) return;
  const th = e.target.closest("th");
  if (!th || !th.dataset.k) return;
  if (state.sortKey === th.dataset.k) state.sortDir *= -1;
  else { state.sortKey = th.dataset.k; state.sortDir = -1; }
  renderText();
});

/* ================= K线渲染入口（弹层与独立页共用） ================= */
function renderChart() {
  if (state.modalType === "DAILY") { drawDaily(); updateChartInfo(state.cross); }
  else { drawIntradayTHS(); updateIntraInfo(state.cross); }
}

/* ================= 共享弹层 / 设置 / 海报 / Toast（JS 注入，各页共用） ================= */
function injectChrome() {
  const modalHTML = PAGE === "kline" ? "" : `
  <div class="overlay" id="overlay">
    <div class="modal">
      <div class="mhead">
        <img class="mlogo" id="mLogo" alt="" /><span class="lchar mlogo" id="mLogoChar" style="display:none"></span>
        <span class="name" id="mName">--</span>
        <span class="sub" id="mCode"></span>
        <span class="mdisc" id="mDisc" hidden></span>
        <div class="right">
          <div class="tab-mini">
            <span class="tab on" data-t="DAILY">日 K</span>
            <span class="tab" data-t="INTRADAY">分时</span>
          </div>
          <a class="btn mini ghost" id="mStandalone" href="#" target="_blank">↗ 独立页</a>
          <button class="btn mini" id="mShare">🔗 复制链接</button>
          <span class="close" id="mClose">✕</span>
        </div>
      </div>
      <div id="chartInfo" class="chart-info">--</div>
      <canvas id="chart"></canvas>
      <div class="legend">
        <span><i style="background:#ff4d57"></i>涨</span>
        <span><i style="background:#22c584"></i>跌</span>
        <span style="color:#fff">MA5</span><span style="color:#f4d03f">MA10</span><span style="color:#e05ffd">MA20</span><span style="color:#4adfae">MA30</span>
        <span style="color:#ffd54d">黄线 = 均价（分时）</span>
        <span>滚轮缩放 · 拖拽/Shift+滚轮平移 · 十字光标查看报价 · ↗ 独立页</span>
      </div>
    </div>
  </div>
  <div class="tip" id="tip"></div>`;
  const settingsHTML = `
  <div class="overlay" id="settingsOverlay">
    <div class="modal settings">
      <h3>⚙️ 数据源设置</h3>
      <p id="modeExplain"></p>
      <p>粘贴你在数据源站点登录后的 <b>Bearer token</b>（浏览器 F12 → Network → 任意请求 → Request Headers → Authorization），即可在本页直连实时行情（token 仅存本机 localStorage）：</p>
      <textarea id="tokenInput" placeholder="eyJhbGciOiJIzUxMiJ9...."></textarea>
      <div class="row">
        <button class="btn ghost" id="tokenClear">清除</button>
        <button class="btn" id="tokenSave">保存并重连</button>
        <button class="btn ghost" id="settingsClose">关闭</button>
      </div>
    </div>
  </div>`;
  const toastHTML = `<div id="toast"></div>`;
  const posterHTML = `
  <div class="overlay" id="posterOverlay">
    <div class="modal poster-modal">
      <div class="mhead">
        <span class="name">🎨 分享海报</span>
        <span class="sub">内容 = 当前看板选股</span>
        <div class="right">
          <div class="tab-mini">
            <span class="tab on" data-p="portrait">📱 竖排</span>
            <span class="tab" data-p="landscape">🖥️ 横屏</span>
          </div>
          <span class="close" id="posterClose">✕</span>
        </div>
      </div>
      <div class="poster-preview"><canvas id="posterCanvas"></canvas></div>
      <div class="poster-actions">
        <button class="btn" id="posterDownload">⬇️ 下载 PNG</button>
        <button class="btn ghost" id="posterCopyImg">复制图片</button>
        <button class="btn ghost" id="posterCopyLink">🔗 复制链接</button>
      </div>
      <p class="hint">海报右下角二维码 = 当前页面链接，扫码即可打开同款看板。</p>
    </div>
  </div>`;
  document.body.insertAdjacentHTML("beforeend", modalHTML + settingsHTML + toastHTML + (PAGE === "board" ? posterHTML : ""));
  bindChrome();
}
function bindChrome() {
  const cv = $("#chart");
  if (cv) {
    // 图表交互对所有页面共用（含独立 kline 页）
    cv.addEventListener("mousemove", chartHover);
    cv.addEventListener("mouseleave", () => {
      state.cross = null; state.drag = null; cv.style.cursor = "crosshair";
      const tip = $("#tip"); if (tip) tip.style.display = "none";
      renderChart();
    });
    cv.addEventListener("wheel", (e) => {
      if (state.modalType !== "DAILY") return;
      e.preventDefault();
      const bars = state.daily[state.modal];
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // 左右平移：Shift+滚轮 或 触控板横向滑动
        if (!bars) return;
        const step = Math.max(2, Math.round(state.zoom / 8));
        const dir = (e.deltaY || e.deltaX) > 0 ? 1 : -1;
        state.viewOffset = (state.viewOffset || 0) + dir * step;
      } else {
        state.zoom = Math.min(240, Math.max(30, state.zoom + (e.deltaY > 0 ? 12 : -12)));
        state.viewOffset = Math.min(state.viewOffset || 0, Math.max(0, bars.length - state.zoom));
      }
      drawDaily(); updateChartInfo(state.cross);
    }, { passive: false });
    cv.addEventListener("mousedown", (e) => {
      if (state.modalType !== "DAILY") return;
      state.drag = { x: e.clientX, offset: state.viewOffset || 0 };
      cv.style.cursor = "grabbing";
    });
    window.addEventListener("mouseup", () => {
      if (state.drag) { state.drag = null; cv.style.cursor = "crosshair"; }
    });
  }
  if (PAGE !== "kline") {
    $("#mClose").addEventListener("click", closeModal);
    $("#overlay").addEventListener("click", (e) => { if (e.target === $("#overlay")) closeModal(); });
    $("#mShare").addEventListener("click", () => copyShare(state.modal));
  }
  $$(".tab[data-t]").forEach((t) => t.addEventListener("click", () => switchChartType(t)));
  if (PAGE === "kline") $("#shareBtn2").addEventListener("click", () => copyShare());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.modal && PAGE !== "kline") closeModal(); });
  window.addEventListener("resize", () => { renderPageView(); renderChart(); });
  $("#settingsBtn") && $("#settingsBtn").addEventListener("click", showSettings);
  $("#settingsClose") && $("#settingsClose").addEventListener("click", () => $("#settingsOverlay").classList.remove("show"));
  $("#settingsOverlay") && $("#settingsOverlay").addEventListener("click", (e) => { if (e.target === $("#settingsOverlay")) $("#settingsOverlay").classList.remove("show"); });
  $("#tokenSave").addEventListener("click", () => {
    const t = $("#tokenInput").value.trim();
    if (t) store.set(LS.token, t); else store.del(LS.token);
    toast("已保存，正在重连…"); location.reload();
  });
  $("#tokenClear").addEventListener("click", () => { store.del(LS.token); $("#tokenInput").value = ""; toast("已清除，保存后将切换为代理/演示模式"); });
  $("#shareBtn") && $("#shareBtn").addEventListener("click", () => copyShare());
  $("#refreshBtn") && $("#refreshBtn").addEventListener("click", () => { state.nextAt = Date.now() + nextDelay(); refresh(); });
  $("#posterBtn") && $("#posterBtn").addEventListener("click", () => { $("#posterOverlay").classList.add("show"); drawPoster().catch((err) => toast("海报生成失败：" + err.message)); });
  $("#posterClose") && $("#posterClose").addEventListener("click", () => $("#posterOverlay").classList.remove("show"));
  $("#posterOverlay") && $("#posterOverlay").addEventListener("click", (e) => { if (e.target === $("#posterOverlay")) $("#posterOverlay").classList.remove("show"); });
  $$(".tab[data-p]").forEach((t) => t.addEventListener("click", () => {
    $$(".tab[data-p]").forEach((x) => x.classList.remove("on")); t.classList.add("on");
    posterState.mode = t.dataset.p; drawPoster();
  }));
  $("#posterDownload") && $("#posterDownload").addEventListener("click", () => {
    const a = document.createElement("a");
    a.download = `看板海报-${posterState.mode === "portrait" ? "竖排" : "横屏"}.png`;
    a.href = $("#posterCanvas").toDataURL("image/png");
    a.click(); toast("海报已保存");
  });
  $("#posterCopyImg") && $("#posterCopyImg").addEventListener("click", () => {
    $("#posterCanvas").toBlob(async (blob) => {
      if (!blob) return toast("生成失败");
      try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); toast("图片已复制"); }
      catch (e) { toast("当前浏览器不支持复制图片，请用下载"); }
    });
  });
  $("#posterCopyLink") && $("#posterCopyLink").addEventListener("click", () => copyShare());
}
async function switchChartType(t) {
  $$(".tab[data-t]").forEach((x) => x.classList.remove("on"));
  t.classList.add("on");
  state.modalType = t.dataset.t; state.zoom = 90; state.cross = null; state.viewOffset = 0;
  if (PAGE === "kline") setPageParams({ s: state.modal, m: state.klineMarket, t: state.modalType });
  renderChart();
  const code = state.modal;
  if (state.modalType === "INTRADAY" && code && !state.intraday[code]) {
    const mkt = state.klineMarket || (getSel().find((x) => x.code === code) || {}).market || "17";
    state.intradayLoading = true; renderChart();
    try { await fetchKline(mkt, code, "INTRADAY"); } catch (e) {}
    state.intradayLoading = false; renderChart();
  }
}
function chartHover(e) {
  const cv = e.target, rect = cv.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  // 拖拽平移：左右拖动查看历史/未来
  if (state.drag) {
    const d = cv._daily, bars = state.daily[state.modal];
    if (d && bars) {
      const shift = Math.round((e.clientX - state.drag.x) / d.cw);
      const maxOff = Math.max(0, bars.length - state.zoom);
      state.viewOffset = Math.min(maxOff, Math.max(0, state.drag.offset + shift));
      state.cross = null;
      drawDaily(); updateChartInfo(null);
    }
    return;
  }
  let idx = null;
  if (state.modalType === "DAILY") {
    const d = cv._daily;
    if (d) { idx = Math.round((mx - d.cw / 2) / d.cw); if (idx < 0 || idx >= d.view.length) idx = null; }
  } else {
    const d = cv._intra;
    if (d) {
      let bd = Infinity;
      d.pts.forEach((p, i) => { const dd = Math.abs(d.X(p[0]) - mx); if (dd < bd) { bd = dd; idx = i; } });
      if (bd > 40) idx = null;
    }
  }
  state.cross = idx;
  renderChart();
  const tip = $("#tip");
  if (tip) tip.style.display = "none";
}

/* ================= 弹层（board/cards/text 页内快览） ================= */
async function openModal(code) {
  const meta = getSel().find((x) => x.code === code) || {};
  const row = state.rows.find((r) => r.code === code);
  state.modal = code; state.zoom = 90; state.cross = null; state.viewOffset = 0;
  const mkt = meta.market || state.selStock.m || (row && row.market) || "17";
  state.selStock = { s: code, m: mkt };
  setPageParams({ s: code, m: mkt, t: null });
  const mLogo = $("#mLogo");
  mLogo.style.visibility = "visible"; mLogo.dataset.step = "1";
  const nameResolved = meta.name || (row && row.name) || code;
  $("#mLogoChar").textContent = nameResolved[0];
  mLogo.onerror = function () {
    if (this.dataset.step === "2") { this.style.visibility = "hidden"; $("#mLogoChar").style.display = "inline-flex"; }
    else { this.dataset.step = "2"; this.src = LOGO_REMOTE(code); }
  };
  mLogo.src = logoUrl(code);
  $("#mName").textContent = nameResolved;
  $("#mCode").textContent = `${code} · ${mkt === "17" ? "沪" : "深"}市`;
  $("#mStandalone").href = `kline.html?s=${code}&m=${mkt}&t=${state.modalType}`;
  const bars = state.daily[code];
  if (bars) {
    const st = statFromBars(bars);
    const hist = (store.get(LS.custom, {})[code] || {}).hist || DEFAULT_HIST(code) || intervalHigh(bars);
    $("#mDisc").hidden = false;
    $("#mDisc").textContent = `实时 ${fmt(st.price / hist * 10, 2)} 折 · 历史价 ${fmt(hist)}`;
  } else $("#mDisc").hidden = true;
  $("#overlay").classList.add("show");
  renderChart();
  try { await fetchKline(mkt, code, "INTRADAY"); if (state.modal === code && state.modalType === "INTRADAY") renderChart(); } catch (e) {}
}
function closeModal() {
  state.modal = null;
  const tip = $("#tip"); if (tip) tip.style.display = "none";
  $("#overlay").classList.remove("show");
  state.selStock = { s: null, m: null };
  setPageParams({ s: null, m: null, t: null });
}
function openStock(code, market) {
  state.selStock = { s: code, m: market || state.selStock.m || "17" };
  openModal(code);
}

/* ================= 分享 ================= */
async function copyShare(code) {
  if (code && PAGE !== "kline") {
    const meta = getSel().find((x) => x.code === code) || {};
    state.selStock = { s: code, m: meta.market || "17" };
    setPageParams({ s: code, m: state.selStock.m, t: null });
  }
  const url = location.href;
  try { await navigator.clipboard.writeText(url); toast("链接已复制，粘贴给朋友即可打开同款视图 ✨"); }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = url; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("链接已复制 ✨"); } catch (e2) { toast("复制失败，请手动复制地址栏"); }
    ta.remove();
  }
}

/* ================= 设置 ================= */
const MODE_TEXT = {
  proxy: "代理模式：本地 server.js 已注入 token，无需配置，功能完整（含全市场搜索）。",
  direct: "直连模式：使用本机保存的 token 直接请求数据源。https 部署（如 GitHub Pages）下全市场搜索不可用（上游仅 HTTP）。",
  demo: "演示模式：当前展示内置快照数据（无实时）。填入 token 或启动本地代理即可激活实时行情。",
};
function showSettings() {
  $("#modeExplain").textContent = MODE_TEXT[state.mode] || "";
  $("#tokenInput").value = localStorage.getItem(LS.token) ? JSON.parse(localStorage.getItem(LS.token)) : "";
  $("#settingsOverlay").classList.add("show");
}

/* ================= 海报生成（竖排/横屏 + 二维码） ================= */
const posterState = { mode: "portrait" };
const QR_API = (data) => `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=12&data=${encodeURIComponent(data)}`;
function loadImg(src, cors, timeoutMs = 6000) {
  return new Promise((res) => {
    const im = new Image();
    if (cors) im.crossOrigin = "anonymous";
    const done = (v) => { clearTimeout(timer); res(v); };
    const timer = setTimeout(() => done(null), timeoutMs);
    im.onload = () => done(im);
    im.onerror = () => done(null);
    im.src = src;
  });
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
async function posterItems() {
  return getSel().map((x) => {
    const bars = state.daily[x.code];
    const st = statFromBars(bars);
    const custom = (store.get(LS.custom, {})[x.code]) || {};
    const hist = custom.hist || DEFAULT_HIST(x.code) || intervalHigh(bars) || (st && st.price) || null;
    return { code: x.code, name: custom.name || x.name, price: st ? st.price : null, chgPct: st ? st.chgPct : 0, hist };
  }).filter((x) => x.price != null && x.hist);
}
async function drawPoster() {
  const portrait = posterState.mode === "portrait";
  const W = portrait ? 750 : 1600, H = portrait ? 1334 : 900;
  const cv = $("#posterCanvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const bn = store.get(LS.banner, DEFAULT_BANNER);
  const font = (px, w = 900) => `${w} ${px}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif`;
  const g = ctx.createLinearGradient(0, 0, W * 0.35, H);
  g.addColorStop(0, "#d3252b"); g.addColorStop(0.55, "#b3141a"); g.addColorStop(1, "#8c0e13");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,215,120,.13)"; ctx.font = "900 170px Georgia";
  ctx.save(); ctx.translate(60, 150); ctx.rotate(-0.22); ctx.fillText("%", 0, 0); ctx.restore();
  ctx.save(); ctx.translate(W - 100, H - 30); ctx.rotate(0.18); ctx.fillText("%", 0, 0); ctx.restore();
  ctx.strokeStyle = "rgba(255,215,120,.4)"; ctx.lineWidth = 3;
  rr(ctx, 14, 14, W - 28, H - 28, 22); ctx.stroke();
  ctx.textAlign = "center"; ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowOffsetY = 4;
  ctx.fillStyle = "#ffd873"; ctx.font = font(portrait ? 60 : 52);
  ctx.fillText(bn.title, W / 2, portrait ? 122 : 88);
  ctx.font = font(portrait ? 27 : 25);
  const subW = ctx.measureText(bn.sub).width + (portrait ? 90 : 80);
  const ry = portrait ? 152 : 116, rh = portrait ? 56 : 50;
  const rg = ctx.createLinearGradient(0, ry, 0, ry + rh);
  rg.addColorStop(0, "#ffe08a"); rg.addColorStop(1, "#f0b23e");
  ctx.shadowColor = "transparent";
  ctx.fillStyle = rg; rr(ctx, (W - subW) / 2, ry, subW, rh, 10); ctx.fill();
  ctx.fillStyle = "#7c1013"; ctx.textBaseline = "middle";
  ctx.fillText(bn.sub, W / 2, ry + rh / 2 + 2);
  ctx.textBaseline = "alphabetic";

  const items = await posterItems();
  const logos = await Promise.all(items.map((x) => {
    return (async () => (await loadImg(logoUrl(x.code), true, 4000)) || (await loadImg(LOGO_REMOTE(x.code), true, 4000)))();
  }));
  const n = items.length;
  const cols = portrait ? 2 : Math.min(5, n);
  const rows = Math.ceil(Math.max(n, 1) / cols);
  const gapX = portrait ? 18 : 16, gapY = 16;
  const cardW = portrait ? 330 : Math.floor((W - 80 - (cols - 1) * gapX) / cols);
  const cardH = portrait ? 152 : Math.min(250, Math.floor((H - (portrait ? 240 : 180) - 60 - (rows - 1) * gapY) / rows));
  const startX = (W - (cols * cardW + (cols - 1) * gapX)) / 2;
  const startY = portrait ? 236 : 186;

  items.forEach((x, i) => {
    const cx = startX + (i % cols) * (cardW + gapX);
    const cy = startY + Math.floor(i / cols) * (cardH + gapY);
    const cg = ctx.createLinearGradient(cx, cy, cx, cy + cardH);
    cg.addColorStop(0, "#fffdf7"); cg.addColorStop(1, "#fff8ec");
    ctx.fillStyle = cg; rr(ctx, cx, cy, cardW, cardH, 14); ctx.fill();
    ctx.strokeStyle = "#f3ddb2"; ctx.lineWidth = 2; rr(ctx, cx, cy, cardW, cardH, 14); ctx.stroke();
    ctx.textAlign = "left"; ctx.fillStyle = "#c8161e"; ctx.font = font(portrait ? 24 : 21);
    ctx.fillText(x.name.slice(0, 6), cx + 16, cy + 32);
    ctx.fillStyle = "#b98f68"; ctx.font = `600 ${portrait ? 12 : 11}px -apple-system`;
    ctx.fillText(x.code, cx + 16 + (portrait ? 118 : 104), cy + 30);
    ctx.fillStyle = "#9a9a92"; ctx.font = `500 ${portrait ? 14 : 13}px "PingFang SC"`;
    const htxt = `历史价 ¥${fmt(x.hist)}`;
    ctx.fillText(htxt, cx + 16, cy + (portrait ? 58 : 74));
    ctx.strokeStyle = "#c96a5a"; ctx.lineWidth = 1.5;
    const tw = ctx.measureText(htxt).width;
    ctx.beginPath(); ctx.moveTo(cx + 16, cy + (portrait ? 58 : 74) - 5); ctx.lineTo(cx + 16 + tw, cy + (portrait ? 58 : 74) - 5); ctx.stroke();
    ctx.fillStyle = "#6b5b4a"; ctx.font = `500 ${portrait ? 13 : 12}px "PingFang SC"`;
    ctx.fillText("现价", cx + 16, cy + (portrait ? 80 : 96));
    ctx.fillStyle = "#e2161f"; ctx.font = font(portrait ? 35 : 30);
    ctx.fillText(`¥${fmt(x.price)}`, cx + 16, cy + (portrait ? 118 : 130));
    ctx.fillStyle = x.chgPct >= 0 ? "#d3222c" : "#14945f"; ctx.font = `800 ${portrait ? 14 : 13}px -apple-system`;
    ctx.fillText(`${sign(x.chgPct)}%`, cx + 16, cy + (portrait ? 142 : 152));
    const lw = portrait ? 76 : 84;
    const lx = cx + cardW - lw - 14, ly = cy + 14;
    ctx.fillStyle = "#fff"; rr(ctx, lx - 4, ly - 4, lw + 8, lw + 8, 10); ctx.fill();
    ctx.strokeStyle = "#f0e2c8"; rr(ctx, lx - 4, ly - 4, lw + 8, lw + 8, 10); ctx.stroke();
    if (logos[i]) ctx.drawImage(logos[i], lx, ly, lw, lw);
    else { ctx.fillStyle = "#d9a441"; ctx.font = font(lw * 0.5); ctx.textAlign = "center"; ctx.fillText(x.name[0], lx + lw / 2, ly + lw * 0.68); ctx.textAlign = "left"; }
    const bx = portrait ? cx + cardW - 108 : cx + cardW - 96, by = cy - 6;
    ctx.save(); ctx.translate(bx + 33, by + 33); ctx.rotate(0.16);
    ctx.fillStyle = "#ffd23e"; ctx.beginPath(); ctx.arc(0, 0, 33, 0, 7); ctx.fill();
    ctx.fillStyle = "#f5b71e";
    for (let a = 0; a < 12; a++) { const an = a * Math.PI / 6; ctx.beginPath(); ctx.arc(Math.cos(an) * 30, Math.sin(an) * 30, 5, 0, 7); ctx.fill(); }
    ctx.fillStyle = "#ffe27a"; ctx.beginPath(); ctx.arc(0, 0, 27, 0, 7); ctx.fill();
    ctx.fillStyle = "#a11113"; ctx.font = font(15); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("约" + fmt(x.price / x.hist * 10, 1) + "折", 0, 1);
    ctx.restore();
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  });

  const qr = await loadImg(QR_API(location.href), true);
  const footY = portrait ? startY + rows * (cardH + gapY) + 24 : H - 26;
  ctx.fillStyle = "rgba(255,224,160,.95)"; ctx.font = `500 ${portrait ? 15 : 14}px "PingFang SC"`;
  ctx.textAlign = "left";
  const up = shNow();
  const footLines = [
    `价格截至 ${up.hms} · 单位：元/股 · 折扣 = 现价 ÷ 历史价 × 10`,
    `历史价取海报基准或区间最高（口径详见项目说明）`,
    `价格回落不代表估值便宜 · 不构成投资建议`,
  ];
  footLines.forEach((t, i) => ctx.fillText(t, startX, footY + i * (portrait ? 24 : 20)));
  if (qr) {
    const qs = portrait ? 132 : 110;
    const qx = W - qs - 44, qy = H - qs - (portrait ? 42 : 34);
    ctx.fillStyle = "#fff"; rr(ctx, qx - 8, qy - 8, qs + 16, qs + 16, 10); ctx.fill();
    ctx.drawImage(qr, qx, qy, qs, qs);
    ctx.fillStyle = "#ffe27a"; ctx.font = `500 ${portrait ? 14 : 13}px "PingFang SC"`; ctx.textAlign = "center";
    ctx.fillText("扫码打开实时看板", qx + qs / 2, qy + qs + (portrait ? 24 : 22));
  } else {
    ctx.fillStyle = "#ffe27a"; ctx.font = `500 13px "PingFang SC"`;
    ctx.fillText("二维码生成失败，请复制链接分享", W - 300, H - 40);
  }
  return true;
}

/* ================= 刷新主循环（按页面取数） ================= */
function setBanner(msg) {
  const b = $("#errBanner");
  if (!msg) { b.style.display = "none"; return; }
  b.style.display = "block"; b.textContent = msg;
}
async function loadCore(showToast) {
  if (PAGE === "kline") return;
  let wl = null;
  try {
    wl = await api.stockList();
    cache.putWL(wl);
  } catch (e) {
    const cachedWL = cache.getWL();
    if (cachedWL && cachedWL.length) { wl = cachedWL; cache.staleHit = true; }
    else throw e;
  }
  state.watchlist = wl;
  await ensureBars(getSel(), !showToast);
  if (PAGE === "text") await Promise.allSettled(STOCKS.map((s) => fetchKline(s.market, s.code, "DAILY")));
  rebuildRows();
}
async function refresh() {
  if (state.mode === "demo") return;
  cache.staleHit = false;
  try {
    if (PAGE === "kline") {
      const mkt = state.klineMarket, code = state.modal;
      if (code && mkt) {
        await fetchKline(mkt, code, "DAILY");
        if (state.modalType === "INTRADAY") await fetchKline(mkt, code, "INTRADAY");
        updateKlineMeta();
      }
    } else {
      await loadCore(false);
    }
    state.errStreak = 0;
    if ($("#dot")) $("#dot").className = "dot ok";
    setBanner(cache.staleHit ? "⚠ 部分数据来自本地缓存（实时接口暂时不可用），将持续自动重试" : "");
    if ($("#lastUp")) $("#lastUp").textContent = shNow().hms;
  } catch (e) {
    state.errStreak++;
    if ($("#dot")) $("#dot").className = "dot err";
    setBanner(`数据刷新失败：${e.message}${state.errStreak >= 2 ? " —— 若持续失败，可能是 token 过期：点右上角 ⚙️ 更新，或重启 server.js 时设置 YJNT_TOKEN。" : ""}`);
    return;
  }
  renderPageView();
  renderChart();
  if (state.modal && state.modalType === "INTRADAY" && PAGE !== "kline") {
    const meta = getSel().find((x) => x.code === state.modal) || {};
    const mkt = meta.market || state.selStock.m || "17";
    fetchKline(mkt, state.modal, "INTRADAY")
      .then(() => { if (state.modalType === "INTRADAY") renderChart(); }).catch(() => {});
  }
}
function renderPageView() {
  if (PAGE === "board") renderBoard();
  else if (PAGE === "cards") renderCards();
  else if (PAGE === "text") renderText();
}
function tick() {
  const up = shNow();
  const clock = $("#clock");
  if (clock) clock.textContent = up.hms;
  const session = $("#session");
  if (!session) { if (Date.now() >= state.nextAt) { state.nextAt = Date.now() + nextDelay(); refresh(); } setTimeout(tick, 1000); return; }
  if (state.mode === "demo") { session.textContent = "演示"; const c = $("#countdown"); if (c) c.textContent = "—"; return; }
  session.textContent = up.inSession ? "盘中" : "休市";
  const c = $("#countdown");
  if (c) c.textContent = Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000));
  if (Date.now() >= state.nextAt) {
    state.nextAt = Date.now() + nextDelay();
    try { refresh(); } catch (e) { console.warn("refresh 异常", e); }
  }
  setTimeout(tick, 1000);
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ================= 独立K线页 ================= */
async function initKlinePage() {
  const q = pageParams();
  const code = q.s;
  state.klineMarket = q.m || "17";
  state.modal = code || null;
  state.modalType = q.t === "INTRADAY" ? "INTRADAY" : "DAILY";
  state.zoom = 90; state.cross = null; state.viewOffset = 0;
  $$(".tab[data-t]").forEach((x) => x.classList.toggle("on", x.dataset.t === state.modalType));
  if (!code || !/^\d{6}$/.test(code)) {
    $("#mName").textContent = "缺少代码参数";
    $("#mCode").textContent = "用法：kline.html?s=300308&m=33&t=DAILY";
    renderChart();
    return;
  }
  const mLogo = $("#mLogo");
  mLogo.style.visibility = "visible"; mLogo.dataset.step = "1";
  mLogo.onerror = function () {
    if (this.dataset.step === "2") this.style.visibility = "hidden";
    else { this.dataset.step = "2"; this.src = LOGO_REMOTE(code); }
  };
  mLogo.src = logoUrl(code);
  $("#mCode").textContent = `${code} · ${state.klineMarket === "17" ? "沪" : "深"}市`;
  document.title = `${code} K线详情 · K线看板`;
  // 名称尽力解析（非阻塞）：看板选股 → 全市场字典
  let name = (getSel().find((x) => x.code === code) || {}).name || null;
  if (name) { $("#mName").textContent = name; document.title = `${name} ${code} K线详情 · K线看板`; }
  else searchMarket(code).then((res) => {
    const n = res ? (res.find((x) => x.code === code) || {}).name : null;
    if (n && state.modal === code) {
      $("#mName").textContent = n;
      document.title = `${n} ${code} K线详情 · K线看板`;
    }
  }).catch(() => {});
  try { await fetchKline(state.klineMarket, code, "DAILY"); } catch (e) { toast("K线加载失败：" + e.message); }
  if (state.modalType === "INTRADAY") { try { await fetchKline(state.klineMarket, code, "INTRADAY"); } catch (e) {} }
  updateKlineMeta();
  renderChart();
}
/* 独立页左侧面板 + 顶部大字报价 */
function updateKlineMeta() {
  const code = state.modal, bars = state.daily[code];
  const st = statFromBars(bars);
  const kPrice = $("#kPrice");
  if (!st || !kPrice) return;
  kPrice.textContent = fmt(st.price);
  kPrice.className = "price " + cls(st.chg);
  const kChg = $("#kChg");
  kChg.textContent = `${sign(st.chg)}  ${sign(st.chgPct)}%`;
  kChg.className = "kchg " + cls(st.chg);
  const custom = (store.get(LS.custom, {})[code]) || {};
  const hist = custom.hist || DEFAULT_HIST(code) || intervalHigh(bars) || st.price;
  let hi = null, hiDate = "", lo = null, loDate = "";
  for (const b of bars) {
    if (b[2] != null && (hi == null || b[2] > hi)) { hi = b[2]; hiDate = String(b[0]); }
    if (b[3] != null && (lo == null || b[3] < lo)) { lo = b[3]; loDate = String(b[0]); }
  }
  const fd = (s) => (s.length >= 8 ? s.slice(4, 6) + "-" + s.slice(6, 8) : s);
  const last = bars[bars.length - 1];
  const krows = [
    ["今开", fmt(st.open)], ["昨收", fmt(st.prevClose)],
    ["最高", fmt(st.high)], ["最低", fmt(st.low)],
    ["成交量", fmt(volWanShou(last), 2) + " 万手"], ["成交额", fmt(last[6] / 1e8, 2) + " 亿"],
    ["振幅", fmt((st.high - st.low) / st.prevClose * 100, 2) + "%"],
    ["区间最高", `${fmt(hi)}（${fd(hiDate)}）`],
    ["区间最低", `${fmt(lo)}（${fd(loDate)}）`],
    ["较区间最高", sign((st.price / hi - 1) * 100) + "%"],
    ["历史价/折扣", `${fmt(hist)} · ${fmt(st.price / hist * 10, 2)} 折`],
  ];
  $("#kPanel").innerHTML = krows.map(([k, v]) => `<div class="krow"><span>${k}</span><b>${v}</b></div>`).join("");
}

/* ================= 启动 ================= */
(async function boot() {
  try {
  injectChrome();
  window.__bootStep = "cache";
  // 启动即用水久缓存：页面来回切换零等待（随后实时刷新覆盖）
  const cachedWL = cache.getWL();
  if (cachedWL && cachedWL.length) { state.watchlist = cachedWL; rebuildRows(); }
  for (const s of getSel()) {
    const b = cache.getDaily(s.code);
    if (b) state.daily[s.code] = b;
  }
  if (PAGE !== "kline") renderPageView();
  window.__bootStep = "chrome";
  state.modeInfo = await detectMode();
  window.__bootStep = "mode";
  state.mode = state.modeInfo.mode;
  const modeBadge = $("#modeBadge");
  if (modeBadge) modeBadge.textContent = { proxy: "实时 · 代理", direct: "实时 · 直连", demo: "演示数据" }[state.mode];
  const hint = $("#textHint");
  if (hint) hint.textContent =
    state.mode === "proxy" ? "已连接本地代理：可搜索全市场 A 股" :
    state.mode === "direct" ? "直连模式：可搜索全市场（http 页面）" :
    "演示模式：仅内置快照数据";
  $$("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === PAGE));

  if (state.mode === "demo") {
    // 单文件打包（scripts/build-single.js）会把快照内嵌为 window.__DEMO_DATA__
    try {
      state.demo = window.__DEMO_DATA__ || await (await fetch("assets/demo-data.json")).json();
    } catch (e) {
      state.demo = { poster: [], watchlist: [] };
    }
    state.watchlist = state.demo.watchlist;
    await ensureBars(getSel(), true);
    if (PAGE === "text") await Promise.allSettled(STOCKS.map((s) => fetchKline(s.market, s.code, "DAILY")));
    rebuildRows();
    if ($("#lastUp")) $("#lastUp").textContent = "快照";
    setBanner("当前为内置演示快照数据（非实时）。点右上角 ⚙️ 填入 token，或运行 node server.js 解锁实时行情与全市场搜索。");
  } else {
    // 看门狗：单个上游请求挂起也不能阻塞整页启动（15 秒后强制进入轮询节奏，由 refresh 重试）
    await Promise.race([
      loadCore(true).catch((e) => {
        setBanner(`数据加载失败：${e.message} —— 若持续失败，可能是 token 过期：点右上角 ⚙️ 更新。`);
        if ($("#dot")) $("#dot").className = "dot err";
      }),
      new Promise((r) => setTimeout(r, 15000)),
    ]);
  }

  const q = pageParams();
  window.__bootStep = "view";
  if (PAGE === "kline") {
    await initKlinePage();
  } else {
    renderPageView();
    if (q.s) {
      state.selStock = { s: q.s, m: q.m };
      openModal(q.s);
    }
  }
  window.__bootStep = "done";
  state.nextAt = Date.now() + nextDelay();
  tick();
  } catch (e) {
    window.__bootStep = "boot抛错: " + (e && e.stack ? e.stack.slice(0, 300) : e);
    console.error(e);
  }
})();
