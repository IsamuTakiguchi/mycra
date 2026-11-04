import { BLOCK, BLOCKS, SOLID, REPLACEABLE } from './blocks.js';
import { WORLD_HEIGHT } from './constants.js';

// 水の流れ (Minecraft と同じ規則を簡略化したもの)
//  meta 0      : 水源
//  meta 1〜7   : 流れる水 (数字は水源からの距離。7 で止まる)
//  meta 8      : 落ちる水 (滝)
//  - 水は 0.25 秒 (5 ティック) ごとに 1 ブロックずつ広がる
//  - 下に流れ込めるときは下へ落ち、水源以外は横に広がらない
//  - 横に広がるときは 4 ブロック以内の一番近い穴 (下に流れ落ちられる場所) へ向かう
//  - 水源が 2 つ以上隣り合い、下が地面か水源なら新しい水源になる (無限水源)
//  - 水源がなくなると、流れる水は少しずつ引いていく
export const FLOWING_MAX = 7;
export const FALLING = 8;
const TICK = 0.25;
const SLOPE_DIST = 4;
const MAX_PER_TICK = 4000;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 流れる水に押し流されて壊れるブロック (草花・松明など)
function washable(id) {
  const def = BLOCKS[id];
  if (!def || id === BLOCK.WATER) return false;
  return def.shape === 'cross' || def.shape === 'torch' || (REPLACEABLE[id] && !SOLID[id]);
}

// 水の高さ (ブロック内 0〜1)。水でなければ -1
export function waterHeight(world, x, y, z) {
  if (world.get(x, y, z) !== BLOCK.WATER) return -1;
  if (world.get(x, y + 1, z) === BLOCK.WATER) return 1;
  const m = world.getMeta(x, y, z);
  if (m === 0 || m & FALLING) return 8 / 9;
  return (8 - Math.min(m, FLOWING_MAX)) / 9;
}

// 横に広がるときの基準の水位 (水源と滝は 0)
const spreadLevel = (m) => (m === 0 || m & FALLING ? 0 : m);

export class Fluids {
  constructor(world) {
    this.world = world;
    this.pending = new Set(); // world.index の値
    this.timer = 0;
    this.enabled = true; // マルチプレイの参加者側では false (ホストの計算結果を受け取る)
    this.onWash = null; // (x, y, z, id, meta) 水に押し流されたブロック
    this.onFlow = null; // (x, y, z) 水が流れ込んだ (コンクリートパウダーを固めるなど)
  }

  // ブロックが変わったとき、その場所と隣の水を次のティックで計算し直す
  notify(x, y, z) {
    if (!this.enabled) return;
    const w = this.world;
    const add = (ax, ay, az) => {
      if (w.inBounds(ax, ay, az) && w.get(ax, ay, az) === BLOCK.WATER) this.pending.add(w.index(ax, ay, az));
    };
    add(x, y, z);
    add(x + 1, y, z); add(x - 1, y, z);
    add(x, y + 1, z); add(x, y - 1, z);
    add(x, y, z + 1); add(x, y, z - 1);
  }

  update(dt) {
    if (!this.enabled) { this.pending.clear(); this.timer = 0; return; }
    this.timer += dt;
    if (this.timer < TICK) return;
    this.timer %= TICK;
    if (this.pending.size === 0) return;
    const w = this.world;
    const list = [...this.pending];
    this.pending.clear();
    const n = Math.min(list.length, MAX_PER_TICK);
    for (let k = n; k < list.length; k++) this.pending.add(list[k]);
    for (let k = 0; k < n; k++) {
      const i = list[k];
      const y = i % WORLD_HEIGHT;
      const t = (i - y) / WORLD_HEIGHT;
      const z = t % w.size;
      const x = (t - z) / w.size;
      this.tickCell(x, y, z);
    }
  }

  tickCell(x, y, z) {
    const w = this.world;
    if (w.get(x, y, z) !== BLOCK.WATER) return;
    let meta = w.getMeta(x, y, z);
    if (meta !== 0) {
      const next = this.expected(x, y, z);
      if (next < 0) { w.set(x, y, z, BLOCK.AIR, 0); return; }
      if (next !== meta) { w.set(x, y, z, BLOCK.WATER, next); meta = next; }
    }
    this.spread(x, y, z, meta);
  }

  // 水源以外の水が、周りの状態から本来なるべき meta (-1: 消える)
  expected(x, y, z) {
    const w = this.world;
    let sources = 0;
    let min = 99;
    for (const [dx, dz] of DIRS) {
      if (w.get(x + dx, y, z + dz) !== BLOCK.WATER) continue;
      const m = w.getMeta(x + dx, y, z + dz);
      if (m === 0) sources++;
      min = Math.min(min, spreadLevel(m));
    }
    if (sources >= 2) {
      const below = w.get(x, y - 1, z);
      if ((below !== BLOCK.WATER && SOLID[below]) || (below === BLOCK.WATER && w.getMeta(x, y - 1, z) === 0)) return 0;
    }
    if (w.get(x, y + 1, z) === BLOCK.WATER) return FALLING;
    const level = min + 1;
    return level > FLOWING_MAX ? -1 : level;
  }

  // 水が入り込める場所か (空気・草花など、または自分より弱い流れの水)
  canEnter(x, y, z, level) {
    const w = this.world;
    if (!w.inBounds(x, y, z)) return false;
    const id = w.get(x, y, z);
    if (id === BLOCK.AIR) return true;
    if (id === BLOCK.WATER) {
      const m = w.getMeta(x, y, z);
      if (m === 0 || m & FALLING) return false;
      return level === FALLING || m > level;
    }
    return washable(id);
  }

  // 通り抜けて広がれる場所か (斜面探索用)
  passable(x, y, z) {
    const w = this.world;
    if (!w.inBounds(x, y, z)) return false;
    const id = w.get(x, y, z);
    if (id === BLOCK.AIR) return true;
    if (id === BLOCK.WATER) return w.getMeta(x, y, z) !== 0;
    return washable(id);
  }

  // 下に流れ落ちられる場所か
  hole(x, y, z) {
    const w = this.world;
    if (y - 1 < 0) return false;
    const id = w.get(x, y - 1, z);
    return id === BLOCK.AIR || id === BLOCK.WATER || washable(id);
  }

  place(x, y, z, meta) {
    const w = this.world;
    const id = w.get(x, y, z);
    if (id !== BLOCK.AIR && id !== BLOCK.WATER) this.onWash?.(x, y, z, id, w.getMeta(x, y, z));
    w.set(x, y, z, BLOCK.WATER, meta);
    this.onFlow?.(x, y, z);
  }

  spread(x, y, z, meta) {
    const w = this.world;
    const isSource = meta === 0;
    const below = w.get(x, y - 1, z);
    if (y > 0 && this.canEnter(x, y - 1, z, FALLING)) {
      this.place(x, y - 1, z, FALLING);
      if (!isSource) return;
    } else if (!isSource && below === BLOCK.WATER) {
      return; // 水の上に落ちた水は横に広がらない
    }
    const level = spreadLevel(meta) + 1;
    if (level > FLOWING_MAX) return;
    for (const [dx, dz] of this.directions(x, y, z)) {
      if (this.canEnter(x + dx, y, z + dz, level)) this.place(x + dx, y, z + dz, level);
    }
  }

  // 一番近い穴へ向かう方向 (見つからなければ広がれる全方向)
  directions(x, y, z) {
    let best = Infinity;
    let out = [];
    for (let d = 0; d < 4; d++) {
      const [dx, dz] = DIRS[d];
      const nx = x + dx, nz = z + dz;
      if (!this.passable(nx, y, nz)) continue;
      const dist = this.hole(nx, y, nz) ? 0 : this.slope(nx, y, nz, 1, d ^ 1);
      if (dist < best) { best = dist; out = [DIRS[d]]; }
      else if (dist === best) out.push(DIRS[d]);
    }
    return out;
  }

  slope(x, y, z, depth, from) {
    let best = 1000;
    for (let d = 0; d < 4; d++) {
      if (d === from) continue;
      const [dx, dz] = DIRS[d];
      const nx = x + dx, nz = z + dz;
      if (!this.passable(nx, y, nz)) continue;
      if (this.hole(nx, y, nz)) return depth;
      if (depth < SLOPE_DIST) best = Math.min(best, this.slope(nx, y, nz, depth + 1, d ^ 1));
    }
    return best;
  }

  // 流れの向き (水平の単位ベクトルと、滝なら下向き)。プレイヤーやアイテムを押し流す
  flowAt(x, y, z, out = { x: 0, y: 0, z: 0 }) {
    out.x = 0; out.y = 0; out.z = 0;
    const w = this.world;
    if (w.get(x, y, z) !== BLOCK.WATER) return out;
    const m = w.getMeta(x, y, z);
    if (m & FALLING) { out.y = -1; }
    const own = spreadLevel(m);
    for (const [dx, dz] of DIRS) {
      const id = w.get(x + dx, y, z + dz);
      let diff = 0;
      if (id === BLOCK.WATER) {
        const nm = w.getMeta(x + dx, y, z + dz);
        if (nm & FALLING) continue;
        diff = (nm === 0 ? 0 : nm) - own;
      } else if (!SOLID[id] && m !== 0) {
        diff = this.hole(x + dx, y, z + dz) ? FLOWING_MAX : 1;
      }
      out.x += dx * diff;
      out.z += dz * diff;
    }
    const len = Math.hypot(out.x, out.z);
    if (len > 0) { out.x /= len; out.z /= len; }
    return out;
  }
}
