/**
 * 图形母题生成器
 * 为每一则风格条目输出确定性的抽象图形：同一 id 永远得到同一张图。
 * 用途：在没有授权实拍图时不留下空洞版面；图像由该风格的形式规则（网格/圆弧/斜切/渐变…）驱动。
 */

const KINDS = ['grid', 'bars', 'orbit', 'arcs', 'scribble', 'glow', 'blob', 'glass', 'stack', 'lines', 'wash', 'block'];

/** 调色板：深墨 + 三色，取自各风格常见的印刷/屏幕用色 */
const PALETTES = {
  ink:     { bg: '#f4f1ea', ink: '#14131a', palette: ['#c8452a', '#1b1b21', '#e0d7c4'], accent: '#c8452a' },
  primary: { bg: '#f5f2ec', ink: '#1a1a1e', palette: ['#d0342c', '#1f4fa8', '#e8b71d'], accent: '#1f4fa8' },
  paper:   { bg: '#f7f6f3', ink: '#22222a', palette: ['#22222a', '#c6c1b6', '#8d8880'], accent: '#22222a' },
  cold:    { bg: '#eef1f4', ink: '#131820', palette: ['#131820', '#c9d3dd', '#4a6b8a'], accent: '#4a6b8a' },
  concrete:{ bg: '#e8e6e1', ink: '#33322e', palette: ['#33322e', '#6f6b62', '#b9b4a8'], accent: '#6f6b62' },
  candy:   { bg: '#fdf3e7', ink: '#1d1b2e', palette: ['#f04e6c', '#f7c948', '#2ec4b6'], accent: '#f04e6c' },
  neon:    { bg: '#0e0c18', ink: '#f2e9ff', palette: ['#ff2e88', '#00e5ff', '#7b2ff7'], accent: '#00e5ff' },
  vapor:   { bg: '#1a1030', ink: '#ffd9f0', palette: ['#ff77c8', '#5ce1e6', '#8a5cf6'], accent: '#5ce1e6' },
  tech:    { bg: '#0b1220', ink: '#9ef7d8', palette: ['#0b1220', '#1b3a4b', '#39ff88'], accent: '#39ff88' },
  glass:   { bg: '#dfe7f5', ink: '#16233a', palette: ['#8fb2ff', '#c9a7ff', '#5ed3e8'], accent: '#ffffff' },
  clay:    { bg: '#efe4f7', ink: '#3a2b52', palette: ['#b79bff', '#ffb4a2', '#8ad6c8'], accent: '#ffffff' },
  aero:    { bg: '#e9f7ff', ink: '#12435e', palette: ['#39c4f0', '#8fe36b', '#f7e04e'], accent: '#ffffff' },
  japandi: { bg: '#f1ece2', ink: '#2c2a24', palette: ['#2c2a24', '#a89a82', '#c9c2b2'], accent: '#a89a82' },
  mcm:     { bg: '#f2efe4', ink: '#2c3026', palette: ['#c1662f', '#3f6b4f', '#d9b23c'], accent: '#c1662f' },
  deco:    { bg: '#12100f', ink: '#e8c86a', palette: ['#e8c86a', '#0f3d3e', '#c9a227'], accent: '#e8c86a' },
  wabi:    { bg: '#efeae0', ink: '#33302a', palette: ['#33302a', '#8d8271', '#b8ac97'], accent: '#8d8271' },
  cinnabar:{ bg: '#f6f1e6', ink: '#1f1b17', palette: ['#9e2b25', '#2f3b33', '#c8b28a'], accent: '#9e2b25' },
  rouge:   { bg: '#fbf1ec', ink: '#22201e', palette: ['#d63a2f', '#1f6f6b', '#f0c04a'], accent: '#d63a2f' },

  /* 经典流派与数字美学的专属配色 */
  bauhaus:    { bg: '#f2eee4', ink: '#1a1a1c', palette: ['#d8352a', '#1c4fa1', '#f0c020'], accent: '#d8352a' },
  destijl:    { bg: '#f6f4ee', ink: '#17171a', palette: ['#d2232a', '#1d4f9c', '#f2c500'], accent: '#d2232a' },
  construct:  { bg: '#efe9dd', ink: '#16161a', palette: ['#cf2b1f', '#16161a', '#d8cdb6'], accent: '#cf2b1f' },
  swiss:      { bg: '#f4f4f2', ink: '#191919', palette: ['#191919', '#d0021b', '#c8c8c4'], accent: '#d0021b' },
  minimal:    { bg: '#f7f6f4', ink: '#1e1e1e', palette: ['#1e1e1e', '#d4cfc6', '#9a958c'], accent: '#1e1e1e' },
  brutalist:  { bg: '#e6e3dc', ink: '#2b2a26', palette: ['#2b2a26', '#77726a', '#c2bcae'], accent: '#77726a' },
  popart:     { bg: '#fdf6e3', ink: '#141414', palette: ['#f02d5a', '#ffd400', '#00a3e0'], accent: '#f02d5a' },
  memphis:    { bg: '#fbf5e9', ink: '#1a1a2e', palette: ['#ee4266', '#0ead69', '#3d5a80', '#ffd23f'], accent: '#ee4266' },
  pomo:       { bg: '#f3ece2', ink: '#22203a', palette: ['#c86b85', '#4a8f8b', '#d9a441'], accent: '#c86b85' },
  decon:      { bg: '#eceae6', ink: '#1c1c22', palette: ['#1c1c22', '#8a8f98', '#b6564b'], accent: '#b6564b' },
  maximal:    { bg: '#241a2c', ink: '#ffe9c9', palette: ['#ff5f6d', '#ffc371', '#4ecdc4'], accent: '#ffc371' },
  y2k:        { bg: '#eaf3ff', ink: '#14203a', palette: ['#4d7cff', '#b8c6ff', '#d9e4ff'], accent: '#8fa8ff' },
  neubrut:    { bg: '#fdf3b8', ink: '#101010', palette: ['#ff5c39', '#3b5bfd', '#fdf3b8'], accent: '#101010' },
  guochao:    { bg: '#f9ece4', ink: '#1e1a24', palette: ['#d8372c', '#1f5f5b', '#e8b345'], accent: '#d8372c' },

  /* 数字媒体艺术案例的专属配色：取自各作品最具代表性的视觉气质 */
  'rain-room':   { bg: '#0d1218', ink: '#cfe0ea', palette: ['#5a9bc9', '#1d2c3a', '#9fc4d8'], accent: '#5a9bc9' },
  'pulse-room':  { bg: '#f5efe4', ink: '#3a2a1a', palette: ['#e8b04a', '#c97a2a', '#4a3a26'], accent: '#e8b04a' },
  microphones:   { bg: '#1a1c20', ink: '#d8d2c4', palette: ['#b8b2a4', '#6a6456', '#8a8474'], accent: '#b8b2a4' },
  teamlab:       { bg: '#0e0c1e', ink: '#e8d8ff', palette: ['#b46ae0', '#5ad0d8', '#e86a9a'], accent: '#b46ae0' },
  'chris-milk':  { bg: '#f0f4f6', ink: '#1e3a44', palette: ['#2a9db5', '#4ab56a', '#f0c04a'], accent: '#2a9db5' },
  daito:         { bg: '#0b1220', ink: '#9ef7d8', palette: ['#39ff88', '#1b3a4b', '#0b1220'], accent: '#39ff88' },
  anadol:        { bg: '#0a1020', ink: '#9ad0e8', palette: ['#2a8ab5', '#e06aa8', '#5a5ad0'], accent: '#2a8ab5' },
  hivemind:      { bg: '#101418', ink: '#a8e8d8', palette: ['#3ab5a0', '#1a5a4a', '#d8c04a'], accent: '#3ab5a0' },
  metaphor:      { bg: '#f6efe6', ink: '#4a2a3a', palette: ['#c05a7a', '#e8a8b8', '#3a2a4a'], accent: '#c05a7a' },
  frequency:     { bg: '#141824', ink: '#9ab0e8', palette: ['#3a5ad0', '#e8a83a', '#2a3a6a'], accent: '#3a5ad0' },
  steyerl:       { bg: '#e8e4da', ink: '#2a2a24', palette: ['#c9a83a', '#5a5a4a', '#d8d2c4'], accent: '#c9a83a' },
  'gfp-bunny':   { bg: '#f2f8f4', ink: '#1a3a2a', palette: ['#3ae87a', '#1a8a4a', '#d8f0e0'], accent: '#3ae87a' },
  'plant-growing': { bg: '#f0f6ee', ink: '#2a3a26', palette: ['#5aaa4a', '#a8d888', '#3a6a2a'], accent: '#5aaa4a' },
  landscape:     { bg: '#14161a', ink: '#c8c4b8', palette: ['#8a8578', '#4a4640', '#c9b08a'], accent: '#c9b08a' },
  'evolving-syntax': { bg: '#f2eee8', ink: '#3a3832', palette: ['#8a8f98', '#b6b0a4', '#5a5a52'], accent: '#8a8f98' },
  'organic-elements': { bg: '#eef4f0', ink: '#1a3a32', palette: ['#4ab5a0', '#a0d8c8', '#2a6a5a'], accent: '#4ab5a0' },
  meshrare:      { bg: '#eceef0', ink: '#2a2e32', palette: ['#7a828a', '#b8bcc0', '#4a5258'], accent: '#7a828a' },
  crosssections: { bg: '#101014', ink: '#e8d8a8', palette: ['#e8c86a', '#3a3a20', '#a89a4a'], accent: '#e8c86a' },
};

/** 每个风格条目可以直接指定 motif；未指定则按 id 散列分配 */
const STYLE_HINTS = {
  bauhaus:        { kind: 'grid',     palette: 'bauhaus' },
  'de-stijl':     { kind: 'grid',     palette: 'destijl' },
  constructivism: { kind: 'bars',     palette: 'construct' },
  'swiss-style':  { kind: 'lines',    palette: 'swiss' },
  minimalism:     { kind: 'block',    palette: 'minimal' },
  brutalism:      { kind: 'stack',    palette: 'brutalist' },
  'pop-art':      { kind: 'bars',     palette: 'popart' },
  memphis:        { kind: 'scribble', palette: 'memphis' },
  'postmodern-design': { kind: 'arcs', palette: 'pomo' },
  deconstructivism: { kind: 'stack',  palette: 'decon' },
  maximalism:     { kind: 'blob',     palette: 'maximal' },
  y2k:            { kind: 'glass',    palette: 'y2k' },
  vaporwave:      { kind: 'glow',     palette: 'vapor' },
  cyberpunk:      { kind: 'glow',     palette: 'neon' },
  glassmorphism:  { kind: 'glass',    palette: 'glass' },
  neubrutalism:   { kind: 'block',    palette: 'neubrut' },
  claymorphism:   { kind: 'blob',     palette: 'clay' },
  'frutiger-aero':{ kind: 'glass',    palette: 'aero' },
  scandinavian:   { kind: 'lines',    palette: 'japandi' },
  'mid-century':  { kind: 'orbit',    palette: 'mcm' },
  'art-deco':     { kind: 'bars',     palette: 'deco' },
  'wabi-sabi':    { kind: 'wash',     palette: 'wabi' },
  'chinese-classical': { kind: 'wash', palette: 'cinnabar' },
  guochao:        { kind: 'arcs',     palette: 'rouge' },

  /* 数字媒体艺术案例条目 */
  'rain-room':   { kind: 'lines', palette: 'rain-room' },
  'pulse-room':  { kind: 'glow',  palette: 'pulse-room' },
  microphones:   { kind: 'bars',  palette: 'microphones' },
  teamlab:       { kind: 'glow',  palette: 'teamlab' },
  'chris-milk':  { kind: 'wash',  palette: 'chris-milk' },
  daito:         { kind: 'lines', palette: 'daito' },
  anadol:        { kind: 'glow',  palette: 'anadol' },
  hivemind:      { kind: 'orbit', palette: 'hivemind' },
  metaphor:      { kind: 'arcs',  palette: 'metaphor' },
  frequency:     { kind: 'lines', palette: 'frequency' },
  steyerl:       { kind: 'grid',  palette: 'steyerl' },
  'gfp-bunny':   { kind: 'blob',  palette: 'gfp-bunny' },
  'plant-growing': { kind: 'arcs', palette: 'plant-growing' },
  landscape:     { kind: 'orbit', palette: 'landscape' },
  'evolving-syntax': { kind: 'block', palette: 'evolving-syntax' },
  'organic-elements': { kind: 'blob', palette: 'organic-elements' },
  meshrare:      { kind: 'grid',  palette: 'meshrare' },
  crosssections: { kind: 'glass', palette: 'crosssections' },
};

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * 同一风格的「变体」：换一种母题构图，用于悬停时图像发生变化。
 * 变体通过改变种子与母题种类得到，配色保持不变，因此仍然是同一种风格的表达。
 */
export function motifVariant(id, variant = 1) {
  const base = motif(id);
  if (!variant) return base;
  const key = `${id}#${variant}`;
  const h = hash(key);
  const candidates = KINDS.filter((k) => k !== base.kind);
  return {
    ...base,
    seed: key,
    kind: candidates[h % candidates.length],
  };
}

export function motif(id) {
  const key = String(id || 'x');
  const h = hash(key);
  const hint = STYLE_HINTS[key] || {};
  const kind = hint.kind || KINDS[h % KINDS.length];
  const paletteName = hint.palette || Object.keys(PALETTES)[h % Object.keys(PALETTES).length];
  const p = PALETTES[paletteName] || PALETTES.ink;
  return {
    seed: key,
    kind,
    bg: p.bg,
    ink: p.ink,
    palette: p.palette,
    accent: p.accent,
  };
}

export const MOTIF_KINDS = KINDS;
