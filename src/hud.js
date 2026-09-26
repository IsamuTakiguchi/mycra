import { drawItemIcon, itemName } from './items.js';
import { HOTBAR_SIZE } from './inventory.js';
import { MAX_HEALTH, MAX_HUNGER } from './player.js';

const HEART = ['.kk.kk.', 'krrkrrk', 'krrrrrk', 'krrrrrk', '.krrrk.', '..krk..', '...k...'];
const FOOD = ['...kkk.', '..kmmmk', '..kmmmk', '.kkmmk.', 'kbkkk..', 'kbbk...', '.kk....'];

function drawIcon(canvas, rows, fill, state) {
  // state: 2 = 満, 1 = 半分, 0 = 空
  canvas.width = 7; canvas.height = 7;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 7, 7);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const ch = rows[y][x];
    if (ch === '.') continue;
    let color;
    if (ch === 'k') color = '#1a1a1a';
    else {
      const filled = state === 2 || (state === 1 && x < 3);
      color = filled ? fill[ch] : '#4a4a4a';
    }
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  }
}

export class HUD {
  constructor(els) {
    this.els = els;
    this.lastHealth = -1;
    this.lastHunger = -1;
    this.lastMode = '';
    this.toastTimer = 0;
    this.hearts = [];
    this.foods = [];
    for (let i = 0; i < 10; i++) {
      const h = document.createElement('canvas');
      h.className = 'stat-icon';
      els.hearts.appendChild(h);
      this.hearts.push(h);
      const f = document.createElement('canvas');
      f.className = 'stat-icon';
      els.hunger.appendChild(f);
      this.foods.push(f);
    }
    this.slotEls = [];
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      const c = document.createElement('canvas');
      const count = document.createElement('span');
      count.className = 'count';
      slot.append(c, count);
      els.hotbar.appendChild(slot);
      this.slotEls.push({ slot, canvas: c, count, key: '' });
    }
    this.nameTimer = 0;
  }

  renderHotbar(inventory) {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const s = inventory.slots[i];
      const el = this.slotEls[i];
      const key = s ? `${s.id}:${s.count}` : '';
      if (el.key !== key) {
        el.key = key;
        if (s) {
          drawItemIcon(el.canvas, s.id);
          el.canvas.style.visibility = 'visible';
          el.count.textContent = s.count > 1 ? String(s.count) : '';
        } else {
          el.canvas.style.visibility = 'hidden';
          el.count.textContent = '';
        }
      }
      el.slot.classList.toggle('selected', i === inventory.selected);
    }
  }

  // 選択したアイテム名をホットバーの上に一瞬表示
  showItemName(inventory) {
    const s = inventory.selectedItem;
    this.els.itemName.textContent = s ? itemName(s.id) : '';
    this.els.itemName.classList.add('show');
    clearTimeout(this.nameTimer);
    this.nameTimer = setTimeout(() => this.els.itemName.classList.remove('show'), 1500);
  }

  updateStats(player) {
    const creative = player.creative;
    if (this.lastMode !== player.gameMode) {
      this.lastMode = player.gameMode;
      this.els.stats.style.display = creative ? 'none' : '';
    }
    if (creative) return;
    const hp = Math.round(player.health);
    if (hp !== this.lastHealth) {
      this.lastHealth = hp;
      for (let i = 0; i < 10; i++) {
        const v = hp - i * 2;
        drawIcon(this.hearts[i], HEART, { r: '#e0262c' }, v >= 2 ? 2 : v === 1 ? 1 : 0);
      }
    }
    const hg = Math.round(player.hunger);
    if (hg !== this.lastHunger) {
      this.lastHunger = hg;
      for (let i = 0; i < 10; i++) {
        const v = hg - (9 - i) * 2;
        drawIcon(this.foods[i], FOOD, { m: '#c07030', b: '#f0e0c0' }, v >= 2 ? 2 : v === 1 ? 1 : 0);
      }
    }
    this.els.hearts.classList.toggle('low', hp <= 4);
    void MAX_HEALTH; void MAX_HUNGER;
  }

  flashDamage() {
    const el = this.els.damage;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  toast(msg) {
    this.els.toast.textContent = msg;
    this.els.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.els.toast.classList.remove('show'), 2000);
  }

  setDebug(text) {
    this.els.info.textContent = text;
  }
}
