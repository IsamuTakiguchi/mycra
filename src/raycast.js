import { BLOCK } from './blocks.js';

// ボクセル DDA (Amanatides & Woo)。視線が最初に当たるブロックとその面の法線を返す
export function raycastVoxel(world, origin, dir, maxDist) {
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
    if (id !== BLOCK.AIR && id !== BLOCK.WATER) {
      return { x, y, z, id, normal, distance: t };
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
