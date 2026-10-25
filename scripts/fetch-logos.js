#!/usr/bin/env node
/**
 * 预下载公司 Logo 到本地（web/assets/logos/{code}.svg）
 * 用法：node scripts/fetch-logos.js 300308 601288 ...   （无参数 = 下载 watchlist.list 中全部）
 * 运行时解析顺序：本地 assets/logos/{code}.svg → 远程公开 CDN → 字符头像
 */
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'web', 'assets', 'logos');
const remote = (code) => `https://baidu-finance.cdn.bcebos.com/imgs/logo/stocks/stock_ab_${code}.svg`;

async function grab(code) {
  try {
    const r = await fetch(remote(code));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(path.join(OUT, `${code}.svg`), buf);
    console.log('✓', code);
    return true;
  } catch (e) { console.log('✗', code, e.message); return false; }
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let codes = process.argv.slice(2);
  if (!codes.length) {
    const listPath = path.join(__dirname, 'watchlist.list');
    if (fs.existsSync(listPath)) codes = fs.readFileSync(listPath, 'utf8').split(/\s+/).filter(Boolean);
  }
  if (!codes.length) { console.log('未提供代码且无 scripts/watchlist.list'); process.exit(1); }
  let ok = 0;
  for (const c of codes) { if (await grab(c)) ok++; await new Promise((r) => setTimeout(r, 150)); }
  console.log(`完成 ${ok}/${codes.length}`);
})();
