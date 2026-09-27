import { BLOCK, BLOCKS } from './blocks.js';
import { shapeBoxes, boundsOf } from './shapes.js';
import { rayBox } from './physics.js';

// ボクセル DDA (Amanatides & Woo)。視線が最初に当たるブロックとその面の法線を返す。
// 立方体でないブロック (ハーフブロック、ドア、草など) は選択ボックスとの交差で判定する。
// opts.fluids: 水も対象にする (バケツ用)
export function raycastVoxel(world, origin, dir, maxDist, opts = {}) {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

  const bound = (p, s, d) => (s > 0 ? Math.floor(p) + 1 - p : p - Math.floor(p)) / Math.abs(d);
  let tMaxX = stepX !== 0 ? bound(origin.x, stepX, dir.x) : Infinity;
  let tMaxY = stepY !== 0 ? bound(origin.y, stepY, dir.y) : Infinity;
  let tMaxZ = stepZ !== 0 ? bound(origin.z, stepZ, dir.z) : Infinity;

  let normal = [0, 0, 0];
  let t = 0;

  while (t <= maxDist) {
    const id = world.get(x, y, z);
    if (id !== BLOCK.AIR && (id !== BLOCK.WATER || opts.fluids)) {
      const def = BLOCKS[id];
      if (def.shape === 'cube' || id === BLOCK.WATER) {
        return finish({ x, y, z, id, normal, distance: t, bounds: [0, 0, 0, 1, 1, 1] }, origin, dir);
      }
      const meta = world.getMeta(x, y, z);
      const list = shapeBoxes(world, x, y, z, id, meta, 'select');
      let best = null;
      for (const b of list) {
        const r = rayBox(origin, dir, x + b[0], y + b[1], z + b[2], x + b[3], y + Math.min(1, b[4]), z + b[5]);
        if (r && (!best || r.t < best.t)) best = r;
      }
      if (best && best.t <= maxDist) {
        return finish({ x, y, z, id, normal: best.normal, distance: best.t, bounds: boundsOf(list) }, origin, dir);
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; normal = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; normal = [0, -stepY, 0];
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; normal = [0, 0, -stepZ];
    }
  }
  return null;
}

// 当たった点のブロック内での位置 (ハーフブロックの上下判定などに使う)
function finish(hit, origin, dir) {
  const px = origin.x + dir.x * hit.distance;
  const py = origin.y + dir.y * hit.distance;
  const pz = origin.z + dir.z * hit.distance;
  hit.point = [px, py, pz];
  hit.frac = [px - hit.x, py - hit.y, pz - hit.z];
  return hit;
}
