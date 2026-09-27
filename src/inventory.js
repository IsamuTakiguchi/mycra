import { ITEMS, RECIPES, TAGS, FUELS, maxStack, normalizeItemId } from './items.js';

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36; // 0-8 ホットバー, 9-35 メイン
export const CONTAINER_SIZE = 27;

// スタック: { id, count, damage? } (damage は道具・防具の消耗)
const canMerge = (a, b) => a && b && a.id === b.id && !a.damage && !b.damage && maxStack(a.id) > 1;

export class Inventory {
  constructor() {
    this.slots = new Array(INVENTORY_SIZE).fill(null);
    this.armor = [null, null, null, null]; // 頭, 胴, 脚, 足
    this.selected = 0;
    this.cursor = null; // マウスで持ち上げているスタック
    this.fuel = 0; // かまどに残っている燃料 (焼ける個数)
  }

  get selectedItem() {
    return this.slots[this.selected];
  }

  // id は通常のアイテム名か、'#planks' のようなタグ
  matches(stack, key) {
    if (!stack) return false;
    if (key.startsWith('#')) return TAGS[key]?.includes(stack.id) ?? false;
    return stack.id === key;
  }

  count(key) {
    let n = 0;
    for (const s of this.slots) if (this.matches(s, key)) n += s.count;
    return n;
  }

  // 追加して、入りきらなかった数を返す
  add(id, count = 1, damage = 0) {
    if (!ITEMS[id]) return count;
    const max = maxStack(id);
    if (!damage) {
      for (const s of this.slots) {
        if (count <= 0) break;
        if (s && s.id === id && !s.damage && s.count < max) {
          const n = Math.min(max - s.count, count);
          s.count += n;
          count -= n;
        }
      }
    }
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(max, count);
      this.slots[i] = damage ? { id, count: n, damage } : { id, count: n };
      count -= n;
    }
    return count;
  }

  addStack(stack) {
    return this.add(stack.id, stack.count, stack.damage ?? 0);
  }

  // 指定数を取り除く (足りなければ何もせず false)。key はタグも可
  remove(key, count = 1) {
    if (this.count(key) < count) return false;
    for (let i = this.slots.length - 1; i >= 0 && count > 0; i--) {
      const s = this.slots[i];
      if (!this.matches(s, key)) continue;
      const n = Math.min(s.count, count);
      s.count -= n;
      count -= n;
      if (s.count <= 0) this.slots[i] = null;
    }
    return true;
  }

  consumeSelected(n = 1) {
    const s = this.slots[this.selected];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
  }

  // 手に持っている道具を消耗させる。壊れたら true
  damageSelected(amount = 1) {
    const s = this.slots[this.selected];
    const max = s && ITEMS[s.id]?.maxDamage;
    if (!max) return false;
    s.damage = (s.damage ?? 0) + amount;
    if (s.damage >= max) { this.slots[this.selected] = null; return true; }
    return false;
  }

  // 防具の合計 (防御ポイントと防具強度)
  armorStats() {
    let points = 0, toughness = 0;
    for (const a of this.armor) {
      const def = a && ITEMS[a.id]?.armor;
      if (def) { points += def.points; toughness += def.toughness; }
    }
    return { points, toughness };
  }

  damageArmor(amount) {
    const broken = [];
    for (let i = 0; i < 4; i++) {
      const a = this.armor[i];
      if (!a) continue;
      a.damage = (a.damage ?? 0) + amount;
      if (a.damage >= ITEMS[a.id].maxDamage) { broken.push(a.id); this.armor[i] = null; }
    }
    return broken;
  }

  // 右クリックで防具を着る (同じ部位の防具とは入れ替え)
  equipSelected() {
    const s = this.slots[this.selected];
    const def = s && ITEMS[s.id]?.armor;
    if (!def) return false;
    const old = this.armor[def.slot];
    this.armor[def.slot] = s;
    this.slots[this.selected] = old;
    return true;
  }

  pickBlock(id) {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (this.slots[i]?.id === id) { this.selected = i; return; }
    }
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (!this.slots[i]) { this.slots[i] = { id, count: 1 }; this.selected = i; return; }
    }
    this.slots[this.selected] = { id, count: 1 };
  }

  // ---- クラフト ----
  hasFuel() {
    if (this.fuel > 0) return true;
    return Object.keys(FUELS).some((id) => this.count(id) > 0);
  }

  takeFuel() {
    // 石炭・木炭を優先し、次に木材、最後に長持ちする燃料を使う
    const order = Object.keys(FUELS).sort((a, b) => fuelRank(a) - fuelRank(b));
    while (this.fuel < 1) {
      const id = order.find((f) => this.count(f) > 0);
      if (!id) break;
      this.remove(id, 1);
      this.fuel += FUELS[id];
    }
    if (this.fuel >= 1) { this.fuel -= 1; return true; }
    if (this.fuel > 0) { this.fuel = 0; return true; }
    return false;
  }

  canCraft(recipe, stations) {
    if (recipe.station && !stations.has(recipe.station)) return false;
    for (const [id, n] of Object.entries(recipe.in)) if (this.count(id) < n) return false;
    if (recipe.fuel && !this.hasFuel()) return false;
    return true;
  }

  // 作れたら true (入りきらない分は戻り値の数だけ呼び出し側で落とす)
  craft(recipe, stations) {
    if (!this.canCraft(recipe, stations)) return false;
    let keepDamage = 0;
    for (const [id, n] of Object.entries(recipe.in)) {
      // 鍛冶台で強化するときは、元の道具の消耗を引き継ぐ
      if (recipe.station === 'smithing_table') {
        const s = this.slots.find((x) => x && x.id === id && x.damage);
        if (s) keepDamage = s.damage;
      }
      this.remove(id, n);
    }
    if (recipe.fuel) this.takeFuel();
    const rest = this.add(recipe.out, recipe.count, keepDamage);
    return rest === 0 ? true : rest;
  }

  // ---- スロット操作 (Minecraft のマウス操作を再現) ----
  // arr: 操作するスロット配列, button: 0 左 / 2 右, shift: 反対側へ移動 (moveTo(stack) を呼ぶ)
  clickIn(arr, i, button = 0, shift = false, moveTo = null) {
    const s = arr[i];
    if (shift) {
      if (!s || !moveTo) return;
      moveTo(s);
      arr[i] = s.count > 0 ? s : null;
      return;
    }
    const c = this.cursor;
    if (button === 2) {
      if (!c && s) {
        const n = Math.ceil(s.count / 2);
        this.cursor = { ...s, count: n };
        s.count -= n;
        if (s.count <= 0) arr[i] = null;
      } else if (c && (!s || (canMerge(s, c) && s.count < maxStack(c.id)))) {
        if (!s) arr[i] = { ...c, count: 1 };
        else s.count += 1;
        c.count -= 1;
        if (c.count <= 0) this.cursor = null;
      } else if (c && s) {
        arr[i] = c; this.cursor = s;
      }
      return;
    }
    if (!c && s) { this.cursor = s; arr[i] = null; }
    else if (c && !s) { arr[i] = c; this.cursor = null; }
    else if (c && s && canMerge(s, c)) {
      const n = Math.min(maxStack(c.id) - s.count, c.count);
      s.count += n; c.count -= n;
      if (c.count <= 0) this.cursor = null;
    } else if (c && s) { arr[i] = c; this.cursor = s; }
  }

  clickSlot(i, button = 0, shift = false) {
    this.clickIn(this.slots, i, button, shift, (stack) => {
      // 防具は空いている防具スロットへ
      const armor = ITEMS[stack.id]?.armor;
      if (armor && !this.armor[armor.slot]) { this.armor[armor.slot] = { ...stack }; stack.count = 0; return; }
      const range = i < HOTBAR_SIZE ? [HOTBAR_SIZE, INVENTORY_SIZE] : [0, HOTBAR_SIZE];
      moveInto(this.slots, stack, range[0], range[1]);
    });
  }

  clickArmor(slot, button = 0) {
    const c = this.cursor;
    if (c) {
      const def = ITEMS[c.id]?.armor;
      if (!def || def.slot !== slot) return;
      this.cursor = this.armor[slot];
      this.armor[slot] = c;
    } else if (this.armor[slot]) {
      this.cursor = this.armor[slot];
      this.armor[slot] = null;
    }
    void button;
  }

  returnCursor() {
    if (!this.cursor) return null;
    const rest = this.addStack(this.cursor);
    const dropped = rest > 0 ? { ...this.cursor, count: rest } : null;
    this.cursor = null;
    return dropped;
  }

  takeAll() {
    const all = [...this.slots.filter(Boolean), ...this.armor.filter(Boolean)];
    this.slots.fill(null);
    this.armor = [null, null, null, null];
    if (this.cursor) { all.push(this.cursor); this.cursor = null; }
    return all;
  }

  serialize() {
    return {
      slots: serializeSlots(this.slots),
      armor: serializeSlots(this.armor),
      selected: this.selected,
      fuel: this.fuel,
    };
  }

  load(data) {
    if (!data) return;
    this.slots = loadSlots(data.slots, INVENTORY_SIZE);
    this.armor = loadSlots(data.armor ?? [], 4);
    this.selected = Math.min(data.selected ?? 0, HOTBAR_SIZE - 1);
    this.fuel = data.fuel ?? 0;
  }
}

function fuelRank(id) {
  if (id === 'coal' || id === 'charcoal') return 0;
  if (id === 'stick') return 2;
  if (id === 'coal_block' || id === 'blaze_rod') return 3;
  return 1;
}

// stack を arr[from..to) へ入れる (同じアイテムに重ねてから空きへ)
export function moveInto(arr, stack, from = 0, to = arr.length) {
  for (let j = from; j < to && stack.count > 0; j++) {
    const t = arr[j];
    if (canMerge(t, stack) && t.count < maxStack(stack.id)) {
      const n = Math.min(maxStack(stack.id) - t.count, stack.count);
      t.count += n; stack.count -= n;
    }
  }
  for (let j = from; j < to && stack.count > 0; j++) {
    if (!arr[j]) { arr[j] = { ...stack }; stack.count = 0; }
  }
}

export function serializeSlots(arr) {
  return arr.map((s) => (s ? (s.damage ? [s.id, s.count, s.damage] : [s.id, s.count]) : null));
}

export function loadSlots(list, size) {
  const out = new Array(size).fill(null);
  (list ?? []).forEach((s, i) => {
    if (!s || i >= size) return;
    const id = normalizeItemId(s[0]);
    if (id) out[i] = s[2] ? { id, count: s[1], damage: s[2] } : { id, count: s[1] };
  });
  return out;
}

export { RECIPES };
