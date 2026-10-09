/**
 * 页面截图与探针工具（本地开发用）
 * 用法: node tools/shot.mjs --url <url> --out <前缀> [--hash "#/index"] [--w 1600] [--h 1000]
 *        [--scroll 0,900] [--port 9333] [--eval "<js>"] [--probe]
 * 依赖已由 --remote-debugging-port 启动的 Chromium 系浏览器。
 */
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? (argv[i + 1] ?? true) : d;
};
const has = (k) => argv.includes(`--${k}`);

const PORT = arg('port', '9333');
const BASE = `http://127.0.0.1:${PORT}`;
const URL_ = arg('url', 'http://localhost:4173/');
const HASH = arg('hash', '');
const OUT = arg('out', 'shot');
const W = Number(arg('w', 1600));
const H = Number(arg('h', 1000));
const SCROLLS = String(arg('scroll', '0')).split(',').map(Number);
const DO_PROBE = has('probe');
const EVAL = arg('eval', null);
const FULL = has('full');
const MOBILE = has('mobile');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  let ver = null;
  for (let i = 0; i < 60; i++) {
    try {
      ver = await (await fetch(`${BASE}/json/version`)).json();
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!ver) throw new Error('CDP 不可用：请先用 --remote-debugging-port 启动浏览器');
  const list = await (await fetch(`${BASE}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用的 page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('WebSocket 连接失败'));
  });
  let id = 0;
  const waiting = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) {
      const { resolve, reject } = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    } else if (m.method) {
      events.push(m);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      waiting.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ws, send, events };
}

async function main() {
  const { ws, send, events } = await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Console.enable').catch(() => {});

  await send('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: 1,
    mobile: MOBILE,
  });

  const target = HASH ? `${URL_.replace(/#.*$/, '')}${HASH}` : URL_;
  await send('Page.navigate', { url: target });
  await sleep(1200);

  // 等待应用渲染出内容（bootstrap 为异步请求）
  for (let i = 0; i < 40; i++) {
    const r = await send('Runtime.evaluate', {
      expression: `document.querySelector('#main')?.innerText?.trim().length || 0`,
      returnByValue: true,
    });
    if ((r.result.value || 0) > 60) break;
    await sleep(250);
  }
  await sleep(700);

  const errors = events
    .filter((e) => e.method === 'Log.entryAdded' && ['error', 'warning'].includes(e.params.entry.level))
    .map((e) => `[${e.params.entry.level}] ${e.params.entry.text}`);
  const exceptions = events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);

  if (EVAL) {
    const r = await send('Runtime.evaluate', {
      expression: EVAL,
      returnByValue: true,
      awaitPromise: true,
    });
    console.log('EVAL:', JSON.stringify(r.result?.value ?? r.exceptionDetails, null, 1));
    await sleep(400);
  }

  for (const y of SCROLLS) {
    await send('Runtime.evaluate', { expression: `window.scrollTo(0, ${y})` });
    await sleep(900);
  }

  const probe = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `JSON.stringify((() => {
      const q = s => document.querySelector(s);
      const qa = s => [...document.querySelectorAll(s)];
      const box = el => { if(!el) return null; const r = el.getBoundingClientRect();
        return {t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)}; };
      const imgs = qa('#main img');
      return {
        title: document.title,
        hash: location.hash,
        mainText: (q('#main')?.innerText || '').length,
        scrollHeight: document.documentElement.scrollHeight,
        scrollY: Math.round(window.scrollY),
        cards: qa('.card').length,
        canvases: qa('canvas[data-motif]').length,
        imgs: imgs.length,
        imgsBroken: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
        h1: q('h1')?.innerText?.slice(0,60),
        heroTitle: box(q('.hero__title')),
        firstCard: box(q('.card')),
        gridCols: q('.grid') ? getComputedStyle(q('.grid')).gridTemplateColumns.split(' ').length : 0,
        fontBody: getComputedStyle(document.body).fontFamily.slice(0,60),
        navCurrent: qa('.nav a[aria-current="page"]').map(a=>a.textContent),
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    })())`,
  });
  console.log('PROBE:', probe.result.value);

  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: FULL ? true : undefined,
  });
  const file = `${OUT}.png`;
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('WROTE', file, `${W}x${H}`);

  if (errors.length) console.log('CONSOLE:', errors.slice(0, 12).join('\n  '));
  if (exceptions.length) console.log('EXCEPTIONS:', exceptions.slice(0, 6).join('\n  '));
  if (!errors.length && !exceptions.length) console.log('CONSOLE: clean');

  ws.close();
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
