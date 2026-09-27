import { defTex, P, shade, mix, tileIndex, createAtlas, tileUV, drawTileTo, createCrackTexture, TILE_PX } from './textures.js';

export { createAtlas, tileUV, drawTileTo, createCrackTexture, TILE_PX };

// ---- ブロックの登録 ----
// ID は 16bit。旧バージョンのセーブと互換を保つため、最初の 21 種は固定の番号にする。
export const MAX_BLOCKS = 4096;
export const BLOCKS = [];
export const OPAQUE = new Uint8Array(MAX_BLOCKS);
export const SOLID = new Uint8Array(MAX_BLOCKS);
export const FULL = new Uint8Array(MAX_BLOCKS); // 当たり判定が 1x1x1 の立方体
export const LIGHT = new Uint8Array(MAX_BLOCKS);
export const REPLACEABLE = new Uint8Array(MAX_BLOCKS);
export const CLIMBABLE = new Uint8Array(MAX_BLOCKS);
export const SLIPPERY = new Uint8Array(MAX_BLOCKS);
export const BOUNCY = new Uint8Array(MAX_BLOCKS);
export const TOUCH_DAMAGE = new Uint8Array(MAX_BLOCKS);
const byName = new Map();
let order = 0;

const LEGACY = [
  'air', 'grass_block', 'dirt', 'stone', 'sand', 'oak_log', 'oak_leaves', 'oak_planks', 'cobblestone', 'glass', 'water',
  'bricks', 'bedrock', 'snow_block', 'gravel', 'torch', 'crafting_table', 'furnace', 'coal_ore', 'iron_ore', 'white_wool',
];
LEGACY.forEach((n, i) => { byName.set(n, i); BLOCKS[i] = null; });

const NON_SOLID_SHAPES = new Set(['cross', 'torch', 'plate', 'button', 'none']);

function normTex(tex) {
  if (typeof tex === 'string') return { top: tex, bottom: tex, side: tex, front: tex };
  const side = tex.side ?? tex.all;
  const top = tex.top ?? tex.end ?? tex.all ?? side;
  const bottom = tex.bottom ?? tex.end ?? tex.all ?? top;
  return { top, bottom, side, front: tex.front ?? side, head: tex.head ?? top };
}

export function block(name, o) {
  let id = byName.get(name);
  if (id === undefined) { id = BLOCKS.length; byName.set(name, id); BLOCKS.push(null); }
  else if (BLOCKS[id]) return id;
  const shape = o.shape ?? 'cube';
  const layer = o.layer ?? (['cross', 'torch', 'ladder', 'door', 'trapdoor', 'lantern', 'pane'].includes(shape) ? 'cutout' : 'opaque');
  const d = {
    id, name, label: o.label, shape, layer,
    tex: o.tex ? normTex(o.tex) : null,
    hardness: o.hardness ?? 1,
    tool: o.tool ?? null,
    minTier: o.minTier ?? -1,
    drop: o.drop === undefined ? (o.item === null ? null : name) : o.drop,
    dropCount: o.dropCount ?? null,
    dropChance: o.dropChance ?? null,
    shears: !!o.shears,
    item: o.item === undefined ? name : o.item,
    light: o.light ?? 0,
    unbreakable: !!o.unbreakable,
    axis: !!o.axis,
    facing: o.facing ?? null, // 'look' | 'toward' | 'wall' | 'face'
    tab: o.tab ?? 'building',
    support: o.support ?? null, // 'below' | 'wall' | 'face'
    soil: o.soil ?? null,
    open: !!o.open,
    container: o.container ?? 0,
    station: o.station ?? null,
    bed: !!o.bed,
    tnt: !!o.tnt,
    sapling: o.sapling ?? null,
    powderTo: o.powderTo ?? null,
    connect: o.connect ?? null, // 'fence' | 'pane' | 'wall'
    fallMult: o.fallMult ?? 1,
    wood: o.wood ?? null,
    color: o.color ?? null,
    base: o.base ?? null, // ハーフブロック・階段・塀の元になるブロック
    order: order++,
  };
  d.opaque = o.opaque ?? (shape === 'cube' && layer === 'opaque');
  d.solid = o.solid ?? !NON_SOLID_SHAPES.has(shape);
  BLOCKS[id] = d;
  OPAQUE[id] = d.opaque ? 1 : 0;
  SOLID[id] = d.solid ? 1 : 0;
  FULL[id] = shape === 'cube' && d.solid ? 1 : 0;
  LIGHT[id] = d.light;
  REPLACEABLE[id] = o.replaceable ? 1 : 0;
  CLIMBABLE[id] = o.climbable ? 1 : 0;
  SLIPPERY[id] = o.slippery ? 1 : 0;
  BOUNCY[id] = o.bouncy ? 1 : 0;
  TOUCH_DAMAGE[id] = o.touchDamage ? 1 : 0;
  return id;
}

export function blockId(name) {
  return byName.get(name) ?? 0;
}

export function blockDef(name) {
  return BLOCKS[byName.get(name)];
}

export function isOpaque(id) {
  return OPAQUE[id] === 1;
}

export function isSolid(id) {
  return SOLID[id] === 1;
}

// 向き: 0 北 (-z), 1 東 (+x), 2 南 (+z), 3 西 (-x)
export const FACING_DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const FACE_OF_FACING = [4, 1, 5, 0];

function resolveTiles(d) {
  if (!d._t) {
    const t = d.tex;
    d._t = { top: tileIndex(t.top), bottom: tileIndex(t.bottom), side: tileIndex(t.side), front: tileIndex(t.front), head: tileIndex(t.head) };
  }
  return d._t;
}

// 面 f (0 -x, 1 +x, 2 -y, 3 +y, 4 -z, 5 +z) に貼るタイル
export function faceTile(id, f, meta = 0) {
  const d = BLOCKS[id];
  const t = resolveTiles(d);
  if (d.axis) {
    const ax = meta & 3;
    const end = ax === 0 ? f === 2 || f === 3 : ax === 1 ? f === 0 || f === 1 : f === 4 || f === 5;
    return end ? t.top : t.side;
  }
  if (d.shape === 'door') return meta & 4 ? t.top : t.bottom;
  if (d.bed) {
    if (f === 3) return meta & 4 ? t.head : t.top;
    return f === 2 ? t.bottom : t.side;
  }
  if (f === 3) return t.top;
  if (f === 2) return t.bottom;
  if (d.facing && d.tex.front !== d.tex.side && f === FACE_OF_FACING[meta & 3]) return t.front;
  return t.side;
}

// ============================================================
// カタログ
// ============================================================
const T = defTex;

// ---- 空気・水・岩盤 ----
block('air', { label: '空気', shape: 'none', layer: null, item: null, hardness: 0, solid: false, opaque: false, unbreakable: true });
T('water', P.noise(0x2d6fd8, 18));
block('water', { label: '水', tex: 'water', layer: 'water', solid: false, opaque: false, item: null, unbreakable: true, replaceable: true });
T('bedrock', P.noise(0x3a3a3a, 34));
block('bedrock', { label: '岩盤', tex: 'bedrock', unbreakable: true, hardness: -1, tab: 'natural' });

// ---- 土・砂など ----
T('grass_top', P.noise(0x5fa832, 20));
T('dirt', P.noise(0x7f5a36, 18));
T('grass_side', (t) => {
  P.noise(0x7f5a36, 18)(t);
  for (let x = 0; x < 16; x++) {
    const depth = 2 + t.r(3);
    for (let y = 0; y < depth; y++) t.px(x, y, t.rand() < 0.8 ? 0x5fa832 : 0x4e9128);
  }
});
block('grass_block', { label: '草ブロック', tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, hardness: 0.6, tool: 'shovel', drop: 'dirt', tab: 'natural' });
block('dirt', { label: '土', tex: 'dirt', hardness: 0.5, tool: 'shovel', tab: 'natural' });
T('coarse_dirt', P.mottled(0x77553b, 0x5a3f2a, 60));
block('coarse_dirt', { label: '粗い土', tex: 'coarse_dirt', hardness: 0.5, tool: 'shovel', tab: 'natural' });
T('podzol_top', P.mottled(0x5a3d1c, 0x7a5a2a, 70));
T('podzol_side', (t) => { P.noise(0x7f5a36, 18)(t); for (let x = 0; x < 16; x++) for (let y = 0; y < 3 + t.r(2); y++) t.px(x, y, t.jit(0x5a3d1c, 10)); });
block('podzol', { label: 'ポドゾル', tex: { top: 'podzol_top', bottom: 'dirt', side: 'podzol_side' }, hardness: 0.5, tool: 'shovel', drop: 'dirt', tab: 'natural' });
T('rooted_dirt', (t) => { P.noise(0x906c50, 14)(t); for (let i = 0; i < 6; i++) { const x = t.r(), y = t.r(12); for (let k = 0; k < 4; k++) t.px(x + (k & 1), y + k, 0xc9b28c); } });
block('rooted_dirt', { label: '根付いた土', tex: 'rooted_dirt', hardness: 0.5, tool: 'shovel', tab: 'natural' });
T('mycelium_top', P.speckle(0x6f6369, 14, 0x9a8a98, 30));
T('mycelium_side', (t) => { P.noise(0x7f5a36, 18)(t); for (let x = 0; x < 16; x++) for (let y = 0; y < 2 + t.r(3); y++) t.px(x, y, t.jit(0x6f6369, 10)); });
block('mycelium', { label: '菌糸', tex: { top: 'mycelium_top', bottom: 'dirt', side: 'mycelium_side' }, hardness: 0.6, tool: 'shovel', drop: 'dirt', tab: 'natural' });
T('mud', P.noise(0x3c3a3e, 10));
block('mud', { label: '泥', tex: 'mud', hardness: 0.5, tool: 'shovel', tab: 'natural' });
T('clay', P.noise(0xa0a6b3, 8));
block('clay', { label: '粘土', tex: 'clay', hardness: 0.6, tool: 'shovel', drop: 'clay_ball', dropCount: [4, 4], tab: 'natural' });
T('sand', P.noise(0xdbcf98, 14));
block('sand', { label: '砂', tex: 'sand', hardness: 0.5, tool: 'shovel', tab: 'natural' });
T('red_sand', P.noise(0xbe6621, 14));
block('red_sand', { label: '赤い砂', tex: 'red_sand', hardness: 0.5, tool: 'shovel', tab: 'natural' });
T('gravel', P.noise(0x8c8478, 30));
block('gravel', { label: '砂利', tex: 'gravel', hardness: 0.6, tool: 'shovel', dropChance: { flint: 0.1 }, tab: 'natural' });
T('snow', P.noise(0xf4f8fb, 6));
block('snow_block', { label: '雪ブロック', tex: 'snow', hardness: 0.2, tool: 'shovel', minTier: 0, drop: 'snowball', dropCount: [4, 4], tab: 'natural' });
T('ice', (t) => { t.fill(0x91b7fd, 8, 170); for (let i = 3; i < 12; i++) t.px(i, 14 - i, 0xd8e8ff, 200); });
block('ice', { label: '氷', tex: 'ice', layer: 'translucent', opaque: false, hardness: 0.5, tool: 'pickaxe', drop: null, slippery: true, tab: 'natural' });
T('packed_ice', P.noise(0x8db4fa, 10));
block('packed_ice', { label: '氷塊', tex: 'packed_ice', hardness: 0.5, tool: 'pickaxe', drop: null, slippery: true, tab: 'natural' });
T('blue_ice', P.noise(0x74a8fd, 10));
block('blue_ice', { label: '青氷', tex: 'blue_ice', hardness: 2.8, tool: 'pickaxe', drop: null, slippery: true, tab: 'natural' });
T('moss', P.mottled(0x596e2d, 0x6f8a36, 60));
block('moss_block', { label: '苔ブロック', tex: 'moss', hardness: 0.1, tool: 'hoe', tab: 'natural' });
block('moss_carpet', { label: '苔のカーペット', tex: 'moss', shape: 'carpet', hardness: 0.1, tool: 'hoe', support: 'below', tab: 'natural' });
T('soul_sand', P.mottled(0x51402f, 0x3a2c20, 50));
block('soul_sand', { label: 'ソウルサンド', tex: 'soul_sand', hardness: 0.5, tool: 'shovel', tab: 'natural' });
T('soul_soil', P.noise(0x4b3a2d, 12));
block('soul_soil', { label: 'ソウルソイル', tex: 'soul_soil', hardness: 0.5, tool: 'shovel', tab: 'natural' });
T('netherrack', P.mottled(0x6f3535, 0x5a2626, 70));
block('netherrack', { label: 'ネザーラック', tex: 'netherrack', hardness: 0.4, tool: 'pickaxe', minTier: 0, tab: 'natural' });
T('glowstone', (t) => { t.fill(0xac8354, 20); t.specks(0xffe58a, 60, 20); });
block('glowstone', { label: 'グロウストーン', tex: 'glowstone', hardness: 0.3, light: 15, drop: 'glowstone_dust', dropCount: [2, 4], tab: 'natural' });
T('magma', (t) => { t.fill(0x8e3f20, 14); for (let i = 0; i < 20; i++) t.px(t.r(), t.r(), 0xf0a030); });
block('magma_block', { label: 'マグマブロック', tex: 'magma', hardness: 0.5, tool: 'pickaxe', minTier: 0, light: 3, tab: 'natural' });
T('obsidian', (t) => { t.fill(0x100c1c, 8); t.specks(0x3a2a5a, 20, 6); });
block('obsidian', { label: '黒曜石', tex: 'obsidian', hardness: 50, tool: 'pickaxe', minTier: 3, tab: 'natural' });
T('crying_obsidian', (t) => { t.fill(0x200a3c, 8); t.specks(0x9a40ff, 26, 16); });
block('crying_obsidian', { label: '泣く黒曜石', tex: 'crying_obsidian', hardness: 50, tool: 'pickaxe', minTier: 3, light: 10, tab: 'natural' });
T('sponge', (t) => { t.fill(0xc4c24c, 12); for (let i = 0; i < 18; i++) t.px(t.r(), t.r(), 0x8a8a2a); });
block('sponge', { label: 'スポンジ', tex: 'sponge', hardness: 0.6, tool: 'hoe', tab: 'natural' });
T('wet_sponge', (t) => { t.fill(0xa9a93a, 12); for (let i = 0; i < 18; i++) t.px(t.r(), t.r(), 0x6a6a20); });
block('wet_sponge', { label: '濡れたスポンジ', tex: 'wet_sponge', hardness: 0.6, tool: 'hoe', tab: 'natural' });
T('slime', (t) => { t.fill(0x6fc05a, 10, 170); t.border(0x4f9a3a); t.rect(4, 4, 8, 8, 0x8ad876, 6, 200); });
block('slime_block', { label: 'スライムブロック', tex: 'slime', layer: 'translucent', opaque: false, hardness: 0, bouncy: true, fallMult: 0, tab: 'functional' });
T('dripstone', P.mottled(0x866b5c, 0x9a7e6c, 50));
block('dripstone_block', { label: '鍾乳石ブロック', tex: 'dripstone', hardness: 1.5, tool: 'pickaxe', minTier: 0, tab: 'natural' });
T('bone_side', (t) => { t.fill(0xe4dfc9, 6); for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x++) t.px(x, y, 0xcfc8ae); });
T('bone_top', (t) => { t.fill(0xe4dfc9, 6); t.rect(5, 5, 6, 6, 0xcfc8ae); t.rect(6, 6, 4, 4, 0xb8b09a); });
block('bone_block', { label: '骨ブロック', tex: { side: 'bone_side', end: 'bone_top' }, axis: true, hardness: 2, tool: 'pickaxe', minTier: 0, tab: 'natural' });
T('hay_side', (t) => { t.fill(0xa98f22, 14); for (let x = 0; x < 16; x++) { t.px(x, 4, 0x8a2a1a); t.px(x, 11, 0x8a2a1a); } for (let i = 0; i < 30; i++) t.px(t.r(), t.r(), 0xd6c04a); });
T('hay_top', (t) => { t.fill(0xa98f22, 14); t.border(0x8a2a1a); t.specks(0xd6c04a, 30); });
block('hay_block', { label: '干草の俵', tex: { side: 'hay_side', end: 'hay_top' }, axis: true, hardness: 0.5, tool: 'hoe', fallMult: 0.2, tab: 'natural' });
T('pumpkin_side', (t) => { t.fill(0xc57718, 10); for (let x = 1; x < 16; x += 4) for (let y = 0; y < 16; y++) t.px(x, y, 0xa45e10); });
T('pumpkin_top', (t) => { t.fill(0xc57718, 10); t.rect(6, 6, 4, 4, 0x6a8a2a); });
T('pumpkin_face', (t) => { t.fill(0xc57718, 10); for (let x = 1; x < 16; x += 4) for (let y = 0; y < 16; y++) t.px(x, y, 0xa45e10); t.rect(3, 4, 3, 3, 0x2a1a0a); t.rect(10, 4, 3, 3, 0x2a1a0a); t.rect(4, 10, 8, 2, 0x2a1a0a); t.px(6, 12, 0x2a1a0a); t.px(9, 12, 0x2a1a0a); });
T('jack_face', (t) => { t.fill(0xc57718, 10); for (let x = 1; x < 16; x += 4) for (let y = 0; y < 16; y++) t.px(x, y, 0xa45e10); t.rect(3, 4, 3, 3, 0xffd85a); t.rect(10, 4, 3, 3, 0xffd85a); t.rect(4, 10, 8, 2, 0xffd85a); t.px(6, 12, 0xffd85a); t.px(9, 12, 0xffd85a); });
block('pumpkin', { label: 'カボチャ', tex: { side: 'pumpkin_side', end: 'pumpkin_top' }, hardness: 1, tool: 'axe', tab: 'natural' });
block('carved_pumpkin', { label: 'くり抜かれたカボチャ', tex: { side: 'pumpkin_side', end: 'pumpkin_top', front: 'pumpkin_face' }, facing: 'toward', hardness: 1, tool: 'axe', tab: 'natural' });
block('jack_o_lantern', { label: 'ジャック・オ・ランタン', tex: { side: 'pumpkin_side', end: 'pumpkin_top', front: 'jack_face' }, facing: 'toward', hardness: 1, tool: 'axe', light: 15, tab: 'natural' });
T('melon_side', (t) => { t.fill(0x6f9a2a, 10); for (let x = 0; x < 16; x += 3) for (let y = 0; y < 16; y++) if (t.rand() < 0.7) t.px(x, y, 0xa8c24a); });
T('melon_top', (t) => { t.fill(0x6f9a2a, 10); t.rect(6, 6, 4, 4, 0x5a7a20); });
block('melon', { label: 'スイカ', tex: { side: 'melon_side', end: 'melon_top' }, hardness: 1, tool: 'axe', drop: 'melon_slice', dropCount: [3, 7], tab: 'natural' });
T('cactus_side', (t) => { t.clear(); t.rect(1, 0, 14, 16, 0x5a8a2a, 8); for (let y = 1; y < 16; y += 4) { t.px(1, y, 0xd8d8a0); t.px(14, y + 2, 0xd8d8a0); } for (let y = 0; y < 16; y++) { t.px(4, y, 0x4a7a20); t.px(11, y, 0x4a7a20); } });
T('cactus_top', (t) => { t.clear(); t.rect(1, 1, 14, 14, 0x6a9a3a, 8); t.rect(6, 6, 4, 4, 0x8ab84a); });
block('cactus', { label: 'サボテン', tex: { side: 'cactus_side', end: 'cactus_top' }, shape: 'cactus', layer: 'cutout', hardness: 0.4, touchDamage: true, support: 'below', soil: ['sand', 'red_sand', 'cactus'], tab: 'natural' });

// ---- 植物 ----
T('short_grass', P.grassPlant(0x5fa832));
block('short_grass', { label: '草', tex: 'short_grass', shape: 'cross', hardness: 0, drop: null, dropChance: { wheat_seeds: 0.125 }, shears: true, replaceable: true, support: 'below', soil: 'dirtlike', tab: 'natural' });
T('fern', P.fern(0x4e8f2e));
block('fern', { label: 'シダ', tex: 'fern', shape: 'cross', hardness: 0, drop: null, dropChance: { wheat_seeds: 0.125 }, shears: true, replaceable: true, support: 'below', soil: 'dirtlike', tab: 'natural' });
T('dead_bush', P.deadBush);
block('dead_bush', { label: '枯れ木', tex: 'dead_bush', shape: 'cross', hardness: 0, drop: 'stick', dropCount: [0, 2], replaceable: true, support: 'below', soil: ['sand', 'red_sand', 'terracotta', 'dirt', 'coarse_dirt', 'podzol'], tab: 'natural' });
T('sugar_cane', P.sugarCane);
block('sugar_cane', { label: 'サトウキビ', tex: 'sugar_cane', shape: 'cross', hardness: 0, support: 'below', soil: 'cane', tab: 'natural' });
const FLOWERS = [
  ['dandelion', 'タンポポ', P.flower(0xf5e02a, 0xf0a020)],
  ['poppy', 'ポピー', P.flower(0xd8261e, 0x2a2a1a)],
  ['blue_orchid', 'ヒスイラン', P.flower(0x2aa8e0, 0x8ad8f0)],
  ['allium', 'アリウム', P.flower(0xb86ad8, 0xd89af0)],
  ['azure_bluet', 'ヒナソウ', P.flower(0xe8ecf0, 0xf0e050)],
  ['red_tulip', '赤色のチューリップ', P.tulip(0xd8261e)],
  ['orange_tulip', '橙色のチューリップ', P.tulip(0xf07a1e)],
  ['white_tulip', '白色のチューリップ', P.tulip(0xf0f0f0)],
  ['pink_tulip', '桃色のチューリップ', P.tulip(0xf0a0c0)],
  ['oxeye_daisy', 'フランスギク', P.flower(0xf4f4f0, 0xf0c020)],
  ['cornflower', 'ヤグルマギク', P.flower(0x4a6ad8, 0x2a3a90)],
  ['lily_of_the_valley', 'スズラン', P.flower(0xfafafa, 0xe0e0d0)],
];
export const FLOWER_NAMES = FLOWERS.map((f) => f[0]);
for (const [name, label, painter] of FLOWERS) {
  T(name, painter);
  block(name, { label, tex: name, shape: 'cross', hardness: 0, support: 'below', soil: 'dirtlike', tab: 'natural' });
}
T('brown_mushroom', P.mushroom(0x9a7050));
block('brown_mushroom', { label: '茶色のキノコ', tex: 'brown_mushroom', shape: 'cross', hardness: 0, light: 1, support: 'below', tab: 'natural' });
T('red_mushroom', P.mushroom(0xd82a2a, 0xf4f4f4));
block('red_mushroom', { label: '赤色のキノコ', tex: 'red_mushroom', shape: 'cross', hardness: 0, support: 'below', tab: 'natural' });
T('brown_mushroom_block', P.mottled(0x9a7050, 0x8a6040, 40));
block('brown_mushroom_block', { label: '茶色のキノコブロック', tex: 'brown_mushroom_block', hardness: 0.2, tool: 'axe', drop: 'brown_mushroom', dropCount: [0, 2], tab: 'natural' });
T('red_mushroom_block', (t) => { t.fill(0xc82a2a, 10); for (let i = 0; i < 6; i++) t.rect(t.r(13), t.r(13), 2 + t.r(2), 2, 0xf0f0f0); });
block('red_mushroom_block', { label: '赤色のキノコブロック', tex: 'red_mushroom_block', hardness: 0.2, tool: 'axe', drop: 'red_mushroom', dropCount: [0, 2], tab: 'natural' });
T('mushroom_stem', P.noise(0xd8d0b8, 8));
block('mushroom_stem', { label: 'キノコの柄', tex: 'mushroom_stem', hardness: 0.2, tool: 'axe', drop: null, tab: 'natural' });

// ---- 木材 ----
export const WOODS = [
  { id: 'oak', p: 'オークの', planks: 0xb8905a, bark: 0x6b4a26, inner: 0xc7a266, leaves: 0x3d8a2a, stripped: 0xb08a52, window: true, apple: true },
  { id: 'spruce', p: 'トウヒの', planks: 0x7a5a35, bark: 0x3b2a18, inner: 0x9a7446, leaves: 0x2e5a2e, stripped: 0x8a6a3f },
  { id: 'birch', p: 'シラカバの', planks: 0xd7c386, bark: 'birch', inner: 0xd8c690, leaves: 0x6a9a3e, stripped: 0xd0bb7e, window: true },
  { id: 'jungle', p: 'ジャングルの', planks: 0xb07d56, bark: 0x5a4a1e, inner: 0xb58a58, leaves: 0x3aa21e, stripped: 0xb58250, window: true },
  { id: 'acacia', p: 'アカシアの', planks: 0xb8602e, bark: 0x6a6258, inner: 0xb86a3a, leaves: 0x5a9a2a, stripped: 0xae5c30 },
  { id: 'dark_oak', p: 'ダークオークの', planks: 0x4a3018, bark: 0x3a2a14, inner: 0x5a3e22, leaves: 0x2a6a1a, stripped: 0x5a4024, apple: true },
  { id: 'mangrove', p: 'マングローブの', planks: 0x7a3a32, bark: 0x5a4a38, inner: 0x7a3a32, leaves: 0x4a8a28, stripped: 0x7a3a32, sapling: 'mangrove_propagule', saplingLabel: 'マングローブの芽' },
  { id: 'cherry', p: 'サクラの', planks: 0xe6b6ae, bark: 0x3a2230, inner: 0xd6a09a, leaves: 0xf0b0d0, stripped: 0xe0a8a0, window: true },
  { id: 'bamboo', p: '竹の', planks: 0xd6c25a, bark: 0x7a9a2a, inner: 0xc8b04a, stripped: 0xc8b85a, bamboo: true },
  { id: 'crimson', p: '真紅の', planks: 0x6a3448, bark: 0x5a1a2a, inner: 0x7a3a4a, stripped: 0x8a3a52, nether: true },
  { id: 'warped', p: '歪んだ', planks: 0x2a6a64, bark: 0x3a2a4a, inner: 0x3a8a80, stripped: 0x3a9088, nether: true },
];

export const WOOD_LOGS = {}; // wood id -> 原木系のアイテム名一覧
for (const w of WOODS) {
  const logName = w.bamboo ? 'bamboo_block' : w.nether ? `${w.id}_stem` : `${w.id}_log`;
  const logLabel = w.bamboo ? `${w.p}ブロック` : w.nether ? `${w.p}幹` : `${w.p}原木`;
  const woodName = w.nether ? `${w.id}_hyphae` : `${w.id}_wood`;
  const woodLabel = w.nether ? `${w.p}菌糸` : `${w.p}木`;
  const bark = w.bark === 'birch' ? P.birchSide : w.bamboo ? P.stripped(w.bark) : P.logSide(w.bark);
  T(`${w.id}_log`, bark);
  T(`${w.id}_log_top`, P.logTop(w.bark === 'birch' ? 0xe3dfd2 : w.bark, w.inner));
  T(`stripped_${w.id}_log`, P.stripped(w.stripped));
  T(`stripped_${w.id}_log_top`, P.logTop(shade(w.stripped, -0.1), w.stripped));
  T(`${w.id}_planks`, P.planks(w.planks));
  const common = { tool: 'axe', wood: w.id };
  block(logName, { label: logLabel, tex: { side: `${w.id}_log`, end: `${w.id}_log_top` }, axis: true, hardness: 2, ...common, tab: 'building' });
  block(`stripped_${logName}`, { label: `樹皮を剥いだ${logLabel}`, tex: { side: `stripped_${w.id}_log`, end: `stripped_${w.id}_log_top` }, axis: true, hardness: 2, ...common });
  const logs = [logName, `stripped_${logName}`];
  if (!w.bamboo) {
    block(woodName, { label: woodLabel, tex: `${w.id}_log`, axis: true, hardness: 2, ...common });
    block(`stripped_${woodName}`, { label: `樹皮を剥いだ${woodLabel}`, tex: `stripped_${w.id}_log`, axis: true, hardness: 2, ...common });
    logs.push(woodName, `stripped_${woodName}`);
  }
  WOOD_LOGS[w.id] = logs;
  const planks = `${w.id}_planks`;
  block(planks, { label: `${w.p}板材`, tex: planks, hardness: 2, ...common });
  block(`${w.id}_slab`, { label: `${w.p}ハーフブロック`, tex: planks, shape: 'slab', hardness: 2, ...common, base: planks });
  block(`${w.id}_stairs`, { label: `${w.p}階段`, tex: planks, shape: 'stairs', facing: 'look', hardness: 2, ...common, base: planks });
  block(`${w.id}_fence`, { label: `${w.p}フェンス`, tex: planks, shape: 'fence', connect: 'fence', hardness: 2, ...common });
  block(`${w.id}_fence_gate`, { label: `${w.p}フェンスゲート`, tex: planks, shape: 'fence_gate', facing: 'look', open: true, hardness: 2, ...common });
  T(`${w.id}_door_top`, P.door(w.planks, true, !!w.window));
  T(`${w.id}_door_bottom`, P.door(w.planks, false));
  block(`${w.id}_door`, { label: `${w.p}ドア`, tex: { top: `${w.id}_door_top`, bottom: `${w.id}_door_bottom`, side: `${w.id}_door_bottom` }, shape: 'door', facing: 'look', open: true, hardness: 3, support: 'below', ...common });
  T(`${w.id}_trapdoor`, P.trapdoor(w.planks));
  block(`${w.id}_trapdoor`, { label: `${w.p}トラップドア`, tex: `${w.id}_trapdoor`, shape: 'trapdoor', facing: 'look', open: true, hardness: 3, ...common });
  block(`${w.id}_pressure_plate`, { label: `${w.p}感圧板`, tex: planks, shape: 'plate', hardness: 0.5, support: 'below', ...common });
  block(`${w.id}_button`, { label: `${w.p}ボタン`, tex: planks, shape: 'button', facing: 'face', hardness: 0.5, support: 'face', ...common });
  if (!w.nether && !w.bamboo) {
    T(`${w.id}_leaves`, P.leaves(w.leaves));
    const sap = w.sapling ?? `${w.id}_sapling`;
    const dropChance = { [sap]: 0.05, stick: 0.02 };
    if (w.apple) dropChance.apple = 0.005;
    block(`${w.id}_leaves`, { label: `${w.p}葉`, tex: `${w.id}_leaves`, layer: 'cutout', opaque: false, hardness: 0.2, tool: 'hoe', drop: null, dropChance, shears: true, tab: 'natural' });
    T(sap, P.sapling(w.leaves, w.bark === 'birch' ? 0xe3dfd2 : w.bark));
    block(sap, { label: w.saplingLabel ?? `${w.p}苗木`, tex: sap, shape: 'cross', hardness: 0, support: 'below', soil: 'dirtlike', sapling: w.id, tab: 'natural' });
  }
}
T('nether_wart_block', P.mottled(0x7a0e0e, 0x5a0808, 60));
block('nether_wart_block', { label: 'ネザーウォートブロック', tex: 'nether_wart_block', hardness: 1, tool: 'hoe', tab: 'natural' });
T('warped_wart_block', P.mottled(0x167a78, 0x0e5a58, 60));
block('warped_wart_block', { label: '歪んだウォートブロック', tex: 'warped_wart_block', hardness: 1, tool: 'hoe', tab: 'natural' });

// ---- 石材 ----
// variants: s ハーフブロック, t 階段, w 塀
function stoneSet(name, label, tex, variants = '', o = {}) {
  const key = o.key ?? name;
  const base = { tool: 'pickaxe', minTier: 0, hardness: o.hardness ?? 1.5, tab: o.tab ?? 'building' };
  block(name, { label, tex, ...base, ...o.block });
  const faceTex = typeof tex === 'string' ? tex : tex;
  if (variants.includes('s')) block(`${key}_slab`, { label: `${o.slabLabel ?? label}のハーフブロック`, tex: faceTex, shape: 'slab', ...base, hardness: o.slabHardness ?? base.hardness, base: name });
  if (variants.includes('t')) block(`${key}_stairs`, { label: `${o.slabLabel ?? label}の階段`, tex: faceTex, shape: 'stairs', facing: 'look', ...base, base: name });
  if (variants.includes('w')) block(`${key}_wall`, { label: `${label}の塀`, tex: typeof faceTex === 'string' ? faceTex : faceTex.side, shape: 'wall', connect: 'wall', ...base, base: name });
}

const cobble = (c) => (t) => {
  t.fill(c, 24);
  for (let i = 0; i < 6; i++) {
    const cx = t.r(14), cy = t.r(14);
    for (let d = 0; d < 3; d++) { t.px(cx + d, cy, shade(c, -0.35)); t.px(cx, cy + d, shade(c, -0.35)); }
  }
};
const mossy = (painter) => (t) => { painter(t); for (let i = 0; i < 45; i++) t.px(t.r(), t.r(), t.jit(0x5a7a3a, 12)); };
const cracked = (painter) => (t) => { painter(t); let x = 3, y = 1; for (let i = 0; i < 14; i++) { t.px(x, y, 0x2a2a2a); x += t.r(3) - 1; y += 1; } };

T('stone', (t) => { t.fill(0x8a8a8a, 14); t.specks(0x6e6e6e, 8); });
stoneSet('stone', '石', 'stone', 'st', { block: { drop: 'cobblestone' } });
T('cobblestone', cobble(0x7b7b7b));
stoneSet('cobblestone', '丸石', 'cobblestone', 'stw', { hardness: 2 });
T('mossy_cobblestone', mossy(cobble(0x7b7b7b)));
stoneSet('mossy_cobblestone', '苔むした丸石', 'mossy_cobblestone', 'stw', { hardness: 2 });
T('smooth_stone', (t) => { t.fill(0x9e9e9e, 5); t.border(0x7a7a7a); });
stoneSet('smooth_stone', '滑らかな石', 'smooth_stone', 's', { hardness: 2 });
T('stone_bricks', P.stoneBricks(0x7a7a7a));
stoneSet('stone_bricks', '石レンガ', 'stone_bricks', 'stw', { key: 'stone_brick' });
T('mossy_stone_bricks', mossy(P.stoneBricks(0x7a7a7a)));
stoneSet('mossy_stone_bricks', '苔むした石レンガ', 'mossy_stone_bricks', 'stw', { key: 'mossy_stone_brick' });
T('cracked_stone_bricks', cracked(P.stoneBricks(0x7a7a7a)));
stoneSet('cracked_stone_bricks', 'ひび割れた石レンガ', 'cracked_stone_bricks');
T('chiseled_stone_bricks', P.chiseled(0x7a7a7a));
stoneSet('chiseled_stone_bricks', '模様入りの石レンガ', 'chiseled_stone_bricks');
for (const [name, label, c] of [['granite', '花崗岩', 0x9a6b56], ['diorite', '閃緑岩', 0xbcbcbc], ['andesite', '安山岩', 0x888889]]) {
  T(name, P.mottled(c, shade(c, -0.15), 60, 12));
  stoneSet(name, label, name, 'stw');
  T(`polished_${name}`, P.polished(shade(c, 0.03)));
  stoneSet(`polished_${name}`, `磨かれた${label}`, `polished_${name}`, 'st');
}
T('deepslate', (t) => { t.fill(0x505055, 10); for (let y = 1; y < 16; y += 3) for (let x = 0; x < 16; x++) if (t.rand() < 0.5) t.px(x, y, 0x404045); });
T('deepslate_top', P.mottled(0x57575c, 0x46464b, 40));
block('deepslate', { label: '深層岩', tex: { side: 'deepslate', end: 'deepslate_top' }, axis: true, hardness: 3, tool: 'pickaxe', minTier: 0, drop: 'cobbled_deepslate', tab: 'building' });
T('cobbled_deepslate', cobble(0x4a4a4f));
stoneSet('cobbled_deepslate', '深層岩の丸石', 'cobbled_deepslate', 'stw', { hardness: 3.5 });
T('polished_deepslate', P.polished(0x4a4a50));
stoneSet('polished_deepslate', '磨かれた深層岩', 'polished_deepslate', 'stw', { hardness: 3.5 });
T('deepslate_bricks', P.stoneBricks(0x46464c));
stoneSet('deepslate_bricks', '深層岩レンガ', 'deepslate_bricks', 'stw', { key: 'deepslate_brick', hardness: 3.5 });
T('cracked_deepslate_bricks', cracked(P.stoneBricks(0x46464c)));
stoneSet('cracked_deepslate_bricks', 'ひび割れた深層岩レンガ', 'cracked_deepslate_bricks', '', { hardness: 3.5 });
T('deepslate_tiles', P.tilePattern(0x3a3a40, 4));
stoneSet('deepslate_tiles', '深層岩タイル', 'deepslate_tiles', 'stw', { key: 'deepslate_tile', hardness: 3.5 });
T('cracked_deepslate_tiles', cracked(P.tilePattern(0x3a3a40, 4)));
stoneSet('cracked_deepslate_tiles', 'ひび割れた深層岩タイル', 'cracked_deepslate_tiles', '', { hardness: 3.5 });
T('chiseled_deepslate', P.chiseled(0x46464c));
stoneSet('chiseled_deepslate', '模様入りの深層岩', 'chiseled_deepslate', '', { hardness: 3.5 });
T('tuff', P.mottled(0x6c6d66, 0x5a5b55, 60));
stoneSet('tuff', '凝灰岩', 'tuff', 'stw');
T('polished_tuff', P.polished(0x6a6b64));
stoneSet('polished_tuff', '磨かれた凝灰岩', 'polished_tuff', 'stw');
T('tuff_bricks', P.stoneBricks(0x6a6b64));
stoneSet('tuff_bricks', '凝灰岩レンガ', 'tuff_bricks', 'stw', { key: 'tuff_brick' });
T('chiseled_tuff', P.chiseled(0x6a6b64));
stoneSet('chiseled_tuff', '模様入りの凝灰岩', 'chiseled_tuff');
T('calcite', P.noise(0xdfe0dc, 8));
stoneSet('calcite', '方解石', 'calcite', '', { hardness: 0.75 });
T('bricks', P.bricks(0x966152, 0xb8b0a4));
stoneSet('bricks', 'レンガ', 'bricks', 'stw', { key: 'brick', hardness: 2 });
T('packed_mud', P.noise(0x8e6b50, 10));
block('packed_mud', { label: '固めた泥', tex: 'packed_mud', hardness: 1, tool: 'pickaxe', tab: 'building' });
T('mud_bricks', P.bricks(0x8a6a4f, 0x6a4f3a));
stoneSet('mud_bricks', '泥レンガ', 'mud_bricks', 'stw', { key: 'mud_brick' });
for (const [prefix, label, c] of [['', '砂岩', 0xd8cb9b], ['red_', '赤い砂岩', 0xb5621f]]) {
  const n = `${prefix}sandstone`;
  T(`${n}_side`, (t) => { t.fill(c, 8); for (let x = 0; x < 16; x++) { t.px(x, 3, shade(c, -0.12)); t.px(x, 12, shade(c, -0.12)); } for (let x = 0; x < 16; x++) for (let y = 13; y < 16; y++) t.px(x, y, t.jit(shade(c, -0.06), 6)); });
  T(`${n}_top`, P.noise(shade(c, 0.05), 6));
  T(`${n}_bottom`, P.noise(shade(c, -0.05), 10));
  stoneSet(n, label, { side: `${n}_side`, top: `${n}_top`, bottom: `${n}_bottom` }, 'stw', { hardness: 0.8 });
  stoneSet(`smooth_${n}`, `滑らかな${label}`, `${n}_top`, 'st', { hardness: 2 });
  T(`cut_${n}`, (t) => { t.fill(c, 6); t.border(shade(c, -0.15)); for (let x = 0; x < 16; x++) t.px(x, 8, shade(c, -0.15)); });
  stoneSet(`cut_${n}`, `カットされた${label}`, { side: `cut_${n}`, end: `${n}_top` }, 's', { hardness: 0.8 });
  T(`chiseled_${n}`, P.chiseled(c));
  stoneSet(`chiseled_${n}`, `模様入りの${label}`, { side: `chiseled_${n}`, end: `${n}_top` }, '', { hardness: 0.8 });
}
T('prismarine', P.mottled(0x63a597, 0x4a8a7a, 70));
stoneSet('prismarine', 'プリズマリン', 'prismarine', 'stw');
T('prismarine_bricks', P.stoneBricks(0x63ab9e));
stoneSet('prismarine_bricks', 'プリズマリンレンガ', 'prismarine_bricks', 'st', { key: 'prismarine_brick' });
T('dark_prismarine', P.tilePattern(0x335b4b, 8));
stoneSet('dark_prismarine', 'ダークプリズマリン', 'dark_prismarine', 'st');
T('sea_lantern', (t) => { t.fill(0xacc7be, 8); t.border(0xd8ece6); t.rect(5, 5, 6, 6, 0xf0fff8); });
block('sea_lantern', { label: 'シーランタン', tex: 'sea_lantern', hardness: 0.3, light: 15, drop: 'prismarine_crystals', dropCount: [2, 3], tab: 'functional' });
T('nether_bricks', P.bricks(0x2c1519, 0x1a0c0e));
stoneSet('nether_bricks', 'ネザーレンガ', 'nether_bricks', 'stw', { key: 'nether_brick', hardness: 2 });
block('nether_brick_fence', { label: 'ネザーレンガのフェンス', tex: 'nether_bricks', shape: 'fence', connect: 'fence', hardness: 2, tool: 'pickaxe', minTier: 0 });
T('cracked_nether_bricks', cracked(P.bricks(0x2c1519, 0x1a0c0e)));
stoneSet('cracked_nether_bricks', 'ひび割れたネザーレンガ', 'cracked_nether_bricks', '', { hardness: 2 });
T('chiseled_nether_bricks', P.chiseled(0x2c1519));
stoneSet('chiseled_nether_bricks', '模様入りのネザーレンガ', 'chiseled_nether_bricks', '', { hardness: 2 });
T('red_nether_bricks', P.bricks(0x450709, 0x2a0405));
stoneSet('red_nether_bricks', '赤いネザーレンガ', 'red_nether_bricks', 'stw', { key: 'red_nether_brick', hardness: 2 });
T('blackstone', P.mottled(0x2a2328, 0x3a3238, 60));
stoneSet('blackstone', 'ブラックストーン', 'blackstone', 'stw');
T('polished_blackstone', P.polished(0x353038));
stoneSet('polished_blackstone', '磨かれたブラックストーン', 'polished_blackstone', 'stw', { hardness: 2 });
block('polished_blackstone_button', { label: '磨かれたブラックストーンのボタン', tex: 'polished_blackstone', shape: 'button', facing: 'face', hardness: 0.5, support: 'face', tool: 'pickaxe' });
block('polished_blackstone_pressure_plate', { label: '磨かれたブラックストーンの感圧板', tex: 'polished_blackstone', shape: 'plate', hardness: 0.5, support: 'below', tool: 'pickaxe', minTier: 0 });
T('polished_blackstone_bricks', P.stoneBricks(0x302a32));
stoneSet('polished_blackstone_bricks', '磨かれたブラックストーンレンガ', 'polished_blackstone_bricks', 'stw', { key: 'polished_blackstone_brick' });
T('cracked_polished_blackstone_bricks', cracked(P.stoneBricks(0x302a32)));
stoneSet('cracked_polished_blackstone_bricks', 'ひび割れた磨かれたブラックストーンレンガ', 'cracked_polished_blackstone_bricks');
T('chiseled_polished_blackstone', P.chiseled(0x353038));
stoneSet('chiseled_polished_blackstone', '模様入りの磨かれたブラックストーン', 'chiseled_polished_blackstone');
T('gilded_blackstone', (t) => { P.mottled(0x2a2328, 0x3a3238, 60)(t); t.specks(0xf0c030, 18, 20); });
stoneSet('gilded_blackstone', 'きらめくブラックストーン', 'gilded_blackstone');
T('basalt_side', (t) => { t.fill(0x4f4f55, 8); for (let x = 0; x < 16; x += 2) for (let y = 0; y < 16; y++) if (t.rand() < 0.5) t.px(x, y, 0x3f3f44); });
T('basalt_top', P.polished(0x55555b));
block('basalt', { label: '玄武岩', tex: { side: 'basalt_side', end: 'basalt_top' }, axis: true, hardness: 1.25, tool: 'pickaxe', minTier: 0 });
T('polished_basalt_side', P.pillarSide(0x58585e));
block('polished_basalt', { label: '磨かれた玄武岩', tex: { side: 'polished_basalt_side', end: 'basalt_top' }, axis: true, hardness: 1.25, tool: 'pickaxe', minTier: 0 });
T('smooth_basalt', P.noise(0x48484e, 6));
stoneSet('smooth_basalt', '滑らかな玄武岩', 'smooth_basalt', '', { hardness: 1.25 });
T('end_stone', P.mottled(0xdbdea3, 0xc8cb90, 60));
stoneSet('end_stone', 'エンドストーン', 'end_stone', '', { hardness: 3, tab: 'natural' });
T('end_stone_bricks', P.stoneBricks(0xdadfa3));
stoneSet('end_stone_bricks', 'エンドストーンレンガ', 'end_stone_bricks', 'stw', { key: 'end_stone_brick', hardness: 3 });
T('purpur_block', P.tilePattern(0xa97aa9, 8));
stoneSet('purpur_block', 'プルパーブロック', 'purpur_block', 'st', { key: 'purpur', slabLabel: 'プルパー' });
T('purpur_pillar_side', P.pillarSide(0xab7cab));
T('purpur_pillar_top', P.polished(0xab7cab));
block('purpur_pillar', { label: 'プルパーの柱', tex: { side: 'purpur_pillar_side', end: 'purpur_pillar_top' }, axis: true, hardness: 1.5, tool: 'pickaxe', minTier: 0 });
T('quartz_block', P.noise(0xebe5de, 4));
T('quartz_side', (t) => { t.fill(0xebe5de, 4); t.border(0xd8d0c6); });
stoneSet('quartz_block', 'クォーツブロック', { side: 'quartz_side', end: 'quartz_block' }, 'st', { key: 'quartz', slabLabel: 'クォーツ', hardness: 0.8 });
stoneSet('smooth_quartz', '滑らかなクォーツブロック', 'quartz_block', 'st', { slabLabel: '滑らかなクォーツ', hardness: 2 });
T('quartz_bricks', P.stoneBricks(0xebe5de));
stoneSet('quartz_bricks', 'クォーツレンガ', 'quartz_bricks', '', { hardness: 0.8 });
T('quartz_pillar_side', P.pillarSide(0xebe5de));
block('quartz_pillar', { label: 'クォーツの柱', tex: { side: 'quartz_pillar_side', end: 'quartz_block' }, axis: true, hardness: 0.8, tool: 'pickaxe', minTier: 0 });
T('chiseled_quartz', P.chiseled(0xebe5de));
stoneSet('chiseled_quartz_block', '模様入りのクォーツブロック', { side: 'chiseled_quartz', end: 'quartz_block' }, '', { hardness: 0.8 });
T('copper_block', P.noise(0xc06c50, 8));
stoneSet('copper_block', '銅ブロック', 'copper_block', '', { hardness: 3, block: { minTier: 1 } });
T('cut_copper', P.tilePattern(0xbf6b51, 8));
stoneSet('cut_copper', '切り込み入りの銅', 'cut_copper', 'st', { hardness: 3 });
T('chiseled_copper', P.chiseled(0xc06c50));
stoneSet('chiseled_copper', '模様入りの銅', 'chiseled_copper', '', { hardness: 3 });
T('amethyst_block', P.mottled(0x8561c2, 0xa27ee0, 60));
stoneSet('amethyst_block', 'アメジストブロック', 'amethyst_block', '', { hardness: 1.5, tab: 'natural' });

// ---- 鉱石と鉱物ブロック ----
const STONE_BASE = 0x8a8a8a, DEEP_BASE = 0x505055;
const ORES = [
  ['coal', '石炭', 0x2a2a2a, 0, 'coal', null],
  ['iron', '鉄', 0xd8af93, 1, 'raw_iron', null],
  ['copper', '銅', 0xe07a4a, 1, 'raw_copper', [2, 5]],
  ['gold', '金', 0xfcee4b, 2, 'raw_gold', null],
  ['redstone', 'レッドストーン', 0xff1a1a, 2, 'redstone', [4, 5]],
  ['emerald', 'エメラルド', 0x17dd62, 2, 'emerald', null],
  ['lapis', 'ラピスラズリ', 0x1d47a0, 1, 'lapis_lazuli', [4, 9]],
  ['diamond', 'ダイヤモンド', 0x5decf5, 2, 'diamond', null],
];
for (const [key, label, color, tier, drop, count] of ORES) {
  T(`${key}_ore`, P.ore(STONE_BASE, color));
  T(`deepslate_${key}_ore`, P.ore(DEEP_BASE, color));
  block(`${key}_ore`, { label: `${label}鉱石`, tex: `${key}_ore`, hardness: 3, tool: 'pickaxe', minTier: tier, drop, dropCount: count, tab: 'natural' });
  block(`deepslate_${key}_ore`, { label: `深層岩の${label}鉱石`, tex: `deepslate_${key}_ore`, hardness: 4.5, tool: 'pickaxe', minTier: tier, drop, dropCount: count, tab: 'natural' });
}
T('nether_gold_ore', P.ore(0x6f3535, 0xfcee4b, 12, 7));
block('nether_gold_ore', { label: 'ネザー金鉱石', tex: 'nether_gold_ore', hardness: 3, tool: 'pickaxe', minTier: 0, drop: 'gold_nugget', dropCount: [2, 6], tab: 'natural' });
T('nether_quartz_ore', P.ore(0x6f3535, 0xf0ece4, 12, 7));
block('nether_quartz_ore', { label: 'ネザークォーツ鉱石', tex: 'nether_quartz_ore', hardness: 3, tool: 'pickaxe', minTier: 0, drop: 'quartz', tab: 'natural' });
T('ancient_debris_side', (t) => { t.fill(0x5e4238, 10); for (let y = 2; y < 16; y += 4) for (let x = 0; x < 16; x++) if (t.rand() < 0.7) t.px(x, y, 0x3a2a24); t.specks(0x8a6a5a, 12); });
T('ancient_debris_top', (t) => { t.fill(0x5e4238, 10); t.border(0x3a2a24); t.border(0x7a5a4a, 0, 3); });
block('ancient_debris', { label: '古代の残骸', tex: { side: 'ancient_debris_side', end: 'ancient_debris_top' }, hardness: 30, tool: 'pickaxe', minTier: 3, tab: 'natural' });

const MINERAL_BLOCKS = [
  ['coal_block', '石炭ブロック', 0x161616, 0], ['iron_block', '鉄ブロック', 0xdcdcdc, 1], ['gold_block', '金ブロック', 0xf8d33d, 2],
  ['redstone_block', 'レッドストーンブロック', 0xaa1100, 0], ['emerald_block', 'エメラルドブロック', 0x2ad470, 2], ['lapis_block', 'ラピスラズリブロック', 0x1f4494, 1],
  ['diamond_block', 'ダイヤモンドブロック', 0x62ede4, 2], ['netherite_block', 'ネザライトブロック', 0x423d3f, 3],
  ['raw_iron_block', '鉄の原石ブロック', 0xa68a6d, 1], ['raw_copper_block', '銅の原石ブロック', 0x9a6a4e, 1], ['raw_gold_block', '金の原石ブロック', 0xdda92e, 2],
];
for (const [name, label, c, tier] of MINERAL_BLOCKS) {
  T(name, name.startsWith('raw_') ? P.mottled(c, shade(c, -0.2), 70) : (t) => { t.fill(c, 6); t.border(shade(c, -0.2)); t.border(shade(c, 0.2), 0, 1); t.rect(2, 2, 12, 12, c, 6); });
  block(name, { label, tex: name, hardness: 5, tool: 'pickaxe', minTier: tier, tab: 'building' });
}

// ---- 色付きブロック ----
export const COLORS = [
  ['white', '白色', 0xe9ecec], ['orange', '橙色', 0xf07613], ['magenta', '赤紫色', 0xbd44b3], ['light_blue', '空色', 0x3aafd9],
  ['yellow', '黄色', 0xf8c527], ['lime', '黄緑色', 0x70b919], ['pink', '桃色', 0xed8dac], ['gray', '灰色', 0x3e4447],
  ['light_gray', '薄灰色', 0x8e8e86], ['cyan', '青緑色', 0x158991], ['purple', '紫色', 0x792aac], ['blue', '青色', 0x35399d],
  ['brown', '茶色', 0x724728], ['green', '緑色', 0x546d1b], ['red', '赤色', 0xa12722], ['black', '黒色', 0x141519],
];
T('terracotta', P.terracotta(0x985e43));
block('terracotta', { label: 'テラコッタ', tex: 'terracotta', hardness: 1.25, tool: 'pickaxe', minTier: 0, tab: 'colored' });
T('glass', P.glass());
block('glass', { label: 'ガラス', tex: 'glass', layer: 'cutout', opaque: false, hardness: 0.3, drop: null, tab: 'colored' });
block('glass_pane', { label: '板ガラス', tex: 'glass', shape: 'pane', connect: 'pane', hardness: 0.3, drop: null, tab: 'colored' });
for (const [key, label, c] of COLORS) {
  T(`${key}_wool`, P.wool(c));
  block(`${key}_wool`, { label: `${label}の羊毛`, tex: `${key}_wool`, hardness: 0.8, tool: 'shears', color: key, tab: 'colored' });
  block(`${key}_carpet`, { label: `${label}のカーペット`, tex: `${key}_wool`, shape: 'carpet', hardness: 0.1, support: 'below', color: key, tab: 'colored' });
  T(`${key}_concrete`, P.concrete(shade(c, -0.08)));
  block(`${key}_concrete`, { label: `${label}のコンクリート`, tex: `${key}_concrete`, hardness: 1.8, tool: 'pickaxe', minTier: 0, color: key, tab: 'colored' });
  T(`${key}_concrete_powder`, P.powder(c));
  block(`${key}_concrete_powder`, { label: `${label}のコンクリートパウダー`, tex: `${key}_concrete_powder`, hardness: 0.5, tool: 'shovel', powderTo: `${key}_concrete`, color: key, tab: 'colored' });
  T(`${key}_terracotta`, P.terracotta(mix(c, 0x8a5a44, 0.45)));
  block(`${key}_terracotta`, { label: `${label}のテラコッタ`, tex: `${key}_terracotta`, hardness: 1.25, tool: 'pickaxe', minTier: 0, color: key, tab: 'colored' });
  T(`${key}_glazed_terracotta`, P.glazed(c));
  block(`${key}_glazed_terracotta`, { label: `${label}の彩釉テラコッタ`, tex: `${key}_glazed_terracotta`, hardness: 1.4, tool: 'pickaxe', minTier: 0, color: key, tab: 'colored' });
  T(`${key}_stained_glass`, P.glass(0, c, 120));
  block(`${key}_stained_glass`, { label: `${label}の色付きガラス`, tex: `${key}_stained_glass`, layer: 'translucent', opaque: false, hardness: 0.3, drop: null, color: key, tab: 'colored' });
  block(`${key}_stained_glass_pane`, { label: `${label}の色付きガラス板`, tex: `${key}_stained_glass`, shape: 'pane', layer: 'translucent', connect: 'pane', hardness: 0.3, drop: null, color: key, tab: 'colored' });
  T(`${key}_bed_foot`, (t) => { t.fill(c, 6); t.rect(0, 0, 16, 2, shade(c, 0.15)); });
  T(`${key}_bed_head`, (t) => { t.fill(c, 6); t.rect(2, 3, 12, 7, 0xf0f0f0, 4); t.rect(2, 3, 12, 1, 0xd8d8d8); });
  T(`${key}_bed_side`, (t) => { t.clear(); t.rect(0, 7, 16, 4, c, 6); t.rect(0, 11, 16, 2, 0xb8905a, 6); t.rect(0, 13, 3, 3, 0x6b4a26); t.rect(13, 13, 3, 3, 0x6b4a26); });
  block(`${key}_bed`, { label: `${label}のベッド`, tex: { top: `${key}_bed_foot`, head: `${key}_bed_head`, side: `${key}_bed_side`, bottom: 'oak_planks' }, shape: 'bed', layer: 'cutout', bed: true, facing: 'look', hardness: 0.2, support: 'below', fallMult: 0.5, color: key, tab: 'colored' });
}

// ---- 機能ブロック ----
T('crafting_table_top', (t) => {
  t.fill(0xb8905a, 10);
  t.border(0x6b4a26);
  for (let i = 2; i < 14; i++) { t.px(i, 5, 0x6b4a26); t.px(i, 10, 0x6b4a26); t.px(5, i, 0x6b4a26); t.px(10, i, 0x6b4a26); }
});
T('crafting_table_side', (t) => { t.fill(0xb8905a, 10); for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) t.px(x, y, 0x8a6a3a); for (let x = 2; x < 14; x += 6) for (let y = 6; y < 14; y++) t.px(x, y, 0x6b4a26); });
T('crafting_table_front', (t) => { t.fill(0xb8905a, 10); for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) t.px(x, y, 0x8a6a3a); t.rect(3, 6, 5, 3, 0x9c9c9c); t.rect(9, 6, 4, 6, 0x6b4a26); });
block('crafting_table', { label: '作業台', tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' }, facing: 'toward', hardness: 2.5, tool: 'axe', station: 'crafting_table', tab: 'functional' });
const furnaceSide = (c) => (t) => { t.fill(c, 18); for (let i = 0; i < 16; i++) { t.px(i, 0, shade(c, -0.3)); t.px(0, i, shade(c, -0.3)); } };
const furnaceFront = (c, fire) => (t) => { furnaceSide(c)(t); t.rect(4, 8, 8, 6, 0x1c1c1c); for (let x = 5; x < 11; x++) t.px(x, 13, fire); for (let x = 6; x < 10; x++) t.px(x, 12, 0xffb830); t.rect(3, 3, 10, 2, shade(c, -0.25)); };
T('furnace_top', P.noise(0x6e6e6e, 12));
T('furnace_side', furnaceSide(0x7b7b7b));
T('furnace_front', furnaceFront(0x7b7b7b, 0xff8a1a));
block('furnace', { label: 'かまど', tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, facing: 'toward', hardness: 3.5, tool: 'pickaxe', minTier: 0, station: 'furnace', tab: 'functional' });
T('smoker_side', (t) => { P.planks(0x6b4a26)(t); t.rect(0, 11, 16, 5, 0x5a5a5a, 12); });
T('smoker_front', (t) => { P.planks(0x6b4a26)(t); t.rect(3, 6, 10, 7, 0x1c1c1c); t.rect(4, 11, 8, 2, 0xff8a1a); });
T('smoker_top', P.noise(0x5a5a5a, 10));
block('smoker', { label: '燻製器', tex: { top: 'smoker_top', side: 'smoker_side', front: 'smoker_front' }, facing: 'toward', hardness: 3.5, tool: 'pickaxe', minTier: 0, station: 'furnace', tab: 'functional' });
T('blast_furnace_side', (t) => { t.fill(0x6a6a6e, 10); t.border(0x4a4a4e); t.rect(3, 3, 10, 10, 0x8a8a90, 8); });
T('blast_furnace_front', (t) => { t.fill(0x6a6a6e, 10); t.border(0x4a4a4e); t.rect(4, 7, 8, 6, 0x1c1c1c); for (let x = 5; x < 11; x += 2) t.px(x, 11, 0xff8a1a); });
block('blast_furnace', { label: '溶鉱炉', tex: { top: 'blast_furnace_side', side: 'blast_furnace_side', front: 'blast_furnace_front' }, facing: 'toward', hardness: 3.5, tool: 'pickaxe', minTier: 0, station: 'furnace', tab: 'functional' });
T('chest_side', (t) => { t.fill(0xa26d2e, 8); t.border(0x4a2e12); for (let x = 1; x < 15; x++) t.px(x, 5, 0x4a2e12); });
T('chest_front', (t) => { t.fill(0xa26d2e, 8); t.border(0x4a2e12); for (let x = 1; x < 15; x++) t.px(x, 5, 0x4a2e12); t.rect(7, 4, 2, 4, 0xc8c8c8); t.px(7, 6, 0x5a5a5a); });
T('chest_top', (t) => { t.fill(0xa26d2e, 8); t.border(0x4a2e12); });
block('chest', { label: 'チェスト', tex: { top: 'chest_top', side: 'chest_side', front: 'chest_front' }, shape: 'chest', facing: 'toward', hardness: 2.5, tool: 'axe', container: 27, tab: 'functional' });
T('barrel_side', (t) => { P.planks(0x7a5a35)(t); for (let x = 0; x < 16; x++) { t.px(x, 2, 0x3a3a3a); t.px(x, 13, 0x3a3a3a); } });
T('barrel_top', (t) => { P.planks(0x8a6a3f)(t); t.border(0x5a4024); t.rect(5, 5, 6, 6, 0x3a2a18); });
block('barrel', { label: '樽', tex: { side: 'barrel_side', end: 'barrel_top' }, hardness: 2.5, tool: 'axe', container: 27, tab: 'functional' });
T('bookshelf', (t) => {
  P.planks(0xb8905a)(t);
  const books = [0x8a2a2a, 0x2a4a8a, 0x2a7a3a, 0x8a6a2a, 0x6a2a7a, 0x2a6a6a];
  for (const y0 of [1, 9]) for (let x = 1; x < 15; x++) { const c = books[(x + y0) % books.length]; for (let y = y0; y < y0 + 6; y++) t.px(x, y, t.jit(c, 10)); }
});
block('bookshelf', { label: '本棚', tex: { side: 'bookshelf', end: 'oak_planks' }, hardness: 1.5, tool: 'axe', drop: 'book', dropCount: [3, 3], tab: 'functional' });
T('ladder', P.ladder(0x9a7446));
block('ladder', { label: 'はしご', tex: 'ladder', shape: 'ladder', facing: 'wall', hardness: 0.4, tool: 'axe', climbable: true, support: 'wall', tab: 'functional' });
T('torch', (t) => {
  t.clear();
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 2; y++) t.px(x, y, y === 0 ? 0xfff2a0 : 0xffb830);
    t.px(x, 2, 0x2b2b2b);
    for (let y = 3; y < 10; y++) t.px(x, y, (x + y) % 3 === 0 ? 0x5a3a1a : 0x7a5228);
  }
});
block('torch', { label: '松明', tex: 'torch', shape: 'torch', hardness: 0, light: 14, support: 'below', tab: 'functional' });
T('lantern', (t) => { t.clear(); t.rect(5, 6, 6, 8, 0x3a3a44); t.rect(6, 7, 4, 6, 0xffc85a); t.rect(6, 5, 4, 1, 0x3a3a44); t.rect(7, 3, 2, 2, 0x2a2a30); });
block('lantern', { label: 'ランタン', tex: 'lantern', shape: 'lantern', hardness: 3.5, tool: 'pickaxe', minTier: 0, light: 15, support: 'below', tab: 'functional' });
T('iron_bars', (t) => { t.clear(); for (const x of [1, 5, 9, 13]) for (let y = 0; y < 16; y++) { t.px(x, y, 0x8a8a8a); t.px(x + 1, y, 0x6a6a6a); } for (const y of [2, 13]) for (let x = 0; x < 16; x++) t.px(x, y, 0x7a7a7a); });
block('iron_bars', { label: '鉄格子', tex: 'iron_bars', shape: 'pane', connect: 'pane', hardness: 5, tool: 'pickaxe', minTier: 0, tab: 'functional' });
T('tnt_side', (t) => { t.fill(0xd8382a, 8); for (let x = 0; x < 16; x += 4) for (let y = 0; y < 16; y++) t.px(x, y, 0xa8281e); t.rect(0, 5, 16, 6, 0xf0f0f0); for (const x of [3, 6, 9, 12]) t.rect(x, 7, 2, 2, 0x2a2a2a); });
T('tnt_top', (t) => { t.fill(0xd8382a, 8); t.rect(6, 6, 4, 4, 0x2a2a2a); });
T('tnt_bottom', P.noise(0xa8281e, 8));
block('tnt', { label: 'TNT', tex: { side: 'tnt_side', top: 'tnt_top', bottom: 'tnt_bottom' }, hardness: 0, tnt: true, tab: 'functional' });
T('jukebox_side', (t) => { P.planks(0x6b4a26)(t); t.border(0x3a2a14); });
T('jukebox_top', (t) => { P.planks(0x6b4a26)(t); t.border(0x3a2a14); t.rect(4, 7, 8, 2, 0x1a1a1a); });
block('jukebox', { label: 'ジュークボックス', tex: { side: 'jukebox_side', end: 'jukebox_top' }, hardness: 2, tool: 'axe', tab: 'functional' });
T('note_block', (t) => { P.planks(0x6b4a26)(t); t.rect(5, 4, 2, 7, 0x1a1a1a); t.rect(3, 9, 4, 3, 0x1a1a1a); t.rect(7, 4, 4, 2, 0x1a1a1a); });
block('note_block', { label: '音符ブロック', tex: 'note_block', hardness: 0.8, tool: 'axe', tab: 'functional' });
T('enchanting_table_top', (t) => { t.fill(0x2a1a2a, 8); t.rect(3, 3, 10, 10, 0x8a1a1a); t.rect(4, 4, 8, 8, 0xe8e0d0); t.px(8, 4, 0x2a2a2a); });
T('enchanting_table_side', (t) => { t.clear(); t.rect(0, 4, 16, 12, 0x2a1a2a, 8); t.rect(0, 4, 16, 2, 0x8a1a1a); t.specks(0x5affff, 6); });
block('enchanting_table', { label: 'エンチャントテーブル', tex: { top: 'enchanting_table_top', side: 'enchanting_table_side', bottom: 'obsidian' }, shape: 'table', layer: 'cutout', hardness: 5, tool: 'pickaxe', minTier: 0, light: 7, tab: 'functional' });
T('smithing_table_top', (t) => { t.fill(0x3a3a44, 8); t.border(0x2a2a30); t.rect(3, 3, 10, 10, 0x4a4a54); });
T('smithing_table_side', (t) => { P.planks(0x5a3a22)(t); t.rect(0, 0, 16, 4, 0x3a3a44); });
block('smithing_table', { label: '鍛冶台', tex: { top: 'smithing_table_top', side: 'smithing_table_side', bottom: 'oak_planks' }, hardness: 2.5, tool: 'axe', station: 'smithing_table', tab: 'functional' });
T('cartography_table_top', (t) => { t.fill(0xd8c8a0, 8); t.border(0x5a3a22); for (let i = 0; i < 12; i++) t.px(2 + t.r(12), 2 + t.r(12), 0x6a8a3a); });
T('cartography_table_side', (t) => { P.planks(0x5a3a22)(t); t.rect(0, 0, 16, 3, 0xd8c8a0); });
block('cartography_table', { label: '製図台', tex: { top: 'cartography_table_top', side: 'cartography_table_side', bottom: 'dark_oak_planks' }, hardness: 2.5, tool: 'axe', tab: 'functional' });
T('fletching_table_top', (t) => { P.planks(0xd7c386)(t); t.rect(4, 4, 8, 8, 0xc8b070); t.px(7, 5, 0xf0f0f0); t.px(8, 6, 0xf0f0f0); });
T('fletching_table_side', (t) => { P.planks(0xd7c386)(t); t.rect(6, 4, 4, 8, 0xa04a2a); });
block('fletching_table', { label: '矢細工台', tex: { top: 'fletching_table_top', side: 'fletching_table_side', bottom: 'birch_planks' }, hardness: 2.5, tool: 'axe', tab: 'functional' });
T('loom_top', (t) => { P.planks(0xb8905a)(t); for (let x = 2; x < 14; x += 2) for (let y = 3; y < 13; y++) t.px(x, y, 0xe0e0e0); });
T('loom_side', (t) => { P.planks(0xb8905a)(t); t.rect(2, 2, 12, 12, 0x8a6a3a); });
block('loom', { label: '機織り機', tex: { top: 'loom_top', side: 'loom_side' }, hardness: 2.5, tool: 'axe', tab: 'functional' });
T('redstone_lamp', (t) => { t.fill(0x6a3a22, 10); t.border(0x3a2a1a); t.rect(3, 3, 10, 10, 0x8a5a3a, 10); });
block('redstone_lamp', { label: 'レッドストーンランプ', tex: 'redstone_lamp', hardness: 0.3, tab: 'functional' });

// 既存コードとの互換用
export const BLOCK = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, PLANKS: 7, COBBLE: 8, GLASS: 9, WATER: 10,
  BRICK: 11, BEDROCK: 12, SNOW: 13, GRAVEL: 14, TORCH: 15, CRAFTING_TABLE: 16, FURNACE: 17, COAL_ORE: 18, IRON_ORE: 19, WOOL: 20,
};

for (let i = 0; i < LEGACY.length; i++) {
  if (!BLOCKS[i]) throw new Error(`legacy block not defined: ${LEGACY[i]}`);
}
