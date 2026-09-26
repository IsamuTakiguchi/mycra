import { ITEMS, RECIPES, maxStack } from './items.js';

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36; // 0-8 ホットバー, 9-35 メイン

export class Inventory {
  constructor() {
    this.slots = new Array(INVENTORY_SIZE).fill(null); // { id, count } | null
    this.selected = 0;
    this.cursor = null; // マウスで持ち上げているスタック
  }

  get selectedItem() {
    return this.slots[this.selected];
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  // 追加して、入りきらなかった数を返す
  add(id, count = 1) {
    const max = maxStack(id);
    for (const s of this.slots) {
      if (count <= 0) break;
      if (s && s.id === id && s.count < max) {
        const n = Math.min(max - s.count, count);
        s.count += n;
        count -= n;
      }
    }
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(max, count);
      this.slots[i] = { id, count: n };
      count -= n;
    }
    return count;
  }

  // 指定数を取り除く (足りなければ何もせず false)
  remove(id, count = 1) {
    if (this.count(id) < count) return false;
    for (let i = this.slots.length - 1; i >= 0 && count > 0; i--) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
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

  // ホットバーに空きがあればそこへ、なければ選択中のスロットへ (クリエイティブのブロック選択)
  pickBlock(id) {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (this.slots[i]?.id === id) { this.selected = i; return; }
    }
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (!this.slots[i]) { this.slots[i] = { id, count: 1 }; this.selected = i; return; }
    }
    this.slots[this.selected] = { id, count: 1 };
  }

  canCraft(recipe, stations) {
    if (recipe.station && !stations.has(recipe.station)) return false;
    for (const [id, n] of Object.entries(recipe.in)) if (this.count(id) < n) return false;
    return true;
  }

  craft(recipe, stations) {
    if (!this.canCraft(recipe, stations)) return false;
    for (const [id, n] of Object.entries(recipe.in)) this.remove(id, n);
    const rest = this.add(recipe.out, recipe.count);
    return rest === 0 ? true : rest; // 入りきらない分は呼び出し側で落とす
  }

  // ---- スロット操作 (Minecraft のマウス操作を再現) ----
  // button: 0 左, 2 右。shift: ホットバーとメインの間を移動
  clickSlot(i, button = 0, shift = false) {
    const s = this.slots[i];
    if (shift) {
      if (!s) return;
      const target = i < HOTBAR_SIZE ? [HOTBAR_SIZE, INVENTORY_SIZE] : [0, HOTBAR_SIZE];
      const moved = this.moveTo(s, target[0], target[1]);
      if (moved) this.slots[i] = s.count > 0 ? s : null;
      return;
    }
    const c = this.cursor;
    if (button === 2) {
      if (!c && s) {
        // 半分持ち上げる
        const n = Math.ceil(s.count / 2);
        this.cursor = { id: s.id, count: n };
        s.count -= n;
        if (s.count <= 0) this.slots[i] = null;
      } else if (c && (!s || (s.id === c.id && s.count < maxStack(c.id)))) {
        // 1 個置く
        if (!s) this.slots[i] = { id: c.id, count: 1 };
        else s.count += 1;
        c.count -= 1;
        if (c.count <= 0) this.cursor = null;
      } else if (c && s) {
        this.slots[i] = c; this.cursor = s;
      }
      return;
    }
    if (!c && s) { this.cursor = s; this.slots[i] = null; }
    else if (c && !s) { this.slots[i] = c; this.cursor = null; }
    else if (c && s && s.id === c.id) {
      const max = maxStack(c.id);
      const n = Math.min(max - s.count, c.count);
      s.count += n; c.count -= n;
      if (c.count <= 0) this.cursor = null;
    } else if (c && s) { this.slots[i] = c; this.cursor = s; }
  }

  moveTo(stack, from, to) {
    const max = maxStack(stack.id);
    let moved = false;
    for (let j = from; j < to && stack.count > 0; j++) {
      const t = this.slots[j];
      if (t && t.id === stack.id && t.count < max) {
        const n = Math.min(max - t.count, stack.count);
        t.count += n; stack.count -= n; moved = true;
      }
    }
    for (let j = from; j < to && stack.count > 0; j++) {
      if (!this.slots[j]) { this.slots[j] = { id: stack.id, count: stack.count }; stack.count = 0; moved = true; }
    }
    return moved;
  }

  // カーソルの中身を戻す (画面を閉じるとき)
  returnCursor() {
    if (!this.cursor) return null;
    const rest = this.add(this.cursor.id, this.cursor.count);
    const dropped = rest > 0 ? { id: this.cursor.id, count: rest } : null;
    this.cursor = null;
    return dropped;
  }

  // 全アイテムを取り出す (死亡時のドロップ)
  takeAll() {
    const all = this.slots.filter(Boolean);
    this.slots.fill(null);
    if (this.cursor) { all.push(this.cursor); this.cursor = null; }
    return all;
  }

  serialize() {
    return { slots: this.slots.map((s) => (s ? [s.id, s.count] : null)), selected: this.selected };
  }

  load(data) {
    if (!data) return;
    this.slots = new Array(INVENTORY_SIZE).fill(null);
    (data.slots ?? []).forEach((s, i) => {
      if (s && ITEMS[s[0]] && i < INVENTORY_SIZE) this.slots[i] = { id: s[0], count: s[1] };
    });
    this.selected = Math.min(data.selected ?? 0, HOTBAR_SIZE - 1);
  }
}

export { RECIPES };
