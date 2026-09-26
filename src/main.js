import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { raycastVoxel } from './raycast.js';
import { BLOCK, BLOCKS, HOTBAR_BLOCKS, drawTileTo } from './blocks.js';

const SAVE_KEY = 'mycra:save:v1';
const REACH = 6;
const DAY_LENGTH = 600; // 秒 (1 日 = 10 分)

// ---------- DOM ----------
const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const infoEl = document.getElementById('info');
const hotbarEl = document.getElementById('hotbar');
const toastEl = document.getElementById('toast');

// ---------- レンダラー / シーン ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);

const skyDay = new THREE.Color(0x87ceeb);
const skyDusk = new THREE.Color(0xf0905a);
const skyNight = new THREE.Color(0x0b1026);
const skyColor = new THREE.Color();
scene.background = skyColor;
scene.fog = new THREE.Fog(skyColor, 60, 150);

const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
scene.add(sun);
const ambient = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambient);

// ブロック選択枠
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.75 }),
);
highlight.visible = false;
scene.add(highlight);

// ---------- ワールド / プレイヤー ----------
let world;
let player;
let selected = 0;
let timeOfDay = 0.3; // 0..1 (0.25 = 朝, 0.5 = 昼, 0.75 = 夕方)
let lastSave = 0;

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(showToast = false) {
  if (!world) return;
  const data = {
    seed: world.seed,
    edits: world.serializeEdits(),
    player: {
      x: player.position.x, y: player.position.y, z: player.position.z,
      yaw: player.yaw, pitch: player.pitch, flying: player.flying,
    },
    timeOfDay,
    selected,
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    if (showToast) toast('セーブしました');
  } catch {
    if (showToast) toast('セーブに失敗しました');
  }
  lastSave = performance.now();
}

function createWorld(seed, saveData = null) {
  if (world) {
    scene.remove(world.group);
    for (const c of world.chunks.values()) for (const m of c.meshes) m.geometry.dispose();
  }
  world = new World(seed);
  world.generate();
  if (saveData?.edits) world.applyEdits(saveData.edits);
  world.buildAll();
  scene.add(world.group);

  player = new Player(world, camera);
  if (saveData?.player) {
    const p = saveData.player;
    player.position.set(p.x, p.y, p.z);
    player.yaw = p.yaw;
    player.pitch = p.pitch;
    player.flying = !!p.flying;
  } else {
    const sp = world.findSpawn();
    player.spawn(sp.x, sp.z);
  }
  timeOfDay = saveData?.timeOfDay ?? 0.3;
  selected = saveData?.selected ?? 0;
  player.syncCamera();
  renderHotbar();
}

function newWorld() {
  const seed = Math.floor(Math.random() * 2 ** 31);
  createWorld(seed);
  save();
  toast(`新しい世界を生成しました (seed: ${seed})`);
}

// ---------- ホットバー ----------
function renderHotbar() {
  hotbarEl.innerHTML = '';
  HOTBAR_BLOCKS.forEach((id, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === selected ? ' selected' : '');
    const c = document.createElement('canvas');
    drawTileTo(c, BLOCKS[id].tiles[2]);
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(i + 1);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = BLOCKS[id].name;
    slot.append(num, c, name);
    hotbarEl.appendChild(slot);
  });
}

function selectSlot(i) {
  selected = (i + HOTBAR_BLOCKS.length) % HOTBAR_BLOCKS.length;
  [...hotbarEl.children].forEach((el, j) => el.classList.toggle('selected', j === selected));
}

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
}

// ---------- 入力 ----------
let locked = false;

function requestLock() {
  canvas.requestPointerLock?.();
}

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  overlay.classList.toggle('hidden', locked);
  if (!locked) {
    player.keys.clear();
    save();
  }
});

document.addEventListener('mousemove', (e) => {
  if (locked) player.look(e.movementX, e.movementY);
});

document.addEventListener('keydown', (e) => {
  if (!locked) return;
  player.keys.add(e.code);
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= HOTBAR_BLOCKS.length) selectSlot(n - 1);
  }
  if (e.code === 'KeyF') {
    toast(player.toggleFly() ? '飛行モード ON' : '飛行モード OFF');
  }
  if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
});

document.addEventListener('keyup', (e) => {
  player.keys.delete(e.code);
});

document.addEventListener('wheel', (e) => {
  if (!locked) return;
  selectSlot(selected + (e.deltaY > 0 ? 1 : -1));
}, { passive: true });

canvas.addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) breakBlock();
  else if (e.button === 2) placeBlock();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

document.getElementById('start').addEventListener('click', requestLock);
document.getElementById('save').addEventListener('click', () => save(true));
document.getElementById('newworld').addEventListener('click', () => {
  if (confirm('現在の世界を破棄して新しい世界を生成しますか？')) newWorld();
});
document.getElementById('reset').addEventListener('click', () => {
  if (confirm('セーブデータを削除して最初からやり直しますか？')) {
    localStorage.removeItem(SAVE_KEY);
    createWorld(20240601);
    toast('セーブデータを削除しました');
  }
});

window.addEventListener('beforeunload', () => save());
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- ブロック操作 ----------
const eye = new THREE.Vector3();
const dir = new THREE.Vector3();

function currentTarget() {
  player.eyePosition(eye);
  camera.getWorldDirection(dir);
  return raycastVoxel(world, eye, dir, REACH);
}

function breakBlock() {
  const hit = currentTarget();
  if (!hit) return;
  if (BLOCKS[hit.id]?.unbreakable) {
    toast('岩盤は壊せません');
    return;
  }
  world.set(hit.x, hit.y, hit.z, BLOCK.AIR);
}

function placeBlock() {
  const hit = currentTarget();
  if (!hit) return;
  const x = hit.x + hit.normal[0];
  const y = hit.y + hit.normal[1];
  const z = hit.z + hit.normal[2];
  if (!world.inBounds(x, y, z)) return;
  if (player.intersectsBlock(x, y, z)) return;
  const id = HOTBAR_BLOCKS[selected];
  world.set(x, y, z, id);
}

// ---------- 昼夜サイクル ----------
function updateSky(dt) {
  timeOfDay = (timeOfDay + dt / DAY_LENGTH) % 1;
  const angle = timeOfDay * Math.PI * 2 - Math.PI / 2; // 0.25 で日の出
  const sunHeight = Math.sin(angle);
  sun.position.set(Math.cos(angle) * 100, sunHeight * 100, 30);
  const daylight = THREE.MathUtils.clamp(sunHeight * 2.5 + 0.2, 0, 1);
  const duskness = THREE.MathUtils.clamp(1 - Math.abs(sunHeight) * 6, 0, 1);
  skyColor.copy(skyNight).lerp(skyDay, daylight).lerp(skyDusk, duskness * daylight * 0.6);
  sun.intensity = 0.9 * daylight;
  hemi.intensity = 0.2 + 0.4 * daylight;
  ambient.intensity = 0.18 + 0.25 * daylight;
  scene.fog.color.copy(skyColor);
}

// ---------- メインループ ----------
let last = performance.now();
let frames = 0;
let fpsTime = 0;
let fps = 0;

function loop(now) {
  requestAnimationFrame(loop);

// デバッグ / 自動テスト用フック
window.__mycra = {
  get world() { return world; },
  get player() { return player; },
  breakBlock, placeBlock, save, selectSlot, currentTarget,
};
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (locked) player.update(dt);
  world.update(3);
  updateSky(dt);

  const hit = currentTarget();
  highlight.visible = !!hit;
  if (hit) highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);

  // 水中の見た目
  const inWaterHead = world.get(Math.floor(camera.position.x), Math.floor(camera.position.y), Math.floor(camera.position.z)) === BLOCK.WATER;
  if (inWaterHead) {
    scene.fog.near = 2;
    scene.fog.far = 24;
    scene.fog.color.set(0x1d4f9e);
    scene.background = scene.fog.color;
  } else {
    scene.fog.near = 60;
    scene.fog.far = 150;
    scene.background = skyColor;
  }

  frames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = Math.round(frames / fpsTime);
    frames = 0;
    fpsTime = 0;
    const p = player.position;
    const hours = Math.floor(timeOfDay * 24);
    const mins = Math.floor((timeOfDay * 24 - hours) * 60);
    infoEl.textContent =
      `FPS ${fps}\n` +
      `XYZ ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}\n` +
      `時刻 ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}\n` +
      `モード ${player.flying ? '飛行' : player.inWater ? '水泳' : '歩行'}\n` +
      `手持ち ${BLOCKS[HOTBAR_BLOCKS[selected]].name}` +
      (hit ? `\n注視 ${BLOCKS[hit.id].name}` : '');
  }

  if (locked && performance.now() - lastSave > 10000) save();

  renderer.render(scene, camera);
}

// ---------- 起動 ----------
const saved = loadSave();
createWorld(saved?.seed ?? 20240601, saved);
requestAnimationFrame(loop);

// デバッグ / 自動テスト用フック
window.__mycra = {
  get world() { return world; },
  get player() { return player; },
  breakBlock, placeBlock, save, selectSlot, currentTarget,
};
