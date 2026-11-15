'use strict';
/* The living backdrop.
   The page sits on a grid of small tiles, each holding one character. Nothing is drawn as a
   smooth shape: cranes, koi, clouds and the moon are all painted by lighting up tiles, so
   they read as a mosaic that is always moving. Three scenes share one engine:
     steppe  a night sky over the Mongolian steppe, with cranes passing
     pond    a koi pond seen from above
     embers  fireflies in the dark
   Exposes window.Backdrop = { setTheme(name), setMotion(on) }. */
(function () {
  const canvas = document.getElementById('field');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const GLYPHS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ+=#%*<>/';
  const TAU = Math.PI * 2;

  // S is the tile size in CSS pixels, cell the same tile in device pixels, q the ratio between them.
  let S = 10, W = 0, H = 0, cols = 0, rows = 0, q = 1, cell = 10;
  let bufR, bufG, bufB, bufA, bufL, touched, count = 0, lane;
  let img, small, sctx, maskPattern, atlas;
  const P = 64;   // the pattern of characters repeats every 64 tiles
  let scene = null, themeName = 'pond', motion = true, raf = 0, last = 0, clock = 0;
  const pointer = { x: -9999, y: -9999 };
  const glows = [];

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[(Math.random() * list.length) | 0];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return (h ^ (h >>> 16)) >>> 0; };
  const glyphAt = (cx, cy) => hash(cx % P, cy % P) % GLYPHS.length;
  const angleDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

  /* ---------- tile buffer ---------- */
  function paint(cx, cy, c, a) {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows || a <= 0.004) return;
    const i = cy * cols + cx, old = bufA[i];
    if (old === 0) { touched[count++] = i; bufR[i] = c[0]; bufG[i] = c[1]; bufB[i] = c[2]; bufA[i] = Math.min(a, 1); return; }
    const out = a + old * (1 - a);
    bufR[i] = (c[0] * a + bufR[i] * old * (1 - a)) / out;
    bufG[i] = (c[1] * a + bufG[i] * old * (1 - a)) / out;
    bufB[i] = (c[2] * a + bufB[i] * old * (1 - a)) / out;
    bufA[i] = Math.min(out, 1);
  }
  // Same, for faint tiles whose character should glow (stars, glints on the water, the pointer's light).
  function paintLit(cx, cy, c, a) {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows || a <= 0.004) return;
    bufL[cy * cols + cx] = 1;
    paint(cx, cy, c, a);
  }
  // Shapes are given in pixels. A tile at the edge of a shape is lit in proportion to how far
  // inside the shape it sits, so things glide from tile to tile instead of jumping a whole tile.
  const edge = (inside) => inside >= S * .5 ? 1 : inside <= -S * .5 ? 0 : inside / S + .5;
  function disc(x, y, r, c, a) {
    const R = r + S * .5;
    const x0 = Math.floor((x - R) / S), x1 = Math.floor((x + R) / S), y0 = Math.floor((y - R) / S), y1 = Math.floor((y + R) / S);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const dx = (cx + .5) * S - x, dy = (cy + .5) * S - y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < R) paint(cx, cy, c, a * edge(r - d));
    }
  }
  function ellipse(x, y, rx, ry, c, a) {
    const x0 = Math.floor((x - rx) / S) - 1, x1 = Math.floor((x + rx) / S) + 1, y0 = Math.floor((y - ry) / S) - 1, y1 = Math.floor((y + ry) / S) + 1;
    const least = Math.min(rx, ry);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const dx = ((cx + .5) * S - x) / rx, dy = ((cy + .5) * S - y) / ry, d = dx * dx + dy * dy;
      const w = edge((1 - Math.sqrt(d)) * least);
      if (w > 0) paint(cx, cy, c, a * w * (1 - .55 * Math.min(d, 1)));
    }
  }
  function capsule(xa, ya, xb, yb, r, c, a) {
    const R = r + S * .5;
    const x0 = Math.floor((Math.min(xa, xb) - R) / S), x1 = Math.floor((Math.max(xa, xb) + R) / S);
    const y0 = Math.floor((Math.min(ya, yb) - R) / S), y1 = Math.floor((Math.max(ya, yb) + R) / S);
    const vx = xb - xa, vy = yb - ya, len = vx * vx + vy * vy || 1;
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const px = (cx + .5) * S, py = (cy + .5) * S;
      const t = clamp(((px - xa) * vx + (py - ya) * vy) / len, 0, 1);
      const dx = px - (xa + vx * t), dy = py - (ya + vy * t), d = Math.sqrt(dx * dx + dy * dy);
      if (d < R) paint(cx, cy, c, a * edge(r - d));
    }
  }
  function ring(x, y, r, c, a) {
    const x0 = Math.floor((x - r - S) / S), x1 = Math.floor((x + r + S) / S), y0 = Math.floor((y - r - S) / S), y1 = Math.floor((y + r + S) / S);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const dx = (cx + .5) * S - x, dy = (cy + .5) * S - y;
      const w = 1 - Math.abs(Math.sqrt(dx * dx + dy * dy) - r) / (S * .95);
      if (w > 0) paint(cx, cy, c, a * w);
    }
  }
  const glow = (x, y, r, c, a) => glows.push([x, y, r, c, a]);

  /* Drawing a frame. Every tile is one pixel in a tiny image the size of the grid. That image is
     scaled up in a single call, the gaps between tiles and the character in each tile are cut
     out of it with one prepared stencil, and the soft glows are slipped in behind. The cost of a
     frame therefore barely depends on how many tiles are lit. */
  function flush() {
    const px = img.data, cw = canvas.width, ch = canvas.height;
    px.fill(0);
    for (let n = 0; n < count; n++) {
      const i = touched[n], a = bufA[i] * lane[i % cols], o = i * 4;
      bufA[i] = a;
      px[o] = bufR[i]; px[o + 1] = bufG[i]; px[o + 2] = bufB[i]; px[o + 3] = a * 255;
    }
    sctx.putImageData(img, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(small, 0, 0, cols * cell, rows * cell);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = maskPattern;
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = 'source-over';
    for (let n = 0; n < count; n++) {
      const i = touched[n];
      if (bufL[i]) {
        const a = bufA[i];
        if (a >= .05 && a < .4) {
          const cx = i % cols, cy = (i / cols) | 0;
          ctx.globalAlpha = Math.min(.9, a * 2.4);
          ctx.drawImage(atlas, glyphAt(cx, cy) * cell, 0, cell, cell, cx * cell, cy * cell, cell, cell);
        }
        bufL[i] = 0;
      }
      bufA[i] = 0;
    }
    ctx.globalAlpha = 1;
    count = 0;
    ctx.globalCompositeOperation = 'destination-over';
    for (let n = 0; n < glows.length; n++) {
      const g = glows[n], x = g[0] * q, y = g[1] * q, r = g[2] * q, c = g[3];
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${g[4]})`);
      grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = grad; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    glows.length = 0;
    ctx.globalCompositeOperation = 'source-over';
  }

  const glyphFont = () => `600 ${Math.round(cell * .68)}px "JetBrains Mono", ui-monospace, Consolas, monospace`;
  // The stencil: solid lines where the gaps between tiles go, and one half-strength character per tile.
  function buildMask() {
    const size = P * cell, m = document.createElement('canvas'), c = m.getContext('2d');
    m.width = m.height = size;
    const gap = Math.max(1, Math.round(cell * .1));
    c.fillStyle = '#000';
    for (let n = 0; n < P; n++) {
      c.fillRect(n * cell, 0, gap, size); c.fillRect((n + 1) * cell - gap, 0, gap, size);
      c.fillRect(0, n * cell, size, gap); c.fillRect(0, (n + 1) * cell - gap, size, gap);
    }
    // Characters this small are mostly soft edges, so each one is struck twice to cut deep enough to read.
    c.globalAlpha = .8; c.font = glyphFont(); c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let pass = 0; pass < 2; pass++)
      for (let cy = 0; cy < P; cy++) for (let cx = 0; cx < P; cx++) c.fillText(GLYPHS[glyphAt(cx, cy)], cx * cell + cell / 2, cy * cell + cell / 2 + .5 * q);
    maskPattern = ctx.createPattern(m, 'repeat');
  }
  // One row of ready-drawn glowing characters in the scene's light colour.
  function buildAtlas() {
    atlas = document.createElement('canvas');
    atlas.width = GLYPHS.length * cell; atlas.height = cell;
    const c = atlas.getContext('2d'), l = scene.lit;
    c.fillStyle = `rgb(${l[0]},${l[1]},${l[2]})`; c.font = glyphFont(); c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let n = 0; n < GLYPHS.length; n++) c.fillText(GLYPHS[n], n * cell + cell / 2, cell / 2 + .5 * q);
  }

  // A soft patch of lit tiles under the pointer, in every scene.
  function lantern(c) {
    if (pointer.x < -999) return;
    const r = S * 7;
    const x0 = Math.floor((pointer.x - r) / S), x1 = Math.floor((pointer.x + r) / S), y0 = Math.floor((pointer.y - r) / S), y1 = Math.floor((pointer.y + r) / S);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const dx = (cx + .5) * S - pointer.x, dy = (cy + .5) * S - pointer.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < r) paintLit(cx, cy, c, (1 - d / r) * (1 - d / r) * (.1 + .16 * ((hash(cx, cy) % 100) / 100)));
    }
    glow(pointer.x, pointer.y, r * 1.6, c, .07);
  }

  function sparkles(n) {
    const list = [];
    for (let i = 0; i < n; i++) list.push({ cx: (Math.random() * cols) | 0, cy: (Math.random() * rows) | 0, ph: rand(0, TAU), sp: rand(.4, 1.3), big: Math.random() < .12 });
    return list;
  }

  const STAR = [214, 224, 255], MOON = [246, 214, 142], MOON_DIM = [226, 186, 110], CLOUD = [126, 142, 208], HILL = [58, 74, 138];
  const GLINT = [140, 232, 220], RIPPLE = [170, 240, 228], PAD_RIM = [40, 118, 86], PAD = [82, 168, 108], PAD_PALE = [122, 198, 124];
  const FLY_WARM = [255, 198, 120], FLY_HOT = [240, 132, 96];

  /* ---------- scene: steppe night ---------- */
  // B body, W wing, T wing tip, N neck, H head, L legs. Drawn flying right, mirrored for left.
  const CRANE = [
    ['....TT.........', '.....WW........', '.....WWW.......', '......WWW......', '.....BBBBBNNNH.', 'LLLLLBBBB......', '...............', '...............', '...............'],
    ['...............', '...............', '..TTW..........', '....WWWWW......', '.....BBBBBNNNH.', 'LLLLLBBBB......', '...............', '...............', '...............'],
    ['...............', '...............', '...............', '...............', '.....BBBBBNNNH.', 'LLLLLBBBB......', '......WWW......', '.....WWW.......', '....TT.........']
  ];
  const FAR_BIRD = [['W...W', '.W.W.', '..B..'], ['.....', 'WWBWW', '.....'], ['..B..', '.W.W.', 'W...W']];
  const BIRD = { B: [232, 237, 250], W: [196, 206, 236], T: [124, 138, 190], N: [176, 187, 222], H: [242, 245, 253], L: [140, 152, 196] };
  function sprite(frames, f, x, y, dir, alpha) {
    const pic = frames[f], w = pic[0].length, h = pic.length;
    const fx = x / S - w / 2, fy = y / S - h / 2, cx0 = Math.floor(fx), cy0 = Math.floor(fy), tx = fx - cx0, ty = fy - cy0;
    for (let r = 0; r <= h; r++) for (let c = 0; c <= w; c++) {
      let sum = 0, best = 0, ch = '';
      for (let n = 0; n < 4; n++) {
        const sc = c - (n & 1), sr = r - (n >> 1);
        if (sc < 0 || sr < 0 || sc >= w || sr >= h) continue;
        const p = pic[sr][dir > 0 ? sc : w - 1 - sc];
        if (p === '.') continue;
        const share = ((n & 1) ? tx : 1 - tx) * ((n >> 1) ? ty : 1 - ty);
        sum += p === 'L' ? share * .5 : share;
        if (share > best) { best = share; ch = p; }
      }
      if (sum > .02) paint(cx0 + c, cy0 + r, BIRD[ch], alpha * sum);
    }
  }
  const steppe = {
    lit: STAR,
    light: [147, 181, 255],
    init() {
      const small = W < 700;
      this.stars = sparkles(Math.round(cols * rows / 190));
      this.clouds = [];
      for (let i = 0; i < (small ? 3 : 5); i++) this.clouds.push(this.cloud(rand(0, W), true));
      this.flocks = [this.flock(1, true), this.flock(.58, false)];
      this.hills = [rand(0, 9), rand(0, 9), rand(0, 9)];
    },
    cloud(x, anywhere) {
      const puffs = [], n = 4 + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) puffs.push({ ox: rand(-9, 9) * S, oy: rand(-1.4, 1.4) * S, rx: rand(4, 9) * S, ry: rand(1, 2.1) * S });
      return { x, y: rand(.06, .62) * H, v: rand(3, 8), puffs, a: rand(.09, .16), anywhere };
    },
    flock(scale, onStage) {
      const far = scale < 1, dir = Math.random() < .5 ? 1 : -1, birds = [];
      for (let i = 0; i < 5; i++) {
        const k = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
        birds.push({ ox: -k * (far ? 5 : 12) * S * dir, oy: side * k * (far ? 3 : 6) * S, ph: rand(0, TAU), sp: rand(2.7, 3.3) });
      }
      const span = (far ? 16 : 40) * S;
      return { dir, far, scale, birds, y: rand(.16, far ? .38 : .62) * H, v: far ? 17 : 32, bob: rand(0, TAU),
        x: onStage ? (dir > 0 ? W * .3 : W * .7) : (dir > 0 ? -span : W + span), wait: onStage ? 0 : rand(3, 9), span };
    },
    step(dt) {
      for (const c of this.clouds) { c.x += c.v * dt; if (c.x - 20 * S > W) Object.assign(c, this.cloud(-20 * S)); }
      this.flocks.forEach((f, i) => {
        if (f.wait > 0) { f.wait -= dt; return; }
        f.x += f.v * f.dir * dt; f.bob += dt * .5;
        for (const b of f.birds) b.ph += b.sp * dt;
        if ((f.dir > 0 && f.x - f.span > W) || (f.dir < 0 && f.x + f.span < 0)) this.flocks[i] = this.flock(f.scale, false);
      });
    },
    draw(t) {
      const small = W < 700;
      // stars
      for (const s of this.stars) {
        const a = .1 + .3 * (.5 + .5 * Math.sin(t * s.sp + s.ph));
        paintLit(s.cx, s.cy, STAR, s.big ? a * 1.7 : a);
      }
      // moon: a disc with a bite taken out of it
      const mr = (small ? 3.6 : 5.4) * S, mx = W * (small ? .82 : .9), my = small ? 150 : H * .19;
      glow(mx, my, mr * 5.5, [242, 204, 126], .15);
      const x0 = Math.floor((mx - mr) / S), x1 = Math.floor((mx + mr) / S), y0 = Math.floor((my - mr) / S), y1 = Math.floor((my + mr) / S);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const px = (cx + .5) * S, py = (cy + .5) * S;
        const d = Math.hypot(px - mx, py - my), bite = Math.hypot(px - (mx - mr * .52), py - (my - mr * .2));
        if (d <= mr && bite > mr * .92) paint(cx, cy, hash(cx, cy) % 5 ? MOON : MOON_DIM, .88);
      }
      // clouds
      for (const c of this.clouds) for (const p of c.puffs) ellipse(c.x + p.ox, c.y + p.oy, p.rx, p.ry, CLOUD, c.a);
      // far hills along the bottom, and a ger with its door lit
      const base = H - (small ? 3 : 6) * S;
      for (let cx = 0; cx < cols; cx++) {
        const x = cx * S;
        const h1 = base - (Math.sin(x * .0031 + this.hills[0]) + Math.sin(x * .0077 + this.hills[1]) * .5) * S * 2.6;
        const h2 = base + S * 2.5 - Math.sin(x * .0052 + this.hills[2]) * S * 1.8;
        for (let cy = Math.max(0, Math.floor(h1 / S)); cy < rows; cy++) paint(cx, cy, HILL, cy * S > h2 ? .3 : .17);
      }
      if (!small) {
        const gx = W * .1, gy = base - S * .5;
        disc(gx, gy, S * 3.3, [228, 232, 246], .8);
        capsule(gx - S * 3.4, gy + S * 1.2, gx + S * 3.4, gy + S * 1.2, S * 1.6, [206, 212, 234], .8);
        paint(Math.floor(gx / S), Math.floor((gy + S * 1.3) / S), [255, 170, 84], 1);
        paint(Math.floor(gx / S), Math.floor((gy + S * 2.3) / S), [255, 170, 84], 1);
        glow(gx, gy + S * 2, S * 9, [255, 170, 84], .16);
      }
      // cranes
      for (const f of this.flocks) {
        if (f.wait > 0) continue;
        for (const b of f.birds) {
          const wing = [0, 1, 2, 1][Math.floor(b.ph / (TAU / 4)) % 4];
          sprite(f.far ? FAR_BIRD : CRANE, wing, f.x + b.ox, f.y + b.oy + Math.sin(f.bob) * S * 1.5, f.dir, f.far ? .5 : .92);
        }
      }
      lantern(this.light);
    }
  };

  /* ---------- scene: koi pond ---------- */
  const KOI = { white: [246, 242, 232], orange: [255, 142, 80], red: [228, 76, 54], black: [30, 44, 50], gold: [246, 200, 92] };
  const PROFILE = [1.5, 2.0, 2.3, 2.35, 2.25, 2.05, 1.8, 1.5, 1.2, .95, .75, 1.0, 1.25];
  const pond = {
    lit: [150, 236, 224],
    light: [127, 227, 210],
    init() {
      const small = W < 700;
      this.koi = [];
      const n = small ? 3 : 5;
      for (let i = 0; i < n; i++) this.koi.push(this.makeKoi(small ? .7 : 1, (i + rand(.25, .75)) / n));
      this.pads = (small
        ? [[.9, .2, 3.4, 1], [.06, .62, 2.8, 0], [.78, .95, 3.8, 1]]
        : [[.045, .17, 4.6, 1], [.1, .3, 2.6, 0], [.955, .34, 5, 0], [.9, .5, 2.8, 1], [.06, .86, 5.4, 0], [.2, .97, 3, 1], [.84, .93, 4.2, 1], [.5, 1, 3.2, 0]]
      ).map(([fx, fy, r, flower]) => ({ fx, fy, r, flower, notch: rand(0, TAU), ph: rand(0, TAU) }));
      this.shimmer = sparkles(Math.round(cols * rows / 260));
      this.ripples = [];
      this.nextRipple = rand(2, 5);
    },
    makeKoi(scale, fx) {
      const kind = pick(['kohaku', 'kohaku', 'sanke', 'ogon', 'orange']), cols = [];
      for (let j = 0; j < PROFILE.length; j++) {
        if (kind === 'ogon') cols.push(KOI.gold);
        else if (kind === 'orange') cols.push(j < 1 ? KOI.white : KOI.orange);
        else cols.push(KOI.white);
      }
      if (kind === 'kohaku' || kind === 'sanke') {
        for (let p = 0; p < 3; p++) { const at = (Math.random() * 9) | 0, c = Math.random() < .6 ? KOI.orange : KOI.red; for (let j = at; j < Math.min(at + 2 + ((Math.random() * 3) | 0), 11); j++) cols[j] = c; }
        if (kind === 'sanke') cols[2 + ((Math.random() * 7) | 0)] = KOI.black;
      }
      const k = { x: fx * W, y: rand(.15, .85) * H, h: rand(0, TAU), v: 0, base: rand(20, 34), scale: scale * rand(.8, 1.2), cols, ph: rand(0, TAU), t: 0, until: 0, tx: 0, ty: 0, pts: [] };
      for (let j = 0; j < PROFILE.length; j++) k.pts.push({ x: k.x - Math.cos(k.h) * j * S, y: k.y - Math.sin(k.h) * j * S });
      this.retarget(k);
      return k;
    },
    retarget(k) { k.tx = rand(-.08, 1.08) * W; k.ty = rand(-.08, 1.08) * H; k.until = k.t + rand(9, 20); },
    ripple(x, y) { if (this.ripples.length < 6) this.ripples.push({ x, y, age: 0 }); },
    step(dt) {
      for (const k of this.koi) {
        k.t += dt;
        let want = Math.atan2(k.ty - k.y, k.tx - k.x), speed = k.base;
        const px = k.x - pointer.x, py = k.y - pointer.y, pd = Math.hypot(px, py);
        if (pd < 170) { want = Math.atan2(py, px); speed = k.base + (1 - pd / 170) * 95; }
        k.h += clamp(angleDiff(want, k.h), -1.1 * dt, 1.1 * dt) + Math.sin(k.t * .6 + k.ph) * .22 * dt;
        k.v += (speed - k.v) * Math.min(1, dt * 2.2);
        k.x += Math.cos(k.h) * k.v * dt; k.y += Math.sin(k.h) * k.v * dt;
        k.ph += dt * (2.2 + k.v * .06);
        if (Math.hypot(k.tx - k.x, k.ty - k.y) < 70 || k.t > k.until) this.retarget(k);
        // the body follows the head, one joint after another
        const seg = S * 1.32 * k.scale;
        k.pts[0].x = k.x; k.pts[0].y = k.y;
        for (let j = 1; j < k.pts.length; j++) {
          const a = k.pts[j - 1], b = k.pts[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
          b.x = a.x + dx / d * seg; b.y = a.y + dy / d * seg;
        }
      }
      for (const r of this.ripples) r.age += dt;
      this.ripples = this.ripples.filter((r) => r.age < 2.6);
      this.nextRipple -= dt;
      if (this.nextRipple < 0) { const k = pick(this.koi); this.ripple(k.x, k.y); this.nextRipple = rand(4, 9); }
    },
    draw(t) {
      for (const s of this.shimmer) {
        const v = Math.sin(t * s.sp * .6 + s.ph);
        if (v > 0) { paintLit(s.cx, s.cy, GLINT, v * .13); paintLit(s.cx + 1, s.cy, GLINT, v * .07); }
      }
      for (const r of this.ripples) ring(r.x, r.y, 14 + r.age * 62, RIPPLE, (1 - r.age / 2.6) * .3);
      for (const k of this.koi) {
        const n = k.pts.length, u = S * k.scale;
        glow(k.pts[2].x, k.pts[2].y, u * 11, k.cols[3] === KOI.gold ? KOI.gold : KOI.orange, .1);
        for (let j = n - 1; j >= 0; j--) {
          const p = k.pts[j], q = k.pts[Math.max(j - 1, 0)], r0 = k.pts[Math.min(j + 1, n - 1)];
          let nx = -(q.y - r0.y), ny = q.x - r0.x; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
          const sway = Math.sin(k.ph - j * .62) * u * .09 * j;
          const x = p.x + nx * sway, y = p.y + ny * sway;
          if (j === 2) { // side fins
            disc(x + nx * u * 3, y + ny * u * 3, u * 1.2, KOI.white, .45);
            disc(x - nx * u * 3, y - ny * u * 3, u * 1.2, KOI.white, .45);
          }
          if (j === n - 1) {                                                // forked tail
            disc(x + nx * u * 1.5, y + ny * u * 1.5, u * 1.45, KOI.white, .5);
            disc(x - nx * u * 1.5, y - ny * u * 1.5, u * 1.45, KOI.white, .5);
          } else if (j === n - 2) disc(x, y, PROFILE[j] * u, KOI.white, .55);
          else disc(x, y, PROFILE[j] * u, k.cols[j], .9);
        }
      }
      for (const p of this.pads) {
        const x = p.fx * W + Math.sin(t * .23 + p.ph) * 3, y = p.fy * H + Math.cos(t * .19 + p.ph) * 3, r = p.r * S;
        const x0 = Math.floor((x - r) / S) - 1, x1 = Math.floor((x + r) / S) + 1, y0 = Math.floor((y - r) / S) - 1, y1 = Math.floor((y + r) / S) + 1;
        for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
          const dx = (cx + .5) * S - x, dy = (cy + .5) * S - y, d = Math.hypot(dx, dy), w = edge(r - d);
          if (w <= 0 || (d > S && Math.abs(angleDiff(Math.atan2(dy, dx), p.notch)) < .34)) continue;
          paint(cx, cy, d > r - S * 1.15 ? PAD_RIM : (hash(cx, cy) % 3 ? PAD : PAD_PALE), .62 * w);
        }
        if (p.flower) { disc(x + S, y - S, S * 1.25, [250, 162, 190], .92); paint(Math.floor((x + S) / S), Math.floor((y - S) / S), [255, 226, 150], 1); }
      }
      lantern(this.light);
    }
  };

  /* ---------- scene: embers ---------- */
  const embers = {
    lit: FLY_WARM,
    light: [232, 140, 105],
    init() {
      this.flies = [];
      const n = W < 700 ? 16 : 34;
      for (let i = 0; i < n; i++) this.flies.push({ x: rand(0, W), y: rand(0, H), h: rand(0, TAU), v: rand(8, 20), ph: rand(0, TAU), sp: rand(.5, 1.4), warm: Math.random() < .7 });
    },
    step(dt) {
      for (const f of this.flies) {
        f.h += rand(-1.6, 1.6) * dt; f.ph += f.sp * dt;
        f.x += Math.cos(f.h) * f.v * dt; f.y += Math.sin(f.h) * f.v * dt * .7;
        if (f.x < -20) f.x = W + 20; if (f.x > W + 20) f.x = -20; if (f.y < -20) f.y = H + 20; if (f.y > H + 20) f.y = -20;
      }
    },
    draw() {
      for (const f of this.flies) {
        const on = Math.max(0, Math.sin(f.ph)) ** 1.5, c = f.warm ? FLY_WARM : FLY_HOT;
        if (on < .03) continue;
        const gx = f.x / S - .5, gy = f.y / S - .5, cx = Math.floor(gx), cy = Math.floor(gy), tx = gx - cx, ty = gy - cy;
        paintLit(cx, cy, c, on * Math.min(.95, (1 - tx) * (1 - ty) * 1.6));
        paintLit(cx + 1, cy, c, on * Math.min(.95, tx * (1 - ty) * 1.6));
        paintLit(cx, cy + 1, c, on * Math.min(.95, (1 - tx) * ty * 1.6));
        paintLit(cx + 1, cy + 1, c, on * Math.min(.95, tx * ty * 1.6));
        glow(f.x, f.y, S * 6, c, on * .2);
      }
      lantern(this.light);
    }
  };

  const SCENES = { steppe, pond, embers };

  /* ---------- loop ---------- */
  function resize() {
    q = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    // A tile is a whole number of device pixels, so its edges stay sharp on any screen scaling.
    cell = Math.max(4, Math.round((W < 700 ? 9 : 10) * q));
    S = cell / q;
    cols = Math.ceil(W / S); rows = Math.ceil(H / S);
    canvas.width = Math.round(W * q); canvas.height = Math.round(H * q);
    ctx.imageSmoothingEnabled = false;
    const n = cols * rows;
    bufR = new Float32Array(n); bufG = new Float32Array(n); bufB = new Float32Array(n); bufA = new Float32Array(n);
    bufL = new Uint8Array(n); touched = new Int32Array(n); count = 0;
    img = new ImageData(cols, rows);
    small = document.createElement('canvas'); small.width = cols; small.height = rows;
    sctx = small.getContext('2d');
    // Full strength in the page margins, quieter behind the column of text.
    lane = new Float32Array(cols);
    const half = Math.min(W, 1188) / 2;
    const quiet = W < 700 ? .42 : .56;
    for (let cx = 0; cx < cols; cx++) lane[cx] = quiet + (1 - quiet) * clamp((Math.abs((cx + .5) * S - W / 2) - half * .9) / 130, 0, 1);
    document.documentElement.style.setProperty('--cell', S + 'px');
    buildMask();
    if (scene) { buildAtlas(); scene.init(); frame(0); }
  }
  function frame(dt) {
    if (dt > 0) scene.step(dt);
    scene.draw(clock);
    flush();
  }
  /* The backdrop redraws in step with the screen. The first frames are timed to learn the screen's
     refresh rate: up to about 80 a second every frame is drawn, and on faster screens every second
     or third one, which keeps the pacing even (144 Hz gives 72 frames a second). */
  let every = 1, tick = 0, probe = [], lastTick = 0;
  function loop(now) {
    if (probe) {
      if (lastTick) probe.push(now - lastTick);
      lastTick = now;
      if (probe.length >= 30) {
        probe.sort((a, b) => a - b);
        every = Math.max(1, Math.round(1000 / probe[15] / 72));
        probe = null;
      }
    }
    if (++tick % every === 0) {
      const dt = Math.min((now - last) / 1000, .06);
      last = now; clock += dt; frame(dt);
    }
    raf = requestAnimationFrame(loop);
  }
  function sync() {
    cancelAnimationFrame(raf);
    if (motion && !document.hidden) { last = performance.now(); lastTick = 0; raf = requestAnimationFrame(loop); }
    else if (scene) frame(0);
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); });
  window.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') { pointer.x = e.clientX; pointer.y = e.clientY; } }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer.x = -9999; pointer.y = -9999; });
  window.addEventListener('pointerdown', (e) => { if (scene === pond && motion) pond.ripple(e.clientX, e.clientY); }, { passive: true });
  document.addEventListener('visibilitychange', sync);
  // The characters are drawn once into the stencil, so redo it when the real font has arrived.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!scene || !cols) return; buildMask(); buildAtlas(); if (!motion) frame(0); });

  window.Backdrop = {
    setTheme(name) {
      themeName = SCENES[name] ? name : 'pond';
      scene = SCENES[themeName];
      if (!cols) resize(); else { buildAtlas(); scene.init(); frame(0); }
    },
    setMotion(on) { motion = on; sync(); },
    get everyNthFrame() { return every; },
    // Draws n frames back to back and returns the average cost of one, in milliseconds.
    bench(n = 120) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { clock += 1 / 30; frame(1 / 30); }
      ctx.getImageData(0, 0, 1, 1);
      return +((performance.now() - t0) / n).toFixed(2);
    }
  };
})();
