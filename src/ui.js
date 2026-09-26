import { ITEMS, RECIPES, CREATIVE_ITEMS, drawItemIcon, itemName, STATION_NAMES } from './items.js';
import { HOTBAR_SIZE, INVENTORY_SIZE } from './inventory.js';

// インベントリ画面 (E キー)。サバイバル: 持ち物 + クラフト、クリエイティブ: カタログ + 持ち物
export class InventoryScreen {
  constructor(root, inventory, handlers) {
    this.root = root;
    this.inv = inventory;
    this.h = handlers; // { onClose, getStations, onOverflow }
    this.open = false;
    this.mode = 'survival';
    this.mainEl = root.querySelector('#inv-main');
    this.hotbarEl = root.querySelector('#inv-hotbar');
    this.leftEl = root.querySelector('#inv-left');
    this.titleEl = root.querySelector('#inv-title');
    this.cursorEl = root.querySelector('#inv-cursor');
    this.tipEl = root.querySelector('#inv-tip');
    this.slotEls = [];
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const el = this.makeSlot((e) => this.onSlotClick(i, e));
      (i < HOTBAR_SIZE ? this.hotbarEl : this.mainEl).appendChild(el.slot);
      this.slotEls.push(el);
    }
    root.querySelector('#inv-close').addEventListener('click', () => this.h.onClose());
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('pointermove', (e) => this.moveCursor(e.clientX, e.clientY));
    root.addEventListener('pointerdown', (e) => {
      // 何もない場所をクリックしたらカーソルの中身を落とす (Minecraft と同じ)
      if (e.target === root && this.inv.cursor) {
        this.h.onDropStack?.(this.inv.cursor);
        this.inv.cursor = null;
        this.render();
      }
    });
  }

  makeSlot(onClick) {
    const slot = document.createElement('div');
    slot.className = 'islot';
    const c = document.createElement('canvas');
    const count = document.createElement('span');
    count.className = 'count';
    slot.append(c, count);
    slot.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onClick(e); });
    slot.addEventListener('pointerenter', () => this.showTip(slot._id));
    slot.addEventListener('pointerleave', () => this.showTip(null));
    return { slot, canvas: c, count };
  }

  fillSlot(el, stack) {
    el.slot._id = stack?.id ?? null;
    if (stack) {
      drawItemIcon(el.canvas, stack.id);
      el.canvas.style.visibility = 'visible';
      el.count.textContent = stack.count > 1 ? String(stack.count) : '';
    } else {
      el.canvas.style.visibility = 'hidden';
      el.count.textContent = '';
    }
  }

  onSlotClick(i, e) {
    this.inv.clickSlot(i, e.button, e.shiftKey);
    this.render();
  }

  show(mode) {
    this.mode = mode;
    this.open = true;
    this.root.classList.remove('hidden');
    this.buildLeft();
    this.render();
  }

  hide() {
    this.open = false;
    this.root.classList.add('hidden');
    const dropped = this.inv.returnCursor();
    if (dropped) this.h.onDropStack?.(dropped);
    this.showTip(null);
  }

  buildLeft() {
    this.leftEl.innerHTML = '';
    if (this.mode === 'creative') {
      this.titleEl.textContent = 'アイテム一覧';
      const grid = document.createElement('div');
      grid.className = 'igrid catalog';
      for (const id of CREATIVE_ITEMS) {
        const el = this.makeSlot((e) => {
          if (this.inv.cursor) { this.inv.cursor = null; }
          else this.inv.cursor = { id, count: e.button === 2 ? 1 : ITEMS[id].maxStack };
          this.render();
        });
        this.fillSlot(el, { id, count: 1 });
        grid.appendChild(el.slot);
      }
      const trash = this.makeSlot(() => { this.inv.cursor = null; this.render(); });
      trash.slot.classList.add('trash');
      trash.slot.title = 'ゴミ箱';
      this.leftEl.append(grid, trash.slot);
      const note = document.createElement('p');
      note.className = 'inote';
      note.textContent = 'クリックでスタックを取り、持ち物のマスに置く。右クリックで 1 個。';
      this.leftEl.appendChild(note);
    } else {
      this.titleEl.textContent = 'クラフト';
      this.recipeEls = [];
      const list = document.createElement('div');
      list.className = 'recipes';
      for (const r of RECIPES) {
        const row = document.createElement('button');
        row.className = 'recipe';
        const icon = document.createElement('canvas');
        drawItemIcon(icon, r.out);
        const text = document.createElement('div');
        text.className = 'rtext';
        const name = document.createElement('div');
        name.className = 'rname';
        name.textContent = `${itemName(r.out)}${r.count > 1 ? ' ×' + r.count : ''}`;
        const ing = document.createElement('div');
        ing.className = 'ring';
        ing.textContent = Object.entries(r.in).map(([id, n]) => `${itemName(id)}×${n}`).join('  ');
        if (r.station) ing.textContent += `　(${STATION_NAMES[r.station]}が必要)`;
        text.append(name, ing);
        row.append(icon, text);
        row.addEventListener('click', () => {
          const stations = this.h.getStations();
          const res = this.inv.craft(r, stations);
          if (res === false) return;
          if (typeof res === 'number') this.h.onDropStack?.({ id: r.out, count: res });
          this.render();
        });
        list.appendChild(row);
        this.recipeEls.push({ row, recipe: r });
      }
      this.leftEl.appendChild(list);
    }
  }

  render() {
    for (let i = 0; i < INVENTORY_SIZE; i++) this.fillSlot(this.slotEls[i], this.inv.slots[i]);
    if (this.inv.cursor) {
      this.cursorEl.classList.remove('hidden');
      const c = this.cursorEl.querySelector('canvas');
      drawItemIcon(c, this.inv.cursor.id);
      this.cursorEl.querySelector('.count').textContent = this.inv.cursor.count > 1 ? String(this.inv.cursor.count) : '';
    } else this.cursorEl.classList.add('hidden');
    if (this.mode === 'survival' && this.recipeEls) {
      const stations = this.h.getStations();
      for (const { row, recipe } of this.recipeEls) row.classList.toggle('ok', this.inv.canCraft(recipe, stations));
    }
  }

  moveCursor(x, y) {
    this.cursorEl.style.left = `${x}px`;
    this.cursorEl.style.top = `${y}px`;
  }

  showTip(id) {
    if (!id) { this.tipEl.classList.add('hidden'); return; }
    this.tipEl.textContent = itemName(id);
    const def = ITEMS[id];
    if (def.food) this.tipEl.textContent += `　満腹度 +${def.food / 2}`;
    if (def.tool) this.tipEl.textContent += `　攻撃力 ${def.damage}`;
    this.tipEl.classList.remove('hidden');
  }
}
