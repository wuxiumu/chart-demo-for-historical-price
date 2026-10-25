#!/usr/bin/env node
/**
 * 打包为单文件纯 HTML：dist/kline-board.html
 * 内嵌全部 CSS/JS/演示数据，双击即可在本地浏览器打开预览（演示模式，无需服务）。
 * 用法：node scripts/build-single.js
 */
const fs = require('fs');
const path = require('path');
const web = path.join(__dirname, '..', 'web');
const read = (p) => fs.readFileSync(path.join(web, p), 'utf8');

let html = read('index.html');
const css = read('style.css');
const charts = read('js/charts.js');
const app = read('app.js');
const demo = fs.readFileSync(path.join(web, 'assets', 'demo-data.json'), 'utf8');
if (demo.includes('</script>')) throw new Error('演示数据含 </script>，无法内联');

html = html.split('<link rel="stylesheet" href="style.css" />')
  .join('<style>\n' + css + '\n</style>');
html = html.split('<script src="js/charts.js"></script>')
  .join('<script>\n' + charts + '\n</script>');
html = html.split('<script src="app.js"></script>')
  .join('<script>window.__DEMO_DATA__ = ' + demo + ';</script>\n<script>\n' + app + '\n</script>');

const out = path.join(__dirname, '..', 'dist', 'kline-board.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('已生成 ' + out + '（' + Math.round(html.length / 1024) + ' KB）');
