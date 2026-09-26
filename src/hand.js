import * as THREE from 'three';
import { ITEMS } from './items.js';
import { buildItemMesh } from './drops.js';

// 画面手前に描く一人称の腕と持ち物
export class HandView {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const light = new THREE.DirectionalLight(0xffffff, 0.9);
    light.position.set(-1, 2, 1.5);
    this.scene.add(light);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    const arm = new THREE.Group();
    const skin = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.9), new THREE.MeshLambertMaterial({ color: 0xd9a066 }));
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.45), new THREE.MeshLambertMaterial({ color: 0x2f9fb3 }));
    sleeve.position.z = 0.28;
    arm.add(skin, sleeve);
    arm.position.set(0.05, -0.08, 0.35);
    arm.rotation.set(-0.35, 0.25, 0.1);
    this.arm = arm;
    this.group.add(arm);

    this.itemHolder = new THREE.Group();
    this.itemHolder.position.set(0.02, 0.02, -0.12);
    this.group.add(this.itemHolder);

    this.item = null;
    this.currentKey = undefined;
    this.cache = new Map();
    this.swingT = 1;
    this.switchT = 1;
    this.bob = 0;
    this.pendingId = null;
    this.visible = true;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  // 持ち物を切り替える (下げてから持ち上げる演出付き)。null は素手
  setItem(id) {
    const key = id ?? 'hand';
    if (this.currentKey === key) return;
    this.pendingId = key;
    this.switchT = 0;
  }

  applyItem(key) {
    this.currentKey = key;
    if (this.item) this.itemHolder.remove(this.item);
    this.item = null;
    if (key === 'hand') { this.arm.position.set(0.0, -0.02, 0.2); return; }
    this.arm.position.set(0.05, -0.08, 0.35);
    let mesh = this.cache.get(key);
    if (!mesh) {
      mesh = buildItemMesh(key);
      const def = ITEMS[key];
      if (def.block !== undefined) {
        mesh.scale.setScalar(0.34);
        mesh.position.set(0.05, 0.12, 0);
        mesh.rotation.set(0.15, 0.75, 0);
      } else if (def.tool) {
        mesh.scale.setScalar(0.8);
        mesh.position.set(0.4, 0.2, -0.05);
        mesh.rotation.set(0.1, 0.25, -0.35);
      } else {
        mesh.scale.setScalar(0.55);
        mesh.position.set(0.12, 0.18, 0);
        mesh.rotation.set(0.1, 0.35, -0.2);
      }
      this.cache.set(key, mesh);
    }
    this.item = mesh;
    this.itemHolder.add(mesh);
  }

  swing() {
    if (this.swingT < 0.3) return;
    this.swingT = 0;
  }

  update(dt, moving, mining = false) {
    if (this.switchT < 1) {
      const before = this.switchT;
      this.switchT = Math.min(1, this.switchT + dt / 0.3);
      if (before < 0.5 && this.switchT >= 0.5 && this.pendingId) {
        this.applyItem(this.pendingId);
        this.pendingId = null;
      }
    }
    if (mining && this.swingT >= 1) this.swingT = 0;
    if (this.swingT < 1) this.swingT = Math.min(1, this.swingT + dt / 0.28);

    if (moving) this.bob += dt * 9;
    const bobX = Math.sin(this.bob) * 0.02;
    const bobY = Math.abs(Math.cos(this.bob)) * 0.02;
    const sw = Math.sin(this.swingT * Math.PI);
    const drop = this.switchT < 0.5 ? this.switchT * 2 : 2 - this.switchT * 2;

    this.group.position.set(0.55 + bobX - sw * 0.25, -0.5 + bobY - sw * 0.28 - drop * 0.7, -1.0);
    this.group.rotation.set(-sw * 0.9, -sw * 0.35, sw * 0.25);
  }

  render(renderer) {
    if (!this.visible) return;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
