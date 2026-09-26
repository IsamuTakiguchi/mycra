import * as THREE from 'three';
import { BLOCK } from './blocks.js';
import { moveAxis, feetInWater, hasGroundBelow } from './physics.js';

const WALK_SPEED = 4.3;
const SPRINT_SPEED = 5.6;
const SNEAK_SPEED = 1.3;
const FLY_SPEED = 10.9;
const JUMP_SPEED = 8.6;
const GRAVITY = 28;
const MAX_FALL = 40;
const EYE_STAND = 1.62;
const EYE_SNEAK = 1.27;

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;

export class Player {
  constructor(world, camera) {
    this.world = world;
    this.camera = camera;
    this.position = new THREE.Vector3(0, 40, 0); // 足元
    this.velocity = new THREE.Vector3();
    this.width = 0.6;
    this.height = 1.8;
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.hitWall = false;
    this.inWater = false;
    this.flying = false;
    this.sneaking = false;
    this.sprinting = false;
    this.gameMode = 'survival';
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.exhaustion = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.fallDistance = 0;
    this.hurtTimer = 0; // 無敵時間
    this.attackCooldown = 0;
    this.dead = false;
    this.eyeHeight = EYE_STAND;
    this.keys = new Set();
    // タッチ操作からのアナログ入力 (-1..1) とボタン状態
    this.touch = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
    this.moving = false;
    this.camera.rotation.order = 'YXZ';
    this.spawnPoint = null;
  }

  get creative() {
    return this.gameMode === 'creative';
  }

  spawn(x, z) {
    const y = this.world.surfaceHeight(x, z) + 1;
    this.position.set(x + 0.5, y + 0.1, z + 0.5);
    this.velocity.set(0, 0, 0);
    this.yaw = Math.PI * 0.25;
    this.pitch = 0;
    this.spawnPoint = { x, z };
  }

  respawn() {
    const sp = this.spawnPoint ?? this.world.findSpawn();
    this.spawn(sp.x, sp.z);
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.exhaustion = 0;
    this.fallDistance = 0;
    this.dead = false;
    this.flying = false;
  }

  look(dx, dy) {
    const sens = 0.0022;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const lim = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  eyePosition(target = new THREE.Vector3()) {
    return target.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  setFlying(on) {
    if (!this.creative) on = false;
    this.flying = on;
    this.velocity.y = 0;
    this.fallDistance = 0;
    return on;
  }

  // ダメージ (true: 適用された)
  damage(amount, knockback = null) {
    if (this.dead || amount <= 0) return false;
    if (this.creative) return false;
    if (this.hurtTimer > 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.hurtTimer = 0.5;
    if (knockback) {
      this.velocity.x += knockback.x;
      this.velocity.z += knockback.z;
      this.velocity.y = Math.max(this.velocity.y, 4);
    }
    if (this.health <= 0) this.dead = true;
    return true;
  }

  eat(food) {
    this.hunger = Math.min(MAX_HUNGER, this.hunger + food);
  }

  update(dt) {
    const k = this.keys;
    const t = this.touch;
    const clamp1 = (v) => Math.max(-1, Math.min(1, v));
    const forward = clamp1((k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) + t.forward);
    const strafe = clamp1((k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + t.strafe);
    const jump = k.has('Space') || t.jump;
    const sneakHeld = k.has('ShiftLeft') || k.has('ShiftRight') || t.sneak;
    const ctrl = k.has('ControlLeft') || k.has('ControlRight') || t.sprint;

    // Minecraft: Shift はスニーク (飛行中は下降)。Ctrl または W 二度押しでダッシュ
    this.sneaking = sneakHeld && !this.flying;
    if (ctrl && forward > 0.5 && !this.sneaking && (this.creative || this.hunger > 6)) this.sprinting = true;
    if (forward <= 0.5 || this.sneaking || this.hitWall || (!this.creative && this.hunger <= 6)) this.sprinting = false;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let mx = -sin * forward + cos * strafe;
    let mz = -cos * forward - sin * strafe;
    let len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; len = 1; }
    this.moving = len > 0.05;

    const p = this.position;
    const head = this.world.get(Math.floor(p.x), Math.floor(p.y + this.eyeHeight), Math.floor(p.z));
    this.inWater = feetInWater(this.world, this) || head === BLOCK.WATER;
    const headInWater = head === BLOCK.WATER;

    if (this.flying) {
      const speed = this.sprinting ? FLY_SPEED * 2 : FLY_SPEED;
      const target = new THREE.Vector3(mx * speed, 0, mz * speed);
      if (jump) target.y += speed;
      if (sneakHeld) target.y -= speed;
      const blend = 1 - Math.exp(-dt * 12);
      this.velocity.lerp(target, blend);
      this.fallDistance = 0;
    } else if (this.inWater) {
      const speed = 2.6;
      const blend = 1 - Math.exp(-dt * 6);
      this.velocity.x += (mx * speed - this.velocity.x) * blend;
      this.velocity.z += (mz * speed - this.velocity.z) * blend;
      this.velocity.y -= 9 * dt;
      if (jump) this.velocity.y += 24 * dt;
      if (jump && !headInWater && this.velocity.y > 0) this.velocity.y = Math.min(this.velocity.y + 20 * dt, 6);
      this.velocity.y = Math.max(-3, Math.min(this.velocity.y, 5));
      this.fallDistance = 0;
    } else {
      const speed = this.sneaking ? SNEAK_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
      const accel = this.onGround ? 1 - Math.exp(-dt * 16) : 1 - Math.exp(-dt * 4);
      this.velocity.x += (mx * speed - this.velocity.x) * accel;
      this.velocity.z += (mz * speed - this.velocity.z) * accel;
      this.velocity.y -= GRAVITY * dt;
      if (this.velocity.y < -MAX_FALL) this.velocity.y = -MAX_FALL;
      if (jump && this.onGround) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
        this.exhaustion += this.sprinting ? 0.2 : 0.05;
      }
      if (this.velocity.y < 0) this.fallDistance += -this.velocity.y * dt;
    }

    // 軸ごとに移動して衝突解決。スニーク中は足場の端から落ちない
    const half = this.width / 2;
    const wasOnGround = this.onGround;
    this.onGround = false;
    this.hitWall = false;
    const guard = this.sneaking && wasOnGround;
    const px0 = p.x;
    moveAxis(this.world, this, 0, this.velocity.x * dt, half);
    if (guard && !hasGroundBelow(this.world, this)) { p.x = px0; this.velocity.x = 0; }
    const pz0 = p.z;
    moveAxis(this.world, this, 2, this.velocity.z * dt, half);
    if (guard && !hasGroundBelow(this.world, this)) { p.z = pz0; this.velocity.z = 0; }
    moveAxis(this.world, this, 1, this.velocity.y * dt, half);

    // 着地時の落下ダメージ
    if (this.onGround && this.fallDistance > 0) {
      if (this.fallDistance > 3.5 && !this.inWater) this.damage(Math.floor(this.fallDistance - 3));
      this.fallDistance = 0;
    }
    if (this.moving && this.onGround) this.exhaustion += (this.sprinting ? 0.1 : 0.01) * len * WALK_SPEED * dt;

    // 空腹・回復
    if (!this.creative && !this.dead) {
      if (this.exhaustion >= 4) { this.exhaustion -= 4; this.hunger = Math.max(0, this.hunger - 1); }
      if (this.hunger >= 18 && this.health < MAX_HEALTH) {
        this.regenTimer += dt;
        if (this.regenTimer >= 4) { this.regenTimer = 0; this.health = Math.min(MAX_HEALTH, this.health + 1); this.exhaustion += 6; }
      } else this.regenTimer = 0;
      if (this.hunger <= 0) {
        this.starveTimer += dt;
        if (this.starveTimer >= 4) { this.starveTimer = 0; if (this.health > 1) { this.health -= 1; this.hurtTimer = 0.5; } }
      } else this.starveTimer = 0;
    }

    if (this.hurtTimer > 0) this.hurtTimer -= dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    // 奈落に落ちたら復帰
    if (p.y < -20) {
      if (this.creative) this.spawn(Math.floor(p.x), Math.floor(p.z));
      else { this.health = 0; this.dead = true; }
    }

    // 目の高さ (スニークで下がる)
    const targetEye = this.sneaking ? EYE_SNEAK : EYE_STAND;
    this.eyeHeight += (targetEye - this.eyeHeight) * (1 - Math.exp(-dt * 20));
    this.syncCamera();
  }

  syncCamera() {
    this.eyePosition(this.camera.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
