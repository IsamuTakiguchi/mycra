import { ITEMS, RECIPES, CREATIVE_TABS, ALL_ITEMS, itemsInTab, itemName, ingredientName, STATION_NAMES, ARMOR_SLOT_NAMES } from './items.js';
import { HOTBAR_SIZE, INVENTORY_SIZE, CONTAINER_SIZE, moveInto } from './inventory.js';
import { drawItemIcon } from './icons.js';

// インベントリ画面 (E キー)
//  survival: 持ち物 + レシピ一覧 / creative: タブ付きのアイテム一覧 / container: チェスト・樽
export class InventoryScreen {
  constructor(root, inventory, handlers) {
    this.root = root;
    this.inv = inventory;
    this.h = handlers; // { onClose, getStations, onDropStack, onChange }
    this.open = false;
    this.mode = 'survival';
    this.container = null;
    this.tab = 'building';
    this.query = '';
    this.craftableOnly = true;
    this.q = (sel) => root.querySelector(sel);
    this.mainEl = this.q('#inv-main');
    this.hotbarEl = this.q('#inv-hotbar');
    this.armorEl = this.q('#inv-armor');
    this.leftEl = this.q('#inv-left');
    this.titleEl = this.q('#inv-title');
    this.toolsEl = this.q('#inv-tools');
    this.cursorEl = this.q('#inv-cursor');
    this.tipEl = this.q('#inv-tip');
    this.slotEls = [];
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const el = this.makeSlot((e) => { this.inv.clickSlot(i, e.button, e.shiftKey || this.shiftMode(e)); this.changed(); }, i);
      (i < HOTBAR_SIZE ? this.hotbarEl : this.mainEl).appendChild(el.slot);
      this.slotEls.push(el);
    }
    this.armorEls = [];
    for (let i = 0; i < 4; i++) {
      const el = this.makeSlot((e) => { this.inv.clickArmor(i, e.button); this.changed(); });
      el.slot.classList.add('armor');
      el.slot.dataset.label = ARMOR_SLOT_NAMES[i];
      this.armorEl.appendChild(el.slot);
      this.armorEls.push(el);
    }
    this.q('#inv-close').addEventListener('click', () => this.h.onClose());
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('pointermove', (e) => this.moveCursor(e.clientX, e.clientY));
    root.addEventListener('pointerdown', (e) => {
      if (e.target === root && this.inv.cursor) {
        this.h.onDropStack?.(this.inv.cursor);
        this.inv.cursor = null;
        this.render();
      }
    });
  }

  // タッチ操作では長押しの代わりに、ダブルタップで Shift+クリック相当にする
  shiftMode(e) {
    if (e.pointerType !== 'touch') return false;
    const now = performance.now();
    const dbl = this.lastTap && now - this.lastTap.t < 300 && this.lastTap.target === e.currentTarget;
    this.lastTap = { t: now, target: e.currentTarget };
    return dbl;
  }

  changed() {
    this.render();
    this.h.onChange?.();
  }

  makeSlot(onClick) {
    const slot = document.createElement('div');
    slot.className = 'islot';
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const count = document.createElement('span');
    count.className = 'count';
    const bar = document.createElement('div');
    bar.className = 'dur';
    slot.append(c, count, bar);
    slot.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onClick(e); });
    slot.addEventListener('pointerenter', () => this.showTip(slot._id));
    slot.addEventListener('pointerleave', () => this.showTip(null));
    return { slot, canvas: c, count, bar, key: '' };
  }

  fillSlot(el, stack) {
    const key = stack ? `${stack.id}:${stack.count}:${stack.damage ?? 0}` : '';
    el.slot._id = stack?.id ?? null;
    el.slot.classList.toggle('filled', !!stack);
    if (el.key === key) return;
    el.key = key;
    if (stack) {
      drawItemIcon(el.canvas, stack.id);
      el.canvas.style.visibility = 'visible';
      el.count.textContent = stack.count > 1 ? String(stack.count) : '';
      setDurability(el.bar, stack);
    } else {
      el.canvas.style.visibility = 'hidden';
      el.count.textContent = '';
      el.bar.style.display = 'none';
    }
  }

  show(mode, container = null) {
    this.mode = mode;
    this.container = container;
    this.open = true;
    this.root.classList.remove('hidden');
    this.buildLeft();
    this.render();
  }

  hide() {
    this.open = false;
    this.container = null;
    this.root.classList.add('hidden');
    const dropped = this.inv.returnCursor();
    if (dropped) this.h.onDropStack?.(dropped);
    this.showTip(null);
  }

  buildLeft() {
    this.leftEl.innerHTML = '';
    this.toolsEl.innerHTML = '';
    this.leftEl.className = '';
    if (this.mode === 'container') {
      this.titleEl.textContent = this.container.title;
      const grid = document.createElement('div');
      grid.className = 'igrid';
      this.containerEls = [];
      for (let i = 0; i < CONTAINER_SIZE; i++) {
        const el = this.makeSlot((e) => {
          this.inv.clickIn(this.container.slots, i, e.button, e.shiftKey || this.shiftMode(e), (stack) => moveInto(this.inv.slots, stack, 0, INVENTORY_SIZE));
          this.changed();
        });
        grid.appendChild(el.slot);
        this.containerEls.push(el);
      }
      this.leftEl.appendChild(grid);
      return;
    }
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'アイテムを検索';
    search.value = this.query;
    search.className = 'isearch';
    search.addEventListener('input', () => { this.query = search.value.trim(); this.buildList(); });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    this.toolsEl.appendChild(search);
    if (this.mode === 'creative') {
      this.titleEl.textContent = 'クリエイティブ';
      const tabs = document.createElement('div');
      tabs.className = 'itabs';
      for (const [key, label] of CREATIVE_TABS) {
        const b = document.createElement('button');
        b.textContent = label;
        b.className = key === this.tab ? 'on' : '';
        b.addEventListener('click', () => {
          this.tab = key;
          this.query = '';
          search.value = '';
          for (const x of tabs.children) x.classList.toggle('on', x === b);
          this.buildList();
        });
        tabs.appendChild(b);
      }
      this.toolsEl.appendChild(tabs);
    } else {
      this.titleEl.textContent = 'クラフト';
      const label = document.createElement('label');
      label.className = 'itoggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.craftableOnly;
      cb.addEventListener('change', () => { this.craftableOnly = cb.checked; this.buildList(); });
      label.append(cb, document.createTextNode('作れるものだけ表示'));
      this.toolsEl.appendChild(label);
    }
    this.buildList();
  }

  buildList() {
    this.leftEl.innerHTML = '';
    const q = this.query;
    const match = (id) => !q || itemName(id).includes(q) || id.includes(q.toLowerCase());
    if (this.mode === 'creative') {
      const ids = q ? ALL_ITEMS.filter(match) : itemsInTab(this.tab);
      const grid = document.createElement('div');
      grid.className = 'igrid catalog';
      for (const id of ids) {
        const el = this.makeSlot((e) => {
          if (this.inv.cursor) this.inv.cursor = null;
          else if (e.shiftKey) {
            this.inv.add(id, ITEMS[id].maxStack);
          } else this.inv.cursor = { id, count: e.button === 2 ? 1 : ITEMS[id].maxStack };
          this.changed();
        });
        this.fillSlot(el, { id, count: 1 });
        grid.appendChild(el.slot);
      }
      const trash = this.makeSlot(() => { this.inv.cursor = null; this.changed(); });
      trash.slot.classList.add('trash');
      trash.slot.title = 'ゴミ箱';
      this.leftEl.append(grid, trash.slot);
      const note = document.createElement('p');
      note.className = 'inote';
      note.textContent = `${ids.length} 種類。クリックでスタック、右クリックで 1 個を持ち、持ち物のマスに置きます。Shift+クリックで直接持ち物へ。`;
      this.leftEl.appendChild(note);
      return;
    }
    const stations = this.h.getStations();
    const list = document.createElement('div');
    list.className = 'recipes';
    this.recipeEls = [];
    let shown = 0;
    for (const r of RECIPES) {
      if (!match(r.out)) continue;
      const ok = this.inv.canCraft(r, stations);
      if (this.craftableOnly && !ok) continue;
      if (++shown > 1000) break;
      const row = document.createElement('button');
      row.className = 'recipe' + (ok ? ' ok' : '');
      const icon = document.createElement('canvas');
      drawItemIcon(icon, r.out);
      const text = document.createElement('div');
      text.className = 'rtext';
      const name = document.createElement('div');
      name.className = 'rname';
      name.textContent = `${itemName(r.out)}${r.count > 1 ? ' ×' + r.count : ''}`;
      const ing = document.createElement('div');
      ing.className = 'ring';
      ing.textContent = Object.entries(r.in).map(([id, n]) => `${ingredientName(id)}×${n}`).join('  ') + (r.fuel ? '  燃料' : '');
      if (r.station) ing.textContent += `　(${STATION_NAMES[r.station]}が必要)`;
      text.append(name, ing);
      row.append(icon, text);
      row.addEventListener('click', (e) => {
        const times = e.shiftKey ? 64 : 1;
        for (let k = 0; k < times; k++) {
          const res = this.inv.craft(r, this.h.getStations());
          if (res === false) break;
          if (typeof res === 'number') { this.h.onDropStack?.({ id: r.out, count: res }); break; }
        }
        this.buildList();
        this.changed();
      });
      list.appendChild(row);
      this.recipeEls.push({ row, recipe: r });
    }
    if (!shown) {
      const p = document.createElement('p');
      p.className = 'inote';
      p.textContent = this.craftableOnly ? '今の持ち物で作れるものはありません。「作れるものだけ表示」を外すと全レシピを見られます。' : '見つかりません。';
      list.appendChild(p);
    }
    this.leftEl.appendChild(list);
  }

  render() {
    for (let i = 0; i < INVENTORY_SIZE; i++) this.fillSlot(this.slotEls[i], this.inv.slots[i]);
    for (let i = 0; i < 4; i++) this.fillSlot(this.armorEls[i], this.inv.armor[i]);
    if (this.mode === 'container' && this.containerEls) {
      for (let i = 0; i < CONTAINER_SIZE; i++) this.fillSlot(this.containerEls[i], this.container.slots[i]);
    }
    if (this.inv.cursor) {
      this.cursorEl.classList.remove('hidden');
      drawItemIcon(this.cursorEl.querySelector('canvas'), this.inv.cursor.id);
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
    if (!id || !ITEMS[id]) { this.tipEl.classList.add('hidden'); return; }
    const def = ITEMS[id];
    let text = def.name;
    if (def.food) text += `　満腹度 +${def.food / 2}`;
    if (def.damage && def.tool) text += `　攻撃力 ${def.damage}`;
    if (def.armor) text += `　防御力 +${def.armor.points}`;
    this.tipEl.textContent = text;
    this.tipEl.classList.remove('hidden');
  }
}

export function setDurability(bar, stack) {
  const max = stack && ITEMS[stack.id]?.maxDamage;
  if (!max || !stack.damage) { bar.style.display = 'none'; return; }
  const left = Math.max(0, 1 - stack.damage / max);
  bar.style.display = 'block';
  bar.style.setProperty('--w', `${Math.round(left * 100)}%`);
  bar.style.setProperty('--c', `hsl(${Math.round(left * 120)}, 90%, 45%)`);
}
