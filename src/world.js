import * as THREE from 'three';
import { BLOCK, BLOCKS, isOpaque, tileUV, createAtlas } from './blocks.js';
import { Perlin2D, mulberry32 } from './noise.js';

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 64;
export const WORLD_CHUNKS = 8; // 8x8 チャンク = 128x128 ブロック
export const SEA_LEVEL = 26;

// 各面の定義 (three.js のボクセル解説と同じ頂点順序)
const FACES = [
  { dir: [-1, 0, 0], side: 2, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], side: 2, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], side: 1, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], side: 0, corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], side: 2, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], side: 2, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];

// 面の向きごとの明るさ (上面が一番明るい)
const FACE_SHADE = [0.8, 0.8, 0.5, 1.0, 0.7, 0.7];

export class World {
  constructor(seed = 1) {
    this.seed = seed;
    this.size = WORLD_CHUNKS * CHUNK_SIZE;
    this.data = new Uint8Array(this.size * this.size * WORLD_HEIGHT);
    this.edits = new Map(); // "x,y,z" -> id (セーブ用の差分)
    this.chunks = new Map(); // "cx,cz" -> { group, dirty }
    this.group = new THREE.Group();

    const { texture } = createAtlas();
    this.materials = {
      opaque: new THREE.MeshLambertMaterial({ map: texture, vertexColors: true }),
      cutout: new THREE.MeshLambertMaterial({ map: texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
      water: new THREE.MeshLambertMaterial({ map: texture, vertexColors: true, transparent: true, opacity: 0.65, depthWrite: false }),
    };
  }

  inBounds(x, y, z) {
    return x >= 0 && z >= 0 && x < this.size && z < this.size && y >= 0 && y < WORLD_HEIGHT;
  }

  index(x, y, z) {
    return (x * this.size + z) * WORLD_HEIGHT + y;
  }

  get(x, y, z) {
    if (!this.inBounds(x, y, z)) return BLOCK.AIR;
    return this.data[this.index(x, y, z)];
  }

  setRaw(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return;
    this.data[this.index(x, y, z)] = id;
  }

  // プレイヤー操作によるブロック変更 (差分を記録し、チャンクを再構築)
  set(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return false;
    const i = this.index(x, y, z);
    if (this.data[i] === id) return false;
    this.data[i] = id;
    this.edits.set(`${x},${y},${z}`, id);
    this.markDirtyAround(x, z);
    return true;
  }

  markDirtyAround(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    this.markDirty(cx, cz);
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
  }

  markDirty(cx, cz) {
    const c = this.chunks.get(`${cx},${cz}`);
    if (c) c.dirty = true;
  }

  // ---------- 地形生成 ----------
  generate() {
    const heightNoise = new Perlin2D(this.seed);
    const detailNoise = new Perlin2D(this.seed + 101);
    const biomeNoise = new Perlin2D(this.seed + 202);
    const rand = mulberry32(this.seed + 303);
    const size = this.size;
    const heights = new Uint8Array(size * size);

    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        const base = heightNoise.fbm(x / 90, z / 90, 4) * 16;
        const detail = detailNoise.fbm(x / 22, z / 22, 3) * 4;
        const mountain = Math.max(0, biomeNoise.fbm(x / 140 + 7, z / 140 + 7, 3)) * 24;
        let h = Math.floor(SEA_LEVEL + 3 + base + detail + mountain);
        h = Math.max(4, Math.min(WORLD_HEIGHT - 8, h));
        heights[x * size + z] = h;

        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0) id = BLOCK.BEDROCK;
          else if (y < h - 3) id = BLOCK.STONE;
          else if (y < h) id = h <= SEA_LEVEL + 1 ? BLOCK.SAND : BLOCK.DIRT;
          else if (h <= SEA_LEVEL + 1) id = BLOCK.SAND;
          else if (h >= 48) id = BLOCK.SNOW;
          else id = BLOCK.GRASS;
          this.data[this.index(x, y, z)] = id;
        }
        // 砂利のパッチ
        if (h > SEA_LEVEL + 1 && detailNoise.noise(x / 9 + 50, z / 9 + 50) > 0.55) {
          this.data[this.index(x, h, z)] = BLOCK.GRAVEL;
        }
        // 水
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          this.data[this.index(x, y, z)] = BLOCK.WATER;
        }
      }
    }

    // 木
    for (let x = 3; x < size - 3; x++) {
      for (let z = 3; z < size - 3; z++) {
        const h = heights[x * size + z];
        if (this.data[this.index(x, h, z)] !== BLOCK.GRASS) continue;
        const density = 0.006 + Math.max(0, biomeNoise.noise(x / 40, z / 40)) * 0.03;
        if (rand() < density) this.placeTree(x, h + 1, z, rand);
      }
    }
  }

  placeTree(x, y, z, rand) {
    const trunk = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < trunk; i++) this.setRaw(x, y + i, z, BLOCK.LOG);
    const top = y + trunk - 1;
    for (let dy = -2; dy <= 2; dy++) {
      const r = dy >= 1 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === 2 || rand() < 0.5)) continue;
          if (dx === 0 && dz === 0 && dy <= 0) continue;
          const bx = x + dx, by = top + dy, bz = z + dz;
          if (this.get(bx, by, bz) === BLOCK.AIR) this.setRaw(bx, by, bz, BLOCK.LEAVES);
        }
      }
    }
  }

  // 地表の高さ (スポーン位置決定用)
  surfaceHeight(x, z) {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const id = this.get(x, y, z);
      if (id !== BLOCK.AIR && id !== BLOCK.WATER) return y;
    }
    return 0;
  }

  // 中心付近で木や水のない安全なスポーン地点を探す
  findSpawn() {
    const c = Math.floor(this.size / 2);
    for (let r = 0; r < this.size / 2; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const x = c + dx, z = c + dz;
          const y = this.surfaceHeight(x, z);
          const top = this.get(x, y, z);
          if (top === BLOCK.LEAVES || top === BLOCK.LOG || y <= SEA_LEVEL) continue;
          // 頭上 2 ブロックと周囲が空いているか
          let clear = true;
          for (let ox = -1; ox <= 1 && clear; ox++) {
            for (let oz = -1; oz <= 1 && clear; oz++) {
              for (let oy = 1; oy <= 3; oy++) {
                if (this.get(x + ox, y + oy, z + oz) !== BLOCK.AIR) { clear = false; break; }
              }
            }
          }
          if (clear) return { x, z };
        }
      }
    }
    return { x: c, z: c };
  }

  // ---------- セーブ / ロード ----------
  applyEdits(list) {
    for (const [x, y, z, id] of list) {
      if (!this.inBounds(x, y, z)) continue;
      this.data[this.index(x, y, z)] = id;
      this.edits.set(`${x},${y},${z}`, id);
    }
  }

  serializeEdits() {
    const out = [];
    for (const [key, id] of this.edits) {
      const [x, y, z] = key.split(',').map(Number);
      out.push([x, y, z, id]);
    }
    return out;
  }

  // ---------- メッシュ生成 ----------
  buildAll() {
    for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
      for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
        this.chunks.set(`${cx},${cz}`, { cx, cz, dirty: true, meshes: [] });
      }
    }
    this.update(Infinity);
  }

  // dirty なチャンクを最大 budget 個まで再構築
  update(budget = 2) {
    let n = 0;
    for (const chunk of this.chunks.values()) {
      if (!chunk.dirty) continue;
      this.buildChunk(chunk);
      chunk.dirty = false;
      if (++n >= budget) break;
    }
  }

  buildChunk(chunk) {
    for (const m of chunk.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    chunk.meshes = [];

    const buffers = {
      opaque: { pos: [], nor: [], uv: [], col: [], idx: [] },
      cutout: { pos: [], nor: [], uv: [], col: [], idx: [] },
      water: { pos: [], nor: [], uv: [], col: [], idx: [] },
    };

    const x0 = chunk.cx * CHUNK_SIZE;
    const z0 = chunk.cz * CHUNK_SIZE;

    for (let x = x0; x < x0 + CHUNK_SIZE; x++) {
      for (let z = z0; z < z0 + CHUNK_SIZE; z++) {
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const id = this.data[this.index(x, y, z)];
          if (id === BLOCK.AIR) continue;
          const def = BLOCKS[id];
          const buf = buffers[def.layer];

          for (let f = 0; f < FACES.length; f++) {
            const face = FACES[f];
            const nx = x + face.dir[0], ny = y + face.dir[1], nz = z + face.dir[2];
            const neighbor = this.get(nx, ny, nz);
            if (!this.faceVisible(id, neighbor, ny)) continue;

            const [u0, v0, u1, v1] = tileUV(def.tiles[face.side]);
            const shade = FACE_SHADE[f];
            const base = buf.pos.length / 3;

            for (const c of face.corners) {
              buf.pos.push(x + c[0], y + c[1], z + c[2]);
              buf.nor.push(face.dir[0], face.dir[1], face.dir[2]);
              buf.uv.push(c[3] ? u1 : u0, c[4] ? v1 : v0);
              const ao = def.layer === 'water' ? 1 : this.vertexAO(x, y, z, face.dir, c);
              const light = shade * ao;
              buf.col.push(light, light, light);
            }
            buf.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
          }
        }
      }
    }

    for (const layer of Object.keys(buffers)) {
      const b = buffers[layer];
      if (b.idx.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      geo.setIndex(b.idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.materials[layer]);
      mesh.renderOrder = layer === 'water' ? 2 : layer === 'cutout' ? 1 : 0;
      mesh.frustumCulled = true;
      this.group.add(mesh);
      chunk.meshes.push(mesh);
    }
  }

  faceVisible(id, neighbor, ny) {
    if (ny < 0) return false; // 世界の底は描かない
    if (neighbor === BLOCK.AIR) return true;
    if (isOpaque(neighbor)) return false;
    // 透過ブロック同士 (水と水、葉と葉) の内側の面は描かない
    if (neighbor === id) return false;
    // 水の中から見た他ブロックの面は描く。水自身の面は隣が不透明でなければ描く
    return true;
  }

  // 頂点ごとの環境遮蔽 (0fps の手法)。0.55〜1.0 を返す
  vertexAO(x, y, z, dir, corner) {
    const axis = dir[0] !== 0 ? 0 : dir[1] !== 0 ? 1 : 2;
    const a = axis === 0 ? 1 : 0;
    const b = axis === 2 ? 1 : 2;
    const pos = [x + dir[0], y + dir[1], z + dir[2]];
    const sa = corner[a] ? 1 : -1;
    const sb = corner[b] ? 1 : -1;
    const p1 = pos.slice(); p1[a] += sa;
    const p2 = pos.slice(); p2[b] += sb;
    const p3 = pos.slice(); p3[a] += sa; p3[b] += sb;
    const s1 = isOpaque(this.get(p1[0], p1[1], p1[2])) ? 1 : 0;
    const s2 = isOpaque(this.get(p2[0], p2[1], p2[2])) ? 1 : 0;
    const s3 = isOpaque(this.get(p3[0], p3[1], p3[2])) ? 1 : 0;
    const occlusion = s1 && s2 ? 3 : s1 + s2 + s3;
    return 1 - occlusion * 0.15;
  }
}
