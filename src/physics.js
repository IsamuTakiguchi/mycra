import { BLOCK, isSolid } from './blocks.js';

const EPS = 1e-4;

// AABB のエンティティを軸ごとに動かして衝突を解決する
//  e.position: 足元の中心, e.velocity, e.width, e.height
//  結果: e.onGround, e.hitWall を更新
export function moveEntity(world, e, dt) {
  const half = e.width / 2;
  e.onGround = false;
  e.hitWall = false;
  moveAxis(world, e, 0, e.velocity.x * dt, half);
  moveAxis(world, e, 1, e.velocity.y * dt, half);
  moveAxis(world, e, 2, e.velocity.z * dt, half);
}

const COMPS = ['x', 'y', 'z'];

export function moveAxis(world, e, axis, delta, half) {
  if (delta === 0) return;
  const p = e.position;
  p[COMPS[axis]] += delta;

  const minX = Math.floor(p.x - half), maxX = Math.floor(p.x + half - EPS);
  const minY = Math.floor(p.y), maxY = Math.floor(p.y + e.height - EPS);
  const minZ = Math.floor(p.z - half), maxZ = Math.floor(p.z + half - EPS);

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (!isSolid(world.get(x, y, z))) continue;
        if (axis === 0) {
          p.x = delta > 0 ? x - half - EPS : x + 1 + half + EPS;
          e.velocity.x = 0;
          e.hitWall = true;
        } else if (axis === 1) {
          if (delta > 0) {
            p.y = y - e.height - EPS;
          } else {
            p.y = y + 1 + EPS;
            e.onGround = true;
          }
          e.velocity.y = 0;
        } else {
          p.z = delta > 0 ? z - half - EPS : z + 1 + half + EPS;
          e.velocity.z = 0;
          e.hitWall = true;
        }
        return;
      }
    }
  }
}

// エンティティの当たり判定がブロックと重なるか
export function intersectsBlock(e, bx, by, bz) {
  const half = e.width / 2;
  const p = e.position;
  return (
    bx + 1 > p.x - half && bx < p.x + half &&
    by + 1 > p.y && by < p.y + e.height &&
    bz + 1 > p.z - half && bz < p.z + half
  );
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

// 足元の下に地面があるか (スニーク中の落下防止に使う)
export function hasGroundBelow(world, e) {
  const half = e.width / 2 - 0.02;
  const y = Math.floor(e.position.y - 0.05);
  for (const dx of [-half, half]) {
    for (const dz of [-half, half]) {
      if (isSolid(world.get(Math.floor(e.position.x + dx), y, Math.floor(e.position.z + dz)))) return true;
    }
  }
  return false;
}

// レイと AABB の交差距離 (交差しなければ Infinity)
export function rayAABB(origin, dir, e) {
  const half = e.width / 2;
  const p = e.position;
  const min = [p.x - half, p.y, p.z - half];
  const max = [p.x + half, p.y + e.height, p.z + half];
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  let tmin = 0, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < min[i] || o[i] > max[i]) return Infinity;
    } else {
      let t1 = (min[i] - o[i]) / d[i];
      let t2 = (max[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}
