import * as THREE from 'three';
import { mulberry32 } from './noise.js';

export const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  LOG: 5,
  LEAVES: 6,
  PLANKS: 7,
  COBBLE: 8,
  GLASS: 9,
  WATER: 10,
  BRICK: 11,
  BEDROCK: 12,
  SNOW: 13,
  GRAVEL: 14,
};

// アトラス内のタイル番号 (4x4)
const T = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3,
  SAND: 4, LOG_SIDE: 5, LOG_TOP: 6, LEAVES: 7,
  PLANKS: 8, COBBLE: 9, GLASS: 10, WATER: 11,
  BRICK: 12, BEDROCK: 13, SNOW: 14, GRAVEL: 15,
};

export const ATLAS_TILES = 4;
export const TILE_PX = 16;

// ブロック定義
//  tiles: [top, bottom, side]
//  opaque: 不透明 (面カリング・AO の判定に使う)
//  solid: 当たり判定あり
//  layer: 'opaque' | 'cutout' | 'water'
export const BLOCKS = {
  [BLOCK.AIR]:     { name: '空気', tiles: null, opaque: false, solid: false, layer: null },
  [BLOCK.GRASS]:   { name: '草ブロック', tiles: [T.GRASS_TOP, T.DIRT, T.GRASS_SIDE], opaque: true, solid: true, layer: 'opaque' },
  [BLOCK.DIRT]:    { name: '土', tiles: [T.DIRT, T.DIRT, T.DIRT], opaque: true, solid: true, layer: 'opaque' },
  [BLOCK.STONE]:   { name: '石', tiles: [T.STONE, T.STONE, T.STONE], opaque: true, solid: true, layer: 'opaque' },
  [BLOCK.SAND]:    { name: '砂', tiles: [T.SAND, T.SAND, T.SAND], opaque: true, solid: true, layer: 'opaque' },
  [BLOCK.LOG]:     { name: '原木', tiles: [T.LOG_TOP, T.LOG_TOP, T.LOG_SIDE], opaque: true, solid: true, layer: 'opaque' },
  [BLOCK.LEAVES]:  { name: '葉', tiles: [T.LEAVES, T.LEAVES, T.LEAVES], opaque: false, solid: true, layer: 'cutout' },
  [BLOCK.PLANKS]:  { name: '木材', tiles: [T.PLANKS, T.PLANKS, T.PLANKS], opaque: true, solid: true, layer: 'opaque' },
  [BLOCK.COBBLE]:  { name: '丸石', tiles: [T.COBBLE, T.COBBLE, T.COBBLE], opaque: true, solid: true, layer: 'opaque' },
  [BLOCK.GLASS]:   { name: 'ガラス', tiles: [T.GLASS, T.GLASS, T.GLASS], opaque: false, solid: true, layer: 'cutout' },
  [BLOCK.WATER]:   { name: '水', tiles: [T.WATER, T.WATER, T.WATER], opaque: false, solid: false, layer: 'water' },
  [BLOCK.BRICK]:   { name: 'レンガ', tiles: [T.BRICK, T.BRICK, T.BRICK], opaque: true, solid: true, layer: 'opaque' },
  [BLOCK.BEDROCK]: { name: '岩盤', tiles: [T.BEDROCK, T.BEDROCK, T.BEDROCK], opaque: true, solid: true, layer: 'opaque', unbreakable: true },
  [BLOCK.SNOW]:    { name: '雪', tiles: [T.SNOW, T.DIRT, T.SNOW], opaque: true, solid: true, layer: 'opaque' },
  [BLOCK.GRAVEL]:  { name: '砂利', tiles: [T.GRAVEL, T.GRAVEL, T.GRAVEL], opaque: true, solid: true, layer: 'opaque' },
};

// ホットバーに並ぶブロック (9 個)
export const HOTBAR_BLOCKS = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLE, BLOCK.PLANKS,
  BLOCK.LOG, BLOCK.LEAVES, BLOCK.GLASS, BLOCK.BRICK,
];

export function isOpaque(id) {
  return BLOCKS[id]?.opaque ?? false;
}

export function isSolid(id) {
  return BLOCKS[id]?.solid ?? false;
}

// ---- テクスチャアトラスを Canvas で生成 (ドット絵風) ----

function hexToRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function clamp(v) {
  return Math.max(0, Math.min(255, v | 0));
}

// 各ピクセルに ±variance のノイズを乗せてベタ塗り
function noisyFill(ctx, ox, oy, base, variance, rand, alpha = 1) {
  const [r, g, b] = hexToRgb(base);
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const d = (rand() - 0.5) * 2 * variance;
      ctx.fillStyle = `rgba(${clamp(r + d)},${clamp(g + d)},${clamp(b + d)},${alpha})`;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

function px(ctx, ox, oy, x, y, color, alpha = 1) {
  const [r, g, b] = hexToRgb(color);
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
  ctx.fillRect(ox + x, oy + y, 1, 1);
}

const TILE_PAINTERS = {
  [T.GRASS_TOP](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x5fa832, 22, rand);
  },
  [T.GRASS_SIDE](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x7f5a36, 18, rand);
    for (let x = 0; x < TILE_PX; x++) {
      const depth = 2 + Math.floor(rand() * 3);
      for (let y = 0; y < depth; y++) px(ctx, ox, oy, x, y, rand() < 0.8 ? 0x5fa832 : 0x4e9128);
    }
  },
  [T.DIRT](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x7f5a36, 20, rand);
  },
  [T.STONE](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x8a8a8a, 14, rand);
    for (let i = 0; i < 6; i++) px(ctx, ox, oy, Math.floor(rand() * 16), Math.floor(rand() * 16), 0x6e6e6e);
  },
  [T.SAND](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0xdbcf98, 14, rand);
  },
  [T.LOG_SIDE](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x6b4a26, 12, rand);
    for (let x = 0; x < TILE_PX; x += 3) {
      for (let y = 0; y < TILE_PX; y++) if (rand() < 0.7) px(ctx, ox, oy, x, y, 0x4f3519);
    }
  },
  [T.LOG_TOP](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x6b4a26, 10, rand);
    for (let r = 2; r < 8; r += 2) {
      for (let a = 0; a < 40; a++) {
        const t = (a / 40) * Math.PI * 2;
        px(ctx, ox, oy, Math.floor(8 + Math.cos(t) * r), Math.floor(8 + Math.sin(t) * r), 0xc7a266);
      }
    }
  },
  [T.LEAVES](ctx, ox, oy, rand) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        if (rand() < 0.82) px(ctx, ox, oy, x, y, rand() < 0.5 ? 0x3d8a2a : 0x2f7320);
      }
    }
  },
  [T.PLANKS](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0xb8905a, 12, rand);
    for (let y = 0; y < TILE_PX; y += 4) {
      for (let x = 0; x < TILE_PX; x++) px(ctx, ox, oy, x, y, 0x7d5a30);
    }
    px(ctx, ox, oy, 3, 1, 0x7d5a30); px(ctx, ox, oy, 3, 2, 0x7d5a30);
    px(ctx, ox, oy, 11, 5, 0x7d5a30); px(ctx, ox, oy, 11, 6, 0x7d5a30);
    px(ctx, ox, oy, 6, 9, 0x7d5a30); px(ctx, ox, oy, 6, 10, 0x7d5a30);
    px(ctx, ox, oy, 13, 13, 0x7d5a30); px(ctx, ox, oy, 13, 14, 0x7d5a30);
  },
  [T.COBBLE](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x7b7b7b, 26, rand);
    for (let i = 0; i < 5; i++) {
      const cx = Math.floor(rand() * 14);
      const cy = Math.floor(rand() * 14);
      for (let dx = 0; dx < 3; dx++) px(ctx, ox, oy, cx + dx, cy, 0x4d4d4d);
      for (let dy = 0; dy < 3; dy++) px(ctx, ox, oy, cx, cy + dy, 0x4d4d4d);
    }
  },
  [T.GLASS](ctx, ox, oy, rand) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    for (let i = 0; i < TILE_PX; i++) {
      px(ctx, ox, oy, i, 0, 0xd8f4f8); px(ctx, ox, oy, i, 15, 0xd8f4f8);
      px(ctx, ox, oy, 0, i, 0xd8f4f8); px(ctx, ox, oy, 15, i, 0xd8f4f8);
    }
    for (let i = 2; i < 7; i++) px(ctx, ox, oy, i, 9 - i, 0xffffff);
    for (let i = 4; i < 11; i++) px(ctx, ox, oy, i, 13 - i, 0xffffff);
    void rand;
  },
  [T.WATER](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x2d6fd8, 18, rand);
  },
  [T.BRICK](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0xa8503c, 14, rand);
    for (let y = 0; y < TILE_PX; y += 4) {
      for (let x = 0; x < TILE_PX; x++) px(ctx, ox, oy, x, y, 0xd7c9b8);
      const off = (y / 4) % 2 === 0 ? 0 : 4;
      for (let x = off; x < TILE_PX; x += 8) for (let dy = 1; dy < 4; dy++) px(ctx, ox, oy, x, y + dy, 0xd7c9b8);
    }
  },
  [T.BEDROCK](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x3a3a3a, 34, rand);
  },
  [T.SNOW](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0xf4f8fb, 6, rand);
  },
  [T.GRAVEL](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x8c8478, 30, rand);
  },
};

let atlasCache = null;

export function createAtlas() {
  if (atlasCache) return atlasCache;
  const size = ATLAS_TILES * TILE_PX;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(1234);
  for (let i = 0; i < ATLAS_TILES * ATLAS_TILES; i++) {
    const ox = (i % ATLAS_TILES) * TILE_PX;
    const oy = Math.floor(i / ATLAS_TILES) * TILE_PX;
    TILE_PAINTERS[i]?.(ctx, ox, oy, rand);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  atlasCache = { canvas, texture };
  return atlasCache;
}

// UV 座標 (タイル番号 → [u0, v0, u1, v1])。CanvasTexture は flipY=true なので v を反転。
export function tileUV(tile) {
  const tx = tile % ATLAS_TILES;
  const ty = Math.floor(tile / ATLAS_TILES);
  const s = 1 / ATLAS_TILES;
  // ピクセルの境界で隣のタイルがにじまないよう、わずかに内側へ寄せる
  const pad = 0.5 / (ATLAS_TILES * TILE_PX);
  return [tx * s + pad, 1 - (ty + 1) * s + pad, (tx + 1) * s - pad, 1 - ty * s - pad];
}

// ホットバー用: タイルを別の Canvas に描き出す
export function drawTileTo(canvas, tile) {
  const { canvas: atlas } = createAtlas();
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const tx = (tile % ATLAS_TILES) * TILE_PX;
  const ty = Math.floor(tile / ATLAS_TILES) * TILE_PX;
  ctx.drawImage(atlas, tx, ty, TILE_PX, TILE_PX, 0, 0, TILE_PX, TILE_PX);
}
