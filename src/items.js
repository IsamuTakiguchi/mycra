import { BLOCKS, COLORS, WOODS, WOOD_LOGS, FLOWER_NAMES } from './blocks.js';

// ============================================================
// アイテムの登録
// ============================================================
export const ITEMS = {};
const ORDER = [];

function item(id, def) {
  if (ITEMS[id]) return ITEMS[id];
  ITEMS[id] = { id, maxStack: 64, tab: 'ingredients', ...def };
  ORDER.push(id);
  return ITEMS[id];
}

// 旧バージョンのセーブで使っていたアイテム名
export const LEGACY_ITEMS = { log: 'oak_log', leaves: 'oak_leaves', planks: 'oak_planks', snow: 'snow_block', wool: 'white_wool', steak: 'cooked_beef' };
export function normalizeItemId(id) {
  const n = LEGACY_ITEMS[id] ?? id;
  return ITEMS[n] ? n : null;
}

// ---- ドット絵 (16x16 の文字列。'.' は透明) ----
const pad = (rows) => {
  const out = rows.map((r) => (r + '................').slice(0, 16));
  while (out.length < 16) out.push('................');
  return out;
};
const E = '................';
const ART = {
  pickaxe: ['.........MMMm...', '.......MMmmmmm..', '......Mm....mmm.', '.....Mm......dm.', '....Mm........dm', '...Mm.hh.......d', '...m.hh.........', '....hh..........', '...hh...........', '..hh............', '.hh.............', 'hh..............'],
  axe: ['.........mmM....', '........mmmMM...', '.......mmmmmM...', '.......mmmmmm...', '......hhmmmd....', '.....hh.ddd.....', '....hh..........', '...hh...........', '..hh............', '.hh.............', 'hh..............'],
  shovel: ['..........mMM...', '.........mmmMM..', '.........mmmmM..', '.........dmmm...', '.......hh.dd....', '......hh........', '.....hh.........', '....hh..........', '...hh...........', '..hh............', '.hh.............', 'hh..............'],
  hoe: ['......mmmmM.....', '.....dmmmmmM....', '.........hdd....', '........hh......', '.......hh.......', '......hh........', '.....hh.........', '....hh..........', '...hh...........', '..hh............', '.hh.............', 'hh..............'],
  sword: ['...............M', '..............MM', '.............Mmd', '............Mmd.', '...........Mmd..', '..........Mmd...', '.........Mmd....', '........Mmd.....', '.......Mmd......', '..g...Mmd.......', '...g.Mmd........', '....gmd.........', '...hgg.g........', '..h...g.........', '.h..............', 'h...............'],
  helmet: [E, E, E, '....dddddddd....', '...dMMMMMMMMd...', '...dMmmmmmmmd...', '...dmmmmmmmmd...', '...dmd....dmd...', '...dmd....dmd...', '...ddd....ddd...'],
  chestplate: [E, '..ddd......ddd..', '.dMmmd....dmmmd.', '.dMmmmddddmmmmd.', '.dMmmmmmmmmmmmd.', '..ddMmmmmmmmdd..', '....dMmmmmmd....', '....dMmmmmmd....', '....dmmmmmmd....', '....dmmmmmmd....', '....dmmmmmmd....', '....dmmmmmmd....', '....dddddddd....'],
  leggings: [E, '....dddddddd....', '....dMmmmmmd....', '....dMmmmmmd....', '....dmmddmmd....', '....dmd..dmd....', '....dmd..dmd....', '....dmd..dmd....', '....dmd..dmd....', '....dmd..dmd....', '....dmd..dmd....', '....ddd..ddd....'],
  boots: [E, E, E, E, E, E, '...ddd....ddd...', '...dMd....dMd...', '...dmd....dmd...', '...dmd....dmd...', '.ddmmd..ddmmd...', '.dmmmd..dmmmd...', '.ddddd..ddddd...'],
  stick: [E, '..............hh', '.............hh.', '............hh..', '...........hh...', '..........hh....', '.........hh.....', '........hh......', '.......hh.......', '......hh........', '.....hh.........', '....hh..........', '...hh...........', '..hh............', '.hh.............'],
  lump: [E, E, '.....mmmm.......', '....mmMMmm......', '...mmMMMmmm.....', '...mMMMmmmm.....', '..mmMMmmmmdd....', '..mmmmmmmmdd....', '..mmmmmmmddd....', '...mmmmmmdd.....', '....mmdddd......', '.....dddd.......'],
  ingot: [E, E, E, '......MMMMMMMM..', '.....MMmmmmmmmd.', '....MMmmmmmmmdd.', '...MMmmmmmmmdd..', '...mmmmmmmmddd..', '...ddddddddd....'],
  nugget: [E, E, E, E, E, '......ddd.......', '.....dMmmd......', '....dMmmmmd.....', '....dmmmmmd.....', '.....dmmmd......', '......ddd.......'],
  gem: [E, E, '.....dddddd.....', '....dMMMmmmd....', '...dMMmmmmmmd...', '..dMmmmmmmmmmd..', '...dmmmmmmmmd...', '....dmmmmmmd....', '.....dmmmmd.....', '......dmmd......', '.......dd.......'],
  dust: [E, E, E, E, E, E, E, E, '.......M........', '......mMm.......', '.....mmmmm......', '....mmmMmmm.....', '...dmmmmmmmd....', '..dddmmmmmddd...', '...ddddddddd....'],
  shard: ['..........M.....', '.........Mm.....', '........Mmmd....', '.......Mmmd.....', '......Mmmd......', '.....Mmmd.......', '....Mmmd........', '...mmmd.........', '..ddd...........'],
  bone: ['..MM............', '.MmmM...........', '.MmmmM..........', '..MmmmM.........', '...MmmmM........', '....MmmmM.......', '.....MmmmM......', '......MmmmM.....', '.......MmmmM....', '........MmmmM...', '.........MmmmM..', '..........MmmmM.', '...........MmmM.', '............MM..'],
  string: [E, '..........mm....', '.........m..m...', '........m....m..', '...mm...m.......', '..m..m.m........', '.m....m.........', '.m..............', '..m.............'],
  leather: [E, '...dddd..dddd...', '..dmmmmddmmmmd..', '..dmMmmmmmmmmd..', '...dmmmmmmmmd...', '...dmmmmmmmmd...', '..dmmmmmmmmmmd..', '..dmmmmmmmmmmd..', '...dmmmmmmmmd...', '..dmmmddddmmmd..', '..ddd......ddd..'],
  paper: [E, '..MMMMMMMMMM....', '..Mmmmmmmmmmm...', '..mmmmmmmmmmm...', '..mmmmmmmmmmm...', '..mmmmmmmmmmm...', '..mmmmmmmmmmm...', '..mmmmmmmmmmm...', '..mmmmmmmmmmm...', '..mmmmmmmmmmm...', '..mmmmmmmmmmm...', '..mmmmmmmmmmm...', '..ddddddddddd...'],
  book: [E, '..ddddddddddd...', '..dhmmmmmmmmmd..', '..dhmMMMmmmmmd..', '..dhmmmmmmmmmd..', '..dhmmmmmmmmmd..', '..dhmmmmmmmmmd..', '..dhmmmmmmmmmd..', '..dhmmmmmmmmmd..', '..dhmmmmmmmmmd..', '..dhwwwwwwwwwd..', '..ddddddddddd...'],
  bucket: [E, E, '...dddddddddd...', '..dMMMMMMMMMMd..', '..dMwwwwwwwwmd..', '..dMwwwwwwwwmd..', '...dmmmmmmmmd...', '...dMmmmmmmmd...', '...dmmmmmmmmd...', '....dmmmmmmd....', '....dmmmmmmd....', '.....dddddd.....'],
  bow: ['.........hhh....', '.......hh...s...', '......h.....s...', '.....h......s...', '....h......s....', '...h......s.....', '...h.....s......', '..h.....s.......', '..h....s........', '..h...s.........', '...h.s..........', '...hs...........', '....s...........'],
  arrow: ['...........MMd..', '..........MMd...', '.........Md.....', '........h.......', '.......h........', '......h.........', '.....h..........', '....h...........', '..fh............', '.ffh............', '.ff.............'],
  flint: [E, E, E, '......dd........', '.....dmmd.......', '....dmMmmd......', '....dmmmmmd.....', '...dmmmmmmd.....', '...dmmmmmd......', '....dddddd......'],
  flint_and_steel: ['....sss.........', '...s...s........', '...s...s........', '...s...s........', '....sss.........', '.......dd.......', '......dmmd......', '......dmmmd.....', '.......dmmd.....', '........dd......'],
  shears: ['.........ss.....', '........sss.....', '.......sss......', '......sss.ss....', '.....sss.sss....', '....ss..sss.....', '...rr..sss......', '..r..r.ss.......', '..r..r..........', '...rr...........'],
  dial: [E, '.....dddddd.....', '....dMMMMMMd....', '...dMwwwwwwMd...', '...dMwwrwwwMd...', '...dMwwrwwwMd...', '...dMwwwkwwMd...', '...dMwwwkwwMd...', '...dMwwwwwwMd...', '....dMMMMMMd....', '.....dddddd.....'],
  fishing_rod: ['...........hh...', '..........hh.s..', '.........hh..s..', '........hh...s..', '.......hh....s..', '......hh.....s..', '.....hh......s..', '....hh.......s..', '...hh........c..', '..hh............', '.hh.............'],
  bowl: [E, E, E, E, E, E, E, '..dddddddddddd..', '..dMwwwwwwwwmd..', '...dmmmmmmmmd...', '....dmmmmmmd....', '.....dddddd.....'],
  bread: [E, E, E, E, E, '....ddddddd.....', '...dMMmMMmMd....', '..dmMmmMmmMmd...', '..dmmmmmmmmmd...', '...ddddddddd....'],
  cookie: [E, E, E, E, '.....ddddd......', '....dmmkmmd.....', '...dmmmmmkmd....', '...dmkmmmmmd....', '...dmmmmkmmd....', '....dmmmmmd.....', '.....ddddd......'],
  carrot: ['..........gg....', '.........g.g....', '........mmg.....', '.......mmm......', '......mmMm......', '.....mmmm.......', '....mmMm........', '...mmmm.........', '..mmm...........', '..m.............'],
  potato: [E, E, E, E, '.....dddd.......', '....dmmmmd......', '...dmmMmmmd.....', '...dmmmmkmd.....', '...dmkmmmmd.....', '....dmmmmd......', '.....dddd.......'],
  beetroot: ['.......gg.......', '......g..g......', '.......gg.......', '......dmmd......', '.....dmmmmd.....', '....dmMmmmmd....', '....dmmmmmmd....', '.....dmmmmd.....', '......dmmd......', '.......dd.......', '........d.......'],
  melon_slice: [E, E, E, E, E, '..gggggggggggg..', '..wmmmmmmmmmmw..', '...wmmkmmkmmw...', '....wmmmmmmw....', '.....wmmkmw.....', '......wmmw......', '.......ww.......'],
  fish: [E, E, E, E, E, '...........dd...', '...dddddd.dmd...', '..dmMmmmmdmmd...', '.dmkmmmmmmmd....', '..dmmmmmmdmmd...', '...dddddd.dmd...', '...........dd...'],
  egg: [E, E, E, '......ddd.......', '.....dMmmd......', '....dMmmmmd.....', '....dmmmmmd.....', '....dmmmmmd.....', '....dmmmmmd.....', '.....dmmmd......', '......ddd.......'],
  ball: [E, E, E, E, '......dddd......', '.....dMMmmd.....', '....dMmmmmmd....', '....dmmmmmmd....', '....dmmmmmmd....', '.....dmmmmd.....', '......dddd......'],
  wheat: ['..........m.m...', '.........mmm....', '........mmm.m...', '.......mmm......', '......mmm.m.....', '.....hmm........', '....hh..........', '...hh...........', '..hh............', '.hh.............'],
  seeds: [E, E, E, E, E, '.....m...m......', '.......m........', '....m......m....', '......m..m......', '........m.......'],
  rod: ['..........mM....', '.........mMd....', '........mMd.....', '.......mMd......', '......mMd.......', '.....mMd........', '....mMd.........', '...mMd..........', '..mMd...........', '..dd............'],
  dye: [E, E, E, '.......dd.......', '......dmmd......', '.....dmMmmd.....', '....dmMmmmmd....', '....dmmmmmmd....', '....dmmmmmmd....', '.....dmmmmd.....', '......dddd......'],
  bottle: ['......ddd.......', '......dwd.......', '......dwd.......', '.....dwwwd......', '....dwMwwwd.....', '....dwwwwwd.....', '....dccccwd.....', '....dccccwd.....', '.....ddddd......'],
  berries: ['.......g........', '......ggg.......', '.....dmd.dmd....', '....dmMmddMmd...', '....dmmmddmmd...', '.....dmd.dmd....', '......dmd.......', '.....dmMmd......', '.....dmmmd......', '......ddd.......'],
  strip: ['...........dd...', '..........dmd...', '.........dmd....', '........dmd.....', '.......dmd......', '......dmd.......', '.....dmd........', '....dmd.........', '...dd...........'],
  meat: [E, E, '.......mmmm.....', '.....mmMMmmm....', '....mmMMMmmmm...', '....mmMMmmmmmd..', '...mmmmmmmmmdd..', '...mmmmmmmmdd...', '..bbmmmmmmdd....', '.bbbbmmmddd.....', '.bbb.bbdd.......', '..b..bb.........'],
  drumstick: [E, '..........mmm...', '.........mMMmm..', '........mmMMmmm.', '.......mmmmmmmm.', '......mmmmmmmmd.', '.....mmmmmmmdd..', '....bbmmmmddd...', '...bbbb.dd......', '..bbbb..........', '.bbb............', '.bb.............'],
  apple: ['.......s........', '......s.........', '....rrrrrrr.....', '...rrRrrrrrr....', '..rrRRrrrrrrr...', '..rrRrrrrrrrr...', '..rrrrrrrrrrr...', '..rrrrrrrrrrd...', '...rrrrrrrrdd...', '....rrrrrddd....', '.....rrrdd......'],
  feather: ['..........fff...', '.........ffFFf..', '........ffFFff..', '.......ffFFff...', '......ffFFff....', '.....ffFFff.....', '....ffFFff......', '...hhFFff.......', '..hhff..........', '.hh.............', 'hh..............'],
  pie: [E, E, E, E, E, '....ddddddd.....', '...dMMMMMMMd....', '..dMwMwMwMwMd...', '..dmmmmmmmmmd...', '...ddddddddd....'],
};
for (const k of Object.keys(ART)) ART[k] = pad(ART[k]);

const HANDLE = { h: 0x5a3a1a, g: 0x8a6a2a };
const TIERS = {
  wooden: { name: '木', tier: 0, speed: 2, dur: 59, colors: { M: 0xd6b07a, m: 0xb8905a, d: 0x8a6a3a } },
  stone: { name: '石', tier: 1, speed: 4, dur: 131, colors: { M: 0xb5b5b5, m: 0x8a8a8a, d: 0x5e5e5e } },
  iron: { name: '鉄', tier: 2, speed: 6, dur: 250, colors: { M: 0xffffff, m: 0xd8d8d8, d: 0x9a9a9a } },
  golden: { name: '金', tier: 0, speed: 12, dur: 32, colors: { M: 0xfff6a0, m: 0xf8d33d, d: 0xb89020 } },
  diamond: { name: 'ダイヤモンド', tier: 3, speed: 8, dur: 1561, colors: { M: 0xb8fff8, m: 0x4aedd9, d: 0x1a9a8a } },
  netherite: { name: 'ネザライト', tier: 4, speed: 9, dur: 2031, colors: { M: 0x7a7276, m: 0x4a4246, d: 0x2a2426 } },
};
const TOOL_KINDS = {
  sword: { name: '剣', dmg: { wooden: 4, stone: 5, iron: 6, golden: 4, diamond: 7, netherite: 8 } },
  shovel: { name: 'シャベル', dmg: { wooden: 2.5, stone: 3.5, iron: 4.5, golden: 2.5, diamond: 5.5, netherite: 6.5 } },
  pickaxe: { name: 'ツルハシ', dmg: { wooden: 2, stone: 3, iron: 4, golden: 2, diamond: 5, netherite: 6 } },
  axe: { name: '斧', dmg: { wooden: 7, stone: 9, iron: 9, golden: 7, diamond: 9, netherite: 10 } },
  hoe: { name: 'クワ', dmg: { wooden: 1, stone: 1, iron: 1, golden: 1, diamond: 1, netherite: 1 } },
};
for (const [tk, t] of Object.entries(TIERS)) {
  for (const [kk, k] of Object.entries(TOOL_KINDS)) {
    item(`${tk}_${kk}`, {
      name: `${t.name}の${k.name}`, art: kk, colors: { ...HANDLE, ...t.colors }, maxStack: 1,
      tool: kk === 'sword' ? 'sword' : kk, tier: t.tier, speed: t.speed, damage: k.dmg[tk], maxDamage: t.dur,
      tab: kk === 'sword' ? 'combat' : 'tools',
    });
  }
}

// 防具
const ARMOR_SLOTS = [['helmet', 0, 11], ['chestplate', 1, 16], ['leggings', 2, 15], ['boots', 3, 13]];
export const ARMOR_SLOT_NAMES = ['頭', '胴', '脚', '足'];
const ARMOR_TIERS = {
  leather: { names: ['革の帽子', '革の上着', '革のズボン', '革のブーツ'], pts: [1, 3, 2, 1], tough: 0, mult: 5, colors: { M: 0xc88a5a, m: 0xa0643a, d: 0x6a3e1e } },
  chainmail: { names: ['チェーンのヘルメット', 'チェーンのチェストプレート', 'チェーンのレギンス', 'チェーンのブーツ'], pts: [2, 5, 4, 1], tough: 0, mult: 15, colors: { M: 0xc8c8c8, m: 0x8a8a8a, d: 0x4a4a4a } },
  iron: { names: ['鉄のヘルメット', '鉄のチェストプレート', '鉄のレギンス', '鉄のブーツ'], pts: [2, 6, 5, 2], tough: 0, mult: 15, colors: TIERS.iron.colors },
  golden: { names: ['金のヘルメット', '金のチェストプレート', '金のレギンス', '金のブーツ'], pts: [2, 5, 3, 1], tough: 0, mult: 7, colors: TIERS.golden.colors },
  diamond: { names: ['ダイヤモンドのヘルメット', 'ダイヤモンドのチェストプレート', 'ダイヤモンドのレギンス', 'ダイヤモンドのブーツ'], pts: [3, 8, 6, 3], tough: 2, mult: 33, colors: TIERS.diamond.colors },
  netherite: { names: ['ネザライトのヘルメット', 'ネザライトのチェストプレート', 'ネザライトのレギンス', 'ネザライトのブーツ'], pts: [3, 8, 6, 3], tough: 3, mult: 37, colors: TIERS.netherite.colors },
};
for (const [tk, t] of Object.entries(ARMOR_TIERS)) {
  for (const [kind, slot, base] of ARMOR_SLOTS) {
    item(`${tk}_${kind}`, {
      name: t.names[slot], art: kind, colors: t.colors, maxStack: 1, tab: 'combat',
      armor: { slot, points: t.pts[slot], toughness: t.tough }, maxDamage: base * t.mult,
    });
  }
}

// 素材
const M = (id, name, art, colors, extra = {}) => item(id, { name, art, colors, ...extra });
M('stick', '棒', 'stick', { h: 0x6b4a26 });
M('coal', '石炭', 'lump', { M: 0x4a4a4a, m: 0x2a2a2a, d: 0x111111 });
M('charcoal', '木炭', 'lump', { M: 0x5a4a3a, m: 0x3a2e24, d: 0x1e1812 });
M('raw_iron', '鉄の原石', 'lump', { M: 0xf0d0b0, m: 0xd8b090, d: 0xa87a58 });
M('raw_copper', '銅の原石', 'lump', { M: 0xf09a6a, m: 0xd87a4a, d: 0x9a4a2a });
M('raw_gold', '金の原石', 'lump', { M: 0xfff0a0, m: 0xf0c83a, d: 0xb08a1a });
M('iron_ingot', '鉄インゴット', 'ingot', TIERS.iron.colors);
M('copper_ingot', '銅インゴット', 'ingot', { M: 0xf0a07a, m: 0xd8784a, d: 0x9a4a2a });
M('gold_ingot', '金インゴット', 'ingot', TIERS.golden.colors);
M('netherite_ingot', 'ネザライトインゴット', 'ingot', TIERS.netherite.colors);
M('netherite_scrap', 'ネザライトの欠片', 'lump', { M: 0x7a5a4a, m: 0x5a3e32, d: 0x3a2620 });
M('iron_nugget', '鉄塊', 'nugget', TIERS.iron.colors);
M('gold_nugget', '金塊', 'nugget', TIERS.golden.colors);
M('diamond', 'ダイヤモンド', 'gem', TIERS.diamond.colors);
M('emerald', 'エメラルド', 'gem', { M: 0x9affb8, m: 0x17dd62, d: 0x0a8a3a });
M('lapis_lazuli', 'ラピスラズリ', 'gem', { M: 0x5a8af0, m: 0x1d47a0, d: 0x0e2a6a });
M('quartz', 'ネザークォーツ', 'gem', { M: 0xffffff, m: 0xe8e0d8, d: 0xb8aea4 });
M('amethyst_shard', 'アメジストの欠片', 'shard', { M: 0xd8b0ff, m: 0x9a6ad8, d: 0x5a3a9a });
M('redstone', 'レッドストーンダスト', 'dust', { M: 0xff6a6a, m: 0xd01010, d: 0x7a0808 });
M('glowstone_dust', 'グロウストーンダスト', 'dust', { M: 0xfff0a0, m: 0xf0c050, d: 0xa07a20 });
M('gunpowder', '火薬', 'dust', { M: 0x9a9a9a, m: 0x6a6a6a, d: 0x3a3a3a });
M('sugar', '砂糖', 'dust', { M: 0xffffff, m: 0xeeeeee, d: 0xc8c8c8 });
M('bone_meal', '骨粉', 'dust', { M: 0xffffff, m: 0xe8e8e0, d: 0xb8b8b0 });
M('blaze_powder', 'ブレイズパウダー', 'dust', { M: 0xfff06a, m: 0xf0a020, d: 0xa05a10 });
M('prismarine_crystals', 'プリズマリンクリスタル', 'dust', { M: 0xe0fff0, m: 0x9ad8c8, d: 0x5a9a8a });
M('prismarine_shard', 'プリズマリンの欠片', 'shard', { M: 0x9ad8c8, m: 0x5aa898, d: 0x2a6a5a });
M('flint', '火打石', 'flint', { M: 0x6a6a6a, m: 0x3a3a3a, d: 0x1a1a1a });
M('clay_ball', '粘土玉', 'ball', { M: 0xc8ccd8, m: 0xa0a6b3, d: 0x6a707a });
M('brick', 'レンガ', 'ingot', { M: 0xc87a5a, m: 0x9a4e36, d: 0x6a2e1e });
M('nether_brick', 'ネザーレンガ', 'ingot', { M: 0x5a2a2e, m: 0x3a1a1e, d: 0x1e0c0e });
M('string', '糸', 'string', { m: 0xf0f0f0 });
M('feather', '羽根', 'feather', { f: 0xf0f0f0, F: 0xffffff, h: 0xc0c0c0 });
M('leather', '革', 'leather', { M: 0xc88a5a, m: 0xa0643a, d: 0x6a3e1e });
M('bone', '骨', 'bone', { M: 0xffffff, m: 0xe8e4d0 });
M('paper', '紙', 'paper', { M: 0xffffff, m: 0xf0f0e8, d: 0xc8c8c0 });
M('book', '本', 'book', { h: 0x6a3a1e, m: 0x8a5a2e, M: 0xb07a4a, d: 0x4a2a14, w: 0xf0f0e8 });
M('wheat', '小麦', 'wheat', { m: 0xd8b84a, h: 0x9a8a2a });
M('wheat_seeds', '小麦の種', 'seeds', { m: 0x6aa83a });
M('egg', '卵', 'egg', { M: 0xffffff, m: 0xf0e0c8, d: 0xb8a888 }, { maxStack: 16 });
M('slime_ball', 'スライムボール', 'ball', { M: 0xa8f0a0, m: 0x6fc05a, d: 0x3a8a2a });
M('snowball', '雪玉', 'ball', { M: 0xffffff, m: 0xf0f4f8, d: 0xb8c8d8 }, { maxStack: 16 });
M('ender_pearl', 'エンダーパール', 'ball', { M: 0x6af0d8, m: 0x1a8a7a, d: 0x0a3a3a }, { maxStack: 16 });
M('blaze_rod', 'ブレイズロッド', 'rod', { M: 0xfff06a, m: 0xf0a020, d: 0xa05a10 });
M('ink_sac', 'イカスミ', 'dye', { M: 0x4a4a5a, m: 0x1a1a24, d: 0x0a0a10 });
M('cocoa_beans', 'カカオ豆', 'egg', { M: 0xa06a3a, m: 0x7a4a24, d: 0x4a2a14 });
M('nether_wart', 'ネザーウォート', 'berries', { M: 0xd83a3a, m: 0x9a1a1a, d: 0x5a0a0a, g: 0x6a1a1a });
M('bowl', 'ボウル', 'bowl', { M: 0xb8905a, m: 0x8a6a3a, d: 0x5a3a1a, w: 0x4a2e14 });
M('glass_bottle', 'ガラス瓶', 'bottle', { d: 0x8ab8c8, w: 0xd8f0f8, M: 0xffffff, c: 0xd8f0f8 });

// 染料
const DYE_SOURCES = {
  white: [['bone_meal'], ['lily_of_the_valley']], orange: [['orange_tulip'], ['red_dye', 'yellow_dye']],
  magenta: [['allium'], ['purple_dye', 'pink_dye']], light_blue: [['blue_orchid'], ['blue_dye', 'white_dye']],
  yellow: [['dandelion']], lime: [['green_dye', 'white_dye']], pink: [['pink_tulip'], ['red_dye', 'white_dye']],
  gray: [['black_dye', 'white_dye']], light_gray: [['azure_bluet'], ['oxeye_daisy'], ['white_tulip'], ['gray_dye', 'white_dye']],
  cyan: [['blue_dye', 'green_dye']], purple: [['red_dye', 'blue_dye']], blue: [['lapis_lazuli'], ['cornflower']],
  brown: [['cocoa_beans']], green: [], red: [['poppy'], ['red_tulip'], ['beetroot']], black: [['ink_sac']],
};
for (const [key, label, c] of COLORS) {
  const hi = mixColor(c, 0xffffff, 0.35), lo = mixColor(c, 0x000000, 0.4);
  M(`${key}_dye`, `${label}の染料`, 'dye', { M: hi, m: c, d: lo });
}
function mixColor(a, b, t) {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return ((r | 0) << 16) | ((g | 0) << 8) | (bl | 0);
}

// 道具類
const T = (id, name, art, colors, extra = {}) => item(id, { name, art, colors, tab: 'tools', maxStack: 1, ...extra });
T('bucket', 'バケツ', 'bucket', { M: 0xffffff, m: 0xc8c8c8, d: 0x6a6a6a, w: 0x3a3a3a }, { maxStack: 16, bucket: 'empty' });
T('water_bucket', '水入りバケツ', 'bucket', { M: 0xffffff, m: 0xc8c8c8, d: 0x6a6a6a, w: 0x2d6fd8 }, { bucket: 'water' });
T('compass', 'コンパス', 'dial', { M: 0xc8c8c8, d: 0x5a5a5a, w: 0xd8d8e0, r: 0xd82a2a, k: 0x3a3a3a });
T('clock', '時計', 'dial', { M: 0xf8d33d, d: 0xa07a1a, w: 0x3a6ad8, r: 0xf0f0f0, k: 0xf0e060 });
T('shears', 'ハサミ', 'shears', { s: 0xd8d8d8, r: 0x8a2a2a }, { tool: 'shears', speed: 5, maxDamage: 238 });
T('flint_and_steel', '火打石と打ち金', 'flint_and_steel', { s: 0x9a9a9a, M: 0x6a6a6a, m: 0x3a3a3a, d: 0x1a1a1a }, { maxDamage: 64 });
T('fishing_rod', '釣り竿', 'fishing_rod', { h: 0x6b4a26, s: 0xe0e0e0, c: 0x9a9a9a }, { maxDamage: 64 });
item('bow', { name: '弓', art: 'bow', colors: { h: 0x6b4a26, s: 0xe0e0e0 }, maxStack: 1, tab: 'combat', bow: true, maxDamage: 384 });
item('arrow', { name: '矢', art: 'arrow', colors: { M: 0xd8d8d8, d: 0x6a6a6a, h: 0x8a6a3a, f: 0xf0f0f0 }, tab: 'combat' });

// 食料 (food は満腹度、sat は隠し満腹度の代わりに回復量のおまけ)
const F = (id, name, art, colors, food, extra = {}) => item(id, { name, art, colors, food, tab: 'food', ...extra });
F('apple', 'リンゴ', 'apple', { r: 0xd82020, R: 0xff6060, d: 0xa01010, s: 0x5a3a1a }, 4);
F('golden_apple', '金のリンゴ', 'apple', { r: 0xf8d33d, R: 0xfff6a0, d: 0xb89020, s: 0x5a3a1a }, 4, { heal: 4 });
F('bread', 'パン', 'bread', { M: 0xe0a860, m: 0xc08040, d: 0x7a4a1a }, 5);
F('cookie', 'クッキー', 'cookie', { m: 0xd89a5a, d: 0x8a5a2a, k: 0x4a2a14 }, 2);
F('carrot', 'ニンジン', 'carrot', { M: 0xffb060, m: 0xf08a1a, g: 0x4a9a2a }, 3);
F('golden_carrot', '金のニンジン', 'carrot', { M: 0xfff6a0, m: 0xf8d33d, g: 0x4a9a2a }, 6);
F('potato', 'ジャガイモ', 'potato', { M: 0xe8c890, m: 0xd0a860, d: 0x8a6a3a, k: 0x8a6a3a }, 1);
F('baked_potato', 'ベイクドポテト', 'potato', { M: 0xe8b060, m: 0xc88a3a, d: 0x7a4a1a, k: 0x5a3a1a }, 5);
F('beetroot', 'ビートルート', 'beetroot', { M: 0xd84a5a, m: 0xa0243a, d: 0x5a0a1a, g: 0x4a9a2a }, 1);
F('melon_slice', 'スイカの薄切り', 'melon_slice', { g: 0x4a8a2a, w: 0xe8f0c8, m: 0xe03a3a, k: 0x1a1a1a }, 2);
F('pumpkin_pie', 'パンプキンパイ', 'pie', { M: 0xf0a040, m: 0xc07a2a, d: 0x7a4a1a, w: 0xf8e8b8 }, 8);
F('sweet_berries', 'スイートベリー', 'berries', { M: 0xff6a6a, m: 0xc81a2a, d: 0x7a0a14, g: 0x3a7a2a }, 2);
F('dried_kelp', '乾燥した昆布', 'strip', { m: 0x3a4a2a, d: 0x1e2614 }, 1);
F('rotten_flesh', '腐った肉', 'meat', { m: 0x8a6a3a, M: 0xa88a5a, d: 0x4a6a2a, b: 0xd8d0b0 }, 4);
const MEATS = [
  ['porkchop', '生の豚肉', 'cooked_porkchop', '焼き豚', 'meat', [0xf0a0a0, 0xffc0c0, 0xc07070], [0xb06a3a, 0xd08a5a, 0x7a4a2a], 3, 8],
  ['beef', '生の牛肉', 'cooked_beef', 'ステーキ', 'meat', [0xb03030, 0xd05050, 0x802020], [0x7a4a2a, 0x9a6a4a, 0x4a2a1a], 3, 8],
  ['mutton', '生の羊肉', 'cooked_mutton', '焼き羊肉', 'meat', [0xc04040, 0xe06060, 0x903030], [0x8a5a3a, 0xaa7a5a, 0x5a3a2a], 2, 6],
  ['chicken', '生の鶏肉', 'cooked_chicken', '焼き鳥', 'drumstick', [0xf0c0b0, 0xffe0d0, 0xc09080], [0xc08040, 0xe0a060, 0x905020], 2, 6],
  ['rabbit', '生の兎肉', 'cooked_rabbit', '焼き兎肉', 'drumstick', [0xe8a8a0, 0xffc8c0, 0xb07870], [0xb07040, 0xd09060, 0x7a4a20], 3, 5],
  ['cod', '生鱈', 'cooked_cod', '焼き鱈', 'fish', [0xc8b89a, 0xe0d4b8, 0x7a6a4a], [0xd8b06a, 0xf0d08a, 0x8a6a3a], 2, 5],
  ['salmon', '生鮭', 'cooked_salmon', '焼き鮭', 'fish', [0xc84a3a, 0xe87a6a, 0x6a2a20], [0xd87a4a, 0xf09a6a, 0x7a3a1a], 2, 6],
];
for (const [raw, rawName, cooked, cookedName, art, rc, cc, rf, cf] of MEATS) {
  F(raw, rawName, art, { m: rc[0], M: rc[1], d: rc[2], b: 0xf5f0e0, k: 0x1a1a1a }, rf);
  F(cooked, cookedName, art, { m: cc[0], M: cc[1], d: cc[2], b: 0xf5f0e0, k: 0x1a1a1a }, cf);
}
const BOWL = { M: 0xb8905a, m: 0x8a6a3a, d: 0x5a3a1a };
F('mushroom_stew', 'キノコシチュー', 'bowl', { ...BOWL, w: 0xc89a6a }, 6, { maxStack: 1, returns: 'bowl' });
F('beetroot_soup', 'ビートルートスープ', 'bowl', { ...BOWL, w: 0xa0243a }, 6, { maxStack: 1, returns: 'bowl' });
F('rabbit_stew', 'ウサギシチュー', 'bowl', { ...BOWL, w: 0xb07a3a }, 10, { maxStack: 1, returns: 'bowl' });

// ブロックアイテム (カタログの定義順)
const blockOrder = BLOCKS.filter(Boolean).slice().sort((a, b) => a.order - b.order);
for (const d of blockOrder) {
  if (!d.item) continue;
  item(d.item, { name: d.label, block: d.id, tab: d.tab, maxStack: d.bed ? 1 : 64 });
}

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
  return def.colors?.[ch] ?? def.colors?.m ?? 0xff00ff;
}

export function hasArt(id) {
  return !!ART[ITEMS[id]?.art];
}

// ============================================================
// タグ (レシピで「どれでもよい」素材)
// ============================================================
export const TAGS = {
  '#planks': WOODS.map((w) => `${w.id}_planks`),
  '#logs': WOODS.flatMap((w) => WOOD_LOGS[w.id]),
  '#wool': COLORS.map(([k]) => `${k}_wool`),
  '#stone_crafting': ['cobblestone', 'cobbled_deepslate', 'blackstone'],
  '#coals': ['coal', 'charcoal'],
  '#sand': ['sand', 'red_sand'],
  '#wooden_slabs': WOODS.map((w) => `${w.id}_slab`),
};
for (const w of WOODS) TAGS[`#${w.id}_logs`] = WOOD_LOGS[w.id];
export const TAG_NAMES = {
  '#planks': '板材', '#logs': '原木', '#wool': '羊毛', '#stone_crafting': '丸石類', '#coals': '石炭/木炭', '#sand': '砂', '#wooden_slabs': '木のハーフブロック',
};
for (const w of WOODS) TAG_NAMES[`#${w.id}_logs`] = ITEMS[WOOD_LOGS[w.id][0]].name;

export function ingredientName(key) {
  return key.startsWith('#') ? TAG_NAMES[key] ?? key : itemName(key);
}

// かまどの燃料 (1 つで何個焼けるか)
export const FUELS = { coal: 8, charcoal: 8, coal_block: 80, blaze_rod: 12, stick: 0.5 };
for (const id of TAGS['#planks']) FUELS[id] = 1.5;
for (const id of TAGS['#logs']) FUELS[id] = 1.5;

// ============================================================
// レシピ
// ============================================================
export const RECIPES = [];
export const STATION_NAMES = { crafting_table: '作業台', furnace: 'かまど', smithing_table: '鍛冶台' };

function add(out, count, ins, o = {}) {
  for (const k of Object.keys(ins)) if (!k.startsWith('#') && !ITEMS[k]) throw new Error(`recipe ${out}: unknown ingredient ${k}`);
  if (!ITEMS[out]) throw new Error(`recipe: unknown output ${out}`);
  RECIPES.push({ out, count, in: ins, station: o.station ?? null, fuel: !!o.fuel });
}
// 手持ちの 2x2 で作れないもの (4 個を超える、または 3 列必要) は作業台が必要
function craft(out, count, ins, o = {}) {
  const sum = Object.values(ins).reduce((a, b) => a + b, 0);
  const needsTable = o.table !== undefined ? !!o.table : sum > 4;
  add(out, count, ins, { station: needsTable ? 'crafting_table' : null });
}
function smelt(out, input) {
  add(out, 1, { [input]: 1 }, { station: 'furnace', fuel: true });
}

// 木材
for (const w of WOODS) {
  const logs = WOOD_LOGS[w.id];
  const planks = `${w.id}_planks`;
  craft(planks, w.bamboo ? 2 : 4, { [`#${w.id}_logs`]: 1 });
  if (logs.length === 4) {
    craft(logs[2], 3, { [logs[0]]: 4 });
    craft(logs[3], 3, { [logs[1]]: 4 });
  }
  craft(`${w.id}_fence`, 3, { [planks]: 4, stick: 2 });
  craft(`${w.id}_fence_gate`, 1, { [planks]: 2, stick: 4 });
  craft(`${w.id}_door`, 3, { [planks]: 6 });
  craft(`${w.id}_trapdoor`, 2, { [planks]: 6 });
  craft(`${w.id}_pressure_plate`, 1, { [planks]: 2 });
  craft(`${w.id}_button`, 1, { [planks]: 1 });
}
// ハーフブロック・階段・塀 (元ブロックから)
for (const d of blockOrder) {
  if (!d.base || !ITEMS[d.base]) continue;
  if (d.shape === 'slab') craft(d.item, 6, { [d.base]: 3 }, { table: 'crafting_table' });
  else if (d.shape === 'stairs') craft(d.item, 4, { [d.base]: 6 });
  else if (d.shape === 'wall') craft(d.item, 6, { [d.base]: 6 });
}

// 石材
craft('stone_bricks', 4, { stone: 4 });
craft('mossy_cobblestone', 1, { cobblestone: 1, moss_block: 1 });
craft('mossy_stone_bricks', 1, { stone_bricks: 1, moss_block: 1 });
craft('chiseled_stone_bricks', 1, { stone_brick_slab: 2 });
for (const n of ['granite', 'diorite', 'andesite']) craft(`polished_${n}`, 4, { [n]: 4 });
craft('granite', 1, { diorite: 1, quartz: 1 });
craft('diorite', 2, { cobblestone: 2, quartz: 2 });
craft('andesite', 2, { diorite: 1, cobblestone: 1 });
craft('polished_deepslate', 4, { cobbled_deepslate: 4 });
craft('deepslate_bricks', 4, { polished_deepslate: 4 });
craft('deepslate_tiles', 4, { deepslate_bricks: 4 });
craft('chiseled_deepslate', 1, { cobbled_deepslate_slab: 2 });
craft('polished_tuff', 4, { tuff: 4 });
craft('tuff_bricks', 4, { polished_tuff: 4 });
craft('chiseled_tuff', 1, { tuff_slab: 2 });
craft('bricks', 1, { brick: 4 });
craft('packed_mud', 1, { mud: 1, wheat: 1 });
craft('mud_bricks', 4, { packed_mud: 4 });
for (const p of ['', 'red_']) {
  craft(`${p}sandstone`, 1, { [`${p}sand`]: 4 });
  craft(`cut_${p}sandstone`, 4, { [`${p}sandstone`]: 4 });
  craft(`chiseled_${p}sandstone`, 1, { [`${p}sandstone_slab`]: 2 });
}
craft('prismarine', 1, { prismarine_shard: 4 });
craft('prismarine_bricks', 1, { prismarine_shard: 9 });
craft('dark_prismarine', 1, { prismarine_shard: 8, black_dye: 1 });
craft('sea_lantern', 1, { prismarine_shard: 4, prismarine_crystals: 5 });
craft('nether_bricks', 1, { nether_brick: 4 });
craft('nether_brick_fence', 6, { nether_bricks: 4, nether_brick: 2 });
craft('chiseled_nether_bricks', 1, { nether_brick_slab: 2 });
craft('red_nether_bricks', 1, { nether_brick: 2, nether_wart: 2 });
craft('polished_blackstone', 4, { blackstone: 4 });
craft('polished_blackstone_bricks', 4, { polished_blackstone: 4 });
craft('chiseled_polished_blackstone', 1, { polished_blackstone_slab: 2 });
craft('polished_blackstone_button', 1, { polished_blackstone: 1 });
craft('polished_blackstone_pressure_plate', 1, { polished_blackstone: 2 });
craft('polished_basalt', 4, { basalt: 4 });
craft('end_stone_bricks', 4, { end_stone: 4 });
craft('purpur_pillar', 1, { purpur_slab: 2 });
craft('quartz_block', 1, { quartz: 4 });
craft('quartz_bricks', 4, { quartz_block: 4 });
craft('quartz_pillar', 2, { quartz_block: 2 });
craft('chiseled_quartz_block', 1, { quartz_slab: 2 });
craft('cut_copper', 4, { copper_block: 4 });
craft('chiseled_copper', 1, { cut_copper_slab: 2 });
craft('amethyst_block', 1, { amethyst_shard: 4 });
craft('glowstone', 1, { glowstone_dust: 4 });
craft('snow_block', 1, { snowball: 4 });
craft('clay', 1, { clay_ball: 4 });
craft('moss_carpet', 3, { moss_block: 2 });
craft('jack_o_lantern', 1, { carved_pumpkin: 1, torch: 1 });

// 鉱物ブロックと逆変換
const STORAGE = [
  ['coal_block', 'coal'], ['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['redstone_block', 'redstone'],
  ['emerald_block', 'emerald'], ['lapis_block', 'lapis_lazuli'], ['diamond_block', 'diamond'], ['netherite_block', 'netherite_ingot'],
  ['raw_iron_block', 'raw_iron'], ['raw_copper_block', 'raw_copper'], ['raw_gold_block', 'raw_gold'], ['copper_block', 'copper_ingot'],
  ['hay_block', 'wheat'], ['bone_block', 'bone_meal'], ['slime_block', 'slime_ball'],
];
for (const [blockItem, unit] of STORAGE) {
  craft(blockItem, 1, { [unit]: 9 });
  craft(unit, 9, { [blockItem]: 1 });
}
craft('melon', 1, { melon_slice: 9 });
craft('iron_ingot', 1, { iron_nugget: 9 });
craft('iron_nugget', 9, { iron_ingot: 1 });
craft('gold_ingot', 1, { gold_nugget: 9 });
craft('gold_nugget', 9, { gold_ingot: 1 });
craft('netherite_ingot', 1, { netherite_scrap: 4, gold_ingot: 4 });

// 色付きブロック
craft('white_wool', 1, { string: 4 });
craft('glass_pane', 16, { glass: 6 });
for (const [key] of COLORS) {
  const dye = `${key}_dye`;
  if (key !== 'white') craft(`${key}_wool`, 1, { white_wool: 1, [dye]: 1 });
  craft(`${key}_carpet`, 3, { [`${key}_wool`]: 2 });
  craft(`${key}_stained_glass`, 8, { glass: 8, [dye]: 1 });
  craft(`${key}_stained_glass_pane`, 16, { [`${key}_stained_glass`]: 6 });
  craft(`${key}_terracotta`, 8, { terracotta: 8, [dye]: 1 });
  craft(`${key}_concrete_powder`, 8, { '#sand': 4, gravel: 4, [dye]: 1 });
  craft(`${key}_bed`, 1, { [`${key}_wool`]: 3, '#planks': 3 });
  smelt(`${key}_glazed_terracotta`, `${key}_terracotta`);
  for (const src of DYE_SOURCES[key]) {
    const ins = {};
    for (const s of src) ins[s] = (ins[s] ?? 0) + 1;
    craft(dye, src.length > 1 ? src.length : 1, ins);
  }
}
smelt('green_dye', 'cactus');

// 機能ブロック
craft('crafting_table', 1, { '#planks': 4 });
craft('chest', 1, { '#planks': 8 });
craft('barrel', 1, { '#planks': 6, '#wooden_slabs': 2 });
craft('bookshelf', 1, { '#planks': 6, book: 3 });
craft('ladder', 3, { stick: 7 });
craft('torch', 4, { '#coals': 1, stick: 1 });
craft('lantern', 1, { iron_nugget: 8, torch: 1 });
craft('furnace', 1, { '#stone_crafting': 8 });
craft('smoker', 1, { furnace: 1, '#logs': 4 });
craft('blast_furnace', 1, { furnace: 1, iron_ingot: 5, smooth_stone: 3 });
craft('iron_bars', 16, { iron_ingot: 6 });
craft('tnt', 1, { gunpowder: 5, '#sand': 4 });
craft('jukebox', 1, { '#planks': 8, diamond: 1 });
craft('note_block', 1, { '#planks': 8, redstone: 1 });
craft('enchanting_table', 1, { book: 1, diamond: 2, obsidian: 4 });
craft('smithing_table', 1, { iron_ingot: 2, '#planks': 4 });
craft('cartography_table', 1, { paper: 2, '#planks': 4 });
craft('fletching_table', 1, { flint: 2, '#planks': 4 });
craft('loom', 1, { string: 2, '#planks': 2 });
craft('redstone_lamp', 1, { redstone: 4, glowstone: 1 });

// 道具・防具
const TOOL_SHAPE = { pickaxe: 3, axe: 3, shovel: 1, hoe: 2, sword: 2 };
const TOOL_STICKS = { pickaxe: 2, axe: 2, shovel: 2, hoe: 2, sword: 1 };
const TOOL_MATERIAL = { wooden: '#planks', stone: '#stone_crafting', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const [tier, mat] of Object.entries(TOOL_MATERIAL)) {
  for (const kind of Object.keys(TOOL_SHAPE)) {
    craft(`${tier}_${kind}`, 1, { [mat]: TOOL_SHAPE[kind], stick: TOOL_STICKS[kind] }, { table: 'crafting_table' });
  }
}
const ARMOR_COUNTS = { helmet: 5, chestplate: 8, leggings: 7, boots: 4 };
const ARMOR_MATERIAL = { leather: 'leather', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const [tier, mat] of Object.entries(ARMOR_MATERIAL)) {
  for (const [kind, n] of Object.entries(ARMOR_COUNTS)) craft(`${tier}_${kind}`, 1, { [mat]: n }, { table: 'crafting_table' });
}
for (const kind of [...Object.keys(TOOL_SHAPE), ...Object.keys(ARMOR_COUNTS)]) {
  add(`netherite_${kind}`, 1, { [`diamond_${kind}`]: 1, netherite_ingot: 1 }, { station: 'smithing_table' });
}
craft('stick', 4, { '#planks': 2 });
craft('bowl', 4, { '#planks': 3 }, { table: 'crafting_table' });
craft('glass_bottle', 3, { glass: 3 }, { table: 'crafting_table' });
craft('paper', 3, { sugar_cane: 3 }, { table: 'crafting_table' });
craft('book', 1, { paper: 3, leather: 1 });
craft('sugar', 1, { sugar_cane: 1 });
craft('bone_meal', 3, { bone: 1 });
craft('blaze_powder', 2, { blaze_rod: 1 });
craft('arrow', 4, { flint: 1, stick: 1, feather: 1 }, { table: 'crafting_table' });
craft('bow', 1, { stick: 3, string: 3 });
craft('fishing_rod', 1, { stick: 3, string: 2 });
craft('shears', 1, { iron_ingot: 2 });
craft('flint_and_steel', 1, { iron_ingot: 1, flint: 1 });
craft('bucket', 1, { iron_ingot: 3 }, { table: 'crafting_table' });
craft('compass', 1, { iron_ingot: 4, redstone: 1 });
craft('clock', 1, { gold_ingot: 4, redstone: 1 });

// 食料
craft('bread', 1, { wheat: 3 }, { table: 'crafting_table' });
craft('cookie', 8, { wheat: 2, cocoa_beans: 1 }, { table: 'crafting_table' });
craft('pumpkin_pie', 1, { pumpkin: 1, sugar: 1, egg: 1 });
craft('golden_apple', 1, { gold_ingot: 8, apple: 1 });
craft('golden_carrot', 1, { gold_nugget: 8, carrot: 1 });
craft('mushroom_stew', 1, { bowl: 1, red_mushroom: 1, brown_mushroom: 1 });
craft('beetroot_soup', 1, { bowl: 1, beetroot: 6 });
craft('rabbit_stew', 1, { bowl: 1, cooked_rabbit: 1, carrot: 1, baked_potato: 1, brown_mushroom: 1 });

// 精錬
smelt('stone', 'cobblestone');
smelt('smooth_stone', 'stone');
smelt('cracked_stone_bricks', 'stone_bricks');
smelt('deepslate', 'cobbled_deepslate');
smelt('cracked_deepslate_bricks', 'deepslate_bricks');
smelt('cracked_deepslate_tiles', 'deepslate_tiles');
smelt('smooth_sandstone', 'sandstone');
smelt('smooth_red_sandstone', 'red_sandstone');
smelt('smooth_quartz', 'quartz_block');
smelt('smooth_basalt', 'basalt');
smelt('cracked_nether_bricks', 'nether_bricks');
smelt('cracked_polished_blackstone_bricks', 'polished_blackstone_bricks');
smelt('glass', '#sand');
smelt('terracotta', 'clay');
smelt('nether_brick', 'netherrack');
smelt('brick', 'clay_ball');
smelt('charcoal', '#logs');
smelt('sponge', 'wet_sponge');
smelt('iron_ingot', 'raw_iron');
smelt('gold_ingot', 'raw_gold');
smelt('copper_ingot', 'raw_copper');
smelt('netherite_scrap', 'ancient_debris');
for (const [ore, out] of [['iron', 'iron_ingot'], ['gold', 'gold_ingot'], ['copper', 'copper_ingot'], ['coal', 'coal'], ['diamond', 'diamond'], ['emerald', 'emerald'], ['lapis', 'lapis_lazuli'], ['redstone', 'redstone']]) {
  smelt(out, `${ore}_ore`);
  smelt(out, `deepslate_${ore}_ore`);
}
smelt('gold_ingot', 'nether_gold_ore');
smelt('quartz', 'nether_quartz_ore');
for (const [raw, , cooked] of MEATS) smelt(cooked, raw);
smelt('baked_potato', 'potato');

// ============================================================
// クリエイティブのタブ
// ============================================================
export const CREATIVE_TABS = [
  ['building', '建築ブロック'], ['colored', '色付きブロック'], ['natural', '天然ブロック'], ['functional', '機能ブロック'],
  ['tools', '道具'], ['combat', '戦闘'], ['food', '食料'], ['ingredients', '材料'],
];
export function itemsInTab(tab) {
  return ORDER.filter((id) => ITEMS[id].tab === tab);
}
export const ALL_ITEMS = ORDER;

// 旧コードとの互換 (クリエイティブの一覧)
export const CREATIVE_ITEMS = ORDER;
export { FLOWER_NAMES };
