// ゲーム本体（操作・進行・パーティー通信・UI・音）
//  ひとりで遊ぶ / 協力プレイ（同じステージをみんなで進む） / 対戦プレイ（同じコースでタイムを競う）
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const TILE = World.TILE, VIEW_H = World.VIEW_H, GROUND_Y = 12 * TILE;
  const SCRIPT_URL = document.currentScript.src;
  const VERSION = new URL(SCRIPT_URL).searchParams.get('v') || 'dev';
  const asset = f => new URL('../assets/' + f + (VERSION === 'dev' ? '' : '?v=' + VERSION), SCRIPT_URL).href;
  Render.init($('game'), { sprites: asset('sprites.webp'), spritesPng: asset('sprites.png'), town: asset('town.jpg') });

  const STEP = 1 / 120;
  const P = {
    walk: 210, run: 320, accel: 950, runAccel: 760, airAccel: 720, friction: 1150, skid: 2100,
    jumpV: 740, runJump: 0.1, gravUp: 1450, gravDown: 2700, gravCut: 3800, maxFall: 950,
    stomp: 520, stompHold: 780, coyote: 0.09, buffer: 0.13,
  };
  const SIZE = { small: { w: 26, h: 50 }, big: { w: 30, h: 80 } };
  const CFG = { sendHz: 12, snapHz: 12, idleSendMs: 2000, timeoutMs: 7000, countdownMs: 3500, finishWaitMs: 60000 };
  const COLORS = ['#e53935', '#1e88e5', '#f9a825', '#43a047', '#8e24aa', '#fb8c00', '#00acc1', '#ec407a'];
  const COMBO = [100, 200, 400, 800, 1000, 2000, 4000, 8000];
  const DEATH = {
    box: ['ダンボールに行く手を阻まれた…', '引っ越しの荷物に巻き込まれた…'],
    virus: ['ウイルスに感染した…', 'PC ごとウイルスにやられた…'],
    spam: ['迷惑メールを開いてしまった…', '「当選しました」を信じてしまった…'],
    phone: ['電話に出てしまった…（長電話）', '「ちょっといい？」の電話に捕まった…'],
    shimekiri: ['締め切りに追いつかれた…', '締め切りは待ってくれなかった…'],
    car: ['赤信号を渡ってしまった…', '急いでいても信号は守ろう…'],
    burn: ['オーバーヒートした床でやけどした…', 'サーバーの熱にやられた…'],
    shred: ['シュレッダーにかけられた…', '機密書類と一緒に裁断された…'],
    file: ['落ちてきたファイルの下敷きになった…', '重要書類の重みを知った…'],
    laser: ['警備レーザーに見つかった…', '警報が鳴ってしまった…'],
    snow: ['雪玉に巻き込まれた…', '雪だるまになってしまった…'],
    pendulum: ['大時計の振り子にはじき飛ばされた…', '時間に追われて振り子に当たった…'],
    pit: ['床が抜けていた…', '書類の隙間に落ちた…'],
    time: ['定時を過ぎてしまった…'],
  };
  const NETA_STOMP = { box: 'ダンボールを片付けた！', virus: 'ウイルスを駆除！', spam: '迷惑メールを削除！', phone: '電話をガチャ切り！' };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const now = () => performance.now();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const load = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const fmtTime = ms => {
    if (ms == null || !isFinite(ms)) return '--:--.--';
    const t = Math.max(0, ms) / 1000, m = Math.floor(t / 60), s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  };
  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

  // ---------- 状態 ----------
  const me = {
    pid: null, name: '', char: load('ovice-teiji:char') === 'f' ? 'f' : 'm',
    x: 0, y: 0, w: SIZE.small.w, h: SIZE.small.h, vx: 0, vy: 0, onGround: false, facing: 1, big: false,
    inv: 0, hurt: 0, stun: 0, dead: false, deadT: 0, deadKind: '', skip: false, anim: 0, grow: 0, growTo: false,
    coyote: 0, jumpBuf: 0, jumping: false, combo: 0, score: 0, coins: 0, safe: { x: 0, y: 0 }, cleared: false,
    pl: true, fx: {}, card: false, stamp: 0, zip: null, gliding: false,
  };
  const others = new Map(); // pid -> { pid, name, char, st, recv, lastSeen, d }
  const localKilled = new Map(); // 協力メンバーが踏んだ敵（ホストの確定待ち）
  let W = null;
  let phase = 'title'; // title | intro | play | clear | end
  let game = null; // { mode, course, ci, lives, rid, entrants, names, startAt, finishes, ... }
  let cpReached = null;
  let introUntil = 0, clearT = 0, clearBy = null, bonusLeft = 0, bonusRate = 0;
  let worldSeq = 0;
  // コース：'all'（全ステージ） / 'w2'（ワールド 2 を通しで） / '5'（6 番目のステージだけ）
  const validSel = v =>
    v === 'all' ||
    (/^w\d+$/.test(v || '') && Levels.worldStages(Number(v.slice(1))).length > 0) ||
    (/^\d+$/.test(v || '') && Number(v) < Levels.count);
  let courseSel = validSel(load('ovice-teiji:course2')) ? load('ovice-teiji:course2') : 'w1';
  let partyMode = load('ovice-teiji:mode') === 'versus' ? 'versus' : 'coop';
  const cam = { x: 0 };

  const isAuth = () => !game || game.mode !== 'coop' || Party.isHost;
  const inParty = () => game && game.mode !== 'solo';
  const nameOf = pid => (pid === me.pid ? me.name : (others.get(pid) || {}).name || (game && game.names && game.names[pid]) || '???');
  function colorOf(pid) {
    if (game && game.entrants) {
      const i = game.entrants.indexOf(pid);
      if (i >= 0) return COLORS[i % COLORS.length];
    }
    return COLORS[hash(pid || '') % COLORS.length];
  }
  const courseList = sel =>
    sel === 'all' ? Levels.meta.map(m => m.idx) : /^w\d+$/.test(sel) ? Levels.worldStages(Number(sel.slice(1))) : [Number(sel)];
  const worldName = n => `ワールド${n}「${Levels.WORLDS[n - 1] || ''}」`;
  const courseLabel = sel => {
    if (sel === 'all') return `全ステージ（${Levels.count}）`;
    if (/^w\d+$/.test(sel)) return worldName(Number(sel.slice(1)));
    const m = Levels.info(Number(sel));
    return m ? m.id + ' ' + m.name : '';
  };
  const courseInfo = sel => {
    if (sel === 'all') return `全 ${Levels.count} ステージを通しで遊びます（長いです）`;
    if (/^w\d+$/.test(sel)) {
      const st = Levels.worldStages(Number(sel.slice(1))).map(i => Levels.info(i));
      return `${courseLabel(sel)}　${st[0].id}〜${st[st.length - 1].id} の ${st.length} ステージを通しで`;
    }
    const m = Levels.info(Number(sel));
    return m ? `${m.id} ${m.name}（${worldName(m.world)}）` : '';
  };
  const worldOfSel = sel => {
    if (sel === 'all') return 0;
    if (/^w\d+$/.test(sel)) return Number(sel.slice(1));
    const m = Levels.info(Number(sel));
    return m ? m.world : 1;
  };

  // ---------- サウンド ----------
  let audio = null;
  let soundMode = Number(load('ovice-teiji:sound')) || 0; // 0: 全部 / 1: 効果音のみ / 2: なし
  let remoteFx = false; // ほかの人の操作を反映しているあいだは音を鳴らさない
  function ensureAudio() {
    if (!audio) {
      try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    }
    if (audio.state === 'suspended') audio.resume();
    if (phase === 'play' && !bgm) startBgm();
  }
  function tone(freq, dur, o = {}) {
    if (!audio || soundMode === 2 || remoteFx) return;
    const t0 = audio.currentTime + (o.delay || 0);
    const osc = audio.createOscillator(), g = audio.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t0 + dur);
    g.gain.setValueAtTime(o.vol || 0.04, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, freq, delay = 0) {
    if (!audio || soundMode === 2 || remoteFx) return;
    const t0 = audio.currentTime + delay;
    const buf = audio.createBuffer(1, Math.ceil(audio.sampleRate * dur), audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
    src.buffer = buf;
    f.type = 'bandpass';
    f.frequency.value = freq;
    g.gain.value = vol;
    src.connect(f).connect(g).connect(audio.destination);
    src.start(t0);
  }
  const seq = (notes, step, o = {}) => notes.forEach((n, i) => n && tone(n, step * 1.1, { ...o, delay: (o.delay || 0) + i * step }));
  const sfx = {
    jump: () => tone(me.big ? 300 : 380, 0.16, { slide: me.big ? 640 : 820, vol: 0.035 }),
    coin: () => { tone(1046, 0.07, { vol: 0.035 }); tone(1568, 0.2, { vol: 0.035, delay: 0.07 }); },
    stomp: () => { tone(260, 0.1, { slide: 90, vol: 0.06 }); noise(0.07, 0.05, 900); },
    kick: () => tone(520, 0.14, { slide: 180, vol: 0.05 }),
    bump: () => tone(150, 0.08, { type: 'triangle', vol: 0.09 }),
    thud: () => tone(110, 0.06, { type: 'triangle', vol: 0.06 }),
    break: () => noise(0.25, 0.09, 1300),
    sprout: () => tone(260, 0.4, { slide: 760, type: 'triangle', vol: 0.05 }),
    power: () => seq([523, 659, 784, 1046, 784, 1046, 1318], 0.06, { vol: 0.035 }),
    shrink: () => seq([880, 660, 523, 392], 0.07, { vol: 0.035 }),
    oneup: () => seq([784, 988, 1175, 1568, 1318, 1760], 0.08, { vol: 0.035, type: 'triangle' }),
    die: () => seq([494, 466, 440, 0, 392, 330, 262], 0.11, { vol: 0.04 }),
    ring: () => { for (let i = 0; i < 8; i++) tone(i % 2 ? 1320 : 1560, 0.05, { vol: 0.018, delay: i * 0.055 }); },
    pi: () => tone(2093, 0.14, { type: 'sine', vol: 0.06 }),
    clear: () => seq([523, 659, 784, 1046, 0, 784, 1046, 0, 1318], 0.1, { vol: 0.04, delay: 0.35 }),
    alarm: () => { for (let i = 0; i < 6; i++) tone(i % 2 ? 988 : 1318, 0.09, { vol: 0.03, delay: i * 0.1 }); },
    hurry: () => seq([1046, 1318, 1046, 1318, 1046, 1318], 0.07, { vol: 0.03 }),
    spring: () => tone(220, 0.25, { slide: 900, type: 'triangle', vol: 0.06 }),
    boom: () => { noise(0.4, 0.09, 500); tone(180, 0.3, { slide: 1400, vol: 0.03 }); },
    warp: () => seq([392, 523, 659, 784, 1046], 0.04, { vol: 0.03, type: 'triangle' }),
    zip: () => tone(900, 0.3, { slide: 400, type: 'sawtooth', vol: 0.015 }),
    swim: () => tone(330, 0.12, { slide: 520, type: 'sine', vol: 0.05 }),
    tick: () => tone(1500, 0.03, { vol: 0.015 }),
    fumi: () => tone(700, 0.12, { slide: 1200, vol: 0.04 }),
  };

  // BGM：オリジナルの短いループ（8 分音符で 1 小節 8 個）
  const SONGS = {
    office: {
      bpm: 150,
      lead: 'C5 E5 G5 E5 F5 A5 G5 . | E5 G5 C6 B5 A5 G5 E5 . | F5 F5 A5 F5 E5 E5 G5 E5 | D5 E5 F5 D5 G5 - - . | C5 E5 G5 E5 F5 A5 G5 . | E5 G5 C6 B5 A5 G5 A5 B5 | C6 B5 A5 G5 F5 E5 D5 E5 | C5 - G4 - C5 - - .',
      bass: 'C3 . G3 . C3 . G3 . | A2 . E3 . A2 . E3 . | F2 . C3 . F2 . C3 . | G2 . D3 . G2 . B2 . | C3 . G3 . C3 . G3 . | A2 . E3 . A2 . E3 . | F2 . G2 . F2 . G2 . | C3 . G2 . C3 . . .',
    },
    basement: {
      bpm: 132,
      lead: 'A4 . C5 . E5 . D5 C5 | B4 . G4 . B4 - - . | A4 . C5 . E5 . A5 G5 | E5 - - - - - - . | F5 . E5 . D5 . C5 . | B4 . C5 . D5 . E5 . | A4 . C5 . B4 . G#4 . | A4 - - - - - - .',
      bass: 'A2 . A2 . A2 . A2 . | G2 . G2 . G2 . G2 . | F2 . F2 . F2 . F2 . | E2 . E2 . E2 . E2 . | D2 . D2 . D2 . D2 . | G2 . G2 . G2 . G2 . | F2 . F2 . E2 . E2 . | A2 . E2 . A2 . . .',
    },
    street: {
      bpm: 164,
      lead: 'D5 F#5 A5 F#5 G5 B5 A5 . | F#5 A5 D6 C#6 B5 A5 F#5 . | G5 G5 B5 G5 F#5 F#5 A5 F#5 | E5 F#5 G5 E5 A5 - - . | D5 F#5 A5 F#5 G5 B5 A5 . | F#5 A5 D6 C#6 B5 A5 B5 C#6 | D6 C#6 B5 A5 G5 F#5 E5 F#5 | D5 - A4 - D5 - - .',
      bass: 'D3 . A3 . D3 . A3 . | B2 . F#3 . B2 . F#3 . | G2 . D3 . G2 . D3 . | A2 . E3 . A2 . C#3 . | D3 . A3 . D3 . A3 . | B2 . F#3 . B2 . F#3 . | G2 . A2 . G2 . A2 . | D3 . A2 . D3 . . .',
    },
    night: {
      bpm: 138,
      lead: 'D5 . F5 . A5 . G5 F5 | E5 . C5 . E5 - - . | D5 . F5 . A5 . D6 C6 | A5 - - - - - - . | A#5 . A5 . G5 . F5 . | E5 . F5 . G5 . A5 . | D5 . F5 . E5 . C#5 . | D5 - - - - - - .',
      bass: 'D3 . A2 . D3 . A2 . | C3 . G2 . C3 . G2 . | D3 . A2 . D3 . A2 . | F2 . C3 . F2 . C3 . | A#2 . F2 . A#2 . F2 . | C3 . G2 . C3 . G2 . | A2 . E2 . A2 . C#3 . | D3 . A2 . D3 . . .',
    },
    server: {
      bpm: 150,
      lead: 'E5 G5 B5 G5 E5 G5 B5 G5 | D5 F#5 A5 F#5 D5 F#5 A5 F#5 | C5 E5 G5 E5 C5 E5 G5 E5 | B4 D#5 F#5 D#5 B4 D#5 F#5 B5 | E5 G5 B5 E6 D6 B5 G5 B5 | D5 F#5 A5 D6 C6 A5 F#5 A5 | C5 E5 G5 C6 B5 G5 E5 G5 | B4 D#5 F#5 B5 E5 - - .',
      bass: 'E2 . E3 . E2 . E3 . | D2 . D3 . D2 . D3 . | C2 . C3 . C2 . C3 . | B1 . B2 . B1 . B2 . | E2 . E3 . E2 . E3 . | D2 . D3 . D2 . D3 . | C2 . C3 . C2 . C3 . | B1 . B2 . E2 . . .',
    },
    rooftop: {
      bpm: 156,
      lead: 'C5 . F5 . A5 . C6 . | A#5 . A5 . G5 . F5 . | G5 . A5 . A#5 . D6 . | C6 - - - A5 - - . | D6 . C6 . A#5 . A5 . | G5 . A5 . A#5 . C6 . | A5 . G5 . F5 . E5 . | F5 - - - - - - .',
      bass: 'F2 . C3 . F2 . C3 . | A#2 . F3 . A#2 . F3 . | G2 . D3 . G2 . D3 . | C3 . G2 . C3 . E3 . | A#2 . F3 . A#2 . F3 . | G2 . D3 . C3 . G2 . | D3 . A2 . C3 . G2 . | F2 . C3 . F2 . . .',
    },
    nightstreet: {
      bpm: 170,
      lead: 'G5 . A#5 G5 D6 . C6 A#5 | A5 . F5 . A5 C6 A5 . | G5 . A#5 G5 D6 . G6 F6 | D6 - - - - - - . | D#6 . D6 . C6 . A#5 . | C6 . A#5 . A5 . F5 . | G5 A5 A#5 C6 D6 C6 A#5 A5 | G5 - D5 - G5 - - .',
      bass: 'G2 G3 G2 G3 G2 G3 G2 G3 | F2 F3 F2 F3 F2 F3 F2 F3 | D#2 D#3 D#2 D#3 D#2 D#3 D#2 D#3 | D2 D3 D2 D3 D2 D3 F#2 D3 | D#2 D#3 D#2 D#3 C2 C3 C2 C3 | F2 F3 F2 F3 F2 F3 F2 F3 | D2 D3 D2 D3 D2 D3 F#2 F#3 | G2 . D2 . G2 . . .',
    },
    festival: {
      bpm: 168,
      lead: 'D5 E5 G5 A5 G5 E5 D5 . | E5 G5 A5 C6 A5 G5 E5 . | D5 E5 G5 A5 C6 A5 G5 E5 | D5 - - . A4 - - . | G5 A5 C6 D6 C6 A5 G5 . | A5 G5 E5 D5 E5 G5 A5 . | G5 E5 D5 E5 G5 A5 G5 E5 | D5 - A4 - D5 - - .',
      bass: 'D3 . A2 . D3 . A2 . | C3 . G2 . C3 . G2 . | D3 . A2 . D3 . A2 . | D3 . A2 . D3 D3 A2 . | C3 . G2 . C3 . G2 . | A2 . E3 . A2 . E3 . | C3 . G2 . C3 . A2 . | D3 . A2 . D3 . . .',
    },
    winter: {
      bpm: 150,
      lead: 'G5 E5 C5 E5 G5 . C6 . | B5 A5 G5 . E5 . G5 . | A5 F5 D5 F5 A5 . D6 . | C6 B5 A5 . G5 - - . | G5 E5 C5 E5 G5 . C6 . | B5 A5 G5 . A5 . B5 . | C6 . G5 . E5 . D5 . | C5 - - - - - - .',
      bass: 'C3 . G2 . C3 . G2 . | E3 . B2 . E3 . B2 . | F2 . C3 . F2 . C3 . | G2 . D3 . G2 . B2 . | C3 . G2 . C3 . G2 . | E3 . B2 . A2 . E3 . | F2 . G2 . G2 . G2 . | C3 . G2 . C3 . . .',
    },
    final: {
      bpm: 176,
      lead: 'E5 . B4 E5 G5 . F#5 E5 | D5 . A4 D5 F#5 . E5 D5 | C5 . G4 C5 E5 . D5 C5 | B4 . D#5 . F#5 . B5 . | E5 . G5 B5 E6 . D6 B5 | C6 . A5 . F#5 . A5 . | G5 F#5 E5 D#5 E5 F#5 G5 A5 | B5 - - - E5 - - .',
      bass: 'E2 E3 E2 E3 E2 E3 E2 E3 | D2 D3 D2 D3 D2 D3 D2 D3 | C2 C3 C2 C3 C2 C3 C2 C3 | B1 B2 B1 B2 B1 B2 B1 B2 | E2 E3 E2 E3 E2 E3 E2 E3 | A1 A2 A1 A2 D2 D3 D2 D3 | C2 C3 C2 C3 B1 B2 B1 B2 | E2 . B1 . E2 . . .',
    },
  };
  const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  const parseTrack = s =>
    s.split(/\s+/).filter(x => x && x !== '|').map(x => {
      if (x === '.') return 0;
      if (x === '-') return -1;
      const m = x.match(/^([A-G]#?)(\d)$/);
      return 440 * Math.pow(2, (NOTE[m[1]] + (Number(m[2]) + 1) * 12 - 69) / 12);
    });
  Object.values(SONGS).forEach(s => { s.L = parseTrack(s.lead); s.B = parseTrack(s.bass); });
  let bgm = null;
  function startBgm() {
    stopBgm();
    if (!audio || soundMode !== 0 || !W) return;
    const song = SONGS[W.S.theme] || SONGS[Backdrops.song(W.S.theme)] || SONGS.office;
    bgm = { song, step: 0, next: audio.currentTime + 0.1, rate: W.hurried ? 1.3 : 1, gain: audio.createGain() };
    bgm.gain.gain.value = 1;
    bgm.gain.connect(audio.destination);
  }
  function stopBgm() {
    if (bgm) {
      const g = bgm.gain;
      try { g.gain.setTargetAtTime(0, audio.currentTime, 0.05); setTimeout(() => g.disconnect(), 400); } catch (e) {}
    }
    bgm = null;
  }
  function pumpBgm() {
    if (!bgm || !audio) return;
    const s = bgm.song, n = s.L.length;
    const spb = 60 / (s.bpm * bgm.rate) / 2;
    while (bgm.next < audio.currentTime + 0.3) {
      const i = bgm.step % n;
      for (const [track, type, vol] of [[s.L, 'square', 0.022], [s.B, 'triangle', 0.05]]) {
        const f = track[i];
        if (f > 0) {
          let len = 1;
          while (track[(i + len) % n] === -1 && len < 8) len++;
          const osc = audio.createOscillator(), g = audio.createGain();
          osc.type = type;
          osc.frequency.value = f;
          g.gain.setValueAtTime(vol, bgm.next);
          g.gain.setTargetAtTime(vol * 0.6, bgm.next + 0.02, 0.08);
          g.gain.setTargetAtTime(0.0001, bgm.next + spb * len * 0.9, 0.02);
          osc.connect(g).connect(bgm.gain);
          osc.start(bgm.next);
          osc.stop(bgm.next + spb * len + 0.1);
        }
      }
      bgm.next += spb;
      bgm.step++;
    }
  }

  // ---------- 効果の通知（World から） ----------
  function popup(x, y, text, o = {}) {
    if (W) W.popups.push({ x, y, text, t: 0, life: o.life || 0.9, size: o.size, color: o.color });
  }
  function addScore(n, x, y, text) {
    me.score += n;
    if (x != null) popup(x, y, text || '+' + n);
  }
  function gainCoin(x, y) {
    const n = me.fx.mult > 0 ? 2 : 1;
    me.coins += n;
    me.score += 200 * n;
    sfx.coin();
    if (x != null) popup(x, y, n > 1 ? '賞与+2（招き猫）' : '賞与+1', { size: 13, color: '#ffe082' });
    if (n > 1 && me.coins % 100 === 1) oneUp(x, y);
    if (me.coins % 100 === 0) oneUp(x, y);
  }
  function oneUp(x, y) {
    if (!game) return;
    if (game.mode === 'solo') game.lives++;
    else if (game.mode === 'coop') { if (Party.isHost) game.lives++; else sendCoop('life', {}); }
    sfx.oneup();
    if (x != null) popup(x, y - 20, '有給 +1日！', { size: 18, color: '#b9f6ca', life: 1.4 });
    toast(game.mode === 'versus' ? '有給休暇を獲得！（対戦では記念品です）' : '有給休暇 +1日！');
  }
  World.fx = (type, d) => {
    switch (type) {
      case 'sfx': if (sfx[d]) sfx[d](); break;
      case 'coin': if (d.local) gainCoin(d.x, d.y); break;
      case 'score': addScore(d.n, d.x, d.y); break;
      case 'toast': if (!remoteFx) toast(d); break;
      case 'enemyDown': if (d.local) { addScore(100, d.e.x + d.e.w / 2, d.e.y); sfx.kick(); } break;
      case 'ring': if (Math.abs(d.x - (me.x + me.w / 2)) < Render.view.w * 0.7 && phase === 'play') sfx.ring(); break;
      case 'chaser': if (phase === 'play') { toast('⏰ 締め切りが迫ってきた！振り返らずに走れ！'); sfx.alarm(); } break;
    }
  };

  // ---------- 入力 ----------
  const keys = new Set();
  const touch = { left: false, right: false, jump: false, dash: false };
  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    Space: 'jump', ArrowUp: 'jump', KeyW: 'jump', KeyZ: 'jump', KeyK: 'jump',
    ShiftLeft: 'dash', ShiftRight: 'dash', KeyX: 'dash', KeyJ: 'dash',
  };
  const NOINPUT = { left: false, right: false, jump: false, dash: false };
  const input = () => ({
    left: keys.has('left') || touch.left, right: keys.has('right') || touch.right,
    jump: keys.has('jump') || touch.jump, dash: keys.has('dash') || touch.dash,
  });
  const typing = e => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
  function pressJump() {
    if (phase === 'play' && !me.dead) me.jumpBuf = P.buffer;
  }
  window.addEventListener('keydown', e => {
    if (typing(e)) return;
    ensureAudio();
    const k = KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    if (k === 'jump' && !e.repeat) pressJump();
    keys.add(k);
  });
  window.addEventListener('keyup', e => {
    const k = KEYMAP[e.code];
    if (k) keys.delete(k);
  });
  window.addEventListener('blur', () => keys.clear());
  document.querySelectorAll('#touch [data-k]').forEach(btn => {
    const k = btn.dataset.k;
    const on = e => { e.preventDefault(); ensureAudio(); touch[k] = true; btn.classList.add('on'); if (k === 'jump') pressJump(); };
    const off = e => { e.preventDefault(); touch[k] = false; btn.classList.remove('on'); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
  });
  $('game').addEventListener('pointerdown', () => { ensureAudio(); window.focus(); });

  // ---------- プレイヤー ----------
  function setSize(big) {
    const s = big ? SIZE.big : SIZE.small;
    const cx = me.x + me.w / 2, bottom = me.y + me.h;
    me.big = big;
    me.w = s.w;
    me.h = s.h;
    me.x = cx - s.w / 2;
    me.y = bottom - s.h;
  }
  function placePlayer(x) {
    setSize(false);
    me.x = x;
    me.y = GROUND_Y - me.h;
    Object.assign(me, {
      vx: 0, vy: 0, onGround: true, facing: 1, inv: 0, hurt: 0, stun: 0, dead: false, deadT: 0, skip: false,
      grow: 0, coyote: 0, jumpBuf: 0, jumping: false, combo: 0, cleared: false, onLift: null, zip: null, gliding: false,
    });
    me.safe = { x: me.x, y: me.y };
  }
  const spawnX = () => (cpReached != null ? W.checkpoints[cpReached] + 10 : 3 * TILE) + (game && game.entrants ? Math.max(0, game.entrants.indexOf(me.pid)) * 26 : 0);

  function stepPlayer(dt) {
    const canMove = phase === 'play' && !me.cleared && me.stun <= 0;
    const inp = canMove ? input() : NOINPUT;
    if (!canMove) me.jumpBuf = 0;
    if (me.stun > 0) me.stun -= dt;
    if (me.inv > 0) me.inv -= dt;
    if (me.hurt > 0) me.hurt -= dt;
    if (me.grow > 0) me.grow -= dt;
    Gimmicks.tick(me, dt);
    if (me.onLift && me.onLift.off) me.onLift = null;
    if (me.onLift) { me.x += me.onLift.dx; me.y = me.onLift.y - me.h; }
    me.gliding = false;
    if (me.zip) {
      // ワイヤーにつかまっている
      if (me.jumpBuf > 0) me.jumpBuf -= dt;
      if (!canMove) me.jumpBuf = 0;
      Gimmicks.zipStep(me, dt);
      interact(me.y + me.h);
      return;
    }

    const env = Gimmicks.env(W, me);
    const k = Gimmicks.mods(me, env);
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const max = (inp.dash ? P.run : P.walk) * k.speed;
    const acc = (me.onGround ? (inp.dash ? P.runAccel : P.accel) : P.airAccel) * k.accel;
    if (dir) {
      const sp = me.vx * dir;
      if (sp < 0 && me.onGround) me.vx += dir * P.skid * k.friction * dt;
      else if (sp < max) me.vx = Math.min(max, sp + acc * dt) * dir;
      else if (me.onGround || env.water) me.vx = Math.max(max, sp - P.friction * k.friction * dt) * dir;
      me.facing = dir;
    } else if (me.onGround) {
      const f = P.friction * k.friction * dt;
      me.vx = Math.abs(me.vx) <= f ? 0 : me.vx - Math.sign(me.vx) * f;
    }

    me.coyote = me.onGround ? P.coyote : me.coyote - dt;
    if (me.onGround) me.djUsed = false;
    if (me.jumpBuf > 0) me.jumpBuf -= dt;
    const jumpNow = vy => {
      me.vy = vy;
      me.onGround = false;
      me.coyote = 0;
      me.jumpBuf = 0;
      me.jumping = true;
      me.onLift = null;
      me.stamp = (me.stamp || 0) + 1; // 承認ハンコブロックが入れ替わる
    };
    if (me.jumpBuf > 0 && env.water) {
      jumpNow(Gimmicks.swimV(me, env, P));
      sfx.swim();
    } else if (me.jumpBuf > 0 && me.coyote > 0) {
      jumpNow(-(P.jumpV * k.jump + Math.abs(me.vx) * P.runJump));
      sfx.jump();
    } else if (me.jumpBuf > 0 && me.fx.djump > 0 && !me.djUsed) {
      // エナジーゼリー：空中でもう 1 回
      me.djUsed = true;
      jumpNow(-P.jumpV * 0.92 * k.jump);
      sfx.jump();
      W.particles.push({ kind: 'dust', x: me.x + me.w / 2, y: me.y + me.h, t: 0, life: 0.3 });
    }
    let g = me.vy < 0 ? ((inp.jump && me.jumping) || me.boost ? P.gravUp : P.gravCut) : P.gravDown;
    let maxFall = P.maxFall;
    if (env.up) g = 900; // 上昇気流の中は軽くなる
    if (env.water) {
      g = 700;
      maxFall = 160;
    } else if (me.fx.glide > 0 && me.vy > 0 && inp.jump) {
      // 日傘でふわっと降りる
      g *= 0.3;
      maxFall = 120;
      me.gliding = true;
    }
    me.vy = Math.min(maxFall, me.vy + g * dt);
    if (env.up) me.vy = Math.max(-340, me.vy - env.up * dt);
    if (me.vy >= 0) me.jumping = me.boost = false;

    // 風やコンベアで押し流される
    const drift = env.wx + (me.onGround ? env.convey : 0);
    if (drift) World.moveX(W, me, drift * dt);
    if (World.moveX(W, me, me.vx * dt)) me.vx = 0;
    const wasGround = me.onGround;
    const prevBottom = me.y + me.h;
    const r = World.moveY(W, me, me.vy * dt, true);
    me.onGround = r.landed;
    me.onLift = r.lift || null;
    if (r.landed) {
      if (!wasGround && me.vy > 450) W.particles.push({ kind: 'dust', x: me.x + me.w / 2, y: me.y + me.h, t: 0, life: 0.3 });
      me.vy = 0;
      me.combo = 0;
      if (!me.onLift && Math.abs(me.vx) < 400) me.safe = { x: me.x, y: me.y };
    }
    if (r.bonk) {
      me.vy = 60;
      me.jumping = false;
      bonkBlock(r.bonk.c, r.bonk.r);
    } else if (r.bonkRect) {
      me.vy = 60;
      me.jumping = false;
    }
    if (r.landed) Gimmicks.landed(me, r, gapi);
    if (me.onGround && Math.abs(me.vx) > 10) me.anim += Math.abs(me.vx) * dt * 0.045;
    interact(prevBottom);
  }

  // ギミックから使う操作
  const gapi = {
    damage: kind => damage(kind),
    stun: (sec, text) => {
      if (me.stun > 0 || me.hurt > 0 || me.inv > 0) return;
      me.stun = sec;
      me.vx *= 0.3;
      sfx.bump();
      if (text) toast(text, 1600);
    },
    sfx: n => { if (sfx[n]) sfx[n](); },
    toast: (text, ms) => toast(text, ms),
    popup: (x, y, text, o) => popup(x, y, text, o),
    addScore: (n, x, y, text) => addScore(n, x, y, text),
    input: () => input(),
    addCoins: (n, x, y, text) => {
      me.coins += n;
      me.score += 200 * n;
      sfx.coin();
      for (let i = 0; i < Math.min(n, 12); i++) W.particles.push({ kind: 'coin', x: x + (i - 6) * 6, y, vy: -500 - i * 40, t: 0, life: 0.6 });
      popup(x, y - 40, text, { size: 18, color: '#ffe082', life: 1.6 });
      if (Math.floor(me.coins / 100) > Math.floor((me.coins - n) / 100)) oneUp(x, y);
    },
    addTime: (sec, x, y) => {
      if (!game || game.mode === 'versus') { popup(x, y - 40, '（対戦では記念品）', { size: 13 }); return; }
      if (isAuth()) W.time += sec;
      else sendCoop('gtime', { s: sec });
      popup(x, y - 40, `定時まで +${sec} 秒`, { size: 18, color: '#b3e5fc', life: 1.6 });
    },
  };

  function bonkBlock(c, r) {
    const coop = game && game.mode === 'coop';
    if (isAuth()) {
      const res = World.hitBlock(W, c, r, me.big, { local: true, spawn: true });
      if (res && coop) sendCoop('blk', { c, r, t: W.tiles[r * W.w + c], fx: res, by: me.pid });
    } else {
      // 協力メンバー：見た目は先に反映して、確定はホストに任せる
      const res = World.hitBlock(W, c, r, me.big, { local: true, spawn: false });
      if (res) sendCoop('hit', { c, r, big: me.big ? 1 : 0 });
    }
  }

  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  let fumiCool = new Map();

  function interact(prevBottom) {
    if (me.dead) return;
    // コイン
    W.coins.forEach((c, i) => {
      if (c.taken || !overlap(me, { x: c.x - 12, y: c.y - 13, w: 24, h: 26 })) return;
      c.taken = true;
      gainCoin(c.x, c.y - 10);
      if (game && game.mode === 'coop') sendCoop('coin', { i });
    });
    // アイテム
    for (const it of W.items) {
      if (it.taken || it.emerge > 0 || !overlap(me, it)) continue;
      it.taken = true;
      if (isAuth()) World.takeItem(W, it.id);
      else sendCoop('take', { id: it.id });
      useItem(it.type, it.x + it.w / 2, it.y);
    }
    // 敵
    for (const e of W.enemies) {
      if (!e.active || e.gone || e.state !== 'walk' || e.visible === false || localKilled.has(e.n)) continue;
      let hb = e;
      if (e.type === 'phone') {
        if (!e.ext || e.ext < 0.2) continue;
        hb = { x: e.x + 3, y: e.y, w: e.w - 6, h: Math.max(0, e.pipeTop - e.y) };
      }
      if (!overlap(me, hb)) continue;
      if (me.inv > 0) { defeat(e, 'fall'); continue; }
      if (e.type !== 'phone' && me.vy > 0 && prevBottom <= hb.y + 14) { defeat(e, 'flat'); continue; }
      if (me.hurt > 0) continue;
      if (me.fx.board && e.type !== 'phone') {
        me.fx.board = 0;
        me.hurt = 0.8;
        defeat(e, 'fall');
        toast('スケボーではね飛ばした！（スケボーは壊れた）');
        continue;
      }
      damage(e.type);
      return;
    }
    // 締め切り
    const C = W.chaser;
    if (C && C.active) {
      const cx = me.x + me.w / 2, cy = me.y + me.h / 2;
      if (Math.hypot(cx - C.x, cy - C.y) < 46 + me.h * 0.3) {
        if (C.stun > 0) {
          // 目を回しているあいだは触れても平気
        } else if ((me.vy > 0 && prevBottom <= C.y - 10) || me.inv > 0) {
          if (isAuth()) World.stunChaser(W);
          else { C.stun = 1; sendCoop('stomp', { n: -1 }); }
          me.vy = -(input().jump ? P.stompHold : P.stomp);
          me.jumping = input().jump;
          addScore(1000, C.x, C.y - 60, '締め切りを延長した！ +1000');
          sfx.stomp();
        } else if (me.hurt <= 0) {
          damage('shimekiri');
          return;
        }
      }
    }
    // ギミック・アイテム
    Gimmicks.interact(W, me, gapi);
    if (me.dead) return;
    // ほかのプレイヤーを踏み台にする
    if (me.vy > 0) {
      for (const o of others.values()) {
        if (!o.d || !sameWorld(o) || o.st.d) continue;
        const ob = { x: o.d.x, y: o.d.y, w: o.d.w, h: o.d.h };
        if (!overlap(me, ob) || prevBottom > ob.y + 12) continue;
        if ((fumiCool.get(o.pid) || 0) > now()) continue;
        fumiCool.set(o.pid, now() + 400);
        me.vy = -(input().jump ? 860 : 620);
        me.jumping = input().jump;
        sfx.fumi();
        toast(game.mode === 'versus' ? `${o.name} さんを踏みつけた！（1 秒ふらふら）` : `${o.name} さんを踏み台にした！`);
        Party.send('fumi', { to: o.pid, rid: game.rid });
        break;
      }
    }
    // 中間地点
    W.checkpoints.forEach((x, i) => {
      if (me.x > x && (cpReached == null || cpReached < i)) {
        cpReached = i;
        toast('中間地点（議事録を保存しました）');
        sfx.pi();
        if (game && game.mode === 'coop' && !Party.isHost) sendCoop('cp', { i });
      }
    });
    // タイムカード
    if (!me.cleared && phase === 'play' && me.x + me.w > W.goalX + 14) reachGoal();
    // 落下
    if (me.y > VIEW_H + 30) die('pit');
  }

  function defeat(e, how) {
    me.combo++;
    const pts = COMBO[Math.min(me.combo - 1, COMBO.length - 1)];
    if (how === 'flat') {
      me.vy = -(input().jump ? P.stompHold : P.stomp);
      me.jumping = input().jump;
      sfx.stomp();
    } else sfx.kick();
    if (isAuth()) World.killEnemy(W, e, how, false);
    else {
      // 協力メンバー：見た目だけ先に倒しておく
      localKilled.set(e.n, now());
      if (how === 'flat' && e.type === 'box') { e.state = 'flat'; e.t = 0.6; }
      else e.gone = true;
      sendCoop('stomp', { n: e.n, how });
    }
    const neta = Math.random() < 0.35 && NETA_STOMP[e.type];
    addScore(pts, e.x + e.w / 2, e.y, neta ? `${neta} +${pts}` : '+' + pts);
    if (me.combo === COMBO.length) oneUp(e.x, e.y);
  }

  function useItem(type, x, y) {
    if (type === 'drink') {
      if (!me.big) {
        setSize(true);
        me.grow = 0.6;
        me.growTo = true;
        toast('栄養ドリンクで元気MAX！（大きくなった）');
      }
      sfx.power();
      addScore(1000, x, y, '元気MAX! +1000');
    } else if (type === 'can') {
      me.inv = 10;
      sfx.power();
      toast('エナドリでハイテンション！10 秒間むてき');
      addScore(1000, x, y, '+1000');
    } else if (type === 'yukyu') {
      oneUp(x, y);
    }
  }

  function damage(kind) {
    if (me.dead || me.cleared) return;
    if (me.fx.shield) {
      me.fx.shield = 0;
      me.hurt = 1.5;
      sfx.shrink();
      toast('安全ヘルメットが守ってくれた！');
      return;
    }
    if (me.big) {
      setSize(false);
      me.grow = 0.6;
      me.growTo = false;
      me.hurt = 1.8;
      sfx.shrink();
      toast('差し戻されました…（小さくなった）');
    } else die(kind);
  }

  function die(kind) {
    if (me.dead || me.cleared || phase !== 'play') return;
    me.dead = true;
    me.deadT = 0;
    me.deadKind = kind;
    me.vx = 0;
    me.vy = kind === 'pit' ? 0 : -760;
    me.inv = 0;
    me.respawned = false;
    stopBgm();
    sfx.die();
    toast(pick(DEATH[kind] || DEATH.pit), 2600);
    if (game && game.mode === 'coop') {
      if (Party.isHost) hostDead(kind);
      else sendCoop('dead', { k: kind });
    }
  }

  function stepDead(dt) {
    me.deadT += dt;
    if (me.deadKind !== 'pit' && me.deadT > 0.45) {
      me.vy += 1800 * dt;
      me.y += me.vy * dt;
    }
    const wait = game.mode === 'versus' ? 1.6 : 2.6;
    if (me.deadT > wait && !me.respawned) {
      me.respawned = true;
      respawn();
    }
  }

  function respawn() {
    if (game.mode === 'solo') {
      game.lives--;
      if (game.lives <= 0) return gameOver();
      enterStage(game.ci, { keepCp: true });
    } else if (game.mode === 'versus') {
      enterStage(game.ci, { keepCp: true, introMs: 0 });
      me.hurt = 1.2;
    } else {
      if (me.deadKind === 'time' || game.over) return; // ホストの指示を待つ
      // 生きている仲間のいちばん先の安全な場所から再開する
      let best = null;
      for (const o of others.values()) {
        if (!sameWorld(o) || o.st.d || !o.st.sx) continue;
        if (!best || o.st.sx > best.x) best = { x: o.st.sx, y: o.st.sy };
      }
      placePlayer(spawnX());
      if (best && best.x > me.x) { me.x = best.x; me.y = best.y; }
      me.hurt = 2;
      startBgm();
    }
  }

  // ---------- 進行 ----------
  function enterStage(ci, o = {}) {
    game.ci = ci;
    const idx = game.course[ci];
    const sameStage = W && W.idx === idx && o.keepCp;
    W = World.build(idx, o.seq != null ? o.seq : ++worldSeq);
    Gimmicks.reset(me, sameStage ? ['card', 'light'] : null);
    if (o.seq != null) worldSeq = o.seq;
    if (o.cp !== undefined) cpReached = o.cp;
    else if (!o.keepCp) cpReached = null;
    if (game.mode === 'versus') W.time = Infinity;
    localKilled.clear();
    const keepBig = o.keepBig && me.big;
    placePlayer(spawnX());
    if (keepBig) setSize(true);
    W.particles.length = 0;
    cam.x = Math.max(0, me.x - Render.view.w * 0.4);
    stopBgm();
    const ms = o.introMs != null ? o.introMs : 2200;
    if (ms > 0) {
      phase = 'intro';
      introUntil = now() + ms;
      renderIntro(o.countdown);
    } else {
      phase = 'play';
      startBgm();
    }
    showPanels();
  }

  function startSolo() {
    others.clear();
    game = { mode: 'solo', course: courseList(courseSel), ci: 0, lives: 3, sel: courseSel };
    me.score = 0;
    me.coins = 0;
    enterStage(0);
  }

  function reachGoal() {
    me.cleared = true;
    if (game.mode === 'coop') {
      if (Party.isHost) hostClear(me.pid);
      else { sendCoop('goal', {}); startClear(me.pid); }
    } else startClear(me.pid);
  }

  function startClear(by) {
    if (phase === 'clear') return;
    phase = 'clear';
    clearT = 0;
    clearBy = by;
    me.cleared = true;
    me.inv = 0;
    stopBgm();
    sfx.pi();
    sfx.clear();
    W.goalClock = clockText(W);
    const mine = by === me.pid;
    if (mine) {
      me.x = Math.min(me.x, W.goalX + 4);
      me.vx = 0;
      bonusLeft = game.mode === 'versus' ? 0 : Math.max(0, Math.floor(W.time)) * 50;
      bonusRate = bonusLeft / 1.4;
      toast(`退勤！（打刻 ${W.goalClock}）`);
    } else {
      bonusLeft = 0;
      toast(`${nameOf(by)} さんが全員分のタイムカードを押しました（不正打刻）`, 3000);
    }
    const last = game.ci >= game.course.length - 1;
    if (game.mode === 'versus' && last && mine) {
      const t = now() - game.startAt;
      recordFinish(me.pid, t);
      Party.send('finish', { rid: game.rid, t });
    }
  }

  function stepClear(dt) {
    clearT += dt;
    if (me.dead) {
      // 倒れている途中に仲間がクリアした場合は、そのまま落ちていくだけ
      me.deadT += dt;
      if (me.deadKind !== 'pit' && me.deadT > 0.45 && me.y < VIEW_H + 100) { me.vy += 1800 * dt; me.y += me.vy * dt; }
    } else if (clearBy === me.pid && clearT > 0.6) {
      me.skip = true;
      me.facing = 1;
      me.vx = 150;
      World.moveX(W, me, me.vx * dt);
      me.vy = Math.min(P.maxFall, me.vy + P.gravDown * dt);
      const r = World.moveY(W, me, me.vy * dt, false);
      if (r.landed) me.vy = 0;
      me.onGround = r.landed;
      me.anim += 150 * dt * 0.045;
      if (me.y > VIEW_H) { me.y = VIEW_H; me.vy = 0; }
    } else if (clearBy !== me.pid) {
      me.skip = true;
      me.vx = 0;
    }
    if (bonusLeft > 0 && clearT > 0.8) {
      const n = Math.min(bonusLeft, Math.ceil(bonusRate * dt / 50) * 50);
      bonusLeft -= n;
      me.score += n;
      W.time = Math.max(0, W.time - n / 50);
      if (Math.floor(clearT * 20) !== Math.floor((clearT - dt) * 20)) sfx.tick();
    }
    const last = game.ci >= game.course.length - 1;
    if (clearT > 3.6 && !game.clearDone) {
      if (game.mode === 'solo') {
        if (last) soloEnding();
        else enterStage(game.ci + 1, { keepBig: true });
      } else if (game.mode === 'versus') {
        if (!last) enterStage(game.ci + 1, { keepBig: true, introMs: 1200 });
        else game.clearDone = true; // 全員のゴールを待つ
      } else if (Party.isHost) {
        game.clearDone = true;
        hostNext();
      }
    }
  }

  function clockText(w) {
    if (!w || !isFinite(w.time)) return '17:00';
    const m = Math.min(60, Math.max(0, Math.floor(60 * (1 - w.time / w.S.time))));
    return m >= 60 ? '18:00' : `17:${String(m).padStart(2, '0')}`;
  }

  function checkTime() {
    if (!W || phase !== 'play' || !isFinite(W.time)) return;
    if (W.time <= 30 && !W.hurried) {
      W.hurried = true;
      toast('⚠ 定時が迫っています！急いで！');
      sfx.hurry();
      if (bgm) bgm.rate = 1.3;
    }
    if (W.time <= 0 && !W.timeUp && isAuth()) {
      W.timeUp = true;
      if (game.mode === 'coop') {
        sendCoop('timeup', {});
        game.timeupAt = now() + 2800;
      }
      die('time');
    }
  }

  // ---------- 終わり ----------
  function soloEnding() {
    const s = me.score;
    const per = (s / Math.max(1, game.course.length)) * 3; // 3 ステージあたりに換算
    const title = per >= 40000 ? '伝説の定時ハンター' : per >= 20000 ? '定時退社のプロ' : per >= 8000 ? 'できる会社員' : 'がんばった会社員';
    showEnd({
      title: '🎉 定時退社 成功！',
      art: 'skip_' + me.char,
      text: `おつかれさまでした！明日も定時で帰りましょう。<br>評価 <b>${s.toLocaleString()}</b>　賞与 <b>${me.coins}</b> 枚　残りの有給 <b>${game.lives}</b> 日<br>称号：<b>${title}</b>`,
      again: true,
    });
  }
  function gameOver() {
    showEnd({
      title: '残業確定…',
      art: 'zangyou',
      text: `有給を使い果たしました。今日は残業です。<br>評価 <b>${me.score.toLocaleString()}</b>　賞与 <b>${me.coins}</b> 枚`,
      again: true,
    });
  }

  function showEnd(o) {
    phase = 'end';
    stopBgm();
    endInfo = o;
    renderEnd();
    showPanels();
  }
  let endInfo = null;

  function backToTitle() {
    phase = 'title';
    game = null;
    stopBgm();
    W = World.build(0, ++worldSeq);
    cam.x = 0;
    showPanels();
  }

  // ---------- パーティー（共通） ----------
  const sameWorld = o =>
    !!(game && W && o.st && o.st.rid === game.rid && (game.mode === 'coop' ? o.st.sq === W.seq : o.st.ci === game.ci) && ['intro', 'play', 'clear'].includes(o.st.ph));
  const activeOthers = () => [...others.values()].filter(o => now() - o.lastSeen < CFG.timeoutMs);
  const someoneBusy = () => activeOthers().some(o => ['intro', 'play', 'clear'].includes(o.st.ph) && (!game || o.st.rid !== game.rid || phase === 'title' || phase === 'end'));

  function sendCoop(event, data) {
    if (!game || !W) return;
    Party.send(event, Object.assign({ rid: game.rid, sq: W.seq }, data));
  }

  function requestStart() {
    if (!me.pid || !Party.isHost || Party.state !== 'open') return;
    if (phase !== 'title' && phase !== 'end') return;
    const entrants = Party.members
      .map(m => m.pid)
      .filter(pid => {
        if (pid === me.pid) return true;
        const o = others.get(pid);
        return !o || !['intro', 'play', 'clear'].includes(o.st.ph);
      });
    const names = {};
    entrants.forEach(pid => (names[pid] = nameOf(pid)));
    const msg = {
      rid: Date.now().toString(36) + '-' + me.pid, mode: partyMode, course: courseList(courseSel), sel: courseSel,
      entrants, names, lives: 2 + entrants.length,
    };
    Party.send('start', msg);
    beginParty(msg);
  }

  function beginParty(msg) {
    game = {
      mode: msg.mode === 'versus' ? 'versus' : 'coop', course: msg.course, sel: msg.sel, ci: 0, rid: msg.rid,
      entrants: msg.entrants, names: msg.names || {}, lives: msg.lives || 3,
      startAt: now() + CFG.countdownMs, finishes: new Map(), firstFinishAt: null, teamCp: null,
    };
    me.score = 0;
    me.coins = 0;
    setSize(false);
    lastSend = 0;
    if (!game.entrants.includes(me.pid)) {
      // 途中から入った人は次の回から参加
      game = null;
      partyNote = 'ゲームが始まりました。次の回から参加できます。';
      renderLobby();
      return;
    }
    enterStage(0, { seq: 1, cp: null, introMs: CFG.countdownMs, countdown: true });
  }

  // 対戦：ゴールタイム
  function recordFinish(pid, t) {
    if (!game || game.finishes.has(pid)) return;
    game.finishes.set(pid, t);
    if (game.firstFinishAt == null) game.firstFinishAt = now();
    if (pid !== me.pid) toast(`${nameOf(pid)} さんが定時退社しました！（${fmtTime(t)}）`);
  }
  function progressOf(pid) {
    if (pid === me.pid) return game.ci * 100000 + (game.finishes.has(pid) ? 99999 : me.x);
    const o = others.get(pid);
    return o && o.st ? o.st.pr || 0 : -1;
  }
  function standings() {
    return game.entrants
      .map(pid => ({ pid, name: nameOf(pid), time: game.finishes.get(pid), pr: progressOf(pid), gone: pid !== me.pid && !others.has(pid) }))
      .sort((a, b) => {
        if (a.time != null && b.time != null) return a.time - b.time;
        if (a.time != null) return -1;
        if (b.time != null) return 1;
        return b.pr - a.pr;
      });
  }
  function checkVersusEnd() {
    if (!game || game.mode !== 'versus' || phase === 'end' || phase === 'title') return;
    const present = game.entrants.filter(pid => pid === me.pid || others.has(pid));
    const allDone = present.every(pid => game.finishes.has(pid));
    const timeUp = game.firstFinishAt != null && now() - game.firstFinishAt > CFG.finishWaitMs;
    if (allDone || timeUp) showVersusResults();
  }
  function showVersusResults() {
    const TITLES = ['定時の鬼', '優秀社員', 'ふつうの会社員'];
    const st = standings();
    showEnd({
      title: '🏁 対戦結果',
      art: 'skip_' + me.char,
      text: `コース：${esc(courseLabel(game.sel))}`,
      list: st.map((s, i) => ({
        pid: s.pid, rank: i + 1, name: s.name,
        right: s.time != null ? fmtTime(s.time) : s.gone ? '退出' : '残業確定',
        sub: s.time != null ? TITLES[i] || '残業組' : '',
      })),
      party: true,
    });
  }

  // 協力：ホストの処理
  function hostDead(kind) {
    if (kind === 'time') return;
    if (game.lives > 0) game.lives--;
    else if (!game.overAt) game.overAt = now() + 2000;
  }
  function hostClear(by) {
    if (game.clearing) return;
    game.clearing = true;
    sendCoop('clear', { by });
    startClear(by);
  }
  function hostNext() {
    const next = game.ci + 1;
    if (next < game.course.length) {
      const sq = W.seq + 1;
      Party.send('stage', { rid: game.rid, ci: next, sq, cp: null, lv: game.lives });
      game.clearing = false;
      game.clearDone = false;
      enterStage(next, { seq: sq, cp: null, keepBig: true });
    } else {
      Party.send('end', { rid: game.rid });
      coopEnding();
    }
  }
  function hostRestart() {
    const sq = W.seq + 1;
    Party.send('stage', { rid: game.rid, ci: game.ci, sq, cp: game.teamCp, lv: game.lives });
    game.clearing = false;
    game.clearDone = false;
    W.timeUp = false;
    enterStage(game.ci, { seq: sq, cp: game.teamCp });
  }
  function hostOver() {
    game.over = true;
    Party.send('over', { rid: game.rid });
    coopOver();
  }
  function teamTotals() {
    let score = me.score, coins = me.coins;
    for (const pid of game.entrants) {
      if (pid === me.pid) continue;
      const o = others.get(pid);
      if (o && o.st && o.st.rid === game.rid) { score += o.st.sc || 0; coins += o.st.cn || 0; }
    }
    return { score, coins };
  }
  function memberScores() {
    return game.entrants
      .map(pid => ({ pid, name: nameOf(pid), score: pid === me.pid ? me.score : ((others.get(pid) || {}).st || {}).sc || 0 }))
      .sort((a, b) => b.score - a.score);
  }
  function coopEnding() {
    const team = teamTotals();
    const list = memberScores();
    showEnd({
      title: '🎉 チームで定時退社 成功！',
      art: 'skip_' + me.char,
      text: `おつかれさまでした！チーム評価 <b>${team.score.toLocaleString()}</b>　賞与 <b>${team.coins}</b> 枚　残りのチーム有給 <b>${game.lives}</b> 日`,
      list: list.map((s, i) => ({ pid: s.pid, rank: i + 1, name: s.name, right: s.score.toLocaleString(), sub: i === 0 ? '🏅 MVP' : '' })),
      party: true,
    });
  }
  function coopOver() {
    const team = teamTotals();
    showEnd({
      title: 'チーム全員 残業確定…',
      art: 'zangyou',
      text: `チームの有給を使い果たしました。<br>チーム評価 <b>${team.score.toLocaleString()}</b>`,
      list: memberScores().map((s, i) => ({ pid: s.pid, rank: i + 1, name: s.name, right: s.score.toLocaleString(), sub: '' })),
      party: true,
    });
  }

  // ---------- 通信 ----------
  let lastSend = 0, lastSnap = 0, lastForcedHello = 0;
  function stateMsg() {
    const active = W && game && ['intro', 'play', 'clear'].includes(phase);
    return {
      n: me.name, c: me.char, ph: phase, rid: game ? game.rid : null, md: game ? game.mode : null,
      ci: game ? game.ci : 0, sq: W ? W.seq : 0,
      x: Math.round(me.x), y: Math.round(me.y), vx: Math.round(me.vx), vy: Math.round(me.vy),
      f: me.facing, b: me.big ? 1 : 0, d: me.dead ? 1 : 0, k: me.skip ? 1 : 0, i: me.inv > 0 ? 1 : 0,
      h: me.hurt > 0 ? 1 : 0, z: me.stun > 0 ? 1 : 0, g: me.onGround ? 1 : 0,
      sc: me.score, cn: me.coins, sx: Math.round(me.safe.x), sy: Math.round(me.safe.y),
      pr: active ? game.ci * 100000 + Math.round(me.x) : 0,
      ps: Party.isHost ? partyMode : undefined, cs: Party.isHost ? courseSel : undefined,
    };
  }
  function maybeSend(t) {
    if (!me.pid || Party.state !== 'open') return;
    const active = ['intro', 'play', 'clear'].includes(phase);
    if (t - lastSend >= (active ? 1000 / CFG.sendHz : CFG.idleSendMs)) {
      lastSend = t;
      Party.send('st', stateMsg());
    }
    // 協力プレイのホストは敵やアイテムの位置を配る
    if (game && game.mode === 'coop' && Party.isHost && W && active && t - lastSnap >= 1000 / CFG.snapHz) {
      lastSnap = t;
      const s = World.snapshot(W);
      s.rid = game.rid;
      s.lv = game.lives;
      s.cp = game.teamCp;
      Party.send('ws', s);
    }
  }

  function updateOther(pid, data, t) {
    let o = others.get(pid);
    if (!o) {
      o = { pid };
      others.set(pid, o);
      if (t - lastForcedHello > 500) { lastForcedHello = t; lastSend = 0; }
    }
    Object.assign(o, { name: data.n || '???', char: data.c === 'f' ? 'f' : 'm', st: data, recv: t, lastSeen: t });
    if (pid === Party.hostPid && data.ps) { hostSel.mode = data.ps; hostSel.course = data.cs; }
  }
  const hostSel = { mode: null, course: null };

  // 受信した位置を、少し先を予測しながらなめらかに表示する
  function stepOthers(dt) {
    const t = now();
    for (const [pid, o] of others) {
      if (t - o.lastSeen > CFG.timeoutMs) { others.delete(pid); continue; }
      const s = o.st;
      const age = Math.min(0.2, (t - o.recv) / 1000);
      const big = !!s.b;
      const tx = s.x + (s.vx || 0) * age, ty = s.y + (s.g ? 0 : (s.vy || 0) * age * 0.5);
      if (!o.d || Math.abs(tx - o.d.x) > 240 || Math.abs(ty - o.d.y) > 240) o.d = { x: tx, y: ty, anim: 0 };
      const k = Math.min(1, dt * 12);
      o.d.x += (tx - o.d.x) * k;
      o.d.y += (ty - o.d.y) * k;
      Object.assign(o.d, {
        w: big ? SIZE.big.w : SIZE.small.w, h: big ? SIZE.big.h : SIZE.small.h, big, char: o.char,
        facing: s.f || 1, vx: s.vx || 0, vy: s.vy || 0, onGround: !!s.g, dead: !!s.d, deadT: s.d ? (o.d.deadT || 0) + dt : 0,
        skip: !!s.k, inv: s.i ? 1 : 0, hurt: s.h ? 0.5 : 0, stun: s.z ? 1 : 0,
      });
      if (o.d.onGround && Math.abs(o.d.vx) > 10) o.d.anim += Math.abs(o.d.vx) * dt * 0.045;
    }
  }

  function gotStepped(pid) {
    if (!game || phase !== 'play' || me.dead) return;
    if (game.mode === 'versus') {
      me.stun = 1.0;
      me.vx = 0;
      toast(`${nameOf(pid)} さんに踏みつけられた！ふらふら…`);
    } else toast(`${nameOf(pid)} さんの踏み台になった！`);
    sfx.fumi();
  }

  Party.on('message', ({ event, data }) => {
    const pid = data && data.pid;
    if (!pid || pid === me.pid) return;
    const t = now();
    const fromHost = pid === Party.hostPid;
    if (event === 'st') return updateOther(pid, data, t);
    if (event === 'start') { if (fromHost && (phase === 'title' || phase === 'end')) beginParty(data); return; }
    if (event === 'bye') { others.delete(pid); return; }
    if (!game || data.rid !== game.rid) return;
    if (event === 'finish') { if (game.mode === 'versus') recordFinish(pid, data.t); return; }
    if (event === 'fumi') { if (data.to === me.pid) gotStepped(pid); return; }
    if (game.mode !== 'coop' || !W) return;

    // ---- 協力プレイ ----
    if (event === 'coin') {
      if (data.sq === W.seq && W.coins[data.i]) W.coins[data.i].taken = true;
      return;
    }
    if (Party.isHost) {
      if (data.sq !== W.seq) return;
      remoteFx = true;
      try {
        if (event === 'hit') {
          const res = World.hitBlock(W, data.c, data.r, !!data.big, { local: false, spawn: true });
          if (res) sendCoop('blk', { c: data.c, r: data.r, t: W.tiles[data.r * W.w + data.c], fx: res, by: pid });
        } else if (event === 'stomp') {
          if (data.n === -1) World.stunChaser(W);
          else if (W.enemies[data.n]) World.killEnemy(W, W.enemies[data.n], data.how || 'flat', false);
        } else if (event === 'take') World.takeItem(W, data.id);
        else if (event === 'dead') hostDead(data.k);
        else if (event === 'goal') hostClear(pid);
        else if (event === 'life') game.lives++;
        else if (event === 'gtime') { if (isFinite(W.time)) W.time += Math.min(30, Number(data.s) || 0); }
        else if (event === 'cp') { game.teamCp = Math.max(game.teamCp == null ? -1 : game.teamCp, data.i); }
      } finally {
        remoteFx = false;
      }
      return;
    }
    if (!fromHost) return;
    if (event === 'ws') {
      if (data.sq !== W.seq) return;
      World.applySnapshot(W, data, localKilled);
      game.lives = data.lv;
      if (data.cp != null && (cpReached == null || cpReached < data.cp)) cpReached = data.cp;
    } else if (event === 'blk') {
      if (data.sq !== W.seq || data.by === me.pid) return;
      remoteFx = true;
      World.applyBlock(W, data.c, data.r, data.t, data.fx);
      remoteFx = false;
    } else if (event === 'clear') {
      if (data.sq === W.seq) startClear(data.by);
    } else if (event === 'stage') {
      game.lives = data.lv;
      game.clearing = false;
      game.clearDone = false;
      enterStage(data.ci, { seq: data.sq, cp: data.cp, keepBig: data.ci !== game.ci });
    } else if (event === 'timeup') {
      if (data.sq === W.seq) die('time');
    } else if (event === 'over') {
      game.over = true;
      coopOver();
    } else if (event === 'end') {
      coopEnding();
    }
  });

  // ---------- パーティー（ロビー） ----------
  let partyError = '', partyNote = '';
  const openParties = new Map();
  const myInfo = () => ({ pid: me.pid, name: me.name, av: '' });

  Party.on('roster', members => {
    const ids = new Set(members.map(m => m.pid));
    for (const pid of others.keys()) if (!ids.has(pid)) others.delete(pid);
    lastSend = 0;
    updateMode();
    renderLobby();
  });
  Party.on('left', pid => {
    others.delete(pid);
    if (game && game.mode === 'versus') checkVersusEnd();
  });
  Party.on('state', st => {
    if (st === 'none') {
      others.clear();
      if (game && game.mode !== 'solo') backToTitle();
    }
    updateMode();
    renderLobby();
  });
  Party.on('error', msg => { partyError = msg; renderLobby(); });

  setInterval(() => {
    if (Party.isHost && Party.state === 'open') Net.send('party-teiji', { code: Party.code, host: me.name, n: Party.members.length });
  }, 3000);
  Net.on('message', ({ event, data }) => {
    if (event === 'party-teiji' && data && /^[A-Z0-9]{4}$/.test(data.code)) {
      openParties.set(data.code, { code: data.code, host: String(data.host || '???'), n: Number(data.n) || 1, at: now() });
    }
  });

  // ---------- 更新 ----------
  let acc = 0;
  function update(dt, t) {
    if (!W) return;
    if (phase === 'intro' && t >= introUntil) {
      phase = 'play';
      if (game && game.mode === 'versus' && game.ci === 0 && !game.started) { game.started = true; game.startAt = t; }
      startBgm();
      showPanels();
    }
    acc = Math.min(acc + dt, 0.1);
    while (acc >= STEP) {
      acc -= STEP;
      fixedStep(STEP);
    }
    stepOthers(dt);
    Render.stepEffects(W, dt);
    for (const [n, at] of localKilled) if (t - at > 3000) localKilled.delete(n);
    checkTime();

    if (game && game.mode === 'coop' && Party.isHost) {
      if (game.overAt && t >= game.overAt && !game.over) hostOver();
      if (game.timeupAt && t >= game.timeupAt) {
        game.timeupAt = 0;
        if (game.lives > 0) { game.lives--; hostRestart(); }
        else hostOver();
      }
      if (cpReached != null && (game.teamCp == null || cpReached > game.teamCp)) game.teamCp = cpReached;
    }
    if (game && game.mode === 'versus') checkVersusEnd();

    // カメラ
    const vw = Render.view.w;
    if (phase === 'title') {
      cam.x += dt * 60;
      if (cam.x > W.pxW - vw) { W = World.build(0, ++worldSeq); cam.x = 0; }
    } else if (W.pxW <= vw) cam.x = (W.pxW - vw) / 2;
    else {
      const target = me.x + me.w / 2 - vw * 0.4 + me.facing * 20;
      if (!me.dead) cam.x += (target - cam.x) * Math.min(1, dt * 6);
      cam.x = Math.max(0, Math.min(W.pxW - vw, cam.x));
    }
  }

  function fixedStep(dt) {
    if (phase === 'title') {
      World.step(W, dt, [], cam.x + Render.view.w + 40);
      Gimmicks.update(W, dt, null);
      return;
    }
    if (phase === 'intro' || phase === 'end') return;
    if (isAuth()) {
      const players = [];
      if (!me.dead) players.push(me);
      if (game.mode === 'coop') for (const o of others.values()) if (o.d && sameWorld(o) && !o.st.d) players.push(o.d);
      World.step(W, dt, players);
      if (phase === 'play' && isFinite(W.time)) W.time -= dt;
    } else {
      W.clock += dt;
      World.updateLifts(W);
      World.smooth(W, dt);
      if (phase === 'play' && isFinite(W.time)) W.time = Math.max(0, W.time - dt);
    }
    Gimmicks.update(W, dt, phase === 'play' || phase === 'clear' ? me : null);
    if (phase === 'play') {
      if (me.dead) stepDead(dt);
      else stepPlayer(dt);
    } else if (phase === 'clear') stepClear(dt);
  }

  function draw(t) {
    if (!W) return;
    const list = [];
    if (game && game.mode !== 'solo') {
      for (const o of others.values()) {
        if (!o.d || !sameWorld(o)) continue;
        list.push({ p: o.d, label: o.name, color: colorOf(o.pid), alpha: game.mode === 'versus' ? 0.6 : 1 });
      }
    }
    Render.draw({
      W, camX: cam.x, t: t / 1000, me, others: list, attract: phase === 'title',
      cpReached, goalClock: W.goalClock || clockText(W),
      meLabel: game && game.mode !== 'solo' ? me.name : null, meColor: colorOf(me.pid),
    });
  }

  // ---------- UI ----------
  const ui = {
    hud: $('hud'), hudScoreL: $('hudScoreL'), hudScore: $('hudScore'), hudCoins: $('hudCoins'), hudWorld: $('hudWorld'),
    hudTimeL: $('hudTimeL'), hudTime: $('hudTime'), hudLivesL: $('hudLivesL'), hudLives: $('hudLives'),
    intro: $('intro'), lobby: $('lobby'), end: $('endPanel'), banner: $('banner'), toasts: $('toasts'),
    mode: $('mode'), diag: $('diag'), focusHint: $('focusHint'), sound: $('soundBtn'),
    noParty: $('noParty'), inParty: $('inParty'), openParties: $('openParties'), codeInput: $('codeInput'),
    codeText: $('codeText'), players: $('players'), hostControls: $('hostControls'), lobbyNote: $('lobbyNote'),
    startBtn: $('startBtn'), soloBtn: $('soloBtn'),
  };
  const setHTML = (el, html) => { if (el.innerHTML !== html) el.innerHTML = html; };
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

  function toast(text, ms = 2200) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    ui.toasts.appendChild(el);
    while (ui.toasts.children.length > 3) ui.toasts.firstChild.remove();
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  function showPanels() {
    ui.lobby.classList.toggle('hidden', phase !== 'title');
    ui.end.classList.toggle('hidden', phase !== 'end');
    ui.intro.classList.toggle('hidden', phase !== 'intro');
    ui.hud.classList.toggle('hidden', !['intro', 'play', 'clear'].includes(phase));
    document.body.classList.toggle('playing', ['intro', 'play', 'clear'].includes(phase));
    if (phase === 'title') renderLobby();
  }

  function renderIntro(countdown) {
    const info = W.S;
    setText($('introWorld'), 'WORLD ' + info.id + '　' + (Levels.WORLDS[Number(info.id.split('-')[0]) - 1] || ''));
    setText($('introName'), info.name);
    setText($('introMemo'), info.memo);
    Render.spriteToCanvas($('introChar'), 'player_' + me.char, 70, true);
    const livesText =
      game.mode === 'solo' ? `× ${game.lives}` :
      game.mode === 'coop' ? `協力プレイ　チーム有給 × ${game.lives}` : '対戦プレイ　いちばん早く定時退社した人の勝ち';
    setText($('introLives'), livesText);
    $('introCount').classList.toggle('hidden', !countdown);
  }

  function renderEnd() {
    const o = endInfo;
    setText($('endTitle'), o.title.replace(/<[^>]+>/g, ''));
    Render.spriteToCanvas($('endArt'), o.art, o.art === 'zangyou' ? 150 : 130);
    setHTML($('endText'), o.text);
    setHTML(
      $('endList'),
      (o.list || [])
        .map(s => `<li class="${s.pid === me.pid ? 'me' : ''}"><b>${s.rank}</b><i style="background:${colorOf(s.pid)}"></i><span>${esc(s.name)}${s.sub ? ` <small>${esc(s.sub)}</small>` : ''}</span><em>${esc(s.right)}</em></li>`)
        .join('')
    );
    const party = !!o.party;
    $('againBtn').classList.toggle('hidden', party ? !Party.isHost : !o.again);
    setText($('titleBtn'), party ? 'ロビーへ' : 'タイトルへ');
    setText($('endNote'), party && !Party.isHost ? 'ホストが次のゲームを始めるのを待っています。' : '');
  }
  $('againBtn').addEventListener('click', e => {
    e.currentTarget.blur();
    if (game && game.mode !== 'solo') requestStart();
    else startSolo();
  });
  $('titleBtn').addEventListener('click', e => { e.currentTarget.blur(); backToTitle(); });

  function updateHud(t) {
    if (!['intro', 'play', 'clear'].includes(phase) || !game) {
      ui.banner.classList.add('hidden');
      ui.focusHint.classList.toggle('hidden', document.hasFocus() || phase === 'title' || phase === 'end');
      return;
    }
    if (phase === 'intro') {
      const left = Math.ceil((introUntil - t) / 1000);
      setText($('introCount'), left > 3 ? 'READY' : left > 0 ? String(left) : 'スタート！');
    }
    setText(ui.hudWorld, W.S.id);
    if (game.mode === 'coop') {
      const team = teamTotals();
      setText(ui.hudScoreL, 'チーム評価');
      setText(ui.hudScore, String(team.score).padStart(6, '0'));
      setText(ui.hudCoins, '×' + String(team.coins).padStart(2, '0'));
      setText(ui.hudLivesL, 'チーム有給');
      setText(ui.hudLives, '×' + game.lives);
    } else {
      setText(ui.hudScoreL, '評価');
      setText(ui.hudScore, String(me.score).padStart(6, '0'));
      setText(ui.hudCoins, '×' + String(me.coins).padStart(2, '0'));
      if (game.mode === 'solo') { setText(ui.hudLivesL, '有給'); setText(ui.hudLives, '×' + game.lives); }
      else {
        const st = standings();
        setText(ui.hudLivesL, '順位');
        setText(ui.hudLives, `${st.findIndex(s => s.pid === me.pid) + 1}/${st.length}`);
      }
    }
    if (game.mode === 'versus') {
      setText(ui.hudTimeL, 'タイム');
      const mine = game.finishes.get(me.pid);
      setText(ui.hudTime, fmtTime(mine != null ? mine : game.started ? t - game.startAt : 0));
      ui.hudTime.classList.remove('hurry');
    } else {
      setText(ui.hudTimeL, '定時 18:00 まで');
      setText(ui.hudTime, phase === 'clear' ? W.goalClock || clockText(W) : clockText(W));
      ui.hudTime.classList.toggle('hurry', W.time <= 30);
    }

    let banner = '';
    if (game.mode === 'versus' && game.finishes.has(me.pid) && phase === 'clear') {
      const rank = standings().findIndex(s => s.pid === me.pid) + 1;
      const wait = Math.max(0, Math.ceil((CFG.finishWaitMs - (now() - game.firstFinishAt)) / 1000));
      banner = `定時退社！ ${rank}位 ${fmtTime(game.finishes.get(me.pid))}<small>ほかの人を待っています…（最大 ${wait} 秒）</small>`;
    } else if (me.dead && game.mode === 'coop' && me.deadKind !== 'time' && !game.over) {
      banner = '少し休憩…<small>まもなく仲間のところから再開します</small>';
    }
    setHTML(ui.banner, banner);
    ui.banner.classList.toggle('hidden', !banner);
    ui.focusHint.classList.toggle('hidden', document.hasFocus());
  }

  // ロビー
  function setChar(c) {
    me.char = c;
    save('ovice-teiji:char', c);
    document.querySelectorAll('[data-char]').forEach(b => b.classList.toggle('sel', b.dataset.char === c));
    lastSend = 0;
  }
  document.querySelectorAll('[data-char]').forEach(b => {
    Render.spriteToCanvas(b.querySelector('canvas'), 'player_' + b.dataset.char, 64, true);
    b.addEventListener('click', () => { setChar(b.dataset.char); b.blur(); });
  });
  setChar(me.char);
  // ワールドのボタン（季節のアイコン付き）と、選んだワールドのステージのボタン
  const WORLD_ICON = ['🏢', '🌸', '🌻', '🍁', '⛄', '📊'];
  {
    const row = $('worldRow');
    Levels.WORLDS.forEach((name, i) => {
      const b = document.createElement('button');
      b.dataset.world = i + 1;
      b.textContent = `${WORLD_ICON[i] || ''} ${i + 1}`;
      b.title = name;
      row.appendChild(b);
    });
    const all = document.createElement('button');
    all.dataset.course = 'all';
    all.textContent = '全ステージ';
    row.appendChild(all);
  }
  function renderCourse(sel, locked) {
    const wn = worldOfSel(sel);
    document.querySelectorAll('[data-world]').forEach(b => b.classList.toggle('sel', Number(b.dataset.world) === wn));
    const row = $('stageRow');
    row.classList.toggle('hidden', !wn);
    if (wn && row.dataset.world !== String(wn)) {
      row.dataset.world = wn;
      row.querySelectorAll('button').forEach(b => b.remove());
      const add = (v, text, title) => {
        const b = document.createElement('button');
        b.dataset.course = v;
        b.textContent = text;
        if (title) b.title = title;
        row.appendChild(b);
      };
      add('w' + wn, '通しで遊ぶ');
      Levels.worldStages(wn).forEach(i => add(String(i), Levels.info(i).id, Levels.info(i).name));
    }
    document.querySelectorAll('[data-course]').forEach(b => { b.classList.toggle('sel', b.dataset.course === sel); b.disabled = !!locked; });
    document.querySelectorAll('[data-world]').forEach(b => (b.disabled = !!locked));
    setText($('courseInfo'), courseInfo(sel));
  }
  function setCourse(v, persist = true) {
    courseSel = v;
    if (persist) save('ovice-teiji:course2', v);
    renderCourse(v, false);
    lastSend = 0;
  }
  ui.lobby.addEventListener('click', e => {
    const b = e.target.closest('[data-course],[data-world]');
    if (!b) return;
    b.blur();
    if (Party.state !== 'none' && !Party.isHost) return;
    setCourse(b.dataset.world ? 'w' + b.dataset.world : b.dataset.course);
  });
  setCourse(courseSel, false);
  function setPartyMode(m) {
    partyMode = m;
    save('ovice-teiji:mode', m);
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('sel', b.dataset.mode === m));
    lastSend = 0;
  }
  document.querySelectorAll('[data-mode]').forEach(b =>
    b.addEventListener('click', () => { b.blur(); if (Party.isHost || Party.state === 'none') setPartyMode(b.dataset.mode); })
  );
  setPartyMode(partyMode);
  ui.soloBtn.addEventListener('click', e => { e.currentTarget.blur(); ensureAudio(); startSolo(); });
  ui.startBtn.addEventListener('click', e => { e.currentTarget.blur(); ensureAudio(); requestStart(); });

  const doJoin = code => {
    if (!me.pid) return;
    partyError = '';
    partyNote = '';
    Party.join(code, myInfo());
    renderLobby();
  };
  $('createBtn').addEventListener('click', e => {
    e.currentTarget.blur();
    if (!me.pid) return;
    partyError = '';
    partyNote = '';
    Party.create(myInfo());
    renderLobby();
  });
  $('joinBtn').addEventListener('click', e => { e.currentTarget.blur(); doJoin(ui.codeInput.value); });
  ui.codeInput.addEventListener('input', () => { ui.codeInput.value = ui.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
  ui.codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') { ui.codeInput.blur(); doJoin(ui.codeInput.value); } });
  ui.openParties.addEventListener('click', e => { const b = e.target.closest('[data-join]'); if (b) doJoin(b.dataset.join); });
  $('leaveBtn').addEventListener('click', e => { e.currentTarget.blur(); Party.leave(); });
  $('copyBtn').addEventListener('click', e => {
    const btn = e.currentTarget;
    btn.blur();
    try { navigator.clipboard.writeText(Party.code).then(() => { btn.textContent = 'コピー済'; setTimeout(() => (btn.textContent = 'コピー'), 1500); }, () => {}); } catch (err) {}
  });

  function renderLobby() {
    const inP = Party.state !== 'none';
    ui.noParty.classList.toggle('hidden', inP);
    ui.inParty.classList.toggle('hidden', !inP);
    ui.soloBtn.classList.toggle('hidden', inP);
    $('createBtn').disabled = $('joinBtn').disabled = !me.pid;
    const locked = inP && !Party.isHost;
    document.querySelectorAll('[data-mode]').forEach(b => (b.disabled = locked));
    if (locked && hostSel.course && validSel(hostSel.course)) {
      renderCourse(hostSel.course, true);
      document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('sel', b.dataset.mode === hostSel.mode));
    } else renderCourse(courseSel, locked);
    $('modeRow').classList.toggle('hidden', !inP);
    ui.lobbyNote.classList.toggle('error', !inP && !!partyError);

    if (!inP) {
      const list = [...openParties.values()].filter(p => now() - p.at < 10000);
      setHTML(
        ui.openParties,
        list.length
          ? '<li class="label">oVice で募集中のパーティー</li>' +
              list.map(p => `<li><span>${esc(p.host)} のパーティー（${p.n}人）</span><button data-join="${p.code}">参加</button></li>`).join('')
          : ''
      );
      setText(ui.lobbyNote, partyError || 'みんなで遊ぶときは、パーティーを作ってコードを伝えるか、教えてもらったコードで参加してください。');
      return;
    }
    setText(ui.codeText, Party.code || '----');
    if (Party.state === 'connecting') {
      setHTML(ui.players, '');
      ui.hostControls.classList.add('hidden');
      setText(ui.lobbyNote, Party.isHost ? 'パーティーを作成中…' : '接続中…');
      return;
    }
    const tag = o => (o && ['intro', 'play', 'clear'].includes(o.st.ph) ? '<span class="tag busy">プレイ中</span>' : o && o.st.ph === 'end' ? '<span class="tag">結果画面</span>' : '');
    setHTML(
      ui.players,
      Party.members
        .map(m => {
          const isMe = m.pid === me.pid;
          const o = others.get(m.pid);
          const crown = m.pid === Party.hostPid ? '<span class="crown" title="ホスト">👑</span>' : '';
          return `<li><i style="background:${colorOf(m.pid)}"></i>${crown}${esc(isMe ? me.name : m.name)}${isMe ? ' <small>(あなた)</small>' : ''}${isMe ? '' : tag(o)}</li>`;
        })
        .join('')
    );
    ui.hostControls.classList.toggle('hidden', !Party.isHost);
    const busy = someoneBusy();
    ui.startBtn.disabled = busy;
    const n = Party.members.length;
    setText(
      ui.lobbyNote,
      partyNote ||
        (!Party.isHost
          ? 'ホストがゲームを始めるのを待っています。'
          : busy
            ? 'まだプレイ中のメンバーがいます。終わるまでお待ちください。'
            : n === 1
              ? 'コードを伝えて仲間を呼びましょう。'
              : partyMode === 'coop'
                ? `${n} 人で協力プレイ：ブロックや敵はみんなで共有。誰かがタイムカードを押せばクリア！`
                : `${n} 人で対戦プレイ：同じコースを同時に走って、早く定時退社した人の勝ち。踏みつけると相手がふらふらに。`)
    );
  }

  function updateMode() {
    const who = Net.mode === 'ovice' ? `oVice：${me.name}` : Net.mode === 'local' ? me.name : '接続中…';
    const party = Party.state === 'open' ? `　パーティー ${Party.code}（${Party.members.length}人）` : Party.state === 'connecting' ? '　パーティー接続中…' : '';
    ui.mode.textContent = who + party;
  }
  Net.on('self', self => {
    me.pid = self.pid;
    me.name = self.name;
    lastSend = 0;
    if (Party.state !== 'none') Party.updateSelf(myInfo());
    updateMode();
    if (phase === 'title') renderLobby();
  });
  Net.on('mode', updateMode);

  function renderDiag() {
    if (ui.diag.classList.contains('hidden')) return;
    ui.diag.textContent = [
      `バージョン: ${VERSION}`,
      `モード: ${Net.mode}`,
      `自分: ${me.name || '-'} (${me.pid || '-'})`,
      `oVice 参加者: ${Net.participants.map(p => p.name || '(名前なし)').join(', ') || '-'}`,
      `パーティー: ${Party.state}${Party.code ? ' ' + Party.code : ''}${Party.isHost ? '（ホスト）' : ''} / メンバー: ${Party.members.map(m => m.name).join(', ') || '-'}`,
      `ゲーム: ${game ? game.mode + ' ' + phase : phase}`,
      '',
      ...Net.log,
    ].join('\n');
  }
  ui.mode.addEventListener('click', () => { ui.diag.classList.toggle('hidden'); renderDiag(); });
  Net.on('log', renderDiag);
  setInterval(renderDiag, 1000);

  const SOUND_LABEL = ['🔊', '🔈', '🔇'];
  const SOUND_TITLE = ['音：BGM と効果音', '音：効果音のみ', '音：なし'];
  function setSound(m) {
    soundMode = m;
    save('ovice-teiji:sound', String(m));
    ui.sound.textContent = SOUND_LABEL[m];
    ui.sound.title = SOUND_TITLE[m] + '（クリックで切り替え）';
    if (m === 0 && phase === 'play') startBgm();
    else if (m !== 0) stopBgm();
  }
  ui.sound.addEventListener('click', e => { e.currentTarget.blur(); ensureAudio(); setSound((soundMode + 1) % 3); });
  setSound(soundMode);
  setText($('verText'), 'バージョン ' + VERSION);

  // ---------- 起動 ----------
  window.__teiji = { me, others, World, get W() { return W; }, get phase() { return phase; }, get game() { return game; }, startSolo, die, enterStage }; // デバッグ用
  W = World.build(0, ++worldSeq);
  showPanels();
  Net.connect().then(() => { updateMode(); lastSend = 0; renderLobby(); });
  setInterval(() => { if (phase === 'title') renderLobby(); }, 500);
  setInterval(() => maybeSend(now()), 1000);

  let last = now(), lastFrameAt = now();
  function tick(t) {
    const dt = Math.min(0.1, Math.max(0, t - last) / 1000);
    last = t;
    update(dt, t);
    updateHud(t);
    maybeSend(t);
    pumpBgm();
  }
  function frame(t) {
    lastFrameAt = now();
    tick(now());
    draw(now());
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // 画面が隠れて requestAnimationFrame が止まっても、通信と進行は続ける
  setInterval(() => { const t = now(); if (t - lastFrameAt > 250) tick(t); }, 100);
})();
