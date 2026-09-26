import * as THREE from 'three';
import { mulberry32 } from './noise.js';

// ---- ブロック風のモブ / プレイヤーモデル ----
// すべてのモデルはローカル +Z が正面。group.rotation.y = atan2(vx, vz) で進行方向を向く

const texCache = new Map();

// ざらつきのある単色テクスチャ
function noiseTexture(color, variance = 10) {
  const key = `${color}:${variance}`;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = 8; c.height = 8;
  const ctx = c.getContext('2d');
  const rand = mulberry32(color + variance);
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const d = (rand() - 0.5) * 2 * variance;
    ctx.fillStyle = `rgb(${clamp(r + d)},${clamp(g + d)},${clamp(b + d)})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

function clamp(v) { return Math.max(0, Math.min(255, v | 0)); }

// 8x8 のパターンで顔などを描く。'.' は base 色
function patternTexture(base, rows, colors) {
  const key = `p:${base}:${rows.join('|')}`;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = 8; c.height = 8;
  const ctx = c.getContext('2d');
  const rand = mulberry32(base);
  const r = (base >> 16) & 255, g = (base >> 8) & 255, b = base & 255;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const ch = rows[y]?.[x] ?? '.';
    if (ch === '.') {
      const d = (rand() - 0.5) * 16;
      ctx.fillStyle = `rgb(${clamp(r + d)},${clamp(g + d)},${clamp(b + d)})`;
    } else {
      ctx.fillStyle = '#' + (colors[ch] ?? 0xff00ff).toString(16).padStart(6, '0');
    }
    ctx.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

function mat(texture) {
  return new THREE.MeshLambertMaterial({ map: texture });
}

// 直方体パーツ。faces: { front?: texture } で正面 (+z) だけ別テクスチャ
function box(w, h, d, color, faces = {}) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const base = noiseTexture(color);
  const materials = [mat(base), mat(base), mat(base), mat(base), mat(faces.front ?? base), mat(base)];
  const mesh = new THREE.Mesh(geo, materials);
  mesh.castShadow = false;
  return mesh;
}

// 回転の支点を上端に置いたパーツ (腕・脚)
function limb(w, h, d, color, faces) {
  const pivot = new THREE.Group();
  const m = box(w, h, d, color, faces);
  m.position.y = -h / 2;
  pivot.add(m);
  return pivot;
}

const P = 1 / 16; // 1 ピクセル = 1/16 ブロック

export function humanoid({ head, face, body, arms, legs, thin = false, armsOut = false }) {
  const g = new THREE.Group();
  const aw = thin ? 2 * P : 4 * P;
  const parts = {};
  parts.head = box(8 * P, 8 * P, 8 * P, head, { front: face });
  parts.head.position.y = 28 * P;
  parts.body = box(8 * P, 12 * P, 4 * P, body);
  parts.body.position.y = 18 * P;
  parts.leftArm = limb(aw, 12 * P, aw, arms);
  parts.leftArm.position.set(-(4 * P + aw / 2), 24 * P, 0);
  parts.rightArm = limb(aw, 12 * P, aw, arms);
  parts.rightArm.position.set(4 * P + aw / 2, 24 * P, 0);
  parts.leftLeg = limb(aw, 12 * P, aw, legs);
  parts.leftLeg.position.set(-aw / 2 - (thin ? 1 * P : 0), 12 * P, 0);
  parts.rightLeg = limb(aw, 12 * P, aw, legs);
  parts.rightLeg.position.set(aw / 2 + (thin ? 1 * P : 0), 12 * P, 0);
  for (const p of Object.values(parts)) g.add(p);
  const animate = (t, speed) => {
    const s = Math.sin(t * 8) * Math.min(1, speed) * 0.8;
    parts.leftLeg.rotation.x = s;
    parts.rightLeg.rotation.x = -s;
    if (armsOut) {
      parts.leftArm.rotation.x = -Math.PI / 2 + Math.sin(t * 3) * 0.08;
      parts.rightArm.rotation.x = -Math.PI / 2 - Math.sin(t * 3) * 0.08;
    } else {
      parts.leftArm.rotation.x = -s;
      parts.rightArm.rotation.x = s;
    }
  };
  return { group: g, parts, animate, height: 1.8 };
}

export function quadruped({ body, head, face, legs, bodyW = 8, bodyH = 8, bodyL = 12, legH = 6, headSize = 8, wool = null }) {
  const g = new THREE.Group();
  const parts = {};
  parts.body = box(bodyW * P, bodyH * P, bodyL * P, body);
  parts.body.position.y = (legH + bodyH / 2) * P;
  parts.head = box(headSize * P, headSize * P, headSize * P, head, { front: face });
  parts.head.position.set(0, (legH + bodyH / 2 + 2) * P, (bodyL / 2 + headSize / 2 - 2) * P);
  const lw = 4 * P;
  const legY = legH * P;
  parts.fl = limb(lw, legH * P, lw, legs); parts.fl.position.set(-(bodyW / 2 - 2) * P, legY, (bodyL / 2 - 2) * P);
  parts.fr = limb(lw, legH * P, lw, legs); parts.fr.position.set((bodyW / 2 - 2) * P, legY, (bodyL / 2 - 2) * P);
  parts.bl = limb(lw, legH * P, lw, legs); parts.bl.position.set(-(bodyW / 2 - 2) * P, legY, -(bodyL / 2 - 2) * P);
  parts.br = limb(lw, legH * P, lw, legs); parts.br.position.set((bodyW / 2 - 2) * P, legY, -(bodyL / 2 - 2) * P);
  if (wool) {
    const w = box((bodyW + 2) * P, (bodyH + 2) * P, (bodyL + 2) * P, wool);
    w.position.copy(parts.body.position);
    g.add(w);
  }
  for (const p of Object.values(parts)) g.add(p);
  const animate = (t, speed) => {
    const s = Math.sin(t * 8) * Math.min(1, speed) * 0.7;
    parts.fl.rotation.x = s; parts.br.rotation.x = s;
    parts.fr.rotation.x = -s; parts.bl.rotation.x = -s;
  };
  return { group: g, parts, animate, height: (legH + bodyH + 2) * P };
}

export function chickenModel() {
  const g = new THREE.Group();
  const parts = {};
  const white = 0xf2f2f2;
  parts.body = box(6 * P, 6 * P, 8 * P, white);
  parts.body.position.y = 8 * P;
  parts.head = box(4 * P, 6 * P, 3 * P, white, { front: patternTexture(white, ['........', '.k....k.', '........', '........', '........', '........', '........', '........'], { k: 0x111111 }) });
  parts.head.position.set(0, 13 * P, 4 * P);
  const beak = box(4 * P, 2 * P, 2 * P, 0xf0b000);
  beak.position.set(0, 12 * P, 6.5 * P);
  const wattle = box(2 * P, 2 * P, 2 * P, 0xd02020);
  wattle.position.set(0, 10 * P, 6 * P);
  parts.ll = limb(1.5 * P, 5 * P, 3 * P, 0xf0b000); parts.ll.position.set(-1.5 * P, 5 * P, 0);
  parts.rl = limb(1.5 * P, 5 * P, 3 * P, 0xf0b000); parts.rl.position.set(1.5 * P, 5 * P, 0);
  parts.lw = box(1 * P, 4 * P, 6 * P, white); parts.lw.position.set(-3.5 * P, 9 * P, 0);
  parts.rw = box(1 * P, 4 * P, 6 * P, white); parts.rw.position.set(3.5 * P, 9 * P, 0);
  g.add(beak, wattle);
  for (const p of Object.values(parts)) g.add(p);
  const animate = (t, speed, airborne) => {
    const s = Math.sin(t * 10) * Math.min(1, speed) * 0.7;
    parts.ll.rotation.x = s; parts.rl.rotation.x = -s;
    const flap = airborne ? Math.sin(t * 30) * 0.8 : 0;
    parts.lw.rotation.z = flap; parts.rw.rotation.z = -flap;
  };
  return { group: g, parts, animate, height: 0.9 };
}

export function creeperModel() {
  const g = new THREE.Group();
  const parts = {};
  const green = 0x3fa33b;
  const face = patternTexture(green, [
    '........', '.kk..kk.', '.kk..kk.', '...kk...', '..kkkk..', '..kkkk..', '..k..k..', '........',
  ], { k: 0x111111 });
  parts.head = box(8 * P, 8 * P, 8 * P, green, { front: face });
  parts.head.position.y = 22 * P;
  parts.body = box(8 * P, 12 * P, 4 * P, green);
  parts.body.position.y = 12 * P;
  const legs = [[-2, 4], [2, 4], [-2, -4], [2, -4]];
  parts.legs = legs.map(([x, z]) => {
    const l = limb(4 * P, 6 * P, 4 * P, green);
    l.position.set(x * P, 6 * P, z * P);
    g.add(l);
    return l;
  });
  g.add(parts.head, parts.body);
  const animate = (t, speed) => {
    const s = Math.sin(t * 8) * Math.min(1, speed) * 0.6;
    parts.legs[0].rotation.x = s; parts.legs[3].rotation.x = s;
    parts.legs[1].rotation.x = -s; parts.legs[2].rotation.x = -s;
  };
  return { group: g, parts, animate, height: 1.7 };
}

// 各モブの見た目
export function buildMobModel(type) {
  switch (type) {
    case 'pig': {
      const pink = 0xf0a0a0;
      const face = patternTexture(pink, ['........', '.k....k.', '........', '..pppp..', '..pkpk..', '..pppp..', '........', '........'], { k: 0x111111, p: 0xe08080 });
      return quadruped({ body: pink, head: pink, face, legs: 0xe08080, bodyW: 10, bodyH: 8, bodyL: 16, legH: 6 });
    }
    case 'cow': {
      const brown = 0x4a3020;
      const face = patternTexture(brown, ['........', '.k....k.', '........', '........', '.pppppp.', '.pkppkp.', '.pppppp.', '........'], { k: 0x111111, p: 0xd8a0a0 });
      return quadruped({ body: brown, head: brown, face, legs: 0x3a2418, bodyW: 12, bodyH: 10, bodyL: 18, legH: 12 });
    }
    case 'sheep': {
      const skin = 0xd8c8b0;
      const face = patternTexture(skin, ['........', '.k....k.', '........', '........', '........', '........', '........', '........'], { k: 0x111111 });
      return quadruped({ body: skin, head: skin, face, legs: skin, bodyW: 6, bodyH: 6, bodyL: 12, legH: 12, headSize: 6, wool: 0xf0f0f0 });
    }
    case 'chicken':
      return chickenModel();
    case 'zombie': {
      const green = 0x5a9a4a;
      const face = patternTexture(green, ['........', '........', '.k....k.', '........', '........', '..k..k..', '..kkkk..', '........'], { k: 0x111111 });
      return humanoid({ head: green, face, body: 0x2a8a8a, arms: green, legs: 0x3a3a8a, armsOut: true });
    }
    case 'skeleton': {
      const bone = 0xd8d8d8;
      const face = patternTexture(bone, ['........', '........', '.kk..kk.', '.kk..kk.', '........', '........', '.k.kk.k.', '........'], { k: 0x111111 });
      return humanoid({ head: bone, face, body: bone, arms: bone, legs: bone, thin: true, armsOut: true });
    }
    case 'creeper':
      return creeperModel();
    case 'player': {
      const skin = 0xd9a066;
      const face = patternTexture(skin, ['hhhhhhhh', 'hhhhhhhh', 'h......h', '.wk..kw.', '........', '..b..b..', '..bbbb..', '........'], { h: 0x3a2a1a, w: 0xffffff, k: 0x3a5aa0, b: 0x8a4a3a });
      return humanoid({ head: skin, face, body: 0x2f9fb3, arms: skin, legs: 0x3a3a8a });
    }
    default:
      return humanoid({ head: 0xff00ff, face: null, body: 0xff00ff, arms: 0xff00ff, legs: 0xff00ff });
  }
}

// ダメージ時の赤い点滅
export function setFlash(group, on) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) m.emissive.setHex(on ? 0x5a1414 : 0x000000);
  });
}
