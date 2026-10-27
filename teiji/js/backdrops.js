// ステージごとの背景（ワールド 2〜6 の 20 ステージ。すべて違う景色）
//  base: 地形の描き方（office / basement / street） / song: BGM / pal: 地形の色 / draw: 背景
const Backdrops = (() => {
  const TAU = Math.PI * 2;
  let R = null, ctx = null, G = 480, B = null;
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const pick = (n, k) => ((n % k) + k) % k;

  // ---------- 部品 ----------
  function grad(y0, y1, stops) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    return g;
  }
  function fill(b, stops, y1) {
    ctx.fillStyle = grad(b.top, y1 || b.bottom, stops);
    ctx.fillRect(0, b.top, b.w, b.bottom - b.top);
  }
  // 視差 k・間隔 P で横に繰り返す。fn(x, n)
  function rep(b, k, P, fn, x0 = 0) {
    const off = (((b.camX * k) % P) + P) % P, base = Math.floor((b.camX * k) / P);
    for (let i = -1; i < b.w / P + 1; i++) fn(i * P - off + x0, base + i);
  }
  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  function glow(x, y, r, col) {
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, col);
    g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function sun(x, y, r, core) {
    glow(x, y, r * 4, 'rgba(255,240,200,0.55)');
    ctx.fillStyle = core;
    circle(x, y, r);
  }
  function clouds(b, k, y, size, alpha, P = 640) {
    rep(b, k, P, (x, n) => R.spr('kumo', x + hash(n) * P * 0.4, y + hash(n + 3) * 70, size * (0.8 + hash(n + 5) * 0.4), { alpha }));
  }
  // 入道雲
  function cumulus(x, y, s, lit, shade) {
    const parts = [[0, 0, 70], [-70, 30, 55], [70, 25, 60], [-30, -60, 55], [35, -70, 60], [0, -120, 50], [-120, 60, 40], [120, 60, 45]];
    ctx.fillStyle = shade;
    for (const [dx, dy, r] of parts) circle(x + dx * s + 6, y + dy * s + 8, r * s);
    ctx.fillStyle = lit;
    for (const [dx, dy, r] of parts) circle(x + dx * s, y + dy * s, r * s);
    ctx.fillStyle = shade;
    ctx.fillRect(x - 170 * s, y + 70 * s, 340 * s, 40 * s);
  }
  // 遠くのビル（窓あかり付き）
  function skyline(b, k, col, base, hmax, wmin, win, seed = 0, y = G) {
    rep(b, k, 420, (x, n) => {
      for (let i = 0; i < 7; i++) {
        const bh = base + hash(n * 11 + i * 3 + seed) * hmax, bw = wmin + hash(n * 7 + i + seed * 2) * 24;
        const bx = x + i * 60;
        ctx.fillStyle = col;
        ctx.fillRect(bx, y - bh, bw, bh);
        if (!win) continue;
        ctx.fillStyle = win;
        for (let wy = y - bh + 8; wy < y - 10; wy += 12)
          for (let wx = bx + 4; wx < bx + bw - 6; wx += 8)
            if (hash(n * 131 + i * 17 + wx * 0.37 + wy * 1.3 + seed) > 0.6) ctx.fillRect(wx, wy, 4, 5);
      }
    });
  }
  // いらすとやの町並み（色を変えて使う）
  function town(b, filter, tint, alpha = 1) {
    const img = R.img.town;
    if (!img || !img.naturalWidth) return;
    const th = 320, tw = (th * img.naturalWidth) / img.naturalHeight, toff = (b.camX * 0.3) % tw;
    if (filter && R.canFilter) ctx.filter = filter;
    ctx.globalAlpha = alpha;
    for (let i = -1; i < b.w / tw + 1; i++) ctx.drawImage(img, i * tw - toff, G - th, tw + 1, th);
    ctx.globalAlpha = 1;
    if (filter && R.canFilter) ctx.filter = 'none';
    if (tint) {
      ctx.fillStyle = grad(G - th, G, tint);
      ctx.fillRect(0, G - th, b.w, th);
    }
  }
  // 舞い落ちるもの（花びら・落ち葉・雪・紙）
  function falling(b, n, speed, colors, kind, seed = 0) {
    const H = b.bottom - b.top + 60, span = b.w + 100;
    for (let i = 0; i < n; i++) {
      const h1 = hash(i + seed), h2 = hash(i * 3 + 7 + seed);
      const y = b.top - 30 + ((h2 * H + b.t * speed * (0.7 + h1 * 0.6)) % H);
      const sway = Math.sin(b.t * (0.8 + h1) + i) * 30;
      const x = ((((h1 * span * 3 - b.camX * 0.9 + sway) % span) + span) % span) - 50;
      ctx.fillStyle = colors[i % colors.length];
      if (kind === 'snow') {
        circle(x, y, 1.5 + h2 * 2.5);
        continue;
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(b.t * (1 + h2 * 2) + i);
      if (kind === 'paper') {
        ctx.fillRect(-9, -6, 18, 12);
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(-6, -3, 12, 1.5);
        ctx.fillRect(-6, 1, 10, 1.5);
      } else {
        ctx.beginPath();
        ctx.ellipse(0, 0, kind === 'leaf' ? 6 : 4.5, kind === 'leaf' ? 3.5 : 2.6, 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  function stars(b, n, k = 0.02) {
    ctx.fillStyle = '#fff';
    const span = b.w + 200;
    for (let i = 0; i < n; i++) {
      const x = ((((hash(i) * 3000 - b.camX * k) % span) + span) % span) - 100;
      const y = b.top + 10 + hash(i + 70) * 240;
      ctx.globalAlpha = 0.35 + 0.6 * Math.abs(Math.sin(b.t * (0.5 + hash(i + 140)) + i));
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
  // 窓（空と外の景色は inside(x, y, w, h, n) で描く）
  function windows(b, k, P, frame, inside, x0 = 40, y = 66, ww = 240, wh = 220) {
    rep(b, k, P, (x, n) => {
      ctx.fillStyle = frame;
      ctx.fillRect(x - 8, y - 8, ww + 16, wh + 16);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, ww, wh);
      ctx.clip();
      inside(x, y, ww, wh, n);
      ctx.restore();
      ctx.fillStyle = frame;
      ctx.fillRect(x + ww / 2 - 4, y, 8, wh);
      ctx.fillRect(x, y + wh * 0.48, ww, 6);
    }, x0);
  }
  function ceiling(b, col, lamp, k = 0.9, P = 260) {
    ctx.fillStyle = col;
    ctx.fillRect(0, b.top, b.w, 40 - b.top);
    rep(b, k, P, x => {
      ctx.fillStyle = lamp;
      ctx.fillRect(x + 60, 34, 120, 8);
    });
  }
  function floorStrip(col, h = 12) {
    ctx.fillStyle = col;
    ctx.fillRect(0, G - h, R.view.w + 10, h);
  }
  function tree(x, base, s, canopy, trunk = '#6d4c41', seed = 0) {
    ctx.fillStyle = trunk;
    ctx.fillRect(x - 7 * s, base - 150 * s, 14 * s, 150 * s);
    ctx.strokeStyle = trunk;
    ctx.lineWidth = 5 * s;
    ctx.beginPath();
    ctx.moveTo(x, base - 120 * s);
    ctx.lineTo(x - 40 * s, base - 170 * s);
    ctx.moveTo(x, base - 110 * s);
    ctx.lineTo(x + 45 * s, base - 160 * s);
    ctx.stroke();
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = canopy[i % canopy.length];
      circle(x + (hash(i + seed) - 0.5) * 150 * s, base - 170 * s + (hash(i * 7 + seed) - 0.5) * 90 * s, (24 + hash(i * 3 + seed) * 18) * s);
    }
  }
  function fence(col) {
    const F = 36, foff = (((B.camX * 0.85) % F) + F) % F;
    ctx.fillStyle = col;
    ctx.fillRect(0, G - 96, R.view.w + 10, 5);
    ctx.fillRect(0, G - 40, R.view.w + 10, 3);
    for (let i = -1; i < R.view.w / F + 1; i++) ctx.fillRect(i * F - foff, G - 96, 3, 96);
  }
  function haze(b, a = 0.08) {
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.lineWidth = 6;
    for (let i = 0; i < 6; i++) {
      const y = G - 30 - i * 50 - ((b.t * 20) % 50);
      ctx.beginPath();
      for (let x = 0; x <= b.w; x += 30) {
        const yy = y + Math.sin(x * 0.02 + b.t * 3 + i) * 5;
        if (x) ctx.lineTo(x, yy);
        else ctx.moveTo(x, yy);
      }
      ctx.stroke();
    }
  }
  function ledText(text, x, y, size, col) {
    ctx.font = `800 ${size}px "Consolas", "MS Gothic", monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = col;
    ctx.fillText(text, x, y);
  }

  const T = {};
  // ===== 2-1 新人研修フロア：春の研修室 =====
  T.training = {
    base: 'office', song: 'office',
    pal: { top: '#7d8aa0', ground: '#b8c2d0', dark: '#a1acbd', brick: '#d98a4a', mortar: '#9a5426', hi: '#f0ab76', solid: '#c9d2dc', solidDark: '#8e9aa8', semi: '#e3b27a', semiDark: '#a7764a' },
    draw(b) {
      fill(b, [[0, '#eef3f6'], [1, '#fbfaf5']]);
      windows(b, 0.7, 440, '#cfd8dc', (x, y, w, h, n) => {
        ctx.fillStyle = grad(y, y + h, [[0, '#9fd3f5'], [1, '#fde2ec']]);
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#6d4c41';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x - 10, y + 50 + hash(n) * 40);
        ctx.quadraticCurveTo(x + 90, y + 20, x + 200, y + 70);
        ctx.stroke();
        for (let i = 0; i < 16; i++) {
          ctx.fillStyle = i % 3 ? '#f8bbd0' : '#fce4ec';
          circle(x + hash(n * 13 + i) * 220, y + 20 + hash(n * 7 + i) * 80, 8 + hash(i + n) * 7);
        }
      }, 30);
      rep(b, 0.8, 980, x => {
        ctx.fillStyle = '#90a4ae';
        ctx.fillRect(x - 5, 92, 290, 178);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, 97, 280, 168);
        R.text('新人研修へようこそ！', x + 140, 122, 20, '#1565c0', 'rgba(255,255,255,0)');
        const steps = [['出社', '#2e7d32'], ['仕事', '#2e7d32'], ['定時', '#c62828']];
        steps.forEach(([s, c], i) => {
          ctx.strokeStyle = c;
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 20 + i * 88, 160, 64, 34);
          R.text(s, x + 52 + i * 88, 177, 14, c, 'rgba(255,255,255,0)');
          if (i < 2) R.text('→', x + 96 + i * 88, 177, 16, '#546e7a', 'rgba(255,255,255,0)');
        });
        R.text('※ 定時で帰るまでが研修です', x + 140, 222, 12, '#6d4c41', 'rgba(255,255,255,0)');
        ctx.fillStyle = '#b0bec5';
        ctx.fillRect(x, 265, 280, 6);
      }, 600);
      ceiling(b, '#e3e8ec', '#ffffff');
      rep(b, 0.6, 110, x => {
        ctx.fillStyle = 'rgba(70,95,140,0.22)';
        ctx.fillRect(x, G - 56, 46, 8);
        ctx.fillRect(x + 38, G - 98, 8, 50);
        ctx.fillRect(x + 4, G - 48, 4, 36);
        ctx.fillRect(x + 36, G - 48, 4, 36);
      });
      floorStrip('#d7dde3');
    },
  };

  // ===== 2-2 備品倉庫：スチール棚とダンボール =====
  T.warehouse = {
    base: 'basement', song: 'basement',
    pal: { top: '#8a7a62', ground: '#55504a', dark: '#46413c', brick: '#c0874a', mortar: '#7b5225', hi: '#dca46a', solid: '#7d776d', solidDark: '#57524b', semi: '#e8772e', semiDark: '#a34f17' },
    draw(b) {
      fill(b, [[0, '#24211d'], [1, '#3a342d']]);
      rep(b, 0.3, 160, x => {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(x, b.top, 3, b.bottom - b.top);
      });
      rep(b, 0.35, 1100, x => {
        ctx.fillStyle = '#5a6068';
        ctx.fillRect(x, 150, 280, G - 150);
        ctx.fillStyle = '#4a5058';
        for (let y = 158; y < G; y += 10) ctx.fillRect(x, y, 280, 3);
        ctx.fillStyle = '#f9a825';
        ctx.fillRect(x + 90, 118, 100, 26);
        R.text('搬入口', x + 140, 131, 14, '#3e2723', 'rgba(255,255,255,0)');
      }, 300);
      rep(b, 0.55, 300, (x, n) => {
        ctx.fillStyle = '#1e4f8a';
        ctx.fillRect(x, 80, 8, G - 80);
        ctx.fillRect(x + 232, 80, 8, G - 80);
        for (let s = 0; s < 4; s++) {
          const y = 140 + s * 90;
          let bx = x + 12, k = 0;
          while (bx < x + 220) {
            const bw = 34 + hash(n * 31 + s * 7 + k) * 26, bh = 30 + hash(n * 17 + s * 3 + k) * 44;
            if (bx + bw > x + 230) break;
            ctx.fillStyle = ['#c69c6d', '#b5895a', '#d7b48a'][pick(n + s + k, 3)];
            ctx.fillRect(bx, y - bh, bw, bh);
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            ctx.fillRect(bx + bw / 2 - 3, y - bh, 6, bh);
            bx += bw + 6;
            k++;
          }
          ctx.fillStyle = '#e8772e';
          ctx.fillRect(x, y, 240, 8);
        }
      });
      rep(b, 0.65, 1500, x => {
        ctx.fillStyle = 'rgba(20,20,20,0.55)';
        ctx.fillRect(x, G - 70, 90, 50);
        ctx.fillRect(x + 20, G - 120, 50, 50);
        ctx.fillRect(x + 92, G - 150, 6, 130);
        ctx.fillRect(x + 98, G - 26, 40, 6);
        ctx.fillStyle = 'rgba(255,193,7,0.5)';
        ctx.fillRect(x, G - 70, 90, 6);
        ctx.fillStyle = 'rgba(10,10,10,0.7)';
        circle(x + 20, G - 16, 14);
        circle(x + 74, G - 16, 14);
      }, 500);
      rep(b, 0.8, 380, x => {
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, b.top);
        ctx.lineTo(x, 96);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,214,140,0.10)';
        ctx.beginPath();
        ctx.moveTo(x - 20, 110);
        ctx.lineTo(x + 20, 110);
        ctx.lineTo(x + 130, G);
        ctx.lineTo(x - 130, G);
        ctx.fill();
        ctx.fillStyle = '#3d4f3a';
        ctx.beginPath();
        ctx.arc(x, 112, 24, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#ffe9b0';
        ctx.fillRect(x - 10, 110, 20, 4);
      }, 160);
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(0, G - 10, b.w, 10);
      ctx.fillStyle = '#f9a825';
      const so = (b.camX % 40 + 40) % 40;
      for (let x = -so; x < b.w; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, G);
        ctx.lineTo(x + 20, G - 10);
        ctx.lineTo(x + 34, G - 10);
        ctx.lineTo(x + 14, G);
        ctx.fill();
      }
    },
  };

  function rooftopBase(b, sky, skyCol1, skyCol2) {
    fill(b, sky, G);
    sun(b.w * 0.78 - b.camX * 0.03, 120, 30, 'rgba(255,255,240,0.95)');
    clouds(b, 0.1, 100, 140, 0.9);
    skyline(b, 0.18, skyCol1, 110, 170, 40, null, 1);
    skyline(b, 0.32, skyCol2, 40, 120, 54, 'rgba(255,255,255,0.16)', 2);
  }

  // ===== 2-3 お花見の屋上：桜とブルーシート =====
  T.sakura_roof = {
    base: 'street', song: 'rooftop',
    pal: { top: '#d6cfc6', ground: '#9a948b', dark: '#837d75', brick: '#d2763f', mortar: '#94471c', hi: '#ec9d66', solid: '#c7c1ba', solidDark: '#948d84', semi: '#f48fb1', semiDark: '#ad5779' },
    draw(b) {
      rooftopBase(b, [[0, '#7cc3ef'], [0.6, '#cfe9f7'], [1, '#fde4ec']], '#b7cde0', '#98b4cc');
      rep(b, 0.7, 520, (x, n) => tree(x + 140, G - 4, 1 + hash(n) * 0.25, ['#f8bbd0', '#fce4ec', '#f48fb1', '#f6c3d5'], '#6d4c41', n));
      fence('rgba(90,120,100,0.55)');
      rep(b, 0.9, 700, x => {
        ctx.fillStyle = 'rgba(30,110,220,0.6)';
        ctx.fillRect(x, G - 9, 220, 9);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(x + 10, G - 8, 200, 2);
      }, 200);
      falling(b, 40, 40, ['#f8bbd0', '#fce4ec', '#f48fb1'], 'petal');
    },
  };

  // ===== 2-4 桜並木の帰り道：夕方の桜とぼんぼり =====
  T.sakura_street = {
    base: 'street', song: 'street',
    pal: { top: '#e2cdb5', ground: '#5f5a66', dark: '#4c4853', brick: '#d2763f', mortar: '#94471c', hi: '#ec9d66', solid: '#c4b8ac', solidDark: '#93877b', semi: '#ec7fa6', semiDark: '#a8466e' },
    draw(b) {
      fill(b, [[0, '#5c6bc0'], [0.45, '#f48fb1'], [0.8, '#ffcc80'], [1, '#ffe0b2']], G);
      sun(b.w * 0.25 - b.camX * 0.04, 250, 34, 'rgba(255,236,190,1)');
      clouds(b, 0.12, 110, 150, 0.6, 760);
      town(b, null, [[0, 'rgba(255,170,200,0.32)'], [1, 'rgba(150,90,140,0.32)']]);
      rep(b, 0.6, 270, (x, n) => tree(x + 100, G, 1.25, ['#f8bbd0', '#f48fb1', '#fce4ec'], '#5d4037', n + 9));
      rep(b, 0.75, 210, x => {
        ctx.fillStyle = '#8d6e63';
        ctx.fillRect(x - 2, G - 110, 4, 110);
        glow(x, G - 120, 40, 'rgba(255,200,220,0.6)');
        ctx.fillStyle = '#fff3f6';
        ctx.fillRect(x - 9, G - 134, 18, 26);
        ctx.fillStyle = '#e57373';
        ctx.fillRect(x - 9, G - 134, 18, 4);
      });
      falling(b, 46, 36, ['#f8bbd0', '#fce4ec', '#f48fb1'], 'petal', 3);
    },
  };

  // ===== 3-1 冷房の効かないフロア：真夏の日差し =====
  T.hot_office = {
    base: 'office', song: 'office',
    pal: { top: '#8a7f73', ground: '#c2b6a5', dark: '#ab9f8e', brick: '#d0703a', mortar: '#8f4019', hi: '#eb9763', solid: '#d1c6b8', solidDark: '#9c907f', semi: '#e0a560', semiDark: '#a26b2f' },
    draw(b) {
      fill(b, [[0, '#f3e1c3'], [1, '#fbf0da']]);
      windows(b, 0.7, 420, '#c9b89c', (x, y, w, h, n) => {
        ctx.fillStyle = grad(y, y + h, [[0, '#1976d2'], [0.7, '#64b5f6'], [1, '#e3f2fd']]);
        ctx.fillRect(x, y, w, h);
        cumulus(x + 120 + (hash(n) - 0.5) * 60, y + 150, 0.55, '#ffffff', '#cfd8e6');
        sun(x + 200, y + 40, 18, '#fffde7');
        ctx.fillStyle = 'rgba(80,100,130,0.5)';
        for (let i = 0; i < 6; i++) ctx.fillRect(x + i * 40, y + h - 30 - hash(n + i) * 40, 30, 80);
      }, 30);
      // 窓から差しこむ日差し
      rep(b, 0.7, 420, x => {
        ctx.fillStyle = 'rgba(255,230,140,0.16)';
        ctx.beginPath();
        ctx.moveTo(x, 290);
        ctx.lineTo(x + 240, 290);
        ctx.lineTo(x + 420, G);
        ctx.lineTo(x + 180, G);
        ctx.fill();
      }, 30);
      ceiling(b, '#e2d3bb', '#cfc4b2');
      rep(b, 0.6, 700, x => {
        ctx.fillStyle = '#fff';
        ctx.fillRect(x, 110, 70, 130);
        ctx.strokeStyle = '#b0a089';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, 110, 70, 130);
        ctx.fillStyle = '#e53935';
        ctx.fillRect(x + 31, 130, 8, 80);
        circle(x + 35, 214, 10);
        R.text('33℃', x + 35, 122, 13, '#c62828', 'rgba(255,255,255,0)');
        R.text('節電中', x + 35, 230, 11, '#6d4c41', 'rgba(255,255,255,0)');
      }, 300);
      const D = 620, doff = (b.camX * 0.55) % D;
      for (let i = -1; i < b.w / D + 1; i++) R.spr('office', i * D - doff + 260, G - 14, 180, { alpha: 0.5 });
      haze(b, 0.07);
      floorStrip('#d8c9b1');
    },
  };

  function serverRacks(b, ledCols, rackBody, rackFace, unitA, unitB) {
    const P2 = 120, off2 = (b.camX * 0.3) % P2;
    ctx.fillStyle = rackBody;
    for (let i = -1; i < b.w / P2 + 1; i++) ctx.fillRect(i * P2 - off2, 120, 100, G - 120);
    rep(b, 0.55, 190, (x, n) => {
      ctx.fillStyle = rackFace;
      ctx.fillRect(x - 4, 76, 148, G - 76);
      ctx.fillStyle = unitA;
      ctx.fillRect(x, 82, 140, G - 82);
      for (let u = 0; u < 15; u++) {
        const y = 92 + u * 25;
        ctx.fillStyle = u % 4 === 3 ? unitA : unitB;
        ctx.fillRect(x + 8, y, 124, 19);
        for (let k = 0; k < 3; k++) {
          const h = hash(n * 97 + u * 13 + k * 7);
          const on = Math.sin(b.t * (2 + h * 9) + h * 40) > -0.3;
          ctx.fillStyle = on ? ledCols[Math.floor(h * ledCols.length)] : '#1d2a2c';
          ctx.fillRect(x + 16 + k * 9, y + 7, 4, 4);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x + 60, y + 6, 64, 2);
        ctx.fillRect(x + 60, y + 11, 64, 2);
      }
    }, 20);
  }

  // ===== 3-2 熱暴走サーバールーム：赤い警告灯 =====
  T.hot_server = {
    base: 'basement', song: 'server',
    pal: { top: '#a5584a', ground: '#4a2e2c', dark: '#3a2322', brick: '#c0503a', mortar: '#7a2516', hi: '#e8806a', solid: '#6e5552', solidDark: '#4a3735', semi: '#9c8b88', semiDark: '#5d4f4d' },
    draw(b) {
      fill(b, [[0, '#1c0909'], [1, '#341414']]);
      serverRacks(b, ['#ff5252', '#ffab40', '#ff8a65'], '#250f0f', '#4a2a2a', '#2a1515', '#351c1c');
      // 回転する警告灯
      rep(b, 0.55, 570, x => {
        const a = b.t * 4;
        ctx.save();
        ctx.translate(x + 70, 72);
        ctx.fillStyle = 'rgba(255,40,40,0.18)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 420, a - 0.35, a + 0.35);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#ff1744';
        circle(x + 70, 72, 10);
        R.text('高温注意', x + 70, 50, 12, '#ffeb3b', 'rgba(0,0,0,0.7)');
      }, 20);
      ctx.fillStyle = `rgba(255,40,20,${0.06 + 0.05 * Math.sin(b.t * 4)})`;
      ctx.fillRect(0, b.top, b.w, b.bottom - b.top);
      haze(b, 0.06);
    },
  };

  // ===== 3-3 炎天下の屋上：入道雲とビアガーデン =====
  T.summer_roof = {
    base: 'street', song: 'rooftop',
    pal: { top: '#e0d6c4', ground: '#a39a8a', dark: '#8a8273', brick: '#d2763f', mortar: '#94471c', hi: '#ec9d66', solid: '#cfc6b8', solidDark: '#9c9384', semi: '#42a5f5', semiDark: '#1565c0' },
    draw(b) {
      fill(b, [[0, '#0d47a1'], [0.5, '#2196f3'], [1, '#bbdefb']], G);
      const sx = b.w * 0.2 - b.camX * 0.02;
      glow(sx, 90, 220, 'rgba(255,255,230,0.7)');
      ctx.fillStyle = '#ffffff';
      circle(sx, 90, 36);
      rep(b, 0.05, 900, (x, n) => cumulus(x + 300, 300, 1.15 + hash(n) * 0.3, '#ffffff', '#c8d6e8'), 0);
      skyline(b, 0.2, '#9fb8d4', 60, 120, 40, null, 4);
      skyline(b, 0.34, '#7d9bbd', 20, 90, 54, 'rgba(255,255,255,0.2)', 5);
      // ビアガーデンのちょうちんと電球
      rep(b, 0.8, 360, x => {
        ctx.strokeStyle = '#5d4037';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, 150);
        ctx.quadraticCurveTo(x + 180, 210, x + 360, 150);
        ctx.stroke();
        for (let i = 1; i < 9; i++) {
          const p = i / 9, xx = x + 360 * p, yy = 150 + 4 * 60 * p * (1 - p);
          ctx.fillStyle = i % 2 ? '#ffee58' : '#ff7043';
          circle(xx, yy + 8, 6);
        }
        ctx.fillStyle = 'rgba(80,60,40,0.45)';
        ctx.fillRect(x + 60, G - 60, 90, 8);
        ctx.fillRect(x + 100, G - 52, 8, 52);
        ctx.fillStyle = 'rgba(255,200,60,0.75)';
        ctx.fillRect(x + 70, G - 78, 14, 18);
        ctx.fillRect(x + 120, G - 76, 14, 16);
      });
      fence('rgba(70,110,90,0.5)');
      haze(b, 0.1);
    },
  };

  // ===== 3-4 夏祭りの商店街：屋台・ちょうちん・花火 =====
  T.festival = {
    base: 'street', song: 'festival',
    pal: { top: '#c9a98a', ground: '#4b3a45', dark: '#3b2d36', brick: '#c0503a', mortar: '#7a2516', hi: '#e8806a', solid: '#9c8a7d', solidDark: '#6e5f55', semi: '#e53935', semiDark: '#8e1b1b' },
    draw(b) {
      fill(b, [[0, '#120d33'], [0.55, '#3f2a66'], [1, '#b8577e']], G);
      stars(b, 50);
      const cols = ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#e040fb', '#ff9100'];
      for (let i = 0; i < 4; i++) {
        const P = 2.6 + i * 0.4, k = ((b.t + i * 1.3) % P) / P, n = Math.floor((b.t + i * 1.3) / P) + i * 7;
        const cx = ((hash(n) * b.w * 1.2 - b.camX * 0.03) % b.w + b.w) % b.w, cy = 80 + hash(n + 1) * 110;
        if (k < 0.25) {
          ctx.fillStyle = '#fff3e0';
          circle(cx, G - 100 - (cy < 0 ? 0 : (G - 100 - cy) * (k / 0.25)), 2.5);
          continue;
        }
        const p = (k - 0.25) / 0.75, rr = 10 + p * 80;
        ctx.globalAlpha = 1 - p;
        for (let j = 0; j < 28; j++) {
          const a = (j / 28) * TAU;
          ctx.fillStyle = cols[(n + j) % cols.length];
          circle(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr + p * p * 25, 2.6);
        }
        ctx.globalAlpha = 1;
      }
      const SIGNS = ['たこ焼き', '金魚すくい', 'かき氷', 'わたあめ', '焼きそば', 'りんご飴'];
      const NOREN = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00897b'];
      rep(b, 0.55, 260, (x, n) => {
        const m = pick(n, 6);
        glow(x + 100, G - 60, 120, 'rgba(255,190,110,0.35)');
        ctx.fillStyle = '#3e2723';
        ctx.fillRect(x + 10, G - 150, 6, 150);
        ctx.fillRect(x + 184, G - 150, 6, 150);
        for (let i = 0; i < 9; i++) {
          ctx.fillStyle = i % 2 ? '#fff' : '#e53935';
          ctx.fillRect(x + i * 22, G - 170, 22, 26);
        }
        ctx.fillStyle = NOREN[m];
        for (let i = 0; i < 5; i++) ctx.fillRect(x + 22 + i * 32, G - 144, 28, 34);
        ctx.fillStyle = '#fff8e1';
        ctx.fillRect(x + 40, G - 200, 120, 26);
        R.text(SIGNS[m], x + 100, G - 187, 14, '#b71c1c', 'rgba(255,255,255,0)');
        ctx.fillStyle = 'rgba(60,40,30,0.8)';
        ctx.fillRect(x + 16, G - 60, 168, 60);
      }, 20);
      rep(b, 0.8, 300, x => {
        ctx.strokeStyle = '#2b1b17';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, 70);
        ctx.quadraticCurveTo(x + 150, 120, x + 300, 70);
        ctx.stroke();
        for (let i = 1; i < 6; i++) {
          const p = i / 6, xx = x + 300 * p, yy = 70 + 4 * 25 * p * (1 - p) + 12;
          glow(xx, yy, 26, 'rgba(255,150,80,0.45)');
          ctx.fillStyle = '#e53935';
          ctx.beginPath();
          ctx.ellipse(xx, yy, 9, 12, 0, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#212121';
          ctx.fillRect(xx - 6, yy - 13, 12, 3);
          ctx.fillRect(xx - 6, yy + 10, 12, 3);
        }
      });
    },
  };

  // ===== 4-1 監査前の書庫：書類キャビネットと光の筋 =====
  T.archive = {
    base: 'basement', song: 'basement',
    pal: { top: '#8c7b66', ground: '#4b4339', dark: '#3c352d', brick: '#a0794e', mortar: '#634424', hi: '#c49c6e', solid: '#7a7166', solidDark: '#554e46', semi: '#a08664', semiDark: '#6b5638' },
    draw(b) {
      fill(b, [[0, '#231e19'], [1, '#3a3027']]);
      rep(b, 0.3, 520, x => {
        ctx.fillStyle = 'rgba(255,240,200,0.5)';
        ctx.fillRect(x, 60, 70, 34);
        ctx.fillStyle = 'rgba(255,236,190,0.07)';
        ctx.beginPath();
        ctx.moveTo(x, 94);
        ctx.lineTo(x + 70, 94);
        ctx.lineTo(x + 330, G);
        ctx.lineTo(x + 160, G);
        ctx.fill();
      }, 80);
      rep(b, 0.55, 150, (x, n) => {
        ctx.fillStyle = '#6f757c';
        ctx.fillRect(x, 150, 120, G - 150);
        for (let d = 0; d < 4; d++) {
          const y = 158 + d * 80;
          ctx.fillStyle = '#868d95';
          ctx.fillRect(x + 6, y, 108, 72);
          ctx.fillStyle = '#e8e2d0';
          ctx.fillRect(x + 40, y + 14, 40, 14);
          ctx.fillStyle = '#4a4f55';
          ctx.fillRect(x + 48, y + 40, 24, 6);
          R.text(['H' + (20 + pick(n + d, 9)), '経理', '人事', '監査'][pick(n * 3 + d, 4)], x + 60, y + 21, 9, '#5d4037', 'rgba(255,255,255,0)');
        }
      });
      rep(b, 0.7, 330, (x, n) => {
        for (let s = 0; s < 3; s++)
          for (let i = 0; i < 3 - s; i++) {
            const bx = x + i * 50 + s * 25, by = G - 40 - s * 34;
            ctx.fillStyle = '#efe7d6';
            ctx.fillRect(bx, by, 46, 32);
            ctx.strokeStyle = '#b9ab90';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(bx, by, 46, 32);
            R.text('保存', bx + 23, by + 16, 10, '#8d6e63', 'rgba(255,255,255,0)');
          }
      }, 120);
      ctx.fillStyle = 'rgba(255,240,200,0.5)';
      for (let i = 0; i < 30; i++) {
        const x = ((hash(i) * 2000 - b.camX * 0.5 + Math.sin(b.t * 0.5 + i) * 20) % b.w + b.w) % b.w;
        const y = 120 + ((hash(i + 9) * 300 + b.t * 6) % 320);
        ctx.fillRect(x, y, 2, 2);
      }
    },
  };

  // ===== 4-2 経理部フロア：秋の窓と売上グラフ =====
  T.accounting = {
    base: 'office', song: 'office',
    pal: { top: '#6f7d8e', ground: '#a8b2bf', dark: '#929dab', brick: '#c96f3b', mortar: '#8a4421', hi: '#e39462', solid: '#bfc7d1', solidDark: '#808b99', semi: '#c79a6a', semiDark: '#8d6439' },
    draw(b) {
      fill(b, [[0, '#e2e6ec'], [1, '#f2f4f7']]);
      windows(b, 0.7, 460, '#b8c0ca', (x, y, w, h, n) => {
        ctx.fillStyle = grad(y, y + h, [[0, '#ffb74d'], [1, '#ffe0b2']]);
        ctx.fillRect(x, y, w, h);
        for (let i = 0; i < 3; i++) tree(x + 40 + i * 80, y + h + 20, 0.7, i % 2 ? ['#e65100', '#ff8f00', '#d84315'] : ['#c62828', '#ef6c00', '#f9a825'], '#5d4037', n * 3 + i);
      }, 30);
      rep(b, 0.75, 920, x => {
        ctx.fillStyle = '#263238';
        ctx.fillRect(x, 90, 300, 180);
        ctx.fillStyle = '#102027';
        ctx.fillRect(x + 8, 98, 284, 164);
        R.text('今期 売上（百万円）', x + 150, 114, 13, '#e0f7fa', 'rgba(0,0,0,0)');
        const v = [40, 55, 48, 70, 62, 85];
        v.forEach((h, i) => {
          ctx.fillStyle = i === 5 ? '#ffca28' : '#4fc3f7';
          ctx.fillRect(x + 30 + i * 42, 250 - h * 1.3, 26, h * 1.3);
        });
        ctx.strokeStyle = '#ff7043';
        ctx.lineWidth = 2;
        ctx.beginPath();
        v.forEach((h, i) => (i ? ctx.lineTo(x + 43 + i * 42, 240 - h * 1.3) : ctx.moveTo(x + 43, 240 - h * 1.3)));
        ctx.stroke();
      }, 560);
      ceiling(b, '#d5dbe2', '#fffdf2');
      rep(b, 0.6, 520, x => {
        ctx.fillStyle = '#fff';
        circle(x, 70, 22);
        ctx.strokeStyle = '#455a64';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, 70, 22, 0, TAU);
        ctx.stroke();
        const m = b.t * 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 70);
        ctx.lineTo(x + Math.sin(m) * 15, 70 - Math.cos(m) * 15);
        ctx.moveTo(x, 70);
        ctx.lineTo(x + 8, 70 + 4);
        ctx.stroke();
      }, 380);
      rep(b, 0.6, 230, (x, n) => {
        for (let i = 0; i < 2 + pick(n, 3); i++) {
          ctx.fillStyle = 'rgba(250,250,245,0.9)';
          ctx.fillRect(x, G - 52 - i * 9, 54, 8);
          ctx.fillStyle = 'rgba(0,0,0,0.12)';
          ctx.fillRect(x, G - 45 - i * 9, 54, 1);
        }
        ctx.fillStyle = 'rgba(90,100,115,0.35)';
        ctx.fillRect(x - 20, G - 44, 100, 6);
      });
      floorStrip('#cfd5dd');
    },
  };

  // ===== 4-3 高層ビルの屋上：雲海の夕暮れ =====
  T.skyscraper = {
    base: 'street', song: 'rooftop',
    pal: { top: '#c9bfc4', ground: '#7d7480', dark: '#675f6a', brick: '#c0503a', mortar: '#7a2516', hi: '#e8806a', solid: '#b2a8b0', solidDark: '#7f7480', semi: '#ff8a65', semiDark: '#bf360c' },
    draw(b) {
      fill(b, [[0, '#2b1b4f'], [0.45, '#b54d7c'], [0.75, '#ff9e5e'], [1, '#ffd9a0']], G);
      sun(b.w * 0.6 - b.camX * 0.02, G - 70, 40, 'rgba(255,230,170,1)');
      rep(b, 0.14, 700, (x, n) => {
        for (let i = 0; i < 3; i++) {
          const tx = x + 100 + i * 200 + hash(n + i) * 80, th = 120 + hash(n * 5 + i) * 140;
          ctx.fillStyle = 'rgba(60,40,80,0.75)';
          ctx.fillRect(tx, G - 40 - th, 26, th);
          ctx.fillRect(tx + 11, G - 70 - th, 4, 30);
          if (Math.sin(b.t * 3 + n + i) > 0) {
            ctx.fillStyle = '#ff1744';
            circle(tx + 13, G - 72 - th, 3);
          }
        }
      });
      // 雲海
      rep(b, 0.2, 240, (x, n) => {
        ctx.fillStyle = 'rgba(255,214,190,0.95)';
        for (let i = 0; i < 4; i++) circle(x + i * 60 + hash(n + i) * 20, G - 30 + hash(n * 3 + i) * 16, 46 + hash(n + i * 5) * 20);
        ctx.fillStyle = 'rgba(240,170,170,0.6)';
        for (let i = 0; i < 4; i++) circle(x + 30 + i * 60, G - 4, 40);
      });
      rep(b, 0.6, 640, x => {
        ctx.fillStyle = '#555066';
        ctx.fillRect(x, G - 260, 5, 260);
        ctx.fillRect(x - 14, G - 220, 33, 4);
        ctx.fillRect(x - 10, G - 180, 25, 4);
        if (Math.sin(b.t * 2.5) > 0) {
          glow(x + 2, G - 264, 18, 'rgba(255,40,40,0.8)');
        }
      }, 320);
      for (let i = 0; i < 5; i++) {
        const x = ((b.t * 40 + i * 230 - b.camX * 0.2) % (b.w + 200) + b.w + 200) % (b.w + 200) - 100;
        const y = 140 + i * 18 + Math.sin(b.t * 2 + i) * 6;
        ctx.strokeStyle = 'rgba(40,20,50,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 7, y - 3);
        ctx.lineTo(x, y);
        ctx.lineTo(x + 7, y - 3);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(80,70,90,0.6)';
      ctx.fillRect(0, G - 12, b.w, 12);
    },
  };

  // ===== 4-4 紅葉の並木道：落ち葉と焼きいも屋 =====
  T.autumn_street = {
    base: 'street', song: 'street',
    pal: { top: '#dcc3a0', ground: '#5d5650', dark: '#4b4540', brick: '#d2763f', mortar: '#94471c', hi: '#ec9d66', solid: '#c4b29c', solidDark: '#917f6a', semi: '#d84315', semiDark: '#8d2a0b' },
    draw(b) {
      fill(b, [[0, '#4a3a6b'], [0.4, '#d9775b'], [0.8, '#f7b267'], [1, '#ffe0a3']], G);
      sun(b.w * 0.7 - b.camX * 0.04, 230, 34, 'rgba(255,225,160,1)');
      town(b, 'saturate(0.8)', [[0, 'rgba(255,140,60,0.35)'], [1, 'rgba(120,60,40,0.35)']]);
      rep(b, 0.6, 240, (x, n) => tree(x + 90, G, 1.2, pick(n, 2) ? ['#d84315', '#ef6c00', '#bf360c'] : ['#f9a825', '#fbc02d', '#f57f17'], '#4e342e', n * 5));
      rep(b, 0.72, 1700, x => {
        ctx.fillStyle = 'rgba(240,240,240,0.92)';
        ctx.fillRect(x, G - 70, 120, 50);
        ctx.fillRect(x + 120, G - 56, 46, 36);
        ctx.fillStyle = '#3e2723';
        circle(x + 26, G - 16, 13);
        circle(x + 130, G - 16, 13);
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(x + 10, G - 92, 100, 22);
        R.text('石焼きいも', x + 60, G - 81, 13, '#ffe0b2', 'rgba(0,0,0,0.4)');
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        for (let i = 0; i < 3; i++) circle(x + 40 + i * 14 + Math.sin(b.t * 2 + i) * 6, G - 110 - ((b.t * 30 + i * 20) % 60), 8);
      }, 700);
      falling(b, 44, 34, ['#e65100', '#f9a825', '#c62828', '#ff8f00'], 'leaf', 11);
    },
  };

  // ===== 5-3 忘年会へ続く道：雪とイルミネーション =====
  T.winter_street = {
    base: 'street', song: 'winter',
    pal: { top: '#e8eef6', ground: '#4b5266', dark: '#3c4254', brick: '#b0553a', mortar: '#6e2c18', hi: '#d47c5a', solid: '#a9b2c6', solidDark: '#737d93', semi: '#5c8fd6', semiDark: '#2f5a99' },
    draw(b) {
      fill(b, [[0, '#0b1636'], [0.6, '#2d3a78'], [1, '#6c66a6']], G);
      stars(b, 40);
      town(b, 'brightness(0.55) saturate(0.7)', [[0, 'rgba(40,60,140,0.35)'], [1, 'rgba(60,40,110,0.3)']]);
      rep(b, 0.45, 300, x => {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(x, G - 200, 260, 8);
      });
      rep(b, 0.5, 260, (x, n) => {
        glow(x + 70, G - 70, 90, 'rgba(255,200,120,0.4)');
        ctx.fillStyle = '#ffcc80';
        ctx.fillRect(x + 20, G - 110, 100, 70);
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(x + 68, G - 110, 4, 70);
        R.text(['居酒屋', '忘年会', '宴会場', '割烹'][pick(n, 4)], x + 70, G - 124, 13, '#fff', 'rgba(0,0,0,0.5)');
      }, 60);
      rep(b, 0.7, 230, (x, n) => {
        ctx.strokeStyle = '#3e2c26';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(x, G);
        ctx.lineTo(x, G - 180);
        ctx.moveTo(x, G - 120);
        ctx.lineTo(x - 50, G - 190);
        ctx.moveTo(x, G - 100);
        ctx.lineTo(x + 55, G - 170);
        ctx.stroke();
        const cols = ['#ffeb3b', '#80d8ff', '#ff80ab', '#b9f6ca'];
        for (let i = 0; i < 26; i++) {
          if (Math.sin(b.t * 3 + i * 1.7 + n) < -0.3) continue;
          ctx.fillStyle = cols[(i + n) % 4];
          circle(x + (hash(i + n * 3) - 0.5) * 130, G - 200 + hash(i * 5 + n) * 120, 3);
        }
      }, 120);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(0, G - 6, b.w, 6);
      falling(b, 70, 45, ['#ffffff', '#e3f2fd'], 'snow', 21);
    },
  };

  // ===== 6-1 決算フロア：電光掲示板と飛びかう書類 =====
  T.closing = {
    base: 'office', song: 'night',
    pal: { top: '#59606f', ground: '#868e9e', dark: '#727a8a', brick: '#b5553a', mortar: '#73281a', hi: '#d77a5f', solid: '#9aa2b0', solidDark: '#636b79', semi: '#c48f5d', semiDark: '#865a32' },
    draw(b) {
      fill(b, [[0, '#2e3240'], [1, '#424757']]);
      windows(b, 0.7, 400, '#22252f', (x, y, w, h, n) => {
        ctx.fillStyle = grad(y, y + h, [[0, '#3a1f4f'], [0.6, '#c2455c'], [1, '#ff9a5a']]);
        ctx.fillRect(x, y, w, h);
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = '#1d1a2e';
          const bh = 50 + hash(n * 3 + i) * 100;
          ctx.fillRect(x + i * 40, y + h - bh, 34, bh);
        }
      }, 30, 96, 240, 190);
      // 電光掲示板
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 44, b.w, 34);
      const msg = '　決算締め日　本日 18:00 まで　経費精算・請求書・売上計上はお早めに　残業は認めません　';
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 46, b.w, 30);
      ctx.clip();
      const tw = msg.length * 22;
      const off = (b.t * 90) % tw;
      for (let x = -off; x < b.w; x += tw) ledText(msg, x, 61, 22, '#ff9100');
      ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 46; y < 78; y += 3) ctx.fillRect(0, y, b.w, 1);
      rep(b, 0.6, 300, (x, n) => {
        ctx.fillStyle = '#1b1f27';
        ctx.fillRect(x, G - 140, 110, 76);
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(x + 6, G - 134, 98, 64);
        ctx.strokeStyle = pick(n, 2) ? '#ef5350' : '#66bb6a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const yy = G - 102 + Math.sin(i * 1.3 + n + b.t * 0.8) * 18;
          if (i) ctx.lineTo(x + 10 + i * 10, yy);
          else ctx.moveTo(x + 10, yy);
        }
        ctx.stroke();
        ctx.fillStyle = '#37474f';
        ctx.fillRect(x + 50, G - 64, 10, 20);
      }, 60);
      falling(b, 14, 50, ['#fafafa', '#fff8e1'], 'paper', 31);
      floorStrip('#3b404d');
    },
  };

  // ===== 6-2 地下の機密書庫：金庫の扉と非常灯 =====
  T.vault = {
    base: 'basement', song: 'server',
    pal: { top: '#6f8294', ground: '#2c3642', dark: '#222a34', brick: '#5a6b7c', mortar: '#34404c', hi: '#8395a7', solid: '#55626f', solidDark: '#38424d', semi: '#7b8794', semiDark: '#4d5762' },
    draw(b) {
      fill(b, [[0, '#141b24'], [1, '#222c38']]);
      rep(b, 0.35, 120, x => {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(x, b.top, 2, b.bottom - b.top);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        for (let y = 100; y < G; y += 60) circle(x + 8, y, 2);
      });
      rep(b, 0.4, 1200, x => {
        const cx = x + 200, cy = 280;
        ctx.fillStyle = '#4a5866';
        circle(cx, cy, 170);
        ctx.fillStyle = '#5f6f7f';
        circle(cx, cy, 150);
        ctx.strokeStyle = '#3a4652';
        ctx.lineWidth = 6;
        for (const r of [120, 80]) {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, TAU);
          ctx.stroke();
        }
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(b.t * 0.05);
        ctx.strokeStyle = '#b0bec5';
        ctx.lineWidth = 8;
        for (let i = 0; i < 3; i++) {
          ctx.rotate(TAU / 3);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(0, -70);
          ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle = '#90a4ae';
        circle(cx, cy, 16);
        R.text('機密', cx, cy - 135, 16, '#ff5252', 'rgba(0,0,0,0.6)');
      }, 100);
      rep(b, 0.6, 500, x => {
        ctx.fillStyle = '#263238';
        ctx.fillRect(x, 96, 34, 16);
        ctx.fillRect(x + 28, 100, 14, 8);
        if (Math.sin(b.t * 5) > 0) {
          ctx.fillStyle = '#ff1744';
          circle(x + 6, 104, 3);
        }
        ctx.fillStyle = 'rgba(255,60,60,0.06)';
        ctx.beginPath();
        ctx.moveTo(x + 42, 104);
        ctx.lineTo(x + 260, G);
        ctx.lineTo(x + 120, G);
        ctx.fill();
      }, 240);
      const pulse = 0.08 + 0.08 * Math.max(0, Math.sin(b.t * 3));
      ctx.fillStyle = `rgba(255,30,30,${pulse})`;
      ctx.fillRect(0, b.top, b.w, b.bottom - b.top);
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(0, G - 12, b.w, 12);
      ctx.fillStyle = '#fbc02d';
      const so = (b.camX % 32 + 32) % 32;
      for (let x = -so; x < b.w; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, G);
        ctx.lineTo(x + 16, G - 12);
        ctx.lineTo(x + 26, G - 12);
        ctx.lineTo(x + 10, G);
        ctx.fill();
      }
    },
  };

  // ===== 6-3 最上階・役員フロア：木の壁とシャンデリア =====
  T.executive = {
    base: 'office', song: 'night',
    pal: { top: '#7a5a44', ground: '#8a6a52', dark: '#73563f', brick: '#a0522d', mortar: '#5d2f17', hi: '#c47a4f', solid: '#9c7a5c', solidDark: '#6b4f38', semi: '#c9a227', semiDark: '#7f6514' },
    draw(b) {
      fill(b, [[0, '#2b1d16'], [1, '#3b281e']]);
      rep(b, 0.5, 90, x => {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x, b.top, 3, b.bottom - b.top);
      });
      windows(b, 0.7, 480, '#4a3226', (x, y, w, h, n) => {
        ctx.fillStyle = grad(y, y + h, [[0, '#05081a'], [1, '#1a2550']]);
        ctx.fillRect(x, y, w, h);
        for (let i = 0; i < 7; i++) {
          const bh = 60 + hash(n * 7 + i) * 120, bx = x + i * 36;
          ctx.fillStyle = '#0c1226';
          ctx.fillRect(bx, y + h - bh, 30, bh);
          ctx.fillStyle = '#ffe082';
          for (let wy = y + h - bh + 6; wy < y + h - 4; wy += 10)
            for (let wx = bx + 3; wx < bx + 26; wx += 7) if (hash(wx * 0.7 + wy * 1.1 + n) > 0.55) ctx.fillRect(wx, wy, 3, 4);
        }
      }, 40, 70, 260, 210);
      ctx.fillStyle = '#c9a227';
      ctx.fillRect(0, 300, b.w, 4);
      rep(b, 0.6, 480, x => {
        ctx.fillStyle = '#c9a227';
        ctx.fillRect(x, 320, 80, 100);
        ctx.fillStyle = '#2a1f18';
        ctx.fillRect(x + 7, 327, 66, 86);
        ctx.fillStyle = '#5d4a3c';
        circle(x + 40, 358, 14);
        ctx.fillRect(x + 22, 374, 36, 39);
      }, 300);
      rep(b, 0.85, 420, x => {
        ctx.strokeStyle = '#8d6e63';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, b.top);
        ctx.lineTo(x, 60);
        ctx.stroke();
        glow(x, 86, 90, 'rgba(255,220,150,0.35)');
        ctx.strokeStyle = '#d4af37';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(x, 86, 44, 12, 0, 0, TAU);
        ctx.stroke();
        for (let i = 0; i < 7; i++) {
          const xx = x - 40 + i * 13.3;
          ctx.fillStyle = '#fff3c4';
          circle(xx, 80, 4);
          ctx.fillStyle = 'rgba(220,240,255,0.8)';
          ctx.fillRect(xx - 1, 92, 2, 10 + (i % 3) * 4);
        }
      }, 200);
      ctx.fillStyle = '#8e1b1b';
      ctx.fillRect(0, G - 10, b.w, 10);
      ctx.fillStyle = '#c9a227';
      ctx.fillRect(0, G - 10, b.w, 2);
    },
  };

  // ===== 6-4 定時ダッシュ・ファイナル：17:59 の時計台とサーチライト =====
  T.final = {
    base: 'street', song: 'final',
    pal: { top: '#b49ab5', ground: '#3a2f4a', dark: '#2c233a', brick: '#b0553a', mortar: '#6e2c18', hi: '#d47c5a', solid: '#7d6b8c', solidDark: '#54465f', semi: '#ff7043', semiDark: '#b23c17' },
    draw(b) {
      fill(b, [[0, '#120a2b'], [0.4, '#45185a'], [0.72, '#d6457a'], [1, '#ffb35c']], G);
      stars(b, 40);
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + Math.sin(b.t * 0.6 + i * 2.1) * 0.6;
        const x0 = b.w * (0.2 + i * 0.3);
        ctx.fillStyle = 'rgba(255,250,220,0.10)';
        ctx.beginPath();
        ctx.moveTo(x0, G);
        ctx.lineTo(x0 + Math.cos(a - 0.06) * 800, G + Math.sin(a - 0.06) * 800);
        ctx.lineTo(x0 + Math.cos(a + 0.06) * 800, G + Math.sin(a + 0.06) * 800);
        ctx.fill();
      }
      rep(b, 0.12, 1400, x => {
        const cx = x + 400;
        ctx.fillStyle = '#1a1030';
        ctx.fillRect(cx - 60, 110, 120, G - 110);
        ctx.beginPath();
        ctx.moveTo(cx - 70, 112);
        ctx.lineTo(cx, 20);
        ctx.lineTo(cx + 70, 112);
        ctx.fill();
        glow(cx, 180, 90, 'rgba(255,240,180,0.45)');
        ctx.fillStyle = '#fff8e1';
        circle(cx, 180, 44);
        ctx.strokeStyle = '#3e2723';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, 180, 44, 0, TAU);
        ctx.stroke();
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU;
          ctx.fillStyle = '#3e2723';
          ctx.fillRect(cx + Math.sin(a) * 36 - 1.5, 180 - Math.cos(a) * 36 - 1.5, 3, 3);
        }
        const ma = (59 / 60) * TAU + Math.sin(b.t * 6) * 0.01, ha = ((17 % 12) / 12 + 59 / 720) * TAU;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cx, 180);
        ctx.lineTo(cx + Math.sin(ha) * 22, 180 - Math.cos(ha) * 22);
        ctx.stroke();
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx, 180);
        ctx.lineTo(cx + Math.sin(ma) * 34, 180 - Math.cos(ma) * 34);
        ctx.stroke();
        R.text('17:59', cx, 246, 16, '#ffd54f', 'rgba(0,0,0,0.6)');
      }, 0);
      skyline(b, 0.3, '#2a1b40', 80, 150, 44, 'rgba(255,214,120,0.8)', 7);
      skyline(b, 0.5, '#1c1230', 40, 110, 56, 'rgba(255,190,90,0.85)', 8);
      ctx.fillStyle = 'rgba(255,120,80,0.12)';
      ctx.fillRect(0, G - 120, b.w, 120);
    },
  };

  // ===== 5-1 節電フロア：冬の 17 時、照明は 1 本おき =====
  T.night = {
    base: 'office', song: 'night',
    pal: { top: '#4c566e', ground: '#6b7488', dark: '#596276', brick: '#a8583a', mortar: '#6a3218', hi: '#c97a52', solid: '#8a92a3', solidDark: '#5b6373', semi: '#b98a5a', semiDark: '#7a5531' },
    draw(b) {
      const { w, top, bottom, camX, t } = b;
      const GROUND_Y = G, spr = R.spr, img = R.img, canFilter = R.canFilter, rrect = R.rrect, outlinedText = R.text;
          // 冬の 17 時：外はもう真っ暗。節電で照明は 1 本おき
          const g = ctx.createLinearGradient(0, top, 0, bottom);
          g.addColorStop(0, '#2c3040');
          g.addColorStop(1, '#3d4152');
          ctx.fillStyle = g;
          ctx.fillRect(0, top, w, bottom - top);
          const P = 340, off = (camX * 0.75) % P;
          for (let i = -1; i < w / P + 1; i++) {
            const n = Math.floor((camX * 0.75) / P) + i;
            const x = i * P - off + 50;
            ctx.fillStyle = '#23262f';
            ctx.fillRect(x - 8, 62, 256, 236);
            const sky = ctx.createLinearGradient(0, 70, 0, 290);
            sky.addColorStop(0, '#070b1e');
            sky.addColorStop(1, '#2a2850');
            ctx.fillStyle = sky;
            ctx.fillRect(x, 70, 240, 220);
            for (let b = 0; b < 6; b++) {
              const bh = 40 + hash(n * 7 + b) * 110, bw = 30 + hash(n * 5 + b) * 20;
              const bx = x + b * 40, by = 290 - bh;
              ctx.fillStyle = '#151a2c';
              ctx.fillRect(bx, by, bw, bh);
              // 残業中の窓あかり
              ctx.fillStyle = '#ffd97a';
              for (let wy = by + 6; wy < 282; wy += 12)
                for (let wx = bx + 4; wx < bx + bw - 6; wx += 8)
                  if (hash(n * 131 + b * 17 + wx * 0.37 + wy * 1.3) > 0.62) ctx.fillRect(wx, wy, 4, 5);
            }
            ctx.fillStyle = '#23262f';
            ctx.fillRect(x + 116, 70, 8, 220);
            ctx.fillRect(x, 176, 240, 6);
            ctx.fillStyle = 'rgba(160,180,220,0.07)';
            ctx.fillRect(x, 70, 240, 220);
          }
          ctx.fillStyle = '#262934';
          ctx.fillRect(0, top, w, 40 - top);
          const L = 260, loff = (camX * 0.9) % L;
          for (let i = -1; i < w / L + 1; i++) {
            const n = Math.floor((camX * 0.9) / L) + i;
            const x = i * L - loff;
            const on = (n & 1) === 0;
            if (on) {
              const cone = ctx.createLinearGradient(0, 42, 0, GROUND_Y);
              cone.addColorStop(0, 'rgba(255,250,220,0.16)');
              cone.addColorStop(1, 'rgba(255,250,220,0)');
              ctx.fillStyle = cone;
              ctx.beginPath();
              ctx.moveTo(x + 60, 42);
              ctx.lineTo(x + 180, 42);
              ctx.lineTo(x + 240, GROUND_Y);
              ctx.lineTo(x, GROUND_Y);
              ctx.fill();
            }
            ctx.fillStyle = on ? '#fffbe8' : '#4a4d58';
            ctx.fillRect(x + 60, 34, 120, 8);
          }
          const D = 620, doff = (camX * 0.55) % D;
          if (canFilter) ctx.filter = 'brightness(0.55) saturate(0.7)';
          for (let i = -1; i < w / D + 1; i++) spr('office', i * D - doff + 260, GROUND_Y - 14, 180, { alpha: 0.6 });
          if (canFilter) ctx.filter = 'none';
          ctx.fillStyle = '#343846';
          ctx.fillRect(0, GROUND_Y - 12, w, 12);
    },
  };

  // ===== 5-2 年末メンテのサーバールーム：青いランプが点滅する =====
  T.server = {
    base: 'basement', song: 'server',
    pal: { top: '#4f8fae', ground: '#2e4256', dark: '#243546', brick: '#3d8fa8', mortar: '#1f5668', hi: '#6cc3da', solid: '#5a6a7c', solidDark: '#36424f', semi: '#8796a4', semiDark: '#4d5965' },
    draw(b) {
      const { w, top, bottom, camX, t } = b;
      const GROUND_Y = G, spr = R.spr, img = R.img, canFilter = R.canFilter, rrect = R.rrect, outlinedText = R.text;
          // サーバールーム：ラックが並び、ランプが点滅する
          const g = ctx.createLinearGradient(0, top, 0, bottom);
          g.addColorStop(0, '#08121c');
          g.addColorStop(1, '#10222f');
          ctx.fillStyle = g;
          ctx.fillRect(0, top, w, bottom - top);
          const P2 = 120, off2 = (camX * 0.3) % P2;
          ctx.fillStyle = '#0d1a25';
          for (let i = -1; i < w / P2 + 1; i++) ctx.fillRect(i * P2 - off2, 120, 100, GROUND_Y - 120);
          const P = 190, off = (camX * 0.55) % P;
          const LED = ['#3dff8a', '#ffb43d', '#4dc3ff', '#3dff8a'];
          for (let i = -1; i < w / P + 1; i++) {
            const n = Math.floor((camX * 0.55) / P) + i;
            const x = i * P - off + 20;
            ctx.fillStyle = '#2a3a48';
            ctx.fillRect(x - 4, 76, 148, GROUND_Y - 76);
            ctx.fillStyle = '#16232f';
            ctx.fillRect(x, 82, 140, GROUND_Y - 82);
            for (let u = 0; u < 15; u++) {
              const y = 92 + u * 25;
              ctx.fillStyle = u % 4 === 3 ? '#1b2a37' : '#22323f';
              ctx.fillRect(x + 8, y, 124, 19);
              for (let k = 0; k < 3; k++) {
                const h = hash(n * 97 + u * 13 + k * 7);
                const on = Math.sin(t * (2 + h * 9) + h * 40) > -0.3;
                ctx.fillStyle = on ? LED[Math.floor(h * 4)] : '#1d3a2c';
                ctx.fillRect(x + 16 + k * 9, y + 7, 4, 4);
              }
              ctx.fillStyle = '#2c3f4f';
              ctx.fillRect(x + 60, y + 6, 64, 2);
              ctx.fillRect(x + 60, y + 11, 64, 2);
            }
          }
          ctx.fillStyle = '#1a2733';
          ctx.fillRect(0, top, w, 52 - top);
          const L = 360, loff = (camX * 0.8) % L;
          for (let i = -1; i < w / L + 1; i++) {
            const x = i * L - loff + 150;
            const glow = ctx.createRadialGradient(x, 60, 4, x, 60, 220);
            glow.addColorStop(0, 'rgba(120,200,255,0.22)');
            glow.addColorStop(1, 'rgba(120,200,255,0)');
            ctx.fillStyle = glow;
            ctx.fillRect(x - 220, 0, 440, 300);
            ctx.fillStyle = '#bfe6ff';
            ctx.fillRect(x - 50, 52, 100, 5);
          }
    },
  };

  // ===== 5-4 仕事納めの繁華街：星・月・ネオン看板 =====
  T.nightstreet = {
    base: 'street', song: 'nightstreet',
    pal: { top: '#8e8aa6', ground: '#3b3a4c', dark: '#2f2e3e', brick: '#b0553a', mortar: '#6e2c18', hi: '#d47c5a', solid: '#77768c', solidDark: '#4f4e62', semi: '#c25d8a', semiDark: '#7f3a5a' },
    draw(b) {
      const { w, top, bottom, camX, t } = b;
      const GROUND_Y = G, spr = R.spr, img = R.img, canFilter = R.canFilter, rrect = R.rrect, outlinedText = R.text;
          // 冬の夜の繁華街：星、月、ネオン看板
          const g = ctx.createLinearGradient(0, top, 0, GROUND_Y);
          g.addColorStop(0, '#070a22');
          g.addColorStop(0.6, '#1d1d4a');
          g.addColorStop(1, '#5a2d5e');
          ctx.fillStyle = g;
          ctx.fillRect(0, top, w, bottom - top);
          ctx.fillStyle = '#fff';
          const span = w + 200;
          for (let i = 0; i < 70; i++) {
            const x = ((((hash(i) * 3000 - camX * 0.02) % span) + span) % span) - 100;
            const y = top + 10 + hash(i + 70) * 260;
            ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * (0.5 + hash(i + 140)) + i));
            ctx.fillRect(x, y, 2, 2);
          }
          ctx.globalAlpha = 1;
          const mx = w * 0.22 - camX * 0.03, my = 120;
          const moon = ctx.createRadialGradient(mx, my, 20, mx, my, 120);
          moon.addColorStop(0, 'rgba(255,246,216,0.35)');
          moon.addColorStop(1, 'rgba(255,246,216,0)');
          ctx.fillStyle = moon;
          ctx.fillRect(mx - 120, my - 120, 240, 240);
          ctx.fillStyle = '#fff6d8';
          ctx.beginPath();
          ctx.arc(mx, my, 26, 0, Math.PI * 2);
          ctx.fill();
          if (img.town && img.town.naturalWidth) {
            const th = 320, tw = (th * img.town.naturalWidth) / img.town.naturalHeight;
            const toff = (camX * 0.3) % tw;
            if (canFilter) ctx.filter = 'brightness(0.45) saturate(0.8)';
            for (let i = -1; i < w / tw + 1; i++) ctx.drawImage(img.town, i * tw - toff, GROUND_Y - th, tw + 1, th);
            if (canFilter) ctx.filter = 'none';
            const tint = ctx.createLinearGradient(0, GROUND_Y - th, 0, GROUND_Y);
            tint.addColorStop(0, 'rgba(30,30,90,0.45)');
            tint.addColorStop(1, 'rgba(80,30,90,0.35)');
            ctx.fillStyle = tint;
            ctx.fillRect(0, GROUND_Y - th, w, th);
          }
          const SIGNS = ['居酒屋', 'カラオケ', 'ラーメン', '焼鳥', 'BAR', '24H'];
          const NEON = ['#ff4fa3', '#4ff0ff', '#ffe14f', '#7dff6a', '#c77dff'];
          const P = 460, off = (camX * 0.45) % P;
          for (let i = -1; i < w / P + 1; i++) {
            const n = Math.floor((camX * 0.45) / P) + i;
            const m = ((n % 30) + 30) % 30;
            const x = i * P - off + 80 + (m % 3) * 60;
            const y = 230 + ((m * 7) % 4) * 28;
            const col = NEON[m % NEON.length];
            const text = SIGNS[(m * 7) % SIGNS.length];
            ctx.globalAlpha = Math.sin(t * 17 + n * 3) > -0.95 ? 1 : 0.35; // たまにちらつく
            const glow = ctx.createRadialGradient(x, y, 4, x, y, 90);
            glow.addColorStop(0, col + '55');
            glow.addColorStop(1, col + '00');
            ctx.fillStyle = glow;
            ctx.fillRect(x - 90, y - 90, 180, 180);
            rrect(x - 52, y - 18, 104, 36, 8);
            ctx.fillStyle = 'rgba(10,8,20,0.85)';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = col;
            ctx.stroke();
            outlinedText(text, x, y + 1, 20, col, 'rgba(0,0,0,0.6)');
            ctx.globalAlpha = 1;
          }
    },
  };

  return {
    has: k => !!T[k],
    draw(k, api, b) {
      R = api;
      ctx = api.ctx;
      G = api.GROUND_Y;
      B = b;
      T[k].draw(b);
    },
    pal: k => T[k] && T[k].pal,
    base: k => T[k] && T[k].base,
    song: k => T[k] && T[k].song,
    list: () => Object.keys(T),
  };
})();
