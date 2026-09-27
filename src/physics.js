import { BLOCK, SOLID, FULL } from './blocks.js';
import { shapeBoxes } from './shapes.js';

// ---- エンティティの移動と衝突 ----
// エンティティ: position (足元の中心), velocity, width, height, stepHeight?, sneakGuard?
// Minecraft と同じく、ブロックの当たり判定ボックスに対して y → x → z の順に移動量を削り、
// 横でぶつかったときは stepHeight (プレイヤーは 0.6) までの段差を自動で上る。

const EPS = 1e-7;
const boxes = [];

// 範囲内のブロックの当たり判定を平らな配列 [x0,y0,z0,x1,y1,z1, ...] に集める
function gather(world, minX, minY, minZ, maxX, maxY, maxZ) {
  boxes.length = 0;
  const x0 = Math.floor(minX), x1 = Math.floor(maxX);
  const y0 = Math.floor(minY) - 1, y1 = Math.floor(maxY); // フェンスは 1.5 の高さがあるので 1 つ下も見る
  const z0 = Math.floor(minZ), z1 = Math.floor(maxZ);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        const id = world.get(x, y, z);
        if (!SOLID[id]) continue;
        if (FULL[id]) { boxes.push(x, y, z, x + 1, y + 1, z + 1); continue; }
        for (const b of shapeBoxes(world, x, y, z, id, world.getMeta(x, y, z), 'collision')) {
          boxes.push(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
        }
      }
    }
  }
  return boxes;
}

function clip(bb, axis, d) {
  if (d === 0) return 0;
  const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
  for (let i = 0; i < boxes.length; i += 6) {
    if (boxes[i + a1 + 3] <= bb[a1] + EPS || boxes[i + a1] >= bb[a1 + 3] - EPS) continue;
    if (boxes[i + a2 + 3] <= bb[a2] + EPS || boxes[i + a2] >= bb[a2 + 3] - EPS) continue;
    if (d > 0 && boxes[i + axis] >= bb[axis + 3] - EPS) {
      const m = boxes[i + axis] - bb[axis + 3];
      if (m < d) d = m;
    } else if (d < 0 && boxes[i + axis + 3] <= bb[axis] + EPS) {
      const m = boxes[i + axis + 3] - bb[axis];
      if (m > d) d = m;
    }
  }
  return d;
}

function overlapsAny(bb) {
  for (let i = 0; i < boxes.length; i += 6) {
    if (boxes[i] < bb[3] - EPS && boxes[i + 3] > bb[0] + EPS &&
        boxes[i + 1] < bb[4] - EPS && boxes[i + 4] > bb[1] + EPS &&
        boxes[i + 2] < bb[5] - EPS && boxes[i + 5] > bb[2] + EPS) return true;
  }
  return false;
}

function offset(bb, axis, d) {
  bb[axis] += d;
  bb[axis + 3] += d;
}

export function moveEntity(world, e, dt) {
  const p = e.position;
  const half = e.width / 2;
  let dx = e.velocity.x * dt, dy = e.velocity.y * dt, dz = e.velocity.z * dt;
  const step = e.stepHeight ?? 0;
  const bb = [p.x - half, p.y, p.z - half, p.x + half, p.y + e.height, p.z + half];

  gather(world,
    bb[0] + Math.min(0, dx) - 1, bb[1] + Math.min(0, dy) - 1, bb[2] + Math.min(0, dz) - 1,
    bb[3] + Math.max(0, dx) + 1, bb[4] + Math.max(0, dy) + step + 1, bb[5] + Math.max(0, dz) + 1);

  // スニーク中は足場の端から落ちない (Minecraft と同じく 0.05 ずつ戻す)
  if (e.sneakGuard && e.onGround && dy <= 0) {
    const test = (ox, oz) => overlapsAny([bb[0] + ox, bb[1] - 0.6, bb[2] + oz, bb[3] + ox, bb[4] - 0.6, bb[5] + oz]);
    const inc = 0.05;
    while (dx !== 0 && !test(dx, 0)) dx = Math.abs(dx) < inc ? 0 : dx - Math.sign(dx) * inc;
    while (dz !== 0 && !test(0, dz)) dz = Math.abs(dz) < inc ? 0 : dz - Math.sign(dz) * inc;
    while (dx !== 0 && dz !== 0 && !test(dx, dz)) {
      dx = Math.abs(dx) < inc ? 0 : dx - Math.sign(dx) * inc;
      dz = Math.abs(dz) < inc ? 0 : dz - Math.sign(dz) * inc;
    }
  }

  const odx = dx, ody = dy, odz = dz;
  const start = bb.slice();
  dy = clip(bb, 1, dy); offset(bb, 1, dy);
  dx = clip(bb, 0, dx); offset(bb, 0, dx);
  dz = clip(bb, 2, dz); offset(bb, 2, dz);
  let onGround = ody < 0 && dy !== ody;

  // 段差の自動乗り越え
  if (step > 0 && (onGround || e.onGround) && (dx !== odx || dz !== odz)) {
    const bb2 = start.slice();
    let sy = clip(bb2, 1, step); offset(bb2, 1, sy);
    const sx = clip(bb2, 0, odx); offset(bb2, 0, sx);
    const sz = clip(bb2, 2, odz); offset(bb2, 2, sz);
    const down = clip(bb2, 1, -sy + Math.min(0, ody)); offset(bb2, 1, down);
    if (sx * sx + sz * sz > dx * dx + dz * dz + 1e-9) {
      for (let i = 0; i < 6; i++) bb[i] = bb2[i];
      dx = sx; dz = sz; dy = sy + down;
      onGround = true;
    }
  }

  p.x = (bb[0] + bb[3]) / 2;
  p.y = bb[1];
  p.z = (bb[2] + bb[5]) / 2;
  e.hitWall = dx !== odx || dz !== odz;
  if (dx !== odx) e.velocity.x = 0;
  if (dz !== odz) e.velocity.z = 0;
  if (dy !== ody) e.velocity.y = 0;
  e.onGround = onGround;
}

// 指定のブロック (id, meta) を (bx,by,bz) に置いたとき、エンティティと重なるか
export function blockIntersectsEntity(world, bx, by, bz, id, meta, e) {
  if (!SOLID[id]) return false;
  const half = e.width / 2;
  const p = e.position;
  const list = FULL[id] ? [[0, 0, 0, 1, 1, 1]] : shapeBoxes(world, bx, by, bz, id, meta, 'collision');
  for (const b of list) {
    if (bx + b[3] > p.x - half && bx + b[0] < p.x + half &&
        by + b[4] > p.y && by + b[1] < p.y + e.height &&
        bz + b[5] > p.z - half && bz + b[2] < p.z + half) return true;
  }
  return false;
}

// 2 つのエンティティの当たり判定が重なるか
export function intersectsEntity(a, b) {
  const ha = a.width / 2, hb = b.width / 2;
  return (
    Math.abs(a.position.x - b.position.x) < ha + hb &&
    Math.abs(a.position.z - b.position.z) < ha + hb &&
    a.position.y < b.position.y + b.height && b.position.y < a.position.y + a.height
  );
}

// 足元 (少し上) が水か
export function feetInWater(world, e) {
  return world.get(Math.floor(e.position.x), Math.floor(e.position.y + 0.2), Math.floor(e.position.z)) === BLOCK.WATER;
}

// エンティティの当たり判定と重なるセルを列挙する
export function cellsTouching(e, grow = 0) {
  const half = e.width / 2 + grow;
  const p = e.position;
  const out = [];
  for (let x = Math.floor(p.x - half); x <= Math.floor(p.x + half); x++) {
    for (let y = Math.floor(p.y - grow); y <= Math.floor(p.y + e.height + grow); y++) {
      for (let z = Math.floor(p.z - half); z <= Math.floor(p.z + half); z++) out.push([x, y, z]);
    }
  }
  return out;
}

// レイと AABB の交差距離 (交差しなければ Infinity)
export function rayAABB(origin, dir, e) {
  const half = e.width / 2;
  const p = e.position;
  const r = rayBox(origin, dir, p.x - half, p.y, p.z - half, p.x + half, p.y + e.height, p.z + half);
  return r ? r.t : Infinity;
}

// レイと直方体の交差。{ t, normal } または null
export function rayBox(origin, dir, x0, y0, z0, x1, y1, z1) {
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const min = [x0, y0, z0], max = [x1, y1, z1];
  let tmin = 0, tmax = Infinity, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
    } else {
      let t1 = (min[i] - o[i]) / d[i];
      let t2 = (max[i] - o[i]) / d[i];
      let s = -1;
      if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  const normal = [0, 0, 0];
  if (axis >= 0) normal[axis] = sign;
  return { t: tmin, normal };
}
