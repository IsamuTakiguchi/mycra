// タブレット / スマートフォン向けのタッチ操作 (Minecraft Bedrock 版に準拠)
//  - 画面左側: 仮想ジョイスティック (触れた位置が中心。外側までなぞるか、前に 2 回はじくとダッシュ)
//  - 画面右側: ドラッグで視点移動。タップした場所のブロックに設置 / 使用 / 攻撃、
//    長押しした場所のブロックを破壊 (指を動かしても指の下のブロックを掘り続ける)
//  - ボタン: ジャンプ (二度押しで飛行) / しゃがむ (スニーク) / ダッシュ / 持ち物 / メニュー
export function isTouchDevice() {
  return (
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    navigator.maxTouchPoints > 0
  );
}

const JOY_RADIUS = 48;
const TAP_MS = 300;
const HOLD_MS = 250;
const MOVE_TOLERANCE = 18;
const DOUBLE_TAP_MS = 350;

export class TouchControls {
  constructor(root, player, handlers) {
    this.root = root;
    this.player = player;
    this.h = handlers;
    this.enabled = false;
    this.joyEl = root.querySelector('#joystick');
    this.knobEl = root.querySelector('#joystick-knob');
    this.joy = null;
    this.look = null;
    this.sprintMode = false; // ダッシュボタンで ON にすると、前に進む間ずっとダッシュ
    this.sprintLatch = false; // 前に 2 回はじいたときのダッシュ (指を離すまで)
    this.lastForwardPush = 0;
    this.btn = { sneak: root.querySelector('#btn-sneak'), sprint: root.querySelector('#btn-sprint') };
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
    this.clearLook(true);
    const t = this.player.touch;
    t.forward = 0; t.strafe = 0; t.jump = false; t.sprint = false; t.sneak = false;
    this.sprintMode = false;
    this.sprintLatch = false;
    this.btn.sneak.classList.remove('on');
    this.btn.sprint.classList.remove('on', 'active');
    this.joyEl.classList.remove('active');
  }

  setSneak(on) {
    this.player.touch.sneak = on;
    this.btn.sneak.classList.toggle('on', on);
    if (on) this.setSprintMode(false);
  }

  setSprintMode(on) {
    this.sprintMode = on;
    this.btn.sprint.classList.toggle('on', on);
    if (on && this.player.touch.sneak) this.setSneak(false);
    this.updateSprint();
  }

  updateSprint() {
    const t = this.player.touch;
    const edge = this.joy ? this.joy.edge : false;
    t.sprint = this.sprintMode || this.sprintLatch || edge;
  }

  // 毎フレーム: ボタンの表示を実際の状態に合わせる
  sync() {
    if (!this.enabled || !this.player) return;
    this.btn.sprint.classList.toggle('active', this.player.sprinting);
    this.btn.sneak.classList.toggle('active', this.player.sneaking);
  }

  bindButtons() {
    const q = (id) => this.root.querySelector(id);
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    const hold = (id, on, off) => {
      const el = q(id);
      el.addEventListener('pointerdown', (e) => { stop(e); on(e); });
      const end = (e) => { e.preventDefault(); off(e); };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('pointerleave', end);
    };
    hold('#btn-jump', () => { this.player.touch.jump = true; this.h.onJumpPress(); }, () => { this.player.touch.jump = false; });
    // しゃがむ: タップで切り替え (Minecraft 統合版の「スニーク切り替え」と同じ)
    this.btn.sneak.addEventListener('pointerdown', (e) => { stop(e); this.setSneak(!this.player.touch.sneak); });
    // ダッシュ: タップで切り替え。ON の間は前に進むとダッシュになる
    this.btn.sprint.addEventListener('pointerdown', (e) => { stop(e); this.setSprintMode(!this.sprintMode); });
    q('#btn-menu').addEventListener('pointerdown', (e) => { stop(e); this.h.onMenu(); });
  }

  bindPointers() {
    const surface = this.root.querySelector('#touch-surface');
    surface.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType === 'mouse') return;
      e.preventDefault();
      try { surface.setPointerCapture(e.pointerId); } catch { /* 合成イベント等では失敗することがある */ }
      if (e.clientX < window.innerWidth * 0.45 && !this.joy) {
        this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, edge: false, pushed: false };
        this.joyEl.style.left = `${e.clientX}px`;
        this.joyEl.style.top = `${e.clientY}px`;
        this.joyEl.classList.add('active');
        this.moveKnob(0, 0);
      } else if (!this.look) {
        const look = {
          id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY,
          t0: e.timeStamp, moved: false, mining: false, holdTimer: 0,
        };
        look.holdTimer = setTimeout(() => {
          if (this.look !== look || look.moved) return;
          look.mining = true;
          this.h.onMineStart(look.x, look.y);
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
        const t = this.player.touch;
        t.strafe = dx / JOY_RADIUS;
        t.forward = -dy / JOY_RADIUS;
        // 前に 2 回すばやくはじくとダッシュ (Minecraft の W 二度押しと同じ)
        if (t.forward > 0.6 && !this.joy.pushed) {
          this.joy.pushed = true;
          if (e.timeStamp - this.lastForwardPush < DOUBLE_TAP_MS) this.sprintLatch = true;
          this.lastForwardPush = e.timeStamp;
        } else if (t.forward < 0.3) {
          if (this.joy.pushed && this.sprintLatch) this.sprintLatch = false;
          this.joy.pushed = false;
        }
        this.joy.edge = len >= JOY_RADIUS * 0.9 && t.forward > 0.7;
        this.updateSprint();
      } else if (this.look && e.pointerId === this.look.id) {
        const l = this.look;
        const dx = e.clientX - l.x;
        const dy = e.clientY - l.y;
        l.x = e.clientX;
        l.y = e.clientY;
        if (!l.moved && Math.hypot(e.clientX - l.startX, e.clientY - l.startY) > MOVE_TOLERANCE) {
          l.moved = true;
          clearTimeout(l.holdTimer);
        }
        // 長押し中に動かしても、指の下のブロックを掘り続ける
        if (l.mining) this.h.onMineMove(l.x, l.y);
        this.h.onLook(dx * 2.2, dy * 2.2);
      }
    });

    const end = (e) => {
      if (this.joy && e.pointerId === this.joy.id) {
        this.joy = null;
        this.joyEl.classList.remove('active');
        this.player.touch.strafe = 0;
        this.player.touch.forward = 0;
        this.sprintLatch = false;
        this.updateSprint();
      } else if (this.look && e.pointerId === this.look.id) {
        const l = this.look;
        const dt = e.timeStamp - l.t0;
        this.lastTap = { dt, moved: l.moved, mining: l.mining, type: e.type };
        if (!l.moved && !l.mining && dt < TAP_MS && e.type === 'pointerup') this.h.onUse(l.x, l.y);
        this.clearLook(l.mining);
      }
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
  }

  clearLook(wasMining) {
    if (this.look) clearTimeout(this.look.holdTimer);
    this.look = null;
    if (wasMining) this.h.onMineEnd();
  }

  moveKnob(dx, dy) {
    this.knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
}
