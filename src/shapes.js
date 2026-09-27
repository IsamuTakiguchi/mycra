import { BLOCKS, OPAQUE } from './blocks.js';

// ---- ブロックの形 ----
// ブロック内のローカル座標 (0..1) の直方体 [x0, y0, z0, x1, y1, z1] の配列を返す。
// purpose: 'render' 描画, 'collision' 当たり判定, 'select' 選択枠 / クリック判定
// メタデータ (8bit):
//   bit0-1 向き (0 北 -z, 1 東 +x, 2 南 +z, 3 西 -x)   ※ボタンは bit0-2 で 6 方向
//   bit2   上側 (ハーフブロックの上付き、逆さ階段、ドアの上半分、トラップドアの上付き、ベッドの頭側)
//   bit3   開いている (ドア、トラップドア、フェンスゲート)
//   bit4   2 枚重ね (ハーフブロック)
//   bit5   ヒンジが右 (ドア)
//   原木など軸のあるブロックは bit0-1 が軸 (0 y, 1 x, 2 z)

const P = 1 / 16;
const FULL_BOX = [[0, 0, 0, 1, 1, 1]];

export const META = { UP: 4, OPEN: 8, DOUBLE: 16, HINGE: 32 };

// 向き (N/E/S/W) の辺に沿った厚さ t の板
function sideBox(side, t, y0 = 0, y1 = 1) {
  switch (side) {
    case 0: return [0, y0, 0, 1, y1, t];
    case 1: return [1 - t, y0, 0, 1, y1, 1];
    case 2: return [0, y0, 1 - t, 1, y1, 1];
    default: return [0, y0, 0, t, y1, 1];
  }
}

const NEIGHBORS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function connects(world, x, y, z, side, kind) {
  const [dx, dz] = NEIGHBORS[side];
  const n = world.get(x + dx, y, z + dz);
  if (!n) return false;
  if (OPAQUE[n]) return true;
  const d = BLOCKS[n];
  if (kind === 'fence') return d.connect === 'fence' || d.shape === 'fence_gate';
  if (kind === 'pane') return d.connect === 'pane' || d.connect === 'wall';
  if (kind === 'wall') return d.connect === 'wall' || d.connect === 'pane' || d.shape === 'fence_gate';
  return false;
}

export function shapeBoxes(world, x, y, z, id, meta, purpose = 'render') {
  const d = BLOCKS[id];
  const tall = purpose === 'collision' ? 1.5 : 1;
  switch (d.shape) {
    case 'cube':
      return FULL_BOX;
    case 'slab':
      if (meta & META.DOUBLE) return FULL_BOX;
      return meta & META.UP ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]];
    case 'stairs': {
      const up = meta & META.UP;
      const base = up ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
      const y0 = up ? 0 : 0.5, y1 = up ? 0.5 : 1;
      const f = meta & 3;
      const step = f === 0 ? [0, y0, 0, 1, y1, 0.5] : f === 1 ? [0.5, y0, 0, 1, y1, 1] : f === 2 ? [0, y0, 0.5, 1, y1, 1] : [0, y0, 0, 0.5, y1, 1];
      return [base, step];
    }
    case 'fence': {
      const boxes = [[6 * P, 0, 6 * P, 10 * P, tall, 10 * P]];
      for (let s = 0; s < 4; s++) {
        if (!connects(world, x, y, z, s, 'fence')) continue;
        if (purpose === 'render') {
          for (const [y0, y1] of [[6 * P, 9 * P], [12 * P, 15 * P]]) boxes.push(armBox(s, 7 * P, 9 * P, y0, y1, 6 * P, 10 * P));
        } else boxes.push(armBox(s, 6 * P, 10 * P, 0, tall, 6 * P, 10 * P));
      }
      return boxes;
    }
    case 'wall': {
      const boxes = [[4 * P, 0, 4 * P, 12 * P, tall, 12 * P]];
      for (let s = 0; s < 4; s++) {
        if (!connects(world, x, y, z, s, 'wall')) continue;
        boxes.push(armBox(s, 5 * P, 11 * P, 0, purpose === 'collision' ? tall : 14 * P, 4 * P, 12 * P));
      }
      return boxes;
    }
    case 'pane': {
      const boxes = [[7 * P, 0, 7 * P, 9 * P, 1, 9 * P]];
      for (let s = 0; s < 4; s++) {
        if (!connects(world, x, y, z, s, 'pane')) continue;
        boxes.push(armBox(s, 7 * P, 9 * P, 0, 1, 7 * P, 9 * P));
      }
      return boxes;
    }
    case 'fence_gate': {
      const f = meta & 3;
      const alongX = f === 0 || f === 2; // 北/南を向くゲートは x 方向に伸びる
      const open = meta & META.OPEN;
      if (purpose === 'collision') {
        if (open) return [];
        return [alongX ? [0, 0, 6 * P, 1, tall, 10 * P] : [6 * P, 0, 0, 10 * P, tall, 1]];
      }
      const posts = alongX
        ? [[0, 5 * P, 7 * P, 2 * P, 1, 9 * P], [14 * P, 5 * P, 7 * P, 1, 1, 9 * P]]
        : [[7 * P, 5 * P, 0, 9 * P, 1, 2 * P], [7 * P, 5 * P, 14 * P, 9 * P, 1, 1]];
      if (open) {
        // 開いたゲートは内側へ 90 度回った状態を簡略化して表示
        const dz = f === 0 ? -1 : f === 2 ? 1 : 0;
        const dx = f === 1 ? 1 : f === 3 ? -1 : 0;
        const rails = [];
        for (const [y0, y1] of [[6 * P, 9 * P], [12 * P, 15 * P]]) {
          if (alongX) {
            const z0 = dz < 0 ? 1 * P : 9 * P, z1 = dz < 0 ? 7 * P : 15 * P;
            rails.push([0, y0, z0, 2 * P, y1, z1], [14 * P, y0, z0, 1, y1, z1]);
          } else {
            const x0 = dx < 0 ? 1 * P : 9 * P, x1 = dx < 0 ? 7 * P : 15 * P;
            rails.push([x0, y0, 0, x1, y1, 2 * P], [x0, y0, 14 * P, x1, y1, 1]);
          }
        }
        return [...posts, ...rails];
      }
      const rails = alongX
        ? [[2 * P, 6 * P, 7 * P, 14 * P, 9 * P, 9 * P], [2 * P, 12 * P, 7 * P, 14 * P, 15 * P, 9 * P], [6 * P, 9 * P, 7 * P, 10 * P, 12 * P, 9 * P]]
        : [[7 * P, 6 * P, 2 * P, 9 * P, 9 * P, 14 * P], [7 * P, 12 * P, 2 * P, 9 * P, 15 * P, 14 * P], [7 * P, 9 * P, 6 * P, 9 * P, 12 * P, 10 * P]];
      return [...posts, ...rails];
    }
    case 'door': {
      const f = meta & 3;
      const open = meta & META.OPEN;
      const hinge = meta & META.HINGE;
      const side = open ? (hinge ? (f + 1) % 4 : (f + 3) % 4) : (f + 2) % 4;
      return [sideBox(side, 3 * P)];
    }
    case 'trapdoor': {
      const f = meta & 3;
      if (meta & META.OPEN) return [sideBox((f + 2) % 4, 3 * P)];
      return meta & META.UP ? [[0, 13 * P, 0, 1, 1, 1]] : [[0, 0, 0, 1, 3 * P, 1]];
    }
    case 'ladder': {
      const f = meta & 3;
      return [sideBox((f + 2) % 4, purpose === 'render' ? 1 * P : 3 * P)];
    }
    case 'carpet':
      return [[0, 0, 0, 1, 1 * P, 1]];
    case 'plate':
      return [[1 * P, 0, 1 * P, 15 * P, 1 * P, 15 * P]];
    case 'button': {
      const f = meta & 7;
      if (f === 4) return [[5 * P, 0, 6 * P, 11 * P, 2 * P, 10 * P]];
      if (f === 5) return [[5 * P, 14 * P, 6 * P, 11 * P, 1, 10 * P]];
      const b = sideBox((f + 2) % 4, 2 * P, 6 * P, 10 * P);
      // 幅を 6px に絞る
      if (f === 0 || f === 2) { b[0] = 5 * P; b[3] = 11 * P; } else { b[2] = 5 * P; b[5] = 11 * P; }
      return [b];
    }
    case 'bed':
      return [[0, 0, 0, 1, 9 * P, 1]];
    case 'chest':
      return [[1 * P, 0, 1 * P, 15 * P, 14 * P, 15 * P]];
    case 'cactus':
      return [[1 * P, 0, 1 * P, 15 * P, purpose === 'collision' ? 15 * P : 1, 15 * P]];
    case 'lantern':
      return purpose === 'render'
        ? [[5 * P, 0, 5 * P, 11 * P, 7 * P, 11 * P], [6 * P, 7 * P, 6 * P, 10 * P, 9 * P, 10 * P]]
        : [[5 * P, 0, 5 * P, 11 * P, 9 * P, 11 * P]];
    case 'table':
      return [[0, 0, 0, 1, 12 * P, 1]];
    case 'cross':
      return purpose === 'select' ? [[2 * P, 0, 2 * P, 14 * P, 13 * P, 14 * P]] : [];
    case 'torch':
      return purpose === 'select' ? [[6 * P, 0, 6 * P, 10 * P, 10 * P, 10 * P]] : [];
    default:
      return [];
  }
}

// 中心から side 方向の辺まで伸びる腕 (幅 w0..w1, 高さ y0..y1)。c0..c1 は中心部の範囲
function armBox(side, w0, w1, y0, y1, c0, c1) {
  switch (side) {
    case 0: return [w0, y0, 0, w1, y1, c0];
    case 1: return [c1, y0, w0, 1, y1, w1];
    case 2: return [w0, y0, c1, w1, y1, 1];
    default: return [0, y0, w0, c0, y1, w1];
  }
}

// 選択枠用に、ボックスをまとめた外接直方体
export function boundsOf(boxes) {
  if (!boxes.length) return [0, 0, 0, 1, 1, 1];
  const b = [1, 1, 1, 0, 0, 0];
  for (const x of boxes) {
    for (let i = 0; i < 3; i++) { b[i] = Math.min(b[i], x[i]); b[i + 3] = Math.max(b[i + 3], Math.min(1, x[i + 3])); }
  }
  return b;
}
