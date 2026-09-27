import { ITEMS, itemPixel, hasArt } from './items.js';
import { BLOCKS, faceTile, createAtlas } from './blocks.js';
import { tileOrigin, TILE_PX } from './textures.js';

// ---- アイテムのアイコン ----
// ブロックは斜め上から見た立体 (Minecraft のインベントリと同じ見た目)、
// 草花・ドア・フェンスなどと道具類は平面のドット絵にする。

const ISO_HEIGHT = {
  cube: 1, slab: 0.5, stairs: 1, bed: 9 / 16, carpet: 1 / 16, plate: 1 / 16, chest: 14 / 16,
  cactus: 1, table: 0.75, trapdoor: 3 / 16,
};

export function iconKind(id) {
  const def = ITEMS[id];
  if (!def) return 'sprite';
  if (def.block === undefined) return 'sprite';
  const b = BLOCKS[def.block];
  return ISO_HEIGHT[b.shape] !== undefined ? 'iso' : 'sprite';
}

export function isoHeight(id) {
  return ISO_HEIGHT[BLOCKS[ITEMS[id].block].shape] ?? 1;
}

// アイコン用のメタデータ (正面が左手前を向くように)
export function iconMeta(bid) {
  const b = BLOCKS[bid];
  if (b.axis) return 0;
  if (b.facing === 'toward') return 2;
  if (b.facing) return 2;
  return 0;
}

const spriteCache = new Map();
const iconCache = new Map();

function blankCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function drawTile(ctx, tile, sx = 0, sy = 0, sw = TILE_PX, sh = TILE_PX, dx = 0, dy = 0, dw = sw, dh = sh) {
  const { canvas } = createAtlas();
  const [tx, ty] = tileOrigin(tile);
  ctx.drawImage(canvas, tx + sx, ty + sy, sw, sh, dx, dy, dw, dh);
}

function maskSprite(ctx, keep) {
  const img = ctx.getImageData(0, 0, 16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (!keep(x, y)) img.data[(y * 16 + x) * 4 + 3] = 0;
  ctx.putImageData(img, 0, 0);
}

// 16x16 の平面スプライト
export function spriteCanvas(id) {
  if (spriteCache.has(id)) return spriteCache.get(id);
  const [c, ctx] = blankCanvas(16);
  const def = ITEMS[id];
  if (def && def.block === undefined && hasArt(id)) {
    const img = ctx.createImageData(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const color = itemPixel(id, x, y);
      if (color === null) continue;
      const i = (y * 16 + x) * 4;
      img.data[i] = (color >> 16) & 255; img.data[i + 1] = (color >> 8) & 255; img.data[i + 2] = color & 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  } else if (def && def.block !== undefined) {
    const bid = def.block;
    const b = BLOCKS[bid];
    const side = faceTile(bid, 4, 0);
    switch (b.shape) {
      case 'door':
        drawTile(ctx, faceTile(bid, 4, 4), 0, 0, 16, 16, 4, 0, 8, 8);
        drawTile(ctx, faceTile(bid, 4, 0), 0, 0, 16, 16, 4, 8, 8, 8);
        break;
      case 'torch':
        drawTile(ctx, side, 7, 0, 2, 10, 7, 2, 2, 12);
        break;
      case 'fence':
        drawTile(ctx, side);
        maskSprite(ctx, (x, y) => ((x >= 2 && x <= 4) || (x >= 11 && x <= 13)) ? y >= 1 : (x > 4 && x < 11 && (y === 4 || y === 5 || y === 9 || y === 10)));
        break;
      case 'fence_gate':
        drawTile(ctx, side);
        maskSprite(ctx, (x, y) => ((x <= 1 || x >= 14) && y >= 3 && y <= 13) || (x > 1 && x < 14 && (y === 4 || y === 5 || y === 10 || y === 11)) || ((x === 7 || x === 8) && y >= 5 && y <= 10));
        break;
      case 'wall':
        drawTile(ctx, side);
        maskSprite(ctx, (x, y) => ((x >= 1 && x <= 5) || (x >= 10 && x <= 14)) ? y >= 1 : (x > 5 && x < 10 && y >= 4));
        break;
      case 'button':
        drawTile(ctx, side);
        maskSprite(ctx, (x, y) => x >= 5 && x <= 10 && y >= 6 && y <= 9);
        break;
      default:
        drawTile(ctx, side);
    }
  }
  spriteCache.set(id, c);
  return c;
}

// スプライトのピクセル色 (押し出しメッシュ用)
export function spritePixels(id) {
  const c = spriteCanvas(id);
  const data = c.getContext('2d').getImageData(0, 0, 16, 16).data;
  return (x, y) => {
    const i = (y * 16 + x) * 4;
    return data[i + 3] < 128 ? null : (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
  };
}

// 32x32 のアイコン
export function iconCanvas(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  const [c, ctx] = blankCanvas(32);
  if (iconKind(id) === 'iso') {
    const bid = ITEMS[id].block;
    const meta = iconMeta(bid);
    const h = isoHeight(id);
    const drop = (1 - h) * 15;
    const top = faceTile(bid, 3, meta);
    const left = faceTile(bid, 5, meta);
    const right = faceTile(bid, 1, meta);
    const face = (transform, tile, sy, sh, darken) => {
      ctx.save();
      ctx.setTransform(...transform);
      drawTile(ctx, tile, 0, sy, 16, sh, 0, 0, 16, sh);
      if (darken > 0) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(0,0,0,${darken})`;
        ctx.fillRect(0, 0, 16, sh);
      }
      ctx.restore();
    };
    face([15 / 16, 7.5 / 16, 0, 15 / 16, 1, 8.5 + drop], left, 16 * (1 - h), 16 * h, 0.22);
    face([15 / 16, -7.5 / 16, 0, 15 / 16, 16, 16 + drop], right, 16 * (1 - h), 16 * h, 0.4);
    face([15 / 16, 7.5 / 16, -15 / 16, 7.5 / 16, 16, 1 + drop], top, 0, 16, 0);
  } else {
    ctx.drawImage(spriteCanvas(id), 0, 0, 16, 16, 0, 0, 32, 32);
  }
  iconCache.set(id, c);
  return c;
}

export function drawItemIcon(canvas, id) {
  if (canvas.width !== 32) { canvas.width = 32; canvas.height = 32; }
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 32, 32);
  if (!ITEMS[id]) return;
  ctx.drawImage(iconCanvas(id), 0, 0);
}
