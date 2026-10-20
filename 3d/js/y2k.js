// Y2K / フルティガーエアロ風の景色（エアロ晴天・放課後の夕暮れ・深夜の蛍光灯のテーマで表示）
// 白い曲線の建物が建つ小島、コースを囲むモノレールと無人の駅、道路を覆うガラスのアーチ、
// 何も告げない看板、入道雲、立ちのぼる泡、海面のもや
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function canvasTexture(w, h, draw, { repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const mtx = (x, y, z, ry = 0, s = [1, 1, 1], rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), v3(...s));

// 下が平らで上が丸いカプセル形の断面（Lathe 用）
function capsuleProfile(R, H) {
  const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(R, 0), new THREE.Vector2(R, Math.max(0, H - R))];
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * R), H - R + Math.sin(a) * R));
  }
  return pts;
}

export function buildY2K({ Track: T, center, DECK, half }) {
  const rnd = seeded(2003);
  const group = new THREE.Group();
  group.name = 'Y2KWorld';

  // ---------- 素材 ----------
  const M = {
    white: new THREE.MeshPhysicalMaterial({ color: 0xf2f5f8, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 1, roughness: 0.14 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xa6ecff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1,
      side: THREE.DoubleSide, depthWrite: false,
    }),
    windows: new THREE.MeshPhysicalMaterial({ color: 0x4aa6d0, roughness: 0.08, metalness: 0.35, clearcoat: 1, emissive: 0xc8f6ff, emissiveIntensity: 0 }),
    irid: new THREE.MeshPhysicalMaterial({
      color: 0xeaf7ff, roughness: 0.06, metalness: 0.25, clearcoat: 1,
      iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessRange: [140, 460],
    }),
    grass: new THREE.MeshStandardMaterial({ color: 0x83c96c, roughness: 0.92 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xd7dbde, roughness: 0.86 }),
    aqua: new THREE.MeshStandardMaterial({ color: 0x27c4d6, roughness: 0.35, emissive: 0x3ff3ff, emissiveIntensity: 0 }),
    beacon: new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2a2a, emissiveIntensity: 2.5 }),
    tube: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xf2fffb, emissiveIntensity: 0 }),
    farTower: null, // 下で作る（窓の縞模様付き）
    cloud: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.18 }),
  };
  // 遠景の塔：横縞の窓（夜に光る）
  const stripes = canvasTexture(8, 128, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 8, 128);
    for (let y = 2; y < 128; y += 6) {
      g.fillStyle = y % 4 ? '#bff2ff' : '#ffe2b0';
      g.fillRect(0, y, 8, 2);
    }
  });
  M.farTower = new THREE.MeshStandardMaterial({ color: 0xe9eef3, roughness: 0.35, metalness: 0.1, emissive: 0xffffff, emissiveMap: stripes, emissiveIntensity: 0 });

  // ---------- 形を集めて素材ごとに 1 つにまとめる（描画を軽くするため） ----------
  const parts = new Map();
  const add = (name, matKey, geo, matrix) => {
    if (matrix) geo.applyMatrix4(matrix);
    // 結合できるよう属性をそろえる
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    const key = name + '|' + matKey;
    if (!parts.has(key)) parts.set(key, { name, matKey, geos: [] });
    parts.get(key).geos.push(geo);
  };

  // ---------- 建物の部品 ----------
  function capsuleTower(cat, x, y0, z, R, H) {
    add(cat, 'white', new THREE.LatheGeometry(capsuleProfile(R, H), 40), mtx(x, y0, z));
    for (let y = 70; y < H - R * 0.9; y += 110) add(cat, 'windows', new THREE.CylinderGeometry(R * 1.012, R * 1.012, 30, 40, 1, true), mtx(x, y0 + y, z));
    add(cat, 'aqua', new THREE.TorusGeometry(R * 1.04, Math.max(3, R * 0.025), 8, 48), mtx(x, y0 + 16, z, 0, [1, 1, 1], Math.PI / 2));
    if (H > 700) add('Beacons', 'beacon', new THREE.SphereGeometry(7, 10, 8), mtx(x, y0 + H + 6, z));
  }
  function dome(cat, x, y0, z, R) {
    add(cat, 'white', new THREE.SphereGeometry(R, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), mtx(x, y0, z));
    add(cat, 'glass', new THREE.SphereGeometry(R * 1.01, 48, 6, 0, Math.PI * 2, 0, 0.42), mtx(x, y0, z));
    add(cat, 'windows', new THREE.CylinderGeometry(R * 1.003, R * 1.003, R * 0.12, 48, 1, true), mtx(x, y0 + R * 0.08, z));
  }
  function ballTower(cat, x, y0, z, H, R) {
    add(cat, 'chrome', new THREE.CylinderGeometry(R * 0.14, R * 0.24, H, 20), mtx(x, y0 + H / 2, z));
    add(cat, 'irid', new THREE.SphereGeometry(R, 48, 32), mtx(x, y0 + H + R * 0.8, z));
    add(cat, 'chrome', new THREE.TorusGeometry(R * 1.45, R * 0.045, 10, 72), mtx(x, y0 + H + R * 0.8, z, rnd() * 3, [1, 1, 1], Math.PI / 2 + 0.18));
    add('Beacons', 'beacon', new THREE.SphereGeometry(6, 10, 8), mtx(x, y0 + H + R * 1.8 + 6, z));
  }
  function discStack(cat, x, y0, z, H, R) {
    add(cat, 'chrome', new THREE.CylinderGeometry(R * 0.24, R * 0.24, H, 24), mtx(x, y0 + H / 2, z));
    const n = 5;
    for (let k = 0; k < n; k++) {
      const r = R * (1 - k * 0.09), y = y0 + (H * (k + 1)) / (n + 1);
      add(cat, 'white', new THREE.CylinderGeometry(r, r * 0.9, 20, 56), mtx(x, y, z));
      add(cat, 'windows', new THREE.CylinderGeometry(r * 0.93, r * 0.93, 14, 56, 1, true), mtx(x, y - 16, z));
    }
  }
  function torusPavilion(cat, x, y0, z, R) {
    const h = R * 0.45;
    add(cat, 'white', new THREE.TorusGeometry(R, R * 0.15, 20, 80), mtx(x, y0 + h, z, 0, [1, 1, 1], Math.PI / 2));
    add(cat, 'glass', new THREE.CylinderGeometry(R * 0.95, R * 0.95, 2, 64), mtx(x, y0 + h, z));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      add(cat, 'chrome', new THREE.CylinderGeometry(R * 0.04, R * 0.05, h, 12), mtx(x + Math.cos(a) * R, y0 + h / 2, z + Math.sin(a) * R));
    }
  }

  // ---------- 小島 ----------
  const b = T.bounds;
  const ell = { rx: (b.maxX - b.minX) / 2 + 1500, rz: (b.maxY - b.minY) / 2 + 1500 };
  const islands = [];
  for (let tries = 0; tries < 900 && islands.length < 13; tries++) {
    const x = center.x + (rnd() * 2 - 1) * (ell.rx + 1200), z = center.z + (rnd() * 2 - 1) * (ell.rz + 1200);
    const R = 380 + rnd() * 620;
    if (T.nearest(x, z).dist < half + R + 300) continue;
    const e = Math.hypot((x - center.x) / ell.rx, (z - center.z) / ell.rz);
    if (Math.abs(e - 1) * Math.min(ell.rx, ell.rz) < R + 350) continue;
    if (islands.some(o => Math.hypot(o.x - x, o.z - z) < o.R + R + 350)) continue;
    islands.push({ x, z, R });
  }
  islands.forEach((is, i) => {
    const { x, z, R } = is;
    add('Islands', 'concrete', new THREE.CylinderGeometry(R, R * 1.07, 60, 64), mtx(x, -5, z));
    add('Islands', 'grass', new THREE.CylinderGeometry(R * 0.92, R * 0.92, 6, 64), mtx(x, 27, z));
    add('Islands', 'white', new THREE.TorusGeometry(R * 0.96, 7, 8, 96), mtx(x, 27, z, 0, [1, 1, 1], Math.PI / 2));
    const y0 = 30;
    switch (i % 5) {
      case 0:
        capsuleTower('Towers', x, y0, z, R * 0.22, 900 + rnd() * 600);
        capsuleTower('Towers', x + R * 0.45, y0, z + R * 0.2, R * 0.14, 480 + rnd() * 300);
        dome('Towers', x - R * 0.4, y0, z - R * 0.25, R * 0.28);
        break;
      case 1:
        dome('Towers', x, y0, z, R * 0.55);
        ballTower('Towers', x + R * 0.55, y0, z - R * 0.3, 380 + rnd() * 200, R * 0.13);
        break;
      case 2:
        discStack('Towers', x, y0, z, 700 + rnd() * 400, R * 0.42);
        break;
      case 3:
        torusPavilion('Towers', x, y0, z, R * 0.55);
        capsuleTower('Towers', x - R * 0.2, y0, z + R * 0.1, R * 0.12, 600 + rnd() * 500);
        break;
      default:
        ballTower('Towers', x, y0, z, 600 + rnd() * 400, R * 0.2);
        dome('Towers', x - R * 0.45, y0, z + R * 0.3, R * 0.25);
    }
  });

  // ---------- 遠くの未来都市 ----------
  {
    const unit = new THREE.LatheGeometry(capsuleProfile(1, 6), 28);
    const clusters = [0.4, 1.4, 2.35, 3.3, 4.3, 5.4];
    const list = [];
    for (const ang of clusters) {
      const R = 21000 + rnd() * 9000;
      const cx = center.x + Math.cos(ang) * R, cz = center.z + Math.sin(ang) * R;
      const n = 22 + ((rnd() * 18) | 0);
      for (let i = 0; i < n; i++) {
        const rr = Math.pow(rnd(), 0.7) * 3200, aa = rnd() * Math.PI * 2;
        const tall = 1 - rr / 3200;
        list.push({ x: cx + Math.cos(aa) * rr, z: cz + Math.sin(aa) * rr, r: 140 + rnd() * 260, h: 600 + rnd() * 1400 + tall * tall * 3600 });
      }
      add('FarIslands', 'concrete', new THREE.CylinderGeometry(3800, 4100, 60, 48), mtx(cx, -10, cz));
    }
    list.forEach(q => add('FarCity', 'farTower', unit.clone(), mtx(q.x, 20, q.z, 0, [q.r, q.h / 6, q.r])));
  }

  // ---------- モノレール ----------
  const MONO_H = 380;
  const curvePts = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    curvePts.push(v3(center.x + Math.cos(a) * ell.rx, MONO_H + Math.sin(a * 3) * 24, center.z + Math.sin(a) * ell.rz));
  }
  const curve = new THREE.CatmullRomCurve3(curvePts, true, 'catmullrom', 0.5);
  const curveLen = curve.getLength();
  add('Monorail', 'white', new THREE.TubeGeometry(curve, 900, 15, 10, true));
  for (let d = 0; d < curveLen; d += 850) {
    const p = curve.getPointAt(d / curveLen), tg = curve.getTangentAt(d / curveLen);
    const ang = Math.atan2(tg.z, tg.x);
    const h = p.y - 14 + 60;
    add('Monorail', 'white', new THREE.CylinderGeometry(9, 14, h, 16), mtx(p.x, -60 + h / 2, p.z));
    add('Monorail', 'chrome', new THREE.BoxGeometry(60, 12, 34), mtx(p.x, p.y - 18, p.z, -ang));
  }

  // 走り続ける無人の列車
  const train = new THREE.Group();
  train.name = 'MonorailTrain';
  const carGeo = new THREE.LatheGeometry(capsuleProfile(21, 75), 32);
  {
    // カプセルを上下に合わせて横倒しにし、前後対称の車体にする
    const top = carGeo.clone();
    const bottom = carGeo.clone().rotateX(Math.PI);
    const body = mergeGeometries([top, bottom]);
    body.rotateX(Math.PI / 2);
    for (let k = 0; k < 3; k++) {
      const car = new THREE.Group();
      car.name = `TrainCar${k + 1}`;
      const shell = new THREE.Mesh(body, M.white);
      shell.name = `TrainCar${k + 1}_Body`;
      const win = new THREE.Mesh(new THREE.BoxGeometry(46, 9, 120), M.windows);
      win.name = `TrainCar${k + 1}_Windows`;
      win.position.y = 7;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(44, 3, 130), M.aqua);
      stripe.name = `TrainCar${k + 1}_Stripe`;
      stripe.position.y = -6;
      car.add(shell, win, stripe);
      train.add(car);
    }
  }
  let trainU = 0.1;

  // ---------- 無人の駅（スタート地点に近いところ） ----------
  {
    const s0 = T.pointAt(0);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < 600; i++) {
      const p = curve.getPointAt(i / 600);
      const d = Math.hypot(p.x - s0.x, p.z - s0.y);
      if (d < bestD) { bestD = d; best = i / 600; }
    }
    const p = curve.getPointAt(best), tg = curve.getTangentAt(best);
    const ang = Math.atan2(tg.z, tg.x);
    // 外側（コースと反対側）にホームを置く
    let nx = -tg.z, nz = tg.x;
    if ((p.x - center.x) * nx + (p.z - center.z) * nz < 0) { nx = -nx; nz = -nz; }
    const base = new THREE.Matrix4().compose(v3(p.x + nx * 75, p.y - 40, p.z + nz * 75), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -ang, 0)), v3(1, 1, 1));
    const at = (geo, m) => geo.applyMatrix4(m ? new THREE.Matrix4().multiplyMatrices(base, m) : base);
    add('Station', 'white', at(new THREE.BoxGeometry(820, 22, 130)));
    add('Station', 'glass', at(new THREE.CylinderGeometry(78, 78, 820, 32, 1, true, 0, Math.PI).rotateZ(Math.PI / 2), mtx(0, 11, 0)));
    for (let x = -400; x <= 400; x += 100) add('Station', 'white', at(new THREE.TorusGeometry(78, 3, 6, 24, Math.PI).rotateY(Math.PI / 2), mtx(x, 11, 0)));
    for (let x = -350; x <= 350; x += 100) add('StationLights', 'tube', at(new THREE.BoxGeometry(60, 2, 4), mtx(x, 84, 0)));
    for (const x of [-300, -60, 180]) {
      add('Station', 'chrome', at(new THREE.BoxGeometry(90, 6, 22), mtx(x, 28, 30)));
      add('Station', 'chrome', at(new THREE.BoxGeometry(4, 16, 4), mtx(x - 40, 19, 30)));
      add('Station', 'chrome', at(new THREE.BoxGeometry(4, 16, 4), mtx(x + 40, 19, 30)));
    }
    for (let x = -390; x <= 390; x += 260) add('Station', 'white', at(new THREE.CylinderGeometry(14, 18, p.y + 20, 16), mtx(x, -11 - (p.y + 20) / 2, 40)));
    // 駅名と、来ない列車の案内
    const sign = canvasTexture(512, 128, (g) => {
      g.fillStyle = '#f5f8fb';
      g.fillRect(0, 0, 512, 128);
      g.fillStyle = '#26c3d6';
      g.fillRect(0, 96, 512, 10);
      g.fillStyle = '#1d3340';
      g.font = 'bold 46px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('未来駅', 256, 58);
      g.font = '20px system-ui, sans-serif';
      g.fillText('MIRAI STATION', 256, 88);
    });
    const board = canvasTexture(512, 128, (g) => {
      g.fillStyle = '#05080a';
      g.fillRect(0, 0, 512, 128);
      g.fillStyle = '#ffb347';
      g.font = 'bold 30px monospace';
      g.fillText('次の列車   --:--', 24, 52);
      g.fillStyle = '#7fe8ff';
      g.font = '22px monospace';
      g.fillText('行先  ─────', 24, 96);
    });
    const signMat = new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.2 });
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: board, emissiveIntensity: 1.4 });
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(200, 50), signMat);
    s1.name = 'StationSign';
    s1.applyMatrix4(new THREE.Matrix4().multiplyMatrices(base, mtx(-150, 56, 0, Math.PI / 2)));
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(140, 36), boardMat);
    s2.name = 'StationBoard';
    s2.applyMatrix4(new THREE.Matrix4().multiplyMatrices(base, mtx(150, 56, 0, -Math.PI / 2)));
    // 誰も使わない自動販売機
    const vend = canvasTexture(64, 128, (g) => {
      g.fillStyle = '#e8f6ff';
      g.fillRect(0, 0, 64, 128);
      const cols = ['#ff5a7a', '#36c9ff', '#ffd23f', '#7dff9a', '#ff9a3d', '#b48cff'];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        g.fillStyle = cols[(r * 4 + c) % cols.length];
        g.fillRect(6 + c * 14, 8 + r * 18, 10, 14);
      }
      g.fillStyle = '#26323a';
      g.fillRect(8, 90, 48, 26);
    });
    const vendMat = new THREE.MeshStandardMaterial({ map: vend, emissive: 0xffffff, emissiveMap: vend, emissiveIntensity: 0.9 });
    add('Station', 'white', at(new THREE.BoxGeometry(34, 74, 26), mtx(330, 48, 40)));
    const v = new THREE.Mesh(new THREE.PlaneGeometry(30, 66), vendMat);
    v.name = 'VendingMachine';
    v.applyMatrix4(new THREE.Matrix4().multiplyMatrices(base, mtx(330, 48, 26.5, Math.PI)));
    group.add(s1, s2, v);
    group.userData.glowMats = [signMat, boardMat, vendMat];
  }

  // ---------- 道路を覆うガラスのアーチ ----------
  const canopyRange = [T.length * 0.3, T.length * 0.3 + 1700];
  {
    const RW = 300, RH = 370, step = 25, seg = 18;
    const pos = [], uv = [], idx = [];
    let rows = 0;
    for (let s = canopyRange[0]; s <= canopyRange[1] + 0.1; s += step) {
      const p = T.pointAt(s), nx = -p.ty, nz = p.tx;
      for (let j = 0; j <= seg; j++) {
        const th = (j / seg) * Math.PI;
        const lat = Math.cos(th) * RW, y = DECK + Math.sin(th) * RH;
        pos.push(p.x + nx * lat, y, p.y + nz * lat);
        uv.push((s - canopyRange[0]) / 100, j / seg);
      }
      rows++;
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let j = 0; j < seg; j++) {
        const a = r * (seg + 1) + j, c = a + seg + 1;
        idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    add('GlassCanopy', 'glass', g);
    // アーチの足を載せる、道路の外側の細い張り出し（箱を並べる）
    for (let s = canopyRange[0]; s <= canopyRange[1]; s += 40) {
      const p = T.pointAt(s + 20), ang = Math.atan2(p.ty, p.tx);
      for (const sd of [-1, 1]) {
        const lat = 290 * sd;
        add('CanopyLedges', 'white', new THREE.BoxGeometry(42, 14, 58), mtx(p.x - p.ty * lat, DECK - 7, p.y + p.tx * lat, -ang));
      }
    }
    for (let s = canopyRange[0]; s <= canopyRange[1] + 0.1; s += 170) {
      const p = T.pointAt(s), nx = -p.ty, nz = p.tx;
      const arc = [];
      for (let j = 0; j <= 24; j++) {
        const th = (j / 24) * Math.PI;
        arc.push(v3(p.x + nx * Math.cos(th) * RW, DECK + Math.sin(th) * RH, p.y + nz * Math.cos(th) * RW));
      }
      add('CanopyRibs', 'chrome', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arc), 30, 4.5, 6, false));
    }
  }

  // ---------- 何も告げない看板 ----------
  const billboardMats = [];
  {
    const texts = [
      ['ようこそ、明日へ。', 'WELCOME TO TOMORROW'],
      ['AQUA LINE', '全線開通'],
      ['あなたの未来は', 'すでに予約されています'],
      ['SKY RESORT 2003', ''],
      ['', ''],
      ['この先', '案内はありません'],
    ];
    const fracs = [0.1, 0.22, 0.45, 0.57, 0.72, 0.9];
    fracs.forEach((f, i) => {
      const s = T.length * f, p = T.pointAt(s), side = i % 2 ? 1 : -1;
      const nx = -p.ty * side, nz = p.tx * side;
      const lat = half + 230;
      const x = p.x + nx * lat, z = p.y + nz * lat;
      const H = DECK + 440;
      add('Billboards', 'white', new THREE.CylinderGeometry(10, 14, H + 60, 16), mtx(x, (H - 60) / 2, z));
      // 向かってくる車の方へ、少し道路側に傾けて向ける
      const fx = -p.tx * 0.85 - nx * 0.5, fz = -p.ty * 0.85 - nz * 0.5;
      const ry = Math.atan2(fx, fz);
      add('Billboards', 'white', new THREE.BoxGeometry(540, 280, 16), mtx(x, H, z, ry));
      const [t1, t2] = texts[i];
      const tex = canvasTexture(512, 256, (g) => {
        const grad = g.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, '#e9fbff');
        grad.addColorStop(0.55, '#9fe4f5');
        grad.addColorStop(1, '#3fb6d6');
        g.fillStyle = grad;
        g.fillRect(0, 0, 512, 256);
        // つややかな球のロゴ
        const rg = g.createRadialGradient(92, 98, 6, 110, 120, 70);
        rg.addColorStop(0, '#ffffff');
        rg.addColorStop(0.3, '#8ff0ff');
        rg.addColorStop(1, '#1a8fb8');
        g.fillStyle = rg;
        g.beginPath();
        g.arc(110, 124, 62, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.beginPath();
        g.ellipse(98, 98, 34, 16, -0.4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#103848';
        g.font = 'bold 38px system-ui, sans-serif';
        g.fillText(t1, 196, 118);
        g.font = '24px system-ui, sans-serif';
        g.fillText(t2, 198, 156);
        // 色あせ
        g.fillStyle = 'rgba(255, 240, 220, 0.12)';
        g.fillRect(0, 0, 512, 256);
      });
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0, roughness: 0.6 });
      billboardMats.push(mat);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(512, 256), mat);
      face.name = 'BillboardFace';
      face.applyMatrix4(mtx(x + Math.sin(ry) * 9, H, z + Math.cos(ry) * 9, ry));
      group.add(face);
    });
  }

  // ---------- まとめて Mesh にする ----------
  for (const { name, matKey, geos } of parts.values()) {
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, M[matKey]);
    mesh.name = name + (matKey === 'white' ? '' : '_' + matKey);
    mesh.castShadow = !['glass', 'windows', 'tube', 'beacon'].includes(matKey) && name !== 'FarCity' && name !== 'FarIslands';
    mesh.receiveShadow = true;
    mesh.userData.part = name;
    group.add(mesh);
  }

  // ---------- 入道雲 ----------
  const clouds = (() => {
    const geos = [];
    // 地平線近くに浮かぶ入道雲（近すぎると空を覆ってしまうので遠めに置く）
    for (let i = 0; i < 28; i++) {
      const ang = rnd() * Math.PI * 2, R = 26000 + rnd() * 50000;
      const cx = center.x + Math.cos(ang) * R, cz = center.z + Math.sin(ang) * R, cy = 3500 + rnd() * 4500;
      const size = 1600 + rnd() * 2600;
      const blobs = 7 + ((rnd() * 6) | 0);
      for (let k = 0; k < blobs; k++) {
        const r = size * (0.35 + rnd() * 0.45);
        const g = new THREE.IcosahedronGeometry(1, 3);
        g.applyMatrix4(mtx(cx + (rnd() * 2 - 1) * size * 1.2, cy + rnd() * size * 0.5, cz + (rnd() * 2 - 1) * size * 0.8, 0, [r, r * 0.72, r]));
        geos.push(g);
      }
    }
    const m = new THREE.Mesh(mergeGeometries(geos), M.cloud);
    m.name = 'Clouds';
    return m;
  })();

  // ---------- 立ちのぼる泡（エアロ晴天） ----------
  const BUBBLES = 160;
  const bubbleMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false,
    iridescence: 1, iridescenceIOR: 1.3, iridescenceThicknessRange: [200, 600], clearcoat: 1,
  });
  const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), bubbleMat, BUBBLES);
  bubbles.name = 'Bubbles';
  bubbles.frustumCulled = false;
  const bub = Array.from({ length: BUBBLES }, () => ({ x: 0, y: -1e5, z: 0, r: 3, v: 20, ph: 0 }));
  const dummy = new THREE.Object3D();

  // ---------- 海面のもや（夕暮れ・深夜） ----------
  const mistTex = canvasTexture(256, 256, (g) => {
    const r = seeded(77);
    g.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 70; i++) {
      const x = r() * 256, y = r() * 256, rad = 20 + r() * 60;
      for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        gr.addColorStop(0, 'rgba(255,255,255,0.22)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
  }, { repeat: true });
  mistTex.repeat.set(24, 24);
  const mist = new THREE.Group();
  mist.name = 'Mist';
  const mistMats = [];
  for (const [y, op] of [[35, 0.5], [85, 0.35], [140, 0.22]]) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: mistTex.clone(), transparent: true, opacity: op, depthWrite: false, fog: true });
    mat.map.repeat.set(24, 24);
    mat.map.needsUpdate = true;
    mat.userData.baseOpacity = op;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2), mat);
    pl.position.set(center.x, y, center.z);
    mist.add(pl);
    mistMats.push(mat);
  }

  group.add(train);

  // ---------- テーマごとの見た目 ----------
  let cur = null;
  function applyTheme(t) {
    cur = t;
    const night = t.y2kNight || 0; // 0（昼）〜 1（夜）
    M.windows.emissiveIntensity = 1.6 * night;
    M.windows.emissive.set(t.windowColor || 0xc8f6ff);
    M.aqua.emissiveIntensity = 1.2 * night;
    M.farTower.emissiveIntensity = 1.1 * night;
    M.farTower.color.set(night > 0.6 ? 0x2a3540 : 0xe9eef3);
    M.tube.emissiveIntensity = 2.6 * Math.max(0.15, night);
    M.tube.emissive.set(t.lampColor || 0xf2fffb);
    M.glass.color.set(t.glassColor || 0xa6ecff);
    M.glass.opacity = night > 0.6 ? 0.14 : 0.22;
    M.grass.color.set(night > 0.6 ? 0x2c4a33 : 0x83c96c);
    M.cloud.color.set(t.cloudColor || 0xffffff);
    M.cloud.emissive.set(t.cloudGlow || 0xffffff);
    M.cloud.emissiveIntensity = t.cloudGlowI || 0.18;
    for (const m of billboardMats) m.emissiveIntensity = 0.15 + 1.1 * night;
    for (const m of group.userData.glowMats) m.emissiveIntensity = (m.userData.base || (m.userData.base = m.emissiveIntensity)) * (0.3 + 0.7 * night);
    clouds.visible = !!t.clouds;
    bubbles.visible = !!t.bubbles;
    mist.visible = !!t.mist;
    for (const m of mistMats) {
      m.color.set(t.mist || 0xffffff);
      m.opacity = m.userData.baseOpacity * (t.mistAmount || 1);
    }
  }

  // ---------- 毎フレーム ----------
  function update(t, dt, target) {
    // 列車
    trainU = (trainU + (dt * 520) / curveLen) % 1;
    train.children.forEach((car, k) => {
      const u = (trainU - (k * 175) / curveLen + 1) % 1;
      const p = curve.getPointAt(u), q = curve.getPointAt((u + 0.001) % 1);
      car.position.set(p.x, p.y + 38, p.z);
      car.lookAt(q.x, q.y + 38, q.z);
    });
    // 看板と駅の明かりのちらつき（深夜・夕暮れ）
    if (cur && cur.flicker) {
      const f = Math.random() < 0.08 ? 0.1 : 1;
      billboardMats[2].emissiveIntensity = (0.15 + 1.1 * (cur.y2kNight || 0)) * f;
      M.tube.emissiveIntensity = 2.6 * Math.max(0.15, cur.y2kNight || 0) * (Math.random() < 0.03 ? 0.2 : 1);
    }
    // 航空障害灯の点滅
    M.beacon.emissiveIntensity = Math.sin(t / 420) > 0.2 ? 3 : 0.2;
    // もやをゆっくり流す
    if (mist.visible) mistMats.forEach((m, i) => { m.map.offset.x += dt * 0.0008 * (i + 1); m.map.offset.y += dt * 0.0005; });
    // 泡
    if (bubbles.visible && target) {
      for (let i = 0; i < BUBBLES; i++) {
        const q = bub[i];
        if (q.y > 300 || Math.hypot(q.x - target.x, q.z - target.y) > 1100) {
          const a = Math.random() * Math.PI * 2, r = 120 + Math.random() * 950;
          q.x = target.x + Math.cos(a) * r;
          q.z = target.y + Math.sin(a) * r;
          q.y = Math.random() * 40;
          q.r = 2 + Math.random() * 9;
          q.v = 12 + Math.random() * 26;
          q.ph = Math.random() * 6;
        }
        q.y += q.v * dt;
        dummy.position.set(q.x + Math.sin(t / 700 + q.ph) * 6, q.y, q.z + Math.cos(t / 900 + q.ph) * 6);
        dummy.scale.setScalar(q.r);
        dummy.updateMatrix();
        bubbles.setMatrixAt(i, dummy.matrix);
      }
      bubbles.instanceMatrix.needsUpdate = true;
    }
  }

  return { group, clouds, bubbles, mist, train, materials: M, applyTheme, update, roadParts: ['GlassCanopy', 'CanopyLedges', 'CanopyRibs', 'Billboards', 'BillboardFace'] };
}
