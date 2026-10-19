// ゲーム本体（物理・同期・描画・UI）
(() => {
  'use strict';

  const qs = new URLSearchParams(location.search);
  const CFG = {
    sendHz: Math.min(30, Math.max(2, Number(qs.get('hz')) || 10)), // 走行中の送信頻度
    idleSendMs: 2000, // 停車中の生存通知の間隔
    timeoutMs: 7000, // これだけ音沙汰がないプレイヤーは退出扱い
    countdownMs: 3500,
    finishWaitMs: 30000, // 1位のゴール後、この時間で打ち切り
  };
  const PHYS = {
    accel: 520, brake: 950, coast: 120, drag: 0.32, reverseMax: 170,
    maxSpeed: 620, grassMax: 240, boostSpeed: 950, boostTime: 1.0,
    steer: 2.7, grip: 7.5, driftGrip: 1.6,
  };
  const COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#fb8c00', '#00acc1', '#ec407a', '#8d6e63', '#eceff1'];
  const L = Track.length;
  const $ = id => document.getElementById(id);

  // ---------- キャンバス ----------
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  let vw = 0, vh = 0, dpr = 1;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = window.innerWidth;
    vh = window.innerHeight;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- 状態 ----------
  const me = {
    pid: null, name: '', avatarUrl: '',
    x: 0, y: 0, a: 0, vx: 0, vy: 0,
    sPrev: 0, total: 0, boost: 0,
    finished: false, spectating: false, offTrack: false,
  };
  const others = new Map(); // pid -> リモートプレイヤー
  let phase = 'lobby'; // lobby | countdown | race | results
  let race = null; // { id, laps, entrants[], goAt, startAt, finishes: Map, firstFinishAt }
  let lapsSetting = 3;
  // mode: north = 北が常に上 / chase = 車の向きに合わせて画面を回転
  const cam = { x: 0, y: 0, zoom: 0.8, rot: 0, cy: null, mode: 'north' };
  try {
    if (localStorage.getItem('ovice-race:cam') === 'chase') cam.mode = 'chase';
  } catch (e) {}

  const hash = s => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  };
  function colorOf(pid) {
    if (!pid) return COLORS[0];
    if (race) {
      const i = race.entrants.indexOf(pid);
      if (i >= 0) return COLORS[i % COLORS.length];
    }
    return COLORS[hash(pid) % COLORS.length];
  }
  const nameOf = pid =>
    pid === me.pid ? me.name : (others.get(pid) || {}).name || (race && race.names[pid]) || '???';
  const now = () => performance.now();
  const fmtTime = ms => {
    if (ms == null || !isFinite(ms)) return '--:--.--';
    const t = Math.max(0, ms) / 1000;
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const avatarCache = new Map();
  function avatar(url) {
    if (!url) return null;
    let img = avatarCache.get(url);
    if (!img) {
      img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.src = url;
      avatarCache.set(url, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  // ---------- サウンド ----------
  let audio = null;
  let soundOn = true;
  function ensureAudio() {
    if (!audio) {
      try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    }
    if (audio.state === 'suspended') audio.resume();
  }
  function beep(freq, dur = 0.15, vol = 0.06, type = 'square') {
    if (!soundOn || !audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + dur);
  }

  // ---------- 入力 ----------
  const keys = new Set();
  const touch = {};
  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Space: 'drift',
  };
  window.addEventListener('keydown', e => {
    const k = KEYMAP[e.code];
    if (k) { keys.add(k); e.preventDefault(); }
    ensureAudio();
  });
  window.addEventListener('keyup', e => {
    const k = KEYMAP[e.code];
    if (k) { keys.delete(k); e.preventDefault(); }
  });
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('pointerdown', ensureAudio);
  document.querySelectorAll('#touch [data-k]').forEach(el => {
    const k = el.dataset.k;
    const on = e => { touch[k] = true; el.classList.add('on'); e.preventDefault(); };
    const off = () => { touch[k] = false; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => el.addEventListener(t, off));
  });
  if (window.matchMedia('(pointer: coarse)').matches || qs.get('touch') === '1') {
    document.body.classList.add('touch');
  }
  function readInput() {
    const has = k => keys.has(k) || !!touch[k];
    return { steer: (has('right') ? 1 : 0) - (has('left') ? 1 : 0), up: has('up'), down: has('down'), drift: has('drift') };
  }
  const NO_INPUT = { steer: 0, up: false, down: false, drift: false };

  // ---------- 自車 ----------
  function placeOnGrid(slot) {
    const row = Math.floor(slot / 2), side = slot % 2 === 0 ? -1 : 1;
    const s = -70 - row * 80;
    const p = Track.pointAt(s);
    me.x = p.x + -p.ty * side * 45;
    me.y = p.y + p.tx * side * 45;
    me.a = Math.atan2(p.ty, p.tx);
    me.vx = me.vy = 0;
    me.total = s;
    me.sPrev = Track.wrap(s);
    me.boost = 0;
    me.finished = false;
  }

  function stepCar(dt, input) {
    const speed0 = me.vx * Math.cos(me.a) + me.vy * Math.sin(me.a);
    // 速度に応じてハンドルを切る（低速では曲がりにくく、高速ではやや鈍く）
    const steerFactor = Math.max(-1, Math.min(1, speed0 / 160)) * (1 - Math.min(0.35, (Math.abs(speed0) / PHYS.boostSpeed) * 0.35));
    me.a += input.steer * PHYS.steer * steerFactor * (input.drift ? 1.25 : 1) * dt;

    const fx = Math.cos(me.a), fy = Math.sin(me.a);
    let fv = me.vx * fx + me.vy * fy; // 前後方向の速度
    let lv = -me.vx * fy + me.vy * fx; // 横滑り速度

    const n0 = Track.nearest(me.x, me.y);
    me.offTrack = n0.dist > Track.width / 2 + 6;
    const boosting = me.boost > 0;
    const maxV = boosting ? PHYS.boostSpeed : me.offTrack ? PHYS.grassMax : PHYS.maxSpeed;

    if (input.up) fv += PHYS.accel * (boosting ? 1.8 : 1) * dt;
    if (input.down) fv -= (fv > 0 ? PHYS.brake : PHYS.accel * 0.6) * dt;
    if (!input.up && !input.down) fv -= Math.sign(fv) * Math.min(Math.abs(fv), PHYS.coast * dt);
    if (input.drift) fv -= fv * 0.5 * dt;
    fv -= fv * PHYS.drag * dt;
    if (me.offTrack) fv -= fv * 1.6 * dt;
    if (fv > maxV) fv = Math.max(maxV, fv - 1100 * dt);
    if (fv < -PHYS.reverseMax) fv = -PHYS.reverseMax;

    const grip = input.drift ? PHYS.driftGrip : me.offTrack ? 4 : PHYS.grip;
    lv *= Math.exp(-grip * dt);

    me.vx = fx * fv - fy * lv;
    me.vy = fy * fv + fx * lv;
    me.x += me.vx * dt;
    me.y += me.vy * dt;

    // 外壁
    const n = Track.nearest(me.x, me.y);
    const limit = Track.width / 2 + Track.margin;
    if (n.dist > limit) {
      const nx = (me.x - n.px) / n.dist, ny = (me.y - n.py) / n.dist;
      me.x = n.px + nx * limit;
      me.y = n.py + ny * limit;
      const vn = me.vx * nx + me.vy * ny;
      if (vn > 0) { me.vx -= nx * vn * 1.4; me.vy -= ny * vn * 1.4; }
      me.vx *= 0.85; me.vy *= 0.85;
    }

    // ダッシュパネル
    if (me.boost > 0) me.boost -= dt;
    for (const b of Track.boosts) {
      let ds = n.s - b.s;
      if (ds > L / 2) ds -= L;
      if (ds < -L / 2) ds += L;
      if (Math.abs(ds) < b.len / 2 && Math.abs(n.lat - b.lat) < b.w / 2) {
        if (me.boost <= 0) beep(660, 0.25, 0.04, 'sawtooth');
        me.boost = PHYS.boostTime;
      }
    }
    return n;
  }

  // 周回距離の積算（大きく飛んだ場合はショートカットとみなして加算しない）
  function trackProgress(n) {
    let d = n.s - me.sPrev;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    if (Math.abs(d) < 150) me.total += d;
    me.sPrev = n.s;
  }

  // ---------- レース進行 ----------
  const activeOthers = () => [...others.values()].filter(p => now() - p.lastSeen < CFG.timeoutMs);
  const someoneRacing = () => activeOthers().some(p => p.phase === 'countdown' || p.phase === 'race');

  function requestStart() {
    if (!me.pid || (phase !== 'lobby' && phase !== 'results') || someoneRacing()) return;
    const entrants = [me.pid, ...activeOthers().filter(p => p.phase === 'lobby' || p.phase === 'results').map(p => p.pid)].sort();
    const names = {};
    entrants.forEach(pid => (names[pid] = nameOf(pid)));
    const msg = { rid: Date.now().toString(36) + '-' + me.pid, laps: lapsSetting, entrants, names };
    Net.send('start', msg);
    beginRace(msg);
  }

  function beginRace(msg) {
    race = {
      id: msg.rid, laps: msg.laps, entrants: msg.entrants, names: msg.names || {},
      goAt: now() + CFG.countdownMs, startAt: null,
      finishes: new Map(), firstFinishAt: null, lastBeep: null,
    };
    phase = 'countdown';
    const slot = race.entrants.indexOf(me.pid);
    me.spectating = slot < 0;
    if (!me.spectating) placeOnGrid(slot);
    lastSend = 0;
    showPanels();
  }

  function myFinish() {
    me.finished = true;
    const t = now() - race.startAt;
    recordFinish(me.pid, t);
    Net.send('finish', { rid: race.id, t });
    beep(988, 0.12); setTimeout(() => beep(1318, 0.3), 130);
  }

  function recordFinish(pid, t) {
    if (race.finishes.has(pid)) return;
    race.finishes.set(pid, t);
    if (race.firstFinishAt == null) race.firstFinishAt = now();
  }

  function standings() {
    if (!race) return [];
    return race.entrants
      .map(pid => {
        const p = pid === me.pid ? me : others.get(pid);
        return { pid, name: nameOf(pid), total: p ? p.total : -Infinity, time: race.finishes.get(pid), gone: pid !== me.pid && !p };
      })
      .sort((a, b) => {
        if (a.time != null && b.time != null) return a.time - b.time;
        if (a.time != null) return -1;
        if (b.time != null) return 1;
        return b.total - a.total;
      });
  }

  function checkRaceEnd() {
    const present = race.entrants.filter(pid => pid === me.pid || others.has(pid));
    const allDone = present.every(pid => race.finishes.has(pid));
    const timeUp = race.firstFinishAt != null && now() - race.firstFinishAt > CFG.finishWaitMs;
    if (allDone || timeUp) {
      phase = 'results';
      lastSend = 0;
      renderResults();
      showPanels();
    }
  }

  // ---------- 通信 ----------
  let lastSend = 0;
  let lastForcedHello = 0;
  function stateMsg() {
    return {
      n: me.name, av: me.avatarUrl,
      x: Math.round(me.x), y: Math.round(me.y), a: Math.round(me.a * 1000) / 1000,
      vx: Math.round(me.vx), vy: Math.round(me.vy),
      t: Math.round(me.total), f: me.finished ? 1 : 0, b: me.boost > 0 ? 1 : 0,
      ph: phase, rid: race ? race.id : null, sp: me.spectating ? 1 : 0,
      ft: race && race.finishes.has(me.pid) ? Math.round(race.finishes.get(me.pid)) : null,
    };
  }
  function maybeSend(t) {
    if (!me.pid) return;
    const moving = Math.hypot(me.vx, me.vy) > 3;
    const active = (phase === 'countdown' || phase === 'race') && !me.spectating;
    const interval = active || moving ? 1000 / CFG.sendHz : CFG.idleSendMs;
    if (t - lastSend < interval) return;
    lastSend = t;
    Net.send('st', stateMsg());
  }

  Net.on('message', ({ event, data }) => {
    const pid = data.pid;
    if (!pid || pid === me.pid) return;
    const t = now();
    if (event === 'st') {
      let p = others.get(pid);
      if (!p) {
        p = { pid, rx: data.x, ry: data.y, ra: data.a };
        others.set(pid, p);
        // 新しい参加者にすぐ自分の存在を知らせる
        if (t - lastForcedHello > 500) { lastForcedHello = t; lastSend = 0; }
      }
      Object.assign(p, {
        name: data.n || '???', avatarUrl: data.av || '',
        x: data.x, y: data.y, a: data.a, vx: data.vx || 0, vy: data.vy || 0,
        total: data.t, finished: !!data.f, boost: !!data.b,
        phase: data.ph, rid: data.rid, spectating: !!data.sp,
        recv: t, lastSeen: t,
      });
      if (race && data.rid === race.id && data.f && !race.finishes.has(pid) && data.ft != null) recordFinish(pid, data.ft);
    } else if (event === 'start') {
      const canJoin = phase === 'lobby' || phase === 'results';
      // ほぼ同時に 2 人がスタートを押したら、ID の小さいほうに揃える
      const override = phase === 'countdown' && race && data.rid < race.id;
      if (canJoin || override) beginRace(data);
    } else if (event === 'finish') {
      if (race && data.rid === race.id) recordFinish(pid, data.t);
    } else if (event === 'bye') {
      others.delete(pid);
    }
  });

  window.addEventListener('pagehide', () => Net.send('bye'));

  // ---------- 更新 ----------
  function update(dt, t) {
    if (phase === 'countdown' && t >= race.goAt) {
      phase = 'race';
      race.startAt = race.goAt;
      beep(880, 0.4, 0.07);
      showPanels();
    }
    if (phase === 'countdown') {
      const left = Math.ceil((race.goAt - t) / 1000);
      if (left <= 3 && left !== race.lastBeep) { race.lastBeep = left; beep(440, 0.15); }
    }

    if (!me.spectating && me.pid) {
      const canDrive = phase === 'lobby' || phase === 'results' || (phase === 'race' && !me.finished);
      const n = stepCar(dt, canDrive ? readInput() : NO_INPUT);
      trackProgress(n);
      if (phase === 'race' && !me.finished && me.total >= race.laps * L) myFinish();
    }
    if (phase === 'race') checkRaceEnd();

    // リモート車両：受信値から少し先を予測しつつ滑らかに追従
    const k = 1 - Math.exp(-dt * 14);
    for (const [pid, p] of others) {
      if (t - p.lastSeen > CFG.timeoutMs) { others.delete(pid); continue; }
      const age = Math.min(0.25, (t - p.recv) / 1000);
      const ex = p.x + p.vx * age, ey = p.y + p.vy * age;
      if (Math.hypot(ex - p.rx, ey - p.ry) > 300) { p.rx = ex; p.ry = ey; p.ra = p.a; }
      p.rx += (ex - p.rx) * k;
      p.ry += (ey - p.ry) * k;
      let da = p.a - p.ra;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      p.ra += da * k;
    }

    maybeSend(t);

    // カメラ
    let target = me;
    if (me.spectating && race) {
      const lead = standings().map(s => others.get(s.pid)).find(Boolean);
      if (lead) target = { x: lead.rx, y: lead.ry, a: lead.ra, vx: lead.vx, vy: lead.vy };
    }
    // 追従視点では車の進行方向が画面の上を向くように回転させる
    const wantRot = cam.mode === 'chase' ? -Math.PI / 2 - target.a : 0;
    let dr = wantRot - cam.rot;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    cam.rot += dr * (1 - Math.exp(-dt * 6));
    const ck = 1 - Math.exp(-dt * 8);
    cam.x += (target.x - cam.x) * ck;
    cam.y += (target.y - cam.y) * ck;
    const spd = Math.hypot(target.vx || 0, target.vy || 0);
    const baseZoom = Math.max(0.35, Math.min(1.0, Math.min(vw, vh) / 860));
    const wantZoom = baseZoom * (1 - Math.min(0.22, (spd / PHYS.boostSpeed) * 0.22));
    cam.zoom += (wantZoom - cam.zoom) * (1 - Math.exp(-dt * 2));
  }

  // ---------- 描画 ----------
  const trackPath = new Path2D();
  Track.pts.forEach((p, i) => (i ? trackPath.lineTo(p.x, p.y) : trackPath.moveTo(p.x, p.y)));
  trackPath.closePath();

  function drawTrack(t) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const W = Track.width, M = Track.margin;
    ctx.setLineDash([]);
    ctx.strokeStyle = '#d7ccc8'; // 外壁
    ctx.lineWidth = W + M * 2 + 24;
    ctx.stroke(trackPath);
    ctx.strokeStyle = '#6aa84f'; // ランオフの芝
    ctx.lineWidth = W + M * 2;
    ctx.stroke(trackPath);
    ctx.strokeStyle = '#f5f5f5'; // 縁石
    ctx.lineWidth = W + 26;
    ctx.stroke(trackPath);
    ctx.strokeStyle = '#e53935';
    ctx.setLineDash([28, 28]);
    ctx.stroke(trackPath);
    ctx.setLineDash([]);
    ctx.strokeStyle = '#4b4f57'; // 舗装
    ctx.lineWidth = W;
    ctx.stroke(trackPath);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; // センターライン
    ctx.lineWidth = 4;
    ctx.setLineDash([40, 40]);
    ctx.stroke(trackPath);
    ctx.setLineDash([]);

    // スタート/フィニッシュライン
    const s0 = Track.pointAt(0);
    ctx.save();
    ctx.translate(s0.x, s0.y);
    ctx.rotate(Math.atan2(s0.ty, s0.tx));
    const sq = 20;
    for (let i = 0; i < W / sq; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#fff' : '#111';
        ctx.fillRect(j * sq - sq, -W / 2 + i * sq, sq, sq);
      }
    }
    ctx.restore();

    // ダッシュパネル
    const pulse = 0.65 + 0.35 * Math.sin(t / 150);
    for (const b of Track.boosts) {
      const p = Track.pointAt(b.s);
      ctx.save();
      ctx.translate(p.x + -p.ty * b.lat, p.y + p.tx * b.lat);
      ctx.rotate(Math.atan2(p.ty, p.tx));
      ctx.fillStyle = '#ff6f00';
      roundRect(-b.len / 2, -b.w / 2, b.len, b.w, 10);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,235,59,${pulse})`;
      ctx.lineWidth = 7;
      for (let c = -1; c <= 1; c++) {
        ctx.beginPath();
        ctx.moveTo(c * 22 - 8, -20);
        ctx.lineTo(c * 22 + 8, 0);
        ctx.lineTo(c * 22 - 8, 20);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawTrees(view) {
    for (const tr of Track.trees) {
      if (tr.x + tr.r < view.x0 || tr.x - tr.r > view.x1 || tr.y + tr.r < view.y0 || tr.y - tr.r > view.y1) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.arc(tr.x + 6, tr.y + 8, tr.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2e7d32';
      ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#43a047';
      ctx.beginPath(); ctx.arc(tr.x - tr.r * 0.25, tr.y - tr.r * 0.25, tr.r * 0.55, 0, Math.PI * 2); ctx.fill();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCar(c) {
    ctx.save();
    ctx.globalAlpha = c.alpha;
    ctx.translate(c.x, c.y);
    ctx.rotate(c.a);
    if (c.boost) {
      ctx.fillStyle = Math.random() < 0.5 ? '#ffca28' : '#ff7043';
      ctx.beginPath();
      ctx.moveTo(-22, -7); ctx.lineTo(-40 - Math.random() * 14, 0); ctx.lineTo(-22, 7);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(-19, -8, 44, 24, 7); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(-17, -15, 11, 30);
    ctx.fillRect(8, -15, 11, 30);
    ctx.fillStyle = c.color;
    roundRect(-22, -12, 44, 24, 7); ctx.fill();
    ctx.fillStyle = 'rgba(20,30,40,0.85)';
    roundRect(5, -9, 8, 18, 3); ctx.fill();
    const img = avatar(c.avatarUrl);
    if (!img) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(-16, -2, 16, 4);
    }
    ctx.restore();
    if (img) {
      // oVice のアバターを屋根に（画面に対して常に正立）
      ctx.save();
      ctx.globalAlpha = c.alpha;
      ctx.translate(c.x - Math.cos(c.a) * 7, c.y - Math.sin(c.a) * 7);
      ctx.rotate(-cam.rot);
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(img, -9, -9, 18, 18);
      ctx.restore();
    }

    // 名前
    const z = cam.zoom;
    ctx.save();
    ctx.globalAlpha = c.alpha;
    ctx.font = `bold ${13 / z}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3.5 / z;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.fillStyle = c.isMe ? '#ffeb3b' : '#fff';
    ctx.translate(c.x, c.y);
    ctx.rotate(-cam.rot); // 名前は画面に対して常に水平
    const ly = -26 - 10 / z;
    ctx.strokeText(c.name, 0, ly);
    ctx.fillText(c.name, 0, ly);
    ctx.restore();
  }

  function drawMinimap() {
    const b = Track.bounds;
    const size = Math.min(150, Math.max(90, Math.min(vw, vh) * 0.22));
    const s = size / Math.max(b.maxX - b.minX, b.maxY - b.minY);
    const w = (b.maxX - b.minX) * s, h = (b.maxY - b.minY) * s;
    const ox = vw - w - 10, oy = 10;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ox - 4, oy - 4, w + 8, h + 8, 8); ctx.fill();
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    ctx.translate(-b.minX, -b.minY);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = Track.width * 0.55;
    ctx.lineJoin = 'round';
    ctx.stroke(trackPath);
    ctx.restore();
    const dot = (x, y, color, r) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(ox + (x - b.minX) * s, oy + (y - b.minY) * s, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
    };
    for (const p of others.values()) if (!p.spectating) dot(p.rx, p.ry, colorOf(p.pid), 3.5);
    if (!me.spectating && me.pid) dot(me.x, me.y, colorOf(me.pid), 5);
  }

  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#3d6b2a';
    ctx.fillRect(0, 0, vw, vh);

    const z = cam.zoom;
    // パネル表示中は、パネルに隠れない上側の領域の中央に自車を映す
    const panel = phase === 'lobby' ? ui.lobby : phase === 'results' ? ui.results : null;
    const cover = panel ? Math.min(vh * 0.6, panel.offsetHeight + 30) : 0;
    // 追従視点では前方が広く見えるよう自車を画面の下寄りに置く
    const targetCy = (vh - cover) * (cam.mode === 'chase' ? 0.66 : 0.5);
    cam.cy = cam.cy == null ? targetCy : cam.cy + (targetCy - cam.cy) * 0.1;
    const cy = cam.cy;
    ctx.translate(vw / 2, cy);
    ctx.rotate(cam.rot);
    ctx.scale(z, z);
    ctx.translate(-cam.x, -cam.y);
    const r = Math.hypot(vw, vh) / z; // 回転しても画面を覆う範囲
    const view = { x0: cam.x - r, x1: cam.x + r, y0: cam.y - r, y1: cam.y + r };
    drawTrack(t);
    drawTrees(view);

    const racing = race && (phase === 'countdown' || phase === 'race');
    for (const p of others.values()) {
      if (p.spectating && p.rid === (race && race.id)) continue;
      // レースに参加していない人の車は半透明（ぶつからないので練習走行の邪魔にならない）
      const inRace = racing && race.entrants.includes(p.pid);
      const alpha = racing && !inRace ? 0.35 : 1;
      drawCar({ x: p.rx, y: p.ry, a: p.ra, color: colorOf(p.pid), name: p.name, avatarUrl: p.avatarUrl, boost: p.boost, alpha, isMe: false });
    }
    if (!me.spectating && me.pid) {
      drawCar({ x: me.x, y: me.y, a: me.a, color: colorOf(me.pid), name: me.name, avatarUrl: me.avatarUrl, boost: me.boost > 0, alpha: 1, isMe: true });
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMinimap();
  }

  // ---------- UI ----------
  const ui = {
    hud: $('hud'), lap: $('hudLap'), pos: $('hudPos'), time: $('hudTime'), speed: $('hudSpeed'),
    lobby: $('lobby'), players: $('players'), startBtn: $('startBtn'), lobbyNote: $('lobbyNote'), mode: $('mode'),
    countdown: $('countdown'), banner: $('banner'), results: $('results'), resultList: $('resultList'),
    focusHint: $('focusHint'), sound: $('soundBtn'), cam: $('camBtn'),
  };

  function showPanels() {
    ui.lobby.classList.toggle('hidden', phase !== 'lobby');
    ui.results.classList.toggle('hidden', phase !== 'results');
    ui.hud.classList.toggle('hidden', !(phase === 'countdown' || phase === 'race'));
    ui.countdown.classList.toggle('hidden', phase !== 'countdown' && !(phase === 'race' && now() - race.startAt < 800));
    if (phase === 'lobby') renderLobby();
  }

  document.querySelectorAll('[data-laps]').forEach(btn => {
    btn.addEventListener('click', () => {
      lapsSetting = Number(btn.dataset.laps);
      document.querySelectorAll('[data-laps]').forEach(b => b.classList.toggle('sel', b === btn));
      btn.blur();
    });
  });
  ui.startBtn.addEventListener('click', () => { ui.startBtn.blur(); requestStart(); });
  $('againBtn').addEventListener('click', e => { e.currentTarget.blur(); requestStart(); });
  $('lobbyBtn').addEventListener('click', e => {
    e.currentTarget.blur();
    phase = 'lobby';
    me.spectating = false;
    showPanels();
  });
  function setCamMode(mode) {
    cam.mode = mode;
    ui.cam.textContent = mode === 'chase' ? '🚗 追従視点' : '🧭 固定視点';
    try { localStorage.setItem('ovice-race:cam', mode); } catch (e) {}
  }
  ui.cam.addEventListener('click', () => {
    setCamMode(cam.mode === 'chase' ? 'north' : 'chase');
    ui.cam.blur();
  });
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyV' && !e.repeat) setCamMode(cam.mode === 'chase' ? 'north' : 'chase');
  });
  setCamMode(cam.mode);
  ui.sound.addEventListener('click', () => {
    soundOn = !soundOn;
    ui.sound.textContent = soundOn ? '🔊' : '🔇';
    ui.sound.blur();
  });

  function renderLobby() {
    const list = [
      { pid: me.pid, name: me.name || '接続中…', isMe: true, phase },
      ...activeOthers().map(p => ({ pid: p.pid, name: p.name, isMe: false, phase: p.phase })),
    ];
    const tag = ph => (ph === 'race' || ph === 'countdown' ? '<span class="tag busy">レース中</span>' : ph === 'results' ? '<span class="tag">結果画面</span>' : '');
    ui.players.innerHTML = list
      .map(p => `<li><i style="background:${colorOf(p.pid)}"></i>${esc(p.name)}${p.isMe ? ' <small>(あなた)</small>' : ''}${tag(p.phase)}</li>`)
      .join('');
    const busy = someoneRacing();
    ui.startBtn.disabled = !me.pid || busy;
    ui.lobbyNote.textContent = busy
      ? '他のプレイヤーがレース中です。終わると参加できます。'
      : list.length === 1
        ? '一人でもタイムアタックできます。近くの人がオブジェクトに入ると一緒に走れます。'
        : `ロビーにいる ${list.length} 人でレースします。`;
  }

  function renderResults() {
    ui.resultList.innerHTML = standings()
      .map((s, i) => {
        const time = s.time != null ? fmtTime(s.time) : s.gone ? '退出' : 'DNF';
        return `<li class="${s.pid === me.pid ? 'me' : ''}"><b>${i + 1}</b><i style="background:${colorOf(s.pid)}"></i><span>${esc(s.name)}</span><em>${time}</em></li>`;
      })
      .join('');
  }

  function updateHud(t) {
    if (phase === 'countdown') {
      const left = Math.ceil((race.goAt - t) / 1000);
      ui.countdown.textContent = left > 3 ? 'READY' : String(left);
    } else if (phase === 'race' && t - race.startAt < 800) {
      ui.countdown.textContent = 'GO!';
    } else if (!ui.countdown.classList.contains('hidden')) {
      ui.countdown.classList.add('hidden');
    }

    if (phase === 'countdown' || phase === 'race') {
      const st = standings();
      if (me.spectating) {
        ui.lap.textContent = '観戦中';
        ui.pos.textContent = '';
      } else {
        const lap = Math.min(race.laps, Math.max(1, Math.floor(me.total / L) + 1));
        ui.lap.textContent = `LAP ${lap}/${race.laps}`;
        ui.pos.textContent = `${st.findIndex(s => s.pid === me.pid) + 1} / ${st.length} 位`;
      }
      const myTime = race.finishes.get(me.pid);
      ui.time.textContent = phase === 'race' ? fmtTime(myTime != null ? myTime : t - race.startAt) : fmtTime(0);
      ui.speed.textContent = `${Math.round(Math.hypot(me.vx, me.vy) * 0.36)} km/h`;
    }

    let banner = '';
    if (phase === 'race' && me.finished) {
      const rank = standings().findIndex(s => s.pid === me.pid) + 1;
      const wait = Math.max(0, Math.ceil((CFG.finishWaitMs - (t - race.firstFinishAt)) / 1000));
      banner = `FINISH! ${rank}位 ${fmtTime(race.finishes.get(me.pid))}<small>他のプレイヤーを待っています…（最大 ${wait} 秒）</small>`;
    } else if (phase === 'race' && !me.spectating && me.offTrack && Math.hypot(me.vx, me.vy) > 50) {
      banner = '<small>コースアウト！ 芝生は遅くなります</small>';
    }
    if (ui.banner.innerHTML !== banner) ui.banner.innerHTML = banner;
    ui.banner.classList.toggle('hidden', !banner);

    ui.focusHint.classList.toggle('hidden', document.hasFocus());
  }

  function updateMode() {
    ui.mode.textContent =
      Net.mode === 'ovice'
        ? `oVice 接続中：${me.name}`
        : Net.mode === 'local'
          ? `ローカルテスト：${me.name}（同じブラウザの別タブと対戦）`
          : '接続中…';
  }

  Net.on('self', self => {
    me.pid = self.pid;
    me.name = self.name;
    me.avatarUrl = self.avatarUrl;
    lastSend = 0; // 名前が変わったらすぐ知らせる
    updateMode();
    if (phase === 'lobby') renderLobby();
  });
  Net.on('mode', updateMode);

  // 接続診断パネル（左下の接続表示をクリックで開閉）
  const diag = $('diag');
  function renderDiag() {
    if (diag.classList.contains('hidden')) return;
    const self = Net.self;
    diag.textContent = [
      `モード: ${Net.mode}`,
      `自分: ${self.name || '-'} (${self.pid || '-'})`,
      `oVice 参加者: ${Net.participants.map(p => p.name || '(名前なし)').join(', ') || '-'}`,
      `ゲーム内で見えている人: ${activeOthers().map(p => p.name).join(', ') || '-'}`,
      '',
      ...Net.log,
    ].join('\n');
  }
  ui.mode.addEventListener('click', () => {
    diag.classList.toggle('hidden');
    renderDiag();
  });
  Net.on('log', renderDiag);
  setInterval(renderDiag, 1000);

  // ---------- 起動 ----------
  window.__race = { me, others, get phase() { return phase; }, get race() { return race; } }; // デバッグ用
  placeOnGrid(Math.floor(Math.random() * 6));
  cam.x = me.x;
  cam.y = me.y;
  showPanels();
  Net.connect().then(() => {
    updateMode();
    lastSend = 0;
    renderLobby();
  });
  setInterval(() => { if (phase === 'lobby') renderLobby(); }, 400);
  // 背景タブでは requestAnimationFrame が止まるため、生存通知はタイマーからも送る
  setInterval(() => maybeSend(now()), 1000);

  let last = now();
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    update(dt, t);
    draw(t);
    updateHud(t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
