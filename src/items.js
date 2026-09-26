import { BLOCK, BLOCKS, drawTileTo, TILE_PX } from './blocks.js';

// ---- ドット絵 (16x16 の文字列。'.' は透明) ----
const ART = {
  pickaxe: [
    '.........MMMm...', '.......MMmmmmm..', '......Mm....mmm.', '.....Mm......dm.',
    '....Mm........dm', '...Mm.hh.......d', '...m.hh.........', '....hh..........',
    '...hh...........', '..hh............', '.hh.............', 'hh..............',
    '................', '................', '................', '................',
  ],
  axe: [
    '.........mmM....', '........mmmMM...', '.......mmmmmM...', '.......mmmmmm...',
    '......hhmmmd....', '.....hh.ddd.....', '....hh..........', '...hh...........',
    '..hh............', '.hh.............', 'hh..............', '................',
    '................', '................', '................', '................',
  ],
  shovel: [
    '..........mMM...', '.........mmmMM..', '.........mmmmM..', '.........dmmm...',
    '.......hh.dd....', '......hh........', '.....hh.........', '....hh..........',
    '...hh...........', '..hh............', '.hh.............', 'hh..............',
    '................', '................', '................', '................',
  ],
  sword: [
    '...............M', '..............MM', '.............Mmd', '............Mmd.',
    '...........Mmd..', '..........Mmd...', '.........Mmd....', '........Mmd.....',
    '.......Mmd......', '..g...Mmd.......', '...g.Mmd........', '....gmd.........',
    '...hgg.g........', '..h...g.........', '.h..............', 'h...............',
  ],
  stick: [
    '................', '..............hh', '.............hh.', '............hh..',
    '...........hh...', '..........hh....', '.........hh.....', '........hh......',
    '.......hh.......', '......hh........', '.....hh.........', '....hh..........',
    '...hh...........', '..hh............', '.hh.............', '................',
  ],
  lump: [
    '................', '................', '.....cccc.......', '....ccCCcc......',
    '...ccCCCccc.....', '...cCCCcccc.....', '..ccCCccccdd....', '..ccccccccdd....',
    '..cccccccddd....', '...ccccccdd.....', '....ccdddd......', '.....dddd.......',
    '................', '................', '................', '................',
  ],
  ingot: [
    '................', '................', '................', '......MMMMMMMM..',
    '.....MMmmmmmmmd.', '....MMmmmmmmmdd.', '...MMmmmmmmmdd..', '...mmmmmmmmddd..',
    '...ddddddddd....', '................', '................', '................',
    '................', '................', '................', '................',
  ],
  meat: [
    '................', '................', '.......mmmm.....', '.....mmMMmmm....',
    '....mmMMMmmmm...', '....mmMMmmmmmd..', '...mmmmmmmmmdd..', '...mmmmmmmmdd...',
    '..bbmmmmmmdd....', '.bbbbmmmddd.....', '.bbb.bbdd.......', '..b..bb.........',
    '................', '................', '................', '................',
  ],
  drumstick: [
    '................', '..........mmm...', '.........mMMmm..', '........mmMMmmm.',
    '.......mmmmmmmm.', '......mmmmmmmmd.', '.....mmmmmmmdd..', '....bbmmmmddd...',
    '...bbbb.dd......', '..bbbb..........', '.bbb............', '.bb.............',
    '................', '................', '................', '................',
  ],
  apple: [
    '.......s........', '......s.........', '....rrrrrrr.....', '...rrRrrrrrr....',
    '..rrRRrrrrrrr...', '..rrRrrrrrrrr...', '..rrrrrrrrrrr...', '..rrrrrrrrrrd...',
    '...rrrrrrrrdd...', '....rrrrrddd....', '.....rrrdd......', '................',
    '................', '................', '................', '................',
  ],
  feather: [
    '..........fff...', '.........ffFFf..', '........ffFFff..', '.......ffFFff...',
    '......ffFFff....', '.....ffFFff.....', '....ffFFff......', '...hhFFff.......',
    '..hhff..........', '.hh.............', 'hh..............', '................',
    '................', '................', '................', '................',
  ],
};

const HANDLE = { h: 0x5a3a1a, H: 0x3f2810, g: 0x8a6a2a };
const PAL = {
  wood: { ...HANDLE, m: 0xb8905a, M: 0xd6b07a, d: 0x8a6a3a },
  stone: { ...HANDLE, m: 0x8a8a8a, M: 0xb5b5b5, d: 0x5e5e5e },
  iron: { ...HANDLE, m: 0xd8d8d8, M: 0xffffff, d: 0x9a9a9a },
  stick: { h: 0x6b4a26 },
  coal: { c: 0x2a2a2a, C: 0x4a4a4a, d: 0x111111 },
  raw_iron: { c: 0xd8b090, C: 0xf0d0b0, d: 0xa87a58 },
  porkchop: { m: 0xf0a0a0, M: 0xffc0c0, d: 0xc07070, b: 0xf5f0e0 },
  cooked_porkchop: { m: 0xb06a3a, M: 0xd08a5a, d: 0x7a4a2a, b: 0xf5f0e0 },
  beef: { m: 0xb03030, M: 0xd05050, d: 0x802020, b: 0xf5f0e0 },
  steak: { m: 0x7a4a2a, M: 0x9a6a4a, d: 0x4a2a1a, b: 0xf5f0e0 },
  mutton: { m: 0xc04040, M: 0xe06060, d: 0x903030, b: 0xf5f0e0 },
  cooked_mutton: { m: 0x8a5a3a, M: 0xaa7a5a, d: 0x5a3a2a, b: 0xf5f0e0 },
  chicken: { m: 0xf0c0b0, M: 0xffe0d0, d: 0xc09080, b: 0xf5f0e0 },
  cooked_chicken: { m: 0xc08040, M: 0xe0a060, d: 0x905020, b: 0xf5f0e0 },
  apple: { r: 0xd82020, R: 0xff6060, d: 0xa01010, s: 0x5a3a1a },
  feather: { f: 0xf0f0f0, F: 0xffffff, h: 0xc0c0c0 },
};

const TIERS = [
  { key: 'wooden', name: '木', speed: 2, tier: 0, bonus: 0 },
  { key: 'stone', name: '石', speed: 4, tier: 1, bonus: 1 },
  { key: 'iron', name: '鉄', speed: 6, tier: 2, bonus: 2 },
];
const TOOL_KINDS = [
  { key: 'pickaxe', name: 'ツルハシ', damage: 2 },
  { key: 'axe', name: '斧', damage: 3 },
  { key: 'shovel', name: 'シャベル', damage: 1.5 },
  { key: 'sword', name: '剣', damage: 4 },
];

// ---- アイテム登録 ----
export const ITEMS = {};

// ブロックアイテム
for (const [id, def] of Object.entries(BLOCKS)) {
  if (!def.item) continue;
  ITEMS[def.item] = { name: def.name, block: Number(id), maxStack: 64 };
}

const define = (id, def) => { ITEMS[id] = { maxStack: 64, ...def }; };

define('stick', { name: '棒', art: 'stick', palette: 'stick' });
define('coal', { name: '石炭', art: 'lump', palette: 'coal' });
define('raw_iron', { name: '鉄の原石', art: 'lump', palette: 'raw_iron' });
define('iron_ingot', { name: '鉄インゴット', art: 'ingot', palette: 'iron' });

for (const tier of TIERS) {
  for (const kind of TOOL_KINDS) {
    const palette = PAL[tier.key === 'wooden' ? 'wood' : tier.key];
    define(`${tier.key}_${kind.key}`, {
      name: `${tier.name}の${kind.name}`, art: kind.key, palette: null, colors: palette,
      tool: kind.key, tier: tier.tier, speed: tier.speed, damage: kind.damage + tier.bonus, maxStack: 1,
    });
  }
}

define('porkchop', { name: '生の豚肉', art: 'meat', palette: 'porkchop', food: 3 });
define('cooked_porkchop', { name: '焼き豚', art: 'meat', palette: 'cooked_porkchop', food: 8 });
define('beef', { name: '生の牛肉', art: 'meat', palette: 'beef', food: 3 });
define('steak', { name: 'ステーキ', art: 'meat', palette: 'steak', food: 8 });
define('mutton', { name: '生の羊肉', art: 'meat', palette: 'mutton', food: 2 });
define('cooked_mutton', { name: '焼いた羊肉', art: 'meat', palette: 'cooked_mutton', food: 6 });
define('chicken', { name: '生の鶏肉', art: 'drumstick', palette: 'chicken', food: 2 });
define('cooked_chicken', { name: '焼き鳥', art: 'drumstick', palette: 'cooked_chicken', food: 6 });
define('apple', { name: 'リンゴ', art: 'apple', palette: 'apple', food: 4 });
define('feather', { name: '羽根', art: 'feather', palette: 'feather' });

export function itemName(id) {
  return ITEMS[id]?.name ?? id;
}

export function maxStack(id) {
  return ITEMS[id]?.maxStack ?? 64;
}

// ドット絵の各ピクセル色を返す (null は透明)
export function itemPixel(id, x, y) {
  const def = ITEMS[id];
  const shape = ART[def.art];
  if (!shape) return null;
  const ch = shape[y][x];
  if (ch === '.') return null;
  const colors = def.colors ?? PAL[def.palette];
  return colors[ch] ?? 0xff00ff;
}

// クリエイティブのカタログ順
export const CREATIVE_ITEMS = [
  'grass_block', 'dirt', 'stone', 'cobblestone', 'sand', 'gravel', 'log', 'planks', 'leaves', 'glass',
  'bricks', 'snow', 'wool', 'torch', 'crafting_table', 'furnace', 'coal_ore', 'iron_ore', 'bedrock',
  'wooden_sword', 'wooden_pickaxe', 'wooden_axe', 'wooden_shovel',
  'stone_sword', 'stone_pickaxe', 'stone_axe', 'stone_shovel',
  'iron_sword', 'iron_pickaxe', 'iron_axe', 'iron_shovel',
  'stick', 'coal', 'raw_iron', 'iron_ingot', 'apple', 'porkchop', 'cooked_porkchop', 'beef', 'steak',
  'chicken', 'cooked_chicken', 'mutton', 'cooked_mutton', 'feather',
];

// サバイバル開始時の持ち物 (なし)
export const STARTER_ITEMS = [];

// ---- レシピ ----
//  station: 'crafting_table' は近くに作業台、'furnace' は近くにかまどが必要
export const RECIPES = [
  { out: 'planks', count: 4, in: { log: 1 } },
  { out: 'stick', count: 4, in: { planks: 2 } },
  { out: 'crafting_table', count: 1, in: { planks: 4 } },
  { out: 'torch', count: 4, in: { coal: 1, stick: 1 } },
  { out: 'wooden_pickaxe', count: 1, in: { planks: 3, stick: 2 }, station: 'crafting_table' },
  { out: 'wooden_axe', count: 1, in: { planks: 3, stick: 2 }, station: 'crafting_table' },
  { out: 'wooden_shovel', count: 1, in: { planks: 1, stick: 2 }, station: 'crafting_table' },
  { out: 'wooden_sword', count: 1, in: { planks: 2, stick: 1 }, station: 'crafting_table' },
  { out: 'stone_pickaxe', count: 1, in: { cobblestone: 3, stick: 2 }, station: 'crafting_table' },
  { out: 'stone_axe', count: 1, in: { cobblestone: 3, stick: 2 }, station: 'crafting_table' },
  { out: 'stone_shovel', count: 1, in: { cobblestone: 1, stick: 2 }, station: 'crafting_table' },
  { out: 'stone_sword', count: 1, in: { cobblestone: 2, stick: 1 }, station: 'crafting_table' },
  { out: 'furnace', count: 1, in: { cobblestone: 8 }, station: 'crafting_table' },
  { out: 'iron_pickaxe', count: 1, in: { iron_ingot: 3, stick: 2 }, station: 'crafting_table' },
  { out: 'iron_axe', count: 1, in: { iron_ingot: 3, stick: 2 }, station: 'crafting_table' },
  { out: 'iron_shovel', count: 1, in: { iron_ingot: 1, stick: 2 }, station: 'crafting_table' },
  { out: 'iron_sword', count: 1, in: { iron_ingot: 2, stick: 1 }, station: 'crafting_table' },
  { out: 'iron_ingot', count: 1, in: { raw_iron: 1, coal: 1 }, station: 'furnace' },
  { out: 'stone', count: 1, in: { cobblestone: 1, coal: 1 }, station: 'furnace' },
  { out: 'glass', count: 4, in: { sand: 4, coal: 1 }, station: 'furnace' },
  { out: 'cooked_porkchop', count: 1, in: { porkchop: 1, coal: 1 }, station: 'furnace' },
  { out: 'steak', count: 1, in: { beef: 1, coal: 1 }, station: 'furnace' },
  { out: 'cooked_chicken', count: 1, in: { chicken: 1, coal: 1 }, station: 'furnace' },
  { out: 'cooked_mutton', count: 1, in: { mutton: 1, coal: 1 }, station: 'furnace' },
];

export const STATION_NAMES = { crafting_table: '作業台', furnace: 'かまど' };

// ---- アイコン描画 ----
export function drawItemIcon(canvas, id) {
  const def = ITEMS[id];
  if (!def) return;
  if (def.block !== undefined) {
    const tiles = BLOCKS[def.block].tiles;
    drawTileTo(canvas, def.block === BLOCK.GRASS ? tiles[2] : tiles[3] ?? tiles[2]);
    if (def.block === BLOCK.TORCH) {
      // たいまつは細い柱として描く
      const ctx = canvas.getContext('2d');
      const img = ctx.getImageData(0, 0, TILE_PX, TILE_PX);
      ctx.clearRect(0, 0, TILE_PX, TILE_PX);
      const out = ctx.createImageData(TILE_PX, TILE_PX);
      for (let y = 0; y < 16; y++) for (let x = 7; x < 9; x++) {
        const s = (y * 16 + x) * 4;
        out.data.set(img.data.slice(s, s + 4), s);
      }
      ctx.putImageData(out, 0, 0);
    }
    return;
  }
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, TILE_PX, TILE_PX);
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const color = itemPixel(id, x, y);
      if (color === null) continue;
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
      ctx.fillRect(x, y, 1, 1);
    }
  }
}
