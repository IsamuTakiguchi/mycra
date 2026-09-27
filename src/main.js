import * as THREE from 'three';
import { World } from './world.js';
import { Player, GAME_MODES, DIFFICULTIES } from './player.js';
import { raycastVoxel } from './raycast.js';
import { BLOCK, BLOCKS, FULL, REPLACEABLE, TOUCH_DAMAGE, FACING_DIRS, blockId, createCrackTexture } from './blocks.js';
import { ITEMS, itemName } from './items.js';
import { Inventory, HOTBAR_SIZE, CONTAINER_SIZE, serializeSlots, loadSlots } from './inventory.js';
import { InventoryScreen } from './ui.js';
import { HUD } from './hud.js';
import { HandView } from './hand.js';
import { DropManager, buildItemMesh } from './drops.js';
import { MobManager } from './mobs.js';
import { buildMobModel } from './models.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { blockIntersectsEntity, cellsTouching } from './physics.js';
import { META } from './shapes.js';
import { mulberry32 } from './noise.js';
import { DAY_LENGTH } from './constants.js';

const SAVE_KEY = 'mycra:save:v2';
const LEGACY_SAVE_KEY = 'mycra:save:v1';
const DEFAULT_SEED = 20240601;
const ATTACK_REACH = 3;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const overlay = $('overlay');
const startBtn = $('start');
const deathEl = $('death');

const touchDevice = isTouchDevice();
if (touchDevice) {
  document.body.classList.add('touch');
  startBtn.textContent = 'タップして開始';
}

// ---------- レンダラー / シーン ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, touchDevice ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);
const BASE_FOV = 75;

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

// ブロック選択枠とヒビ
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.75 }),
);
highlight.visible = false;
scene.add(highlight);
const crack = createCrackTexture();
const crackMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1.004, 1.004, 1.004),
  new THREE.MeshBasicMaterial({ map: crack.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
);
crackMesh.visible = false;
scene.add(crackMesh);

const hand = new HandView();
hand.resize(window.innerWidth / window.innerHeight);

// 三人称視点用のプレイヤーモデル
const playerModel = buildMobModel('player');
playerModel.group.visible = false;
scene.add(playerModel.group);

// ---------- 状態 ----------
let world, player, inventory, drops, mobs, screen;
let timeOfDay = 0.3;
let daylight = 1;
let lastSave = 0;
let thirdPerson = false;
let showDebug = false;
let locked = false;
let touchPlaying = false;
let mining = { active: false, key: null, progress: 0, cooldown: 0 };
let touchAim = null; // タッチ操作で対象にする画面上の位置 { x, y }
let useHeld = false;
let useRepeat = 0;
let eatTimer = 0;
let lastSpaceTap = 0;
let lastForwardTap = 0;
let bowDraw = -1; // 弓を引いている時間 (-1 は引いていない)
let saplingTimer = 0;
const primedTnt = [];
let modelAnim = 0;
let fps = 0, frames = 0, fpsTime = 0;
let spawnRand = mulberry32(1);

const hud = new HUD({
  hearts: $('hearts'), hunger: $('hunger'), armor: $('armor'), hotbar: $('hotbar'), info: $('info'),
  itemName: $('item-name'), stats: $('stats'), damage: $('damage'), toast: $('toast'),
});

function playing() {
  return (locked || touchPlaying) && !screen.open && !player.dead;
}

// ---------- セーブ / ロード ----------
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY) ?? localStorage.getItem(LEGACY_SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(showToast = false) {
  if (!world) return;
  const data = {
    version: 2,
    seed: world.seed,
    edits: world.serializeEdits(),
    player: {
      x: player.position.x, y: player.position.y, z: player.position.z,
      yaw: player.yaw, pitch: player.pitch, flying: player.flying, gameMode: player.gameMode,
      difficulty: player.difficulty, health: player.health, hunger: player.hunger, spawnPoint: player.spawnPoint,
    },
    inventory: inventory.serialize(),
    containers: [...world.containers].map(([k, slots]) => [k, serializeSlots(slots)]),
    timeOfDay,
    mobs: mobs.serialize(),
    drops: drops.serialize(),
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    if (showToast) hud.toast('セーブしました');
  } catch {
    if (showToast) hud.toast('セーブに失敗しました');
  }
  lastSave = performance.now();
}

function createWorld(seed, saveData = null, gameMode = 'survival') {
  if (world) {
    scene.remove(world.group);
    for (const c of world.chunks.values()) for (const m of c.meshes) m.geometry.dispose();
    drops.clear();
    mobs.clear();
  }
  world = new World(seed);
  world.generate();
  if (saveData?.edits) world.applyEdits(saveData.edits);
  for (const [k, slots] of saveData?.containers ?? []) world.containers.set(k, loadSlots(slots, CONTAINER_SIZE));
  for (const t of primedTnt) scene.remove(t.mesh);
  primedTnt.length = 0;
  world.buildAll();
  scene.add(world.group);

  player = new Player(world, camera);
  player.setGameMode(GAME_MODES[saveData?.player?.gameMode] ? saveData.player.gameMode : gameMode);
  player.difficulty = DIFFICULTIES[saveData?.player?.difficulty] ? saveData.player.difficulty : 'normal';
  inventory = new Inventory();
  drops = new DropManager(world, scene);
  mobs = new MobManager(world, scene);
  mobs.onPlayerHurt = () => hud.flashDamage();
  mobs.difficulty = player.difficulty;
  spawnRand = mulberry32(seed + 77);
  if (touch) touch.player = player;
  screen.inv = inventory;

  if (saveData?.player) {
    const p = saveData.player;
    player.position.set(p.x, p.y, p.z);
    player.yaw = p.yaw;
    player.pitch = p.pitch;
    player.flying = player.spectator || (!!p.flying && player.creative);
    if (p.health !== undefined) player.health = p.health;
    if (p.hunger !== undefined) player.hunger = p.hunger;
    player.spawnPoint = p.spawnPoint ?? world.findSpawn();
  } else {
    const sp = world.findSpawn();
    player.spawn(sp.x, sp.z);
  }
  if (saveData?.inventory) inventory.load(saveData.inventory);
  player.onArmorHit = (n) => {
    const broken = inventory.damageArmor(n);
    if (broken.length) hud.toast(`${itemName(broken[0])}が壊れた`);
    updateArmor();
  };
  updateArmor();
  if (saveData?.mobs) mobs.load(saveData.mobs);
  else mobs.populate(spawnRand);
  if (saveData?.drops) drops.load(saveData.drops);
  timeOfDay = saveData?.timeOfDay ?? 0.3;
  player.syncCamera();
  hud.renderHotbar(inventory);
  hand.setItem(inventory.selectedItem?.id ?? null);
  updateModeUI();
}

function newWorld() {
  const seed = Math.floor(Math.random() * 2 ** 31);
  createWorld(seed, null, player.gameMode);
  save();
  hud.toast(`新しい世界を生成しました (seed: ${seed})`);
}

function updateModeUI() {
  for (const el of document.querySelectorAll('[data-mode]')) el.classList.toggle('on', el.dataset.mode === player.gameMode);
  for (const el of document.querySelectorAll('[data-diff]')) el.classList.toggle('on', el.dataset.diff === player.difficulty);
  $('mode-desc').textContent = MODE_DESC[player.gameMode];
  $('diff-desc').textContent = DIFF_DESC[player.difficulty];
}

const MODE_DESC = {
  survival: '素材を集め、道具を作り、敵と戦いながら生き抜く。体力と満腹度がある。',
  creative: 'すべてのアイテムが使え、空を飛べて、ブロックを一瞬で壊せる。',
  adventure: 'ブロックの破壊と設置ができない。探索と戦闘を楽しむモード。',
  spectator: '壁をすり抜けて自由に飛び回れる。何にも触れず、モブにも狙われない。',
};
const DIFF_DESC = {
  peaceful: '敵がわかず、満腹度が減らず、体力が回復し続ける。',
  easy: '敵のダメージが半分。飢えても体力 5 個分までしか減らない。',
  normal: '標準。飢えると体力が半個分まで減る。',
  hard: '敵のダメージが 1.5 倍、敵の数が増え、飢えると死ぬ。',
};

function setGameMode(mode) {
  player.setGameMode(mode);
  touch.setFlying(player.flying);
  updateModeUI();
  hud.toast(`ゲームモード: ${GAME_MODES[mode]}`);
}

function setDifficulty(diff) {
  player.difficulty = diff;
  mobs.difficulty = diff;
  updateModeUI();
  hud.toast(`難易度: ${DIFFICULTIES[diff]}`);
}

// ---------- 入力 ----------
function showMenu() {
  touchPlaying = false;
  touch.setEnabled(false);
  overlay.classList.remove('hidden');
  player.keys.clear();
  stopMining();
  useHeld = false;
  save();
}

function startTouchPlay() {
  touchPlaying = true;
  overlay.classList.add('hidden');
  touch.setEnabled(true);
  touch.setFlying(player.flying);
}

async function start() {
  if (touchDevice && !window.matchMedia('(pointer: fine)').matches) {
    startTouchPlay();
    return;
  }
  try {
    const p = canvas.requestPointerLock?.();
    if (p && typeof p.then === 'function') await p;
    if (!canvas.requestPointerLock) throw new Error('unsupported');
  } catch {
    startTouchPlay();
  }
}

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) {
    touchPlaying = false;
    touch.setEnabled(false);
    overlay.classList.add('hidden');
  } else if (!touchPlaying && !screen.open && !player.dead) {
    overlay.classList.remove('hidden');
    player.keys.clear();
    stopMining();
    useHeld = false;
    save();
  }
});

document.addEventListener('mousemove', (e) => {
  if (locked && !screen.open) player.look(e.movementX, e.movementY);
});

document.addEventListener('keydown', (e) => {
  if (screen.open) {
    if (e.code === 'KeyE' || e.code === 'Escape') { e.preventDefault(); closeInventory(); }
    return;
  }
  if (!(locked || touchPlaying) || player.dead) return;
  if (e.repeat) return;
  player.keys.add(e.code);
  const now = performance.now();
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= HOTBAR_SIZE) selectSlot(n - 1);
  }
  switch (e.code) {
    case 'KeyE': openInventory(); break;
    case 'KeyQ': dropSelected(e.ctrlKey); break;
    case 'F5': e.preventDefault(); thirdPerson = !thirdPerson; break;
    case 'F3': e.preventDefault(); showDebug = !showDebug; $('info').classList.toggle('hidden', !showDebug); break;
    case 'F1': e.preventDefault(); $('hud').classList.toggle('hidden'); break;
    case 'Space':
      e.preventDefault();
      if (now - lastSpaceTap < 300) { toggleFly(); lastSpaceTap = 0; } else lastSpaceTap = now;
      break;
    case 'KeyW':
      if (now - lastForwardTap < 300 && (!player.hasStats || player.hunger > 6)) player.sprinting = true;
      lastForwardTap = now;
      break;
    case 'Escape':
      if (touchPlaying) showMenu();
      break;
    case 'Tab': e.preventDefault(); break;
  }
});

document.addEventListener('keyup', (e) => {
  player.keys.delete(e.code);
});

document.addEventListener('wheel', (e) => {
  if (!playing()) return;
  selectSlot(inventory.selected + (e.deltaY > 0 ? 1 : -1));
}, { passive: true });

canvas.addEventListener('mousedown', (e) => {
  if (!locked || !playing()) return;
  if (e.button === 0) { attack(); startMining(); }
  else if (e.button === 1) { e.preventDefault(); pickBlock(); }
  else if (e.button === 2) { useHeld = true; useRepeat = 0; use(); }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) stopMining();
  if (e.button === 2) { useHeld = false; eatTimer = 0; releaseBow(); }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function toggleFly() {
  if (!player.creative || player.spectator) return;
  const on = player.setFlying(!player.flying);
  touch.setFlying(on);
}

startBtn.addEventListener('click', start);
$('save').addEventListener('click', () => save(true));
for (const el of document.querySelectorAll('[data-mode]')) el.addEventListener('click', () => setGameMode(el.dataset.mode));
for (const el of document.querySelectorAll('[data-diff]')) el.addEventListener('click', () => setDifficulty(el.dataset.diff));
$('newworld').addEventListener('click', () => {
  if (confirm('現在の世界を破棄して新しい世界を生成しますか？')) newWorld();
});
$('reset').addEventListener('click', () => {
  if (confirm('セーブデータを削除して最初からやり直しますか？')) {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(LEGACY_SAVE_KEY);
    createWorld(DEFAULT_SEED, null, 'survival');
    hud.toast('セーブデータを削除しました');
  }
});
$('respawn').addEventListener('click', () => {
  player.respawn();
  deathEl.classList.add('hidden');
  if (!locked && !touchDevice) start();
  else if (touchDevice) startTouchPlay();
});

window.addEventListener('beforeunload', () => save());
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  hand.resize(camera.aspect);
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// タッチ操作
const touch = new TouchControls($('touch'), null, {
  onLook: (dx, dy) => { if (playing()) player.look(dx, dy); },
  onUse: (x, y) => {
    if (!playing()) return;
    touchAim = { x, y };
    if (!attack()) use(true);
    touchAim = null;
  },
  onMineStart: (x, y) => { if (playing()) { touchAim = { x, y }; attack(); startMining(); } },
  onMineMove: (x, y) => { if (mining.active) touchAim = { x, y }; },
  onMineEnd: () => stopMining(),
  onJumpPress: () => {
    const now = performance.now();
    if (now - lastSpaceTap < 300) { toggleFly(); lastSpaceTap = 0; } else lastSpaceTap = now;
  },
  onInventory: () => { if (screen.open) closeInventory(); else if (touchPlaying && !player.dead) openInventory(); },
  onMenu: () => showMenu(),
});

// ホットバーのタップ
$('hotbar').addEventListener('pointerdown', (e) => {
  const slots = [...$('hotbar').children];
  const i = slots.findIndex((s) => s === e.target || s.contains(e.target));
  if (i >= 0 && (locked || touchPlaying)) { e.preventDefault(); selectSlot(i); }
});

// ---------- インベントリ ----------
screen = new InventoryScreen($('inv-screen'), null, {
  onClose: () => closeInventory(),
  getStations: () => nearbyStations(),
  onDropStack: (stack) => dropStack(stack),
  onChange: () => { hud.renderHotbar(inventory); updateArmor(); },
});

function openInventory() {
  showScreen(player.creative || player.spectator ? 'creative' : 'survival');
}

function showScreen(mode, container = null) {
  screen.show(mode, container);
  player.keys.clear();
  stopMining();
  useHeld = false;
  bowDraw = -1;
  if (locked) document.exitPointerLock();
}

function openContainer(hit) {
  const key = `${hit.x},${hit.y},${hit.z}`;
  let slots = world.containers.get(key);
  if (!slots) { slots = new Array(CONTAINER_SIZE).fill(null); world.containers.set(key, slots); }
  showScreen('container', { title: BLOCKS[hit.id].label, slots });
}

function updateArmor() {
  player.armor = inventory.armorStats();
}

function closeInventory() {
  screen.hide();
  hud.renderHotbar(inventory);
  hand.setItem(inventory.selectedItem?.id ?? null);
  if (!touchPlaying && !locked) start();
}

function nearbyStations() {
  const set = new Set();
  const p = player.position;
  const r = 4;
  for (let x = Math.floor(p.x - r); x <= Math.floor(p.x + r); x++) {
    for (let y = Math.floor(p.y - r); y <= Math.floor(p.y + r); y++) {
      for (let z = Math.floor(p.z - r); z <= Math.floor(p.z + r); z++) {
        const st = BLOCKS[world.get(x, y, z)]?.station;
        if (st) set.add(st);
      }
    }
  }
  return set;
}

function selectSlot(i) {
  inventory.selected = (i + HOTBAR_SIZE) % HOTBAR_SIZE;
  hud.renderHotbar(inventory);
  hud.showItemName(inventory);
  hand.setItem(inventory.selectedItem?.id ?? null);
  eatTimer = 0;
}

function dropStack(stack) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const eye = player.eyePosition();
  drops.spawn(stack.id, stack.count, eye.x + dir.x * 0.5, eye.y - 0.3, eye.z + dir.z * 0.5, new THREE.Vector3(dir.x * 5, 2 + dir.y * 4, dir.z * 5), stack.damage ?? 0);
}

function dropSelected(whole) {
  const s = inventory.selectedItem;
  if (!s) return;
  const n = whole ? s.count : 1;
  dropStack({ id: s.id, count: n, damage: s.damage });
  inventory.consumeSelected(n);
  hud.renderHotbar(inventory);
  hand.setItem(inventory.selectedItem?.id ?? null);
}

// ---------- ブロック / モブ操作 ----------
const eye = new THREE.Vector3();
const dir = new THREE.Vector3();
const ndc = new THREE.Vector3();

function reach() {
  return player.creative ? 5 : 4.5;
}

// 視線の方向。タッチ操作中は指の位置を通る方向 (Bedrock 版と同じ)
function aimDirection() {
  if (touchAim && !thirdPerson) {
    camera.updateMatrixWorld();
    ndc.set((touchAim.x / window.innerWidth) * 2 - 1, -(touchAim.y / window.innerHeight) * 2 + 1, 0.5);
    ndc.unproject(camera);
    dir.copy(ndc).sub(camera.position).normalize();
  } else {
    camera.getWorldDirection(dir);
  }
  return dir;
}

function blockTarget() {
  player.eyePosition(eye);
  aimDirection();
  return raycastVoxel(world, eye, dir, reach());
}

function mobTarget() {
  player.eyePosition(eye);
  aimDirection();
  const hit = mobs.raycast(eye, dir, ATTACK_REACH);
  if (!hit) return null;
  const block = raycastVoxel(world, eye, dir, hit.distance);
  if (block && block.distance < hit.distance) return null;
  return hit.mob;
}

// 左クリック: モブがいれば攻撃 (true を返す)
function attack() {
  if (player.spectator || player.attackCooldown > 0) return false;
  const mob = mobTarget();
  if (!mob) return false;
  hand.swing();
  const item = inventory.selectedItem;
  const def = item ? ITEMS[item.id] : null;
  const dmg = def?.damage ?? 1;
  mob.damage(dmg, player.position);
  player.attackCooldown = 0.6;
  player.exhaustion += 0.1;
  if (def?.maxDamage && def.tool && player.consumesItems) {
    if (inventory.damageSelected(def.tool === 'sword' ? 1 : 2)) toolBroke(def);
  }
  return true;
}

function toolBroke(def) {
  hud.toast(`${def.name}が壊れた`);
  hud.renderHotbar(inventory);
  hand.setItem(inventory.selectedItem?.id ?? null);
}

function startMining() {
  if (!player.canBuild) {
    if (player.gameMode === 'adventure') hud.toast('アドベンチャーモードではブロックを壊せません');
    return;
  }
  mining.active = true;
}

function stopMining() {
  mining.active = false;
  mining.progress = 0;
  mining.key = null;
  touchAim = null;
}

// Minecraft の採掘時間の計算
function breakInfo(def, stack) {
  if (def.unbreakable || def.hardness < 0) return null;
  if (def.hardness === 0) return { time: 0.05, drops: true };
  const tool = stack ? ITEMS[stack.id] : null;
  const rightTool = !!(tool?.tool && def.tool && tool.tool === def.tool);
  let speed = rightTool ? tool.speed : 1;
  if (tool?.tool === 'shears' && def.shears) speed = 15;
  if (tool?.tool === 'sword' && def.shears) speed = 1.5;
  const needs = def.tool && def.minTier >= 0;
  const canHarvest = !needs || (rightTool && (tool.tier ?? 0) >= def.minTier);
  return { time: (def.hardness * (canHarvest ? 1.5 : 5)) / speed, drops: canHarvest };
}

function updateMining(dt) {
  if (mining.cooldown > 0) mining.cooldown -= dt;
  if (!mining.active || mining.cooldown > 0) {
    if (!mining.active) { mining.progress = 0; mining.key = null; }
    return;
  }
  const hit = blockTarget();
  if (!hit) { mining.progress = 0; mining.key = null; return; }
  const def = BLOCKS[hit.id];
  const stack = inventory.selectedItem;
  const info = breakInfo(def, stack);
  if (!info) { mining.progress = 0; mining.key = null; return; }
  const key = `${hit.x},${hit.y},${hit.z}`;
  if (mining.key !== key) { mining.key = key; mining.progress = 0; }
  if (player.creative) {
    // クリエイティブでは剣を持っていると壊せない (Minecraft と同じ)
    if (ITEMS[stack?.id]?.tool === 'sword') return;
    removeBlock(hit.x, hit.y, hit.z, false);
    hand.swing();
    mining.cooldown = 0.25;
    return;
  }
  mining.progress += dt / info.time;
  if (mining.progress >= 1) {
    removeBlock(hit.x, hit.y, hit.z, info.drops && player.consumesItems, stack);
    hand.swing();
    const tool = stack && ITEMS[stack.id];
    if (tool?.maxDamage && tool.tool && def.hardness > 0 && player.consumesItems) {
      if (inventory.damageSelected(tool.tool === 'sword' ? 2 : 1)) toolBroke(tool);
      else hud.renderHotbar(inventory);
    }
    mining.progress = 0;
    mining.key = null;
    mining.cooldown = 0.25;
    player.exhaustion += 0.005;
  }
}

// 旧 API (テスト用)
function breakBlockAt(hit, withDrops) {
  removeBlock(hit.x, hit.y, hit.z, withDrops && player.consumesItems, inventory.selectedItem);
}

const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function spawnBlockDrops(def, meta, x, y, z, stack) {
  const tool = stack ? ITEMS[stack.id] : null;
  const at = [x + 0.5, y + 0.5, z + 0.5];
  if (def.shears && tool?.tool === 'shears') { drops.spawn(def.item, 1, ...at); return; }
  if (def.drop) {
    let n = def.dropCount ? randInt(def.dropCount[0], def.dropCount[1]) : 1;
    if (def.shape === 'slab' && (meta & META.DOUBLE)) n = 2;
    if (n > 0) drops.spawn(def.drop, n, ...at);
  }
  if (def.dropChance) {
    for (const [id, p] of Object.entries(def.dropChance)) if (Math.random() < p) drops.spawn(id, 1, ...at);
  }
}

// ブロックを取り除く。ドア・ベッドのもう半分、チェストの中身、支えを失ったブロックも処理する
function removeBlock(x, y, z, withDrops, stack = null) {
  const id = world.get(x, y, z);
  if (!id) return;
  const meta = world.getMeta(x, y, z);
  const def = BLOCKS[id];
  world.set(x, y, z, BLOCK.AIR);
  if (def.shape === 'door') {
    const oy = meta & META.UP ? y - 1 : y + 1;
    if (world.get(x, oy, z) === id) world.set(x, oy, z, BLOCK.AIR);
  }
  if (def.bed) {
    const [dx, dz] = FACING_DIRS[meta & 3];
    const s = meta & META.UP ? -1 : 1;
    if (world.get(x + dx * s, y, z + dz * s) === id) world.set(x + dx * s, y, z + dz * s, BLOCK.AIR);
  }
  const key = `${x},${y},${z}`;
  const cont = world.containers.get(key);
  if (cont) {
    drops.spawnStacks(cont.filter(Boolean), x + 0.5, y + 0.5, z + 0.5);
    world.containers.delete(key);
    if (screen.open && screen.container?.slots === cont) closeInventory();
  }
  if (withDrops) spawnBlockDrops(def, meta, x, y, z, stack);
  // 支えを失ったブロック (上の草花・松明、壁のはしご・ボタンなど)
  checkSupport(x, y + 1, z);
  checkSupport(x, y - 1, z);
  for (const [dx, dz] of FACING_DIRS) checkSupport(x + dx, y, z + dz);
}

function checkSupport(x, y, z) {
  const id = world.get(x, y, z);
  if (!id || !BLOCKS[id].support) return;
  if (!isSupported(x, y, z, id, world.getMeta(x, y, z))) removeBlock(x, y, z, player.consumesItems);
}

const DIRTLIKE = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mycelium', 'moss_block', 'mud', 'farmland'].map(blockId));
const CANE_SOIL = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'sand', 'red_sand', 'mud', 'moss_block'].map(blockId));

// 支えになる面か (Minecraft の「しっかりした面」)。face: 'top' | 'bottom' | 'side'
function sturdy(x, y, z, face) {
  const id = world.get(x, y, z);
  if (FULL[id]) return true;
  const d = BLOCKS[id];
  if (!d?.solid) return false;
  const m = world.getMeta(x, y, z);
  if (d.shape === 'slab') return !!(m & META.DOUBLE) || (face === 'top' ? !!(m & META.UP) : face === 'bottom' ? !(m & META.UP) : false);
  if (d.shape === 'stairs') return face === 'top' ? !!(m & META.UP) : face === 'bottom' ? !(m & META.UP) : false;
  return false;
}

function isSupported(x, y, z, id, meta) {
  const def = BLOCKS[id];
  const below = world.get(x, y - 1, z);
  switch (def.support) {
    case 'below': {
      if (def.shape === 'door' && (meta & META.UP)) return world.get(x, y - 1, z) === id;
      if (def.bed) return sturdy(x, y - 1, z, 'top') || below === id;
      if (def.shape === 'torch') return sturdy(x, y - 1, z, 'top') || FACING_DIRS.some(([dx, dz]) => sturdy(x + dx, y, z + dz, 'side'));
      if (def.soil === 'dirtlike') return DIRTLIKE.has(below);
      if (def.soil === 'cane') {
        if (below === id) return true;
        return CANE_SOIL.has(below) && FACING_DIRS.some(([dx, dz]) => world.get(x + dx, y - 1, z + dz) === BLOCK.WATER);
      }
      if (Array.isArray(def.soil)) return def.soil.map(blockId).includes(below);
      return sturdy(x, y - 1, z, 'top');
    }
    case 'wall': {
      const [dx, dz] = FACING_DIRS[((meta & 3) + 2) % 4];
      return sturdy(x + dx, y, z + dz, 'side');
    }
    case 'face': {
      const f = meta & 7;
      if (f === 4) return sturdy(x, y - 1, z, 'top');
      if (f === 5) return sturdy(x, y + 1, z, 'bottom');
      const [dx, dz] = FACING_DIRS[(f + 2) % 4];
      return sturdy(x + dx, y, z + dz, 'side');
    }
    default:
      return true;
  }
}

// プレイヤーの向いている水平方向 (0 北, 1 東, 2 南, 3 西)
function lookFacing() {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 1 : 3;
  return fz > 0 ? 2 : 0;
}

function dirIndex(n) {
  if (n[2] === -1) return 0;
  if (n[0] === 1) return 1;
  if (n[2] === 1) return 2;
  return 3;
}

// 置くときのメタデータ (向き・上下など)。置けない場合は null
function placementMeta(def, hit, x, y, z) {
  const look = lookFacing();
  const n = hit.normal;
  const upper = n[1] === -1 || (n[1] === 0 && (hit.frac?.[1] ?? 0) > 0.5);
  if (def.axis) return n[1] !== 0 ? 0 : n[0] !== 0 ? 1 : 2;
  switch (def.shape) {
    case 'slab': return upper ? META.UP : 0;
    case 'stairs': return look | (upper ? META.UP : 0);
    case 'trapdoor': return (n[1] === 0 ? dirIndex(n) : (look + 2) % 4) | (upper ? META.UP : 0);
    case 'ladder': return n[1] !== 0 ? null : dirIndex(n);
    case 'button': return n[1] === 1 ? 4 : n[1] === -1 ? 5 : dirIndex(n);
    case 'door': {
      // 左隣に同じドアがあれば、両開きになるようにヒンジを右にする
      const [lx, lz] = FACING_DIRS[(look + 3) % 4];
      const left = world.get(x + lx, y, z + lz);
      const hinge = left === def.id && !(world.getMeta(x + lx, y, z + lz) & META.HINGE) ? META.HINGE : 0;
      return look | hinge;
    }
    default:
      if (def.facing === 'toward') return (look + 2) % 4;
      if (def.facing === 'look') return look;
      return 0;
  }
}

function isFree(x, y, z) {
  if (!world.inBounds(x, y, z)) return false;
  const id = world.get(x, y, z);
  return id === BLOCK.AIR || REPLACEABLE[id] === 1;
}

function consumeHeld() {
  if (!player.consumesItems) return;
  inventory.consumeSelected(1);
  hud.renderHotbar(inventory);
  hand.setItem(inventory.selectedItem?.id ?? null);
}

function placeBlock(hit, id) {
  hand.swing();
  if (!hit) return false;
  const def = BLOCKS[id];
  let x, y, z;
  if (REPLACEABLE[hit.id] && hit.id !== id && hit.id !== BLOCK.WATER) {
    x = hit.x; y = hit.y; z = hit.z;
  } else {
    // ハーフブロックの上 (または下) に同じハーフブロックを置くと 2 枚重ねになる
    if (def.shape === 'slab' && hit.id === id) {
      const m = world.getMeta(hit.x, hit.y, hit.z);
      if (!(m & META.DOUBLE) && ((hit.normal[1] === 1 && !(m & META.UP)) || (hit.normal[1] === -1 && (m & META.UP)))) {
        world.set(hit.x, hit.y, hit.z, id, META.DOUBLE);
        consumeHeld();
        return true;
      }
    }
    x = hit.x + hit.normal[0]; y = hit.y + hit.normal[1]; z = hit.z + hit.normal[2];
  }
  if (!world.inBounds(x, y, z)) return false;
  const existing = world.get(x, y, z);
  if (def.shape === 'slab' && existing === id) {
    const m = world.getMeta(x, y, z);
    if (m & META.DOUBLE) return false;
    world.set(x, y, z, id, META.DOUBLE);
    consumeHeld();
    return true;
  }
  if (!isFree(x, y, z)) return false;
  const meta = placementMeta(def, hit, x, y, z);
  if (meta === null) return false;
  if (def.solid) {
    if (!player.spectator && blockIntersectsEntity(world, x, y, z, id, meta, player)) return false;
    for (const m of mobs.mobs) if (!m.dead && blockIntersectsEntity(world, x, y, z, id, meta, m)) return false;
  }
  if (def.support && !isSupported(x, y, z, id, meta)) return false;
  if (def.shape === 'door') {
    if (!isFree(x, y + 1, z)) return false;
    world.set(x, y, z, id, meta);
    world.set(x, y + 1, z, id, meta | META.UP);
  } else if (def.bed) {
    const [dx, dz] = FACING_DIRS[meta & 3];
    if (!isFree(x + dx, y, z + dz) || !sturdy(x + dx, y - 1, z + dz, 'top')) return false;
    world.set(x, y, z, id, meta);
    world.set(x + dx, y, z + dz, id, meta | META.UP);
  } else {
    world.set(x, y, z, id, meta);
  }
  if (def.container) world.containers.set(`${x},${y},${z}`, new Array(CONTAINER_SIZE).fill(null));
  if (def.powderTo) hardenPowder(x, y, z);
  consumeHeld();
  return true;
}

// コンクリートパウダーは水に触れるとコンクリートになる
function hardenPowder(x, y, z) {
  const def = BLOCKS[world.get(x, y, z)];
  if (!def?.powderTo) return;
  const touching = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => world.get(x + dx, y + dy, z + dz) === BLOCK.WATER);
  if (touching) world.set(x, y, z, blockId(def.powderTo));
}

function toggleOpen(hit) {
  const def = BLOCKS[hit.id];
  const m = world.getMeta(hit.x, hit.y, hit.z) ^ META.OPEN;
  world.setMeta(hit.x, hit.y, hit.z, m);
  if (def.shape === 'door') {
    const oy = m & META.UP ? hit.y - 1 : hit.y + 1;
    if (world.get(hit.x, oy, hit.z) === hit.id) world.setMeta(hit.x, oy, hit.z, (world.getMeta(hit.x, oy, hit.z) & ~META.OPEN) | (m & META.OPEN));
  }
  hand.swing();
}

function sleepInBed(hit) {
  const m = world.getMeta(hit.x, hit.y, hit.z);
  const [dx, dz] = FACING_DIRS[m & 3];
  const foot = m & META.UP ? { x: hit.x - dx, z: hit.z - dz } : { x: hit.x, z: hit.z };
  player.spawnPoint = foot;
  if (daylight > 0.35) {
    hud.toast('リスポーン地点を設定しました。眠れるのは夜だけです');
    return;
  }
  const monster = mobs.mobs.some((mb) => mb.def.hostile && !mb.dead && mb.position.distanceTo(player.position) < 8);
  if (monster) { hud.toast('近くにモンスターがいるので、今は休むことができません'); return; }
  timeOfDay = 0.26;
  hud.toast('朝になりました');
  save();
}

// TNT に火をつける
function igniteTnt(x, y, z, fuse = 4) {
  world.set(x, y, z, BLOCK.AIR);
  const mesh = buildItemMesh('tnt');
  mesh.material = mesh.material.clone();
  mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  scene.add(mesh);
  primedTnt.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, fuse, mesh });
}

function updateTnt(dt) {
  for (let i = primedTnt.length - 1; i >= 0; i--) {
    const t = primedTnt[i];
    t.fuse -= dt;
    t.mesh.material.emissive.setHex(Math.floor(t.fuse * 4) % 2 ? 0x777777 : 0x000000);
    if (t.fuse <= 0) {
      scene.remove(t.mesh);
      primedTnt.splice(i, 1);
      explode(t.x, t.y, t.z, 4);
    }
  }
}

// 爆発 (クリーパー・TNT 共通)
function explode(cx, cy, cz, power, source = null) {
  world.explode(cx, cy, cz, power, (x, y, z, id, meta) => {
    const def = BLOCKS[id];
    if (def.tnt) { igniteTnt(x, y, z, 0.5 + Math.random()); world.set(x, y, z, BLOCK.AIR); return; }
    const key = `${x},${y},${z}`;
    const cont = world.containers.get(key);
    if (cont) { drops.spawnStacks(cont.filter(Boolean), x + 0.5, y + 0.5, z + 0.5); world.containers.delete(key); }
    if (Math.random() < 1 / power) spawnBlockDrops(def, meta, x, y, z, null);
  });
  const center = new THREE.Vector3(cx, cy, cz);
  const d = player.position.clone().add(new THREE.Vector3(0, 0.9, 0)).distanceTo(center);
  const r = power * 2;
  if (d < r) {
    const impact = 1 - d / r;
    const dmg = Math.floor(((impact * impact + impact) / 2) * 7 * r + 1);
    const dx = player.position.x - cx, dz = player.position.z - cz;
    const l = Math.hypot(dx, dz) || 1;
    if (player.damage(dmg, { x: (dx / l) * 10 * impact, z: (dz / l) * 10 * impact }, true)) hud.flashDamage();
  }
  mobs.blast(cx, cy, cz, power, source);
}

// バケツ: 水をくむ / 置く
function useBucket(def) {
  player.eyePosition(eye);
  aimDirection();
  const hit = raycastVoxel(world, eye, dir, reach(), { fluids: true });
  if (!hit) return;
  if (def.bucket === 'empty') {
    if (hit.id !== BLOCK.WATER) return;
    world.set(hit.x, hit.y, hit.z, BLOCK.AIR);
    if (player.consumesItems) {
      const s = inventory.selectedItem;
      if (s.count > 1) { s.count -= 1; if (inventory.add('water_bucket', 1) > 0) dropStack({ id: 'water_bucket', count: 1 }); }
      else inventory.slots[inventory.selected] = { id: 'water_bucket', count: 1 };
    }
  } else {
    if (!player.canBuild) return;
    let x = hit.x, y = hit.y, z = hit.z;
    if (!REPLACEABLE[hit.id]) { x += hit.normal[0]; y += hit.normal[1]; z += hit.normal[2]; }
    if (!isFree(x, y, z)) return;
    world.set(x, y, z, BLOCK.WATER);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) hardenPowder(x + dx, y + dy, z + dz);
    if (player.consumesItems) inventory.slots[inventory.selected] = { id: 'bucket', count: 1 };
  }
  hand.swing();
  hud.renderHotbar(inventory);
  hand.setItem(inventory.selectedItem?.id ?? null);
}

// 弓: 右クリックを押している間に引き、離すと射る
function releaseBow(power = null) {
  if (bowDraw < 0 && power === null) return;
  const t = bowDraw;
  bowDraw = -1;
  const stack = inventory.selectedItem;
  if (!ITEMS[stack?.id]?.bow) return;
  const p = power ?? Math.min(1, (t * t + t * 2) / 3); // Minecraft の引き具合 (1 秒で最大)
  if (p < 0.1) return;
  if (player.consumesItems && inventory.count('arrow') <= 0) { hud.toast('矢がありません'); return; }
  if (player.consumesItems) inventory.remove('arrow', 1);
  player.eyePosition(eye);
  aimDirection();
  const from = eye.clone().addScaledVector(dir, 0.6);
  mobs.addArrow(from, dir.clone().multiplyScalar(60 * p), 'player', 6 * p, player.consumesItems);
  if (player.consumesItems && inventory.damageSelected(1)) toolBroke(ITEMS.bow);
  hand.swing();
  hud.renderHotbar(inventory);
}

// 右クリック / タップ: 使う・置く・食べる
function use(instant = false) {
  if (player.spectator) return;
  const stack = inventory.selectedItem;
  const def = stack ? ITEMS[stack.id] : null;
  const hit = blockTarget();

  if (hit && !player.sneaking) {
    const b = BLOCKS[hit.id];
    if (b.station) { openInventory(); return; }
    if (b.container) { openContainer(hit); return; }
    if (b.open) { toggleOpen(hit); return; }
    if (b.bed) { sleepInBed(hit); return; }
    if (b.tnt && stack?.id === 'flint_and_steel') {
      igniteTnt(hit.x, hit.y, hit.z);
      if (player.consumesItems && inventory.damageSelected(1)) toolBroke(def);
      hand.swing();
      return;
    }
    if (b.sapling && stack?.id === 'bone_meal') {
      if (Math.random() < 0.45) world.growSapling(hit.x, hit.y, hit.z);
      consumeHeld();
      hand.swing();
      return;
    }
    if (b.name === 'pumpkin' && stack?.id === 'shears') {
      world.set(hit.x, hit.y, hit.z, blockId('carved_pumpkin'), (lookFacing() + 2) % 4);
      if (player.consumesItems && inventory.damageSelected(1)) toolBroke(def);
      hand.swing();
      return;
    }
  }
  if (def?.armor) {
    inventory.equipSelected();
    updateArmor();
    hud.renderHotbar(inventory);
    hand.setItem(inventory.selectedItem?.id ?? null);
    return;
  }
  if (def?.food) {
    if (player.hunger >= 20 && player.hasStats && stack.id !== 'golden_apple') return;
    if (instant) eatNow();
    return; // デスクトップでは長押しで食べる (updateUse)
  }
  if (def?.bucket) { useBucket(def); return; }
  if (def?.bow) {
    if (instant) releaseBow(1);
    else bowDraw = 0;
    return;
  }
  if (def?.block !== undefined) {
    if (!player.canBuild) { hud.toast('アドベンチャーモードではブロックを置けません'); return; }
    placeBlock(hit, def.block);
    return;
  }
  hand.swing();
}

function eatNow() {
  const item = inventory.selectedItem;
  const def = item ? ITEMS[item.id] : null;
  if (!def?.food) return;
  player.eat(def.food);
  if (def.heal) player.health = Math.min(20, player.health + def.heal);
  if (player.consumesItems) {
    inventory.consumeSelected(1);
    if (def.returns && inventory.add(def.returns, 1) > 0) dropStack({ id: def.returns, count: 1 });
  }
  hud.renderHotbar(inventory);
  hand.setItem(inventory.selectedItem?.id ?? null);
  hand.swing();
  hud.toast(`${def.name}を食べた`);
  eatTimer = 0;
}

// ホイールクリック: 見ているブロックを手に持つ
function pickBlock() {
  const hit = blockTarget();
  if (!hit) return;
  const itemId = BLOCKS[hit.id].item;
  if (!itemId) return;
  if (player.creative || player.spectator) inventory.pickBlock(itemId);
  else {
    for (let i = 0; i < HOTBAR_SIZE; i++) if (inventory.slots[i]?.id === itemId) { inventory.selected = i; break; }
  }
  hud.renderHotbar(inventory);
  hand.setItem(inventory.selectedItem?.id ?? null);
}

// 右クリック長押し: 連続設置 / 食事 / 弓を引く
function updateUse(dt) {
  if (bowDraw >= 0) { bowDraw += dt; return; }
  if (!useHeld) return;
  const item = inventory.selectedItem;
  const def = item ? ITEMS[item.id] : null;
  if (def?.food) {
    if (player.hunger >= 20 && player.hasStats && item.id !== 'golden_apple') return;
    eatTimer += dt;
    if (Math.floor(eatTimer * 6) !== Math.floor((eatTimer - dt) * 6)) hand.swing();
    if (eatTimer >= 1.6) eatNow();
    return;
  }
  useRepeat += dt;
  if (useRepeat >= 0.25) { useRepeat = 0; use(); }
}

// サボテン・マグマブロックのダメージ、苗木の成長
function updateEnvironment(dt) {
  if (player.hasStats && !player.dead) {
    if (cellsTouching(player, 0.05).some(([x, y, z]) => TOUCH_DAMAGE[world.get(x, y, z)])) player.damage(1) && hud.flashDamage();
    const below = world.get(Math.floor(player.position.x), Math.floor(player.position.y - 0.05), Math.floor(player.position.z));
    if (player.onGround && !player.sneaking && BLOCKS[below]?.name === 'magma_block') player.damage(1) && hud.flashDamage();
  }
  saplingTimer += dt;
  if (saplingTimer >= 5) {
    saplingTimer = 0;
    for (const key of [...world.saplings]) {
      if (Math.random() > 0.06) continue;
      const [x, y, z] = key.split(',').map(Number);
      if (world.lightLevel(x, y + 1, z, daylight) >= 9) world.growSapling(x, y, z);
    }
  }
}

// ---------- 昼夜サイクル ----------
function updateSky(dt) {
  timeOfDay = (timeOfDay + dt / DAY_LENGTH) % 1;
  const angle = timeOfDay * Math.PI * 2 - Math.PI / 2;
  const sunHeight = Math.sin(angle);
  sun.position.set(Math.cos(angle) * 100, sunHeight * 100, 30);
  daylight = THREE.MathUtils.clamp(sunHeight * 2.5 + 0.2, 0, 1);
  const duskness = THREE.MathUtils.clamp(1 - Math.abs(sunHeight) * 6, 0, 1);
  skyColor.copy(skyNight).lerp(skyDay, daylight).lerp(skyDusk, duskness * daylight * 0.6);
  sun.intensity = 0.4 + 0.5 * daylight;
  hemi.intensity = 0.35 + 0.25 * daylight;
  ambient.intensity = 0.25 + 0.15 * daylight;
  world.setDaylight(daylight);
  scene.fog.color.copy(skyColor);
}

// ---------- 三人称 ----------
const camDir = new THREE.Vector3();
function updateCamera() {
  player.syncCamera();
  const sprintFov = player.sprinting ? BASE_FOV * 1.1 : BASE_FOV;
  camera.fov += (sprintFov - camera.fov) * 0.2;
  camera.updateProjectionMatrix();
  if (!thirdPerson) {
    playerModel.group.visible = false;
    hand.visible = !player.spectator;
    return;
  }
  hand.visible = false;
  camera.getWorldDirection(camDir);
  const back = camDir.clone().negate();
  const origin = player.eyePosition();
  const hit = raycastVoxel(world, origin, back, 4);
  const dist = hit ? Math.max(0.5, hit.distance - 0.3) : 4;
  camera.position.copy(origin).addScaledVector(back, dist);
  playerModel.group.visible = true;
  playerModel.group.position.copy(player.position);
  playerModel.group.rotation.y = player.yaw + Math.PI;
  playerModel.parts.head.rotation.x = -player.pitch;
  playerModel.animate(modelAnim, Math.hypot(player.velocity.x, player.velocity.z) / 2);
}

// ---------- メインループ ----------
let last = performance.now();

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const active = playing();

  if (active) {
    player.update(dt);
    updateMining(dt);
    updateUse(dt);
    updateEnvironment(dt);
    if (player.moving) modelAnim += dt;
  } else if (player.dead && deathEl.classList.contains('hidden')) {
    onDeath();
  }
  updateTnt(dt);
  world.update(3);
  updateSky(dt);
  mobs.update(dt, player, daylight, {
    drops,
    onPlayerHurt: () => hud.flashDamage(),
    explode: (x, y, z, power, source) => explode(x, y, z, power, source),
  });
  drops.update(dt, active && !player.spectator ? player : null, inventory, () => { hud.renderHotbar(inventory); if (!hand.item && inventory.selectedItem) hand.setItem(inventory.selectedItem.id); });
  if (player.dead && deathEl.classList.contains('hidden')) onDeath();

  updateCamera();
  hand.update(dt, active && player.moving, mining.active && !!mining.key);

  // 選択枠とヒビ
  const hit = active || screen.open ? blockTarget() : null;
  const mob = active ? mobTarget() : null;
  highlight.visible = !!hit && !mob;
  if (hit) {
    const b = hit.bounds;
    highlight.position.set(hit.x + (b[0] + b[3]) / 2, hit.y + (b[1] + b[4]) / 2, hit.z + (b[2] + b[5]) / 2);
    highlight.scale.set(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
  }
  if (mining.key && mining.progress > 0 && hit) {
    crackMesh.visible = true;
    crackMesh.position.copy(highlight.position);
    crackMesh.scale.copy(highlight.scale);
    crack.texture.offset.x = Math.min(crack.stages - 1, Math.floor(mining.progress * crack.stages)) / crack.stages;
  } else crackMesh.visible = false;

  // 水中の見た目
  const inWaterHead = world.get(Math.floor(camera.position.x), Math.floor(camera.position.y), Math.floor(camera.position.z)) === BLOCK.WATER;
  if (inWaterHead) {
    scene.fog.near = 2; scene.fog.far = 24;
    scene.fog.color.set(0x1d4f9e);
    scene.background = scene.fog.color;
  } else {
    scene.fog.near = 60; scene.fog.far = 150;
    scene.background = skyColor;
  }

  hud.updateStats(player, player.armor.points);
  frames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = Math.round(frames / fpsTime);
    frames = 0; fpsTime = 0;
    if (showDebug) {
      const p = player.position;
      const hours = Math.floor(timeOfDay * 24), mins = Math.floor((timeOfDay * 24 - hours) * 60);
      const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
      hud.setDebug(
        `FPS ${fps}\nXYZ ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}\n` +
        `Block ${bx} ${by} ${bz}\n時刻 ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}\n` +
        `明るさ 空 ${world.lighting.skyAt(bx, by, bz)} 光源 ${world.lighting.blockAt(bx, by, bz)}\n` +
        `モード ${GAME_MODES[player.gameMode]} / ${DIFFICULTIES[player.difficulty]}${player.flying ? ' 飛行' : ''}${player.sneaking ? ' スニーク' : ''}${player.sprinting ? ' ダッシュ' : ''}\n` +
        `モブ ${mobs.mobs.length}  ドロップ ${drops.items.length}\n` +
        `手持ち ${inventory.selectedItem ? itemName(inventory.selectedItem.id) : 'なし'}` +
        (hit ? `\n注視 ${BLOCKS[hit.id].label} (${hit.x} ${hit.y} ${hit.z}) meta ${world.getMeta(hit.x, hit.y, hit.z)}` : '') +
        (mob ? `\n対象 ${mob.def.name} HP ${mob.health}` : ''),
      );
    }
  }

  if ((locked || touchPlaying) && performance.now() - lastSave > 10000) save();

  renderer.clear();
  renderer.render(scene, camera);
  hand.render(renderer);
}

function onDeath() {
  stopMining();
  useHeld = false;
  touch.setEnabled(false);
  if (player.hasStats) {
    const all = inventory.takeAll();
    drops.spawnStacks(all, player.position.x, player.position.y + 0.5, player.position.z);
    updateArmor();
    hud.renderHotbar(inventory);
    hand.setItem(null);
  }
  $('death-cause').textContent = `場所: ${Math.floor(player.position.x)}, ${Math.floor(player.position.y)}, ${Math.floor(player.position.z)}`;
  deathEl.classList.remove('hidden');
  if (locked) document.exitPointerLock();
  save();
}

// ---------- 起動 ----------
const saved = loadSave();
createWorld(saved?.seed ?? DEFAULT_SEED, saved, 'survival');
requestAnimationFrame(loop);

// デバッグ / 自動テスト用フック
window.__mycra = {
  get world() { return world; },
  get player() { return player; },
  get inventory() { return inventory; },
  get mobs() { return mobs; },
  get drops() { return drops; },
  get hand() { return hand; },
  get touch() { return touch; },
  get screen() { return screen; },
  get timeOfDay() { return timeOfDay; },
  get mining() { return mining; },
  get playing() { return playing(); },
  get locked() { return locked; },
  get touchPlaying() { return touchPlaying; },
  get touchAim() { return touchAim; },
  set touchAim(v) { touchAim = v; },
  set timeOfDay(v) { timeOfDay = v; },
  blockTarget, mobTarget, attack, startMining, stopMining, use, placeBlock, pickBlock, save, selectSlot,
  startTouchPlay, showMenu, openInventory, closeInventory, breakBlockAt, eatNow, setGameMode, setDifficulty,
  removeBlock, explode, igniteTnt, releaseBow, openContainer, updateArmor,
  set thirdPerson(v) { thirdPerson = v; },
};
