import * as THREE from 'three';
import { mulberry32 } from './noise.js';

// ---- テクスチャの登録とアトラス生成 ----
// ブロックごとのテクスチャは名前で登録し、最初に使うときに 1 枚のアトラスへまとめて描く。
// 描画はすべて手続き的 (ドット絵風) で、外部の画像ファイルは使わない。

export const TILE_PX = 16;
const painters = new Map(); // name -> (tile) => void
let atlas = null;

export function defTex(name, painter) {
  if (atlas) throw new Error(`atlas already built: ${name}`);
  if (!painters.has(name)) painters.set(name, painter);
  return name;
}

export function hasTex(name) {
  return painters.has(name);
}

// ---- 色のユーティリティ ----
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
export const toInt = (r, g, b) => (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
export const rgbOf = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
export function mix(a, b, t) {
  const [r1, g1, b1] = rgbOf(a);
  const [r2, g2, b2] = rgbOf(b);
  return toInt(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
// f > 0 で明るく、f < 0 で暗く
export function shade(c, f) {
  return f >= 0 ? mix(c, 0xffffff, f) : mix(c, 0x000000, -f);
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// 1 タイル分の描画先
export class Tile {
  constructor(buf, stride, ox, oy, rand) {
    this.buf = buf;
    this.stride = stride;
    this.ox = ox;
    this.oy = oy;
    this.rand = rand;
  }

  r(n = 16) {
    return Math.floor(this.rand() * n);
  }

  jit(c, v) {
    if (!v) return c;
    const d = (this.rand() - 0.5) * 2 * v;
    const [r, g, b] = rgbOf(c);
    return toInt(r + d, g + d, b + d);
  }

  px(x, y, c, a = 255) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x > 15 || y > 15) return;
    const i = ((this.oy + y) * this.stride + this.ox + x) * 4;
    this.buf[i] = (c >> 16) & 255;
    this.buf[i + 1] = (c >> 8) & 255;
    this.buf[i + 2] = c & 255;
    this.buf[i + 3] = a;
  }

  get(x, y) {
    const i = ((this.oy + y) * this.stride + this.ox + x) * 4;
    return this.buf[i + 3] === 0 ? null : (this.buf[i] << 16) | (this.buf[i + 1] << 8) | this.buf[i + 2];
  }

  erase(x, y) {
    if (x < 0 || y < 0 || x > 15 || y > 15) return;
    const i = ((this.oy + y) * this.stride + this.ox + x) * 4;
    this.buf[i + 3] = 0;
  }

  clear() {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) this.erase(x, y);
  }

  fill(c, v = 0, a = 255) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) this.px(x, y, this.jit(c, v), a);
  }

  rect(x0, y0, w, h, c, v = 0, a = 255) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.px(x, y, this.jit(c, v), a);
  }

  border(c, v = 0, inset = 0) {
    const a = inset, b = 15 - inset;
    for (let i = a; i <= b; i++) {
      this.px(i, a, this.jit(c, v)); this.px(i, b, this.jit(c, v));
      this.px(a, i, this.jit(c, v)); this.px(b, i, this.jit(c, v));
    }
  }

  // 既存の色を少し明るく / 暗くする
  tint(x, y, f) {
    const c = this.get(x, y);
    if (c !== null) this.px(x, y, shade(c, f));
  }

  specks(c, n, v = 8) {
    for (let i = 0; i < n; i++) this.px(this.r(), this.r(), this.jit(c, v));
  }
}

// ---- よく使う描画パターン ----
export const P = {
  noise: (c, v = 14) => (t) => t.fill(c, v),

  speckle: (c, v, spot, n) => (t) => { t.fill(c, v); t.specks(spot, n); },

  mottled: (c, c2, n = 50, v = 10) => (t) => {
    t.fill(c, v);
    for (let i = 0; i < n; i++) {
      const x = t.r(), y = t.r();
      t.px(x, y, t.jit(c2, v));
      if (t.rand() < 0.5) t.px(x + 1, y, t.jit(c2, v));
    }
  },

  planks: (c) => (t) => {
    t.fill(c, 7);
    const d = shade(c, -0.32), g = shade(c, -0.14);
    for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x++) t.px(x, y + 3, t.jit(d, 4));
    const seams = [[0, 11], [4, 3], [8, 13], [12, 6]];
    for (const [y0, sx] of seams) for (let dy = 0; dy < 3; dy++) t.px(sx, y0 + dy, d);
    for (let i = 0; i < 12; i++) { const y = t.r(); if (y % 4 !== 3) t.px(t.r(), y, g); }
  },

  logSide: (bark) => (t) => {
    t.fill(bark, 10);
    const d = shade(bark, -0.28), l = shade(bark, 0.1);
    for (let x = 0; x < 16; x++) {
      const kind = x % 4 === 0 ? d : x % 4 === 2 ? l : null;
      if (!kind) continue;
      for (let y = 0; y < 16; y++) if (t.rand() < 0.8) t.px(x, y, t.jit(kind, 6));
    }
  },

  birchSide: (t) => {
    t.fill(0xe3dfd2, 6);
    for (let i = 0; i < 9; i++) {
      const x = t.r(14), y = t.r();
      const len = 2 + t.r(3);
      for (let k = 0; k < len; k++) t.px(x + k, y, t.jit(0x2c2a26, 8));
    }
    for (let i = 0; i < 6; i++) t.px(t.r(), t.r(), 0xb8b2a4);
  },

  logTop: (bark, inner) => (t) => {
    t.fill(inner, 6);
    const ring = shade(inner, -0.2);
    for (const r of [2, 5]) {
      for (let i = r; i <= 15 - r; i++) {
        t.px(i, r, ring); t.px(i, 15 - r, ring); t.px(r, i, ring); t.px(15 - r, i, ring);
      }
    }
    t.border(bark, 8);
  },

  stripped: (c) => (t) => {
    t.fill(c, 6);
    const d = shade(c, -0.12);
    for (let x = 1; x < 16; x += 3) for (let y = 0; y < 16; y++) if (t.rand() < 0.6) t.px(x, y, d);
  },

  bricks: (brick, mortar) => (t) => {
    t.fill(brick, 12);
    for (let y = 0; y < 16; y += 4) {
      for (let x = 0; x < 16; x++) t.px(x, y + 3, t.jit(mortar, 6));
      const off = (y / 4) % 2 === 0 ? 0 : 4;
      for (let x = off; x < 16; x += 8) for (let dy = 0; dy < 3; dy++) t.px(x, y + dy, t.jit(mortar, 6));
      for (let x = 0; x < 16; x++) if (t.rand() < 0.3) t.tint(x, y, 0.1);
    }
  },

  stoneBricks: (c) => (t) => {
    t.fill(c, 7);
    const d = shade(c, -0.35), l = shade(c, 0.12);
    for (let y = 0; y < 16; y += 8) {
      for (let x = 0; x < 16; x++) { t.px(x, y + 7, d); t.px(x, y, l); }
      const off = (y / 8) % 2 === 0 ? 0 : 8;
      for (let dy = 0; dy < 8; dy++) { t.px(off, y + dy, d); t.px((off + 15) % 16, y + dy, shade(c, -0.15)); }
    }
  },

  tilePattern: (c, size = 4) => (t) => {
    t.fill(c, 6);
    const d = shade(c, -0.35), l = shade(c, 0.1);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (x % size === size - 1 || y % size === size - 1) t.px(x, y, t.jit(d, 4));
      else if (x % size === 0 || y % size === 0) t.px(x, y, t.jit(l, 4));
    }
  },

  polished: (c) => (t) => {
    t.fill(c, 4);
    const l = shade(c, 0.15), d = shade(c, -0.22);
    for (let i = 0; i < 16; i++) { t.px(i, 0, l); t.px(0, i, l); t.px(i, 15, d); t.px(15, i, d); }
  },

  chiseled: (c) => (t) => {
    P.polished(c)(t);
    const d = shade(c, -0.3), l = shade(c, 0.15);
    for (let i = 3; i <= 12; i++) { t.px(i, 3, d); t.px(i, 12, l); t.px(3, i, d); t.px(12, i, l); }
    t.rect(6, 6, 4, 4, d);
    t.rect(7, 7, 2, 2, l);
  },

  pillarSide: (c) => (t) => {
    t.fill(c, 4);
    const d = shade(c, -0.18);
    for (let y = 0; y < 16; y++) { t.px(0, y, d); t.px(15, y, d); t.px(5, y, shade(c, -0.08)); t.px(10, y, shade(c, -0.08)); }
  },

  ore: (base, ore, v = 12, clusters = 5) => (t) => {
    t.fill(base, v);
    t.specks(shade(base, -0.18), 10);
    const hi = shade(ore, 0.3), lo = shade(ore, -0.3);
    for (let i = 0; i < clusters; i++) {
      const x = 1 + t.r(12), y = 1 + t.r(12);
      t.px(x, y, ore); t.px(x + 1, y, hi); t.px(x, y + 1, lo); t.px(x + 1, y + 1, ore);
      if (t.rand() < 0.5) t.px(x + 2, y + 1, ore);
    }
  },

  leaves: (c) => (t) => {
    t.clear();
    const d = shade(c, -0.18), l = shade(c, 0.12);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = t.rand();
      if (r < 0.8) t.px(x, y, t.jit(r < 0.3 ? d : r < 0.45 ? l : c, 8));
    }
  },

  glass: (frame = 0xdcf0f4, tint = null, alpha = 90) => (t) => {
    if (tint !== null) t.fill(tint, 4, alpha); else t.clear();
    const fr = tint !== null ? shade(tint, 0.25) : frame;
    t.border(fr, 0);
    const streak = tint !== null ? shade(tint, 0.5) : 0xffffff;
    for (let i = 2; i < 7; i++) t.px(i, 9 - i, streak, tint !== null ? 200 : 255);
    for (let i = 4; i < 11; i++) t.px(i, 13 - i, streak, tint !== null ? 200 : 255);
  },

  wool: (c) => (t) => {
    t.fill(c, 7);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y * 3) % 5 === 0) t.tint(x, y, -0.08);
  },

  concrete: (c) => (t) => t.fill(c, 3),

  powder: (c) => (t) => {
    t.fill(c, 14);
    t.specks(shade(c, 0.3), 25, 6);
    t.specks(shade(c, -0.2), 20, 6);
  },

  terracotta: (c) => (t) => {
    t.fill(c, 6);
    for (let i = 0; i < 30; i++) t.tint(t.r(), t.r(), t.rand() < 0.5 ? -0.08 : 0.06);
  },

  glazed: (c) => (t) => {
    t.fill(c, 4);
    const l = shade(c, 0.4), d = shade(c, -0.35);
    for (let i = 0; i < 16; i++) { t.px(i, i, l); t.px(15 - i, i, d); }
    t.rect(1, 1, 4, 4, d);
    t.rect(2, 2, 2, 2, l);
    t.rect(11, 11, 4, 4, l);
    t.rect(12, 12, 2, 2, d);
    for (let i = 5; i < 11; i++) { t.px(i, 1, l); t.px(1, i, l); t.px(i, 14, d); t.px(14, i, d); }
  },

  // ---- 植物 (交差した 2 枚の板として描く) ----
  flower: (petal, center, stem = 0x3f7f24) => (t) => {
    t.clear();
    for (let y = 8; y < 16; y++) t.px(7, y, stem);
    t.px(6, 12, stem); t.px(5, 11, stem); t.px(8, 11, stem); t.px(9, 10, stem);
    const petals = [[6, 4], [7, 3], [8, 4], [7, 5], [6, 5], [8, 5], [7, 6], [5, 5], [9, 5], [6, 6], [8, 6], [7, 4]];
    for (const [x, y] of petals) t.px(x, y, t.jit(petal, 10));
    t.px(7, 5, center);
  },

  tulip: (petal, stem = 0x3f7f24) => (t) => {
    t.clear();
    for (let y = 8; y < 16; y++) t.px(7, y, stem);
    t.px(6, 11, stem); t.px(5, 10, stem); t.px(8, 12, stem); t.px(9, 11, stem);
    for (let y = 3; y < 8; y++) for (let x = 6; x < 9; x++) t.px(x, y, t.jit(petal, 10));
    t.px(5, 3, petal); t.px(9, 3, petal); t.px(7, 2, shade(petal, 0.2));
  },

  grassPlant: (c) => (t) => {
    t.clear();
    for (let x = 1; x < 15; x++) {
      if (t.rand() < 0.35) continue;
      const h = 5 + t.r(9);
      for (let y = 15; y > 15 - h; y--) t.px(x, y, t.jit(y < 15 - h + 2 ? shade(c, 0.15) : c, 10));
    }
  },

  fern: (c) => (t) => {
    t.clear();
    for (let y = 2; y < 16; y++) t.px(7, y, shade(c, -0.1));
    for (let y = 3; y < 15; y += 2) {
      const w = Math.min(6, 1 + ((y - 2) >> 1));
      for (let k = 1; k <= w; k++) { t.px(7 - k, y + (k >> 2), t.jit(c, 8)); t.px(7 + k, y + (k >> 2), t.jit(c, 8)); }
    }
  },

  sapling: (leaf, trunk) => (t) => {
    t.clear();
    for (let y = 9; y < 16; y++) t.px(7, y, trunk);
    for (let y = 1; y < 10; y++) for (let x = 3; x < 12; x++) {
      const dx = x - 7, dy = y - 5;
      if (dx * dx + dy * dy <= 16 && t.rand() < 0.8) t.px(x, y, t.jit(leaf, 12));
    }
  },

  mushroom: (cap, spots = null, stem = 0xd8d0b8) => (t) => {
    t.clear();
    for (let y = 9; y < 16; y++) { t.px(7, y, stem); t.px(8, y, stem); }
    for (let x = 4; x < 12; x++) for (let y = 5; y < 9; y++) {
      if ((y === 5 && (x < 6 || x > 9))) continue;
      t.px(x, y, t.jit(cap, 8));
    }
    if (spots !== null) { t.px(6, 6, spots); t.px(9, 7, spots); t.px(7, 5, spots); }
  },

  deadBush: (t) => {
    t.clear();
    const c = 0x6b4a26;
    const branches = [[7, 15, 0, -1, 9], [7, 10, -1, -1, 5], [7, 11, 1, -1, 5], [7, 7, -1, -1, 4], [8, 8, 1, -1, 4]];
    for (const [sx, sy, dx, dy, n] of branches) for (let k = 0; k < n; k++) t.px(sx + dx * k, sy + dy * k, t.jit(c, 10));
  },

  sugarCane: (t) => {
    t.clear();
    for (const x of [3, 7, 11]) {
      for (let y = 0; y < 16; y++) t.px(x, y, y % 5 === 0 ? 0x78a84a : t.jit(0x9ad16a, 8));
      for (let y = 0; y < 16; y++) t.px(x + 1, y, t.jit(0x6f9a42, 6));
    }
    t.px(5, 4, 0x6f9a42); t.px(10, 9, 0x6f9a42);
  },

  // ---- ドア・トラップドア・はしご ----
  door: (c, upper, windows = false) => (t) => {
    t.fill(c, 5);
    const d = shade(c, -0.3), l = shade(c, 0.12);
    for (let i = 0; i < 16; i++) { t.px(0, i, d); t.px(15, i, d); }
    if (upper) {
      for (let x = 0; x < 16; x++) t.px(x, 0, d);
      if (windows) {
        for (const [x0, y0] of [[3, 3], [9, 3]]) for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) t.erase(x, y);
      } else {
        t.rect(3, 3, 10, 5, shade(c, -0.12));
        for (let x = 3; x < 13; x++) t.px(x, 3, l);
      }
      t.rect(3, 10, 10, 5, shade(c, -0.12));
    } else {
      for (let x = 0; x < 16; x++) t.px(x, 15, d);
      t.rect(3, 1, 10, 6, shade(c, -0.12));
      t.rect(3, 9, 10, 5, shade(c, -0.12));
      t.px(12, 0, 0x9a9a9a); t.px(12, 1, 0x9a9a9a);
    }
  },

  trapdoor: (c) => (t) => {
    t.fill(c, 5);
    const d = shade(c, -0.3);
    t.border(d);
    for (const [x0, y0] of [[3, 3], [9, 3], [3, 9], [9, 9]]) for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) t.erase(x, y);
  },

  ladder: (c) => (t) => {
    t.clear();
    const d = shade(c, -0.25);
    for (let y = 0; y < 16; y++) { t.px(2, y, c); t.px(3, y, d); t.px(12, y, c); t.px(13, y, d); }
    for (const y of [1, 5, 9, 13]) for (let x = 4; x < 12; x++) { t.px(x, y, c); t.px(x, y + 1, d); }
  },
};

// ---- アトラスの生成 ----
export function buildAtlas() {
  if (atlas) return atlas;
  const names = [...painters.keys()];
  let tiles = 1;
  while (tiles * tiles < names.length) tiles *= 2;
  const size = tiles * TILE_PX;
  const buf = new Uint8ClampedArray(size * size * 4);
  const index = new Map();
  names.forEach((name, i) => {
    index.set(name, i);
    const ox = (i % tiles) * TILE_PX;
    const oy = Math.floor(i / tiles) * TILE_PX;
    const tile = new Tile(buf, size, ox, oy, mulberry32(hash(name)));
    try {
      painters.get(name)(tile);
    } catch (err) {
      console.error('texture failed', name, err);
      tile.fill(0xff00ff);
    }
  });
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(buf, size, size), 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  atlas = { canvas, texture, index, tiles, size };
  return atlas;
}

export function createAtlas() {
  return buildAtlas();
}

export function tileIndex(name) {
  const a = buildAtlas();
  const i = a.index.get(name);
  return i === undefined ? a.index.get('missing') : i;
}

// UV 座標 (タイル番号 → [u0, v0, u1, v1])。CanvasTexture は flipY=true なので v を反転
export function tileUV(tile) {
  const { tiles } = buildAtlas();
  const tx = tile % tiles;
  const ty = Math.floor(tile / tiles);
  const s = 1 / tiles;
  const pad = 0.5 / (tiles * TILE_PX);
  return [tx * s + pad, 1 - (ty + 1) * s + pad, (tx + 1) * s - pad, 1 - ty * s - pad];
}

// タイルの左上ピクセル座標 (アイコン描画用)
export function tileOrigin(tile) {
  const { tiles } = buildAtlas();
  return [(tile % tiles) * TILE_PX, Math.floor(tile / tiles) * TILE_PX];
}

export function drawTileTo(canvas, tileOrName) {
  const a = buildAtlas();
  const tile = typeof tileOrName === 'string' ? tileIndex(tileOrName) : tileOrName;
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const [tx, ty] = tileOrigin(tile);
  ctx.drawImage(a.canvas, tx, ty, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
}

// ブロック破壊のヒビ (10 段階)
let crackCache = null;
export function createCrackTexture() {
  if (crackCache) return crackCache;
  const stages = 10;
  const canvas = document.createElement('canvas');
  canvas.width = TILE_PX * stages;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(99);
  const cracks = [];
  for (let i = 0; i < 14; i++) {
    let x = 8, y = 8;
    const path = [];
    const ang = rand() * Math.PI * 2;
    for (let k = 0; k < 9; k++) {
      path.push([Math.round(x), Math.round(y)]);
      x += Math.cos(ang + (rand() - 0.5) * 1.2) * 1.2;
      y += Math.sin(ang + (rand() - 0.5) * 1.2) * 1.2;
    }
    cracks.push(path);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  for (let s = 0; s < stages; s++) {
    const ox = s * TILE_PX;
    const n = Math.ceil(((s + 1) / stages) * cracks.length);
    const len = 2 + Math.round(((s + 1) / stages) * 7);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < Math.min(len, cracks[i].length); k++) {
        const [x, y] = cracks[i][k];
        if (x >= 0 && x < 16 && y >= 0 && y < 16) ctx.fillRect(ox + x, y, 1, 1);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.repeat.set(1 / stages, 1);
  crackCache = { texture, stages };
  return crackCache;
}

defTex('missing', (t) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.px(x, y, ((x >> 3) + (y >> 3)) % 2 ? 0xff00ff : 0x000000);
});
