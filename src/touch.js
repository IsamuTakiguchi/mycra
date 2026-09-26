// タブレット / スマートフォン向けのタッチ操作
//  - 画面左側: 仮想ジョイスティック (触れた位置が中心になる)
//  - 画面右側: ドラッグで視点移動、タップで設置、長押しで破壊
//  - ボタン: ジャンプ / 下降 / 壊す / 置く / 飛行 / メニュー
export function isTouchDevice() {
  return (
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    navigator.maxTouchPoints > 0
  );
}

const JOY_RADIUS = 48;
const TAP_MS = 300;
const HOLD_MS = 450;
const HOLD_REPEAT_MS = 330;
const MOVE_TOLERANCE = 12;

export class TouchControls {
  constructor(root, player, handlers) {
    this.root = root;
    this.player = player;
    this.h = handlers;
    this.enabled = false;

    this.joyEl = root.querySelector('#joystick');
    this.knobEl = root.querySelector('#joystick-knob');
    this.joy = null; // { id, ox, oy }
    this.look = null; // { id, x, y, startX, startY, t0, moved, holdTimer, repeatTimer }

    this.bindButtons();
    this.bindPointers();
  }

  setEnabled(on) {
    this.enabled = on;
    this.root.classList.toggle('hidden', !on);
    if (!on) this.reset();
  }

  setFlying(flying) {
    this.root.classList.toggle('flying', flying);
  }

  reset() {
    if (!this.player) return;
    this.joy = null;
    this.clearLook();
    this.player.touch.forward = 0;
    this.player.touch.strafe = 0;
    this.player.touch.jump = false;
    this.player.touch.down = false;
    this.player.touch.sprint = false;
    this.joyEl.classList.remove('active');
  }

  bindButtons() {
    const hold = (id, key) => {
      const el = this.root.querySelector(id);
      const on = (e) => { e.preventDefault(); e.stopPropagation(); this.player.touch[key] = true; };
      const off = (e) => { e.preventDefault(); this.player.touch[key] = false; };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };
    const tap = (id, fn) => {
      const el = this.root.querySelector(id);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    };
    hold('#btn-jump', 'jump');
    hold('#btn-down', 'down');
    hold('#btn-sprint', 'sprint');
    tap('#btn-break', () => this.h.onBreak());
    tap('#btn-place', () => this.h.onPlace());
    tap('#btn-fly', () => this.h.onFly());
    tap('#btn-menu', () => this.h.onMenu());
  }

  bindPointers() {
    const surface = this.root.querySelector('#touch-surface');
    surface.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType === 'mouse') return;
      e.preventDefault();
      try { surface.setPointerCapture(e.pointerId); } catch { /* 合成イベント等では失敗することがある */ }
      if (e.clientX < window.innerWidth * 0.45 && !this.joy) {
        this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
        this.joyEl.style.left = `${e.clientX}px`;
        this.joyEl.style.top = `${e.clientY}px`;
        this.joyEl.classList.add('active');
        this.moveKnob(0, 0);
      } else if (!this.look) {
        const look = {
          id: e.pointerId, x: e.clientX, y: e.clientY,
          startX: e.clientX, startY: e.clientY, t0: e.timeStamp, moved: false,
          holdTimer: 0, repeatTimer: 0, broke: false,
        };
        look.holdTimer = setTimeout(() => {
          if (this.look !== look || look.moved) return;
          look.broke = true;
          this.h.onBreak();
          look.repeatTimer = setInterval(() => {
            if (this.look !== look || look.moved) { clearInterval(look.repeatTimer); return; }
            this.h.onBreak();
          }, HOLD_REPEAT_MS);
        }, HOLD_MS);
        this.look = look;
      }
    });

    surface.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      if (this.joy && e.pointerId === this.joy.id) {
        let dx = e.clientX - this.joy.ox;
        let dy = e.clientY - this.joy.oy;
        const len = Math.hypot(dx, dy);
        if (len > JOY_RADIUS) { dx *= JOY_RADIUS / len; dy *= JOY_RADIUS / len; }
        this.moveKnob(dx, dy);
        this.player.touch.strafe = dx / JOY_RADIUS;
        this.player.touch.forward = -dy / JOY_RADIUS;
        this.player.touch.sprint = len >= JOY_RADIUS * 0.98 && this.player.touch.forward > 0.7;
      } else if (this.look && e.pointerId === this.look.id) {
        const l = this.look;
        const dx = e.clientX - l.x;
        const dy = e.clientY - l.y;
        l.x = e.clientX;
        l.y = e.clientY;
        if (!l.moved && Math.hypot(e.clientX - l.startX, e.clientY - l.startY) > MOVE_TOLERANCE) {
          l.moved = true;
          clearTimeout(l.holdTimer);
          clearInterval(l.repeatTimer);
        }
        this.h.onLook(dx * 2.2, dy * 2.2);
      }
    });

    const end = (e) => {
      if (this.joy && e.pointerId === this.joy.id) {
        this.joy = null;
        this.joyEl.classList.remove('active');
        this.player.touch.strafe = 0;
        this.player.touch.forward = 0;
        this.player.touch.sprint = false;
      } else if (this.look && e.pointerId === this.look.id) {
        const l = this.look;
        const dt = e.timeStamp - l.t0;
        this.lastTap = { dt, moved: l.moved, broke: l.broke, type: e.type };
        if (!l.moved && !l.broke && dt < TAP_MS && e.type === 'pointerup') this.h.onPlace();
        this.clearLook();
      }
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
  }

  clearLook() {
    if (this.look) {
      clearTimeout(this.look.holdTimer);
      clearInterval(this.look.repeatTimer);
    }
    this.look = null;
  }

  moveKnob(dx, dy) {
    this.knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
}
