import * as THREE from 'three';
import { BLOCK, BLOCKS, OPAQUE, LIGHT, blockId, faceTile, tileUV, createAtlas, FLOWER_NAMES } from './blocks.js';
import { shapeBoxes } from './shapes.js';
import { Perlin2D, mulberry32 } from './noise.js';
import { Lighting } from './lighting.js';
import { CHUNK_SIZE, WORLD_HEIGHT, WORLD_CHUNKS, SEA_LEVEL } from './constants.js';

export { CHUNK_SIZE, WORLD_HEIGHT, WORLD_CHUNKS, SEA_LEVEL };

// 各面の定義 (three.js のボクセル解説と同じ頂点順序)
const FACES = [
  { dir: [-1, 0, 0], corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];

// 面の向きごとの明るさ (上面が一番明るい)
const FACE_SHADE = [0.8, 0.8, 0.5, 1.0, 0.7, 0.7];
const LAYERS = ['opaque', 'cutout', 'translucent', 'water'];

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

// 木の種類ごとの形
const TREE_SHAPES = {
  oak: { trunk: [4, 6], canopy: 'blob', r: 2 },
  birch: { trunk: [5, 7], canopy: 'blob', r: 2 },
  spruce: { trunk: [6, 9], canopy: 'cone' },
  jungle: { trunk: [8, 11], canopy: 'blob', r: 3 },
  acacia: { trunk: [4, 5], canopy: 'flat', r: 3, bend: true },
  dark_oak: { trunk: [5, 6], canopy: 'blob', r: 3 },
  mangrove: { trunk: [5, 7], canopy: 'blob', r: 2 },
  cherry: { trunk: [4, 5], canopy: 'flat', r: 3 },
};

export class World {
  constructor(seed = 1) {
    this.seed = seed;
    this.size = WORLD_CHUNKS * CHUNK_SIZE;
    this.data = new Uint16Array(this.size * this.size * WORLD_HEIGHT);
    this.meta = new Uint8Array(this.size * this.size * WORLD_HEIGHT);
    this.edits = new Map(); // "x,y,z" -> [id, meta] (セーブ用の差分)
    this.containers = new Map(); // "x,y,z" -> スロット配列 (チェスト・樽)
    this.saplings = new Set(); // "x,y,z"
    this.onChange = null; // (x, y, z, id, meta) ブロックが変わったとき (マルチプレイの同期用)
    this.chunks = new Map();
    this.group = new THREE.Group();
    this.lighting = new Lighting(this);

    const { texture } = createAtlas();
    this.materials = {
      opaque: patchMaterial(new THREE.MeshLambertMaterial({ map: texture, vertexColors: true })),
      cutout: patchMaterial(new THREE.MeshLambertMaterial({ map: texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide })),
      translucent: patchMaterial(new THREE.MeshLambertMaterial({ map: texture, vertexColors: true, transparent: true, alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide })),
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

  getMeta(x, y, z) {
    if (!this.inBounds(x, y, z)) return 0;
    return this.meta[this.index(x, y, z)];
  }

  setRaw(x, y, z, id, meta = 0) {
    if (!this.inBounds(x, y, z)) return;
    const i = this.index(x, y, z);
    this.data[i] = id;
    this.meta[i] = meta;
  }

  // プレイヤー操作によるブロック変更 (差分を記録し、光とチャンクを更新)
  set(x, y, z, id, meta = 0, updateLight = true) {
    if (!this.inBounds(x, y, z)) return false;
    const i = this.index(x, y, z);
    const old = this.data[i];
    if (old === id && this.meta[i] === meta) return false;
    this.data[i] = id;
    this.meta[i] = meta;
    const key = `${x},${y},${z}`;
    this.edits.set(key, [id, meta]);
    if (BLOCKS[old]?.sapling) this.saplings.delete(key);
    if (BLOCKS[id]?.sapling) this.saplings.add(key);
    this.markDirtyAround(x, z);
    if (updateLight && (OPAQUE[old] !== OPAQUE[id] || LIGHT[old] !== LIGHT[id])) this.lighting.updateAround(x, z);
    this.onChange?.(x, y, z, id, meta);
    return true;
  }

  // 他のプレイヤーからのブロック変更をまとめて反映する (通知はしない)
  applyRemote(list) {
    const hook = this.onChange;
    this.onChange = null;
    const regions = new Map();
    for (const [x, y, z, id, meta] of list) {
      if (!BLOCKS[id]) continue;
      const old = this.get(x, y, z);
      if (this.set(x, y, z, id, meta ?? 0, false) && (OPAQUE[old] !== OPAQUE[id] || LIGHT[old] !== LIGHT[id])) {
        regions.set(`${x >> 3},${z >> 3}`, [x, z]);
      }
    }
    for (const [x, z] of regions.values()) this.lighting.updateAround(x, z);
    this.onChange = hook;
  }

  setMeta(x, y, z, meta) {
    const id = this.get(x, y, z);
    return this.set(x, y, z, id, meta, false);
  }

  // 爆発: 半径内のブロックを壊す。壊した各ブロックについて onRemove(x, y, z, id, meta) を呼ぶ
  explode(cx, cy, cz, radius, onRemove) {
    const r2 = radius * radius;
    for (let x = Math.floor(cx - radius); x <= Math.floor(cx + radius); x++) {
      for (let y = Math.floor(cy - radius); y <= Math.floor(cy + radius); y++) {
        for (let z = Math.floor(cz - radius); z <= Math.floor(cz + radius); z++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          const id = this.get(x, y, z);
          if (id === BLOCK.AIR || id === BLOCK.WATER || BLOCKS[id].unbreakable) continue;
          const meta = this.getMeta(x, y, z);
          this.set(x, y, z, BLOCK.AIR, 0, false);
          onRemove?.(x, y, z, id, meta);
        }
      }
    }
    this.lighting.updateAround(Math.floor(cx), Math.floor(cz));
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
    const forestNoise = new Perlin2D(this.seed + 404);
    const flowerNoise = new Perlin2D(this.seed + 505);
    const rand = mulberry32(this.seed + 303);
    const size = this.size;
    const heights = new Uint8Array(size * size);
    this.heights = heights;
    const ID = {
      deepslate: blockId('deepslate'), clay: blockId('clay'), shortGrass: blockId('short_grass'), fern: blockId('fern'),
      sugarCane: blockId('sugar_cane'), pumpkin: blockId('pumpkin'), redMushroom: blockId('red_mushroom'), brownMushroom: blockId('brown_mushroom'),
    };
    const flowers = FLOWER_NAMES.map(blockId);

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
          if (y === 0 || (y === 1 && rand() < 0.4)) id = BLOCK.BEDROCK;
          else if (y < h - 3) id = y < 8 || (y < 12 && rand() < (12 - y) / 5) ? ID.deepslate : BLOCK.STONE;
          else if (y < h) id = h <= SEA_LEVEL + 1 ? BLOCK.SAND : BLOCK.DIRT;
          else if (h <= SEA_LEVEL + 1) id = BLOCK.SAND;
          else if (h >= 48) id = BLOCK.SNOW;
          else id = BLOCK.GRASS;
          this.data[this.index(x, y, z)] = id;
        }
        if (h > SEA_LEVEL + 1 && detailNoise.noise(x / 9 + 50, z / 9 + 50) > 0.55) {
          this.data[this.index(x, h, z)] = BLOCK.GRAVEL;
        }
        if (h <= SEA_LEVEL - 2 && detailNoise.noise(x / 7 + 100, z / 7 + 100) > 0.4) {
          this.data[this.index(x, h, z)] = ID.clay;
        }
        for (let y = h + 1; y <= SEA_LEVEL; y++) this.data[this.index(x, y, z)] = BLOCK.WATER;
      }
    }

    // 鉱石: [名前, 最低 y, 最高 y, 確率, 最小数, 最大数]
    const ORE_RULES = [
      ['coal', 5, 50, 0.004, 5, 10], ['copper', 10, 45, 0.0025, 4, 8], ['iron', 2, 40, 0.003, 3, 6],
      ['lapis', 2, 25, 0.0008, 3, 6], ['gold', 2, 22, 0.0008, 3, 6], ['redstone', 2, 14, 0.0012, 4, 7],
      ['diamond', 2, 12, 0.0005, 2, 5], ['emerald', 30, 60, 0.0004, 1, 1],
    ].map(([k, lo, hi, p, a, b]) => ({ stone: blockId(`${k}_ore`), deep: blockId(`deepslate_${k}_ore`), lo, hi, p, a, b }));
    for (let x = 1; x < size - 1; x++) {
      for (let z = 1; z < size - 1; z++) {
        const h = heights[x * size + z];
        for (let y = 2; y < h - 3; y++) {
          let r = rand();
          for (const o of ORE_RULES) {
            if (y < o.lo || y > o.hi) continue;
            if (r < o.p) { this.placeVein(x, y, z, o, o.a + Math.floor(rand() * (o.b - o.a + 1)), rand); break; }
            r -= o.p;
          }
        }
      }
    }

    // 洞窟 (ランダムウォークで掘る)
    for (let w = 0; w < 36; w++) {
      let x = rand() * size, z = rand() * size;
      let y = 6 + rand() * 24;
      let yaw = rand() * Math.PI * 2;
      let pitch = (rand() - 0.5) * 0.6;
      const steps = 50 + Math.floor(rand() * 90);
      for (let s = 0; s < steps; s++) {
        this.carve(x, y, z, 1.4 + rand() * 1.2);
        yaw += (rand() - 0.5) * 0.7;
        pitch = Math.max(-0.7, Math.min(0.7, pitch + (rand() - 0.5) * 0.4));
        x += Math.cos(yaw) * Math.cos(pitch);
        z += Math.sin(yaw) * Math.cos(pitch);
        y += Math.sin(pitch);
        if (y < 3) { y = 3; pitch = Math.abs(pitch); }
        if (x < 2 || z < 2 || x > size - 3 || z > size - 3) break;
      }
    }

    // 木と植物
    for (let x = 3; x < size - 3; x++) {
      for (let z = 3; z < size - 3; z++) {
        const h = heights[x * size + z];
        const top = this.data[this.index(x, h, z)];
        if (this.data[this.index(x, h + 1, z)] !== BLOCK.AIR) continue;
        if (top === BLOCK.GRASS) {
          const density = 0.006 + Math.max(0, biomeNoise.noise(x / 40, z / 40)) * 0.03;
          const type = h >= 44 ? 'spruce' : flowerNoise.noise(x / 50 + 30, z / 50 + 30) > 0.45 ? 'cherry' : forestNoise.noise(x / 60, z / 60) > 0.2 ? 'birch' : 'oak';
          const r = rand();
          if (r < density) { this.placeTree(type, x, h + 1, z, rand, true); continue; }
          if (r < density + 0.12) this.data[this.index(x, h + 1, z)] = type === 'spruce' && rand() < 0.6 ? ID.fern : ID.shortGrass;
          else if (r < density + 0.14) {
            const f = Math.floor(((flowerNoise.noise(x / 12, z / 12) + 1) / 2) * flowers.length);
            this.data[this.index(x, h + 1, z)] = flowers[Math.max(0, Math.min(flowers.length - 1, f))];
          } else if (r < density + 0.1415) this.data[this.index(x, h + 1, z)] = ID.pumpkin;
          else if (r < density + 0.1425 && forestNoise.noise(x / 60, z / 60) > 0.3) this.data[this.index(x, h + 1, z)] = rand() < 0.5 ? ID.redMushroom : ID.brownMushroom;
        } else if (top === BLOCK.SNOW) {
          if (rand() < 0.01) this.placeTree('spruce', x, h + 1, z, rand, true);
        } else if ((top === BLOCK.SAND || top === BLOCK.GRASS) && h === SEA_LEVEL) {
          // 水辺のサトウキビ
          const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => this.data[this.index(x + dx, h, z + dz)] === BLOCK.WATER);
          if (nearWater && rand() < 0.08) {
            const n = 1 + Math.floor(rand() * 3);
            for (let k = 1; k <= n; k++) this.data[this.index(x, h + k, z)] = ID.sugarCane;
          }
        }
      }
    }
  }

  placeVein(x, y, z, ore, count, rand) {
    let cx = x, cy = y, cz = z;
    for (let i = 0; i < count; i++) {
      const cur = this.get(cx, cy, cz);
      if (cur === BLOCK.STONE) this.setRaw(cx, cy, cz, ore.stone);
      else if (cur === blockId('deepslate')) this.setRaw(cx, cy, cz, ore.deep);
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
          if (y >= h - 1 && h <= SEA_LEVEL + 2) continue;
          const id = this.data[this.index(x, y, z)];
          if (id === BLOCK.WATER || id === BLOCK.BEDROCK) continue;
          this.data[this.index(x, y, z)] = BLOCK.AIR;
        }
      }
    }
  }

  // 木を生やす。gen=true は地形生成中 (差分を記録しない)。置けたら true
  placeTree(type, x, y, z, rand, gen = false) {
    const shape = TREE_SHAPES[type] ?? TREE_SHAPES.oak;
    const log = blockId(type === 'crimson' || type === 'warped' ? `${type}_stem` : `${type}_log`);
    const leaves = blockId(`${type}_leaves`);
    const trunk = shape.trunk[0] + Math.floor(rand() * (shape.trunk[1] - shape.trunk[0] + 1));
    const canPlace = (bx, by, bz) => {
      const id = this.get(bx, by, bz);
      return this.inBounds(bx, by, bz) && (id === BLOCK.AIR || BLOCKS[id].shape === 'cross' || id === leaves || BLOCKS[id].sapling);
    };
    if (!gen) {
      for (let i = 1; i < trunk + 2; i++) if (!canPlace(x, y + i, z)) return false;
      if (y + trunk + 3 >= WORLD_HEIGHT) return false;
    }
    const put = (bx, by, bz, id, meta = 0) => {
      if (gen) this.setRaw(bx, by, bz, id, meta);
      else this.set(bx, by, bz, id, meta, false);
    };
    let tx = x, tz = z;
    for (let i = 0; i < trunk; i++) {
      if (shape.bend && i === trunk - 2) { tx += 1; }
      if (shape.bend && i === trunk - 1) { tz += 1; }
      put(tx, y + i, tz, log);
    }
    const top = y + trunk - 1;
    const leaf = (bx, by, bz) => { if (canPlace(bx, by, bz) && !(bx === tx && bz === tz && by <= top)) put(bx, by, bz, leaves); };
    if (shape.canopy === 'cone') {
      const layers = [0, 1, 1, 2, 1, 2, 2, 3, 2];
      for (let k = 0; k < Math.min(layers.length, trunk + 1); k++) {
        const r = layers[k];
        const by = top + 1 - k;
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > r + 1) continue;
          leaf(tx + dx, by, tz + dz);
        }
      }
    } else if (shape.canopy === 'flat') {
      const r = shape.r;
      for (let dy = 0; dy <= 1; dy++) {
        const rr = dy === 1 ? r - 1 : r;
        for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
          if (Math.abs(dx) === rr && Math.abs(dz) === rr) continue;
          leaf(tx + dx, top + dy, tz + dz);
        }
      }
    } else {
      const R = shape.r;
      for (let dy = -2; dy <= 2; dy++) {
        const r = dy >= 1 ? Math.max(1, R - 1) : R;
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === 2 || rand() < 0.5)) continue;
            leaf(tx + dx, top + dy, tz + dz);
          }
        }
      }
    }
    if (!gen) this.lighting.updateAround(x, z);
    return true;
  }

  // 苗木を木に成長させる
  growSapling(x, y, z, rand = Math.random) {
    const def = BLOCKS[this.get(x, y, z)];
    if (!def?.sapling) return false;
    this.set(x, y, z, BLOCK.AIR, 0, false);
    const ok = this.placeTree(def.sapling, x, y, z, rand, false);
    if (!ok) this.set(x, y, z, def.id, 0, false);
    return ok;
  }

  // 地表の高さ (スポーン位置決定用)
  surfaceHeight(x, z) {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const id = this.get(x, y, z);
      if (id !== BLOCK.AIR && id !== BLOCK.WATER && BLOCKS[id].solid) return y;
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
          if (!BLOCKS[top].opaque || BLOCKS[top].name.endsWith('_log') || y <= SEA_LEVEL) continue;
          let clear = true;
          for (let ox = -1; ox <= 1 && clear; ox++) {
            for (let oz = -1; oz <= 1 && clear; oz++) {
              for (let oy = 1; oy <= 3; oy++) {
                const id = this.get(x + ox, y + oy, z + oz);
                if (id !== BLOCK.AIR && BLOCKS[id].solid) { clear = false; break; }
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
    for (const e of list) {
      const [x, y, z, id] = e;
      const meta = e[4] ?? 0;
      if (!this.inBounds(x, y, z) || !BLOCKS[id]) continue;
      const i = this.index(x, y, z);
      this.data[i] = id;
      this.meta[i] = meta;
      const key = `${x},${y},${z}`;
      this.edits.set(key, [id, meta]);
      if (BLOCKS[id].sapling) this.saplings.add(key);
    }
  }

  serializeEdits() {
    const out = [];
    for (const [key, [id, meta]] of this.edits) {
      const [x, y, z] = key.split(',').map(Number);
      out.push(meta ? [x, y, z, id, meta] : [x, y, z, id]);
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
    const buffers = { opaque: make(), cutout: make(), translucent: make(), water: make() };
    const x0 = chunk.cx * CHUNK_SIZE;
    const z0 = chunk.cz * CHUNK_SIZE;

    for (let x = x0; x < x0 + CHUNK_SIZE; x++) {
      for (let z = z0; z < z0 + CHUNK_SIZE; z++) {
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const i = this.index(x, y, z);
          const id = this.data[i];
          if (id === BLOCK.AIR) continue;
          const def = BLOCKS[id];
          const buf = buffers[def.layer];
          if (!buf) continue;
          const meta = this.meta[i];
          switch (def.shape) {
            case 'cube': this.addCube(buf, x, y, z, id, meta, def); break;
            case 'cross': this.addCross(buf, x, y, z, id); break;
            case 'torch': this.addTorch(buf, x, y, z, id); break;
            default: {
              const boxes = shapeBoxes(this, x, y, z, id, meta, 'render');
              for (const b of boxes) this.addBox(buf, x, y, z, id, meta, b);
            }
          }
        }
      }
    }

    LAYERS.forEach((layer, order) => {
      const b = buffers[layer];
      if (b.idx.length === 0) return;
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
      mesh.renderOrder = order;
      this.group.add(mesh);
      chunk.meshes.push(mesh);
    });
  }

  addCube(buf, x, y, z, id, meta, def) {
    const isWater = def.layer === 'water';
    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      const ny = y + face.dir[1];
      const neighbor = this.get(x + face.dir[0], ny, z + face.dir[2]);
      if (!this.faceVisible(id, neighbor, ny)) continue;
      const [u0, v0, u1, v1] = tileUV(faceTile(id, f, meta));
      const shade = FACE_SHADE[f];
      const base = buf.pos.length / 3;
      for (const c of face.corners) {
        buf.pos.push(x + c[0], y + c[1], z + c[2]);
        buf.nor.push(face.dir[0], face.dir[1], face.dir[2]);
        buf.uv.push(c[3] ? u1 : u0, c[4] ? v1 : v0);
        const { ao, sky, blk } = this.vertexLight(x, y, z, face.dir, c, isWater);
        const light = shade * ao;
        buf.col.push(light, light, light);
        buf.sky.push(sky);
        buf.blk.push(blk);
      }
      buf.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }

  // 任意の直方体 b (ブロック内ローカル座標) を描く。UV はボックスの位置に合わせて切り出す
  addBox(buf, x, y, z, id, meta, b) {
    const cellSky = this.lighting.skyAt(x, y, z), cellBlk = this.lighting.blockAt(x, y, z);
    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      const boundary = (f === 0 && b[0] <= 0) || (f === 1 && b[3] >= 1) || (f === 2 && b[1] <= 0) ||
        (f === 3 && b[4] >= 1) || (f === 4 && b[2] <= 0) || (f === 5 && b[5] >= 1);
      let sky = cellSky, blk = cellBlk;
      if (boundary) {
        const nx = x + face.dir[0], ny = y + face.dir[1], nz = z + face.dir[2];
        const n = this.get(nx, ny, nz);
        if (OPAQUE[n]) continue;
        if (ny < 0) continue;
        sky = Math.max(sky, this.lighting.skyAt(nx, ny, nz));
        blk = Math.max(blk, this.lighting.blockAt(nx, ny, nz));
      }
      const [u0, v0, u1, v1] = tileUV(faceTile(id, f, meta));
      const shade = FACE_SHADE[f];
      const base = buf.pos.length / 3;
      for (const c of face.corners) {
        const lx = c[0] ? b[3] : b[0], ly = c[1] ? b[4] : b[1], lz = c[2] ? b[5] : b[2];
        let u, v;
        switch (f) {
          case 0: u = lz; v = ly; break;
          case 1: u = 1 - lz; v = ly; break;
          case 2: u = lx; v = 1 - lz; break;
          case 3: u = 1 - lx; v = lz; break;
          case 4: u = 1 - lx; v = ly; break;
          default: u = lx; v = ly;
        }
        v = Math.min(1, v);
        buf.pos.push(x + lx, y + ly, z + lz);
        buf.nor.push(face.dir[0], face.dir[1], face.dir[2]);
        buf.uv.push(u0 + u * (u1 - u0), v0 + v * (v1 - v0));
        buf.col.push(shade, shade, shade);
        buf.sky.push(sky / 15);
        buf.blk.push(blk / 15);
      }
      buf.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }

  // 草花: 対角線に交差した 2 枚の板
  addCross(buf, x, y, z, id) {
    const [u0, v0, u1, v1] = tileUV(faceTile(id, 4, 0));
    const sky = this.lighting.skyAt(x, y, z) / 15, blk = Math.max(this.lighting.blockAt(x, y, z), LIGHT[id]) / 15;
    const a = 0.15, b = 0.85;
    const quads = [
      [[a, 0, a], [b, 0, b], [a, 1, a], [b, 1, b]],
      [[a, 0, b], [b, 0, a], [a, 1, b], [b, 1, a]],
    ];
    for (const q of quads) {
      const base = buf.pos.length / 3;
      const uvs = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]];
      q.forEach((p, k) => {
        buf.pos.push(x + p[0], y + p[1], z + p[2]);
        buf.nor.push(0, 1, 0);
        buf.uv.push(uvs[k][0], uvs[k][1]);
        buf.col.push(0.9, 0.9, 0.9);
        buf.sky.push(sky);
        buf.blk.push(blk);
      });
      buf.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }

  // 松明: 幅 2/16・高さ 10/16 の柱
  addTorch(buf, x, y, z, id) {
    const [u0, v0, u1, v1] = tileUV(faceTile(id, 4, 0));
    const du = u1 - u0, dv = v1 - v0;
    const lo = 7 / 16, hi = 9 / 16, top = 10 / 16;
    const sky = this.lighting.skyAt(x, y, z) / 15;
    const blk = Math.max(this.lighting.blockAt(x, y, z) / 15, 0.9);
    const push = (corners, dir, uvs, shade) => {
      const base = buf.pos.length / 3;
      corners.forEach((c, i) => {
        buf.pos.push(x + c[0], y + c[1], z + c[2]);
        buf.nor.push(...dir);
        buf.uv.push(uvs[i][0], uvs[i][1]);
        buf.col.push(shade, shade, shade);
        buf.sky.push(sky);
        buf.blk.push(blk);
      });
      buf.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    };
    const su0 = u0 + du * (7 / 16), su1 = u0 + du * (9 / 16);
    const sv1 = v1, sv0 = v1 - dv * (10 / 16);
    const sideUV = [[su0, sv1], [su0, sv0], [su1, sv1], [su1, sv0]];
    push([[lo, top, lo], [lo, 0, lo], [lo, top, hi], [lo, 0, hi]], [-1, 0, 0], sideUV, 0.85);
    push([[hi, top, hi], [hi, 0, hi], [hi, top, lo], [hi, 0, lo]], [1, 0, 0], sideUV, 0.85);
    push([[hi, 0, lo], [lo, 0, lo], [hi, top, lo], [lo, top, lo]], [0, 0, -1], [[su0, sv0], [su1, sv0], [su0, sv1], [su1, sv1]], 0.85);
    push([[lo, 0, hi], [hi, 0, hi], [lo, top, hi], [hi, top, hi]], [0, 0, 1], [[su0, sv0], [su1, sv0], [su0, sv1], [su1, sv1]], 0.85);
    const tv0 = v1 - dv * (2 / 16);
    push([[lo, top, hi], [hi, top, hi], [lo, top, lo], [hi, top, lo]], [0, 1, 0], [[su1, v1], [su0, v1], [su1, tv0], [su0, tv0]], 1.0);
  }

  faceVisible(id, neighbor, ny) {
    if (ny < 0) return false;
    if (neighbor === BLOCK.AIR) return true;
    if (OPAQUE[neighbor]) return false;
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
      const opaque = OPAQUE[this.get(c[0], c[1], c[2])] === 1;
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
