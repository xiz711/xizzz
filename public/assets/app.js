/**
 * 形式风格图谱 · 前端应用
 * 无框架单页应用：hash 路由 + 实时检索 + 标签反查 + 易混对照 + 内容扩充
 */
import { motif, motifVariant } from './motif.js';

/* ============================== 状态 ============================== */

const state = {
  styles: [],
  taxonomy: [],
  query: '',
  groups: new Set(),
  eras: new Set(),
  tags: new Set(),
  sort: 'curated',
  view: 'all',
  editingId: null,
  draftImage: null,
  compare: [null, null],
  folder: 0,
  // 标签词表（data/tags.json）：custom 是手工新增的，hidden 是被移除的
  tagVocab: { custom: [], hidden: [] },
};

const store = {
  get favorites() {
    try { return new Set(JSON.parse(localStorage.getItem('atlas.fav') || '[]')); } catch { return new Set(); }
  },
  toggleFav(id) {
    const f = this.favorites;
    f.has(id) ? f.delete(id) : f.add(id);
    localStorage.setItem('atlas.fav', JSON.stringify([...f]));
    return f.has(id);
  },
};

/* ============================== 工具 ============================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');

const groupMeta = (key) => state.taxonomy.find((g) => g.key === key) || { key, nameZh: key, nameEn: '', desc: '' };

/** 中文词条无需空格分词：按子串命中即可，同时支持多关键词“与”逻辑 */
function matchScore(style, query) {
  const q = norm(query);
  if (!q) return 0;
  const parts = String(query).trim().split(/\s+/).map(norm).filter(Boolean);
  const hay = norm([
    style.nameZh, style.nameEn, ...arr(style.aka),
    style.summary, style.origin,
    ...arr(style.features), ...arr(style.identify),
    ...arr(style.tags), ...arr(style.figures),
    ...arr(style.works).flatMap((w) => [w.title, w.author, w.domain, w.note]),
    ...arr(style.confusions).flatMap((c) => [c.with, c.distinction]),
    style.critique, style.era, style.region, groupMeta(style.group).nameZh,
  ].join(' · '));
  if (!parts.every((p) => hay.includes(p))) return 0;
  let score = 0;
  if (norm(style.nameZh).includes(q)) score += 120;
  if (norm(style.nameEn).includes(q)) score += 100;
  if (norm(style.tags).includes(q)) score += 60;
  if (norm(style.summary).includes(q)) score += 25;
  return score + 10;
}

function filtered() {
  let list = state.styles.slice();
  if (state.view === 'fav') {
    const f = store.favorites;
    list = list.filter((s) => f.has(s.id));
  }
  if (state.groups.size) list = list.filter((s) => state.groups.has(s.group));
  if (state.eras.size) list = list.filter((s) => state.eras.has(eraBucket(s)));
  for (const t of state.tags) list = list.filter((s) => arr(s.tags).includes(t));
  if (state.query.trim()) {
    list = list.map((s) => ({ s, k: matchScore(s, state.query) })).filter((x) => x.k > 0)
      .sort((a, b) => b.k - a.k).map((x) => x.s);
    return list;
  }
  return sortList(list);
}

function sortList(list) {
  const s = state.sort;
  const copy = list.slice();
  if (s === 'az') copy.sort((a, b) => a.nameZh.localeCompare(b.nameZh, 'zh'));
  else if (s === 'recent') copy.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  else copy.sort((a, b) => (sortKey(a) - sortKey(b)));
  return copy;
}

/** 年代桶：用于「按年代」筛选，比逐年份更好用 */
function eraBucket(s) {
  const m = String(s.era || '').match(/(1[89]\d{2}|20\d{2})/g);
  if (!m) return '跨期';
  const y = Math.min(...m.map(Number));
  if (y < 1900) return '1900 前';
  if (y < 1945) return '1900–1945';
  if (y < 1970) return '1945–1970';
  if (y < 1990) return '1970–1990';
  if (y < 2010) return '1990–2010';
  return '2010 以后';
}

const ERA_ORDER = ['1900 前', '1900–1945', '1945–1970', '1970–1990', '1990–2010', '2010 以后', '跨期'];

function sortKey(s) {
  const order = state.taxonomy.map((g) => g.key);
  const gi = order.indexOf(s.group);
  return (gi < 0 ? 99 : gi) * 1000 + (Number(s.order) || 500);
}

/** 标签频次，用于标签云。带计数排序 */
function tagCounts() {
  const map = new Map();
  for (const s of state.styles) for (const t of arr(s.tags)) map.set(t, (map.get(t) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
}

/**
 * 「可用标签」= 条目里实际用到的标签 ∪ 手工新增的标签，再减去被移除的。
 *
 * 条目上的标签是自由填写的，词表只影响**筛选面板里出现哪些标签**：
 * 移除一个标签不会去改任何条目，随时可以再加回来。
 */
function availableTags() {
  const hidden = new Set(state.tagVocab.hidden);
  const counts = new Map(tagCounts());
  const out = new Map();
  for (const t of state.tagVocab.custom) {
    if (!hidden.has(t)) out.set(t, counts.get(t) || 0);
  }
  for (const [t, n] of counts) {
    if (!hidden.has(t)) out.set(t, out.get(t) || n);
  }
  return [...out.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
}

async function saveTagVocab(next) {
  const res = await fetch('/api/tags', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(next),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '标签词表保存失败');
  state.tagVocab = data.tags;
}

/** 新增一个可用标签 */
async function addTag(name) {
  const t = String(name || '').trim();
  if (!t) return;
  const all = availableTags().map(([x]) => x);
  if (all.includes(t)) { toast(`「${t}」已经在列表里了`); return; }
  try {
    await saveTagVocab({
      custom: [...state.tagVocab.custom, t],
      hidden: state.tagVocab.hidden.filter((x) => x !== t),
    });
    render();
    toast(`已添加标签「${t}」`);
  } catch (err) {
    toast(err.message, true);
  }
}

/** 从可用列表里移除一个标签（不动任何条目） */
async function removeTag(t) {
  const custom = state.tagVocab.custom.filter((x) => x !== t);
  const hidden = state.tagVocab.hidden.includes(t) ? state.tagVocab.hidden : [...state.tagVocab.hidden, t];
  try {
    await saveTagVocab({ custom, hidden });
    state.tags.delete(t);
    render();
    toast(`已从列表移除「${t}」（条目上的标签未改动）`);
  } catch (err) {
    toast(err.message, true);
  }
}

function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('toast--err', isErr);
  el.classList.add('is-on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('is-on'), isErr ? 4200 : 2600);
}

/* ============================== 缩略图 ============================== */

const motifCache = new Map();

/**
 * 卡片与详情页的视觉占位策略：
 * 有授权实拍图就用图；没有则用 canvas 按该风格的形式规则生成母题。
 * 每张缩略图渲染两幅母题：默认母题与一个变体，悬停时切换，形成「图像动态变化」。
 */
function thumbHTML(style, opts = {}) {
  const cls = opts.className || 'thumb';
  const first = cls.split(' ')[0];
  if (style.image) {
    const src = esc(style.image.url);
    return `<div class="${cls}" data-parallax><div class="thumb__media">
      <img src="${src}" alt="${esc(style.nameZh)} 代表图像" loading="lazy" decoding="async"
        onerror="this.closest('.${first}').classList.add('thumb--blank');this.remove()"></div></div>`;
  }
  return `<div class="${cls} thumb--motif" data-parallax>
    <div class="thumb__media">
      <canvas data-motif="${esc(style.id)}" role="img" aria-label="${esc(style.nameZh)} 生成式母题示意图"></canvas>
      <canvas data-motif-variant="${esc(style.id)}" aria-hidden="true"></canvas>
    </div>
  </div>`;
}

function initials(style) {
  const en = String(style.nameEn || style.id || '');
  const words = en.split(/[\s/·]+/).filter((w) => /[A-Za-z0-9]/.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return String(style.nameZh || '？').slice(0, 2);
}

/** 绘制所有母题画布：默认母题 + 悬停变体 */
function paintMotifs(root = document) {
  for (const canvas of $$('canvas[data-motif]', root)) {
    paintOne(canvas, () => motif(canvas.dataset.motif));
  }
  for (const canvas of $$('canvas[data-motif-variant]', root)) {
    paintOne(canvas, () => motifVariant(canvas.dataset.motifVariant, 1));
  }
}

function paintOne(canvas, getSpec) {
  const key = canvas.dataset.motif || canvas.dataset.motifVariant;
  if (!motifCache.has(key)) {
    try { motifCache.set(key, getSpec()); } catch { motifCache.set(key, null); }
  }
  const spec = motifCache.get(key);
  if (!spec) return;

  // 关键：媒体层自身带视差 transform，不能按它的 rect 测量，否则宽高都会被缩放，
  // 绘制比例与显示比例不一致，canvas 会被拉伸。因此始终以外层（不含 transform）为准。
  const box = canvas.parentElement && canvas.parentElement.clientWidth
    ? canvas.parentElement
    : (canvas.offsetParent || canvas);
  let w = Math.round(box.clientWidth || 0);
  let h = Math.round(box.clientHeight || 0);
  // 外层用 inset 负值放大时，clientWidth 已包含该尺寸，无需再换算
  if (!w || !h) {
    const r = canvas.getBoundingClientRect();
    w = Math.round(r.width || 640);
    h = Math.round(r.height || 480);
  }
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, w < 320 ? 1.5 : 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawMotif(ctx, w, h, spec);
}

function drawMotif(ctx, w, h, spec) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = spec.bg;
  ctx.fillRect(0, 0, w, h);

  const rnd = mulberry(spec.seed);
  ctx.lineJoin = 'miter';

  const pick = () => spec.palette[Math.floor(rnd() * spec.palette.length)];

  switch (spec.kind) {
    case 'grid': {
      // 基本几何 + 原色平涂 + 显性骨架：对包豪斯一类语言的直接转译
      const m = Math.min(w, h) * 0.085;
      const iw = w - m * 2;
      const ih = h - m * 2;
      const bars = 2 + Math.floor(rnd() * 2);
      ctx.fillStyle = spec.palette[2] || spec.ink;
      ctx.fillRect(m + iw * 0.5, m, iw * 0.5, ih * (0.3 + rnd() * 0.24));
      ctx.fillStyle = pick();
      ctx.beginPath();
      ctx.arc(m + iw * (0.24 + rnd() * 0.16), m + ih * (0.28 + rnd() * 0.2), Math.min(iw, ih) * (0.16 + rnd() * 0.1), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pick();
      ctx.beginPath();
      ctx.moveTo(m, m + ih);
      ctx.lineTo(m + iw * (0.3 + rnd() * 0.2), m + ih);
      ctx.lineTo(m, m + ih * (0.5 + rnd() * 0.25));
      ctx.closePath();
      ctx.fill();
      for (let i = 0; i < bars; i++) {
        ctx.fillStyle = i === 0 ? spec.ink : spec.palette[i % spec.palette.length];
        ctx.fillRect(m, m + ih * (0.82 - i * 0.085), iw * (0.35 + rnd() * 0.6), Math.max(2, ih * 0.045));
      }
      ctx.strokeStyle = spec.ink;
      ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.008);
      ctx.strokeRect(m, m, iw, ih);
      break;
    }
    case 'bars': {
      const n = 2 + Math.floor(rnd() * 3);
      const m = h * 0.12;
      const gap = h * 0.05;
      const bh = (h - m * 2 - gap * (n - 1)) / n;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = i === 0 ? spec.ink : pick();
        const bw = w * (0.25 + rnd() * 0.62);
        ctx.fillRect(m, m + i * (bh + gap), bw, bh);
      }
      break;
    }
    case 'orbit': {
      ctx.strokeStyle = spec.ink;
      ctx.lineWidth = Math.max(1, w * 0.004);
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2, w * (0.14 + i * 0.1), h * (0.2 + i * 0.13), rnd() * Math.PI, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = pick();
      ctx.beginPath();
      ctx.arc(w * (0.3 + rnd() * 0.4), h * (0.3 + rnd() * 0.4), Math.min(w, h) * 0.12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'arcs': {
      const cx = w * (rnd() > 0.5 ? 0.28 : 0.72);
      ctx.fillStyle = pick();
      ctx.beginPath();
      ctx.arc(cx, h * 1.02, h * (0.55 + rnd() * 0.3), Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = spec.ink;
      ctx.globalAlpha = 0.82;
      ctx.beginPath();
      ctx.arc(w - cx, -h * 0.05, h * (0.16 + rnd() * 0.16), 0, Math.PI);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'scribble': {
      // 几何图形加自由手绘线的混排：孟菲斯式的玩闹与刻意失衡
      const m = Math.min(w, h);
      ctx.strokeStyle = spec.ink;
      ctx.lineWidth = Math.max(1.4, m * 0.008);
      ctx.beginPath();
      ctx.moveTo(w * 0.16, h * 0.34);
      ctx.lineTo(w * 0.44, h * 0.3);
      ctx.lineTo(w * 0.36, h * 0.56);
      ctx.closePath();
      ctx.fillStyle = pick();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = pick();
      ctx.beginPath();
      ctx.arc(w * (0.56 + rnd() * 0.14), h * (0.3 + rnd() * 0.16), m * (0.17 + rnd() * 0.07), 0, Math.PI * 2);
      ctx.fill();
      for (let d = 0; d < 5; d++) {
        ctx.fillStyle = d % 2 ? spec.ink : pick();
        ctx.beginPath();
        ctx.arc(w * (0.2 + rnd() * 0.66), h * (0.66 + rnd() * 0.22), m * 0.028, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = hexA(spec.ink, 0.85);
      ctx.lineWidth = Math.max(1.2, m * 0.011);
      ctx.beginPath();
      ctx.moveTo(w * 0.12, h * 0.8);
      for (let i = 0; i < 6; i++) {
        ctx.quadraticCurveTo(w * rnd(), h * (0.5 + rnd() * 0.45), w * (0.2 + rnd() * 0.68), h * (0.58 + rnd() * 0.34));
      }
      ctx.stroke();
      ctx.fillStyle = hexA(spec.palette[1] || spec.ink, 0.5);
      ctx.beginPath();
      ctx.arc(w * 0.78, h * 0.78, m * 0.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'glow': {
      // 深底 + 霓虹 + 透视地平线：对赛博朋克一类夜景视觉的转译
      const deep = spec.palette[2] || '#08060f';
      const g = ctx.createLinearGradient(0, 0, w * 0.6, h);
      g.addColorStop(0, spec.palette[0]);
      g.addColorStop(0.55, spec.palette[1] || spec.palette[0]);
      g.addColorStop(1, deep);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      const hor = h * 0.56;
      const vpx = w * (0.42 + rnd() * 0.16);
      ctx.strokeStyle = hexA(spec.accent, 0.55);
      ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.0035);
      for (let i = -7; i <= 7; i++) {
        ctx.beginPath();
        ctx.moveTo(vpx, hor);
        ctx.lineTo(vpx + i * w * 0.22, h);
        ctx.stroke();
      }
      for (let i = 1; i <= 8; i++) {
        const t = i / 9;
        const y = hor + (h - hor) * t * t;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      // 地平线上的光体与辉光
      const rg = ctx.createRadialGradient(vpx, hor, 0, vpx, hor, Math.max(w, h) * 0.5);
      rg.addColorStop(0, hexA(spec.accent, 0.9));
      rg.addColorStop(1, hexA(spec.accent, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = spec.accent;
      ctx.beginPath();
      ctx.arc(vpx, hor, Math.min(w, h) * 0.105, Math.PI, Math.PI * 2);
      ctx.fill();
      // 霓虹色带
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = hexA(spec.palette[0], 0.9 - i * 0.24);
        ctx.fillRect(0, h * (0.78 + i * 0.06), w, Math.max(2, h * 0.011));
      }
      break;
    }
    case 'blob': {
      ctx.strokeStyle = hexA(spec.ink, 0.55);
      ctx.lineWidth = Math.max(1.4, w * 0.008);
      for (let i = 0; i < 3; i++) {
        const cx = w * (0.2 + rnd() * 0.6);
        const cy = h * (0.2 + rnd() * 0.6);
        const r = Math.min(w, h) * (0.1 + rnd() * 0.14);
        ctx.beginPath();
        for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 12) {
          const rr = r * (0.78 + rnd() * 0.5);
          const px = cx + Math.cos(a) * rr;
          const py = cy + Math.sin(a) * rr * 0.94;
          a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = i === 0 ? pick() : hexA(pick(), 0.55);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'glass': {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, spec.palette[0]);
      g.addColorStop(1, spec.palette[1] || spec.palette[0]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const card = (x, y, cw, ch, alpha, blurColor) => {
        ctx.save();
        ctx.shadowColor = hexA(blurColor || '#ffffff', 0.5);
        ctx.shadowBlur = 24;
        ctx.fillStyle = hexA('#ffffff', alpha);
        roundRect(ctx, x, y, cw, ch, Math.min(cw, ch) * 0.16);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = hexA('#ffffff', 0.75);
        ctx.lineWidth = 1.4;
        roundRect(ctx, x, y, cw, ch, Math.min(cw, ch) * 0.16);
        ctx.stroke();
      };
      card(w * 0.1, h * 0.16, w * 0.44, h * 0.42, 0.3);
      card(w * 0.42, h * 0.42, w * 0.46, h * 0.42, 0.22, spec.accent);
      break;
    }
    case 'stack': {
      // 体量堆叠与结构外露：粗野主义与解构主义的共同线索
      const n = 4 + Math.floor(rnd() * 3);
      const bh = h * 0.11;
      for (let i = 0; i < n; i++) {
        const bw = w * (0.34 + rnd() * 0.46);
        const x = w * (0.1 + rnd() * (0.9 - bw / w));
        ctx.fillStyle = i === 0 ? spec.palette[0] : hexA(spec.palette[i % spec.palette.length] || spec.ink, 0.8);
        ctx.fillRect(x, h * 0.12 + i * (bh + h * 0.045), bw, bh);
      }
      ctx.strokeStyle = hexA(spec.ink, 0.5);
      ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.005);
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, h * (0.12 + i * 0.22));
        ctx.lineTo(w, h * (0.12 + i * 0.22));
        ctx.stroke();
      }
      break;
    }
    case 'lines': {
      // 显性网格与统一基线：瑞士国际主义式的信息秩序
      const n = 7 + Math.floor(rnd() * 4);
      ctx.strokeStyle = hexA(spec.ink, 0.5);
      ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.005);
      const m = w * 0.08;
      for (let i = 0; i < n; i++) {
        const y = h * (0.1 + (i / (n - 1)) * 0.8);
        ctx.beginPath();
        ctx.moveTo(m, y);
        ctx.lineTo(w * (0.5 + rnd() * 0.44), y);
        ctx.stroke();
      }
      ctx.fillStyle = spec.palette[1];
      ctx.fillRect(m, h * 0.12, w * (0.16 + rnd() * 0.14), h * 0.2);
      ctx.fillStyle = spec.palette[0];
      ctx.beginPath();
      ctx.arc(w * 0.76, h * 0.72, Math.min(w, h) * 0.12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'wash': {
      ctx.strokeStyle = hexA(spec.ink, 0.5);
      ctx.lineWidth = Math.max(2, w * 0.016);
      ctx.lineCap = 'round';
      ctx.beginPath();
      let x = w * 0.12;
      let y = h * 0.62;
      ctx.moveTo(x, y);
      for (let i = 0; i < 5; i++) {
        ctx.bezierCurveTo(
          w * rnd(), h * rnd(), w * rnd(), h * rnd(),
          (x = w * (0.2 + rnd() * 0.65)), (y = h * (0.18 + rnd() * 0.66))
        );
      }
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = hexA(spec.accent || pick(), 0.35);
      ctx.beginPath();
      ctx.arc(w * 0.3, h * 0.32, Math.min(w, h) * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      ctx.fillStyle = pick();
      ctx.fillRect(w * 0.12, h * 0.12, w * 0.4, h * 0.4);
      ctx.strokeStyle = spec.ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(w * 0.3, h * 0.3, w * 0.5, h * 0.5);
    }
  }

  // 细颗粒，避免大面积平色在大屏上显得廉价；小尺寸卡片上省略以省开销
  if (Math.min(w, h) >= 300) {
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = i % 2 ? '#000' : '#fff';
      ctx.fillRect(rnd() * w, rnd() * h, 1.2, 1.2);
    }
    ctx.globalAlpha = 1;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function mulberry(seed) {
  let a = typeof seed === 'string' ? hashStr(seed) : seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function hexA(hex, alpha) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/* ============================== 动态视觉层 ==============================
   目标：图片随滚动产生轻微视差与缩放，随指针轻微位移；悬停时图像切换。
   全部动画走 transform / opacity，由单一 rAF 循环批量写入，避免逐元素触发重排。
   ====================================================================== */

const motion = {
  reduce: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  parallax: [],     // [元素, 视差强度]
  cursor: [],       // [元素, 位移强度]
  pointer: { x: 0, y: 0 },
  smooth: { x: 0, y: 0 },
  dirty: true,
  running: false,
  boundsTimer: null,
};

/**
 * 媒体层比容器放大 BLEED（对应 CSS 里的 inset: -BLEED）。为保证视差位移后容器
 * 边缘仍被完全覆盖，内层缩放必须满足：(1 + 2·BLEED)·scale ≥ 1 + 2·|位移|/高度。
 * 位移上限取元素高度的 PAR_RATIO，缩放再留一点余量。
 */
const BLEED = 0.032;
const PAR_RATIO = 0.028; // 视差位移上限 = 元素高度 × 2.8%
const ZOOM_EDGE = 1.075; // 边缘：最小可用缩放
const ZOOM_MID = 1.115;  // 居中：轻微推近

/** 收集当前视图里的动效元素，并预计算相对文档的位置（不读布局，避免与 transform 互相干扰） */
function collectMotion() {
  cancelAnimationFrame(motion.boundsTimer);
  const scrollY = window.scrollY || 0;
  const vh = window.innerHeight || 800;

  motion.parallax = [...viewEl().querySelectorAll('[data-parallax]')].map((el) => {
    const r = el.getBoundingClientRect();
    const height = r.height || 1;
    return { el, offsets: [r.top + scrollY, r.top + height + scrollY], amp: height * PAR_RATIO };
  });

  const cursorEls = [...viewEl().querySelectorAll('[data-card], [data-deck]')];
  motion.cursor = cursorEls.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      el,
      docX: r.left + r.width / 2,
      docY: r.top + scrollY + r.height / 2,
      w: r.width || 1,
      h: r.height || 1,
      amp: Math.min(13, r.width * 0.045),
    };
  });

  motion.dirty = true;
  requestMotion();
}

function tickMotion() {  if (motion.reduce) return;

  const scrollY = window.scrollY || 0;
  const vh = window.innerHeight || 800;

  // 视差 + 缩放：随元素穿过视口的位置连续变化
  for (const p of motion.parallax) {
    const [start, end] = p.offsets;
    if (end <= start) continue;
    const center = (start + end) / 2 - scrollY;
    // t：-1 刚进入视口下缘 → 0 居中 → 1 离开视口上缘
    const t = Math.max(-1, Math.min(1, (center - vh / 2) / (vh / 2 + (end - start) / 2)));
    p.el.style.setProperty('--par', `${(t * p.amp).toFixed(2)}px`);
    // 边缘取最小缩放（保证不露边），居中时轻微推近，让画面在停稳时有呼吸
    p.el.style.setProperty('--zoom', (ZOOM_MID - (ZOOM_MID - ZOOM_EDGE) * Math.abs(t)).toFixed(4));
  }

  // 指针位移：向指针方向轻微偏移，带阻尼
  motion.smooth.x += (motion.pointer.x - motion.smooth.x) * 0.08;
  motion.smooth.y += (motion.pointer.y - motion.smooth.y) * 0.08;
  const active = motion.pointer.active;
  for (const c of motion.cursor) {
    if (!active) { c.el.style.setProperty('--cx', '0px'); c.el.style.setProperty('--cy', '0px'); continue; }
    const dx = motion.smooth.x - c.docX;
    const dy = motion.smooth.y - (c.docY - scrollY);
    if (Math.abs(dx) > c.w || Math.abs(dy) > c.h) {
      c.el.style.setProperty('--cx', '0px');
      c.el.style.setProperty('--cy', '0px');
      continue;
    }
    c.el.style.setProperty('--cx', `${((dx / c.w) * c.amp).toFixed(2)}px`);
    c.el.style.setProperty('--cy', `${((dy / c.h) * c.amp).toFixed(2)}px`);
  }

  motion.dirty = false;
  motion.running = false;
}

function requestMotion() {
  if (motion.reduce) return;
  motion.dirty = true;
  if (motion.running) return;
  motion.running = true;
  requestAnimationFrame(tickMotion);
}

function onScroll() {
  // 只管卡片视差与指针位移的重新计算
  motion.dirty = true;
  requestMotion();
}

function onPointerMove(e) {
  motion.pointer.x = e.clientX;
  motion.pointer.y = e.clientY;
  motion.pointer.active = true;
  requestMotion();
}

/** 视口尺寸或字体载入后，几何信息会变，需要重新测量 */
function scheduleRecollect() {
  clearTimeout(motion.boundsTimer);
  motion.boundsTimer = setTimeout(() => {
    collectMotion();
    paintMotifs(viewEl());
    requestMotion();
  }, 160);
}

/* ---------- 文件夹堆叠：首页的主视觉 ---------- */

/** 每个类别就是一只文件夹；封面与案例位留空，供后续放入案例 */
function folderHTML(g, pos) {
  const n = state.styles.filter((s) => s.group === g.key).length;
  const isCur = pos === 'is-cur';
  return `
  <article class="folder ${pos}" id="folder-${esc(g.key)}" data-folder="${esc(g.key)}"
    data-folder-role="${isCur ? 'cur' : 'side'}" ${isCur ? 'tabindex="0"' : 'aria-hidden="true"'}
    aria-label="${esc(g.nameZh)} 文件夹，${n} 则条目">
    <span class="folder__tab" aria-hidden="true"></span>
    ${isCur
      ? `<button class="folder__del" type="button" data-folder-del="${esc(g.key)}"
           aria-label="删除文件夹「${esc(g.nameZh)}」" title="删除这个文件夹">
           <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none"
             stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
             <path d="M6 6l12 12M18 6L6 18"/>
           </svg>
         </button>`
      : ''}
    <div class="folder__body">
      <div class="folder__sheet">
        ${g.cover
          ? `<img src="${esc(g.cover)}" alt="${esc(g.nameZh)} 封面" loading="lazy" decoding="async">`
          : ''}
      </div>
      <footer class="folder__foot">
        <div class="folder__names">
          ${isCur
            ? `<input class="folder__zh folder__zh--edit" type="text" data-folder-rename="${esc(g.key)}"
                 value="${esc(g.nameZh)}" aria-label="重命名文件夹（回车保存，Esc 放弃）"
                 title="点一下改名" spellcheck="false">`
            : `<h3 class="folder__zh">${esc(g.nameZh)}</h3>`}
          <!-- 名称下面不再显示英文：名称就是名称 -->
        </div>
        <p class="folder__count tnum">${String(n).padStart(2, '0')} 则条目${isCur ? ' · 双击进入 →' : ''}</p>
      </footer>
    </div>
    <!-- 新建入口：bindDeck 会把它搬进当前文件夹卡片，靠绝对定位挂在卡片**外侧**的右下角 -->
  </article>`;
}
function folderDeckHTML() {
  const groups = state.taxonomy;
  if (!groups.length) return '';
  const n = groups.length;
  const i = Math.min(Math.max(state.folder, 0), n - 1);
  const above = groups[i - 1];
  const below = groups[i + 1];
  return `
  <section class="deck" id="folderDeck" aria-label="风格类别文件夹">
    <div class="deck__stage" data-deck>
      ${above ? folderHTML(above, 'is-prev') : ''}
      ${folderHTML(groups[i], 'is-cur')}
      ${below ? folderHTML(below, 'is-next') : ''}
    </div>
    <!-- 新建入口先落在这里；bindDeck 会把它搬进「当前文件夹」那张卡片，
         好让它永远贴在卡片的右下角（横版竖版都一样） -->
    <button class="deck__new" type="button" data-folder-new>新建文件夹</button>
  </section>`;
}



/* ---------- 文件夹的新建 / 重命名 / 删除 ---------- */

/** 新建一个空文件夹，并把它设为当前。名称默认「新文件夹 N」，随后可直接重命名。 */
async function createFolder() {
  const used = new Set(state.taxonomy.map((g) => g.nameZh));
  let name = '新文件夹';
  let k = 2;
  while (used.has(name)) name = `新文件夹 ${k++}`;
  let key = slugKey(`folder-${Date.now().toString(36)}`);
  while (state.taxonomy.some((g) => g.key === key)) key = `${key}-x`;
  try {
    const next = [...state.taxonomy, { key, nameZh: name, nameEn: '', desc: '', source: 'user' }];
    await saveTaxonomy(next);
    state.folder = state.taxonomy.length - 1;
    softRefresh();
    toast(`已新建「${name}」，点名称可改名`);
  } catch (err) {
    toast(err.message, true);
  }
}

/** 就地重命名：输入框回车或失焦即写入 taxonomy.json */
async function renameFolder(key, value) {
  const name = String(value || '').trim();
  const g = state.taxonomy.find((x) => x.key === key);
  if (!g || !name || name === g.nameZh) return;
  try {
    await saveTaxonomy(state.taxonomy.map((x) => (x.key === key ? { ...x, nameZh: name } : x)));
    toast(`已改名为「${name}」`);
  } catch (err) {
    toast(err.message, true);
  }
}

/** 新建一个类别（总览页的「＋」）。空类别，条目为 0 */
async function addCategory(name) {
  if (state.taxonomy.some((g) => g.nameZh === name)) { toast(`「${name}」已经存在`); return; }
  let key = slugKey(name) || `cat-${Date.now().toString(36)}`;
  while (state.taxonomy.some((g) => g.key === key)) key = `${key}-x`;
  try {
    await saveTaxonomy([...state.taxonomy, { key, nameZh: name, nameEn: '', desc: '', source: 'user' }]);
    render();
    toast(`已添加类别「${name}」`);
  } catch (err) {
    toast(err.message, true);
  }
}

/** 未分类文件夹的 key：删掉类别时用它收容剩下的条目 */
const UNFILED_KEY = 'uncategorized';

/**
 * 删除一个文件夹。按用户选择：类别下的条目**不删**，而是整体移到「未分类」文件夹，
 * 因此这里要先确保「未分类」存在（没有就建一个），再把条目改过去。
 */
async function deleteFolder(key) {
  const g = state.taxonomy.find((x) => x.key === key);
  if (!g) return;
  const owned = state.styles.filter((s) => s.group === key);
  const tail = owned.length ? `，其中 ${owned.length} 则条目会移到「未分类」` : '';
  if (!window.confirm(`删除文件夹「${g.nameZh}」？${tail}。\n\n此操作不可撤销。`)) return;

  try {
    // 1) 先安置条目：需要「未分类」这个类别存在
    if (owned.length) {
      let filed = state.taxonomy.find((x) => x.key === UNFILED_KEY);
      if (!filed) {
        filed = { key: UNFILED_KEY, nameZh: '未分类', nameEn: 'Uncategorized', desc: '删掉类别后剩余条目暂存于此，可在这里重新归类。' };
        await saveTaxonomy([...state.taxonomy, filed]);
      }
      const res = await fetch('/api/styles', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state.styles.map((s) => (s.group === key ? { ...s, group: UNFILED_KEY } : s))),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '条目迁移失败');
      state.styles = data.styles || state.styles;
    }

    // 2) 再删掉这个类别
    await saveTaxonomy(state.taxonomy.filter((x) => x.key !== key));

    // 3) 当前指针落到合法范围内
    state.folder = Math.min(Math.max(state.folder, 0), Math.max(0, state.taxonomy.length - 1));
    render();
    toast(`已删除「${g.nameZh}」${owned.length ? `，${owned.length} 则条目已移到「未分类」` : ''}`);
  } catch (err) {
    toast(err.message, true);
  }
}

function folderStep(delta) {
  const n = state.taxonomy.length;
  if (!n) return false;
  const next = Math.min(Math.max(state.folder + delta, 0), n - 1);
  if (next === state.folder) return false;
  state.folder = next;
  softRefresh();
  return true;
}

function goFolder(index) {
  const n = state.taxonomy.length;
  if (!n) return;
  const next = Math.min(Math.max(Number(index), 0), n - 1);
  if (next === state.folder) return;
  state.folder = next;
  softRefresh();
}

/**
 * 切换前量一下旧「当前文件夹」的落位变换。
 * 它此刻可能被指针位移写进了 --cx/--cy（自定义属性会参与计算后的 transform），
 * 所以先把 matrix 拆开，动画结束后才能准确还原。
 */
function measureFolderExit(root) {
  const el = root && root.querySelector('.folder.is-cur');
  if (!el || !window.gsap) return null;
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  const scale = m.a || 1;
  return {
    el,
    x: m.e,
    y: m.f,
    scale,
    scaleX: m.a || 1,
    scaleY: m.d || 1,
    rotate: (Math.atan2(m.b, m.a) * 180) / Math.PI,
  };
}

/**
 * 文件夹切换的果冻动效。
 *
 * 关键约束：切换走的是整块重绘（`innerHTML` 换掉），旧卡片在替换那一刻就已经从
 * 文档里消失，**来不及播退场**。原来那版还想给旧卡片做 0.62s 的缩小，实际永远播不到，
 * 而且因为 `if (!out) return` 的早退，连新卡片的入场也被一起跳过了 —— 结果就是硬切。
 *
 * 现在改成：新卡片自己从「略小 + 半透明 + 略微下沉」长大到位（`back.out` 回弹），
 * 因为旧卡片是瞬间消失的，这个放大过程会被读成「接替」，整体是连贯的。
 * 缓动与时长集中在这里，要调手感只改这两个常量。
 */
const FOLDER_JELLY = { ease: 'back.out(1.7)', duration: 0.62, from: 0.86, riseY: 18 };

function playFolderIn(root, out) {
  if (motion.reduce) return;
  if (!window.gsap) return;
  const cur = root.querySelector('.folder.is-cur');
  if (!cur) return;
  // 旧卡片还在时会话里（例如首帧），先让它缩小淡出，再接新卡片的放大
  if (out && out.el && out.el.isConnected) {
    window.gsap.to(out.el, {
      scaleX: out.scaleX * 0.8,
      scaleY: out.scaleY * 0.8,
      opacity: 0.2,
      duration: 0.26,
      ease: 'power2.in',
    });
  }
  window.gsap.fromTo(cur,
    { scale: FOLDER_JELLY.from, opacity: 0.35, y: FOLDER_JELLY.riseY },
    {
      scale: 1,
      opacity: 1,
      y: 0,
      duration: FOLDER_JELLY.duration,
      ease: FOLDER_JELLY.ease,
      clearProps: 'transform,opacity',
    }
  );
}

/**
 * 文件夹切换全部交给滚轮（以及触摸拖动、方向键）。
 * 只比较累计位移、不依赖 deltaMode，因此在鼠标滚轮与触控板上手感一致；
 * 到达首尾时不拦截滚动，把控制权交还给页面。
 */
let deckWheelLock = 0;
function bindDeck(root) {
  const stage = root.querySelector('[data-deck]');
  if (!stage) return;

  stage.addEventListener('wheel', (e) => {
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    if (Math.abs(dy) < 3) return;
    // 首页是固定的一屏：滚轮一律由文件夹消费，页面本身不允许滚动。
    // 到了首尾也不把滚动交还给页面 —— 否则整页会被推走，「固定」就破了。
    e.preventDefault();
    const n = state.taxonomy.length;
    if (n < 2) return;
    if (dy > 0 ? state.folder >= n - 1 : state.folder <= 0) return;
    const now = performance.now();
    if (now < deckWheelLock) return;
    deckWheelLock = now + 340;
    folderStep(dy > 0 ? 1 : -1);
  }, { passive: false });

  let down = null;
  const start = (e) => {
    const p = e.touches ? e.touches[0] : e;
    down = { y: p.clientY, moved: 0 };
  };
  const move = (e) => {
    if (!down) return;
    const p = e.touches ? e.touches[0] : e;
    down.moved = p.clientY - down.y;
    if (Math.abs(down.moved) > 8) {
      stage.style.setProperty('--dy', `${Math.max(-64, Math.min(64, down.moved * 0.32)).toFixed(1)}px`);
    }
  };
  const end = () => {
    if (!down) return;
    const moved = down.moved;
    stage.style.setProperty('--dy', '0px');
    down = null;
    if (Math.abs(moved) > 56) folderStep(moved < 0 ? 1 : -1);
  };
  stage.addEventListener('pointerdown', start);
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', end);
  stage.addEventListener('touchstart', start, { passive: true });
  stage.addEventListener('touchmove', move, { passive: true });
  stage.addEventListener('touchend', end);

  // 就地重命名：回车或失焦写入，Esc 放弃。
  // 两个入口共用 done 标记，避免 Enter 之后 blur 再提交一次。
  root.querySelectorAll('[data-folder-rename]').forEach((input) => {
    const commit = () => {
      if (input.dataset.done === '1') return;
      input.dataset.done = '1';
      renameFolder(input.dataset.folderRename, input.value);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); input.dataset.done = '1'; input.blur(); }
    });
    input.addEventListener('blur', commit);
    // 名称里滚轮不该被 deck 抢去切换文件夹
    input.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  });

  // 把「新建文件夹」搬进当前文件夹那张卡片的内部：
  // 它是 absolute 定位的，挂在卡片上才能保证永远贴在卡片右下角，
  // 横版竖版、切换文件夹之后都是同一个相对位置。
  const addBtn = root.querySelector('[data-folder-new]');
  const curCard = root.querySelector('.folder.is-cur');
  if (addBtn) {
    if (curCard) curCard.appendChild(addBtn);
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();   // 别让这次点击被卡片的「双击进入 / 单击改名」逻辑吃掉
      createFolder();
    });
  }
}

/* ---------- 视图切换的轻微淡入 ---------- */

/**
 * 淡入只在真正发生视图切换时播放。render() 在一次加载里可能被调用多次
 * （深链参数、比较页兜底等），每次都重放会让动画不断重新开始，
 * 极端情况下页面会停在动画中段的半透明状态——所以加一个「同一视图只播一次」的守卫，
 * 并用 animationend 把类摘掉，落点永远是完全可见。
 */
let lastEnterKey = '';
function playEnter(key) {
  const el = viewEl();
  if (motion.reduce) { el.classList.remove('is-entering'); return; }
  if (key && key === lastEnterKey) return;   // 同一视图重复渲染：不重播
  lastEnterKey = key || '';
  el.classList.remove('is-entering');
  // 强制样式重算，使动画在同一帧内重新触发
  void el.offsetWidth;
  el.classList.add('is-entering');
  el.addEventListener('animationend', () => el.classList.remove('is-entering'), { once: true });
  // 兜底：动画事件缺失（被中断、标签页不可见等）时也保证不卡在半透明
  clearTimeout(playEnter._t);
  playEnter._t = setTimeout(() => el.classList.remove('is-entering'), 900);
}

/* ============================== 视图 ============================== */

const viewEl = () => $('#main');

function setNav(key) {
  for (const a of $$('.nav a')) {
    a.setAttribute('aria-current', a.dataset.nav === key ? 'page' : 'false');
    if (a.dataset.nav !== key) a.removeAttribute('aria-current');
  }
}

function card(style, i) {
  const id = String(style.id);
  return `
  <div class="cardwrap">
    <a class="card" href="#/s/${encodeURIComponent(id)}" data-card>
      ${thumbHTML(style)}
      <span class="card__open" aria-hidden="true">
        <span>查看条目</span>
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 12 12 2M5 2h7v7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
      <div class="card__meta">
        <div class="card__head">
          <span class="card__num tnum">${String(i + 1).padStart(2, '0')}</span>
          <span class="card__zh">${esc(style.nameZh)}</span>
          <span class="card__en lat">${esc(style.nameEn || '')}</span>
        </div>
        <p class="card__sum">${esc(style.summary || '')}</p>
        <div class="card__foot">
          <span title="${esc(style.era)}">${esc(shortEra(style.era))}</span>
          <span class="card__tags">${arr(style.tags).slice(0, 2).map((t) => `<span>${esc(t)}</span>`).join('')}</span>
        </div>
      </div>
    </a>
    <button class="card__del" type="button" data-style-del="${esc(id)}"
      aria-label="删除条目「${esc(style.nameZh)}」" title="删除这个条目">
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>`;
}

/** 删掉一个条目（不可撤销，所以要确认） */
async function deleteStyle(id) {
  const s = state.styles.find((x) => String(x.id) === String(id));
  if (!s) return;
  if (!window.confirm(`删除条目「${s.nameZh}」？\n\n这会从 styles.json 里移除它，以及它上传的图片。此操作不可撤销。`)) return;
  try {
    const res = await fetch(`/api/styles/${encodeURIComponent(id)}?purge=1`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '删除失败');
    state.styles = state.styles.filter((x) => String(x.id) !== String(id));
    render();
    toast(`已删除「${s.nameZh}」`);
  } catch (err) {
    toast(err.message, true);
  }
}

/** 卡片底部空间有限：把年代压到最短可辨认形式 */
function shortEra(era) {
  const e = String(era || '').replace(/\s+/g, ' ').trim();
  if (e.length <= 18) return e;
  const m = e.match(/\d{4}\s*[–—-]\s*\d{4}/);
  return m ? m[0] : `${e.slice(0, 17)}…`;
}

/** 错落栅格：两列一组，偶数列整体下移，避免模板化的等高卡片阵列 */
function staggeredGrid(list) {
  if (!list.length) {
    return `<div class="empty"><b>没有符合条件的风格</b>
      <p>试试减少筛选条件，或到 <a href="#/editor" style="border-bottom:1px solid var(--line)">扩充</a> 里新增一条。</p></div>`;
  }
  const groups = [];
  for (let i = 0; i < list.length; i += 2) groups.push(list.slice(i, i + 2));
  return `<div class="flow">${groups.map(([a, b], gi) => `
    <div class="flow__row">
      ${a ? card(a, gi * 2) : ''}
      ${b ? card(b, gi * 2 + 1) : ''}
    </div>`).join('')}</div>`;
}

const gridHTML = staggeredGrid;

/* ---------- 检索台 ---------- */

/**
 * 检索框。它和文件夹一起在画面正中，位置由 CSS 固定，任何装饰都不会推动它。
 */
function sideSearchHTML() {
  return `
  <div class="search" data-search>
    <div class="search__field">
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="6.8" cy="6.8" r="4.8" stroke="currentColor" stroke-width="1.4"/>
        <path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
      <label for="q" class="visually-hidden">按关键词检索风格</label>
      <input id="q" class="search__input" type="search" data-search-input autocomplete="off" spellcheck="false"
        placeholder="搜索风格或关键词" value="${esc(state.query)}">
      <button class="search__clear" type="button" id="clearQuery" aria-label="清空检索" ${state.query ? '' : 'hidden'}>×</button>
    </div>
  </div>`;
}

const labHTML = () => sideSearchHTML();

/**
 * 筛选行：类别 / 年代与排序 / 标签。
 * 类别与标签都可在这里**增删**（标签订阅的是 data/tags.json 的「可用标签」词表）：
 * 每个 chip 悬停时右侧浮出一个小 ×，行尾有「＋」。
 */
function filterRowsHTML() {
  const eras = [...new Set(state.styles.map(eraBucket))]
    .sort((a, b) => ERA_ORDER.indexOf(a) - ERA_ORDER.indexOf(b));
  const tags = availableTags();
  return `
  <div class="filters">
    <div class="filters__row">
      <span class="filters__label">类别</span>
      ${state.taxonomy.map((g) => `<span class="chipwrap">
        <button class="chip" type="button" data-group="${esc(g.key)}"
          aria-pressed="${state.groups.has(g.key)}">${esc(g.nameZh)}</button>
        <button class="chip__x" type="button" data-cat-del="${esc(g.key)}"
          aria-label="删除类别「${esc(g.nameZh)}」" title="删除这个类别">
          <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true" fill="none"
            stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </span>`).join('')}
      <span class="chipwrap">
        <button class="chip chip--add" type="button" data-cat-add title="新建一个类别">＋</button>
      </span>
    </div>

    <div class="filters__row">
      <span class="filters__label">年代</span>
      ${eras.map((e) => `<button class="chip" type="button" data-era="${esc(e)}" aria-pressed="${state.eras.has(e)}">${esc(e)}</button>`).join('')}
      <span class="filters__label" style="margin-left:1.1rem">排序</span>
      <div class="seg" role="group" aria-label="排序方式">
        <button type="button" data-sort="curated" aria-pressed="${state.sort === 'curated'}">策展</button>
        <button type="button" data-sort="az" aria-pressed="${state.sort === 'az'}">名称</button>
        <button type="button" data-sort="recent" aria-pressed="${state.sort === 'recent'}">最新</button>
      </div>
      <button class="btn btn--ghost btn--sm" type="button" id="clearFilters" ${hasFilters() ? '' : 'hidden'}>清除全部</button>
    </div>

    <div class="filters__row">
      <span class="filters__label">标签</span>
      ${tags.slice(0, 14).map(([t, n]) => `<span class="chipwrap">
        <button class="chip chip--tag" type="button" data-tag="${esc(t)}"
          aria-pressed="${state.tags.has(t)}">${esc(t)}${n ? `<span style="opacity:.55;margin-left:.3em">${n}</span>` : ''}</button>
        <button class="chip__x" type="button" data-tag-del="${esc(t)}"
          aria-label="从列表移除标签「${esc(t)}」" title="从可用列表移除（不改动条目）">
          <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true" fill="none"
            stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </span>`).join('')}
      <span class="chipwrap">
        <button class="chip chip--add" type="button" data-tag-add title="添加一个可用标签">＋</button>
      </span>
      <a class="chip" href="#/tags" style="border-style:dashed">全部 ${tags.length} 个 →</a>
    </div>
  </div>`;
}

function hasFilters() {
  return Boolean(state.query || state.groups.size || state.eras.size || state.tags.size || state.view === 'fav');
}

/**
 * 首页：只有「检索框 + 文件夹」这一个界面。
 * 文件夹可新建、可就地重命名；滚轮在文件夹之间切换（果冻动效见 playFolderIn）。
 */
function viewHome() {
  setNav('home');
  const q = state.query.trim();
  const results = filtered();
  const groups = state.taxonomy;

  return `
  <div class="home-panel" id="panel">
    <div class="shell">
      <div class="split">
        <aside class="split__side">
          <div class="side__center">
            ${sideSearchHTML()}
            ${q
              ? `<p class="side__note">找到 <b class="tnum">${results.length}</b> 条${results.length ? '' : '，换个词试试'}</p>`
              : ''}
          </div>
        </aside>

        <div class="split__main">
          ${q ? resultListHTML(results) : folderDeckHTML()}
        </div>
      </div>
    </div>
  </div>`;
}

/** 检索结果的呈现：右侧换成条目列表，左侧始终只有检索框 */
function resultListHTML(list) {
  if (!list.length) {
    return `<div class="empty"><b>没有匹配的条目</b>
      <p>支持风格名、别名、视觉特征、代表人物、作品与标签。也可以到
      <a href="#/index" style="border-bottom:1px solid var(--line)">总览</a> 里按条件筛选。</p></div>`;
  }
  return `
  <div class="results">
    <div class="resultbar">
      <span class="eyebrow">检索</span><b>「${esc(state.query)}」</b>
      <span class="tnum">${list.length} 条</span>
    </div>
    <ul class="results__list">
      ${list.map((s, i) => {
        const g = groupMeta(s.group);
        return `<li><a href="#/s/${encodeURIComponent(s.id)}">
          <span class="results__i tnum">${String(i + 1).padStart(2, '0')}</span>
          <span class="results__zh">${esc(s.nameZh)}</span>
          <span class="results__en lat">${esc(s.nameEn || '')}</span>
          <span class="results__meta">${esc(g.nameZh)} · ${esc(shortEra(s.era))}</span>
          <span class="results__hit">${esc(arr(s.identify)[0] || s.summary || '')}</span>
        </a></li>`;
      }).join('')}
    </ul>
  </div>`;
}

function viewBrowse() {
  setNav('browse');
  return `
  <section class="shell" style="padding-top:clamp(2rem,6vw,4rem)">
    <div class="section__head">
      <div>
        <h2 class="section__title">按类别浏览</h2>
        <p class="section__desc">按「反对什么、解决什么问题」分组，逐条列出该类别下的风格。点击进入条目，可看完整特征清单与识别依据。</p>
      </div>
      <span class="section__count tnum">${state.styles.length} ENTRIES</span>
    </div>
    ${state.taxonomy.map((g) => {
      const list = state.styles.filter((s) => s.group === g.key).sort((a, b) => (Number(a.order) || 500) - (Number(b.order) || 500));
      return `
      <div class="section" style="padding-top:clamp(1.5rem,4vw,2.5rem)">
        <div class="section__head" style="align-items:baseline">
          <div>
            <h3 class="section__title" style="font-size:clamp(1.3rem,2.6vw,2rem)">${esc(g.nameZh)}
              <span class="lat" style="font-size:.62em;color:var(--ink-3);font-style:italic">${esc(g.nameEn || '')}</span></h3>
            <p class="section__desc">${esc(g.desc || '')}</p>
          </div>
          <span class="section__count tnum">${String(list.length).padStart(2, '0')}</span>
        </div>
        ${staggeredGrid(list)}
      </div>`;
    }).join('')}
  </section>`;
}

function viewIndex() {
  setNav('index');
  const list = filtered();
  const favN = store.favorites.size;
  const hasFilter = hasFilters();
  return `
  <section class="shell" style="padding-top:clamp(2rem,6vw,4rem)">
    <div class="section__head">
      <div>
        <h2 class="section__title">总览</h2>
        <p class="section__desc">全部条目在一个平面里排序比较。按关键词、类别、年代、标签任意组合筛选。</p>
      </div>
      <span class="section__count tnum">${list.length} / ${state.styles.length}</span>
    </div>
    ${sideSearchHTML()}
    ${filterRowsHTML()}
    <div class="filters__row" style="margin-bottom:1.5rem">
      <button class="chip" type="button" id="favToggle" aria-pressed="${state.view === 'fav'}">只看收藏 <span style="opacity:.55">${favN}</span></button>
    </div>
    ${staggeredGrid(list)}
  </section>`;
}

function viewTags() {
  setNav('tags');
  const tags = tagCounts();
  const active = [...state.tags];
  const list = active.length ? filtered() : [];
  // 高频标签保留字号权重用于快速切入；其余按首字分组，避免 200 多个标签堆成一片噪声
  const HOT = 18;
  const hot = tags.slice(0, HOT);
  const rest = tags.slice(HOT);
  const byChar = new Map();
  for (const [t, n] of rest) {
    const k = /^[0-9A-Za-z]/.test(t) ? 'A–Z / 数字' : t[0];
    if (!byChar.has(k)) byChar.set(k, []);
    byChar.get(k).push([t, n]);
  }
  const charKeys = [...byChar.keys()].sort((a, b) =>
    a === 'A–Z / 数字' ? 1 : b === 'A–Z / 数字' ? -1 : a.localeCompare(b, 'zh')
  );

  return `
  <section class="shell" style="padding-top:clamp(2rem,6vw,4rem)">
    <div class="section__head">
      <div>
        <h2 class="section__title">标签反查</h2>
        <p class="section__desc">从你看到的视觉线索出发——材质、色彩、构图、工艺——直接找对应案例。可多选叠加，标签后的数字是条目数。</p>
      </div>
      <span class="section__count tnum">${tags.length} TAGS</span>
    </div>
    <div class="tagcloud" style="margin-bottom:clamp(2rem,4vw,3rem)">
      ${hot.map(([t, n]) => `<button type="button" data-tag="${esc(t)}" aria-pressed="${state.tags.has(t)}"
        style="font-size:${(1 + Math.min(n, 4) * 0.11).toFixed(2)}rem">${esc(t)}<span class="n tnum">${n}</span></button>`).join('')}
    </div>

    ${active.length
      ? `<div class="filters" style="margin-bottom:1.75rem">
           <span class="filters__label">已选</span>
           ${active.map((t) => `<button class="chip chip--tag" type="button" data-tag="${esc(t)}" aria-pressed="true">${esc(t)} ×</button>`).join('')}
           <button class="btn btn--ghost btn--sm" type="button" id="clearTags">清空</button>
         </div>
         ${gridHTML(list)}`
      : `<div class="tagindex">
           ${charKeys.map((k) => `
             <div class="tagindex__group">
               <div class="tagindex__key">${esc(k)}</div>
               <div class="tagindex__list">
                 ${byChar.get(k).map(([t, n]) => `<button type="button" data-tag="${esc(t)}" aria-pressed="false">${esc(t)}<span class="n tnum">${n}</span></button>`).join('')}
               </div>
             </div>`).join('')}
         </div>`}
  </section>`;
}

/** 依据条目里写明的「易混辨析」关系，生成可对照的组合清单 */
function suggestionsFor() {
  const out = [];
  const seen = new Set();
  for (const s of state.styles) {
    for (const c of arr(s.confusions)) {
      const t = state.styles.find(
        (x) => norm(x.nameZh) === norm(c.with) || norm(x.nameEn) === norm(c.with) || norm(x.id) === norm(c.with)
      );
      if (!t) continue;
      const key = [s.id, t.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([s.id, t.id]);
    }
  }
  return out;
}

function viewCompare() {
  setNav('compare');
  const opts = (sel) => `<option value="">请选择…</option>` +
    state.taxonomy.map((g) => {
      const items = state.styles.filter((s) => s.group === g.key);
      if (!items.length) return '';
      return `<optgroup label="${esc(g.nameZh)}">${items
        .map((s) => `<option value="${esc(s.id)}" ${sel === s.id ? 'selected' : ''}>${esc(s.nameZh)}${s.nameEn ? ' · ' + esc(s.nameEn) : ''}</option>`)
        .join('')}</optgroup>`;
    }).join('');

  const [a, b] = state.compare.map((id) => state.styles.find((s) => s.id === id) || null);

  // 有明确 confusions 关系的组合优先推荐
  const suggestions = suggestionsFor();

  const col = (s, which) => {
    if (!s) {
      return `<div class="duo__col duo__col--empty">
        <div class="empty" style="padding:3rem 0">
          <b>未选择风格</b>
          <p>从上方或「常见对照」里挑一组，即可并排对比两者的识别依据。</p>
        </div>
      </div>`;
    }
    const g = groupMeta(s.group);
    return `<div class="duo__col">
      <h3>${esc(s.nameZh)}</h3>
      <div class="en lat">${esc(s.nameEn || '')}</div>
      <div style="font-size:.72rem;color:var(--ink-3);letter-spacing:.12em;margin-top:.5rem">${esc(g.nameZh)} · ${esc(s.era || '')} · ${esc(s.region || '')}</div>
      ${thumbHTML(s)}
      <p style="font-size:.88rem;color:var(--ink-2)">${esc(s.summary || '')}</p>
      <div class="duo__crit">
        <div class="block__label"><b>辨识</b><h2>看这些细节就能分开</h2></div>
        <ul>${arr(s.identify).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>
      <div class="duo__crit">
        <div class="block__label"><b>特征</b><h2>主要视觉特征</h2></div>
        <ul>${arr(s.features).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>
      <div class="tags-row" style="margin-top:1.25rem">${arr(s.tags).map((t) => `<a class="chip chip--tag" href="#/tags">${esc(t)}</a>`).join('')}</div>
      <div class="btn-row" style="margin-top:1.25rem">
        <a class="btn btn--ghost btn--sm" href="#/s/${encodeURIComponent(s.id)}">查看完整条目 →</a>
      </div>
    </div>`;
  };

  const pairNote = a && b
    ? (() => {
        const hit = arr(a.confusions).find((c) => norm(c.with) === norm(b.nameZh) || norm(c.with) === norm(b.nameEn));
        const hit2 = arr(b.confusions).find((c) => norm(c.with) === norm(a.nameZh) || norm(c.with) === norm(a.nameEn));
        const shared = arr(a.tags).filter((t) => arr(b.tags).includes(t));
        return `<div class="section" style="padding-top:2rem">
          <div class="block__label"><b>对照</b><h2>两者的差异与交集</h2></div>
          ${hit ? `<div class="confusion"><b>${esc(a.nameZh)} 的视角</b><p>与「${esc(hit.with)}」的区分：${esc(hit.distinction)}</p></div>` : ''}
          ${hit2 ? `<div class="confusion"><b>${esc(b.nameZh)} 的视角</b><p>与「${esc(hit2.with)}」的区分：${esc(hit2.distinction)}</p></div>` : ''}
          ${shared.length ? `<div class="note"><b>共同标签</b>${shared.map(esc).join(' · ')} —— 共同标签越多，越需要用「识别依据」而不是印象来分辨。</div>`
            : `<div class="note"><b>共同标签</b>没有重叠标签，说明两者在形式线索上距离较远，通常不易混。</div>`}
        </div>`;
      })()
    : '';

  return `
  <section class="shell" style="padding-top:clamp(2rem,6vw,4rem)">
    <div class="section__head">
      <div>
        <h2 class="section__title">易混辨识</h2>
        <p class="section__desc">把两种风格并排放在一起，直接对比「识别依据」。这是知识库最有用的一页：多数误判发生在相邻风格之间。</p>
      </div>
      <span class="section__count">SIDE BY SIDE</span>
    </div>
    <div class="compare__pick">
      <div class="picker"><select data-compare="0" aria-label="左侧风格">${opts(a ? a.id : '')}</select></div>
      <div class="compare__vs">versus</div>
      <div class="picker"><select data-compare="1" aria-label="右侧风格">${opts(b ? b.id : '')}</select></div>
    </div>
    ${suggestions.length ? `<div class="filters" style="margin-bottom:2rem">
      <span class="filters__label">常见对照</span>
      ${suggestions.slice(0, 6).map(([x, y]) => {
        const sx = state.styles.find((s) => s.id === x);
        const sy = state.styles.find((s) => s.id === y);
        return `<button class="chip" type="button" data-pair="${esc(x)}|${esc(y)}">${esc(sx.nameZh)} ↔ ${esc(sy.nameZh)}</button>`;
      }).join('')}
    </div>` : ''}
    <div class="duo">${col(a, 0)}${col(b, 1)}</div>
    ${pairNote}
  </section>`;
}

function viewDetail(id) {
  setNav('index');
  const s = state.styles.find((x) => x.id === id);
  if (!s) {
    return `<section class="shell"><div class="empty"><b>找不到这个条目</b><p>它可能已被删除。<a href="#/index">回到总览</a></p></div></section>`;
  }
  const g = groupMeta(s.group);
  const related = state.styles
    .filter((x) => x.id !== s.id && (x.group === s.group || arr(x.tags).some((t) => arr(s.tags).includes(t))))
    .sort((x, y) => {
      const sx = arr(x.tags).filter((t) => arr(s.tags).includes(t)).length + (x.group === s.group ? 1 : 0);
      const sy = arr(y.tags).filter((t) => arr(s.tags).includes(t)).length + (y.group === s.group ? 1 : 0);
      return sy - sx;
    })
    .slice(0, 5);

  const isFav = store.favorites.has(s.id);

  return `
  <article class="shell detail">
    <div class="detail__top">
      <a class="backlink" href="#/index">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M8.5 2.5 4 7l4.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        返回总览
      </a>
      <div class="btn-row">
        <button class="btn btn--ghost btn--sm" type="button" data-fav="${esc(s.id)}" aria-pressed="${isFav}">${isFav ? '★ 已收藏' : '☆ 收藏'}</button>
        <a class="btn btn--ghost btn--sm" href="#/editor?id=${encodeURIComponent(s.id)}">编辑</a>
      </div>
    </div>

    <header class="detail__head">
      <div class="eyebrow" style="margin-bottom:1rem">${esc(g.nameZh)}${g.nameEn ? ' · ' + esc(g.nameEn) : ''}</div>
      <h1 class="detail__zh">${esc(s.nameZh)}</h1>
      <div class="detail__en lat">${esc(s.nameEn || '')}</div>
      ${arr(s.aka).length ? `<div style="margin-top:.75rem;font-size:.82rem;color:var(--ink-3)">又称：${arr(s.aka).map(esc).join(' / ')}</div>` : ''}
      <dl class="detail__facts">
        <div><dt>年代</dt><dd>${esc(s.era || '—')}</dd></div>
        <div><dt>地域</dt><dd>${esc(s.region || '—')}</dd></div>
        <div><dt>来源</dt><dd>${s.source === 'user' ? '自建条目' : '知识库收录'}</dd></div>
        <div><dt>代表作品</dt><dd class="tnum">${arr(s.works).length} 件</dd></div>
        <div class="detail__facts-wide"><dt>代表人物</dt><dd>${arr(s.figures).map(esc).join('、') || '—'}</dd></div>
      </dl>
    </header>

    <div class="detail__body">
      <div>
        ${s.image
          ? `<figure class="figure">
               <div class="figure__img"><div class="thumb__media" data-parallax>
                 <img src="${esc(s.image.url)}" alt="${esc(s.image.caption || s.nameZh)}" decoding="async"></div></div>
               <figcaption>
                 <span>${esc(s.image.caption || s.nameZh)}</span>
                 <span>${[s.image.author, s.image.license].filter(Boolean).map(esc).join(' · ')}${s.image.sourceUrl ? ` · <a href="${esc(s.image.sourceUrl)}" target="_blank" rel="noopener">来源</a>` : ''}</span>
               </figcaption>
             </figure>`
          : `<figure class="figure">
               <div class="figure__img"><div class="thumb__media" data-parallax>
                 <canvas data-motif="${esc(s.id)}" aria-label="${esc(s.nameZh)} 生成式母题示意图" role="img"></canvas>
                 <canvas data-motif-variant="${esc(s.id)}" aria-hidden="true"></canvas></div></div>
               <figcaption><span>生成式母题示意（暂无授权实拍图）</span><span>依据该风格的形式规则生成 · 非历史作品</span></figcaption>
             </figure>`}

        <section class="block">
          <div class="block__label"><b>01</b><h2>风格介绍</h2></div>
          <p class="prose">${esc(s.summary || '')}</p>
        </section>

        <section class="block">
          <div class="block__label"><b>02</b><h2>由来与脉络 <span>Origin</span></h2></div>
          <p class="prose">${esc(s.origin || '')}</p>
        </section>

        <section class="block">
          <div class="block__label"><b>03</b><h2>主要视觉特征 <span>Visual Features</span></h2></div>
          <ul class="checklist">${arr(s.features).map((f, i) => `<li data-i="${String(i + 1).padStart(2, '0')}">${esc(f)}</li>`).join('')}</ul>
        </section>

        <section class="block">
          <div class="block__label"><b>04</b><h2>识别依据 <span>How to Tell</span></h2></div>
          <p style="font-size:.85rem;color:var(--ink-3);margin-bottom:.75rem">看到这些具体证据，就可以判定为此风格；若只有氛围相似，不足为据。</p>
          <ul class="checklist checklist--plain">${arr(s.identify).map((f, i) => `<li data-i="${String(i + 1).padStart(2, '0')}">${esc(f)}</li>`).join('')}</ul>
        </section>

        <section class="block">
          <div class="block__label"><b>05</b><h2>代表作品 <span>Selected Works</span></h2></div>
          <div class="works">
            ${arr(s.works).map((w, i) => `
              <div class="work">
                <div class="work__i tnum">${String(i + 1).padStart(2, '0')}</div>
                <div>
                  <div class="work__t">${esc(w.title)}</div>
                  <div class="work__a">${[w.author, w.year].filter(Boolean).map(esc).join(' · ')}</div>
                  ${w.note ? `<p class="work__n">${esc(w.note)}</p>` : ''}
                </div>
                <div class="work__m">${esc(w.domain || '')}</div>
              </div>`).join('') || '<div class="empty" style="padding:2rem 0"><p>尚未录入代表作品。</p></div>'}
          </div>
        </section>

        ${arr(s.confusions).length ? `
        <section class="block">
          <div class="block__label"><b>06</b><h2>易混辨析 <span>Not to Be Confused With</span></h2></div>
          ${arr(s.confusions).map((c) => `<div class="confusion"><b>与「${esc(c.with)}」的区别</b><p>${esc(c.distinction)}</p></div>`).join('')}
        </section>` : ''}

        ${s.critique ? `
        <section class="block">
          <div class="block__label"><b>07</b><h2>批判性备注 <span>Critical Notes</span></h2></div>
          <div class="note"><b>请保留你自己的判断</b>${esc(s.critique)}</div>
        </section>` : ''}
      </div>

      <aside class="detail__aside">
        <div class="aside-box">
          <h3>标签 · 点击反查案例</h3>
          <div class="tags-row">
            ${arr(s.tags).map((t) => `<a class="chip chip--tag" href="#/index?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}
          </div>
        </div>

        <div class="aside-box">
          <h3>快速对照</h3>
          <div class="btn-row">
            ${arr(s.confusions).slice(0, 2).map((c) => {
              const t = state.styles.find((x) => norm(x.nameZh) === norm(c.with) || norm(x.nameEn) === norm(c.with));
              return t
                ? `<button class="btn btn--ghost btn--sm" type="button" data-pair="${esc(s.id)}|${esc(t.id)}">↔ 与「${esc(t.nameZh)}」并排看</button>`
                : `<span class="chip" style="cursor:default">常见混淆：${esc(c.with)}</span>`;
            }).join('')}
          </div>
        </div>

        ${related.length ? `
        <div class="aside-box">
          <h3>相关与相邻</h3>
          <ul class="aside-list">
            ${related.map((r) => `<li><a href="#/s/${encodeURIComponent(r.id)}">
              <div class="zh">${esc(r.nameZh)}</div>
              <div class="en lat">${esc(r.nameEn || '')}</div>
            </a></li>`).join('')}
          </ul>
        </div>` : ''}
      </aside>
    </div>
  </article>`;
}

/* ============================== 扩充台 ============================== */

const FIELD_IDS = ['nameZh', 'nameEn', 'aka', 'group', 'era', 'region', 'figures', 'summary', 'origin',
  'features', 'identify', 'tags', 'works', 'confusions', 'critique'];

function viewEditor(param) {
  setNav('editor');
  const editing = state.editingId ? state.styles.find((s) => s.id === state.editingId) : null;
  const d = editing || {};
  const lines = (v) => arr(v).join('\n');
  const worksText = arr(d.works).map((w) => [w.title, w.author, w.year, w.domain, w.note].join(' | ')).join('\n');
  const confText = arr(d.confusions).map((c) => `${c.with} | ${c.distinction}`).join('\n');

  const list = state.styles.slice().sort((a, b) => sortKey(a) - sortKey(b) || a.nameZh.localeCompare(b.nameZh, 'zh'));

  return `
  <section class="shell" style="padding-top:clamp(2rem,6vw,4rem)">
    <div class="section__head">
      <div>
        <h2 class="section__title">${editing ? '编辑条目' : '新增条目'}</h2>
        <p class="section__desc">新增或修改的内容会直接写入本地数据文件 <code style="font-family:var(--mono);font-size:.85em">data/styles.json</code>，永久保留，刷新与重启都在。</p>
      </div>
      <span class="section__count tnum">${state.styles.length} ENTRIES</span>
    </div>

    <div class="editor__grid">
      <form class="form" id="styleForm" novalidate>
        <input type="hidden" id="f-id" value="${esc(d.id || '')}">

        <div class="field field--row">
          <div class="field">
            <label for="f-nameZh">中文名称 *</label>
            <input type="text" id="f-nameZh" value="${esc(d.nameZh || '')}" required placeholder="例：瑞士国际主义风格">
          </div>
          <div class="field">
            <label for="f-nameEn">英文 / 原文名称</label>
            <input type="text" id="f-nameEn" value="${esc(d.nameEn || '')}" placeholder="例：Swiss Style">
          </div>
        </div>

        <div class="field field--row">
          <div class="field">
            <label for="f-group">所属类别 *</label>
            <select id="f-group" required>
              <option value="">请选择…</option>
              ${state.taxonomy.map((g) => `<option value="${esc(g.key)}" ${d.group === g.key ? 'selected' : ''}>${esc(g.nameZh)} · ${esc(g.nameEn || '')}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="f-era">年代</label>
            <input type="text" id="f-era" value="${esc(d.era || '')}" placeholder="例：1950s–1970s">
          </div>
          <div class="field">
            <label for="f-region">地域</label>
            <input type="text" id="f-region" value="${esc(d.region || '')}" placeholder="例：瑞士 · 苏黎世 / 巴塞尔">
          </div>
        </div>

        <div class="field">
          <label for="f-aka">又称 / 别名 <span class="hint">每行一个</span></label>
          <textarea id="f-aka" rows="2">${esc(lines(d.aka))}</textarea>
        </div>

        <div class="field">
          <label for="f-summary">风格介绍 * <span class="hint">90–150 字，讲清它是什么、解决什么问题</span></label>
          <textarea id="f-summary" rows="4" required>${esc(d.summary || '')}</textarea>
        </div>

        <div class="field">
          <label for="f-origin">由来与脉络 <span class="hint">历史语境、触发条件、关键节点</span></label>
          <textarea id="f-origin" rows="4">${esc(d.origin || '')}</textarea>
        </div>

        <div class="field">
          <label for="f-features">主要视觉特征 <span class="hint">每行一条，6 条左右</span></label>
          <textarea id="f-features" rows="6">${esc(lines(d.features))}</textarea>
        </div>

        <div class="field">
          <label for="f-identify">识别依据 <span class="hint">每行一条。写成可指认的证据，例如「栏宽恒为 5 栏、行距等于字号 1.5 倍」</span></label>
          <textarea id="f-identify" rows="6">${esc(lines(d.identify))}</textarea>
        </div>

        <div class="field">
          <label for="f-tags">标签 <span class="hint">每行一个，或逗号分隔。8–14 个为佳</span></label>
          <textarea id="f-tags" rows="3">${esc(arr(d.tags).join('、'))}</textarea>
        </div>

        <div class="field">
          <label for="f-figures">代表人物 <span class="hint">每行一个</span></label>
          <textarea id="f-figures" rows="3">${esc(lines(d.figures))}</textarea>
        </div>

        <div class="field">
          <label for="f-works">代表作品 <span class="hint">每行一条，用 | 分隔：作品名 | 作者 | 年份 | 领域 | 一句说明</span></label>
          <textarea id="f-works" rows="5" placeholder="绝对主义者的构成 | 特奥·凡·杜斯堡 | 1918 | 平面 | 把画面压成方格与三原色的宣言式作品">${esc(worksText)}</textarea>
        </div>

        <div class="field">
          <label for="f-confusions">易混辨析 <span class="hint">每行一条，用 | 分隔：易混对象 | 靠什么细节区分</span></label>
          <textarea id="f-confusions" rows="4" placeholder="包豪斯 | 风格派只用红黄蓝三原色与黑白灰，且拒绝斜线；包豪斯用色更广，常用 45° 与圆弧">${esc(confText)}</textarea>
        </div>

        <div class="field">
          <label for="f-critique">批判性备注 <span class="hint">争议、证据强度、被滥用之处——这一栏是知识库的价值所在</span></label>
          <textarea id="f-critique" rows="4">${esc(d.critique || '')}</textarea>
        </div>

        <div class="field">
          <label>代表图像 <span class="hint">拖入或点击上传；也可留空，系统会用该风格的形式规则生成图形母题</span></label>
          <div class="drop" id="drop" tabindex="0" role="button" aria-label="上传代表图像">
            ${d.image ? `<img src="${esc(d.image.url)}" alt="当前图像预览" id="imgPreview">` : `<img alt="" id="imgPreview" hidden>`}
            <div id="dropHint">${d.image ? '点击或拖入以替换' : '点击选择图片，或把图片拖到这里'}</div>
          </div>
          <input type="file" id="file" accept="image/*" hidden>
        </div>

        <div class="field field--row">
          <div class="field">
            <label for="f-imgAuthor">图像作者</label>
            <input type="text" id="f-imgAuthor" value="${esc(d.image?.author || '')}" placeholder="例：Herbert Bayer">
          </div>
          <div class="field">
            <label for="f-imgLicense">图像许可</label>
            <input type="text" id="f-imgLicense" value="${esc(d.image?.license || '')}" placeholder="例：Public Domain / CC BY-SA 4.0">
          </div>
          <div class="field">
            <label for="f-imgSource">来源链接</label>
            <input type="text" id="f-imgSource" value="${esc(d.image?.sourceUrl || '')}" placeholder="https://commons.wikimedia.org/...">
          </div>
        </div>

        <div class="btn-row">
          <button class="btn btn--signal" type="submit">${editing ? '保存修改' : '新增条目'}</button>
          ${editing ? `<a class="btn btn--ghost" href="#/editor">放弃编辑</a>` : ''}
          <button class="btn btn--ghost" type="button" id="exportBtn">导出全部 JSON</button>
          <button class="btn btn--ghost" type="button" id="importBtn">导入 JSON</button>
          <input type="file" id="importFile" accept=".json,application/json" hidden>
        </div>
        <p style="font-size:.75rem;color:var(--ink-3);margin:0">
          提示：<code style="font-family:var(--mono)">data/styles.json</code> 就是全部内容，可直接备份或纳入版本管理；站点启动时会自动加载。
        </p>
      </form>

      <aside>
        <div class="aside-box">
          <h3>全部条目 · 点击编辑</h3>
          <ul class="adminlist">
            ${list.map((s) => `<li>
              <span class="zh">${esc(s.nameZh)}</span>
              <span class="src ${s.source === 'user' ? 'src--user' : ''}">${s.source === 'user' ? '自建' : '收录'}</span>
              <a class="btn btn--ghost btn--sm" href="#/editor?id=${encodeURIComponent(s.id)}">编辑</a>
            </li>`).join('')}
          </ul>
        </div>
        <div class="aside-box" style="margin-top:1.5rem">
          <h3>标签现状</h3>
          <div class="tags-row">
            ${tagCounts().slice(0, 40).map(([t, n]) => `<span class="chip" style="cursor:default">${esc(t)} <span style="opacity:.5">${n}</span></span>`).join('')}
          </div>
        </div>

        <div class="aside-box" style="margin-top:1.5rem">
          <h3>类别管理</h3>
          <p style="font-size:.78rem;color:var(--ink-3);margin:0 0 .9rem">
            类别是站点的第一层骨架。新增后立即可用于条目归属；仍有条目在用的类别不能删除。
          </p>
          <ul class="adminlist" style="max-height:none">
            ${state.taxonomy.map((g) => {
              const used = state.styles.filter((s) => s.group === g.key).length;
              return `<li style="align-items:flex-start">
                <span class="zh" style="white-space:normal">
                  ${esc(g.nameZh)}
                  <span style="display:block;font-size:.72rem;color:var(--ink-3)">${esc(g.nameEn || '')} · ${used} 则</span>
                </span>
                <input type="text" data-cat-rename="${esc(g.key)}" value="${esc(g.nameZh)}"
                  aria-label="重命名类别 ${esc(g.nameZh)}"
                  style="width:7.5rem;background:var(--paper-2);border:var(--hair);padding:.3rem .45rem;font-size:.8rem">
                <button class="btn btn--ghost btn--sm" type="button" data-cat-cover="${esc(g.key)}"
                  title="${g.cover ? '更换文件夹封面' : '为文件夹上传封面'}">${g.cover ? '换封面' : '上传封面'}</button>
                <button class="btn btn--ghost btn--sm" type="button" data-cat-del="${esc(g.key)}"
                  ${used ? 'disabled title="该类别下仍有条目，先改归属再删除"' : ''}>删除</button>
              </li>`;
            }).join('')}
          </ul>
          <input type="file" id="catCoverFile" accept="image/*" hidden>
          <p style="font-size:.75rem;color:var(--ink-3);margin:.7rem 0 0">
            文件夹封面会显示在首页的文件夹上；没上传时案例位留空。
          </p>
          <div class="form" style="margin-top:1rem">
            <div class="field field--row">
              <div class="field">
                <label for="nc-zh">新类别名称</label>
                <input type="text" id="nc-zh" placeholder="例：工艺美术运动">
              </div>
              <div class="field">
                <label for="nc-en">英文名</label>
                <input type="text" id="nc-en" placeholder="Arts and Crafts">
              </div>
            </div>
            <div class="field">
              <label for="nc-desc">一句话说明</label>
              <textarea id="nc-desc" rows="2" placeholder="这一组的共同问题或共同对手是什么"></textarea>
            </div>
            <div class="btn-row">
              <button class="btn btn--ghost btn--sm" type="button" id="addCat">新增类别</button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </section>`;
}

/* ============================== 表单逻辑 ============================== */

function splitLines(v) {
  return String(v || '').split('\n').map((x) => x.trim()).filter(Boolean);
}
function splitTags(v) {
  return String(v || '').split(/[\n,，、;；]+/).map((x) => x.trim()).filter(Boolean);
}
function parsePiped(v, keys) {
  return splitLines(v).map((line) => {
    const parts = line.split('|').map((x) => x.trim());
    const o = {};
    keys.forEach((k, i) => { if (parts[i]) o[k] = parts[i]; });
    return o;
  }).filter((o) => Object.keys(o).length);
}

async function collectForm() {
  const val = (id) => $(`#${id}`)?.value ?? '';
  const id = val('f-id');
  const nameZh = val('f-nameZh').trim();
  if (!nameZh) throw new Error('中文名称不能为空');
  const group = val('f-group');
  if (!group) throw new Error('请选择所属类别');

  const existing = id ? state.styles.find((s) => s.id === id) : null;
  const payload = {
    nameZh,
    nameEn: val('f-nameEn').trim(),
    aka: splitLines(val('f-aka')),
    group,
    era: val('f-era').trim(),
    region: val('f-region').trim(),
    summary: val('f-summary').trim(),
    origin: val('f-origin').trim(),
    features: splitLines(val('f-features')),
    identify: splitLines(val('f-identify')),
    tags: splitTags(val('f-tags')),
    figures: splitLines(val('f-figures')),
    works: parsePiped(val('f-works'), ['title', 'author', 'year', 'domain', 'note']),
    confusions: parsePiped(val('f-confusions'), ['with', 'distinction']),
    critique: val('f-critique').trim(),
  };

  let image = existing?.image ? { ...existing.image } : null;
  if (state.draftImage) {
    image = { ...(image || {}), url: state.draftImage, caption: `${nameZh} 代表图像` };
  }
  if (image) {
    image.author = val('f-imgAuthor').trim();
    image.license = val('f-imgLicense').trim();
    image.sourceUrl = val('f-imgSource').trim();
  }
  payload.image = image;

  return { id, payload };
}

async function submitForm(e) {
  e.preventDefault();
  const btn = $('#styleForm button[type=submit]');
  btn.disabled = true;
  try {
    const { id, payload } = await collectForm();
    const res = await fetch(id ? `/api/styles/${encodeURIComponent(id)}` : '/api/styles', {
      method: id ? 'PUT' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '保存失败');
    state.draftImage = null;
    state.styles = await (await fetch('/api/styles')).json();
    toast(id ? '已保存修改' : `已新增「${data.nameZh}」，内容已写入 data/styles.json`);
    location.hash = `#/s/${encodeURIComponent(data.id)}`;
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

/** 上传一张图片，返回它在站点内的 URL。供条目配图与文件夹封面共用 */
async function uploadImage(file) {
  if (!file) throw new Error('没有选择文件');
  if (!/^image\//.test(file.type)) throw new Error('请选择图片文件');
  if (file.size > 12 * 1024 * 1024) throw new Error('图片超过 12MB');
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('读取文件失败'));
    fr.readAsDataURL(file);
  });
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dataUrl, filename: file.name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '上传失败');
  return data.url;
}

async function uploadFile(file) {
  if (!file) return;
  try {
    const url = await uploadImage(file);
    state.draftImage = url;
    const prev = $('#imgPreview');
    if (prev) { prev.src = url; prev.hidden = false; }
    const hint = $('#dropHint');
    if (hint) hint.textContent = '已上传，保存条目后生效';
    toast('图片已上传');
  } catch (err) {
    toast(err.message, true);
  }
}

function bindEditor() {
  const form = $('#styleForm');
  if (!form) return;
  form.addEventListener('submit', submitForm);

  const drop = $('#drop');
  const file = $('#file');
  drop?.addEventListener('click', () => file.click());
  drop?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  file?.addEventListener('change', () => uploadFile(file.files[0]));
  for (const ev of ['dragenter', 'dragover']) {
    drop?.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    drop?.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); });
  }
  drop?.addEventListener('drop', (e) => uploadFile(e.dataTransfer?.files?.[0]));
  window.addEventListener('paste', (e) => {
    if (!location.hash.startsWith('#/editor')) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) uploadFile(item.getAsFile());
  });

  $('#exportBtn')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.styles, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `form-atlas-styles-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const importFile = $('#importFile');
  $('#importBtn')?.addEventListener('click', () => importFile.click());
  importFile?.addEventListener('change', async () => {
    const f = importFile.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      const body = JSON.parse(text);
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '导入失败');
      state.styles = await (await fetch('/api/styles')).json();
      toast(`导入完成：新增 ${data.added} 条，更新 ${data.updated} 条`);
      render();
    } catch (err) {
      toast(`导入失败：${err.message}`, true);
    } finally {
      importFile.value = '';
    }
  });
}

/* ============================== 类别管理 ============================== */

let taxonomyTimer = null;

async function saveTaxonomy(patch, opts = {}) {
  const next = typeof patch === 'function' ? patch(state.taxonomy) : patch;
  const res = await fetch('/api/taxonomy', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(next),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '类别保存失败');
  state.taxonomy = data.taxonomy;

  // 重绘会替换 DOM。正在编辑的输入框（类别管理页的、首页文件夹名的）要保住焦点与光标，
  // 否则每敲一次字就跳出去。
  const active = document.activeElement;
  const attr = active && active.dataset
    ? (active.dataset.catRename ? 'data-cat-rename' : (active.dataset.folderRename ? 'data-folder-rename' : null))
    : null;
  const keepVal = attr ? active.dataset[attr === 'data-cat-rename' ? 'catRename' : 'folderRename'] : null;
  const pos = active && active.selectionStart != null ? active.selectionStart : null;

  render();

  if (attr && keepVal != null) {
    const next2 = viewEl().querySelector(`[${attr}="${CSS.escape(keepVal)}"]`);
    if (next2) {
      next2.focus();
      if (pos != null) { try { next2.setSelectionRange(pos, pos); } catch {} }
    }
  }
}

function bindCategoryAdmin() {
  const root = viewEl();

  // 文件夹封面：选框 -> 上传 -> 写回 taxonomy.json
  const coverFile = $('#catCoverFile');
  coverFile?.addEventListener('change', async () => {
    const f = coverFile.files[0];
    const key = coverFile.dataset.catKey;
    if (!f || !key) return;
    try {
      const url = await uploadImage(f);
      await saveTaxonomy((list) => list.map((g) => (g.key === key ? { ...g, cover: url } : g)));
      toast('文件夹封面已更新');
    } catch (err) {
      toast(err.message, true);
    } finally {
      coverFile.value = '';
    }
  });

  root.addEventListener('input', (e) => {
    const input = e.target.closest('[data-cat-rename]');
    if (!input) return;
    const key = input.dataset.catRename;
    const zh = input.value;
    clearTimeout(taxonomyTimer);
    taxonomyTimer = setTimeout(() => {
      saveTaxonomy((list) => list.map((g) => (g.key === key ? { ...g, nameZh: zh.trim() || g.nameZh } : g)))
        .then(() => toast('类别名称已更新'))
        .catch((err) => toast(err.message, true));
    }, 700);
  });

  root.addEventListener('click', async (e) => {
    const cover = e.target.closest('[data-cat-cover]');
    if (cover) {
      const file = $('#catCoverFile');
      if (!file) return;
      file.dataset.catKey = cover.dataset.catCover;
      file.click();
      return;
    }

    const del = e.target.closest('[data-cat-del]');
    if (del) {
      const key = del.dataset.catDel;
      const used = state.styles.filter((s) => s.group === key).length;
      if (used) return toast(`该类别下还有 ${used} 则条目，先改归属再删除`, true);
      const g = state.taxonomy.find((x) => x.key === key);
      if (!confirm(`确认删除类别「${g?.nameZh || key}」？此操作会写入 data/taxonomy.json。`)) return;
      try {
        await saveTaxonomy((list) => list.filter((x) => x.key !== key));
        toast('类别已删除');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (e.target.closest('#addCat')) {
      const zh = $('#nc-zh')?.value.trim();
      const en = $('#nc-en')?.value.trim() || '';
      const desc = $('#nc-desc')?.value.trim() || '';
      if (!zh) return toast('请填写新类别名称', true);
      const key = slugKey(en || zh);
      if (state.taxonomy.some((g) => g.key === key)) return toast('已存在同名类别', true);
      try {
        await saveTaxonomy((list) => [...list, { key, nameZh: zh, nameEn: en, desc }]);
        toast(`已新增类别「${zh}」`);
      } catch (err) {
        toast(err.message, true);
      }
    }
  });
}

function slugKey(s) {
  const k = String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return k || `cat-${Date.now().toString(36)}`;
}

/* ============================== 路由 ============================== */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(queryPart || '');
  return { segs, params };
}

function render() {
  const { segs, params } = parseHash();
  const route = segs[0] || 'home';
  let html = '';
  // 首页的文件夹是整页重绘的，重绘前先量好要退场的那一只
  const folderOut = route === 'home' ? measureFolderExit(viewEl()) : null;

  // 视图函数一旦抛错，页面会静默变空白——把错误显式呈现出来，便于定位
  try {
    if (route === 's' && segs[1]) html = viewDetail(decodeURIComponent(segs[1]));
    else if (route === 'browse') html = viewBrowse();
    else if (route === 'index') html = viewIndex();
    else if (route === 'tags') html = viewTags();
    else if (route === 'compare') html = viewCompare();
    else if (route === 'editor') html = viewEditor(params.get('id'));
    else html = viewHome();
  } catch (err) {
    console.error('[render]', route, err);
    html = `<section class="shell"><div class="empty">
      <b>这一页渲染失败</b>
      <p>${esc(err && err.message ? err.message : String(err))}</p>
      <p style="margin-top:1rem"><a class="btn btn--ghost btn--sm" href="#/">回到首页</a>
      <button class="btn btn--ghost btn--sm" type="button" data-reload>重新加载</button></p>
    </div></section>`;
  }

  viewEl().innerHTML = html;

  // 深链参数：从详情页或首页跳转过来时，自动应用筛选
  const gParam = params.get('group');
  if (gParam && route === 'index' && !state.groups.has(gParam)) {
    state.groups = new Set([gParam]);
    viewEl().innerHTML = viewIndex();
  }
  const tParam = params.get('tag');
  if (tParam && route === 'index' && !state.tags.has(tParam)) {
    state.tags = new Set([tParam]);
    viewEl().innerHTML = viewIndex();
  }
  // 首页可用 ?folder= 定位到某个类别文件夹，便于分享与刷新后保持位置
  const fParam = params.get('folder');
  if (fParam != null && route === 'home') {
    const idx = /^\d+$/.test(fParam)
      ? Number(fParam)
      : state.taxonomy.findIndex((g) => g.key === fParam);
    if (idx >= 0 && idx < state.taxonomy.length && idx !== state.folder) {
      state.folder = idx;
      viewEl().innerHTML = viewHome();
    }
  }

  if (route === 'editor') { bindEditor(); bindCategoryAdmin(); }

  // 首页是一屏固定的界面：锁住页面滚动，滚轮只用来切文件夹。
  // 其余页面保持正常滚动。
  document.body.classList.toggle('is-locked', route === 'home');

  // 辨识页首次进入时预填一组最典型的易混对照，避免打开就是两个空选择框
  if (route === 'compare' && !params.get('pair') && !state.compare[0] && suggestionsFor().length) {
    const [x, y] = suggestionsFor()[0];
    state.compare = [x, y];
    viewEl().innerHTML = viewCompare();
  }

  bindDeck(viewEl());
  paintMotifs(viewEl());
  collectMotion();
  requestMotion();
  playEnter(route + (segs[1] || ''));
  playFolderIn(viewEl(), folderOut);
  updateMasthead();
  document.title = titleFor(route, segs[1]);
  // 首屏几何在字体载入后可能变化，再校准一次
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleRecollect).catch(() => {});
}

function titleFor(route, id) {
  const base = '形式风格图谱 · 设计语言知识库';
  if (route === 's' && id) {
    const s = state.styles.find((x) => x.id === decodeURIComponent(id));
    if (s) return `${s.nameZh} · 形式风格图谱`;
  }
  const map = { browse: '分类', index: '总览', tags: '标签', compare: '易混辨识', editor: '扩充' };
  return map[route] ? `${map[route]} · 形式风格图谱` : base;
}

function updateMasthead() {
  // 顶栏与页脚已移除，这里只保留标题的同步
  const n = state.styles.length;
  const el = document.querySelector('meta[name="description"]');
  if (el) el.setAttribute('content', `个人形式风格知识库：${n} 则风格条目，含名称、主要视觉特征、识别依据与代表作品。`);
}

/** 滚动到视口后再淡入，给长页面一点节奏；由 IntersectionObserver 驱动，不参与 rAF */
function observeRise() {
  const els = $$('.cat, .figure, .block, .tagindex__group');
  if (!els.length) return;
  if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('is-in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.02 });
  els.forEach((e, i) => {
    e.classList.add('rise');
    e.style.transitionDelay = `${Math.min(i % 7, 6) * 45}ms`;
    io.observe(e);
  });
}

/* 全局交互：事件委托，避免在每次重渲染后重新绑定 */
function bindGlobal() {
  document.addEventListener('click', (e) => {
    const t = e.target;

    // 文件夹堆叠的点击分工：
    //   相邻文件夹 —— 单击就把它带到中间
    //   当前文件夹的名称 —— 单击改名（是输入框，浏览器自己处理）
    //   当前文件夹的卡片 —— **双击**才进入它的条目，避免和改名抢单击
    const del = t.closest('[data-folder-del]');
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      return deleteFolder(del.dataset.folderDel);
    }

    // 总览里的增删：类别、标签、条目
    const catDel = t.closest('[data-cat-del]');
    if (catDel) return deleteFolder(catDel.dataset.catDel);

    if (t.closest('[data-cat-add]')) {
      const name = window.prompt('新类别的名称：');
      return name != null && name.trim() ? addCategory(name.trim()) : undefined;
    }

    const tagDel = t.closest('[data-tag-del]');
    if (tagDel) return removeTag(tagDel.dataset.tagDel);

    if (t.closest('[data-tag-add]')) {
      const name = window.prompt('要添加的标签名：');
      return name != null && name.trim() ? addTag(name.trim()) : undefined;
    }

    const entryDel = t.closest('[data-style-del]');
    if (entryDel) {
      e.preventDefault();
      e.stopPropagation();
      return deleteStyle(entryDel.dataset.styleDel);
    }

    const folder = t.closest('[data-folder]');
    if (folder) {
      const role = folder.dataset.folderRole;
      const idx = state.taxonomy.findIndex((g) => g.key === folder.dataset.folder);
      if (role !== 'cur') {
        // 相邻文件夹：把它带到中间
        if (idx >= 0) goFolder(idx);
        return;
      }
      // 当前文件夹：只在双击时进入；单击落在名称上交给输入框去改名
      if (t.closest('[data-folder-rename]')) return;
      if (e.detail < 2) {
        // 单击卡片本体：把焦点给名称，暗示「这里可以改名」
        return;
      }
      location.hash = `#/index?group=${encodeURIComponent(folder.dataset.folder)}`;
      return;
    }

    if (t.closest('#clearQuery')) {
      state.query = '';
      return softRefresh();
    }

    if (t.closest('[data-reload]')) {
      location.reload();
      return;
    }

    // 首页「展开全部」：把其余条目按需追加，不一次性铺满首屏
    const more = t.closest('[data-more]');
    if (more) {
      const rest = $('#restList');
      const all = filtered();
      if (rest && all.length > 8) {
        rest.innerHTML = staggeredGrid(all.slice(8));
        rest.hidden = false;
        paintMotifs(rest);
        collectMotion();
        requestMotion();
      }
      more.closest('.resultbar')?.remove();
      return;
    }

    const chipGroup = t.closest('[data-group]');
    if (chipGroup) {
      const k = chipGroup.dataset.group;
      state.groups.has(k) ? state.groups.delete(k) : state.groups.add(k);
      return softRefresh();
    }
    const chipEra = t.closest('[data-era]');
    if (chipEra) {
      const k = chipEra.dataset.era;
      state.eras.has(k) ? state.eras.delete(k) : state.eras.add(k);
      return softRefresh();
    }
    const chipTag = t.closest('[data-tag]');
    if (chipTag) {
      const k = chipTag.dataset.tag;
      state.tags.has(k) ? state.tags.delete(k) : state.tags.add(k);
      return softRefresh();
    }
    const sortBtn = t.closest('[data-sort]');
    if (sortBtn) { state.sort = sortBtn.dataset.sort; return softRefresh(); }

    if (t.closest('#clearFilters')) {
      state.query = ''; state.groups.clear(); state.eras.clear(); state.tags.clear(); state.view = 'all';
      return softRefresh();
    }
    if (t.closest('#clearTags')) { state.tags.clear(); return softRefresh(); }
    if (t.closest('#favToggle')) {
      state.view = state.view === 'fav' ? 'all' : 'fav';
      return softRefresh();
    }

    const fav = t.closest('[data-fav]');
    if (fav) {
      const on = store.toggleFav(fav.dataset.fav);
      fav.textContent = on ? '★ 已收藏' : '☆ 收藏';
      fav.setAttribute('aria-pressed', String(on));
      toast(on ? '已加入收藏' : '已取消收藏');
      if (location.hash.startsWith('#/index')) softRefresh();
      return;
    }

    const pair = t.closest('[data-pair]');
    if (pair) {
      const [x, y] = pair.dataset.pair.split('|');
      state.compare = [x, y];
      location.hash = '#/compare';
      if (location.hash === '#/compare') softRefresh();
      return;
    }
  });

  // 选择器变更
  document.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-compare]');
    if (sel) {
      state.compare[Number(sel.dataset.compare)] = sel.value || null;
      return softRefresh();
    }
  });

  // 输入即时检索（防抖），输入后保持焦点与光标位置
  let t = null;
  document.addEventListener('input', (e) => {
    const input = e.target.closest('[data-search-input]');
    if (!input) return;
    const v = input.value;
    const pos = input.selectionStart;
    state.query = v;
    clearTimeout(t);
    t = setTimeout(() => {
      const { segs } = parseHash();
      const route = segs[0] || 'home';
      // 在标签页/分类页输入检索词时，切到总览页展示结果
      if (route === 'tags' || route === 'browse') { location.hash = '#/index'; return; }
      softRefresh();
      const next = $(`[data-search-input]#${input.id}`);
      if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch {} }
    }, 170);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea|select/i.test(e.target.tagName)) {
      e.preventDefault();
      const route = parseHash().segs[0] || 'home';
      if (!['index', 'home'].includes(route)) location.hash = '#/index';
      setTimeout(() => $('[data-search-input]#q')?.focus(), 60);
    }
    if (e.key === 'Escape') {
      const input = e.target.closest && e.target.closest('[data-search-input]');
      if (input && state.query) { state.query = ''; softRefresh(); }
    }
    // 文件夹堆叠用上下方向键切换（与滚轮方向一致）
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !/input|textarea|select/i.test(e.target.tagName)) {
      if (!viewEl().querySelector('[data-deck]')) return;
      e.preventDefault();
      folderStep(e.key === 'ArrowDown' ? 1 : -1);
    }
  });

  // 指针位置驱动文件夹与卡片的轻微位移
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerleave', () => { motion.pointer.active = false; requestMotion(); });
  window.addEventListener('scroll', onScroll, { passive: true });

  window.addEventListener('hashchange', () => {
    const { segs } = parseHash();
    if (segs[0] !== 'editor') state.draftImage = null;
    if (segs[0] !== 'editor') state.editingId = null;
    render();
  });

  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(scheduleRecollect, 180);
  });
}

/** 仅重绘内容，保留输入焦点：用于筛选/排序这类高频交互 */
let softTimer = null;
function softRefresh() {
  clearTimeout(softTimer);
  softTimer = setTimeout(() => {
    const { segs, params } = parseHash();
    const route = segs[0] || 'home';
    const active = document.activeElement;
    const keepId = active && /^(q|f-)/.test(active.id) ? active.id : null;
    const pos = keepId && active.selectionStart != null ? active.selectionStart : null;
    // 先在旧 DOM 上量好退场的那只文件夹，再整体重绘
    const out = route === 'home' ? measureFolderExit(viewEl()) : null;

    if (route === 'index' || route === 'home') {
      viewEl().innerHTML = route === 'index' ? viewIndex() : viewHome();
    } else if (route === 'tags') {
      viewEl().innerHTML = viewTags();
    } else if (route === 'compare') {
      viewEl().innerHTML = viewCompare();
    } else {
      return render();
    }
    bindDeck(viewEl());
    paintMotifs(viewEl());
    collectMotion();
    requestMotion();
    playFolderIn(viewEl(), out);
    observeRise();
    updateMasthead();

    if (keepId) {
      const next = $(`[data-search-input]#${keepId}, #${keepId}`);
      if (next) {
        next.focus();
        if (pos != null && next.setSelectionRange) { try { next.setSelectionRange(pos, pos); } catch {} }
      }
    }
  }, 10);
}

/* ============================== 启动 ============================== */

async function boot() {
  try {
    const res = await fetch('/api/bootstrap');
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    state.styles = Array.isArray(data.styles) ? data.styles : [];
    state.taxonomy = Array.isArray(data.taxonomy) ? data.taxonomy : [];
    state.tagVocab = {
      custom: Array.isArray(data.tags?.custom) ? data.tags.custom : [],
      hidden: Array.isArray(data.tags?.hidden) ? data.tags.hidden : [],
    };
    if (!state.styles.length) throw new Error('empty');
  } catch {
    // 接口不可用时退回内置的 seed 模块，页面仍可阅读（只读）。
    // 两个候选路径都试：正常在 /assets/seed.js（与本文件同目录），
    // 但若站点把 assets 放在别的前缀下，/seed.js 也能兜住。
    for (const url of ['./seed.js', '../seed.js']) {
      try {
        const seed = await import(/* @vite-ignore */ url);
        state.styles = seed.seedStyles || [];
        state.taxonomy = seed.seedTaxonomy || [];
        if (state.styles.length) break;
      } catch { /* 换下一个候选 */ }
    }
  }
  if (!state.taxonomy.length) {
    state.taxonomy = [{ key: 'other', nameZh: '未分类', nameEn: 'Other', desc: '' }];
  }
  bindGlobal();
  render();
  // 探针：?probe=1 写在 hash 或 search 里都要能用（#/?probe=1 更常见）
  const hashQuery = location.hash.includes('?') ? location.hash.split('?')[1] : '';
  const probeFlag = new URLSearchParams(location.search).get('probe')
    || new URLSearchParams(hashQuery).get('probe');
  if (probeFlag === '1') setTimeout(layoutProbe, 1200);   // 等开场把卡片摆好再量
}

/**
 * 版面探针（仅开发用）：列出比视口更宽的元素，用于定位横向溢出。
 * 通过 ?probe=1 触发，结果写入页面，便于用无头浏览器 --dump-dom 读取。
 */
function layoutProbe() {
  const vw = document.documentElement.clientWidth;
  const rows = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('#layout-probe')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const over = Math.round(r.right - vw);
    if (over > 1) {
      rows.push({
        over,
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 44),
        w: Math.round(r.width),
        l: Math.round(r.left),
        r: Math.round(r.right),
      });
    }
  }
  rows.sort((a, b) => b.over - a.over);

  // 画布几何：确认每个 canvas 的绘制缓冲、显示尺寸与父容器是否一致
  const canvases = [...document.querySelectorAll('canvas')].map((c) => {
    const cr = c.getBoundingClientRect();
    const pr = c.parentElement.getBoundingClientRect();
    const inside = cr.left >= pr.left - 1 && cr.right <= pr.right + 1;
    return {
      key: (c.dataset.motif || c.dataset.motifVariant || '?').slice(0, 18),
      buf: `${c.width}x${c.height}`,
      css: `${Math.round(cr.width)}x${Math.round(cr.height)}`,
      parent: `${Math.round(pr.width)}x${Math.round(pr.height)}`,
      ratioBuf: +(c.width / (c.height || 1)).toFixed(3),
      ratioCss: +(cr.width / (cr.height || 1)).toFixed(3),
      inside,
      stage: !!c.closest('.thumb--stage'),
    };
  });
  const mismatched = canvases.filter((c) => Math.abs(c.ratioBuf - c.ratioCss) > 0.03);
  const outside = canvases.filter((c) => !c.inside);

  const box = document.createElement('div');
  box.id = 'layout-probe';
  box.style.cssText = 'position:fixed;left:0;bottom:0;z-index:9999;background:#fff;color:#000;font:11px monospace;padding:6px;max-height:70vh;overflow:auto;border-top:2px solid #000;white-space:pre';
  const fig = document.querySelector('.figure__img');
  const figInfo = fig
    ? `FIGURE ${Math.round(fig.getBoundingClientRect().width)}x${Math.round(fig.getBoundingClientRect().height)} 子元素=${fig.children.length} 内部=${[...fig.children].map((c) => `${c.tagName.toLowerCase()}:${Math.round(c.getBoundingClientRect().width)}x${Math.round(c.getBoundingClientRect().height)}`).join(' ')}`
    : 'FIGURE 无';
  // 文件夹与开场卡片的实际观感（透明度、变换、面色）——动画结束后是否真的落定
  const styleOf = (el, label) => {
    if (!el) return `${label}: 无`;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return `${label}: opacity=${cs.opacity} bg=${cs.backgroundColor} tf=${cs.transform.slice(0, 46)} rect=${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.top)}`;
  };
  const folderInfo = [
    styleOf(document.querySelector('.folder.is-cur'), 'CUR'),
    styleOf(document.querySelector('.folder.is-cur .folder__body'), 'CUR-BODY'),
    styleOf(document.querySelector('.folder.is-prev'), 'PREV'),
    styleOf(document.querySelector('.folder.is-next'), 'NEXT'),
    `main.is-gated=${document.getElementById('main')?.classList.contains('is-gated')} gsap=${!!window.gsap}`,
  ].join('\n');
  // 文件夹的可编辑名称：确认当前文件夹那一只确实带着输入框
  const ren = document.querySelector('[data-folder-rename]');
  const renInfo = ren
    ? `RENAME key=${ren.dataset.folderRename} value="${ren.value}" visible=${ren.getBoundingClientRect().width > 0}`
    : 'RENAME 无';
  // 关键几何：检索框与文件夹的位置。字母起飞后这些数字必须**一模一样**——
  // 它们曾经因为字标脱离文档流而整体上移，这个探针就是用来钉住这一点的。
  const geo = (sel, label) => {
    const el = document.querySelector(sel);
    if (!el) return `${label}=无`;
    const r = el.getBoundingClientRect();
    return `${label}=x${Math.round(r.left)} y${Math.round(r.top)} w${Math.round(r.width)} h${Math.round(r.height)}`;
  };
  const geomInfo = [
    geo('.side__center', 'SIDECENTER'),
    geo('.search', 'SEARCHBOX'),
    geo('.search__field', 'SEARCH'),
    geo('.folder.is-cur .folder__body', 'FOLDER'),
    geo('[data-folder-new]', 'NEWBTN'),
    `scrollY=${Math.round(window.scrollY)}`,
  ].join('\n');
  box.textContent = [
    `VW=${vw} SCROLLW=${document.documentElement.scrollWidth} BODYW=${document.body.scrollWidth} OVERFLOW=${rows.length}`,
    figInfo,
    folderInfo,
    renInfo,
    geomInfo,
    ...rows.slice(0, 8).map((r) => `+${r.over} <${r.tag}> class="${r.cls}" w=${r.w} l=${r.l} r=${r.r}`),
    `CANVAS total=${canvases.length} 比例不符=${mismatched.length}`,
  ].join('\n');
  document.body.appendChild(box);
  console.log('[layout-probe]', box.textContent);
}

boot();
