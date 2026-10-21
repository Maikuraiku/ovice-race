// 描画（キャンバス 2D）。イラストは assets/sprites.webp（いらすとやの素材を縮小してまとめたもの）
const Render = (() => {
  const TILE = World.TILE, VIEW_H = World.VIEW_H, T = Levels.T, ROWS = Levels.ROWS;
  const GROUND_Y = 12 * TILE;
  let canvas = null, ctx = null, dpr = 1, vw = 0, vh = 0;
  const view = { scale: 1, offY: 0, w: 600, top: 0, bottom: VIEW_H };
  const img = { sprites: null, town: null };
  let ready = false;
  const canFilter = (() => { try { return 'filter' in document.createElement('canvas').getContext('2d'); } catch (e) { return false; } })();

  const PAL = {
    office: { top: '#6f7a8e', ground: '#a3abbb', dark: '#8e97a9', brick: '#c96f3b', mortar: '#8a4421', hi: '#e39462', solid: '#b9c0cb', solidDark: '#7d8796', semi: '#d9a066', semiDark: '#9c6b3b' },
    basement: { top: '#6d7d9c', ground: '#4a5873', dark: '#3b465e', brick: '#4e74b8', mortar: '#2d4a80', hi: '#7499d6', solid: '#5d6780', solidDark: '#3e4659', semi: '#8b6b4a', semiDark: '#5e4630' },
    street: { top: '#d8c9ae', ground: '#5d5d68', dark: '#4b4b55', brick: '#d2763f', mortar: '#94471c', hi: '#ec9d66', solid: '#bdb7ae', solidDark: '#8e877c', semi: '#6d8fb3', semiDark: '#47658a' },
  };

  function init(cv, urls) {
    canvas = cv;
    ctx = canvas.getContext('2d');
    window.addEventListener('resize', resize);
    resize();
    return new Promise(resolve => {
      let left = 2;
      const done = () => { if (--left === 0) { ready = true; resolve(); } };
      img.sprites = new Image();
      img.sprites.onload = done;
      // WebP が読めない環境では PNG を使う
      img.sprites.onerror = () => { img.sprites.onerror = done; img.sprites.src = urls.spritesPng; };
      img.sprites.src = urls.sprites;
      img.town = new Image();
      img.town.onload = done;
      img.town.onerror = done;
      img.town.src = urls.town;
    });
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    // 非表示の iframe では大きさが 0 になることがあるので、最低限の大きさで計算する
    vw = Math.max(16, window.innerWidth);
    vh = Math.max(16, window.innerHeight);
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    // 縦 14 マスが入る大きさ。ただし横が狭い画面でも 15 マスは見えるようにする
    view.scale = Math.min(vh / VIEW_H, vw / (15 * TILE));
    view.offY = Math.max(0, (vh - VIEW_H * view.scale) / 2);
    view.w = vw / view.scale;
    view.top = -view.offY / view.scale;
    view.bottom = VIEW_H + view.offY / view.scale;
  }

  // ---------- 小物 ----------
  function spr(name, cx, bottom, h, o = {}) {
    const f = ATLAS[name];
    if (!f || !ready) return;
    const w = (h * f[2]) / f[3];
    ctx.save();
    ctx.translate(cx, bottom);
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale((o.flip ? -1 : 1) * (o.sx || 1), o.sy || 1);
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    const ay = o.anchorY != null ? o.anchorY : 1;
    ctx.drawImage(img.sprites, f[0], f[1], f[2], f[3], -w / 2, -h * ay, w, h);
    ctx.restore();
  }
  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  function outlinedText(text, x, y, size, fill, stroke = 'rgba(0,0,0,0.75)', align = 'center') {
    ctx.font = `800 ${size}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Meiryo", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, size / 5);
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  // スプライトを DOM の <canvas> に描く（ロビーや結果画面の絵）
  function spriteToCanvas(el, name, h, flip = false) {
    const f = ATLAS[name];
    if (!f || !el) return;
    const d = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round((h * f[2]) / f[3]);
    el.width = w * d;
    el.height = h * d;
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    const c = el.getContext('2d');
    const draw = () => {
      c.setTransform(d, 0, 0, d, 0, 0);
      c.clearRect(0, 0, w, h);
      if (flip) { c.translate(w, 0); c.scale(-1, 1); }
      c.drawImage(img.sprites, f[0], f[1], f[2], f[3], 0, 0, w, h);
    };
    if (ready) draw();
    else img.sprites.addEventListener('load', draw, { once: true });
  }

  // ---------- 背景 ----------
  function background(theme, camX, t) {
    const w = view.w, top = view.top, bottom = view.bottom;
    if (theme === 'office') {
      const g = ctx.createLinearGradient(0, top, 0, bottom);
      g.addColorStop(0, '#e6dfd0');
      g.addColorStop(1, '#f6f1e7');
      ctx.fillStyle = g;
      ctx.fillRect(0, top, w, bottom - top);
      // 窓（夕方の空と遠くのビル）
      const P = 340, off = (camX * 0.75) % P;
      for (let i = -1; i < w / P + 1; i++) {
        const n = Math.floor((camX * 0.75) / P) + i;
        const x = i * P - off + 50;
        ctx.fillStyle = '#c8bfae';
        ctx.fillRect(x - 8, 62, 256, 236);
        const sky = ctx.createLinearGradient(0, 70, 0, 290);
        sky.addColorStop(0, '#8cc8ef');
        sky.addColorStop(1, '#ffd9a6');
        ctx.fillStyle = sky;
        ctx.fillRect(x, 70, 240, 220);
        ctx.fillStyle = '#b4c3d6';
        for (let b = 0; b < 6; b++) {
          const bh = 40 + hash(n * 7 + b) * 110, bw = 30 + hash(n * 5 + b) * 20;
          ctx.fillRect(x + b * 40, 290 - bh, bw, bh);
        }
        ctx.fillStyle = '#c8bfae';
        ctx.fillRect(x + 116, 70, 8, 220);
        ctx.fillRect(x, 176, 240, 6);
      }
      // 天井と照明
      ctx.fillStyle = '#d4ccbb';
      ctx.fillRect(0, top, w, 40 - top);
      const L = 260, loff = (camX * 0.9) % L;
      for (let i = -1; i < w / L + 1; i++) {
        const x = i * L - loff;
        ctx.fillStyle = '#fffbe8';
        ctx.fillRect(x + 60, 34, 120, 8);
      }
      // 奥の机（いらすとや「綺麗なオフィス」）
      const D = 620, doff = (camX * 0.55) % D;
      for (let i = -1; i < w / D + 1; i++) spr('office', i * D - doff + 260, GROUND_Y - 14, 180, { alpha: 0.55 });
      ctx.fillStyle = '#d3cab8';
      ctx.fillRect(0, GROUND_Y - 12, w, 12);
    } else if (theme === 'basement') {
      const g = ctx.createLinearGradient(0, top, 0, bottom);
      g.addColorStop(0, '#141a27');
      g.addColorStop(1, '#232c41');
      ctx.fillStyle = g;
      ctx.fillRect(0, top, w, bottom - top);
      // 書庫の棚
      const P = 300, off = (camX * 0.5) % P;
      const spines = ['#6b5b4a', '#4a6274', '#7a4a4a', '#5b6b48', '#8a7a5a', '#55507a'];
      for (let i = -1; i < w / P + 1; i++) {
        const n = Math.floor((camX * 0.5) / P) + i;
        const x = i * P - off + 30;
        ctx.fillStyle = '#2a3144';
        ctx.fillRect(x, 90, 230, GROUND_Y - 90);
        for (let s = 0; s < 4; s++) {
          const sy = 100 + s * 92;
          let bx = x + 8;
          let k = 0;
          while (bx < x + 220) {
            const bw = 8 + hash(n * 31 + s * 7 + k) * 12;
            const bh = 50 + hash(n * 17 + s * 3 + k) * 30;
            ctx.fillStyle = spines[Math.floor(hash(n + s * 11 + k * 3) * spines.length)];
            ctx.globalAlpha = 0.75;
            ctx.fillRect(bx, sy + 84 - bh, Math.min(bw, x + 222 - bx), bh);
            ctx.globalAlpha = 1;
            bx += bw + 2;
            k++;
          }
          ctx.fillStyle = '#3a4258';
          ctx.fillRect(x, sy + 84, 230, 8);
        }
      }
      // 吊り下げ照明
      const L = 420, loff = (camX * 0.8) % L;
      for (let i = -1; i < w / L + 1; i++) {
        const x = i * L - loff + 200;
        const glow = ctx.createRadialGradient(x, 120, 4, x, 120, 170);
        glow.addColorStop(0, 'rgba(255,230,160,0.35)');
        glow.addColorStop(1, 'rgba(255,230,160,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(x - 170, 0, 340, 300);
        ctx.strokeStyle = '#555c70';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 80);
        ctx.lineTo(x, 110);
        ctx.stroke();
        ctx.fillStyle = '#e8d9a8';
        ctx.beginPath();
        ctx.moveTo(x - 18, 124);
        ctx.lineTo(x + 18, 124);
        ctx.lineTo(x + 8, 108);
        ctx.lineTo(x - 8, 108);
        ctx.fill();
      }
    } else {
      const g = ctx.createLinearGradient(0, top, 0, GROUND_Y);
      g.addColorStop(0, '#2f2f60');
      g.addColorStop(0.45, '#b45f80');
      g.addColorStop(0.78, '#f39b6b');
      g.addColorStop(1, '#ffd38c');
      ctx.fillStyle = g;
      ctx.fillRect(0, top, w, bottom - top);
      const sx = w * 0.7 - camX * 0.04;
      const sun = ctx.createRadialGradient(sx, 250, 10, sx, 250, 180);
      sun.addColorStop(0, 'rgba(255,240,190,1)');
      sun.addColorStop(0.25, 'rgba(255,220,150,0.9)');
      sun.addColorStop(1, 'rgba(255,200,140,0)');
      ctx.fillStyle = sun;
      ctx.fillRect(sx - 180, 70, 360, 360);
      const C = 760, coff = (camX * 0.12) % C;
      for (let i = -1; i < w / C + 1; i++) {
        const n = Math.floor((camX * 0.12) / C) + i;
        spr('kumo', i * C - coff + 200 + hash(n) * 200, 120 + hash(n + 3) * 70, 150, { alpha: 0.75 });
      }
      if (img.town && img.town.naturalWidth) {
        const th = 320, tw = (th * img.town.naturalWidth) / img.town.naturalHeight;
        const toff = (camX * 0.3) % tw;
        for (let i = -1; i < w / tw + 1; i++) ctx.drawImage(img.town, i * tw - toff, GROUND_Y - th, tw + 1, th);
        // 夕焼けの色をかぶせる
        const tint = ctx.createLinearGradient(0, GROUND_Y - th, 0, GROUND_Y);
        tint.addColorStop(0, 'rgba(255,150,110,0.35)');
        tint.addColorStop(1, 'rgba(120,70,110,0.35)');
        ctx.fillStyle = tint;
        ctx.fillRect(0, GROUND_Y - th, w, th);
      }
    }
  }

  // ---------- 地形 ----------
  function drawTile(W, pal, t, c, r, x, y, time) {
    switch (t) {
      case T.GROUND: {
        const above = r > 0 ? W.tiles[(r - 1) * W.w + c] : T.EMPTY;
        ctx.fillStyle = r >= 13 ? pal.dark : pal.ground;
        ctx.fillRect(x, y, TILE + 0.6, TILE + 0.6);
        if (above !== T.GROUND) {
          ctx.fillStyle = pal.top;
          ctx.fillRect(x, y, TILE + 0.6, W.S.theme === 'street' ? 16 : 7);
          if (W.S.theme === 'street') {
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            ctx.fillRect(x + TILE - 2, y, 2, 16);
            ctx.fillRect(x, y + 14, TILE, 2);
          }
        }
        if (W.S.theme === 'basement') {
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.fillRect(x, y + TILE - 2, TILE, 2);
          ctx.fillRect(x + ((r % 2) ? 0 : TILE / 2), y, 2, TILE);
        } else if (W.S.theme === 'office' && above !== T.GROUND) {
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(x + 4, y + 12, TILE - 8, 3);
        }
        break;
      }
      case T.BRICK: {
        ctx.fillStyle = pal.mortar;
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = pal.brick;
        const h2 = TILE / 2;
        ctx.fillRect(x + 1, y + 1, h2 - 2, h2 - 2);
        ctx.fillRect(x + h2 + 1, y + 1, h2 - 2, h2 - 2);
        ctx.fillRect(x + 1, y + h2 + 1, h2 / 2 - 2, h2 - 2);
        ctx.fillRect(x + h2 / 2 + 1, y + h2 + 1, h2 - 2, h2 - 2);
        ctx.fillRect(x + h2 * 1.5 + 1, y + h2 + 1, h2 / 2 - 2, h2 - 2);
        ctx.fillStyle = pal.hi;
        ctx.fillRect(x + 1, y + 1, TILE - 2, 3);
        break;
      }
      case T.QBLOCK: {
        const glow = 0.5 + 0.5 * Math.sin(time * 4 + c * 0.7);
        rrect(x + 1, y + 1, TILE - 2, TILE - 2, 6);
        const g = ctx.createLinearGradient(0, y, 0, y + TILE);
        g.addColorStop(0, '#ffe082');
        g.addColorStop(1, '#f5a623');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#b26a00';
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${0.15 + glow * 0.25})`;
        ctx.fillRect(x + 6, y + 5, TILE - 12, 4);
        outlinedText('？', x + TILE / 2, y + TILE / 2 + 2, 26, '#fff', '#b26a00');
        break;
      }
      case T.USED: {
        rrect(x + 1, y + 1, TILE - 2, TILE - 2, 5);
        ctx.fillStyle = '#b48a60';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#7b5a3a';
        ctx.stroke();
        ctx.fillStyle = '#7b5a3a';
        for (const [dx, dy] of [[8, 8], [TILE - 8, 8], [8, TILE - 8], [TILE - 8, TILE - 8]]) ctx.fillRect(x + dx - 2, y + dy - 2, 4, 4);
        break;
      }
      case T.SOLID: {
        ctx.fillStyle = pal.solidDark;
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = pal.solid;
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        if (W.S.theme === 'office' && r > 1) {
          // キャビネット
          ctx.fillStyle = pal.solidDark;
          ctx.fillRect(x + 4, y + TILE / 2 - 1, TILE - 8, 2);
          ctx.fillRect(x + TILE / 2 - 6, y + 10, 12, 3);
          ctx.fillRect(x + TILE / 2 - 6, y + TILE / 2 + 9, 12, 3);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(x + 2, y + 2, TILE - 4, 3);
          ctx.fillStyle = 'rgba(0,0,0,0.12)';
          ctx.fillRect(x + 2, y + TILE - 5, TILE - 4, 3);
        }
        break;
      }
      case T.SEMI: {
        ctx.fillStyle = pal.semiDark;
        ctx.fillRect(x, y, TILE + 0.6, 12);
        ctx.fillStyle = pal.semi;
        ctx.fillRect(x, y + 1, TILE + 0.6, 8);
        const below = r < ROWS - 1 ? W.tiles[(r + 1) * W.w + c] : T.EMPTY;
        const left = c > 0 ? W.tiles[r * W.w + c - 1] : T.EMPTY;
        const right = c < W.w - 1 ? W.tiles[r * W.w + c + 1] : T.EMPTY;
        if (below === T.EMPTY) {
          ctx.fillStyle = pal.semiDark;
          if (left !== T.SEMI) ctx.fillRect(x + 4, y + 12, 4, W.S.theme === 'street' ? 26 : 20);
          if (right !== T.SEMI) ctx.fillRect(x + TILE - 8, y + 12, 4, W.S.theme === 'street' ? 26 : 20);
        }
        break;
      }
    }
  }

  function drawPipe(p, camL, camR) {
    const x = p.c * TILE, top = p.top * TILE;
    if (x > camR || x + 2 * TILE < camL) return;
    const h = GROUND_Y - top;
    const body = ctx.createLinearGradient(x + 4, 0, x + 2 * TILE - 4, 0);
    body.addColorStop(0, '#2f8f71');
    body.addColorStop(0.3, '#7fdcbc');
    body.addColorStop(0.55, '#3fae8c');
    body.addColorStop(1, '#246b55');
    ctx.fillStyle = body;
    ctx.fillRect(x + 4, top + 20, 2 * TILE - 8, h - 20);
    ctx.strokeStyle = '#1d5646';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 4, top + 20, 2 * TILE - 8, h - 20);
    const lip = ctx.createLinearGradient(x, 0, x + 2 * TILE, 0);
    lip.addColorStop(0, '#2f8f71');
    lip.addColorStop(0.3, '#8fe6c8');
    lip.addColorStop(0.55, '#45b894');
    lip.addColorStop(1, '#246b55');
    ctx.fillStyle = lip;
    rrect(x - 1, top, 2 * TILE + 2, 22, 4);
    ctx.fill();
    ctx.stroke();
  }

  // ---------- 敵・アイテム ----------
  function drawEnemy(W, e, t) {
    if (!e.active || e.gone || e.visible === false) return;
    const cx = e.x + e.w / 2, bottom = e.y + e.h;
    const falling = e.state === 'fall';
    const o = falling ? { rot: e.rot, sy: -1, anchorY: 0.5 } : {};
    switch (e.type) {
      case 'box':
        if (e.state === 'flat') spr('box_flat', cx, bottom + 2, 40, { sy: 0.7 });
        else if (falling) spr('box', cx, e.y + e.h / 2, 46, o);
        else spr('box', cx, bottom + 3, 46, { rot: Math.sin(e.phase) * 0.08, flip: e.dir > 0 });
        break;
      case 'virus':
        if (falling) spr('virus', cx, e.y + e.h / 2, 44, o);
        else spr('virus', cx, bottom + 4, 44, { rot: Math.sin(e.rot) * 0.15, sy: e.squash ? 0.8 : 1 });
        break;
      case 'spam':
        if (falling) spr('spam', cx, e.y + e.h / 2, 40, o);
        else spr('spam', cx, bottom + 6, 40, { rot: Math.sin(W.clock * 3 + e.phase) * 0.12 });
        break;
      case 'phone': {
        if (falling) { spr('phone', cx, e.y + e.h / 2, 50, o); break; }
        if (!e.ext) return;
        const shake = e.ext > 0.9 ? Math.sin(t * 60) * 1.6 : 0;
        spr('phone', cx + shake, e.y + 52, 50, { flip: true });
        break;
      }
    }
  }

  function drawItem(it, t) {
    const cx = it.x + it.w / 2, bottom = it.y + it.h;
    if (it.type === 'drink') spr('drink', cx, bottom + 2, 46, { rot: Math.sin(t * 10) * 0.06 });
    else if (it.type === 'can') spr('can', cx, bottom + 2, 40, { rot: Math.sin(t * 8) * 0.2 });
    else spr('yukyu', cx, bottom + 2, 40, { rot: Math.sin(t * 5) * 0.08 });
  }

  function drawChaser(C, t) {
    if (!C || !C.active) return;
    const shake = C.stun > 0 ? 0 : Math.sin(t * 50) * 3;
    const aura = ctx.createRadialGradient(C.x, C.y, 10, C.x, C.y, 110);
    aura.addColorStop(0, 'rgba(255,60,60,0.35)');
    aura.addColorStop(1, 'rgba(255,60,60,0)');
    ctx.fillStyle = aura;
    ctx.fillRect(C.x - 110, C.y - 110, 220, 220);
    spr('shimekiri', C.x + shake, C.y + 60, 120, { rot: C.stun > 0 ? Math.sin(t * 6) * 0.3 : Math.sin(t * 40) * 0.04 });
    if (C.stun > 0) {
      for (let i = 0; i < 3; i++) {
        const a = t * 4 + (i * Math.PI * 2) / 3;
        outlinedText('★', C.x + Math.cos(a) * 46, C.y - 64 + Math.sin(a) * 10, 18, '#ffe14d');
      }
    }
  }

  // ---------- プレイヤー ----------
  // p: { x, y, w, h, big, char, facing, vx, vy, onGround, dead, deadT, skip, inv, hurt, stun, anim, grow }
  function drawPlayer(p, t, o = {}) {
    if (p.hurt > 0 && Math.floor(t * 18) % 2 === 0) return;
    let big = p.big;
    if (p.grow > 0) big = Math.floor(p.grow * 14) % 2 === 0 ? p.growTo : !p.growTo;
    const h = big ? 94 : 60;
    const name = (p.skip ? 'skip_' : 'player_') + (p.char === 'f' ? 'f' : 'm');
    const right = p.facing > 0;
    const flip = p.skip ? !right : right;
    const cx = p.x + p.w / 2, bottom = p.y + p.h;
    let rot = 0, bob = 0, sx = 1, sy = 1;
    if (p.dead) {
      rot = Math.min(1, (p.deadT || 0) * 2) * Math.PI;
    } else if (p.stun > 0) {
      rot = Math.sin(t * 20) * 0.25;
      sy = 0.55;
    } else if (!p.onGround) {
      rot = (right ? 1 : -1) * Math.max(-0.15, Math.min(0.2, (p.vy || 0) / 2200));
      sx = 0.95;
      sy = 1.05;
    } else if (Math.abs(p.vx) > 15) {
      bob = -Math.abs(Math.sin(p.anim || 0)) * 5;
      rot = Math.sin(p.anim || 0) * 0.05;
    } else {
      sy = 1 + Math.sin(t * 3) * 0.015;
    }
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    if (p.inv > 0) {
      const hue = (t * 720) % 360;
      const g = ctx.createRadialGradient(cx, bottom - h / 2, 4, cx, bottom - h / 2, h * 0.75);
      g.addColorStop(0, `hsla(${hue},100%,70%,0.55)`);
      g.addColorStop(1, `hsla(${hue},100%,70%,0)`);
      ctx.fillStyle = g;
      ctx.fillRect(cx - h, bottom - h * 1.5, h * 2, h * 2);
      if (canFilter) ctx.filter = `hue-rotate(${hue}deg) saturate(1.6)`;
    }
    if (p.dead) spr(name, cx, bottom - h / 2, h, { rot, flip, anchorY: 0.5 });
    else spr(name, cx, bottom + 2 + bob, h, { rot, flip, sx, sy });
    ctx.filter = 'none';
    ctx.restore();
    if (p.stun > 0) {
      for (let i = 0; i < 3; i++) {
        const a = t * 6 + (i * Math.PI * 2) / 3;
        outlinedText('★', cx + Math.cos(a) * 22, bottom - h * 0.55 - 8 + Math.sin(a) * 5, 13, '#ffe14d');
      }
    }
    if (o.label) {
      const y = bottom - h - 10;
      ctx.font = '800 13px "M PLUS Rounded 1c", "Meiryo", sans-serif';
      const tw = ctx.measureText(o.label).width + 12;
      ctx.globalAlpha = 0.85;
      rrect(cx - tw / 2, y - 10, tw, 19, 9);
      ctx.fillStyle = o.color || '#333';
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.label, cx, y);
    }
  }

  // ---------- 全体 ----------
  // s: { W, camX, t, me, others: [{ p, label, color, alpha }], goalClock, attract }
  function draw(s) {
    const { W, t } = s;
    if (!ctx) return;
    const camX = Math.round(s.camX * view.scale * dpr) / (view.scale * dpr);
    const k = view.scale * dpr;
    ctx.setTransform(k, 0, 0, k, 0, view.offY * dpr);
    ctx.imageSmoothingQuality = 'high';
    background(W.S.theme, camX, t);
    ctx.setTransform(k, 0, 0, k, -camX * k, view.offY * dpr);
    const camL = camX, camR = camX + view.w;
    const pal = PAL[W.S.theme];

    // 中間地点・タイムカード・飾り
    W.checkpoints.forEach((x, i) => {
      if (x < camL - 60 || x > camR + 60) return;
      const on = s.cpReached != null && s.cpReached >= i;
      ctx.fillStyle = '#777';
      ctx.fillRect(x + 18, GROUND_Y - 120, 4, 120);
      ctx.fillStyle = on ? '#43a047' : '#9e9e9e';
      ctx.beginPath();
      ctx.moveTo(x + 22, GROUND_Y - 118);
      ctx.lineTo(x + 70, GROUND_Y - 104);
      ctx.lineTo(x + 22, GROUND_Y - 88);
      ctx.fill();
      outlinedText(on ? '保存済' : '中間', x + 40, GROUND_Y - 103, 11, '#fff', 'rgba(0,0,0,0.5)');
    });
    for (const d of W.S.decor) {
      const x = d.c * TILE + TILE / 2;
      if (x < camL - 120 || x > camR + 120) continue;
      if (d.type === 'plant') spr('plant', x, d.r * TILE + 2, 86);
    }
    if (W.goalX > camL - 200 && W.goalX < camR + 200) {
      const gx = W.goalX + 30;
      ctx.fillStyle = '#2e7d32';
      rrect(gx - 46, GROUND_Y - 214, 92, 34, 8);
      ctx.fill();
      outlinedText('退勤', gx, GROUND_Y - 197, 18, '#fff', '#1b5e20');
      ctx.fillStyle = '#888';
      ctx.fillRect(gx - 2, GROUND_Y - 180, 4, 40);
      spr('timecard', gx, GROUND_Y + 2, 140);
      // 打刻機の画面に今の時刻を出す
      const f = ATLAS.timecard;
      const sw = (140 * f[2]) / f[3];
      ctx.fillStyle = '#c8e66b';
      ctx.fillRect(gx - sw * 0.3, GROUND_Y - 140 * 0.43, sw * 0.6, 140 * 0.085);
      ctx.font = '800 14px "Consolas", monospace';
      ctx.fillStyle = '#263238';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.goalClock || '17:00', gx, GROUND_Y - 140 * 0.43 + 140 * 0.043);
    }

    // 黒電話は土管の後ろ
    for (const e of W.enemies) if (e.type === 'phone') drawEnemy(W, e, t);

    const c0 = Math.max(0, Math.floor(camL / TILE) - 1), c1 = Math.min(W.w - 1, Math.ceil(camR / TILE) + 1);
    for (let r = 0; r < ROWS; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * W.w + c;
        const tt = W.tiles[i];
        if (tt === T.EMPTY || tt === T.PIPE || tt === T.HIDDEN) continue;
        let y = r * TILE;
        const b = W.bumps.get(i);
        if (b != null) {
          const k2 = (W.clock - b) / 0.18;
          if (k2 >= 0 && k2 < 1) y -= Math.sin(Math.PI * k2) * 10;
          else if (k2 >= 1) W.bumps.delete(i);
        }
        drawTile(W, pal, tt, c, r, c * TILE, y, t);
      }
    }
    W.pipes.forEach(p => drawPipe(p, camL, camR));

    // 動く足場
    for (const l of W.lifts) {
      if (l.axis === 'y') {
        ctx.strokeStyle = 'rgba(80,80,90,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(l.x + 20, view.top);
        ctx.lineTo(l.x + 20, l.y);
        ctx.moveTo(l.x + 60, view.top);
        ctx.lineTo(l.x + 60, l.y);
        ctx.stroke();
      }
      rrect(l.x, l.y, World.LIFT_W, World.LIFT_H, 4);
      ctx.fillStyle = '#8a96a8';
      ctx.fill();
      ctx.strokeStyle = '#4f5a6b';
      ctx.stroke();
      ctx.fillStyle = '#ffd54f';
      for (let i = 0; i < 4; i++) ctx.fillRect(l.x + 8 + i * 18, l.y + 4, 9, 5);
    }

    // コイン
    W.coins.forEach((c, i) => {
      if (c.taken || c.x < camL - 30 || c.x > camR + 30) return;
      spr('coin', c.x, c.y + 13, 26, { sx: Math.max(0.15, Math.abs(Math.cos(t * 3 + i * 0.5))) });
    });
    W.items.forEach(it => drawItem(it, t));
    for (const e of W.enemies) if (e.type !== 'phone') drawEnemy(W, e, t);

    // ほかのプレイヤー → 自分
    (s.others || []).forEach(o => drawPlayer(o.p, t, o));
    if (s.me && !s.attract) drawPlayer(s.me, t, s.meLabel ? { label: s.meLabel, color: s.meColor } : {});

    drawChaser(W.chaser, t);

    // 粒子・得点表示
    for (const p of W.particles) {
      if (p.kind === 'coin') spr('coin', p.x, p.y + 13, 26, { sx: Math.abs(Math.cos(p.t * 18)) });
      else if (p.kind === 'debris') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = PAL[p.theme].brick;
        ctx.fillRect(-7, -7, 14, 14);
        ctx.strokeStyle = PAL[p.theme].mortar;
        ctx.strokeRect(-7, -7, 14, 14);
        ctx.restore();
      } else if (p.kind === 'dust') {
        ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - p.t / p.life)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 + p.t * 20, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'star') {
        outlinedText('★', p.x, p.y, 16, `hsl(${(p.t * 600) % 360},100%,65%)`, 'rgba(0,0,0,0.4)');
      }
    }
    for (const p of W.popups) {
      ctx.globalAlpha = Math.min(1, 2 * (1 - p.t / p.life));
      outlinedText(p.text, p.x, p.y - p.t * 50, p.size || 16, p.color || '#fff');
      ctx.globalAlpha = 1;
    }
  }

  // 粒子と得点表示を進める（描画側の演出なので、どのモードでも各自の画面で動かす）
  function stepEffects(W, dt) {
    for (const p of W.particles) {
      p.t += dt;
      if (p.kind === 'coin') { p.vy += 1800 * dt; p.y += p.vy * dt; }
      else if (p.kind === 'debris') { p.vy += 1800 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += dt * 10; }
      else if (p.kind === 'star') { p.x += p.vx * dt; p.y += p.vy * dt; }
    }
    W.particles = W.particles.filter(p => p.t < p.life);
    for (const p of W.popups) p.t += dt;
    W.popups = W.popups.filter(p => p.t < p.life);
  }

  return { init, resize, draw, stepEffects, spriteToCanvas, view };
})();
