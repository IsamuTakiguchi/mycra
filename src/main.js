import * as THREE from 'three';
import { World } from './world.js';
import { Player, GAME_MODES, DIFFICULTIES } from './player.js';
import { raycastVoxel } from './raycast.js';
import { BLOCK, BLOCKS, isSolid, createCrackTexture } from './blocks.js';
import { ITEMS, itemName } from './items.js';
import { Inventory, HOTBAR_SIZE } from './inventory.js';
import { InventoryScreen } from './ui.js';
import { HUD } from './hud.js';
import { HandView } from './hand.js';
import { DropManager } from './drops.js';
import { MobManager } from './mobs.js';
import { buildMobModel } from './models.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { intersectsBlock } from './physics.js';
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
let modelAnim = 0;
let fps = 0, frames = 0, fpsTime = 0;
let spawnRand = mulberry32(1);

const hud = new HUD({
  hearts: $('hearts'), hunger: $('hunger'), hotbar: $('hotbar'), info: $('info'),
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
  if (e.button === 2) { useHeld = false; eatTimer = 0; }
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
});

function openInventory() {
  screen.show(player.creative || player.spectator ? 'creative' : 'survival');
  player.keys.clear();
  stopMining();
  useHeld = false;
  if (locked) document.exitPointerLock();
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
        const id = world.get(x, y, z);
        if (id === BLOCK.CRAFTING_TABLE) set.add('crafting_table');
        else if (id === BLOCK.FURNACE) set.add('furnace');
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
  drops.spawn(stack.id, stack.count, eye.x + dir.x * 0.5, eye.y - 0.3, eye.z + dir.z * 0.5, new THREE.Vector3(dir.x * 5, 2 + dir.y * 4, dir.z * 5));
}

function dropSelected(whole) {
  const s = inventory.selectedItem;
  if (!s) return;
  const n = whole ? s.count : 1;
  dropStack({ id: s.id, count: n });
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
  const dmg = item && ITEMS[item.id].damage ? ITEMS[item.id].damage : 1;
  mob.damage(dmg, player.position);
  player.attackCooldown = 0.6;
  player.exhaustion += 0.1;
  return true;
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

// 破壊にかかる時間 (秒) と、ドロップするか
function breakInfo(def, item) {
  if (def.unbreakable) return null;
  if (def.hardness <= 0) return { time: 0.05, drops: true };
  const tool = item ? ITEMS[item.id] : null;
  const rightTool = tool?.tool && tool.tool === def.tool;
  const required = def.tool && def.minTier >= 0;
  if (required && !(rightTool && tool.tier >= def.minTier)) return { time: def.hardness * 5, drops: false };
  if (rightTool) return { time: (def.hardness * 1.5) / tool.speed, drops: true };
  return { time: def.hardness * 1.5, drops: true };
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
  const info = breakInfo(def, inventory.selectedItem);
  if (!info) { mining.progress = 0; mining.key = null; return; }
  const key = `${hit.x},${hit.y},${hit.z}`;
  if (mining.key !== key) { mining.key = key; mining.progress = 0; }
  if (player.creative) {
    breakBlockAt(hit, false);
    mining.cooldown = 0.25;
    return;
  }
  mining.progress += dt / info.time;
  if (mining.progress >= 1) {
    breakBlockAt(hit, info.drops);
    mining.progress = 0;
    mining.key = null;
    mining.cooldown = 0.25;
    player.exhaustion += 0.005;
  }
}

function breakBlockAt(hit, withDrops) {
  const def = BLOCKS[hit.id];
  world.set(hit.x, hit.y, hit.z, BLOCK.AIR);
  hand.swing();
  if (!withDrops || !player.consumesItems) return;
  if (def.drop) drops.spawn(def.drop, 1, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  if (def.dropChance) {
    for (const [id, p] of Object.entries(def.dropChance)) if (Math.random() < p) drops.spawn(id, 1, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  }
  // たいまつは支えを失うと落ちる
  const above = world.get(hit.x, hit.y + 1, hit.z);
  if (above === BLOCK.TORCH) { world.set(hit.x, hit.y + 1, hit.z, BLOCK.AIR); drops.spawn('torch', 1, hit.x + 0.5, hit.y + 1.3, hit.z + 0.5); }
}

// 右クリック / タップ: 使う・置く・食べる
function use(instantEat = false) {
  if (player.spectator) return;
  const item = inventory.selectedItem;
  const def = item ? ITEMS[item.id] : null;
  const hit = blockTarget();

  // 作業台・かまどを開く (スニーク中は開かずにブロックを置ける)
  if (hit && !player.sneaking && (hit.id === BLOCK.CRAFTING_TABLE || hit.id === BLOCK.FURNACE)) {
    openInventory();
    return;
  }
  if (def?.food) {
    if (player.hunger >= 20 && player.hasStats) return;
    if (instantEat) eatNow();
    return; // デスクトップでは長押しで食べる (updateUse)
  }
  if (def?.block !== undefined) {
    if (!player.canBuild) { hud.toast('アドベンチャーモードではブロックを置けません'); return; }
    placeBlock(hit, def.block);
  } else hand.swing();
}

function eatNow() {
  const item = inventory.selectedItem;
  const def = item ? ITEMS[item.id] : null;
  if (!def?.food) return;
  player.eat(def.food);
  if (player.consumesItems) inventory.consumeSelected(1);
  hud.renderHotbar(inventory);
  hand.setItem(inventory.selectedItem?.id ?? null);
  hand.swing();
  hud.toast(`${def.name}を食べた`);
  eatTimer = 0;
}

function placeBlock(hit, id) {
  hand.swing();
  if (!hit) return;
  const x = hit.x + hit.normal[0];
  const y = hit.y + hit.normal[1];
  const z = hit.z + hit.normal[2];
  if (!world.inBounds(x, y, z)) return;
  const existing = world.get(x, y, z);
  if (existing !== BLOCK.AIR && existing !== BLOCK.WATER) return;
  const def = BLOCKS[id];
  if (def.solid) {
    if (intersectsBlock(player, x, y, z)) return;
    for (const m of mobs.mobs) if (!m.dead && intersectsBlock(m, x, y, z)) return;
  }
  if (id === BLOCK.TORCH) {
    // 支えになるブロックが必要
    const supported = isSolid(world.get(x, y - 1, z)) || isSolid(world.get(x + 1, y, z)) || isSolid(world.get(x - 1, y, z)) || isSolid(world.get(x, y, z + 1)) || isSolid(world.get(x, y, z - 1));
    if (!supported) return;
  }
  world.set(x, y, z, id);
  if (player.consumesItems) {
    inventory.consumeSelected(1);
    hud.renderHotbar(inventory);
    hand.setItem(inventory.selectedItem?.id ?? null);
  }
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

// 右クリック長押し: 連続設置 / 食事
function updateUse(dt) {
  if (!useHeld) return;
  const item = inventory.selectedItem;
  const def = item ? ITEMS[item.id] : null;
  if (def?.food) {
    if (player.hunger >= 20 && player.hasStats) return;
    eatTimer += dt;
    if (Math.floor(eatTimer * 6) !== Math.floor((eatTimer - dt) * 6)) hand.swing();
    if (eatTimer >= 1.6) eatNow();
    return;
  }
  useRepeat += dt;
  if (useRepeat >= 0.25) { useRepeat = 0; use(); }
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
    if (player.moving) modelAnim += dt;
  } else if (player.dead && deathEl.classList.contains('hidden')) {
    onDeath();
  }
  world.update(3);
  updateSky(dt);
  mobs.update(dt, player, daylight, {
    drops,
    onPlayerHurt: () => hud.flashDamage(),
    onExplosion: () => hud.toast('クリーパーが爆発した！'),
  });
  drops.update(dt, active && !player.spectator ? player : null, inventory, () => { hud.renderHotbar(inventory); if (!hand.item && inventory.selectedItem) hand.setItem(inventory.selectedItem.id); });
  if (player.dead && deathEl.classList.contains('hidden')) onDeath();

  updateCamera();
  hand.update(dt, active && player.moving, mining.active && !!mining.key);

  // 選択枠とヒビ
  const hit = active || screen.open ? blockTarget() : null;
  const mob = active ? mobTarget() : null;
  highlight.visible = !!hit && !mob;
  if (hit) highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  if (mining.key && mining.progress > 0 && hit) {
    crackMesh.visible = true;
    crackMesh.position.copy(highlight.position);
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

  hud.updateStats(player);
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
        (hit ? `\n注視 ${BLOCKS[hit.id].name} (${hit.x} ${hit.y} ${hit.z})` : '') +
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
  set thirdPerson(v) { thirdPerson = v; },
};
