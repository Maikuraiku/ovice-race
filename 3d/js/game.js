// ゲーム本体（物理・同期・描画・UI）
(() => {
  'use strict';
  // 3D 描画モジュールをこのファイルと同じ場所から読み込むため
  const SCRIPT_URL = document.currentScript ? document.currentScript.src : location.href;
  let r3d = null; // 3D 描画（読み込めたら入る）
  let r3dError = '';

  const qs = new URLSearchParams(location.search);
  const CFG = {
    sendHz: Math.min(30, Math.max(2, Number(qs.get('hz')) || 10)), // 走行中の送信頻度
    idleSendMs: 2000, // 停車中の生存通知の間隔
    timeoutMs: 7000, // これだけ音沙汰がないプレイヤーは退出扱い
    countdownMs: 3500,
    finishWaitMs: 30000, // 1位のゴール後、この時間で打ち切り
  };
  // スピード 100% のときの値。スライダーの倍率（speedMul）を掛けて使う
  const PHYS = {
    accel: 820, brake: 1400, coast: 160, drag: 0.22, reverseMax: 260,
    maxSpeed: 1150, boostSpeed: 1650, boostTime: 1.0,
    steer: 2.5, grip: 8, driftGrip: 1.8,
  };
  // 落下：drop 秒かけて海へ落ち、penalty 秒後に落ちた地点の道路中央から再スタート
  const FALL = { drop: 0.6, penalty: 1.0 };
  // かんたんモード：ハンドルアシスト・滑りにくい
  const EASY = {
    maxSpeed: 1050, grip: 13,
    assist: 0.65, // 何も押していないときに、コースに沿うよう自動で切るハンドルの強さ
    assistWithInput: 0.3, // 自分でハンドルを切っているときに足すアシストの強さ
    steerRamp: 9, // ハンドルの効き始めをなめらかにする
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
    finished: false, spectating: false, steer: 0,
    fall: null, blink: 0, // 落下中の状態 / 復帰直後の点滅
  };
  const others = new Map(); // pid -> リモートプレイヤー
  let phase = 'lobby'; // lobby | countdown | race | results
  let race = null; // { id, laps, entrants[], goAt, startAt, finishes: Map, firstFinishAt }
  let lapsSetting = 2;
  // mode: north = 北が常に上 / chase = 車の向きに合わせて画面を回転（初期値は操作しやすい追従視点）
  const cam = { x: 0, y: 0, zoom: 0.8, rot: 0, cy: null, mode: 'chase' };
  let easyMode = true; // かんたん操作
  const load = key => { try { return localStorage.getItem(key); } catch (e) { return null; } };
  const save = (key, v) => { try { localStorage.setItem(key, v); } catch (e) {} };
  // 視点：chase = 3D 追従 / chaseTop = 3D 上空追従（真上寄りから見下ろし、車の向きに回転）
  //       chase2d = 2D 追従（画面が車の向きに回転）/ north = 上空固定（北が上）
  const CAM_MODES = ['chase', 'chaseTop', 'chase2d', 'north'];
  const savedCam = load('ovice-3d:cam');
  if (CAM_MODES.includes(savedCam) && savedCam !== 'chase') cam.mode = savedCam;
  // 2D で描くときに車の向きへ画面を回すか
  const chase2D = () => cam.mode === 'chase' || cam.mode === 'chase2d';
  if (load('ovice-3d:control') === 'normal') easyMode = false;
  let speedMul = 1; // スピード倍率（0.5〜2.0）。パーティーではホストの設定に揃う
  const savedSpeed = Number(load('ovice-3d:speed'));
  if (savedSpeed >= 0.5 && savedSpeed <= 2) speedMul = savedSpeed;
  // テーマ：夜 / 朝 / エアロ晴天 / 放課後の夕暮れ / 深夜の蛍光灯
  const THEME_ORDER = ['night', 'morning', 'aero', 'dusk', 'midnight'];
  const THEME_LABEL = { night: '🌙 夜', morning: '☀️ 朝', aero: '🫧 エアロ晴天', dusk: '🌆 放課後の夕暮れ', midnight: '🏢 深夜の蛍光灯' };
  const THEME_SHORT = { night: '夜', morning: '朝', aero: 'エアロ晴天', dusk: '夕暮れ', midnight: '深夜' };
  // 2D 表示では、近い雰囲気の夜/朝の描き方を使う
  const THEME_2D = { aero: 'morning', dusk: 'night', midnight: 'night' };
  let theme = THEME_ORDER.includes(load('ovice-3d:theme')) ? load('ovice-3d:theme') : 'night';
  const theme2d = () => (theme === 'night' || theme === 'morning' ? theme : THEME_2D[theme]);

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
      setAmbient();
    }
    if (audio.state === 'suspended') audio.resume();
  }
  // 新しいテーマの環境音（WebAudio で合成。既存の曲は使わない）
  const AMBIENT = {
    aero: { notes: [261.63, 329.63, 392.0, 493.88, 587.33], type: 'sine', cutoff: 2600, vol: 0.02, noise: 0.006, noiseFreq: 520, lfo: 0.07 },
    dusk: { notes: [174.61, 220.0, 261.63, 329.63], type: 'sawtooth', cutoff: 650, vol: 0.014, noise: 0.004, noiseFreq: 300, lfo: 0.05 },
    midnight: { notes: [55, 110, 164.81], type: 'triangle', cutoff: 420, vol: 0.02, noise: 0.002, noiseFreq: 240, lfo: 0.03, buzz: 0.004 },
  };
  let ambient = null;
  function setAmbient() {
    if (!audio) return;
    const cfg = soundOn ? AMBIENT[theme] : null;
    const now0 = audio.currentTime;
    if (ambient) {
      const old = ambient;
      old.gain.gain.cancelScheduledValues(now0);
      old.gain.gain.setTargetAtTime(0, now0, 0.5);
      setTimeout(() => old.nodes.forEach(n => { try { n.stop(); } catch (e) {} }), 3000);
      ambient = null;
    }
    if (!cfg) return;
    const gain = audio.createGain();
    gain.gain.value = 0;
    gain.connect(audio.destination);
    const filter = audio.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cfg.cutoff;
    filter.connect(gain);
    const nodes = [];
    cfg.notes.forEach((f, i) => {
      for (const det of [-5, 5]) {
        const o = audio.createOscillator();
        o.type = cfg.type;
        o.frequency.value = f;
        o.detune.value = det + i;
        const g = audio.createGain();
        g.gain.value = 1 / (cfg.notes.length * 2);
        // ゆっくり音量を揺らして、漂う感じにする
        const lfo = audio.createOscillator();
        lfo.frequency.value = cfg.lfo * (1 + i * 0.37);
        const lg = audio.createGain();
        lg.gain.value = g.gain.value * 0.6;
        lfo.connect(lg).connect(g.gain);
        o.connect(g).connect(filter);
        o.start();
        lfo.start();
        nodes.push(o, lfo);
      }
    });
    // 遠くの波や空調のような音
    if (cfg.noise) {
      const buf = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = audio.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = audio.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = cfg.noiseFreq;
      bp.Q.value = 0.6;
      const ng = audio.createGain();
      ng.gain.value = cfg.noise / cfg.vol;
      src.connect(bp).connect(ng).connect(gain);
      src.start();
      nodes.push(src);
    }
    // 蛍光灯のかすかなうなり
    if (cfg.buzz) {
      const o = audio.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 120;
      const bp = audio.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      bp.Q.value = 4;
      const g = audio.createGain();
      g.gain.value = cfg.buzz / cfg.vol;
      o.connect(bp).connect(g).connect(gain);
      o.start();
      nodes.push(o);
    }
    gain.gain.setTargetAtTime(cfg.vol, now0, 1.5);
    ambient = { gain, nodes };
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

  function sweep(from, to, dur, vol = 0.05) {
    if (!soundOn || !audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(from, audio.currentTime);
    o.frequency.exponentialRampToValueAtTime(to, audio.currentTime + dur);
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
  // 入力欄に文字を打っているときはゲーム操作として扱わない
  const typing = e => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
  window.addEventListener('keydown', e => {
    if (typing(e)) return;
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
    const s = -90 - row * 110;
    const p = Track.pointAt(s);
    me.x = p.x + -p.ty * side * 110;
    me.y = p.y + p.tx * side * 110;
    me.a = Math.atan2(p.ty, p.tx);
    me.vx = me.vy = 0;
    me.total = s;
    me.sPrev = Track.wrap(s);
    me.boost = 0;
    me.finished = false;
    me.fall = null;
    me.blink = 0;
  }

  function stepCar(dt, input) {
    const m = speedMul;
    const speed0 = me.vx * Math.cos(me.a) + me.vy * Math.sin(me.a);
    const n0 = Track.nearest(me.x, me.y);

    let steer = input.steer;
    if (easyMode) {
      // ハンドルアシスト：少し先のコース上の点へ向かうように切る
      if (speed0 > 30) {
        const p = Track.pointAt(n0.s + 200 + speed0 * 0.3);
        let da = Math.atan2(p.y - me.y, p.x - me.x) - me.a;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        const auto = Math.max(-1, Math.min(1, da * 2.2));
        steer = input.steer !== 0 ? Math.max(-1, Math.min(1, input.steer + auto * EASY.assistWithInput)) : auto * EASY.assist;
      }
      // キーを押した瞬間に急に曲がらないよう、ハンドル量をなめらかに変える
      me.steer += (steer - me.steer) * Math.min(1, dt * EASY.steerRamp);
      steer = me.steer;
    }
    // 速度に応じてハンドルを切る（低速では曲がりにくく、高速ではやや鈍く）。速いほど切れ角を少し増やす
    const steerFactor =
      Math.max(-1, Math.min(1, speed0 / (160 * m))) * (1 - Math.min(0.22, (Math.abs(speed0) / (PHYS.boostSpeed * m)) * 0.22));
    me.a += steer * PHYS.steer * Math.sqrt(m) * steerFactor * (input.drift ? 1.25 : 1) * dt;

    const fx = Math.cos(me.a), fy = Math.sin(me.a);
    let fv = me.vx * fx + me.vy * fy; // 前後方向の速度
    let lv = -me.vx * fy + me.vy * fx; // 横滑り速度

    const boosting = me.boost > 0;
    let maxV = (boosting ? PHYS.boostSpeed : easyMode ? EASY.maxSpeed : PHYS.maxSpeed) * m;
    if (easyMode && speed0 > 0) maxV = Math.min(maxV, cornerSpeed(n0.s, speed0, m));

    if (input.up) fv += PHYS.accel * m * (boosting ? 1.8 : 1) * dt;
    if (input.down) fv -= (fv > 0 ? PHYS.brake : PHYS.accel * 0.6) * m * dt;
    if (!input.up && !input.down) fv -= Math.sign(fv) * Math.min(Math.abs(fv), PHYS.coast * m * dt);
    if (input.drift) fv -= fv * 0.5 * dt;
    fv -= fv * PHYS.drag * dt;
    if (fv > maxV) fv = Math.max(maxV, fv - 1400 * m * dt);
    if (fv < -PHYS.reverseMax * m) fv = -PHYS.reverseMax * m;

    const grip = input.drift ? PHYS.driftGrip : easyMode ? EASY.grip : PHYS.grip;
    lv *= Math.exp(-grip * dt);

    me.vx = fx * fv - fy * lv;
    me.vy = fy * fv + fx * lv;
    me.x += me.vx * dt;
    me.y += me.vy * dt;

    // 道路の縁を越えたら海へ落下
    const n = Track.nearest(me.x, me.y);
    if (n.dist > Track.width / 2 + Track.margin) {
      startFall(n);
      return n;
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

  // かんたんモード用：この先のカーブを曲がり切れる速さ（きついカーブの手前で自動的に減速する）
  function cornerSpeed(s, speed, m) {
    const turnRate = PHYS.steer * Math.sqrt(m) * 0.8 * EASY.assist; // アシストだけで出せる旋回速度（rad/s）に余裕を持たせた値
    const reach = 250 + speed * 0.6; // 速いほど先まで見る
    const step = 120;
    let worst = 0;
    let prev = Track.pointAt(s);
    for (let d = step; d <= reach; d += step) {
      const p = Track.pointAt(s + d);
      let da = Math.atan2(p.ty, p.tx) - Math.atan2(prev.ty, prev.tx);
      da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
      worst = Math.max(worst, da / step); // 曲率（1/半径）
      prev = p;
    }
    return worst > 1e-5 ? Math.max(250 * m, turnRate / worst) : Infinity;
  }

  function startFall(n) {
    me.fall = { t: 0, start: now(), s: n.s, speed: Math.hypot(me.vx, me.vy), vx: me.vx, vy: me.vy, placed: false, tx: n.tx, ty: n.ty };
    me.boost = 0;
    sweep(700, 90, 0.6);
  }

  // 落下中：海へ落ちる演出 → 道路の中央へ戻す → 1 秒たったら落ちたときの速さで再スタート
  function stepFall(dt) {
    const f = me.fall;
    // ペナルティが端末の描画速度に左右されないよう、実時間で数える
    f.t = (now() - f.start) / 1000;
    if (f.t < FALL.drop) {
      me.x += f.vx * dt * 0.4;
      me.y += f.vy * dt * 0.4;
      me.a += dt * 7;
    } else if (!f.placed) {
      const p = Track.pointAt(f.s);
      Object.assign(me, { x: p.x, y: p.y, a: Math.atan2(p.ty, p.tx), vx: 0, vy: 0, sPrev: Track.wrap(f.s), blink: 1.2 });
      f.placed = true;
      f.tx = p.tx;
      f.ty = p.ty;
      beep(520, 0.12, 0.04);
    }
    if (f.t >= FALL.penalty) {
      const v = Math.min(f.speed, (easyMode ? EASY.maxSpeed : PHYS.maxSpeed) * speedMul);
      me.vx = f.tx * v;
      me.vy = f.ty * v;
      me.fall = null;
    }
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
    if (!me.pid || !Party.isHost || Party.state !== 'open') return;
    if ((phase !== 'lobby' && phase !== 'results') || someoneRacing()) return;
    // パーティーメンバーのうち、レース中でない人全員で走る
    const entrants = Party.members
      .map(m => m.pid)
      .filter(pid => {
        if (pid === me.pid) return true;
        const p = others.get(pid);
        return !p || p.phase === 'lobby' || p.phase === 'results';
      })
      .sort();
    const names = {};
    entrants.forEach(pid => (names[pid] = nameOf(pid)));
    const msg = { rid: Date.now().toString(36) + '-' + me.pid, laps: lapsSetting, entrants, names, spd: speedMul };
    Party.send('start', msg);
    beginRace(msg);
  }

  function beginRace(msg) {
    if (msg.spd) setSpeed(msg.spd, false);
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
    Party.send('finish', { rid: race.id, t });
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
      fl: me.fall ? Math.round(Math.min(1, me.fall.t / FALL.drop) * 100) / 100 : 0, bl: me.blink > 0 ? 1 : 0,
      ft: race && race.finishes.has(me.pid) ? Math.round(race.finishes.get(me.pid)) : null,
    };
  }
  function maybeSend(t) {
    if (!me.pid || Party.state !== 'open') return;
    const moving = Math.hypot(me.vx, me.vy) > 3;
    const active = (phase === 'countdown' || phase === 'race') && !me.spectating;
    const interval = active || moving ? 1000 / CFG.sendHz : CFG.idleSendMs;
    if (t - lastSend < interval) return;
    lastSend = t;
    Party.send('st', stateMsg());
  }

  Party.on('message', ({ event, data }) => {
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
        phase: data.ph, rid: data.rid, spectating: !!data.sp, fall: data.fl || 0, blink: !!data.bl,
        recv: t, lastSeen: t,
      });
      if (race && data.rid === race.id && data.f && !race.finishes.has(pid) && data.ft != null) recordFinish(pid, data.ft);
    } else if (event === 'start') {
      // レース開始はホストだけが出せる
      if (pid === Party.hostPid && (phase === 'lobby' || phase === 'results')) beginRace(data);
    } else if (event === 'cfg') {
      if (pid === Party.hostPid && data.spd) setSpeed(data.spd, false);
    } else if (event === 'finish') {
      if (race && data.rid === race.id) recordFinish(pid, data.t);
    } else if (event === 'bye') {
      others.delete(pid);
    }
  });

  // ---------- パーティー ----------
  let partyError = '';
  const openParties = new Map(); // oVice で募集中のパーティー: code -> { code, host, n, at }
  const myInfo = () => ({ pid: me.pid, name: me.name, av: me.avatarUrl });

  function backToLobby() {
    phase = 'lobby';
    race = null;
    me.spectating = false;
    me.finished = false;
    showPanels();
  }

  Party.on('roster', members => {
    const ids = new Set(members.map(m => m.pid));
    for (const pid of others.keys()) if (!ids.has(pid)) others.delete(pid);
    lastSend = 0; // 新しいメンバーにすぐ自分の位置を知らせる
    if (Party.isHost) Party.send('cfg', { spd: speedMul });
    updateMode();
    renderLobby();
  });
  Party.on('left', pid => others.delete(pid));
  Party.on('state', st => {
    if (st === 'none') {
      others.clear();
      if (phase !== 'lobby') backToLobby();
    }
    updateMode();
    renderLobby();
  });
  Party.on('error', msg => {
    partyError = msg;
    renderLobby();
  });

  // ホストは oVice の中継でパーティーを宣伝する（届けば、近くの人の画面に「参加」ボタンが出る）
  setInterval(() => {
    if (Party.isHost && Party.state === 'open') {
      Net.send('party-3d', { code: Party.code, host: me.name, n: Party.members.length });
    }
  }, 3000);
  Net.on('message', ({ event, data }) => {
    if (event === 'party-3d' && data && /^[A-Z0-9]{4}$/.test(data.code)) {
      openParties.set(data.code, { code: data.code, host: String(data.host || '???'), n: Number(data.n) || 1, at: now() });
    }
  });

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
      if (me.blink > 0) me.blink -= dt;
      if (me.fall) {
        stepFall(dt);
      } else {
        const n = stepCar(dt, canDrive ? readInput() : NO_INPUT);
        if (!me.fall) trackProgress(n);
      }
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
      if (lead) target = { x: lead.rx, y: lead.ry, a: lead.ra, vx: lead.vx, vy: lead.vy, boost: lead.boost };
    }
    // 追従視点では車の進行方向が画面の上を向くように回転させる
    const wantRot = chase2D() ? -Math.PI / 2 - target.a : 0;
    let dr = wantRot - cam.rot;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    cam.rot += dr * (1 - Math.exp(-dt * 6));
    const ck = 1 - Math.exp(-dt * 8);
    cam.x += (target.x - cam.x) * ck;
    cam.y += (target.y - cam.y) * ck;
    const spd = Math.hypot(target.vx || 0, target.vy || 0);
    cam.spd = spd;
    cam.boost = target === me ? me.boost > 0 : !!target.boost;
    cam.target = target;
    const baseZoom = Math.max(0.25, Math.min(0.75, Math.min(vw, vh) / 1250));
    const wantZoom = baseZoom * (1 - Math.min(0.38, (spd / (PHYS.boostSpeed * speedMul)) * 0.38));
    cam.zoom += (wantZoom - cam.zoom) * (1 - Math.exp(-dt * 2));
  }

  // ---------- 描画 ----------
  const THEMES = {
    night: {
      sea: '#06182c', seaShade: 'rgba(0, 0, 0, 0.28)', wave: 'rgba(130, 180, 230, 0.16)', sparkle: 'rgba(255, 236, 190, 0.55)',
      shadow: 'rgba(0, 0, 0, 0.45)', edge: '#6f7378', road: '#4a4e55', line: 'rgba(255, 255, 255, 0.75)',
      pole: '#2b2e33', lamp: '#fff4c2', lampsOn: true, speedLine: '200, 225, 255',
    },
    morning: {
      sea: '#2a8fc6', seaShade: 'rgba(8, 70, 120, 0.25)', wave: 'rgba(255, 255, 255, 0.5)', sparkle: 'rgba(255, 255, 255, 0.95)',
      shadow: 'rgba(0, 40, 70, 0.35)', edge: '#d3d3cf', road: '#a3a5a8', line: 'rgba(255, 255, 255, 0.95)',
      pole: '#5d6166', lamp: '#d9dde2', lampsOn: false, speedLine: '255, 255, 255',
    },
  };

  const pathOf = pts => {
    const p = new Path2D();
    pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
    p.closePath();
    return p;
  };
  const trackPath = pathOf(Track.pts);
  const lanePaths = [-1, 1].map(k => pathOf(Track.offsetLine((k * Track.width) / 6)));
  const edgeLinePaths = [-1, 1].map(k => pathOf(Track.offsetLine(k * (Track.width / 2 - 16))));

  // 海のテクスチャ（タイル状に繰り返す）
  function makeSeaPattern(th) {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = th.sea;
    g.fillRect(0, 0, S, S);
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const tiled = fn => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy); };
    for (let i = 0; i < 36; i++) {
      const x = r() * S, y = r() * S, rx = 40 + r() * 90, ry = 14 + r() * 30;
      g.fillStyle = th.seaShade;
      tiled((ox, oy) => { g.beginPath(); g.ellipse(x + ox, y + oy, rx, ry, 0, 0, Math.PI * 2); g.fill(); });
    }
    g.strokeStyle = th.wave;
    g.lineWidth = 2.5;
    g.lineCap = 'round';
    for (let i = 0; i < 140; i++) {
      const x = r() * S, y = r() * S, w = 10 + r() * 26;
      tiled((ox, oy) => { g.beginPath(); g.moveTo(x + ox - w, y + oy); g.quadraticCurveTo(x + ox, y + oy - 6, x + ox + w, y + oy); g.stroke(); });
    }
    g.fillStyle = th.sparkle;
    for (let i = 0; i < 70; i++) {
      const x = r() * S, y = r() * S, s = 1.5 + r() * 2;
      tiled((ox, oy) => g.fillRect(x + ox, y + oy, s, s));
    }
    return ctx.createPattern(c, 'repeat');
  }
  const seaPatterns = { night: makeSeaPattern(THEMES.night), morning: makeSeaPattern(THEMES.morning) };

  // 街灯の光だまり（あらかじめ描いておいて貼り付ける）
  const glow = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255, 214, 140, 0.55)');
    grad.addColorStop(0.45, 'rgba(255, 190, 110, 0.22)');
    grad.addColorStop(1, 'rgba(255, 170, 90, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return c;
  })();

  const inView = (x, y, view, r) => x + r > view.x0 && x - r < view.x1 && y + r > view.y0 && y - r < view.y1;

  function drawScene(t, view) {
    const th = THEMES[theme2d()];
    const W = Track.width, M = Track.margin;

    // 海（ゆっくり流れる）
    ctx.save();
    const ox = (t * 0.02) % 512, oy = (t * 0.011) % 512;
    ctx.translate(ox, oy);
    ctx.fillStyle = seaPatterns[theme2d()];
    ctx.fillRect(view.x0 - ox - 600, view.y0 - oy - 600, view.x1 - view.x0 + 1200, view.y1 - view.y0 + 1200);
    ctx.restore();

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    // 海面に落ちる道路の影（高架らしさ）
    ctx.save();
    ctx.translate(70, 90);
    ctx.strokeStyle = th.shadow;
    ctx.lineWidth = W + M * 2;
    ctx.stroke(trackPath);
    ctx.restore();
    // コンクリートの縁と路面
    ctx.strokeStyle = th.edge;
    ctx.lineWidth = W + M * 2;
    ctx.stroke(trackPath);
    ctx.strokeStyle = th.road;
    ctx.lineWidth = W;
    ctx.stroke(trackPath);
    // 白線（外側は実線、車線は破線）
    ctx.strokeStyle = th.line;
    ctx.lineWidth = 6;
    edgeLinePaths.forEach(p => ctx.stroke(p));
    ctx.setLineDash([70, 70]);
    lanePaths.forEach(p => ctx.stroke(p));
    ctx.setLineDash([]);

    // スタート/フィニッシュライン
    const s0 = Track.pointAt(0);
    ctx.save();
    ctx.translate(s0.x, s0.y);
    ctx.rotate(Math.atan2(s0.ty, s0.tx));
    const sq = 24;
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
      roundRect(-b.len / 2, -b.w / 2, b.len, b.w, 14);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,235,59,${pulse})`;
      ctx.lineWidth = 9;
      for (let c = -1; c <= 1; c++) {
        ctx.beginPath();
        ctx.moveTo(c * 34 - 12, -34);
        ctx.lineTo(c * 34 + 12, 0);
        ctx.lineTo(c * 34 - 12, 34);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 夜は街灯の光だまり
    if (th.lampsOn) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const R = 230;
      for (const l of Track.lights) if (inView(l.lx, l.ly, view, R)) ctx.drawImage(glow, l.lx - R, l.ly - R, R * 2, R * 2);
      ctx.restore();
    }
  }

  // 街灯の柱と灯具（車より上に描く）
  function drawLights(view) {
    const th = THEMES[theme2d()];
    for (const l of Track.lights) {
      if (!inView(l.x, l.y, view, 80)) continue;
      ctx.strokeStyle = th.pole;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(l.lx, l.ly);
      ctx.stroke();
      ctx.fillStyle = th.pole;
      ctx.beginPath(); ctx.arc(l.x, l.y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = th.lamp;
      ctx.beginPath(); ctx.arc(l.lx, l.ly, 9, 0, Math.PI * 2); ctx.fill();
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
    const fall = c.fall || 0;
    let alpha = c.alpha * (1 - fall * 0.7);
    if (c.blink && Math.floor(now() / 90) % 2) alpha *= 0.3;
    // 落ちた瞬間の水しぶき
    if (fall > 0.5) {
      const k = (fall - 0.5) / 0.5;
      ctx.save();
      ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k)})`;
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(c.x, c.y, 20 + 70 * k, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(c.x, c.y);
    ctx.rotate(c.a);
    const sc = 1 - fall * 0.7;
    ctx.scale(sc, sc);
    if (c.boost) {
      ctx.fillStyle = Math.random() < 0.5 ? '#ffca28' : '#ff7043';
      ctx.beginPath();
      ctx.moveTo(-22, -7); ctx.lineTo(-44 - Math.random() * 18, 0); ctx.lineTo(-22, 7);
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
    if (THEMES[theme2d()].lampsOn) {
      // 夜はヘッドライト
      ctx.fillStyle = 'rgba(255,250,220,0.95)';
      ctx.fillRect(20, -10, 4, 5);
      ctx.fillRect(20, 5, 4, 5);
    }
    const img = avatar(c.avatarUrl);
    if (!img) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(-16, -2, 16, 4);
    }
    ctx.restore();
    if (img && fall < 0.5) {
      // oVice のアバターを屋根に（画面に対して常に正立）
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(c.x - Math.cos(c.a) * 7, c.y - Math.sin(c.a) * 7);
      ctx.rotate(-cam.rot);
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(img, -9, -9, 18, 18);
      ctx.restore();
    }

    // 名前
    const z = cam.zoom;
    ctx.save();
    ctx.globalAlpha = alpha;
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
    ctx.lineWidth = Track.width * 0.45;
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

  // 速いときは画面の奥から外へ流れる集中線
  function drawSpeedLines(sx, sy, forward, strength = 1) {
    const ratio = (cam.spd || 0) / (PHYS.maxSpeed * speedMul);
    const k = Math.max(0, (ratio - 0.55) / 0.45) + (cam.boost ? 0.7 : 0);
    if (k <= 0) return;
    const kk = Math.min(1.6, k);
    // 消失点は自車の少し前方
    const vx = sx + Math.cos(forward) * vh * 0.3, vy = sy + Math.sin(forward) * vh * 0.3;
    const diag = Math.hypot(vw, vh) / 2;
    const color = THEMES[theme2d()].speedLine;
    ctx.lineCap = 'round';
    for (let i = 0, n = Math.round((10 + 34 * kk) * strength); i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r0 = diag * (0.42 + Math.random() * 0.55);
      const len = 30 + 170 * Math.min(1, kk) * Math.random();
      ctx.strokeStyle = `rgba(${color},${((0.08 + 0.22 * Math.min(1, kk) * Math.random()) * strength).toFixed(3)})`;
      ctx.lineWidth = 1.5 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(vx + Math.cos(ang) * r0, vy + Math.sin(ang) * r0);
      ctx.lineTo(vx + Math.cos(ang) * (r0 + len), vy + Math.sin(ang) * (r0 + len));
      ctx.stroke();
    }
  }

  // ロビーやリザルトのパネルが画面下を覆う高さ（その分だけ自車を上に映す）
  let capturing = false; // 背景を保存するために描いている最中
  function panelCover() {
    if (capturing) return 0;
    const panel = phase === 'lobby' ? ui.lobby : phase === 'results' ? ui.results : null;
    return panel ? Math.min(vh * 0.6, panel.offsetHeight + 30) : 0;
  }

  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = THEMES[theme2d()].sea;
    ctx.fillRect(0, 0, vw, vh);

    const z = cam.zoom;
    // パネル表示中は、パネルに隠れない上側の領域の中央に自車を映す
    const cover = panelCover();
    // 追従視点では前方が広く見えるよう自車を画面の下寄りに置く
    const targetCy = (vh - cover) * (chase2D() ? 0.68 : 0.5);
    if (!capturing) cam.cy = cam.cy == null ? targetCy : cam.cy + (targetCy - cam.cy) * 0.1;
    const cy = capturing ? targetCy : cam.cy;
    // ダッシュ中は小さく揺らす
    const shake = cam.boost ? 2 : 0;
    ctx.translate(vw / 2 + (Math.random() - 0.5) * shake, cy + (Math.random() - 0.5) * shake);
    ctx.rotate(cam.rot);
    ctx.scale(z, z);
    ctx.translate(-cam.x, -cam.y);
    const r = Math.hypot(vw, vh) / z; // 回転しても画面を覆う範囲
    const view = { x0: cam.x - r, x1: cam.x + r, y0: cam.y - r, y1: cam.y + r };
    drawScene(t, view);

    const racing = race && (phase === 'countdown' || phase === 'race');
    for (const p of capturing ? [] : others.values()) {
      if (p.spectating && p.rid === (race && race.id)) continue;
      // レースに参加していない人の車は半透明（ぶつからないので練習走行の邪魔にならない）
      const inRace = racing && race.entrants.includes(p.pid);
      const alpha = racing && !inRace ? 0.35 : 1;
      drawCar({ x: p.rx, y: p.ry, a: p.ra, color: colorOf(p.pid), name: p.name, avatarUrl: p.avatarUrl, boost: p.boost, alpha, isMe: false, fall: p.fall, blink: p.blink });
    }
    if (!capturing && !me.spectating && me.pid) {
      const fall = me.fall ? Math.min(1, me.fall.t / FALL.drop) * (me.fall.placed ? 0 : 1) : 0;
      drawCar({ x: me.x, y: me.y, a: me.a, color: colorOf(me.pid), name: me.name, avatarUrl: me.avatarUrl, boost: me.boost > 0, alpha: 1, isMe: true, fall, blink: me.blink > 0 });
    }
    drawLights(view);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (capturing) return;
    drawSpeedLines(vw / 2, cy, (me.spectating ? 0 : me.a) + cam.rot);
    drawMinimap();
  }

  // 2D 表示のまま背景だけを描いた画像を作る（16:9 で横 width ピクセル）
  function capture2D(width) {
    const saved = { vw, vh, dpr };
    vw = 1920;
    vh = 1080;
    dpr = width / 1920;
    canvas.width = width;
    canvas.height = Math.round(width * 9 / 16);
    capturing = true;
    try {
      draw(now());
    } finally {
      capturing = false;
    }
    const blob = new Promise(res => canvas.toBlob(res, 'image/png'));
    ({ vw, vh, dpr } = saved);
    resize();
    return blob;
  }

  // ---------- UI ----------
  const ui = {
    hud: $('hud'), lap: $('hudLap'), pos: $('hudPos'), time: $('hudTime'), speed: $('hudSpeed'),
    lobby: $('lobby'), players: $('players'), startBtn: $('startBtn'), lobbyNote: $('lobbyNote'), mode: $('mode'),
    noParty: $('noParty'), inParty: $('inParty'), openParties: $('openParties'), codeInput: $('codeInput'),
    codeText: $('codeText'), hostControls: $('hostControls'),
    speedRange: $('speedRange'), speedVal: $('speedVal'), speedNote: $('speedNote'), theme: $('themeBtn'),
    countdown: $('countdown'), banner: $('banner'), results: $('results'), resultList: $('resultList'),
    focusHint: $('focusHint'), sound: $('soundBtn'), cam: $('camBtn'), quality: $('qualityBtn'), perfHint: $('perfHint'),
    shotBtn: $('shotBtn'), shot: $('shot'), shotImg: $('shotImg'),
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
    backToLobby();
  });

  const doJoin = code => {
    if (!me.pid) return;
    partyError = '';
    Party.join(code, myInfo());
    renderLobby();
  };
  $('createBtn').addEventListener('click', e => {
    e.currentTarget.blur();
    if (!me.pid) return;
    partyError = '';
    Party.create(myInfo());
    renderLobby();
  });
  $('joinBtn').addEventListener('click', e => { e.currentTarget.blur(); doJoin(ui.codeInput.value); });
  ui.codeInput.addEventListener('input', () => {
    ui.codeInput.value = ui.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });
  ui.codeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { ui.codeInput.blur(); doJoin(ui.codeInput.value); }
  });
  ui.openParties.addEventListener('click', e => {
    const b = e.target.closest('[data-join]');
    if (b) doJoin(b.dataset.join);
  });
  $('leaveBtn').addEventListener('click', e => { e.currentTarget.blur(); Party.leave(); });
  $('copyBtn').addEventListener('click', e => {
    const btn = e.currentTarget;
    btn.blur();
    const done = () => { btn.textContent = 'コピー済'; setTimeout(() => (btn.textContent = 'コピー'), 1500); };
    try {
      navigator.clipboard.writeText(Party.code).then(done, () => {});
    } catch (err) {}
  });
  function setSpeed(v, persist) {
    speedMul = Math.max(0.5, Math.min(2, Math.round(Number(v) * 10) / 10));
    ui.speedRange.value = String(Math.round(speedMul * 100));
    ui.speedVal.textContent = Math.round(speedMul * 100) + '%';
    if (persist) save('ovice-3d:speed', String(speedMul));
  }
  ui.speedRange.addEventListener('input', () => {
    if (Party.state !== 'none' && !Party.isHost) return setSpeed(speedMul, false);
    setSpeed(Number(ui.speedRange.value) / 100, true);
    if (Party.isHost) Party.send('cfg', { spd: speedMul });
  });
  ui.speedRange.addEventListener('change', () => ui.speedRange.blur());
  setSpeed(speedMul, false);

  function setTheme(t) {
    theme = t;
    save('ovice-3d:theme', t);
    ui.theme.textContent = THEME_LABEL[t];
    if (r3d) r3d.setTheme(t);
    setAmbient();
  }
  ui.theme.addEventListener('click', () => {
    setTheme(THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]);
    ui.theme.blur();
  });
  setTheme(theme);

  function setControl(easy) {
    easyMode = easy;
    save('ovice-3d:control', easy ? 'easy' : 'normal');
    document.querySelectorAll('[data-control]').forEach(b => b.classList.toggle('sel', (b.dataset.control === 'easy') === easy));
    $('controlHelp').textContent = easy
      ? 'かんたん：ハンドルがアシスト付きで、道路から落ちにくい。'
      : 'ふつう：アクセル・ハンドルを自分で操作。アシストなしで最高速が少し速い。';
  }
  document.querySelectorAll('[data-control]').forEach(b =>
    b.addEventListener('click', () => { setControl(b.dataset.control === 'easy'); b.blur(); })
  );
  setControl(easyMode);
  const CAM_LABEL = { chase: '🚗 3D追従', chaseTop: '🛸 上空追従', chase2d: '🗺️ 2D追従', north: '🧭 上空固定' };
  function setCamMode(mode) {
    // 3D が使えないときは 2D の追従/固定の 2 種類だけ
    if (!r3d && mode !== 'north') mode = 'chase';
    cam.mode = mode;
    ui.cam.textContent = !r3d ? (mode === 'north' ? '🧭 固定視点' : '🚗 追従視点') : CAM_LABEL[mode];
    document.body.classList.toggle('view2d', !!r3d && mode === 'chase2d');
    save('ovice-3d:cam', mode);
  }
  const nextCamMode = () =>
    !r3d ? (cam.mode === 'north' ? 'chase' : 'north') : CAM_MODES[(CAM_MODES.indexOf(cam.mode) + 1) % CAM_MODES.length];
  ui.cam.addEventListener('click', () => {
    setCamMode(nextCamMode());
    ui.cam.blur();
  });
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyV' && !e.repeat && !typing(e)) setCamMode(nextCamMode());
  });
  setCamMode(cam.mode);
  // ---------- 背景の保存 ----------
  let shotUrl = null;
  async function saveBackground() {
    ui.shotBtn.disabled = true;
    try {
      const use3d = r3d && cam.mode !== 'chase2d';
      const blob = use3d ? await r3d.capture(3840, 2160) : await capture2D(3840);
      if (!blob) throw new Error('画像を作れませんでした');
      if (shotUrl) URL.revokeObjectURL(shotUrl);
      shotUrl = URL.createObjectURL(blob);
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
      const view = use3d ? { chase: '3D追従', chaseTop: '上空追従', north: '上空固定' }[cam.mode] || '3D' : '2D';
      const a = document.createElement('a');
      a.href = shotUrl;
      a.download = `oVice-Racing_背景_${THEME_SHORT[theme]}_${view}_${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // oVice の中などでダウンロードが止められても保存できるよう、画像も表示する
      ui.shotImg.src = shotUrl;
      ui.shot.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      alert('背景の保存に失敗しました: ' + (err.message || err));
    } finally {
      ui.shotBtn.disabled = false;
      ui.shotBtn.blur();
    }
  }
  ui.shotBtn.addEventListener('click', saveBackground);
  $('shotClose').addEventListener('click', e => {
    e.currentTarget.blur();
    ui.shot.classList.add('hidden');
  });

  ui.sound.addEventListener('click', () => {
    soundOn = !soundOn;
    ui.sound.textContent = soundOn ? '🔊' : '🔇';
    setAmbient();
    ui.sound.blur();
  });

  const setHTML = (el, html) => { if (el.innerHTML !== html) el.innerHTML = html; };
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

  function renderLobby() {
    const inParty = Party.state !== 'none';
    ui.noParty.classList.toggle('hidden', inParty);
    ui.inParty.classList.toggle('hidden', !inParty);
    ui.lobbyNote.classList.toggle('error', !inParty && !!partyError);
    $('createBtn').disabled = $('joinBtn').disabled = !me.pid;
    const speedLocked = Party.state !== 'none' && !Party.isHost;
    ui.speedRange.disabled = speedLocked;
    setText(ui.speedNote, speedLocked ? '（ホストが設定）' : '');

    if (!inParty) {
      const list = [...openParties.values()].filter(p => now() - p.at < 10000);
      setHTML(
        ui.openParties,
        list.length
          ? '<li class="label">oVice で募集中のパーティー</li>' +
              list.map(p => `<li><span>${esc(p.host)} のパーティー（${p.n}人）</span><button data-join="${p.code}">参加</button></li>`).join('')
          : ''
      );
      setText(ui.lobbyNote, partyError || 'パーティーを作ってコードを伝えるか、教えてもらったコードを入力して参加してください。');
      return;
    }

    setText(ui.codeText, Party.code);
    if (Party.state === 'connecting') {
      setHTML(ui.players, '');
      ui.hostControls.classList.add('hidden');
      setText(ui.lobbyNote, Party.isHost ? 'パーティーを作成中…' : '接続中…');
      return;
    }
    const tag = ph => (ph === 'race' || ph === 'countdown' ? '<span class="tag busy">レース中</span>' : ph === 'results' ? '<span class="tag">結果画面</span>' : '');
    setHTML(
      ui.players,
      Party.members
        .map(m => {
          const isMe = m.pid === me.pid;
          const ph = isMe ? phase : (others.get(m.pid) || {}).phase;
          const crown = m.pid === Party.hostPid ? '<span class="crown" title="ホスト">👑</span>' : '';
          return `<li><i style="background:${colorOf(m.pid)}"></i>${crown}${esc(isMe ? me.name : m.name)}${isMe ? ' <small>(あなた)</small>' : ''}${tag(ph)}</li>`;
        })
        .join('')
    );
    ui.hostControls.classList.toggle('hidden', !Party.isHost);
    const busy = someoneRacing();
    ui.startBtn.disabled = busy;
    setText(
      ui.lobbyNote,
      !Party.isHost
        ? 'ホストがレースを始めるのを待っています。待っている間は練習走行できます。'
        : busy
          ? 'まだレース中のメンバーがいます。終わるまでお待ちください。'
          : Party.members.length === 1
            ? 'コードを伝えて仲間を呼びましょう（一人でもタイムアタックできます）。'
            : `${Party.members.length} 人でレースします。`
    );
  }

  function renderResults() {
    $('againBtn').classList.toggle('hidden', !Party.isHost);
    setText($('resultNote'), Party.isHost ? '' : 'ホストが次のレースを始めるのを待っています。');
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
    } else if (me.fall && !me.spectating) {
      banner = '落下！<small>コースに戻ります（1 秒ペナルティ）</small>';
    }
    if (ui.banner.innerHTML !== banner) ui.banner.innerHTML = banner;
    ui.banner.classList.toggle('hidden', !banner);

    ui.focusHint.classList.toggle('hidden', document.hasFocus());
  }

  function updateMode() {
    const who = Net.mode === 'ovice' ? `oVice：${me.name}` : Net.mode === 'local' ? me.name : '接続中…';
    const party =
      Party.state === 'open'
        ? `　パーティー ${Party.code}（${Party.members.length}人）`
        : Party.state === 'connecting'
          ? '　パーティー接続中…'
          : '';
    ui.mode.textContent = who + party;
  }

  Net.on('self', self => {
    me.pid = self.pid;
    me.name = self.name;
    me.avatarUrl = self.avatarUrl;
    lastSend = 0; // 名前が変わったらすぐ知らせる
    if (Party.state !== 'none') Party.updateSelf(myInfo());
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
      `パーティー: ${Party.state}${Party.code ? ' ' + Party.code : ''}${Party.isHost ? '（ホスト）' : ''} / メンバー: ${Party.members.map(m => m.name).join(', ') || '-'}`,
      `ゲーム内で見えている人: ${activeOthers().map(p => p.name).join(', ') || '-'}`,
      r3d && cam.mode !== 'chase2d' ? `描画: 3D（画質 ${QUALITY_LABEL[quality]}） ${r3d.fps} fps` : `描画: 2D${r3dError ? '（3D を使えません: ' + r3dError + '）' : ''}`,
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

  // ---------- 3D 描画（読み込めない環境では 2D のまま） ----------
  const QUALITY_LABEL = { high: '最高', medium: '標準', low: '軽量' };
  const QUALITY_NEXT = { high: 'medium', medium: 'low', low: 'high' };
  let quality = load('ovice-3d:quality');
  if (!QUALITY_LABEL[quality]) quality = window.matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
  let slowSince = 0;

  function updateQualityBtn() {
    ui.quality.textContent = '画質: ' + QUALITY_LABEL[quality];
  }
  ui.quality.addEventListener('click', () => {
    quality = QUALITY_NEXT[quality];
    save('ovice-3d:quality', quality);
    if (r3d) r3d.setQuality(quality);
    updateQualityBtn();
    slowSince = 0;
    ui.quality.blur();
  });
  updateQualityBtn();

  import(new URL('./render3d.js', SCRIPT_URL).href)
    .then(mod => {
      r3d = mod.createRenderer({ canvas: $('gl'), labelsBefore: $('mode'), Track, theme, quality });
      window.__r3d = r3d; // デバッグ用
      document.body.classList.add('is3d');
      setCamMode(CAM_MODES.includes(savedCam) ? savedCam : cam.mode);
    })
    .catch(err => {
      console.warn('3D 描画を使えないため 2D で表示します', err);
      r3dError = String((err && err.message) || err).slice(0, 80);
      $('gl').remove();
      ui.quality.classList.add('hidden');
    });

  // 3D 用：描画に必要な状態をまとめる
  function state3d(t, dt) {
    const racing = race && (phase === 'countdown' || phase === 'race');
    const list = [];
    for (const p of others.values()) {
      if (p.spectating && p.rid === (race && race.id)) continue;
      const inRace = racing && race.entrants.includes(p.pid);
      list.push({
        pid: p.pid, x: p.rx, y: p.ry, a: p.ra, vx: p.vx, vy: p.vy, boost: p.boost, fall: p.fall || 0, blink: p.blink,
        alpha: racing && !inRace ? 0.35 : 1, name: p.name, avatarUrl: p.avatarUrl, color: colorOf(p.pid),
      });
    }
    const meVisible = !me.spectating && me.pid;
    const fall = me.fall ? Math.min(1, me.fall.t / FALL.drop) * (me.fall.placed ? 0 : 1) : 0;
    const tg = cam.target || me;
    return {
      t, dt, camMode: cam.mode, cover: panelCover(), boost: !!cam.boost,
      maxSpeed: (easyMode ? EASY.maxSpeed : PHYS.maxSpeed) * speedMul,
      me: meVisible
        ? { pid: me.pid, x: me.x, y: me.y, a: me.a, vx: me.vx, vy: me.vy, boost: me.boost > 0, fall, blink: me.blink > 0, name: me.name, avatarUrl: me.avatarUrl, color: colorOf(me.pid) }
        : null,
      target: { x: tg.x, y: tg.y, a: tg.a || 0, vx: tg.vx || 0, vy: tg.vy || 0 },
      others: list,
    };
  }

  // 3D のときは 2D キャンバスを重ねて、集中線とミニマップだけを描く
  function drawOverlay() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    if (cam.mode === 'chase') drawSpeedLines(vw / 2, vh * 0.62, -Math.PI / 2, 0.45);
    else if (cam.mode === 'chaseTop') drawSpeedLines(vw / 2, vh * 0.66, -Math.PI / 2, 0.4);
    drawMinimap();
  }

  // 重いときは画質を下げる案内を出す
  function checkPerf(t) {
    if (!r3d || quality === 'low' || cam.mode === 'chase2d') { ui.perfHint.classList.add('hidden'); slowSince = 0; return; }
    if (r3d.fps < 24) { if (!slowSince) slowSince = t; } else slowSince = 0;
    ui.perfHint.classList.toggle('hidden', !(slowSince && t - slowSince > 5000));
  }

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
  let lastFrameAt = now();
  let frameDt = 0.016;
  function tick(t) {
    const dt = Math.min(0.05, Math.max(0, t - last) / 1000);
    frameDt = dt;
    last = t;
    update(dt, t);
    updateHud(t);
  }
  function frame(t) {
    lastFrameAt = now();
    tick(t);
    if (r3d && cam.mode !== 'chase2d') {
      try {
        r3d.render(state3d(t, frameDt));
        drawOverlay();
        checkPerf(t);
      } catch (err) {
        // 3D 描画で問題が起きたら 2D に切り替えて遊び続けられるようにする
        console.error(err);
        r3dError = String(err.message || err).slice(0, 80);
        r3d = null;
        document.body.classList.remove('is3d');
        $('gl').style.display = 'none';
        document.querySelectorAll('.labels3d').forEach(el => el.remove());
        ui.quality.classList.add('hidden');
        setCamMode(cam.mode);
        draw(t);
      }
    } else {
      draw(t);
      ui.perfHint.classList.add('hidden');
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // 画面が隠れて requestAnimationFrame が止まっても、カウントダウンや結果判定・位置送信は進める
  setInterval(() => {
    const t = now();
    if (t - lastFrameAt > 250) tick(t);
  }, 100);
})();
