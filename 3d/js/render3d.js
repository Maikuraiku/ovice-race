// 3D 描画（Three.js / WebGL）
// ゲームの 2D 座標 (x, y) を 3D の (x, z) に対応させ、y を高さに使う。1 単位 ≒ 10 cm
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Water } from 'three/addons/objects/Water.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const DECK = 140; // 海面から道路面までの高さ
const DECK_THICK = 34;
const LAMP_H = 170;
const LIGHT_GAP = 300; // track.js の街灯間隔と同じ

export const QUALITIES = {
  high: { label: '最高', pixelRatio: 2, shadow: 2048, reflect: 1024, bloom: true, spots: 6 },
  medium: { label: '標準', pixelRatio: 1.25, shadow: 1024, reflect: 0, bloom: true, spots: 3 },
  low: { label: '軽量', pixelRatio: 0.85, shadow: 0, reflect: 0, bloom: false, spots: 0 },
};
export const QUALITY_ORDER = ['high', 'medium', 'low'];

// 朝の空（澄んだ青空になるよう、かすみ少なめ）
const SKY = { turbidity: 2.8, rayleigh: 2.2, mieCoefficient: 0.003, mieDirectionalG: 0.85 };

const THEMES = {
  morning: {
    fog: 0xc9dceb, fogNear: 14000, fogFar: 140000, exposure: 0.52,
    hemiSky: 0xd8ecff, hemiGround: 0x2a5a78, hemi: 1.0, env: 0.9,
    sun: 0xfff0d8, sunI: 3.2, sunElev: 14, sunAzim: 130,
    water: 0x1d78a3, waterSun: 0xfff2dc,
    road: 0, lamp: 0.2, cat: 0.25, windows: 0, headlight: 0.4, tail: 1.2, spot: 0, myHead: 0,
    city: 0x93a2b3, mountain: 0x4f7186,
    bloom: 0.3, bloomThreshold: 0.95,
  },
  night: {
    fog: 0x07111f, fogNear: 2500, fogFar: 55000, exposure: 1.0,
    hemiSky: 0x40568a, hemiGround: 0x04070d, hemi: 0.5, env: 0.55,
    sun: 0xaabfff, sunI: 0.6, sunElev: 30, sunAzim: 230, // 月明かり
    water: 0x021626, waterSun: 0xbfcfff,
    road: 0.8, lamp: 4, cat: 2.2, windows: 1.0, headlight: 5, tail: 3.2, spot: 3, myHead: 9,
    city: 0x161d29, mountain: 0x0a1018,
    bloom: 0.7, bloomThreshold: 0.8,
  },
};

// 決まった並びの乱数（全員の画面で同じ景色にする）
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function canvasTexture(w, h, draw, { srgb = true, repeat = false, flipY = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.flipY = flipY;
  return t;
}

// 継ぎ目なしで繰り返せる波の法線マップ（いくつもの向きの波を重ねる）
function makeWaterNormals(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const rnd = seeded(5);
  const waves = [];
  for (let i = 0; i < 28; i++) {
    let kx = Math.round((rnd() * 2 - 1) * 9), ky = Math.round((rnd() * 2 - 1) * 9);
    if (!kx && !ky) kx = 1;
    waves.push({ kx, ky, amp: 1 / Math.pow(Math.hypot(kx, ky), 1.3), ph: rnd() * Math.PI * 2 });
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0, dy = 0;
      for (const w of waves) {
        const a = ((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.ph;
        const c2 = Math.cos(a) * w.amp * Math.PI * 2;
        dx += c2 * w.kx;
        dy += c2 * w.ky;
      }
      const nx = -dx * 0.06, ny = -dy * 0.06, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      img.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const glowSprite = () =>
  canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });

// ---------- 粒子（水しぶき・排気の炎） ----------
class Particles {
  constructor(max, size, texture) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size, map: texture, vertexColors: true, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false,
      })
    );
    this.points.frustumCulled = false;
  }
  emit(x, y, z, vx, vy, vz, r, g, b, life, gravity = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.base.set([r, g, b], i * 3);
    this.life[i] = this.maxLife[i] = life;
    this.drag[i] = gravity;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.drag[i] * dt;
      for (let j = 0; j < 3; j++) {
        this.pos[i * 3 + j] += this.vel[i * 3 + j] * dt;
        this.col[i * 3 + j] = this.base[i * 3 + j] * k;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

export function createRenderer(opts) {
  const T = opts.Track;
  const canvas = opts.canvas;
  let Q = QUALITIES[opts.quality] || QUALITIES.high;
  let qualityName = QUALITIES[opts.quality] ? opts.quality : 'high';
  let th = THEMES[opts.theme] || THEMES.night;
  let themeName = THEMES[opts.theme] ? opts.theme : 'night';

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
  const camera = new THREE.PerspectiveCamera(62, 1, 4, 260000);

  const b = T.bounds;
  const center = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minY + b.maxY) / 2);

  // ---------- 道路（高架の床版） ----------
  const P = T.pts, N = P.length;
  const half = T.width / 2 + T.margin;
  const sAt = new Float32Array(N + 1);
  for (let i = 0; i < N; i++) {
    const a = P[i], c = P[(i + 1) % N];
    sAt[i + 1] = sAt[i] + Math.hypot(c.x - a.x, c.y - a.y);
  }
  const nrm = P.map((p, i) => {
    const a = P[(i - 1 + N) % N], c = P[(i + 1) % N];
    const dx = c.x - a.x, dy = c.y - a.y, l = Math.hypot(dx, dy);
    return { x: -dy / l, y: dx / l }; // 進行方向の右
  });

  // 路面テクスチャ：横 1 枚 = 街灯 1 区間（300）、縦 = 道路の幅（左端→右端）
  const PXU = 1024 / LIGHT_GAP, PXV = 1024 / (half * 2);
  const vOf = lat => (lat + half) * PXV;
  const roadMap = canvasTexture(
    1024, 1024,
    (g) => {
      const rnd = seeded(11);
      g.fillStyle = '#8b8e94';
      g.fillRect(0, 0, 1024, 1024);
      for (let i = 0; i < 70000; i++) {
        const v = (100 + rnd() * 70) | 0;
        g.fillStyle = `rgba(${v},${v},${v + 4},0.32)`;
        g.fillRect(rnd() * 1024, rnd() * 1024, 1 + rnd() * 2, 1 + rnd() * 2);
      }
      // 車線ごとのタイヤの跡
      for (const lat of [-160, 0, 160]) {
        for (const off of [-34, 34]) {
          g.fillStyle = 'rgba(35,35,40,0.13)';
          g.fillRect(0, vOf(lat + off - 11), 1024, 22 * PXV);
        }
      }
      // 縁のコンクリート
      g.fillStyle = '#b8babd';
      g.fillRect(0, 0, 1024, vOf(-T.width / 2));
      g.fillRect(0, vOf(T.width / 2), 1024, 1024 - vOf(T.width / 2));
      // 床版の継ぎ目
      g.fillStyle = 'rgba(25,25,28,0.55)';
      g.fillRect(0, 0, 3, 1024);
      // 白線（外側は実線、車線は 75 ごとの破線）
      g.fillStyle = '#f4f4f4';
      for (const sd of [-1, 1]) g.fillRect(0, vOf(sd * (T.width / 2 - 16)) - 3.5 * PXV, 1024, 7 * PXV);
      for (const sd of [-1, 1]) for (const u0 of [0.06, 0.56]) g.fillRect(u0 * 1024, vOf((sd * T.width) / 6) - 3 * PXV, 0.25 * 1024, 6 * PXV);
    },
    { repeat: true, flipY: false }
  );
  roadMap.anisotropy = maxAniso;
  // 夜の街灯の光だまり（街灯の位置に合わせて焼き込んだ発光マップ）
  const poolMap = canvasTexture(
    1024, 1024,
    (g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, 1024, 1024);
      g.globalCompositeOperation = 'lighter';
      const pool = (u, lat) => {
        for (const du of [-1, 0, 1]) {
          g.save();
          g.translate((u + du) * 1024, vOf(lat));
          g.scale(PXU, PXV);
          const r = 185;
          const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
          grad.addColorStop(0, 'rgba(255,255,255,0.95)');
          grad.addColorStop(0.4, 'rgba(255,255,255,0.4)');
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = grad;
          g.beginPath();
          g.arc(0, 0, r, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
      };
      pool(0, -(T.width / 2 - 50));
      pool(0.5, T.width / 2 - 50);
    },
    { repeat: true, flipY: false }
  );
  poolMap.anisotropy = maxAniso;

  const roadMat = new THREE.MeshStandardMaterial({
    map: roadMap, roughness: 0.78, metalness: 0, emissive: 0xffc47c, emissiveMap: poolMap, emissiveIntensity: th.road,
  });
  const concreteMap = canvasTexture(
    256, 128,
    (g) => {
      const rnd = seeded(3);
      g.fillStyle = '#a7a9ab';
      g.fillRect(0, 0, 256, 128);
      for (let i = 0; i < 4000; i++) {
        const v = (130 + rnd() * 70) | 0;
        g.fillStyle = `rgba(${v},${v},${v},0.3)`;
        g.fillRect(rnd() * 256, rnd() * 128, 1 + rnd() * 2, 1 + rnd() * 3);
      }
      g.fillStyle = 'rgba(40,40,40,0.25)';
      g.fillRect(0, 118, 256, 10); // 雨だれの汚れ
    },
    { repeat: true }
  );
  const concreteMat = new THREE.MeshStandardMaterial({ map: concreteMap, roughness: 0.92, metalness: 0 });

  {
    // 上面
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const k = i % N, p = P[k], n = nrm[k], u = sAt[i] / LIGHT_GAP;
      pos.push(p.x - n.x * half, DECK, p.y - n.y * half, p.x + n.x * half, DECK, p.y + n.y * half);
      uv.push(u, 0, u, 1);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, roadMat);
    road.receiveShadow = true;
    scene.add(road);

    // 側面と裏面
    const sp = [], su = [], si = [];
    const strip = (fn, flip) => {
      const base = sp.length / 3;
      for (let i = 0; i <= N; i++) {
        const k = i % N;
        const [a, c] = fn(P[k], nrm[k]);
        sp.push(...a, ...c);
        su.push(sAt[i] / 400, 0, sAt[i] / 400, 1);
      }
      for (let i = 0; i < N; i++) {
        const A = base + i * 2, B = A + 1, C = A + 2, D = A + 3;
        if (flip) si.push(A, B, C, C, B, D);
        else si.push(A, C, B, C, D, B);
      }
    };
    const lo = DECK - DECK_THICK;
    strip((p, n) => [[p.x - n.x * half, DECK, p.y - n.y * half], [p.x - n.x * half, lo, p.y - n.y * half]], false);
    strip((p, n) => [[p.x + n.x * half, DECK, p.y + n.y * half], [p.x + n.x * half, lo, p.y + n.y * half]], true);
    strip((p, n) => [[p.x - n.x * half, lo, p.y - n.y * half], [p.x + n.x * half, lo, p.y + n.y * half]], true);
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sgeo.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
    sgeo.setIndex(si);
    sgeo.computeVertexNormals();
    scene.add(new THREE.Mesh(sgeo, concreteMat));
  }

  const dummy = new THREE.Object3D();
  const along = (s, lat) => {
    const p = T.pointAt(s);
    return { x: p.x + -p.ty * lat, z: p.y + p.tx * lat, ang: Math.atan2(p.ty, p.tx) };
  };

  // 橋脚
  {
    const piers = [];
    for (let s = 260; s < T.length; s += 560) piers.push(s);
    const colGeo = new THREE.CylinderGeometry(20, 24, 1, 14);
    colGeo.translate(0, 0.5, 0);
    const cols = new THREE.InstancedMesh(colGeo, concreteMat, piers.length * 2);
    const capGeo = new THREE.BoxGeometry(1, 1, 1);
    const caps = new THREE.InstancedMesh(capGeo, concreteMat, piers.length);
    const colH = DECK - DECK_THICK + 80;
    piers.forEach((s, i) => {
      for (const [j, lat] of [[0, -150], [1, 150]]) {
        const q = along(s, lat);
        dummy.position.set(q.x, -80, q.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, colH, 1);
        dummy.updateMatrix();
        cols.setMatrixAt(i * 2 + j, dummy.matrix);
      }
      const q = along(s, 0);
      dummy.position.set(q.x, DECK - DECK_THICK - 14, q.z);
      dummy.rotation.set(0, -q.ang, 0);
      dummy.scale.set(52, 28, 400);
      dummy.updateMatrix();
      caps.setMatrixAt(i, dummy.matrix);
    });
    scene.add(cols, caps);
  }

  // 街灯（柱・腕・灯具・発光面）
  const lampHeads = [];
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd9a6, emissiveIntensity: th.lamp });
  {
    const L = T.lights;
    const metal = new THREE.MeshStandardMaterial({ color: 0x5d636b, metalness: 0.7, roughness: 0.38 });
    const poleGeo = new THREE.CylinderGeometry(3.2, 4.6, LAMP_H, 8);
    poleGeo.translate(0, LAMP_H / 2, 0);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const poles = new THREE.InstancedMesh(poleGeo, metal, L.length);
    const arms = new THREE.InstancedMesh(box, metal, L.length);
    const heads = new THREE.InstancedMesh(box, metal, L.length);
    const lenses = new THREE.InstancedMesh(box, lensMat, L.length);
    L.forEach((l, i) => {
      const ang = Math.atan2(l.ly - l.y, l.lx - l.x);
      const len = Math.hypot(l.lx - l.x, l.ly - l.y);
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(l.x, DECK, l.y);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      dummy.position.set((l.x + l.lx) / 2, DECK + LAMP_H - 2, (l.y + l.ly) / 2);
      dummy.rotation.set(0, -ang, 0);
      dummy.scale.set(len + 6, 3.4, 3.4);
      dummy.updateMatrix();
      arms.setMatrixAt(i, dummy.matrix);
      dummy.position.set(l.lx, DECK + LAMP_H - 3, l.ly);
      dummy.scale.set(30, 6, 13);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
      dummy.position.set(l.lx, DECK + LAMP_H - 6.4, l.ly);
      dummy.scale.set(25, 1.2, 9);
      dummy.updateMatrix();
      lenses.setMatrixAt(i, dummy.matrix);
      lampHeads.push(new THREE.Vector3(l.lx, DECK + LAMP_H - 8, l.ly));
    });
    poles.castShadow = arms.castShadow = heads.castShadow = true;
    scene.add(poles, arms, heads, lenses);
  }

  // 道路の縁の反射板（夜に光る）
  const catMat = new THREE.MeshStandardMaterial({ color: 0x332200, emissive: 0xffb23f, emissiveIntensity: th.cat });
  {
    const list = [];
    for (let s = 0; s < T.length; s += 100) for (const lat of [-(T.width / 2 + 6), T.width / 2 + 6]) list.push(along(s, lat));
    const cats = new THREE.InstancedMesh(new THREE.BoxGeometry(9, 2.6, 4), catMat, list.length);
    list.forEach((q, i) => {
      dummy.position.set(q.x, DECK + 1.3, q.z);
      dummy.rotation.set(0, -q.ang, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      cats.setMatrixAt(i, dummy.matrix);
    });
    scene.add(cats);
  }

  // スタートゲートとチェッカー
  {
    const s0 = along(0, 0);
    const checker = canvasTexture(64, 512, (g) => {
      for (let y = 0; y < 512; y += 32) for (let x = 0; x < 64; x += 32) {
        g.fillStyle = ((x + y) / 32) % 2 ? '#f5f5f5' : '#151515';
        g.fillRect(x, y, 32, 32);
      }
    });
    const cg = new THREE.PlaneGeometry(48, T.width);
    cg.rotateX(-Math.PI / 2);
    const cm = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    cm.position.set(s0.x, DECK + 0.6, s0.z);
    cm.rotation.y = -s0.ang;
    cm.receiveShadow = true;
    scene.add(cm);

    const gate = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x2d3138, metalness: 0.8, roughness: 0.35 });
    for (const sd of [-1, 1]) {
      const tw = new THREE.Mesh(new THREE.BoxGeometry(26, 320, 26), steel);
      tw.position.set(0, 160, sd * (half + 18));
      tw.castShadow = true;
      gate.add(tw);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(22, 46, half * 2 + 70), steel);
    beam.position.set(0, 320, 0);
    beam.castShadow = true;
    gate.add(beam);
    const banner = canvasTexture(1024, 96, (g) => {
      g.fillStyle = '#0b0f17';
      g.fillRect(0, 0, 1024, 96);
      g.font = 'bold 60px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffb347';
      g.fillText('oVice Racing  ·  START / FINISH', 512, 50);
    });
    for (const sd of [-1, 1]) {
      const pl = new THREE.Mesh(
        new THREE.PlaneGeometry(half * 2 + 40, 38),
        new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: banner, emissiveIntensity: 1.6 })
      );
      pl.position.set(sd * 11.5, 320, 0);
      pl.rotation.y = (sd * Math.PI) / 2;
      gate.add(pl);
    }
    gate.position.set(s0.x, DECK, s0.z);
    gate.rotation.y = -s0.ang;
    scene.add(gate);
  }

  // ダッシュパネル（矢印が流れる）
  const chevron = canvasTexture(
    256, 128,
    (g) => {
      g.fillStyle = '#ff6a00';
      g.fillRect(0, 0, 256, 128);
      g.strokeStyle = '#ffe14d';
      g.lineWidth = 22;
      g.lineJoin = 'miter';
      for (const x0 of [30, 158]) {
        g.beginPath();
        g.moveTo(x0, 14);
        g.lineTo(x0 + 60, 64);
        g.lineTo(x0, 114);
        g.stroke();
      }
    },
    { repeat: true }
  );
  {
    const mat = new THREE.MeshBasicMaterial({ map: chevron, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const bp of T.boosts) {
      const q = along(bp.s, bp.lat);
      const g = new THREE.PlaneGeometry(bp.len, bp.w);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(q.x, DECK + 0.7, q.z);
      m.rotation.y = -q.ang;
      scene.add(m);
    }
  }

  // ---------- 海 ----------
  const waterNormals = makeWaterNormals(256);
  const waterGeo = new THREE.PlaneGeometry(420000, 420000);
  waterGeo.rotateX(-Math.PI / 2);
  const simpleNormals = waterNormals.clone();
  simpleNormals.repeat.set(600, 600);
  simpleNormals.needsUpdate = true;
  const simpleWater = new THREE.Mesh(
    waterGeo,
    new THREE.MeshStandardMaterial({ color: th.water, roughness: 0.1, metalness: 0.1, normalMap: simpleNormals, normalScale: new THREE.Vector2(0.45, 0.45) })
  );
  simpleWater.position.copy(center);
  scene.add(simpleWater);
  let reflectWater = null;
  const sunDir = new THREE.Vector3();
  function makeReflectWater(size) {
    const w = new Water(waterGeo, {
      textureWidth: size, textureHeight: size, waterNormals, sunDirection: sunDir, sunColor: th.waterSun,
      waterColor: th.water, distortionScale: 1.6, fog: true,
    });
    // 標準の水は反射に一定の灰色を足すため夜の海が白っぽくなる。海の色に置き換える
    w.material.fragmentShader = w.material.fragmentShader.replace('vec3( 0.1 ) + reflectionSample * 0.9', 'waterColor * 0.5 + reflectionSample * 0.9');
    w.material.uniforms.size.value = 0.22;
    w.position.copy(center);
    return w;
  }

  // ---------- 空 ----------
  const sky = new Sky();
  sky.scale.setScalar(240000);
  sky.renderOrder = -2;
  for (const k in SKY) sky.material.uniforms[k].value = SKY[k];
  scene.add(sky);

  const nightSkyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x01030a) }, mid: { value: new THREE.Color(0x0d2140) }, bottom: { value: new THREE.Color(0x020812) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vDir; void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h * 2.2, 0.0, 1.0), 0.6)) : mix(mid, bottom, pow(clamp(-h * 6.0, 0.0, 1.0), 0.5)); gl_FragColor = vec4(c, 1.0); }',
  });
  const nightSky = new THREE.Mesh(new THREE.SphereGeometry(200000, 32, 16), nightSkyMat);
  nightSky.renderOrder = -2;
  scene.add(nightSky);

  const stars = (() => {
    const rnd = seeded(21);
    const n = 1300, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * Math.PI * 2, v = 0.03 + rnd() * 0.97;
      const y = Math.pow(v, 0.8), r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(u) * r * 180000, y * 180000, Math.sin(u) * r * 180000], i * 3);
      const k = 0.4 + rnd() * 0.6;
      col.set([k, k, k * (0.9 + rnd() * 0.2)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.4, map: glowSprite(), transparent: true, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false, toneMapped: false }));
    pts.renderOrder = -1;
    return pts;
  })();
  scene.add(stars);
  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: canvasTexture(128, 128, (g) => {
        const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, 'rgba(255,255,245,1)');
        grad.addColorStop(0.28, 'rgba(250,250,235,1)');
        grad.addColorStop(0.34, 'rgba(200,215,255,0.35)');
        grad.addColorStop(1, 'rgba(120,150,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
      }),
      fog: false, depthWrite: false, toneMapped: false,
    })
  );
  moon.scale.setScalar(26000);
  moon.renderOrder = -1;
  scene.add(moon);

  // ---------- 遠くの街と山 ----------
  const windows = canvasTexture(128, 1024, (g) => {
    const rnd = seeded(8);
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 1024);
    for (let y = 3; y < 1020; y += 6) for (let x = 3; x < 125; x += 7) {
      if (rnd() < 0.3) {
        const w = rnd();
        g.fillStyle = w < 0.6 ? '#ffcf86' : w < 0.85 ? '#fff1d2' : '#9fd0ff';
        g.fillRect(x, y, 4, 3);
      }
    }
  });
  const cityMat = new THREE.MeshStandardMaterial({ color: th.city, roughness: 0.8, emissive: 0xffffff, emissiveMap: windows, emissiveIntensity: th.windows });
  {
    const rnd = seeded(31);
    const list = [];
    const clusters = [0.3, 1.25, 2.1, 3.0, 3.9, 5.1];
    for (const ang of clusters) {
      const R = 30000 + rnd() * 9000;
      const cx = center.x + Math.cos(ang) * R, cz = center.z + Math.sin(ang) * R;
      const count = 40 + ((rnd() * 40) | 0);
      for (let i = 0; i < count; i++) {
        const rr = Math.pow(rnd(), 0.7) * 4200, aa = rnd() * Math.PI * 2;
        const hBoost = 1 - rr / 4200;
        list.push({ x: cx + Math.cos(aa) * rr, z: cz + Math.sin(aa) * rr, w: 300 + rnd() * 700, d: 300 + rnd() * 700, h: 400 + rnd() * 1300 + hBoost * hBoost * 3200 });
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const city = new THREE.InstancedMesh(geo, cityMat, list.length);
    list.forEach((q, i) => {
      dummy.position.set(q.x, -10, q.z);
      dummy.rotation.set(0, rnd() * Math.PI, 0);
      dummy.scale.set(q.w, q.h, q.d);
      dummy.updateMatrix();
      city.setMatrixAt(i, dummy.matrix);
    });
    scene.add(city);
  }
  const mountainMat = new THREE.MeshStandardMaterial({ color: th.mountain, roughness: 1, flatShading: true });
  {
    const rnd = seeded(44);
    const geo = new THREE.ConeGeometry(1, 1, 14, 6);
    geo.translate(0, 0.5, 0);
    // 頂点を少しずつずらして岩山らしくする
    const pa = geo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i);
      if (y <= 0.001 || y >= 0.999) continue;
      const k = 0.78 + rnd() * 0.44;
      pa.setXYZ(i, pa.getX(i) * k, y + (rnd() - 0.5) * 0.06, pa.getZ(i) * k);
    }
    geo.computeVertexNormals();
    const n = 22;
    const mts = new THREE.InstancedMesh(geo, mountainMat, n);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + rnd() * 0.2, R = 62000 + rnd() * 14000;
      dummy.position.set(center.x + Math.cos(ang) * R, -50, center.z + Math.sin(ang) * R);
      const r = 6000 + rnd() * 9000;
      dummy.rotation.set(0, rnd() * 3, 0);
      dummy.scale.set(r, 2200 + rnd() * 5200, r * (0.7 + rnd() * 0.6));
      dummy.updateMatrix();
      mts.setMatrixAt(i, dummy.matrix);
    }
    scene.add(mts);
  }

  // ---------- 光 ----------
  const hemi = new THREE.HemisphereLight(th.hemiSky, th.hemiGround, th.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(th.sun, th.sunI);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -1500;
  sun.shadow.camera.right = sun.shadow.camera.top = 1500;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 12000;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  // 自車の近くの街灯だけ本物のスポットライトにする（路面と車を照らす）
  const spots = [];
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.SpotLight(0xffd29a, 0, 620, 0.95, 0.75, 0);
    scene.add(sp, sp.target);
    spots.push(sp);
  }

  // 環境マップ（車の塗装や海に映り込む景色）
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envs = {};
  {
    const s1 = new THREE.Scene();
    const sk = new Sky();
    sk.scale.setScalar(10000);
    s1.add(sk);
    const el = THREE.MathUtils.degToRad(THEMES.morning.sunElev), az = THREE.MathUtils.degToRad(THEMES.morning.sunAzim);
    sk.material.uniforms.sunPosition.value.setFromSphericalCoords(1, Math.PI / 2 - el, az);
    for (const k in SKY) sk.material.uniforms[k].value = SKY[k];
    envs.morning = pmrem.fromScene(s1, 0, 1, 20000).texture;
    const s2 = new THREE.Scene();
    s2.add(new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), nightSkyMat));
    const warm = new THREE.MeshBasicMaterial({ color: 0xffc070 });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(120, 8, 8), warm);
      const a = (i / 14) * Math.PI * 2;
      m.position.set(Math.cos(a) * 3000, 600 + (i % 3) * 300, Math.sin(a) * 3000);
      s2.add(m);
    }
    envs.night = pmrem.fromScene(s2, 0, 1, 20000).texture;
  }

  // ---------- 車 ----------
  const carGeo = (() => {
    const body = new THREE.Shape();
    body.moveTo(-22, 3);
    body.lineTo(21, 3);
    body.quadraticCurveTo(23.6, 3, 23.6, 6);
    body.lineTo(23.2, 8);
    body.quadraticCurveTo(20, 10.2, 12, 10.6);
    body.lineTo(-16, 11.2);
    body.quadraticCurveTo(-22, 11.2, -22.6, 8);
    body.lineTo(-22, 3);
    const bodyG = new THREE.ExtrudeGeometry(body, { depth: 19, bevelEnabled: true, bevelThickness: 1.8, bevelSize: 1.5, bevelSegments: 3, curveSegments: 10 });
    bodyG.translate(0, 0, -9.5);
    const cab = new THREE.Shape();
    cab.moveTo(-14, 10.4);
    cab.lineTo(9, 10.4);
    cab.quadraticCurveTo(4, 17, -2, 17.6);
    cab.lineTo(-9, 17.3);
    cab.quadraticCurveTo(-13, 16.6, -14, 10.4);
    const cabG = new THREE.ExtrudeGeometry(cab, { depth: 14, bevelEnabled: true, bevelThickness: 1, bevelSize: 1, bevelSegments: 2, curveSegments: 8 });
    cabG.translate(0, 0, -7);
    const wheel = new THREE.CylinderGeometry(5.4, 5.4, 4.4, 22);
    wheel.rotateX(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(3.3, 3.3, 4.6, 10);
    rim.rotateX(Math.PI / 2);
    const flame = new THREE.ConeGeometry(3.2, 18, 12);
    flame.rotateZ(Math.PI / 2);
    flame.translate(-9, 0, 0);
    return { bodyG, cabG, wheel, rim, light: new THREE.BoxGeometry(1.4, 2.2, 5.2), spoiler: new THREE.BoxGeometry(5, 1.2, 21), strut: new THREE.BoxGeometry(2, 4, 1.2), flame };
  })();
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0f16, metalness: 0.9, roughness: 0.06, clearcoat: 1 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd2, metalness: 0.9, roughness: 0.25 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: th.headlight });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a2a, emissiveIntensity: th.tail });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

  const cars = new Map();
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'labels3d';
  if (opts.labelsBefore) opts.labelsBefore.parentNode.insertBefore(labelRenderer.domElement, opts.labelsBefore);
  else document.body.appendChild(labelRenderer.domElement);

  function makeCar(pid, isMe) {
    const outer = new THREE.Group();
    const body = new THREE.Group();
    outer.add(body);
    const paint = new THREE.MeshPhysicalMaterial({ color: 0xff0000, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
    const shell = new THREE.Mesh(carGeo.bodyG, paint);
    const cab = new THREE.Mesh(carGeo.cabG, glassMat);
    shell.castShadow = cab.castShadow = true;
    shell.receiveShadow = true;
    body.add(shell, cab);
    const spoiler = new THREE.Mesh(carGeo.spoiler, paint);
    spoiler.position.set(-20, 15.2, 0);
    body.add(spoiler);
    for (const z of [-6, 6]) {
      const st = new THREE.Mesh(carGeo.strut, tireMat);
      st.position.set(-20, 12.6, z);
      body.add(st);
    }
    const wheels = [];
    for (const x of [-14, 14]) for (const z of [-10.6, 10.6]) {
      const w = new THREE.Group();
      const tire = new THREE.Mesh(carGeo.wheel, tireMat);
      tire.castShadow = true;
      w.add(tire, new THREE.Mesh(carGeo.rim, rimMat));
      w.position.set(x, 5.4, z);
      outer.add(w);
      wheels.push(w);
    }
    for (const z of [-6.5, 6.5]) {
      const h = new THREE.Mesh(carGeo.light, headMat);
      h.position.set(23.6, 7.4, z);
      const t = new THREE.Mesh(carGeo.light, tailMat);
      t.position.set(-23, 8.6, z);
      body.add(h, t);
    }
    const flame = new THREE.Mesh(carGeo.flame, flameMat);
    flame.position.set(-23, 6, 0);
    flame.visible = false;
    body.add(flame);
    let headlight = null;
    if (isMe) {
      headlight = new THREE.SpotLight(0xf3f6ff, 0, 1500, 0.42, 0.55, 0);
      headlight.position.set(24, 9, 0);
      headlight.target.position.set(500, -10, 0);
      outer.add(headlight, headlight.target);
    }
    const el = document.createElement('div');
    el.className = 'car-label' + (isMe ? ' me' : '');
    const img = document.createElement('img');
    img.referrerPolicy = 'no-referrer';
    img.alt = '';
    const span = document.createElement('span');
    el.append(img, span);
    const label = new CSS2DObject(el);
    label.position.set(0, 36, 0);
    outer.add(label);
    scene.add(outer);
    return {
      pid, outer, body, paint, wheels, flame, headlight, el, img, span, label,
      color: '', name: null, av: null, alpha: 1, lastA: null, splashed: false, roll: 0,
    };
  }

  function setCarAlpha(c, a) {
    if (c.alpha === a) return;
    c.alpha = a;
    for (const m of [c.paint]) {
      m.transparent = a < 1;
      m.opacity = a;
      m.depthWrite = a >= 1;
      m.needsUpdate = true;
    }
    c.el.style.opacity = a < 1 ? '0.5' : '1';
  }

  const sparkTex = glowSprite();
  const splash = new Particles(500, 26, sparkTex);
  const exhaust = new Particles(400, 14, sparkTex);
  scene.add(splash.points, exhaust.points);
  const rings = [];
  for (let i = 0; i < 4; i++) {
    const r = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    );
    r.userData.t = 1;
    scene.add(r);
    rings.push(r);
  }
  function doSplash(x, z) {
    for (let i = 0; i < 160; i++) {
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 220;
      const k = 0.7 + Math.random() * 0.3;
      splash.emit(x + Math.cos(a) * 10, 4, z + Math.sin(a) * 10, Math.cos(a) * sp, 140 + Math.random() * 360, Math.sin(a) * sp, k * 0.8, k * 0.92, k, 0.9 + Math.random() * 0.8, 520);
    }
    const r = rings.find(q => q.userData.t >= 1) || rings[0];
    r.position.set(x, 2, z);
    r.userData.t = 0;
  }

  // ---------- 後処理（光のにじみ） ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), th.bloom, 0.4, th.bloomThreshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- 見た目の切り替え ----------
  function applyTheme(name) {
    themeName = THEMES[name] ? name : 'night';
    th = THEMES[themeName];
    const night = themeName === 'night';
    scene.fog.color.set(th.fog);
    scene.fog.near = th.fogNear;
    scene.fog.far = th.fogFar;
    renderer.toneMappingExposure = th.exposure;
    hemi.color.set(th.hemiSky);
    hemi.groundColor.set(th.hemiGround);
    hemi.intensity = th.hemi;
    sun.color.set(th.sun);
    sun.intensity = th.sunI;
    const el = THREE.MathUtils.degToRad(th.sunElev), az = THREE.MathUtils.degToRad(th.sunAzim);
    sunDir.setFromSphericalCoords(1, Math.PI / 2 - el, az);
    sky.material.uniforms.sunPosition.value.copy(sunDir);
    sky.visible = !night;
    nightSky.visible = stars.visible = moon.visible = night;
    scene.environment = envs[themeName];
    scene.environmentIntensity = th.env;
    simpleWater.material.color.set(th.water);
    if (reflectWater) {
      reflectWater.material.uniforms.waterColor.value.set(th.water);
      reflectWater.material.uniforms.sunColor.value.set(th.waterSun);
    }
    roadMat.emissiveIntensity = th.road;
    roadMat.roughness = night ? 0.55 : 0.8; // 夜は少し濡れた感じ
    lensMat.emissiveIntensity = th.lamp;
    catMat.emissiveIntensity = th.cat;
    cityMat.color.set(th.city);
    cityMat.emissiveIntensity = th.windows;
    mountainMat.color.set(th.mountain);
    headMat.emissiveIntensity = th.headlight;
    tailMat.emissiveIntensity = th.tail;
    bloom.strength = th.bloom;
    bloom.threshold = th.bloomThreshold;
  }

  function applyQuality(name) {
    qualityName = QUALITIES[name] ? name : 'high';
    Q = QUALITIES[qualityName];
    const shadows = Q.shadow > 0;
    renderer.shadowMap.enabled = shadows;
    sun.castShadow = shadows;
    if (shadows) {
      sun.shadow.mapSize.set(Q.shadow, Q.shadow);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    }
    if (Q.reflect && !reflectWater) {
      reflectWater = makeReflectWater(Q.reflect);
      scene.add(reflectWater);
      applyTheme(themeName);
    }
    if (reflectWater) reflectWater.visible = !!Q.reflect;
    simpleWater.visible = !Q.reflect;
    spots.forEach((s, i) => (s.visible = i < Q.spots));
    scene.traverse(o => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => (m.needsUpdate = true));
    });
    sizeKey = '';
  }

  // ---------- 毎フレームの描画 ----------
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  let camHeading = 0, camReady = false, fov = 62, sizeKey = '';
  let fpsFrames = 0, fpsTime = 0, fps = 60;
  const tmp = new THREE.Vector3();

  function resizeIfNeeded(cover) {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, Q.pixelRatio);
    const key = `${w}x${h}@${pr}`;
    if (key !== sizeKey) {
      sizeKey = key;
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      labelRenderer.setSize(w, h);
      camera.aspect = w / h;
    }
    if (cover > 0) camera.setViewOffset(w, h + cover, 0, cover, w, h);
    else camera.clearViewOffset();
  }

  function updateCar(c, d, dt, t) {
    if (c.color !== d.color) {
      c.color = d.color;
      c.paint.color.set(d.color);
    }
    if (c.name !== d.name) {
      c.name = d.name;
      c.span.textContent = d.name || '';
    }
    if (c.av !== (d.avatarUrl || '')) {
      c.av = d.avatarUrl || '';
      c.img.style.display = c.av ? '' : 'none';
      if (c.av) c.img.src = c.av;
    }
    setCarAlpha(c, d.alpha == null ? 1 : d.alpha);
    const fall = d.fall || 0;
    c.outer.position.set(d.x, DECK - (DECK + 60) * fall * fall, d.y);
    c.outer.rotation.set(fall * 1.6, -d.a, fall * 2.4, 'YXZ');
    // 曲がるときに少し傾く
    let turn = 0;
    if (c.lastA != null && dt > 0) {
      let da = d.a - c.lastA;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      turn = da / dt;
    }
    c.lastA = d.a;
    const speed = Math.hypot(d.vx || 0, d.vy || 0);
    c.roll += (Math.max(-0.12, Math.min(0.12, turn * speed * 0.00012)) - c.roll) * Math.min(1, dt * 8);
    c.body.rotation.x = c.roll;
    for (const w of c.wheels) w.rotation.z -= (speed * dt) / 5.4;
    // 落下：海に着いたら水しぶき
    if (fall >= 0.97 && !c.splashed) {
      c.splashed = true;
      doSplash(d.x, d.y);
    }
    if (fall < 0.5) c.splashed = false;
    const blinkOff = d.blink && Math.floor(t / 90) % 2 === 1;
    c.outer.visible = fall < 0.97 && !blinkOff;
    c.label.visible = c.outer.visible && fall < 0.3;
    // ダッシュ中の炎と火の粉
    c.flame.visible = !!d.boost && c.outer.visible;
    if (c.flame.visible) {
      c.flame.scale.set(0.8 + Math.random() * 0.6, 0.9 + Math.random() * 0.3, 0.9 + Math.random() * 0.3);
      const fx = Math.cos(d.a), fz = Math.sin(d.a);
      for (let i = 0; i < 2; i++) {
        exhaust.emit(
          d.x - fx * 26 + (Math.random() - 0.5) * 6, DECK + 6 + Math.random() * 3, d.y - fz * 26 + (Math.random() - 0.5) * 6,
          (d.vx || 0) * 0.55 - fx * 160 + (Math.random() - 0.5) * 60, 20 + Math.random() * 40, (d.vy || 0) * 0.55 - fz * 160 + (Math.random() - 0.5) * 60,
          1, 0.55, 0.15, 0.25 + Math.random() * 0.2, -40
        );
      }
    }
    if (c.headlight) c.headlight.intensity = th.myHead;
  }

  function render(st) {
    const dt = Math.min(0.1, st.dt || 0.016);
    const t = st.t;
    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 1) {
      fps = Math.round(fpsFrames / fpsTime);
      fpsFrames = 0;
      fpsTime = 0;
    }
    resizeIfNeeded(st.cover || 0);

    // 車
    const seen = new Set();
    const list = st.me ? [Object.assign({ isMe: true }, st.me), ...st.others] : st.others;
    for (const d of list) {
      seen.add(d.pid);
      let c = cars.get(d.pid);
      if (!c) {
        c = makeCar(d.pid, !!d.isMe);
        cars.set(d.pid, c);
      }
      updateCar(c, d, dt, t);
    }
    for (const [pid, c] of cars) {
      if (!seen.has(pid)) {
        scene.remove(c.outer);
        c.el.remove();
        cars.delete(pid);
      }
    }

    // カメラ
    const tg = st.target;
    if (tg) {
      const speed = Math.hypot(tg.vx || 0, tg.vy || 0);
      const ratio = Math.min(1.6, speed / Math.max(1, st.maxSpeed));
      let dh = tg.a - camHeading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      camHeading += camReady ? dh * (1 - Math.exp(-dt * 5)) : dh;
      const fx = Math.cos(camHeading), fz = Math.sin(camHeading);
      let wantFov;
      if (st.camMode === 'chase') {
        const dist = 112 + ratio * 62, h = 38 + ratio * 12;
        tmp.set(tg.x - fx * dist, DECK + h, tg.y - fz * dist);
        camLook.set(tg.x + fx * 220, DECK + 14, tg.y + fz * 220);
        wantFov = 60 + 18 * Math.min(1.3, ratio) + (st.boost ? 7 : 0);
      } else {
        tmp.set(tg.x, DECK + 2300, tg.y + 950);
        camLook.set(tg.x, DECK, tg.y);
        wantFov = 50;
      }
      if (!camReady) {
        camPos.copy(tmp);
        camReady = true;
      } else camPos.lerp(tmp, 1 - Math.exp(-dt * 9));
      fov += (wantFov - fov) * (1 - Math.exp(-dt * 3));
      camera.position.copy(camPos);
      if (st.boost) camera.position.add(tmp.set((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6));
      camera.lookAt(camLook);
      camera.fov = fov;
      camera.updateProjectionMatrix();

      // 影を落とす光は自車の周りだけを担当
      sun.position.set(tg.x + sunDir.x * 6000, DECK + sunDir.y * 6000, tg.y + sunDir.z * 6000);
      sun.target.position.set(tg.x, DECK, tg.y);
      sun.target.updateMatrixWorld();

      // 近くの街灯をスポットライトに割り当て（前方を優先）
      if (Q.spots > 0) {
        const cand = [];
        for (const p of lampHeads) {
          const dx = p.x - tg.x, dz = p.z - tg.y;
          const d2 = dx * dx + dz * dz;
          if (d2 > 1600 * 1600) continue;
          const ahead = dx * fx + dz * fz;
          cand.push({ p, score: d2 - Math.max(0, ahead) * 900 });
        }
        cand.sort((a, b2) => a.score - b2.score);
        spots.forEach((s, i) => {
          if (i >= Q.spots) return;
          const c = cand[i];
          s.intensity = c ? th.spot : 0;
          if (c) {
            s.position.copy(c.p);
            s.target.position.set(c.p.x, DECK, c.p.z);
            s.target.updateMatrixWorld();
          }
        });
      }
    }

    // 背景は常にカメラの周りに置く
    nightSky.position.copy(camera.position);
    stars.position.copy(camera.position);
    moon.position.copy(camera.position).addScaledVector(sunDir, 150000);
    sky.position.copy(camera.position);

    // 動くもの
    chevron.offset.x -= dt * 1.6;
    simpleNormals.offset.x += dt * 0.0025;
    simpleNormals.offset.y += dt * 0.0016;
    if (reflectWater) reflectWater.material.uniforms.time.value += dt * 0.55;
    splash.update(dt);
    exhaust.update(dt);
    for (const r of rings) {
      if (r.userData.t >= 1) {
        r.material.opacity = 0;
        continue;
      }
      r.userData.t = Math.min(1, r.userData.t + dt / 1.4);
      const k = r.userData.t;
      r.scale.setScalar(20 + k * 160);
      r.material.opacity = 0.7 * (1 - k);
    }

    if (Q.bloom) composer.render();
    else renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  applyTheme(themeName);
  applyQuality(qualityName);

  return {
    render,
    setTheme: applyTheme,
    setQuality: applyQuality,
    get fps() { return fps; },
    debug: { scene, camera, renderer, composer, bloom }, // 調査用
    get quality() { return qualityName; },
  };
}
