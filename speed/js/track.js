// コース定義と幾何計算（海の上の高架道路）
const Track = (() => {
  // 時計回りのサーキット（制御点を Catmull-Rom で補間）
  // 一番きついカーブでも半径（約 290）が道幅の半分（240）を超え、隣り合う区間が重ならないように調整済み
  const CONTROL = [
    [784, 3136], [784, 1372], [1372, 686], [2324, 756], [2772, 1540],
    [3584, 1736], [4340, 980], [5292, 1120], [5628, 1988], [5180, 2772],
    [5488, 3472], [5320, 4088], [4480, 4284], [3080, 3780], [2184, 4340], [1176, 4116],
  ];
  const WIDTH = 480; // 道路の幅
  const MARGIN = 20; // 道路の縁（ここを越えると海へ落下）
  const SEG = 24;

  const pts = [];
  const n = CONTROL.length;
  for (let i = 0; i < n; i++) {
    const p0 = CONTROL[(i - 1 + n) % n], p1 = CONTROL[i];
    const p2 = CONTROL[(i + 1) % n], p3 = CONTROL[(i + 2) % n];
    for (let j = 0; j < SEG; j++) {
      const t = j / SEG, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push({ x: f(p0[0], p1[0], p2[0], p3[0]), y: f(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  const N = pts.length;
  const cum = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const length = cum[N];

  const wrap = s => ((s % length) + length) % length;

  // 中心線上の最寄り点。s: スタートからの距離, lat: 進行方向右(+)/左(-)へのずれ, dist: 中心線からの距離
  function nearest(x, y) {
    let best = null, bestD2 = Infinity;
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N];
      const abx = b.x - a.x, aby = b.y - a.y;
      const l2 = abx * abx + aby * aby;
      let t = ((x - a.x) * abx + (y - a.y) * aby) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a.x + abx * t, py = a.y + aby * t;
      const d2 = (x - px) * (x - px) + (y - py) * (y - py);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { i, t, px, py, abx, aby };
      }
    }
    const segLen = cum[best.i + 1] - cum[best.i];
    const tx = best.abx / segLen, ty = best.aby / segLen;
    return {
      s: cum[best.i] + best.t * segLen,
      px: best.px, py: best.py, tx, ty,
      lat: (x - best.px) * -ty + (y - best.py) * tx,
      dist: Math.sqrt(bestD2),
    };
  }

  // 距離 s の位置と接線
  function pointAt(s) {
    s = wrap(s);
    let lo = 0, hi = N - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid - 1;
    }
    const a = pts[lo], b = pts[(lo + 1) % N];
    const segLen = cum[lo + 1] - cum[lo];
    const t = (s - cum[lo]) / segLen;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, tx: (b.x - a.x) / segLen, ty: (b.y - a.y) / segLen };
  }

  // 中心線から横に off だけずらした線（車線や縁の線を描く用）
  function offsetLine(off) {
    return pts.map((p, i) => {
      const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
      return { x: p.x + (-dy / l) * off, y: p.y + (dx / l) * off };
    });
  }

  // 外枠
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const pad = WIDTH / 2 + MARGIN + 300;
  const bounds = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };

  // ダッシュパネル（s はコース長に対する割合）
  const boosts = [
    { s: 0.035, lat: 0 },
    { s: 0.36, lat: -120 },
    { s: 0.66, lat: 120 },
  ].map(b => ({ s: b.s * length, lat: b.lat, len: 150, w: 140 }));

  // 街灯：道路の両脇に等間隔（左右で半分ずらす）
  const LIGHT_GAP = 300;
  const lights = [];
  for (let s = 0; s < length; s += LIGHT_GAP) {
    for (const side of [-1, 1]) {
      const p = pointAt(s + (side > 0 ? LIGHT_GAP / 2 : 0));
      const nx = -p.ty * side, ny = p.tx * side; // 道路の外向き
      lights.push({
        x: p.x + nx * (WIDTH / 2 + MARGIN - 6), // 柱（道路の縁）
        y: p.y + ny * (WIDTH / 2 + MARGIN - 6),
        lx: p.x + nx * (WIDTH / 2 - 50), // 灯具（道路の上に張り出す）
        ly: p.y + ny * (WIDTH / 2 - 50),
      });
    }
  }

  return { pts, length, width: WIDTH, margin: MARGIN, nearest, pointAt, wrap, bounds, boosts, lights, offsetLine };
})();
