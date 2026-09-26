import * as THREE from 'three';
import { BLOCK, BLOCKS, isOpaque, tileUV, createAtlas, ATLAS_TILES, TILE_PX } from './blocks.js';
import { Perlin2D, mulberry32 } from './noise.js';
import { Lighting } from './lighting.js';
import { CHUNK_SIZE, WORLD_HEIGHT, WORLD_CHUNKS, SEA_LEVEL } from './constants.js';

export { CHUNK_SIZE, WORLD_HEIGHT, WORLD_CHUNKS, SEA_LEVEL };

// 各面の定義 (three.js のボクセル解説と同じ頂点順序)
const FACES = [
  { dir: [-1, 0, 0], side: 2, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], side: 2, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], side: 1, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], side: 0, corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], side: 3, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], side: 3, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];

// 面の向きごとの明るさ (上面が一番明るい)
const FACE_SHADE = [0.8, 0.8, 0.5, 1.0, 0.7, 0.7];

// 頂点ごとの空の光・光源の光をシェーダーへ渡す。uDaylight で夜は空の光が弱まる
const sharedUniforms = { uDaylight: { value: 1 } };
function patchMaterial(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDaylight = sharedUniforms.uDaylight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float skyLight;\nattribute float blockLight;\nvarying vec2 vLight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLight = vec2(skyLight, blockLight);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLight;\nuniform float uDaylight;')
      .replace('#include <opaque_fragment>', [
        // Minecraft と同じ明るさカーブ: level/15 = f のとき f / (4 - 3f)
        'float skyT = vLight.x * uDaylight;',
        'float skyFactor = mix(0.04, 1.0, skyT / (4.0 - 3.0 * skyT));',
        'float torchT = vLight.y;',
        'vec3 torchLight = diffuseColor.rgb * (torchT / (4.0 - 3.0 * torchT)) * vec3(1.15, 0.95, 0.7);',
        'outgoingLight = max(outgoingLight * skyFactor, torchLight);',
        '#include <opaque_fragment>',
      ].join('\n'));
  };
  return material;
}

export class World {
  constructor(seed = 1) {
    this.seed = seed;
    this.size = WORLD_CHUNKS * CHUNK_SIZE;
    this.data = new Uint8Array(this.size * this.size * WORLD_HEIGHT);
    this.edits = new Map(); // "x,y,z" -> id (セーブ用の差分)
    this.chunks = new Map(); // "cx,cz" -> { group, dirty }
    this.group = new THREE.Group();
    this.lighting = new Lighting(this);

    const { texture } = createAtlas();
    this.materials = {
      opaque: patchMaterial(new THREE.MeshLambertMaterial({ map: texture, vertexColors: true })),
      cutout: patchMaterial(new THREE.MeshLambertMaterial({ map: texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide })),
      water: patchMaterial(new THREE.MeshLambertMaterial({ map: texture, vertexColors: true, transparent: true, opacity: 0.65, depthWrite: false })),
    };
  }

  // 0 (夜) 〜 1 (昼)。Minecraft の夜は空の光が 4/15 程度まで下がる
  setDaylight(d) {
    sharedUniforms.uDaylight.value = 0.45 + 0.55 * d;
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

  // プレイヤー操作によるブロック変更 (差分を記録し、光とチャンクを更新)
  set(x, y, z, id, updateLight = true) {
    if (!this.inBounds(x, y, z)) return false;
    const i = this.index(x, y, z);
    const old = this.data[i];
    if (old === id) return false;
    this.data[i] = id;
    this.edits.set(`${x},${y},${z}`, id);
    this.markDirtyAround(x, z);
    if (updateLight && (isOpaque(old) !== isOpaque(id) || (BLOCKS[old]?.light ?? 0) !== (BLOCKS[id]?.light ?? 0))) {
      this.lighting.updateAround(x, z);
    }
    return true;
  }

  // 爆発: 半径内のブロックを壊し、ドロップ候補を返す
  explode(cx, cy, cz, radius, rand = Math.random) {
    const drops = [];
    const r2 = radius * radius;
    for (let x = Math.floor(cx - radius); x <= Math.floor(cx + radius); x++) {
      for (let y = Math.floor(cy - radius); y <= Math.floor(cy + radius); y++) {
        for (let z = Math.floor(cz - radius); z <= Math.floor(cz + radius); z++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          const id = this.get(x, y, z);
          if (id === BLOCK.AIR || id === BLOCK.WATER || BLOCKS[id].unbreakable) continue;
          this.set(x, y, z, BLOCK.AIR, false);
          const def = BLOCKS[id];
          if (def.drop && rand() < 0.3) drops.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, item: def.drop });
        }
      }
    }
    this.lighting.updateAround(Math.floor(cx), Math.floor(cz));
    return drops;
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

  // 実効的な明るさ (0-15): 光源と、時間帯で弱まる空の光の大きい方
  lightLevel(x, y, z, daylight) {
    const sky = this.lighting.skyAt(x, y, z);
    const block = this.lighting.blockAt(x, y, z);
    return Math.max(block, Math.round(sky * daylight));
  }

  // ---------- 地形生成 ----------
  generate() {
    const heightNoise = new Perlin2D(this.seed);
    const detailNoise = new Perlin2D(this.seed + 101);
    const biomeNoise = new Perlin2D(this.seed + 202);
    const rand = mulberry32(this.seed + 303);
    const size = this.size;
    const heights = new Uint8Array(size * size);
    this.heights = heights;

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
        if (h > SEA_LEVEL + 1 && detailNoise.noise(x / 9 + 50, z / 9 + 50) > 0.55) {
          this.data[this.index(x, h, z)] = BLOCK.GRAVEL;
        }
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          this.data[this.index(x, y, z)] = BLOCK.WATER;
        }
      }
    }

    // 鉱石 (石の中にかたまりで配置)
    for (let x = 1; x < size - 1; x++) {
      for (let z = 1; z < size - 1; z++) {
        const h = heights[x * size + z];
        for (let y = 2; y < h - 3; y++) {
          const r = rand();
          if (y < 44 && r < 0.0035) this.placeVein(x, y, z, BLOCK.COAL_ORE, 4 + Math.floor(rand() * 6), rand);
          else if (y < 30 && r < 0.0035 + 0.0022) this.placeVein(x, y, z, BLOCK.IRON_ORE, 3 + Math.floor(rand() * 4), rand);
        }
      }
    }

    // 洞窟 (ランダムウォークで掘る)
    const worms = 36;
    for (let w = 0; w < worms; w++) {
      let x = rand() * size, z = rand() * size;
      let y = 6 + rand() * 24;
      let yaw = rand() * Math.PI * 2;
      let pitch = (rand() - 0.5) * 0.6;
      const steps = 50 + Math.floor(rand() * 90);
      for (let s = 0; s < steps; s++) {
        const radius = 1.4 + rand() * 1.2;
        this.carve(x, y, z, radius);
        yaw += (rand() - 0.5) * 0.7;
        pitch += (rand() - 0.5) * 0.4;
        pitch = Math.max(-0.7, Math.min(0.7, pitch));
        x += Math.cos(yaw) * Math.cos(pitch);
        z += Math.sin(yaw) * Math.cos(pitch);
        y += Math.sin(pitch);
        if (y < 3) { y = 3; pitch = Math.abs(pitch); }
        if (x < 2 || z < 2 || x > size - 3 || z > size - 3) break;
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

  placeVein(x, y, z, id, count, rand) {
    let cx = x, cy = y, cz = z;
    for (let i = 0; i < count; i++) {
      if (this.get(cx, cy, cz) === BLOCK.STONE) this.setRaw(cx, cy, cz, id);
      cx += Math.floor(rand() * 3) - 1;
      cy += Math.floor(rand() * 3) - 1;
      cz += Math.floor(rand() * 3) - 1;
    }
  }

  carve(cx, cy, cz, radius) {
    const size = this.size;
    const r2 = radius * radius;
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
        for (let z = Math.floor(cz - radius); z <= Math.ceil(cz + radius); z++) {
          if (!this.inBounds(x, y, z) || y <= 1) continue;
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          const h = this.heights[x * size + z];
          // 海の下は天井を残す。陸地なら地表に入口ができてもよい
          if (y >= h - 1 && h <= SEA_LEVEL + 2) continue;
          const id = this.data[this.index(x, y, z)];
          if (id === BLOCK.WATER || id === BLOCK.BEDROCK) continue;
          this.data[this.index(x, y, z)] = BLOCK.AIR;
        }
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
      if (id !== BLOCK.AIR && id !== BLOCK.WATER && id !== BLOCK.TORCH) return y;
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
    this.lighting.computeAll();
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

    const make = () => ({ pos: [], nor: [], uv: [], col: [], sky: [], blk: [], idx: [] });
    const buffers = { opaque: make(), cutout: make(), water: make() };

    const x0 = chunk.cx * CHUNK_SIZE;
    const z0 = chunk.cz * CHUNK_SIZE;

    for (let x = x0; x < x0 + CHUNK_SIZE; x++) {
      for (let z = z0; z < z0 + CHUNK_SIZE; z++) {
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const id = this.data[this.index(x, y, z)];
          if (id === BLOCK.AIR) continue;
          const def = BLOCKS[id];
          const buf = buffers[def.layer];

          if (def.model === 'torch') {
            this.addTorch(buf, x, y, z, def);
            continue;
          }

          for (let f = 0; f < FACES.length; f++) {
            const face = FACES[f];
            const nx = x + face.dir[0], ny = y + face.dir[1], nz = z + face.dir[2];
            const neighbor = this.get(nx, ny, nz);
            if (!this.faceVisible(id, neighbor, ny)) continue;

            const tile = def.tiles[face.side] ?? def.tiles[2];
            const [u0, v0, u1, v1] = tileUV(tile);
            const shade = FACE_SHADE[f];
            const base = buf.pos.length / 3;

            for (const c of face.corners) {
              buf.pos.push(x + c[0], y + c[1], z + c[2]);
              buf.nor.push(face.dir[0], face.dir[1], face.dir[2]);
              buf.uv.push(c[3] ? u1 : u0, c[4] ? v1 : v0);
              const { ao, sky, blk } = this.vertexLight(x, y, z, face.dir, c, def.layer === 'water');
              const light = shade * ao;
              buf.col.push(light, light, light);
              buf.sky.push(sky);
              buf.blk.push(blk);
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
      geo.setAttribute('skyLight', new THREE.Float32BufferAttribute(b.sky, 1));
      geo.setAttribute('blockLight', new THREE.Float32BufferAttribute(b.blk, 1));
      geo.setIndex(b.idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.materials[layer]);
      mesh.renderOrder = layer === 'water' ? 2 : layer === 'cutout' ? 1 : 0;
      this.group.add(mesh);
      chunk.meshes.push(mesh);
    }
  }

  // たいまつ: 幅 2/16・高さ 10/16 の柱
  addTorch(buf, x, y, z, def) {
    const s = 1 / ATLAS_TILES;
    const tile = def.tiles[0];
    const tx = (tile % ATLAS_TILES) * s;
    const ty = Math.floor(tile / ATLAS_TILES) * s;
    const p = 1 / TILE_PX;
    const lo = 7 / 16, hi = 9 / 16, top = 10 / 16;
    const sky = this.lighting.skyAt(x, y, z) / 15;
    const blk = this.lighting.blockAt(x, y, z) / 15;
    const push = (corners, dir, uvs, shade) => {
      const base = buf.pos.length / 3;
      corners.forEach((c, i) => {
        buf.pos.push(x + c[0], y + c[1], z + c[2]);
        buf.nor.push(...dir);
        buf.uv.push(uvs[i][0], uvs[i][1]);
        buf.col.push(shade, shade, shade);
        buf.sky.push(sky);
        buf.blk.push(Math.max(blk, 0.9));
      });
      buf.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    };
    // 側面の UV: タイルの x=7..9 px, y=0..10 px
    const su0 = tx + 7 * p * s, su1 = tx + 9 * p * s;
    const sv1 = 1 - ty, sv0 = 1 - (ty + 10 * p * s);
    const sideUV = [[su0, sv1], [su0, sv0], [su1, sv1], [su1, sv0]];
    push([[lo, top, lo], [lo, 0, lo], [lo, top, hi], [lo, 0, hi]], [-1, 0, 0], sideUV, 0.85);
    push([[hi, top, hi], [hi, 0, hi], [hi, top, lo], [hi, 0, lo]], [1, 0, 0], sideUV, 0.85);
    push([[hi, 0, lo], [lo, 0, lo], [hi, top, lo], [lo, top, lo]], [0, 0, -1], [[su0, sv0], [su1, sv0], [su0, sv1], [su1, sv1]], 0.85);
    push([[lo, 0, hi], [hi, 0, hi], [lo, top, hi], [hi, top, hi]], [0, 0, 1], [[su0, sv0], [su1, sv0], [su0, sv1], [su1, sv1]], 0.85);
    // 上面: 炎の部分 (x=7..9, y=0..2)
    const tu0 = su0, tu1 = su1, tv1 = 1 - ty, tv0 = 1 - (ty + 2 * p * s);
    push([[lo, top, hi], [hi, top, hi], [lo, top, lo], [hi, top, lo]], [0, 1, 0], [[tu1, tv1], [tu0, tv1], [tu1, tv0], [tu0, tv0]], 1.0);
  }

  faceVisible(id, neighbor, ny) {
    if (ny < 0) return false;
    if (neighbor === BLOCK.AIR) return true;
    if (isOpaque(neighbor)) return false;
    if (neighbor === id) return false;
    return true;
  }

  // 頂点ごとの環境遮蔽 (0fps の手法) と、周囲 4 セルを平均した滑らかな光
  vertexLight(x, y, z, dir, corner, isWater) {
    const axis = dir[0] !== 0 ? 0 : dir[1] !== 0 ? 1 : 2;
    const a = axis === 0 ? 1 : 0;
    const b = axis === 2 ? 1 : 2;
    const pos = [x + dir[0], y + dir[1], z + dir[2]];
    const sa = corner[a] ? 1 : -1;
    const sb = corner[b] ? 1 : -1;
    const p1 = pos.slice(); p1[a] += sa;
    const p2 = pos.slice(); p2[b] += sb;
    const p3 = pos.slice(); p3[a] += sa; p3[b] += sb;
    const cells = [pos, p1, p2, p3];
    let s1 = 0, s2 = 0, s3 = 0;
    let sky = 0, blk = 0, n = 0;
    for (let i = 0; i < 4; i++) {
      const c = cells[i];
      const opaque = isOpaque(this.get(c[0], c[1], c[2]));
      if (i === 1) s1 = opaque ? 1 : 0;
      else if (i === 2) s2 = opaque ? 1 : 0;
      else if (i === 3) s3 = opaque ? 1 : 0;
      if (opaque) continue;
      sky += this.lighting.skyAt(c[0], c[1], c[2]);
      blk += this.lighting.blockAt(c[0], c[1], c[2]);
      n++;
    }
    const occlusion = s1 && s2 ? 3 : s1 + s2 + s3;
    const ao = isWater ? 1 : 1 - occlusion * 0.15;
    if (n === 0) return { ao, sky: 0, blk: 0 };
    return { ao, sky: sky / n / 15, blk: blk / n / 15 };
  }
}
