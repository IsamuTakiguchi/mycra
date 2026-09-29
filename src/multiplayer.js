import * as THREE from 'three';
import { Peer } from 'peerjs';
import { buildMobModel } from './models.js';
import { serializeSlots, loadSlots, CONTAINER_SIZE } from './inventory.js';
import { rayAABB } from './physics.js';

// ---- マルチプレイ (WebRTC によるブラウザ同士の直接接続) ----
// ホストのブラウザがサーバー役になり、ワールド・モブ・落ちているアイテム・チェストの中身を管理する。
// 参加者はブロックの変更・自分の位置・攻撃などをホストへ送り、ホストが全員へ配る。
// 接続の仲介には PeerJS の公開シグナリングサーバーを使う (ゲームのデータは P2P で流れる)。

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX = 'mycra-';

function randomCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

// テスト用にシグナリングサーバーを URL で差し替えられるようにする
function peerOptions() {
  const q = new URLSearchParams(location.search);
  const o = { debug: 0 };
  if (q.get('peerHost')) {
    o.host = q.get('peerHost');
    o.port = Number(q.get('peerPort') || 9000);
    o.path = q.get('peerPath') || '/';
    o.secure = q.get('peerSecure') === '1';
  }
  if (q.get('peerIce') === 'none') o.config = { iceServers: [] };
  return o;
}

function errorText(err) {
  const map = {
    'peer-unavailable': 'そのルームは見つかりません',
    network: 'ネットワークに接続できません',
    'server-error': '接続サーバーに問題があります',
    'socket-error': '接続サーバーに接続できません',
    'browser-incompatible': 'このブラウザは対応していません',
  };
  return map[err?.type] ?? (err?.message || String(err));
}

export function cleanName(name) {
  return String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
}

function cleanText(text) {
  return String(text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
}

// 名札
function makeTag(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 34px sans-serif';
  const w = Math.min(248, ctx.measureText(text).width + 24);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect((256 - w) / 2, 8, w, 48);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// 他のプレイヤーの見た目
class RemoteView {
  constructor(scene, name) {
    this.scene = scene;
    this.name = name;
    this.model = buildMobModel('player');
    this.group = this.model.group;
    this.tag = makeTag(name);
    this.tag.position.y = 2.2;
    this.group.add(this.tag);
    scene.add(this.group);
    this.position = new THREE.Vector3();
    this.target = null;
    this.yaw = 0;
    this.pitch = 0;
    this.anim = 0;
    this.width = 0.6;
    this.height = 1.8;
    this.dead = false;
    this.mode = 'survival';
  }

  setState(x, y, z, yaw, pitch, sneak, dead, mode) {
    if (!this.target) this.position.set(x, y, z);
    this.target = new THREE.Vector3(x, y, z);
    this.yaw = yaw;
    this.pitch = pitch;
    this.sneak = !!sneak;
    this.dead = !!dead;
    this.mode = mode ?? 'survival';
  }

  update(dt) {
    if (!this.target) return;
    const bx = this.position.x, bz = this.position.z;
    this.position.lerp(this.target, 1 - Math.exp(-dt * 12));
    const speed = Math.hypot(this.position.x - bx, this.position.z - bz) / Math.max(dt, 1e-3);
    if (speed > 0.2) this.anim += dt;
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw + Math.PI;
    this.model.parts.head.rotation.x = -this.pitch;
    this.model.parts.body.rotation.x = this.sneak ? 0.35 : 0;
    this.model.animate(this.anim, speed / 2);
    this.group.visible = !this.dead && this.mode !== 'spectator';
  }

  dispose() {
    this.scene.remove(this.group);
    this.tag.material.map.dispose();
  }
}

// ホスト側で、参加者をモブの標的などとして扱うための代理オブジェクト
function makeProxy(id, name, conn) {
  return {
    id, name, conn, remote: true,
    position: new THREE.Vector3(0, -100, 0),
    yaw: 0, pitch: 0, sneak: false, dead: false, mode: 'survival',
    width: 0.6, height: 1.8, lastHurt: 0,
    get ignoredByMobs() { return this.mode === 'creative' || this.mode === 'spectator'; },
    get spectator() { return this.mode === 'spectator'; },
    damage(amount, kb, source = false) {
      if (this.mode !== 'survival' && this.mode !== 'adventure') return false;
      const now = performance.now();
      if (now - this.lastHurt < 500) return false;
      this.lastHurt = now;
      if (conn.open) conn.send({ t: 'hurt', dmg: amount, kx: kb?.x ?? 0, kz: kb?.z ?? 0, src: source });
      return true;
    },
  };
}

export class Multiplayer {
  constructor(game) {
    this.game = game; // main.js が渡す窓口
    this.mode = 'off'; // 'off' | 'host' | 'client'
    this.peer = null;
    this.hostConn = null;
    this.connIds = new Map(); // conn -> player id (ホスト側)
    this.proxies = new Map(); // id -> 代理オブジェクト (ホスト側)
    this.views = new Map(); // id -> RemoteView
    this.pendingBlocks = [];
    this.pdata = {}; // 名前 -> 参加者の持ち物など (ホストが保存する)
    this.sleepers = new Map();
    this.timers = { pos: 0, mobs: 0, drops: 0, time: 0, pdata: 0 };
    this.lastDrops = '';
    this.statusText = '';
    this.onStatus = null;
    this.name = '';
    this.code = '';
  }

  get isHost() { return this.mode === 'host'; }
  get isClient() { return this.mode === 'client'; }
  get active() { return this.mode !== 'off'; }
  get playerCount() { return this.isHost ? this.proxies.size + 1 : this.isClient ? this.views.size + 1 : 1; }

  inviteUrl() {
    const u = new URL(location.href);
    u.search = '';
    u.searchParams.set('join', this.code);
    // テスト用のシグナリング設定は引き継ぐ
    const q = new URLSearchParams(location.search);
    for (const k of ['peerHost', 'peerPort', 'peerPath', 'peerSecure', 'peerIce']) if (q.get(k)) u.searchParams.set(k, q.get(k));
    return u.toString();
  }

  status(text) {
    this.statusText = text;
    this.onStatus?.(text);
  }

  // ============ ホスト ============
  host(name, retry = 0) {
    if (this.active || this.peer) return;
    this.name = cleanName(name) || 'ホスト';
    const code = randomCode();
    this.status('公開の準備中...');
    const peer = new Peer(PREFIX + code, peerOptions());
    this.peer = peer;
    peer.on('open', () => {
      if (this.peer !== peer) return;
      this.mode = 'host';
      this.code = code;
      this.nextId = 1;
      this.status(`公開中: ルームコード ${code}`);
      this.game.onNetChange();
      this.game.chatSys(`ルームコード ${code} でこの世界を公開しました`);
    });
    peer.on('connection', (conn) => { if (this.peer === peer && this.isHost) this.acceptClient(conn); });
    peer.on('disconnected', () => { if (this.peer === peer && !peer.destroyed) peer.reconnect(); });
    peer.on('error', (err) => {
      if (this.peer !== peer) return;
      if (err.type === 'unavailable-id' && retry < 3) {
        peer.destroy();
        this.peer = null;
        this.host(name, retry + 1);
        return;
      }
      // 公開中は、つながらなかった参加者などのエラーは無視する
      if (this.isHost) return;
      this.stop({ message: `公開できませんでした: ${errorText(err)}` });
    });
  }

  acceptClient(conn) {
    conn.on('data', (msg) => {
      try { this.onHostMessage(conn, msg); } catch (e) { console.error('multiplayer', e); }
    });
    conn.on('close', () => this.dropClient(conn));
    conn.on('error', () => this.dropClient(conn));
  }

  onHostMessage(conn, msg) {
    if (!this.isHost || !msg || typeof msg !== 'object') return;
    const g = this.game;
    const id = this.connIds.get(conn);
    const proxy = id !== undefined ? this.proxies.get(id) : null;
    if (!proxy && msg.t !== 'hello') return;
    switch (msg.t) {
      case 'hello': {
        if (proxy) return;
        const taken = new Set([this.name, ...[...this.proxies.values()].map((p) => p.name)]);
        const base = cleanName(msg.name) || 'プレイヤー';
        let name = base;
        for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
        const pid = this.nextId++;
        const p = makeProxy(pid, name, conn);
        this.proxies.set(pid, p);
        this.connIds.set(conn, pid);
        this.views.set(pid, new RemoteView(g.scene, name));
        conn.send({
          t: 'welcome', id: pid, name, code: this.code,
          seed: g.world.seed, edits: g.world.serializeEdits(), timeOfDay: g.timeOfDay,
          difficulty: g.player.difficulty, spawn: g.world.findSpawn(),
          pdata: this.pdata[name] ?? null, players: this.playerList(),
        });
        this.broadcast({ t: 'sys', text: `${name} が参加しました` }, conn);
        g.chatSys(`${name} が参加しました`);
        this.status(`公開中: ルームコード ${this.code}（${this.playerCount} 人）`);
        g.onNetChange();
        break;
      }
      case 'pos': {
        if (![msg.x, msg.y, msg.z, msg.yaw, msg.pitch].every(Number.isFinite)) return;
        proxy.position.set(msg.x, msg.y, msg.z);
        proxy.yaw = msg.yaw; proxy.pitch = msg.pitch; proxy.sneak = msg.sneak; proxy.dead = msg.dead; proxy.mode = msg.mode;
        this.views.get(id)?.setState(msg.x, msg.y, msg.z, msg.yaw, msg.pitch, msg.sneak, msg.dead, msg.mode);
        break;
      }
      case 'blocks':
        g.applyRemoteBlocks(msg.list);
        this.broadcast({ t: 'blocks', list: msg.list }, conn);
        break;
      case 'hitMob': {
        const mob = g.mobs.mobs.find((m) => m.id === msg.id);
        if (mob) mob.damage(Math.min(20, Number(msg.dmg) || 1), new THREE.Vector3(msg.fx, 0, msg.fz));
        break;
      }
      case 'hitPlayer':
        this.hitPlayer(msg.id, msg.dmg, { x: msg.kx, z: msg.kz });
        break;
      case 'spawnDrop':
        g.drops.spawn(msg.id, msg.count, msg.x, msg.y, msg.z, new THREE.Vector3(msg.vx, msg.vy, msg.vz), msg.damage ?? 0);
        break;
      case 'shoot':
        this.arrowFrom = conn;
        g.mobs.addArrow(new THREE.Vector3(msg.x, msg.y, msg.z), new THREE.Vector3(msg.vx, msg.vy, msg.vz), 'player', Math.min(10, Number(msg.dmg) || 1), !!msg.pickup);
        this.arrowFrom = null;
        break;
      case 'ignite':
        g.igniteTnt(msg.x, msg.y, msg.z);
        break;
      case 'getContainer':
        conn.send({ t: 'container', key: msg.key, slots: serializeSlots(g.getContainer(msg.key)) });
        break;
      case 'container':
        g.setContainer(msg.key, loadSlots(msg.slots, CONTAINER_SIZE));
        this.broadcast({ t: 'container', key: msg.key, slots: msg.slots }, conn);
        break;
      case 'sleep':
        this.sleepers.set(id, performance.now());
        this.checkSleep();
        break;
      case 'pdata':
        this.pdata[proxy.name] = msg.data;
        break;
      case 'chat': {
        const text = cleanText(msg.text);
        if (!text) return;
        this.broadcast({ t: 'chat', name: proxy.name, text }, conn);
        g.chat(proxy.name, text);
        break;
      }
    }
  }

  dropClient(conn) {
    const id = this.connIds.get(conn);
    if (id === undefined) return;
    this.connIds.delete(conn);
    const p = this.proxies.get(id);
    this.proxies.delete(id);
    this.views.get(id)?.dispose();
    this.views.delete(id);
    if (p) {
      this.broadcast({ t: 'sys', text: `${p.name} が退出しました` });
      this.game.chatSys(`${p.name} が退出しました`);
    }
    if (this.isHost) this.status(`公開中: ルームコード ${this.code}（${this.playerCount} 人）`);
    this.game.onNetChange();
  }

  playerList() {
    const g = this.game;
    const me = g.player;
    const list = [[0, this.name, +me.position.x.toFixed(2), +me.position.y.toFixed(2), +me.position.z.toFixed(2), +me.yaw.toFixed(2), +me.pitch.toFixed(2), me.sneaking ? 1 : 0, me.dead ? 1 : 0, me.gameMode]];
    for (const p of this.proxies.values()) {
      list.push([p.id, p.name, +p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2), +p.yaw.toFixed(2), +p.pitch.toFixed(2), p.sneak ? 1 : 0, p.dead ? 1 : 0, p.mode]);
    }
    return list;
  }

  // モブの標的・爆発の対象になる全プレイヤー
  targets() {
    return [this.game.player, ...(this.isHost ? this.proxies.values() : [])];
  }

  broadcast(msg, except = null) {
    for (const conn of this.connIds.keys()) if (conn !== except && conn.open) conn.send(msg);
  }

  // すべてのプレイヤーが眠ったら朝にする
  checkSleep() {
    const now = performance.now();
    const ids = [0, ...[...this.proxies.values()].filter((p) => !p.dead && p.mode !== 'spectator').map((p) => p.id)];
    const asleep = ids.filter((i) => now - (this.sleepers.get(i) ?? -1e9) < 6000).length;
    if (asleep >= ids.length) {
      this.sleepers.clear();
      this.game.skipNight();
      this.broadcast({ t: 'time', time: this.game.timeOfDay, difficulty: this.game.player.difficulty });
      this.broadcast({ t: 'sys', text: '朝になりました' });
    } else {
      const text = `${asleep} / ${ids.length} 人が眠っています`;
      this.broadcast({ t: 'sys', text });
      this.game.chatSys(text);
    }
  }

  // ============ 参加者 ============
  join(code, name) {
    if (this.active || this.peer) return;
    code = String(code ?? '').trim().toUpperCase();
    if (!code) { this.status('ルームコードを入力してください'); return; }
    this.name = cleanName(name) || 'プレイヤー';
    this.status('接続中...');
    const peer = new Peer(undefined, peerOptions());
    this.peer = peer;
    const giveUp = setTimeout(() => {
      if (this.peer === peer && !this.isClient) this.stop({ message: 'ホストに接続できませんでした。ルームコードとネットワークを確認してください' });
    }, 20000);
    peer.on('open', () => {
      if (this.peer !== peer) return;
      const conn = peer.connect(PREFIX + code, { reliable: true });
      this.hostConn = conn;
      conn.on('open', () => conn.send({ t: 'hello', name: this.name }));
      conn.on('data', (msg) => {
        if (this.hostConn !== conn || !msg || typeof msg !== 'object') return;
        if (msg.t === 'welcome') clearTimeout(giveUp);
        try { this.onClientMessage(msg); } catch (e) { console.error('multiplayer', e); }
      });
      conn.on('close', () => { if (this.hostConn === conn) this.hostLost(); });
      conn.on('error', () => { if (this.hostConn === conn) this.hostLost(); });
    });
    peer.on('disconnected', () => { if (this.peer === peer && !peer.destroyed) peer.reconnect(); });
    peer.on('error', (err) => {
      if (this.peer !== peer) return;
      // 参加後はシグナリングサーバーの一時的なエラーは無視する (データは直接届く)
      if (this.isClient) return;
      clearTimeout(giveUp);
      this.stop({ message: `接続できませんでした: ${errorText(err)}` });
    });
  }

  onClientMessage(msg) {
    const g = this.game;
    switch (msg.t) {
      case 'welcome':
        this.mode = 'client';
        this.myId = msg.id;
        this.name = msg.name;
        this.code = msg.code;
        g.enterClientWorld(msg);
        this.syncPlayers(msg.players);
        this.status(`参加中: ルームコード ${msg.code}`);
        g.chatSys(`${msg.name} としてワールドに参加しました`);
        g.onNetChange();
        break;
      case 'blocks': g.applyRemoteBlocks(msg.list); break;
      case 'players': this.syncPlayers(msg.list); break;
      case 'mobs': g.mobs.applySnapshot(msg.list); break;
      case 'drops': g.drops.applySnapshot(msg.list); break;
      case 'time':
        if (Math.abs(g.timeOfDay - msg.time) > 0.003) g.timeOfDay = msg.time;
        g.setDifficultyFromHost(msg.difficulty);
        break;
      case 'hurt':
        if (g.player.damage(msg.dmg, { x: msg.kx, z: msg.kz }, msg.src)) g.hud.flashDamage();
        break;
      case 'give': {
        const rest = g.inventory.add(msg.id, msg.count, msg.damage ?? 0);
        if (rest > 0) g.drops.spawn(msg.id, rest, g.player.position.x, g.player.position.y + 1, g.player.position.z);
        g.refreshInventory();
        break;
      }
      case 'container': g.onContainerData(msg.key, loadSlots(msg.slots, CONTAINER_SIZE)); break;
      case 'tnt': g.igniteTnt(msg.x, msg.y, msg.z, msg.fuse, true); break;
      case 'arrowFx': g.mobs.addArrow(new THREE.Vector3(msg.x, msg.y, msg.z), new THREE.Vector3(msg.vx, msg.vy, msg.vz), 'visual', 0); break;
      case 'chat': g.chat(msg.name, msg.text); break;
      case 'sys': g.chatSys(msg.text); break;
    }
  }

  syncPlayers(list) {
    if (!Array.isArray(list)) return;
    const seen = new Set();
    let changed = false;
    for (const [id, name, x, y, z, yaw, pitch, sneak, dead, mode] of list) {
      if (id === this.myId) continue;
      seen.add(id);
      let v = this.views.get(id);
      if (!v) { v = new RemoteView(this.game.scene, cleanName(name)); this.views.set(id, v); changed = true; }
      v.setState(x, y, z, yaw, pitch, sneak, dead, mode);
    }
    for (const [id, v] of this.views) if (!seen.has(id)) { v.dispose(); this.views.delete(id); changed = true; }
    if (changed) this.game.onNetChange();
  }

  sendHost(msg) {
    if (this.hostConn?.open) this.hostConn.send(msg);
  }

  hostLost() {
    if (!this.isClient) return;
    this.stop({ message: 'ホストとの接続が切れました' });
    this.game.chatSys('ホストとの接続が切れました');
    this.game.leaveClientWorld();
  }

  // ============ 共通 ============
  // graceful: 最後に送ったデータが届くよう、少し待ってから切断する
  stop({ graceful = false, message = '' } = {}) {
    const peer = this.peer, hostConn = this.hostConn, conns = [...this.connIds.keys()];
    this.peer = null;
    this.hostConn = null;
    this.connIds.clear();
    this.proxies.clear();
    this.sleepers.clear();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.mode = 'off';
    this.pendingBlocks = [];
    this.status(message);
    this.game.onNetChange();
    const close = () => {
      for (const c of conns) c.close();
      hostConn?.close();
      peer?.destroy();
    };
    if (graceful) setTimeout(close, 300);
    else close();
  }

  leave() {
    if (this.isClient) {
      this.sendPdata();
      this.stop({ graceful: true });
      this.game.leaveClientWorld();
    } else if (this.isHost) {
      this.broadcast({ t: 'sys', text: 'ホストが公開を終了しました' });
      this.stop({ graceful: true });
      this.game.chatSys('公開を終了しました');
    } else {
      this.stop();
    }
  }

  sendPdata() {
    if (!this.isClient) return;
    this.sendHost({ t: 'pdata', data: this.game.playerData() });
  }

  blockChanged(x, y, z, id, meta) {
    if (this.active) this.pendingBlocks.push([x, y, z, id, meta]);
  }

  chatSend(text) {
    text = cleanText(text);
    if (!text) return;
    this.game.chat(this.name || 'あなた', text);
    if (this.isHost) this.broadcast({ t: 'chat', name: this.name, text });
    else if (this.isClient) this.sendHost({ t: 'chat', text });
  }

  // 攻撃: 視線の先にいる他のプレイヤー
  raycastPlayers(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const [id, v] of this.views) {
      if (v.dead || v.mode === 'spectator') continue;
      const t = rayAABB(origin, dir, v);
      if (t < bestT) { bestT = t; best = id; }
    }
    return best === null ? null : { id: best, distance: bestT };
  }

  hitPlayer(id, dmg, kb) {
    dmg = Math.min(20, Number(dmg) || 1);
    if (this.isClient) { this.sendHost({ t: 'hitPlayer', id, dmg, kx: kb.x, kz: kb.z }); return; }
    if (id === 0) { if (this.game.player.damage(dmg, kb, 'pvp')) this.game.hud.flashDamage(); return; }
    this.proxies.get(id)?.damage(dmg, kb, 'pvp');
  }

  requestSleep() {
    if (this.isClient) this.sendHost({ t: 'sleep' });
    else { this.sleepers.set(0, performance.now()); this.checkSleep(); }
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;
    const T = this.timers;
    if (this.pendingBlocks.length) {
      const list = this.pendingBlocks;
      this.pendingBlocks = [];
      if (this.isHost) this.broadcast({ t: 'blocks', list });
      else this.sendHost({ t: 'blocks', list });
    }
    T.pos += dt;
    if (T.pos >= 0.1) {
      T.pos = 0;
      if (this.isHost) this.broadcast({ t: 'players', list: this.playerList() });
      else {
        const p = g.player;
        this.sendHost({ t: 'pos', x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2), z: +p.position.z.toFixed(2), yaw: +p.yaw.toFixed(2), pitch: +p.pitch.toFixed(2), sneak: p.sneaking, dead: p.dead, mode: p.gameMode });
      }
    }
    if (this.isHost && this.proxies.size) {
      T.mobs += dt;
      if (T.mobs >= 0.125) { T.mobs = 0; this.broadcast({ t: 'mobs', list: g.mobs.snapshot() }); }
      T.drops += dt;
      if (T.drops >= 0.2) {
        T.drops = 0;
        const list = g.drops.snapshot();
        const key = JSON.stringify(list);
        if (key !== this.lastDrops) { this.lastDrops = key; this.broadcast({ t: 'drops', list }); }
      }
      T.time += dt;
      if (T.time >= 2) { T.time = 0; this.broadcast({ t: 'time', time: g.timeOfDay, difficulty: g.player.difficulty }); }
      for (const p of this.proxies.values()) {
        g.drops.pickupFor(p, (id, count, damage) => { if (p.conn.open) p.conn.send({ t: 'give', id, count, damage }); });
      }
    }
    if (this.isClient) {
      T.pdata += dt;
      if (T.pdata >= 10) { T.pdata = 0; this.sendPdata(); }
    }
    for (const v of this.views.values()) v.update(dt);
  }

  // 火のついた TNT を参加者に見せる
  tntPrimed(x, y, z, fuse) {
    if (this.isHost) this.broadcast({ t: 'tnt', x, y, z, fuse });
  }

  // ホストの矢を参加者に見せる
  arrowFired(from, velocity) {
    if (!this.isHost) return;
    const msg = { t: 'arrowFx', x: from.x, y: from.y, z: from.z, vx: velocity.x, vy: velocity.y, vz: velocity.z };
    this.broadcast(msg, this.arrowFrom);
  }
}
