/**
 * K线看板 · 本地服务（可选）
 * 作用：1) 托管 web/ 静态文件；2) 反代数据源并注入 token（token 不进前端源码，适合本地开发）；
 *      3) 反代全市场股票搜索（上游仅 HTTP，浏览器 https 页面无法直连，必须经代理）。
 *
 * 启动：node server.js    （可选环境变量 PORT=9000 YJNT_TOKEN=xxxx）
 * 不启动本服务时，前端会尝试「直连模式」（在页面设置里填自己的 token，存 localStorage），
 * 两者都不可用则自动进入「演示模式」（内置快照数据）。GitHub Pages 等纯静态部署即后两种模式。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8787;
const UPSTREAM = 'https://live.yjnt111.top';
const SEARCH_UPSTREAM = 'http://121.43.127.134:8066'; // dapanv3 行情字典服务（免鉴权，仅 HTTP）
const TOKEN = process.env.YJNT_TOKEN || '';

const PUBLIC_DIR = path.join(__dirname, 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const cache = new Map(); // key -> {t, body}
const cached = (k, ttl) => {
  const h = cache.get(k);
  return h && Date.now() - h.t < ttl ? h.body : null;
};
const store = (k, body) => cache.set(k, { t: Date.now(), body });

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

async function proxyJSON(res, url, options, cacheKey, ttl) {
  try {
    if (cacheKey) {
      const hit = cached(cacheKey, ttl);
      if (hit) return send(res, 200, hit);
    }
    const r = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...(options && options.headers) },
    });
    const text = await r.text();
    if (r.status !== 200) {
      return send(res, r.status, JSON.stringify({ code: r.status, msg: `上游 ${r.status}${r.status === 401 ? '（token 失效？请检查 YJNT_TOKEN 或页面设置）' : ''}` }));
    }
    if (cacheKey) store(cacheKey, text);
    send(res, 200, text);
  } catch (e) {
    send(res, 502, JSON.stringify({ code: 502, msg: '代理请求失败: ' + e.message }));
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === '/api/health') return send(res, 200, JSON.stringify({ code: 200, msg: 'ok', hasToken: !!TOKEN, ts: Date.now() }));

  if (p === '/api/stock-list')
    return proxyJSON(res, `${UPSTREAM}/api/live/stock/market/live`, { method: 'GET' }, 'stock-list', 5000);

  if (p === '/api/kline') {
    const market = url.searchParams.get('market') || '17';
    const code = url.searchParams.get('code') || '';
    const klineType = url.searchParams.get('type') || 'DAILY';
    const adj = url.searchParams.get('adj') !== '0';
    if (!/^\d{6}$/.test(code)) return send(res, 400, JSON.stringify({ code: 400, msg: 'code 参数非法' }));
    const key = `kline:${market}:${code}:${klineType}:${adj}`;
    return proxyJSON(res, `${UPSTREAM}/api/live/kline/getKline`, {
      method: 'POST',
      body: JSON.stringify({ codeList: [{ market, codes: [code] }], klineType, forwardAdjusted: adj }),
    }, key, klineType === 'INTRADAY' ? 10000 : 20000);
  }

  if (p === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return send(res, 200, JSON.stringify({ code: 200, data: [] }));
    const qs = new URLSearchParams({ query: q, associate: '1', json: '1', isrealcode: '1' });
    return proxyJSON(res, `${SEARCH_UPSTREAM}/dapanv3/quota/stockDictSearch?${qs}`, { method: 'GET' }, `search:${q}`, 60000);
  }

  // 五档盘口 / 成交明细（dapanv3 免鉴权；响应无 code 字段，归一化为 code:200 供前端 getJSON 使用）
  if (p === '/api/quote5' || p === '/api/trace') {
    const market = url.searchParams.get('market') || '17';
    const code = url.searchParams.get('code') || '';
    if (!/^\d{6}$/.test(code)) return send(res, 400, JSON.stringify({ code: 400, msg: 'code 参数非法' }));
    const body = p === '/api/quote5'
      ? { code_list: [{ market, codes: [code] }], trade_class: 'intraday',
          data_fields: ['24', '25', '26', '27', '28', '29', '150', '151', '154', '155', '30', '31', '32', '33', '34', '35', '152', '153', '156', '157'] }
      : { code_list: [{ market, codes: [code] }], time_range: { type: 'end_count', count: 100, end_time: 0 } };
    const upstream = p === '/api/quote5'
      ? `${SEARCH_UPSTREAM}/dapanv3/quota/aQuoteMultiLastCalc`
      : `${SEARCH_UPSTREAM}/dapanv3/common-hq/quote/v1/single_trace`;
    try {
      const key = `${p}:${market}:${code}`;
      const hit = cached(key, 5000);
      if (hit) return send(res, 200, hit);
      const r = await fetch(upstream, { method: 'POST', body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
      const j = await r.json().catch(() => null);
      if (r.status !== 200 || !j || j.status_code !== 0)
        return send(res, 502, JSON.stringify({ code: 502, msg: '盘口上游异常 ' + ((j && j.status_msg) || r.status) }));
      const out = JSON.stringify({ code: 200, msg: 'ok', data: j.data });
      store(key, out);
      send(res, 200, out);
    } catch (e) {
      send(res, 502, JSON.stringify({ code: 502, msg: '代理请求失败: ' + e.message }));
    }
    return;
  }

  // 静态文件
  const filePath = path.normalize(path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(filePath)] || 'application/octet-stream');
  });
});

server.listen(PORT, () => {
  console.log(`K线看板已启动: http://localhost:${PORT}${TOKEN ? '' : '（未设置 YJNT_TOKEN，代理将依赖前端 token / 演示模式）'}`);
});
