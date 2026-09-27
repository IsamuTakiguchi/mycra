import { OPAQUE, LIGHT } from './blocks.js';
import { CHUNK_SIZE, WORLD_HEIGHT } from './constants.js';

// Minecraft 風のライティング
//  sky:   空からの光 (0-15)。上が開けていれば 15、横方向へ 1 ずつ減衰
//  block: たいまつ等の光源 (0-15)。1 ブロックごとに 1 減衰
const REGION = 15;

export class Lighting {
  constructor(world) {
    this.world = world;
    const n = world.data.length;
    this.sky = new Uint8Array(n);
    this.block = new Uint8Array(n);
    this.queue = new Int32Array(n);
    this.size = world.size;
    this.H = WORLD_HEIGHT;
    this.strideX = this.size * this.H;
    this.strideZ = this.H;
  }

  index(x, y, z) {
    return (x * this.size + z) * this.H + y;
  }

  // 全体計算 (ワールド生成時)
  computeAll() {
    const { world, size, H, sky, block, queue } = this;
    sky.fill(0);
    block.fill(0);
    let tail = 0;
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        const base = (x * size + z) * H;
        for (let y = H - 1; y >= 0; y--) {
          if (OPAQUE[world.data[base + y]]) break;
          sky[base + y] = 15;
          queue[tail++] = base + y;
        }
      }
    }
    this.propagate(sky, tail, 0, size - 1, 0, size - 1);

    tail = 0;
    for (let i = 0; i < world.data.length; i++) {
      const l = LIGHT[world.data[i]];
      if (l > 0) { block[i] = l; queue[tail++] = i; }
    }
    this.propagate(block, tail, 0, size - 1, 0, size - 1);
  }

  // 幅優先で光を広げる (領域 [xs..xe] x [zs..ze] の内側だけ)
  propagate(light, tail, xs, xe, zs, ze) {
    const { world, size, H, queue, strideX, strideZ } = this;
    const data = world.data;
    let head = 0;
    while (head < tail) {
      const i = queue[head++];
      const l = light[i];
      if (l <= 1) continue;
      const y = i % H;
      const z = ((i - y) / H) % size;
      const x = Math.floor(i / strideX);
      const nl = l - 1;
      // 6 近傍
      if (y > 0) { const n = i - 1; if (!OPAQUE[data[n]] && light[n] < nl) { light[n] = nl; queue[tail++] = n; } }
      if (y < H - 1) { const n = i + 1; if (!OPAQUE[data[n]] && light[n] < nl) { light[n] = nl; queue[tail++] = n; } }
      if (z > zs) { const n = i - strideZ; if (!OPAQUE[data[n]] && light[n] < nl) { light[n] = nl; queue[tail++] = n; } }
      if (z < ze) { const n = i + strideZ; if (!OPAQUE[data[n]] && light[n] < nl) { light[n] = nl; queue[tail++] = n; } }
      if (x > xs) { const n = i - strideX; if (!OPAQUE[data[n]] && light[n] < nl) { light[n] = nl; queue[tail++] = n; } }
      if (x < xe) { const n = i + strideX; if (!OPAQUE[data[n]] && light[n] < nl) { light[n] = nl; queue[tail++] = n; } }
    }
  }

  // ブロック変更後に周辺領域だけ再計算し、変化したチャンクを dirty にする
  updateAround(ex, ez) {
    const { world, size, H, sky, block, queue, strideX, strideZ } = this;
    const data = world.data;
    const xs = Math.max(0, ex - REGION), xe = Math.min(size - 1, ex + REGION);
    const zs = Math.max(0, ez - REGION), ze = Math.min(size - 1, ez + REGION);

    // スナップショット
    const w = xe - xs + 1, d = ze - zs + 1;
    const oldSky = new Uint8Array(w * d * H);
    const oldBlock = new Uint8Array(w * d * H);
    let k = 0;
    for (let x = xs; x <= xe; x++) {
      for (let z = zs; z <= ze; z++) {
        const base = (x * size + z) * H;
        oldSky.set(sky.subarray(base, base + H), k);
        oldBlock.set(block.subarray(base, base + H), k);
        sky.fill(0, base, base + H);
        block.fill(0, base, base + H);
        k += H;
      }
    }

    const seedBorder = (light, tail) => {
      // 領域の外側に接するセルは、外側の値 - 1 を種にする
      for (let x = xs; x <= xe; x++) {
        for (let z = zs; z <= ze; z++) {
          const border = x === xs || x === xe || z === zs || z === ze;
          if (!border) continue;
          const base = (x * size + z) * H;
          for (let y = 0; y < H; y++) {
            const i = base + y;
            if (OPAQUE[data[i]]) continue;
            let best = light[i];
            if (x === xs && x > 0) best = Math.max(best, light[i - strideX] - 1);
            if (x === xe && x < size - 1) best = Math.max(best, light[i + strideX] - 1);
            if (z === zs && z > 0) best = Math.max(best, light[i - strideZ] - 1);
            if (z === ze && z < size - 1) best = Math.max(best, light[i + strideZ] - 1);
            if (best > light[i]) { light[i] = best; queue[tail++] = i; }
          }
        }
      }
      return tail;
    };

    // 空の光
    let tail = 0;
    for (let x = xs; x <= xe; x++) {
      for (let z = zs; z <= ze; z++) {
        const base = (x * size + z) * H;
        for (let y = H - 1; y >= 0; y--) {
          if (OPAQUE[data[base + y]]) break;
          sky[base + y] = 15;
          queue[tail++] = base + y;
        }
      }
    }
    tail = seedBorder(sky, tail);
    this.propagate(sky, tail, xs, xe, zs, ze);

    // 光源
    tail = 0;
    for (let x = xs; x <= xe; x++) {
      for (let z = zs; z <= ze; z++) {
        const base = (x * size + z) * H;
        for (let y = 0; y < H; y++) {
          const l = LIGHT[data[base + y]];
          if (l > 0) { block[base + y] = l; queue[tail++] = base + y; }
        }
      }
    }
    tail = seedBorder(block, tail);
    this.propagate(block, tail, xs, xe, zs, ze);

    // 変化したチャンクを dirty に
    const dirty = new Set();
    k = 0;
    for (let x = xs; x <= xe; x++) {
      for (let z = zs; z <= ze; z++) {
        const base = (x * size + z) * H;
        let changed = false;
        for (let y = 0; y < H; y++) {
          if (sky[base + y] !== oldSky[k + y] || block[base + y] !== oldBlock[k + y]) { changed = true; break; }
        }
        k += H;
        if (changed) {
          const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
          dirty.add(`${cx},${cz}`);
          // 境界の頂点は隣のチャンクにも影響する
          const lx = x % CHUNK_SIZE, lz = z % CHUNK_SIZE;
          if (lx === 0) dirty.add(`${cx - 1},${cz}`);
          if (lx === CHUNK_SIZE - 1) dirty.add(`${cx + 1},${cz}`);
          if (lz === 0) dirty.add(`${cx},${cz - 1}`);
          if (lz === CHUNK_SIZE - 1) dirty.add(`${cx},${cz + 1}`);
        }
      }
    }
    for (const key of dirty) {
      const [cx, cz] = key.split(',').map(Number);
      world.markDirty(cx, cz);
    }
  }

  skyAt(x, y, z) {
    if (x < 0 || z < 0 || x >= this.size || z >= this.size) return 15;
    if (y < 0) return 0;
    if (y >= this.H) return 15;
    return this.sky[this.index(x, y, z)];
  }

  blockAt(x, y, z) {
    if (x < 0 || z < 0 || x >= this.size || z >= this.size || y < 0 || y >= this.H) return 0;
    return this.block[this.index(x, y, z)];
  }
}
