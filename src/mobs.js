import * as THREE from 'three';
import { BLOCK, isSolid } from './blocks.js';
import { moveEntity, feetInWater, intersectsEntity, rayAABB } from './physics.js';
import { buildMobModel, setFlash } from './models.js';
import { WORLD_HEIGHT } from './constants.js';

const GRAVITY = 28;

export const MOB_TYPES = {
  pig: { name: 'ブタ', hostile: false, health: 10, width: 0.9, height: 0.9, speed: 1.2, drops: [['porkchop', 1, 3]] },
  cow: { name: 'ウシ', hostile: false, health: 10, width: 0.9, height: 1.4, speed: 1.1, drops: [['beef', 1, 3]] },
  sheep: { name: 'ヒツジ', hostile: false, health: 8, width: 0.9, height: 1.3, speed: 1.1, drops: [['mutton', 1, 2], ['wool', 1, 1]] },
  chicken: { name: 'ニワトリ', hostile: false, health: 4, width: 0.4, height: 0.7, speed: 1.0, drops: [['chicken', 1, 1], ['feather', 0, 2]] },
  zombie: { name: 'ゾンビ', hostile: true, health: 20, width: 0.6, height: 1.95, speed: 2.3, attack: 3, drops: [] },
  skeleton: { name: 'スケルトン', hostile: true, health: 20, width: 0.6, height: 1.99, speed: 2.0, attack: 2, drops: [] },
  creeper: { name: 'クリーパー', hostile: true, health: 20, width: 0.6, height: 1.7, speed: 2.0, attack: 0, drops: [] },
};

const HOSTILE_CAP = { peaceful: 0, easy: 8, normal: 12, hard: 18 };
const PASSIVE_CAP = 24;

export class Mob {
  constructor(type, x, y, z) {
    const def = MOB_TYPES[type];
    this.type = type;
    this.def = def;
    this.position = new THREE.Vector3(x, y, z);
    this.velocity = new THREE.Vector3();
    this.width = def.width;
    this.height = def.height;
    this.health = def.health;
    this.onGround = false;
    this.hitWall = false;
    this.yaw = Math.random() * Math.PI * 2;
    this.wanderTimer = 0;
    this.wanderDir = null;
    this.attackTimer = 0;
    this.hurtTimer = 0;
    this.fleeTimer = 0;
    this.fuse = -1; // クリーパー
    this.burnTimer = 0;
    this.animTime = 0;
    this.dead = false;
    this.deathTimer = 0;
    const model = buildMobModel(type);
    this.model = model;
    this.group = model.group;
    this.group.position.copy(this.position);
  }

  damage(amount, from = null) {
    if (this.dead || this.hurtTimer > 0) return false;
    this.health -= amount;
    this.hurtTimer = 0.5;
    setFlash(this.group, true);
    if (from) {
      const dx = this.position.x - from.x, dz = this.position.z - from.z;
      const len = Math.hypot(dx, dz) || 1;
      this.velocity.x += (dx / len) * 6;
      this.velocity.z += (dz / len) * 6;
      this.velocity.y = 5;
    }
    if (!this.def.hostile) { this.fleeTimer = 4; this.fleeFrom = from ? { x: from.x, z: from.z } : null; }
    if (this.health <= 0) { this.dead = true; this.deathTimer = 0.6; }
    return true;
  }
}

export class MobManager {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.mobs = [];
    this.arrows = [];
    this.spawnTimer = 0;
    this.time = 0;
    this.difficulty = 'normal';
    this.arrowGeo = new THREE.BoxGeometry(0.06, 0.06, 0.6);
    this.arrowMat = new THREE.MeshLambertMaterial({ color: 0x8a6a3a });
  }

  add(type, x, y, z) {
    const mob = new Mob(type, x, y, z);
    this.scene.add(mob.group);
    this.mobs.push(mob);
    return mob;
  }

  clear() {
    for (const m of this.mobs) this.scene.remove(m.group);
    for (const a of this.arrows) this.scene.remove(a.mesh);
    this.mobs = [];
    this.arrows = [];
  }

  // ワールド生成時に動物を配置
  populate(rand) {
    const size = this.world.size;
    const types = ['pig', 'cow', 'sheep', 'chicken'];
    for (let i = 0; i < 14; i++) {
      const x = 4 + Math.floor(rand() * (size - 8));
      const z = 4 + Math.floor(rand() * (size - 8));
      const y = this.world.surfaceHeight(x, z);
      if (this.world.get(x, y, z) !== BLOCK.GRASS) continue;
      const type = types[Math.floor(rand() * types.length)];
      const n = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const ox = x + Math.floor(rand() * 5) - 2, oz = z + Math.floor(rand() * 5) - 2;
        const oy = this.world.surfaceHeight(ox, oz);
        if (this.world.get(ox, oy, oz) === BLOCK.GRASS) this.add(type, ox + 0.5, oy + 1.01, oz + 0.5);
      }
    }
  }

  // 暗い場所に敵をわかせる (プレイヤーから 24〜48 ブロック)
  trySpawn(player, daylight) {
    const hostile = this.mobs.filter((m) => m.def.hostile).length;
    const passive = this.mobs.length - hostile;
    for (let attempt = 0; attempt < 6; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 24 + Math.random() * 24;
      const x = Math.floor(player.position.x + Math.cos(ang) * dist);
      const z = Math.floor(player.position.z + Math.sin(ang) * dist);
      if (x < 1 || z < 1 || x >= this.world.size - 1 || z >= this.world.size - 1) continue;
      // ランダムな高さの空きスペース
      const y = 1 + Math.floor(Math.random() * (WORLD_HEIGHT - 3));
      if (!isSolid(this.world.get(x, y - 1, z))) continue;
      if (this.world.get(x, y, z) !== BLOCK.AIR || this.world.get(x, y + 1, z) !== BLOCK.AIR) continue;
      const light = this.world.lightLevel(x, y, z, daylight);
      if (light <= 7) {
        if (hostile >= HOSTILE_CAP[this.difficulty]) continue;
        const r = Math.random();
        const type = r < 0.5 ? 'zombie' : r < 0.8 ? 'skeleton' : 'creeper';
        this.add(type, x + 0.5, y + 0.01, z + 0.5);
        return;
      }
      if (this.world.get(x, y - 1, z) === BLOCK.GRASS && light >= 9 && passive < PASSIVE_CAP && Math.random() < 0.3) {
        const types = ['pig', 'cow', 'sheep', 'chicken'];
        this.add(types[Math.floor(Math.random() * 4)], x + 0.5, y + 0.01, z + 0.5);
        return;
      }
    }
  }

  // レイに最初に当たるモブ
  raycast(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const m of this.mobs) {
      if (m.dead) continue;
      const t = rayAABB(origin, dir, m);
      if (t < bestT) { bestT = t; best = m; }
    }
    return best ? { mob: best, distance: bestT } : null;
  }

  update(dt, player, daylight, ctx) {
    this.time += dt;
    this.spawnTimer += dt;
    // ピースフルでは敵が消える
    if (this.difficulty === 'peaceful') {
      for (let i = this.mobs.length - 1; i >= 0; i--) {
        if (this.mobs[i].def.hostile) { this.scene.remove(this.mobs[i].group); this.mobs.splice(i, 1); }
      }
      for (const a of this.arrows) this.scene.remove(a.mesh);
      this.arrows = [];
    }
    if (this.spawnTimer > 1.5) { this.spawnTimer = 0; this.trySpawn(player, daylight); }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      if (m.dead) {
        m.deathTimer -= dt;
        m.group.rotation.z = Math.min(Math.PI / 2, m.group.rotation.z + dt * 6);
        if (m.deathTimer <= 0) {
          for (const [item, min, max] of m.def.drops) {
            const n = min + Math.floor(Math.random() * (max - min + 1));
            if (n > 0) ctx.drops.spawn(item, n, m.position.x, m.position.y + 0.5, m.position.z);
          }
          this.scene.remove(m.group);
          this.mobs.splice(i, 1);
        }
        continue;
      }
      this.updateMob(m, dt, player, daylight, ctx);

      // 遠すぎる敵は消える
      const dist = m.position.distanceTo(player.position);
      if (m.def.hostile && dist > 72) { this.scene.remove(m.group); this.mobs.splice(i, 1); continue; }
      if (m.position.y < -10) { this.scene.remove(m.group); this.mobs.splice(i, 1); }
    }

    this.updateArrows(dt, player);
  }

  updateMob(m, dt, player, daylight, ctx) {
    const def = m.def;
    if (m.hurtTimer > 0) { m.hurtTimer -= dt; if (m.hurtTimer <= 0) setFlash(m.group, false); }
    if (m.attackTimer > 0) m.attackTimer -= dt;
    if (m.fleeTimer > 0) m.fleeTimer -= dt;

    const toPlayer = new THREE.Vector3().subVectors(player.position, m.position);
    const dist = toPlayer.length();
    let moveX = 0, moveZ = 0, speed = def.speed;
    let wantJump = false;

    if (def.hostile && !player.dead && dist < 20 && !player.ignoredByMobs) {
      // 追いかける
      const dirX = toPlayer.x / (dist || 1), dirZ = toPlayer.z / (dist || 1);
      if (m.type === 'skeleton') {
        // 距離をとって矢を撃つ
        if (dist > 10) { moveX = dirX; moveZ = dirZ; }
        else if (dist < 5) { moveX = -dirX; moveZ = -dirZ; }
        else { moveX = -dirZ * 0.4; moveZ = dirX * 0.4; }
        if (m.attackTimer <= 0 && dist < 16) { m.attackTimer = 2.2; this.shootArrow(m, player); }
        m.yaw = Math.atan2(toPlayer.x, toPlayer.z);
      } else if (m.type === 'creeper') {
        if (dist > 3) { moveX = dirX; moveZ = dirZ; }
        if (dist < 3.2) {
          if (m.fuse < 0) m.fuse = 0;
        }
        if (m.fuse >= 0) {
          m.fuse += dt;
          if (dist > 6) { m.fuse = -1; setFlash(m.group, false); }
          else {
            setFlash(m.group, Math.floor(m.fuse * 8) % 2 === 0);
            if (m.fuse >= 1.5) { this.explode(m, player, ctx); return; }
          }
        }
        m.yaw = Math.atan2(toPlayer.x, toPlayer.z);
      } else {
        moveX = dirX; moveZ = dirZ;
        m.yaw = Math.atan2(toPlayer.x, toPlayer.z);
        if (dist < 1.6 && m.attackTimer <= 0 && Math.abs(toPlayer.y) < 2) {
          m.attackTimer = 1.0;
          const kb = { x: dirX * 5, z: dirZ * 5 };
          if (player.damage(def.attack, kb, true)) ctx.onPlayerHurt?.();
        }
      }
    } else {
      // うろつく / 逃げる
      m.wanderTimer -= dt;
      if (m.wanderTimer <= 0) {
        m.wanderTimer = 2 + Math.random() * 4;
        m.wanderDir = Math.random() < 0.55 ? Math.random() * Math.PI * 2 : null;
      }
      if (m.fleeTimer > 0 && m.fleeFrom) {
        const fx = m.position.x - m.fleeFrom.x, fz = m.position.z - m.fleeFrom.z;
        const l = Math.hypot(fx, fz) || 1;
        moveX = fx / l; moveZ = fz / l; speed = def.speed * 1.8;
      } else if (m.wanderDir !== null) {
        moveX = Math.sin(m.wanderDir); moveZ = Math.cos(m.wanderDir);
        speed = def.speed * 0.6;
      }
      if (moveX || moveZ) m.yaw = Math.atan2(moveX, moveZ);
    }

    // 段差は自動でジャンプ
    if ((moveX || moveZ) && m.onGround) {
      const ahead = this.world.get(Math.floor(m.position.x + moveX * 0.7), Math.floor(m.position.y + 0.5), Math.floor(m.position.z + moveZ * 0.7));
      const above = this.world.get(Math.floor(m.position.x + moveX * 0.7), Math.floor(m.position.y + 1.5), Math.floor(m.position.z + moveZ * 0.7));
      if (isSolid(ahead) && !isSolid(above)) wantJump = true;
      // 崖から落ちない (動物のみ)
      if (!def.hostile) {
        const gx = Math.floor(m.position.x + moveX * 0.9), gz = Math.floor(m.position.z + moveZ * 0.9);
        let ground = false;
        for (let dy = 1; dy <= 3; dy++) if (isSolid(this.world.get(gx, Math.floor(m.position.y) - dy, gz))) { ground = true; break; }
        if (!ground) { moveX = 0; moveZ = 0; m.wanderTimer = 0; }
      }
    }

    // 物理
    const inWater = feetInWater(this.world, m);
    const blend = 1 - Math.exp(-dt * (m.onGround ? 10 : 3));
    m.velocity.x += (moveX * speed - m.velocity.x) * blend;
    m.velocity.z += (moveZ * speed - m.velocity.z) * blend;
    if (inWater) {
      m.velocity.y += (2.0 - m.velocity.y) * Math.min(1, dt * 3);
    } else {
      m.velocity.y -= (m.type === 'chicken' && m.velocity.y < 0 ? GRAVITY * 0.25 : GRAVITY) * dt;
      if (wantJump && m.onGround) m.velocity.y = 8.6;
    }
    moveEntity(this.world, m, dt);

    // 日光でゾンビ・スケルトンが燃える
    if ((m.type === 'zombie' || m.type === 'skeleton') && daylight > 0.75) {
      const sky = this.world.lighting.skyAt(Math.floor(m.position.x), Math.floor(m.position.y + 1), Math.floor(m.position.z));
      if (sky >= 14 && !inWater) {
        m.burnTimer += dt;
        if (m.burnTimer >= 1) { m.burnTimer = 0; m.hurtTimer = 0; m.damage(1); }
      }
    }

    // 見た目
    m.animTime += dt * Math.min(1, Math.hypot(m.velocity.x, m.velocity.z) / 1.5 + 0.2);
    m.group.position.copy(m.position);
    m.group.rotation.y += ((((m.yaw - m.group.rotation.y) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 8);
    m.model.animate(m.animTime, Math.hypot(m.velocity.x, m.velocity.z), !m.onGround);
  }

  explode(m, player, ctx) {
    const cx = m.position.x, cy = m.position.y + 0.5, cz = m.position.z;
    const drops = this.world.explode(cx, cy, cz, 3);
    for (const d of drops) ctx.drops.spawn(d.item, 1, d.x, d.y, d.z);
    const dist = player.position.distanceTo(new THREE.Vector3(cx, cy, cz));
    if (dist < 6) {
      const dmg = Math.round(Math.max(1, 24 * (1 - dist / 6)));
      const dx = player.position.x - cx, dz = player.position.z - cz;
      const l = Math.hypot(dx, dz) || 1;
      if (player.damage(dmg, { x: (dx / l) * 8, z: (dz / l) * 8 }, true)) ctx.onPlayerHurt?.();
    }
    for (const other of this.mobs) {
      if (other === m || other.dead) continue;
      const d2 = other.position.distanceTo(m.position);
      if (d2 < 5) other.damage(Math.round(16 * (1 - d2 / 5)), m.position);
    }
    ctx.onExplosion?.(cx, cy, cz);
    m.dead = true;
    m.deathTimer = 0;
  }

  shootArrow(m, player) {
    const from = new THREE.Vector3(m.position.x, m.position.y + 1.4, m.position.z);
    const to = new THREE.Vector3(player.position.x, player.position.y + 1.0, player.position.z);
    const d = to.clone().sub(from);
    const dist = d.length();
    const v = d.normalize().multiplyScalar(18);
    v.y += dist * 0.45; // 山なりに
    const mesh = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    this.scene.add(mesh);
    this.arrows.push({ position: from, velocity: v, mesh, age: 0, stuck: false });
  }

  updateArrows(dt, player) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.age += dt;
      if (!a.stuck) {
        a.velocity.y -= 20 * dt;
        const next = a.position.clone().addScaledVector(a.velocity, dt);
        if (isSolid(this.world.get(Math.floor(next.x), Math.floor(next.y), Math.floor(next.z)))) {
          a.stuck = true;
        } else {
          a.position.copy(next);
          const hitbox = { position: a.position.clone().sub(new THREE.Vector3(0.1, 0.1, 0.1)), width: 0.2, height: 0.2 };
          if (!player.dead && !player.ignoredByMobs && intersectsEntity(hitbox, player)) {
            const l = Math.hypot(a.velocity.x, a.velocity.z) || 1;
            if (player.damage(3, { x: (a.velocity.x / l) * 3, z: (a.velocity.z / l) * 3 }, true)) this.onPlayerHurt?.();
            this.scene.remove(a.mesh);
            this.arrows.splice(i, 1);
            continue;
          }
        }
        a.mesh.position.copy(a.position);
        a.mesh.lookAt(a.position.clone().add(a.velocity));
      }
      if (a.age > 8 || a.position.y < -10) { this.scene.remove(a.mesh); this.arrows.splice(i, 1); }
    }
  }

  serialize() {
    return this.mobs.filter((m) => !m.dead).map((m) => [m.type, +m.position.x.toFixed(2), +m.position.y.toFixed(2), +m.position.z.toFixed(2), m.health]);
  }

  load(list) {
    for (const [type, x, y, z, health] of list ?? []) {
      if (!MOB_TYPES[type]) continue;
      const m = this.add(type, x, y, z);
      if (health) m.health = health;
    }
  }
}
