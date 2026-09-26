import * as THREE from 'three';
import { mulberry32 } from './noise.js';

export const BLOCK = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, PLANKS: 7,
  COBBLE: 8, GLASS: 9, WATER: 10, BRICK: 11, BEDROCK: 12, SNOW: 13, GRAVEL: 14,
  TORCH: 15, CRAFTING_TABLE: 16, FURNACE: 17, COAL_ORE: 18, IRON_ORE: 19, WOOL: 20,
};

// アトラス内のタイル番号 (8x8)
export const T = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4, LOG_SIDE: 5, LOG_TOP: 6, LEAVES: 7,
  PLANKS: 8, COBBLE: 9, GLASS: 10, WATER: 11, BRICK: 12, BEDROCK: 13, SNOW: 14, GRAVEL: 15,
  TORCH: 16, CRAFT_TOP: 17, CRAFT_SIDE: 18, CRAFT_FRONT: 19, FURNACE_TOP: 20, FURNACE_SIDE: 21,
  FURNACE_FRONT: 22, COAL_ORE: 23, IRON_ORE: 24, WOOL: 25,
};

export const ATLAS_TILES = 8;
export const TILE_PX = 16;

// ブロック定義
//  item: インベントリ上のアイテム ID
//  tiles: [top, bottom, side, front?]
//  opaque: 不透明 (面カリング・光の遮蔽に使う)   solid: 当たり判定あり
//  layer: 'opaque' | 'cutout' | 'water'   model: 'cube' | 'torch'
//  hardness: 破壊の基準時間 (秒)   tool: 適正道具   minTier: ドロップに必要な道具の段階 (-1: 不要)
//  drop: 壊したときに落ちるアイテム (null: なし)   light: 発光レベル (0-15)
export const BLOCKS = {
  [BLOCK.AIR]: { name: '空気', item: null, tiles: null, opaque: false, solid: false, layer: null, hardness: 0 },
  [BLOCK.GRASS]: { name: '草ブロック', item: 'grass_block', tiles: [T.GRASS_TOP, T.DIRT, T.GRASS_SIDE], opaque: true, solid: true, layer: 'opaque', hardness: 0.6, tool: 'shovel', minTier: -1, drop: 'dirt' },
  [BLOCK.DIRT]: { name: '土', item: 'dirt', tiles: [T.DIRT, T.DIRT, T.DIRT], opaque: true, solid: true, layer: 'opaque', hardness: 0.5, tool: 'shovel', minTier: -1, drop: 'dirt' },
  [BLOCK.STONE]: { name: '石', item: 'stone', tiles: [T.STONE, T.STONE, T.STONE], opaque: true, solid: true, layer: 'opaque', hardness: 1.5, tool: 'pickaxe', minTier: 0, drop: 'cobblestone' },
  [BLOCK.SAND]: { name: '砂', item: 'sand', tiles: [T.SAND, T.SAND, T.SAND], opaque: true, solid: true, layer: 'opaque', hardness: 0.5, tool: 'shovel', minTier: -1, drop: 'sand' },
  [BLOCK.LOG]: { name: 'オークの原木', item: 'log', tiles: [T.LOG_TOP, T.LOG_TOP, T.LOG_SIDE], opaque: true, solid: true, layer: 'opaque', hardness: 2, tool: 'axe', minTier: -1, drop: 'log' },
  [BLOCK.LEAVES]: { name: 'オークの葉', item: 'leaves', tiles: [T.LEAVES, T.LEAVES, T.LEAVES], opaque: false, solid: true, layer: 'cutout', hardness: 0.2, tool: null, minTier: -1, drop: null, dropChance: { apple: 0.05 } },
  [BLOCK.PLANKS]: { name: 'オークの木材', item: 'planks', tiles: [T.PLANKS, T.PLANKS, T.PLANKS], opaque: true, solid: true, layer: 'opaque', hardness: 2, tool: 'axe', minTier: -1, drop: 'planks' },
  [BLOCK.COBBLE]: { name: '丸石', item: 'cobblestone', tiles: [T.COBBLE, T.COBBLE, T.COBBLE], opaque: true, solid: true, layer: 'opaque', hardness: 2, tool: 'pickaxe', minTier: 0, drop: 'cobblestone' },
  [BLOCK.GLASS]: { name: 'ガラス', item: 'glass', tiles: [T.GLASS, T.GLASS, T.GLASS], opaque: false, solid: true, layer: 'cutout', hardness: 0.3, tool: null, minTier: -1, drop: null },
  [BLOCK.WATER]: { name: '水', item: null, tiles: [T.WATER, T.WATER, T.WATER], opaque: false, solid: false, layer: 'water', hardness: 0, unbreakable: true },
  [BLOCK.BRICK]: { name: 'レンガ', item: 'bricks', tiles: [T.BRICK, T.BRICK, T.BRICK], opaque: true, solid: true, layer: 'opaque', hardness: 2, tool: 'pickaxe', minTier: 0, drop: 'bricks' },
  [BLOCK.BEDROCK]: { name: '岩盤', item: 'bedrock', tiles: [T.BEDROCK, T.BEDROCK, T.BEDROCK], opaque: true, solid: true, layer: 'opaque', hardness: -1, unbreakable: true },
  [BLOCK.SNOW]: { name: '雪ブロック', item: 'snow', tiles: [T.SNOW, T.SNOW, T.SNOW], opaque: true, solid: true, layer: 'opaque', hardness: 0.2, tool: 'shovel', minTier: -1, drop: 'snow' },
  [BLOCK.GRAVEL]: { name: '砂利', item: 'gravel', tiles: [T.GRAVEL, T.GRAVEL, T.GRAVEL], opaque: true, solid: true, layer: 'opaque', hardness: 0.6, tool: 'shovel', minTier: -1, drop: 'gravel' },
  [BLOCK.TORCH]: { name: 'たいまつ', item: 'torch', tiles: [T.TORCH, T.TORCH, T.TORCH], opaque: false, solid: false, layer: 'cutout', model: 'torch', hardness: 0, tool: null, minTier: -1, drop: 'torch', light: 14 },
  [BLOCK.CRAFTING_TABLE]: { name: '作業台', item: 'crafting_table', tiles: [T.CRAFT_TOP, T.PLANKS, T.CRAFT_SIDE, T.CRAFT_FRONT], opaque: true, solid: true, layer: 'opaque', hardness: 2.5, tool: 'axe', minTier: -1, drop: 'crafting_table' },
  [BLOCK.FURNACE]: { name: 'かまど', item: 'furnace', tiles: [T.FURNACE_TOP, T.FURNACE_TOP, T.FURNACE_SIDE, T.FURNACE_FRONT], opaque: true, solid: true, layer: 'opaque', hardness: 3.5, tool: 'pickaxe', minTier: 0, drop: 'furnace' },
  [BLOCK.COAL_ORE]: { name: '石炭鉱石', item: 'coal_ore', tiles: [T.COAL_ORE, T.COAL_ORE, T.COAL_ORE], opaque: true, solid: true, layer: 'opaque', hardness: 3, tool: 'pickaxe', minTier: 0, drop: 'coal' },
  [BLOCK.IRON_ORE]: { name: '鉄鉱石', item: 'iron_ore', tiles: [T.IRON_ORE, T.IRON_ORE, T.IRON_ORE], opaque: true, solid: true, layer: 'opaque', hardness: 3, tool: 'pickaxe', minTier: 1, drop: 'raw_iron' },
  [BLOCK.WOOL]: { name: '白色の羊毛', item: 'wool', tiles: [T.WOOL, T.WOOL, T.WOOL], opaque: true, solid: true, layer: 'opaque', hardness: 0.8, tool: null, minTier: -1, drop: 'wool' },
};

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

function oreSpots(ctx, ox, oy, rand, color, dark, n = 5) {
  for (let i = 0; i < n; i++) {
    const cx = 1 + Math.floor(rand() * 13);
    const cy = 1 + Math.floor(rand() * 13);
    px(ctx, ox, oy, cx, cy, color); px(ctx, ox, oy, cx + 1, cy, color);
    px(ctx, ox, oy, cx, cy + 1, color); px(ctx, ox, oy, cx + 1, cy + 1, dark);
  }
}

const TILE_PAINTERS = {
  [T.GRASS_TOP](ctx, ox, oy, rand) { noisyFill(ctx, ox, oy, 0x5fa832, 22, rand); },
  [T.GRASS_SIDE](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x7f5a36, 18, rand);
    for (let x = 0; x < TILE_PX; x++) {
      const depth = 2 + Math.floor(rand() * 3);
      for (let y = 0; y < depth; y++) px(ctx, ox, oy, x, y, rand() < 0.8 ? 0x5fa832 : 0x4e9128);
    }
  },
  [T.DIRT](ctx, ox, oy, rand) { noisyFill(ctx, ox, oy, 0x7f5a36, 20, rand); },
  [T.STONE](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x8a8a8a, 14, rand);
    for (let i = 0; i < 6; i++) px(ctx, ox, oy, Math.floor(rand() * 16), Math.floor(rand() * 16), 0x6e6e6e);
  },
  [T.SAND](ctx, ox, oy, rand) { noisyFill(ctx, ox, oy, 0xdbcf98, 14, rand); },
  [T.LOG_SIDE](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x6b4a26, 12, rand);
    for (let x = 0; x < TILE_PX; x += 3) for (let y = 0; y < TILE_PX; y++) if (rand() < 0.7) px(ctx, ox, oy, x, y, 0x4f3519);
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
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) {
      if (rand() < 0.82) px(ctx, ox, oy, x, y, rand() < 0.5 ? 0x3d8a2a : 0x2f7320);
    }
  },
  [T.PLANKS](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0xb8905a, 12, rand);
    for (let y = 0; y < TILE_PX; y += 4) for (let x = 0; x < TILE_PX; x++) px(ctx, ox, oy, x, y, 0x7d5a30);
    for (const [x, y] of [[3, 1], [3, 2], [11, 5], [11, 6], [6, 9], [6, 10], [13, 13], [13, 14]]) px(ctx, ox, oy, x, y, 0x7d5a30);
  },
  [T.COBBLE](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x7b7b7b, 26, rand);
    for (let i = 0; i < 5; i++) {
      const cx = Math.floor(rand() * 14), cy = Math.floor(rand() * 14);
      for (let dx = 0; dx < 3; dx++) px(ctx, ox, oy, cx + dx, cy, 0x4d4d4d);
      for (let dy = 0; dy < 3; dy++) px(ctx, ox, oy, cx, cy + dy, 0x4d4d4d);
    }
  },
  [T.GLASS](ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    for (let i = 0; i < TILE_PX; i++) {
      px(ctx, ox, oy, i, 0, 0xd8f4f8); px(ctx, ox, oy, i, 15, 0xd8f4f8);
      px(ctx, ox, oy, 0, i, 0xd8f4f8); px(ctx, ox, oy, 15, i, 0xd8f4f8);
    }
    for (let i = 2; i < 7; i++) px(ctx, ox, oy, i, 9 - i, 0xffffff);
    for (let i = 4; i < 11; i++) px(ctx, ox, oy, i, 13 - i, 0xffffff);
  },
  [T.WATER](ctx, ox, oy, rand) { noisyFill(ctx, ox, oy, 0x2d6fd8, 18, rand); },
  [T.BRICK](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0xa8503c, 14, rand);
    for (let y = 0; y < TILE_PX; y += 4) {
      for (let x = 0; x < TILE_PX; x++) px(ctx, ox, oy, x, y, 0xd7c9b8);
      const off = (y / 4) % 2 === 0 ? 0 : 4;
      for (let x = off; x < TILE_PX; x += 8) for (let dy = 1; dy < 4; dy++) px(ctx, ox, oy, x, y + dy, 0xd7c9b8);
    }
  },
  [T.BEDROCK](ctx, ox, oy, rand) { noisyFill(ctx, ox, oy, 0x3a3a3a, 34, rand); },
  [T.SNOW](ctx, ox, oy, rand) { noisyFill(ctx, ox, oy, 0xf4f8fb, 6, rand); },
  [T.GRAVEL](ctx, ox, oy, rand) { noisyFill(ctx, ox, oy, 0x8c8478, 30, rand); },
  [T.TORCH](ctx, ox, oy) {
    // 幅 2px (x=7,8)・高さ 10px の小さな柱として使う: 上 2 段が炎、次が焦げ、下が柄
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 2; y++) px(ctx, ox, oy, x, y, y === 0 ? 0xfff2a0 : 0xffb830);
      px(ctx, ox, oy, x, 2, 0x2b2b2b);
      for (let y = 3; y < 10; y++) px(ctx, ox, oy, x, y, (x + y) % 3 === 0 ? 0x5a3a1a : 0x7a5228);
    }
  },
  [T.CRAFT_TOP](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0xb8905a, 10, rand);
    for (let i = 0; i < 16; i++) { px(ctx, ox, oy, i, 0, 0x6b4a26); px(ctx, ox, oy, i, 15, 0x6b4a26); px(ctx, ox, oy, 0, i, 0x6b4a26); px(ctx, ox, oy, 15, i, 0x6b4a26); }
    for (let i = 2; i < 14; i++) { px(ctx, ox, oy, i, 5, 0x6b4a26); px(ctx, ox, oy, i, 10, 0x6b4a26); px(ctx, ox, oy, 5, i, 0x6b4a26); px(ctx, ox, oy, 10, i, 0x6b4a26); }
  },
  [T.CRAFT_SIDE](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0xb8905a, 10, rand);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) px(ctx, ox, oy, x, y, 0x8a6a3a);
    for (let x = 2; x < 14; x += 6) for (let y = 6; y < 14; y++) px(ctx, ox, oy, x, y, 0x6b4a26);
  },
  [T.CRAFT_FRONT](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0xb8905a, 10, rand);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) px(ctx, ox, oy, x, y, 0x8a6a3a);
    for (let x = 3; x < 8; x++) for (let y = 6; y < 9; y++) px(ctx, ox, oy, x, y, 0x9c9c9c);
    for (let x = 9; x < 13; x++) for (let y = 6; y < 12; y++) px(ctx, ox, oy, x, y, 0x6b4a26);
  },
  [T.FURNACE_TOP](ctx, ox, oy, rand) { noisyFill(ctx, ox, oy, 0x6e6e6e, 12, rand); },
  [T.FURNACE_SIDE](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x7b7b7b, 20, rand);
    for (let i = 0; i < 16; i++) { px(ctx, ox, oy, i, 0, 0x4d4d4d); px(ctx, ox, oy, 0, i, 0x4d4d4d); }
  },
  [T.FURNACE_FRONT](ctx, ox, oy, rand) {
    noisyFill(ctx, ox, oy, 0x7b7b7b, 20, rand);
    for (let x = 4; x < 12; x++) for (let y = 8; y < 14; y++) px(ctx, ox, oy, x, y, 0x1c1c1c);
    for (let x = 5; x < 11; x++) px(ctx, ox, oy, x, 13, 0xff8a1a);
    for (let x = 6; x < 10; x++) px(ctx, ox, oy, x, 12, 0xffb830);
  },
  [T.COAL_ORE](ctx, ox, oy, rand) { noisyFill(ctx, ox, oy, 0x8a8a8a, 14, rand); oreSpots(ctx, ox, oy, rand, 0x222222, 0x111111); },
  [T.IRON_ORE](ctx, ox, oy, rand) { noisyFill(ctx, ox, oy, 0x8a8a8a, 14, rand); oreSpots(ctx, ox, oy, rand, 0xd8b090, 0xa87a58); },
  [T.WOOL](ctx, ox, oy, rand) { noisyFill(ctx, ox, oy, 0xe9e9e9, 12, rand); },
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
  const pad = 0.5 / (ATLAS_TILES * TILE_PX);
  return [tx * s + pad, 1 - (ty + 1) * s + pad, (tx + 1) * s - pad, 1 - ty * s - pad];
}

// タイルを別の Canvas に描き出す (アイコン用)
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

// ブロック破壊のヒビ (10 段階) テクスチャ
let crackCache = null;
export function createCrackTexture() {
  if (crackCache) return crackCache;
  const stages = 10;
  const canvas = document.createElement('canvas');
  canvas.width = TILE_PX * stages;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(99);
  // 中心から広がるランダムなヒビ
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
  for (let s = 0; s < stages; s++) {
    const ox = s * TILE_PX;
    const n = Math.ceil(((s + 1) / stages) * cracks.length);
    const len = 2 + Math.round(((s + 1) / stages) * 7);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < Math.min(len, cracks[i].length); k++) {
        const [x, y] = cracks[i][k];
        if (x >= 0 && x < 16 && y >= 0 && y < 16) px(ctx, ox, 0, x, y, 0x000000, 0.55);
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
