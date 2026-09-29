import * as THREE from 'three';
import { ITEMS, normalizeItemId } from './items.js';
import { faceTile, createAtlas, tileUV } from './blocks.js';
import { iconKind, isoHeight, iconMeta, spritePixels } from './icons.js';
import { moveEntity, feetInWater } from './physics.js';

const GRAVITY = 16;
const DESPAWN = 300; // 秒
const PICKUP_DELAY = 0.6;

const meshCache = new Map();
let blockMaterial = null;
const spriteMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

// アイテムの見た目。ブロックは小さな立体、それ以外はドット絵を押し出したもの
export function buildItemMesh(id) {
  if (meshCache.has(id)) return meshCache.get(id).clone();
  const def = ITEMS[id];
  let mesh;
  if (iconKind(id) === 'iso') {
    if (!blockMaterial) blockMaterial = new THREE.MeshLambertMaterial({ map: createAtlas().texture, alphaTest: 0.5, side: THREE.DoubleSide });
    const h = isoHeight(id);
    const geo = new THREE.BoxGeometry(1, h, 1);
    geo.translate(0, (h - 1) / 2, 0);
    const bid = def.block;
    const meta = iconMeta(bid);
    const uv = geo.attributes.uv;
    // BoxGeometry の面順: +x, -x, +y, -y, +z, -z → faceTile の面番号
    const FACE_MAP = [1, 0, 3, 2, 5, 4];
    for (let f = 0; f < 6; f++) {
      const [u0, v0, u1, v1] = tileUV(faceTile(bid, FACE_MAP[f], meta));
      const side = f !== 2 && f !== 3;
      const vTop = side ? v0 + (v1 - v0) * h : v1;
      const base = f * 4;
      uv.setXY(base, u0, vTop); uv.setXY(base + 1, u1, vTop); uv.setXY(base + 2, u0, v0); uv.setXY(base + 3, u1, v0);
    }
    mesh = new THREE.Mesh(geo, blockMaterial);
  } else {
    mesh = new THREE.Mesh(buildPixelGeometry(spritePixels(id)), spriteMaterial);
  }
  meshCache.set(id, mesh);
  return mesh.clone();
}

// ドット絵を 1 ピクセル = 1 個の薄い立方体として押し出す
export function buildPixelGeometry(pixel, depth = 0.6) {
  const pos = [], nor = [], col = [], idx = [];
  const s = 1 / 16;
  const d = s * depth;
  const faces = [
    { dir: [1, 0, 0], corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]], nb: [1, 0] },
    { dir: [-1, 0, 0], corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]], nb: [-1, 0] },
    { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]], nb: [0, -1] },
    { dir: [0, -1, 0], corners: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]], nb: [0, 1] },
    { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], nb: null },
    { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]], nb: null },
  ];
  const c = new THREE.Color();
  const at = (x, y) => (x < 0 || y < 0 || x > 15 || y > 15 ? null : pixel(x, y));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const color = pixel(x, y);
      if (color === null) continue;
      c.setHex(color);
      const px = x * s - 0.5;
      const py = (15 - y) * s - 0.5;
      for (const face of faces) {
        if (face.nb && at(x + face.nb[0], y + face.nb[1]) !== null) continue; // 内側の面は省く
        const base = pos.length / 3;
        for (const k of face.corners) {
          pos.push(px + k[0] * s, py + k[1] * s, (k[2] - 0.5) * d);
          nor.push(...face.dir);
          const shade = face.dir[2] !== 0 ? 1 : 0.75;
          col.push(c.r * shade, c.g * shade, c.b * shade);
        }
        idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

// 地面に落ちているアイテム
export class DropManager {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.items = [];
    this.time = 0;
    this.nextUid = 1;
    this.remote = false; // 参加者側: ホストの状態を表示するだけ
    this.onRequestSpawn = null; // 参加者側でアイテムを落としたときにホストへ頼む
  }

  spawn(id, count, x, y, z, velocity = null, damage = 0, uid = null) {
    if (!ITEMS[id] || count <= 0) return null;
    if (this.remote && uid === null) {
      const v = velocity ?? new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3);
      this.onRequestSpawn?.({ id, count, damage, x, y, z, vx: v.x, vy: v.y, vz: v.z });
      return null;
    }
    const mesh = buildItemMesh(id);
    mesh.scale.setScalar(iconKind(id) === 'iso' ? 0.25 : 0.35);
    const item = {
      uid: uid ?? this.nextUid++, id, count, damage, mesh,
      position: new THREE.Vector3(x, y, z),
      velocity: velocity ?? new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3),
      width: 0.25, height: 0.25, onGround: false, age: 0,
    };
    this.scene.add(mesh);
    this.items.push(item);
    return item;
  }

  spawnStacks(stacks, x, y, z) {
    for (const s of stacks) this.spawn(s.id, s.count, x, y, z, null, s.damage ?? 0);
  }

  update(dt, player, inventory, onPickup) {
    this.time += dt;
    if (this.remote) { this.updateMirror(dt); return; }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      if (feetInWater(this.world, it)) it.velocity.y += (1.5 - it.velocity.y) * Math.min(1, dt * 4);
      else it.velocity.y -= GRAVITY * dt;
      if (it.onGround) { it.velocity.x *= Math.exp(-dt * 8); it.velocity.z *= Math.exp(-dt * 8); }
      moveEntity(this.world, it, dt);
      it.mesh.position.set(it.position.x, it.position.y + 0.15 + Math.sin(this.time * 2 + i) * 0.05, it.position.z);
      it.mesh.rotation.y = this.time * 1.5 + i;

      if (it.age > PICKUP_DELAY && player && !player.dead) {
        const dx = it.position.x - player.position.x;
        const dy = it.position.y - player.position.y;
        const dz = it.position.z - player.position.z;
        if (dx * dx + dz * dz < 1.2 * 1.2 && dy > -0.8 && dy < 2) {
          const rest = inventory.add(it.id, it.count, it.damage);
          if (rest < it.count) onPickup?.(it.id, it.count - rest);
          if (rest === 0) { this.remove(i); continue; }
          it.count = rest;
        }
      }
      if (it.age > DESPAWN || it.position.y < -10) this.remove(i);
    }
  }

  // ホスト側: 別のプレイヤー (代理オブジェクト) が拾う。give(id, count, damage) を呼ぶ
  pickupFor(other, give) {
    if (other.dead || other.spectator) return;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.age <= PICKUP_DELAY) continue;
      const dx = it.position.x - other.position.x, dy = it.position.y - other.position.y, dz = it.position.z - other.position.z;
      if (dx * dx + dz * dz < 1.2 * 1.2 && dy > -0.8 && dy < 2) {
        give(it.id, it.count, it.damage);
        this.remove(i);
      }
    }
  }

  snapshot() {
    return this.items.map((it) => [it.uid, it.id, it.count, +it.position.x.toFixed(2), +it.position.y.toFixed(2), +it.position.z.toFixed(2)]);
  }

  applySnapshot(list) {
    const seen = new Set();
    for (const [uid, id, count, x, y, z] of list) {
      seen.add(uid);
      let it = this.items.find((k) => k.uid === uid);
      if (!it) { it = this.spawn(id, count, x, y, z, new THREE.Vector3(), 0, uid); if (!it) continue; }
      it.count = count;
      it.target = new THREE.Vector3(x, y, z);
    }
    for (let i = this.items.length - 1; i >= 0; i--) if (!seen.has(this.items[i].uid)) this.remove(i);
  }

  updateMirror(dt) {
    this.items.forEach((it, i) => {
      if (it.target) it.position.lerp(it.target, 1 - Math.exp(-dt * 10));
      it.mesh.position.set(it.position.x, it.position.y + 0.15 + Math.sin(this.time * 2 + i) * 0.05, it.position.z);
      it.mesh.rotation.y = this.time * 1.5 + i;
    });
  }

  remove(i) {
    const it = this.items[i];
    this.scene.remove(it.mesh);
    this.items.splice(i, 1);
  }

  clear() {
    for (const it of this.items) this.scene.remove(it.mesh);
    this.items = [];
  }

  serialize() {
    return this.items.map((it) => [it.id, it.count, +it.position.x.toFixed(2), +it.position.y.toFixed(2), +it.position.z.toFixed(2), it.damage || 0]);
  }

  load(list) {
    for (const [rawId, count, x, y, z, damage] of list ?? []) {
      const id = normalizeItemId(rawId);
      if (id) this.spawn(id, count, x, y, z, new THREE.Vector3(), damage ?? 0);
    }
  }
}
