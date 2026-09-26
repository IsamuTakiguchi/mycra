import * as THREE from 'three';
import { BLOCKS, TOOLS, createAtlas, tileUV, toolPixelColor, TILE_PX } from './blocks.js';

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

    // 腕 (肌色 + 袖)
    const arm = new THREE.Group();
    const skin = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.26, 0.9),
      new THREE.MeshLambertMaterial({ color: 0xd9a066 }),
    );
    const sleeve = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.28, 0.45),
      new THREE.MeshLambertMaterial({ color: 0x2f9fb3 }),
    );
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
    this.cache = new Map();
    this.swingT = 1; // 1 = 振り終わり
    this.switchT = 1; // 1 = 持ち替え完了
    this.bob = 0;
    this.pendingEntry = null;

    const { texture } = createAtlas();
    this.blockMaterial = new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide });
    this.toolMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  // 持ち物を切り替える (下げてから持ち上げる演出付き)
  setEntry(entry) {
    const key = entry.tool ? `tool:${entry.tool}` : `block:${entry.block}`;
    if (this.currentKey === key) return;
    this.pendingEntry = entry;
    this.switchT = 0;
  }

  applyEntry(entry) {
    const key = entry.tool ? `tool:${entry.tool}` : `block:${entry.block}`;
    this.currentKey = key;
    if (this.item) this.itemHolder.remove(this.item);
    let mesh = this.cache.get(key);
    if (!mesh) {
      mesh = entry.tool ? this.buildTool(entry.tool) : this.buildBlock(entry.block);
      this.cache.set(key, mesh);
    }
    this.item = mesh;
    this.itemHolder.add(mesh);
  }

  buildBlock(id) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const def = BLOCKS[id];
    const uv = geo.attributes.uv;
    // BoxGeometry の面順: +x, -x, +y, -y, +z, -z。各面 4 頂点の uv は (0,1),(1,1),(0,0),(1,0)
    for (let f = 0; f < 6; f++) {
      const tile = f === 2 ? def.tiles[0] : f === 3 ? def.tiles[1] : def.tiles[2];
      const [u0, v0, u1, v1] = tileUV(tile);
      const base = f * 4;
      uv.setXY(base + 0, u0, v1);
      uv.setXY(base + 1, u1, v1);
      uv.setXY(base + 2, u0, v0);
      uv.setXY(base + 3, u1, v0);
    }
    uv.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, this.blockMaterial);
    mesh.scale.setScalar(0.34);
    mesh.position.set(0.05, 0.12, 0);
    mesh.rotation.set(0.15, 0.75, 0);
    return mesh;
  }

  // ドット絵を 1 ピクセル = 1 個の薄い立方体として押し出す
  buildTool(toolId) {
    const { pixels } = TOOLS[toolId];
    const pos = [], nor = [], col = [], idx = [];
    const s = 1 / TILE_PX;
    const d = s * 0.6; // 厚み
    const faces = [
      { dir: [1, 0, 0], corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]] },
      { dir: [-1, 0, 0], corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]] },
      { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]] },
      { dir: [0, -1, 0], corners: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]] },
      { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] },
      { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]] },
    ];
    const c = new THREE.Color();
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const color = toolPixelColor(pixels[y][x]);
        if (color === null) continue;
        c.setHex(color);
        const px = x * s - 0.5;
        const py = (TILE_PX - 1 - y) * s - 0.5;
        for (const face of faces) {
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
    const mesh = new THREE.Mesh(geo, this.toolMaterial);
    // 柄 (ドット絵の左下) が腕の先に来るように配置
    mesh.scale.setScalar(0.8);
    mesh.position.set(0.4, 0.2, -0.05);
    mesh.rotation.set(0.1, 0.25, -0.35);
    return mesh;
  }

  swing() {
    if (this.swingT < 0.3) return;
    this.swingT = 0;
  }

  update(dt, moving) {
    // 持ち替え: 下げて (0..0.5) 差し替えて上げる (0.5..1)
    if (this.switchT < 1) {
      const before = this.switchT;
      this.switchT = Math.min(1, this.switchT + dt / 0.3);
      if (before < 0.5 && this.switchT >= 0.5 && this.pendingEntry) {
        this.applyEntry(this.pendingEntry);
        this.pendingEntry = null;
      }
    }
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
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
