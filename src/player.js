import * as THREE from 'three';
import { BLOCK, isSolid } from './blocks.js';

const WIDTH = 0.6;
const HEIGHT = 1.8;
const EYE = 1.62;
const HALF = WIDTH / 2;
const EPS = 1e-4;

const WALK_SPEED = 4.3;
const SPRINT_SPEED = 6.0;
const FLY_SPEED = 11;
const JUMP_SPEED = 8.6;
const GRAVITY = 28;
const MAX_FALL = 40;

export class Player {
  constructor(world, camera) {
    this.world = world;
    this.camera = camera;
    this.position = new THREE.Vector3(0, 40, 0); // 足元
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.flying = false;
    this.keys = new Set();
    // タッチ操作からのアナログ入力 (-1..1) とボタン状態
    this.touch = { forward: 0, strafe: 0, jump: false, down: false, sprint: false };
    this.moving = false;
    this.camera.rotation.order = 'YXZ';
  }

  spawn(x, z) {
    const y = this.world.surfaceHeight(x, z) + 1;
    this.position.set(x + 0.5, y + 0.1, z + 0.5);
    this.velocity.set(0, 0, 0);
    this.yaw = Math.PI * 0.25;
    this.pitch = 0;
  }

  look(dx, dy) {
    const sens = 0.0022;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const lim = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  eyePosition(target = new THREE.Vector3()) {
    return target.set(this.position.x, this.position.y + EYE, this.position.z);
  }

  toggleFly() {
    this.flying = !this.flying;
    this.velocity.y = 0;
    return this.flying;
  }

  // ブロック (bx,by,bz) がプレイヤーの当たり判定と重なるか
  intersectsBlock(bx, by, bz) {
    const p = this.position;
    return (
      bx + 1 > p.x - HALF && bx < p.x + HALF &&
      by + 1 > p.y && by < p.y + HEIGHT &&
      bz + 1 > p.z - HALF && bz < p.z + HALF
    );
  }

  update(dt) {
    const k = this.keys;
    const t = this.touch;
    const clamp1 = (v) => Math.max(-1, Math.min(1, v));
    const forward = clamp1((k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) + t.forward);
    const strafe = clamp1((k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + t.strafe);
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight') || t.sprint;
    const jump = k.has('Space') || t.jump;
    const down = k.has('ControlLeft') || k.has('ControlRight') || t.down;

    // yaw を基準に移動方向を求める
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let mx = -sin * forward + cos * strafe;
    let mz = -cos * forward - sin * strafe;
    let len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; len = 1; }
    this.moving = len > 0.05;

    const p = this.position;
    const feet = this.world.get(Math.floor(p.x), Math.floor(p.y + 0.2), Math.floor(p.z));
    const head = this.world.get(Math.floor(p.x), Math.floor(p.y + EYE), Math.floor(p.z));
    this.inWater = feet === BLOCK.WATER || head === BLOCK.WATER;
    const headInWater = head === BLOCK.WATER;

    if (this.flying) {
      const speed = sprint ? FLY_SPEED * 1.8 : FLY_SPEED;
      const target = new THREE.Vector3(mx * speed, 0, mz * speed);
      if (jump) target.y += speed;
      if (sprint && !jump && len === 0) target.y -= speed;
      if (down) target.y -= speed;
      const blend = 1 - Math.exp(-dt * 12);
      this.velocity.lerp(target, blend);
    } else if (this.inWater) {
      const speed = 2.6;
      const blend = 1 - Math.exp(-dt * 6);
      this.velocity.x += (mx * speed - this.velocity.x) * blend;
      this.velocity.z += (mz * speed - this.velocity.z) * blend;
      this.velocity.y -= 9 * dt;
      if (jump) this.velocity.y += 24 * dt;
      // 水面から飛び出す
      if (jump && !headInWater && this.velocity.y > 0) this.velocity.y = Math.min(this.velocity.y + 20 * dt, 6);
      this.velocity.y = Math.max(-3, Math.min(this.velocity.y, 5));
    } else {
      const speed = sprint && forward > 0 ? SPRINT_SPEED : WALK_SPEED;
      const accel = this.onGround ? 1 - Math.exp(-dt * 16) : 1 - Math.exp(-dt * 4);
      this.velocity.x += (mx * speed - this.velocity.x) * accel;
      this.velocity.z += (mz * speed - this.velocity.z) * accel;
      this.velocity.y -= GRAVITY * dt;
      if (this.velocity.y < -MAX_FALL) this.velocity.y = -MAX_FALL;
      if (jump && this.onGround) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
      }
    }

    // 軸ごとに移動して衝突解決
    this.onGround = false;
    this.moveAxis(0, this.velocity.x * dt);
    this.moveAxis(1, this.velocity.y * dt);
    this.moveAxis(2, this.velocity.z * dt);

    // 奈落に落ちたら復帰
    if (p.y < -20) {
      this.spawn(Math.floor(p.x), Math.floor(p.z));
    }
    if (!this.onGround && !this.flying && !this.inWater) this.moving = this.moving && Math.abs(this.velocity.y) < 2;

    this.syncCamera();
  }

  moveAxis(axis, delta) {
    if (delta === 0) return;
    const p = this.position;
    const comps = ['x', 'y', 'z'];
    p[comps[axis]] += delta;

    const minX = Math.floor(p.x - HALF), maxX = Math.floor(p.x + HALF - EPS);
    const minY = Math.floor(p.y), maxY = Math.floor(p.y + HEIGHT - EPS);
    const minZ = Math.floor(p.z - HALF), maxZ = Math.floor(p.z + HALF - EPS);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (!isSolid(this.world.get(x, y, z))) continue;
          if (axis === 0) {
            p.x = delta > 0 ? x - HALF - EPS : x + 1 + HALF + EPS;
            this.velocity.x = 0;
          } else if (axis === 1) {
            if (delta > 0) {
              p.y = y - HEIGHT - EPS;
            } else {
              p.y = y + 1 + EPS;
              this.onGround = true;
            }
            this.velocity.y = 0;
          } else {
            p.z = delta > 0 ? z - HALF - EPS : z + 1 + HALF + EPS;
            this.velocity.z = 0;
          }
          return;
        }
      }
    }
  }

  syncCamera() {
    this.eyePosition(this.camera.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
