'use strict';
/* The living backdrop.
   The page sits on a grid of small tiles, each holding one character. Nothing is drawn as a
   smooth shape: cranes, koi, clouds and the moon are all painted by lighting up tiles, so
   they read as a mosaic that is always moving. Three scenes share one engine:
     pond    a koi pond seen from above
     steppe  a night sky over the Mongolian steppe, with cranes passing
     embers  fireflies in the dark

   How it stays cheap: the picture that changes every frame is tiny, one pixel per tile, and the
   browser's compositor stretches it to fill the window. Three layers sit on top of each other:
     #field       the tiles, one pixel each, scaled up with hard edges
     .bd-stencil  drawn once: the gaps between tiles and the character in every tile, in the page colour
     .bd-haze     the soft glows around creatures and the two colour washes in the corners,
                  two pixels per tile, scaled up smoothly
   Exposes window.Backdrop = { setTheme(name), setMotion(on), bench(n) }.
   Add #fps to the page address to see how it is running in a given browser. */
(function () {
  const canvas = document.getElementById('field');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const stencil = document.createElement('canvas'), haze = document.createElement('canvas');
  stencil.className = 'bd-stencil'; haze.className = 'bd-haze';
  stencil.setAttribute('aria-hidden', 'true'); haze.setAttribute('aria-hidden', 'true');
  canvas.after(stencil); stencil.after(haze);
  const sctx = stencil.getContext('2d'), hctx = haze.getContext('2d');
  const HAZE = 2;   // haze pixels per tile
  const GLYPHS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ+=#%*<>/';
  const TAU = Math.PI * 2;

  // S is the tile size in CSS pixels, cell the same tile in device pixels, q the ratio between them.
  let S = 10, W = 0, H = 0, cols = 0, rows = 0, q = 1, cell = 10;
  let bufR, bufG, bufB, bufA, touched, count = 0, lane, img;
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
  const paintLit = paint;
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

  // Drawing a frame: write one pixel per lit tile, hand the tiny image over, and redraw the glows.
  function flush() {
    const px = img.data;
    px.fill(0);
    for (let n = 0; n < count; n++) {
      const i = touched[n], a = bufA[i] * lane[i % cols], o = i * 4;
      px[o] = bufR[i]; px[o + 1] = bufG[i]; px[o + 2] = bufB[i]; px[o + 3] = a * 255;
      bufA[i] = 0;
    }
    count = 0;
    ctx.putImageData(img, 0, 0);
    hctx.clearRect(0, 0, haze.width, haze.height);
    const f = HAZE / S;
    // Two wide washes of the scene's colours, top right and bottom left, drifting very slowly.
    const dim = W < 700 ? .8 : 1, da = .5 + .5 * Math.sin(clock * .12), db = .5 + .5 * Math.sin(clock * .098 + 1.7);
    wash((W * (.89 - .09 * da)) * f, (W * .09 + H * .08 * da) * f, Math.max(210, W * .23) * (1 + .12 * da) * f, scene.wash[0], .12 * dim);
    wash((W * (.06 + .1 * db)) * f, (H - W * .04 - H * .09 * db) * f, Math.max(190, W * .2) * (1 + .08 * db) * f, scene.wash[1], .1 * dim);
    for (let n = 0; n < glows.length; n++) {
      const g = glows[n], x = g[0] * f, y = g[1] * f, r = g[2] * f, c = g[3];
      const grad = hctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${g[4]})`);
      grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      hctx.fillStyle = grad; hctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    glows.length = 0;
  }

  function wash(x, y, r, c, a) {
    const grad = hctx.createRadialGradient(x, y, 0, x, y, r), rgb = `${c[0]},${c[1]},${c[2]}`;
    grad.addColorStop(0, `rgba(${rgb},${a})`);
    grad.addColorStop(.3, `rgba(${rgb},${a * .62})`);
    grad.addColorStop(.62, `rgba(${rgb},${a * .25})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    hctx.fillStyle = grad; hctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /* The stencil is drawn once per scene and window size, then left alone. It paints the page colour
     over the gaps between tiles and over one character in every tile, so each lit tile shows its
     character as a darker cut. A hair-thin lighter line marks the grid where nothing is lit. */
  function buildStencil() {
    const size = P * cell, m = document.createElement('canvas'), c = m.getContext('2d'), bg = scene.bg, ink = scene.ink;
    m.width = m.height = size;
    const gap = Math.max(1, Math.round(cell * .1)), hair = Math.max(1, Math.round(q));
    c.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    for (let n = 0; n < P; n++) {
      c.fillRect(n * cell, 0, gap, size); c.fillRect((n + 1) * cell - gap, 0, gap, size);
      c.fillRect(0, n * cell, size, gap); c.fillRect(0, (n + 1) * cell - gap, size, gap);
    }
    // Characters this small are mostly soft edges, so each one is struck twice to read clearly.
    c.globalAlpha = .8; c.font = `600 ${Math.round(cell * .68)}px "JetBrains Mono", ui-monospace, Consolas, monospace`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let pass = 0; pass < 2; pass++)
      for (let cy = 0; cy < P; cy++) for (let cx = 0; cx < P; cx++) c.fillText(GLYPHS[glyphAt(cx, cy)], cx * cell + cell / 2, cy * cell + cell / 2 + .5 * q);
    c.globalAlpha = 1; c.fillStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},.022)`;
    for (let n = 0; n < P; n++) { c.fillRect(n * cell, 0, hair, size); c.fillRect(0, n * cell, size, hair); }
    sctx.clearRect(0, 0, stencil.width, stencil.height);
    sctx.fillStyle = sctx.createPattern(m, 'repeat');
    sctx.fillRect(0, 0, stencil.width, stencil.height);
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
    bg: [10, 15, 31], ink: [238, 240, 248], wash: [[242, 204, 126], [147, 181, 255]],
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
    bg: [5, 32, 31], ink: [236, 247, 243], wash: [[255, 154, 108], [127, 227, 210]],
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
    bg: [18, 17, 15], ink: [240, 236, 228], wash: [[217, 119, 87], [159, 171, 247]],
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
    if (!W || !H) { cols = 0; return; }   // a window with no size yet; the resize event will call again
    // A tile is a whole number of device pixels, so its edges stay sharp on any screen scaling.
    cell = Math.max(4, Math.round((W < 700 ? 9 : 10) * q));
    S = cell / q;
    cols = Math.ceil(W / S); rows = Math.ceil(H / S);
    canvas.width = cols; canvas.height = rows;
    haze.width = cols * HAZE; haze.height = rows * HAZE;
    stencil.width = cols * cell; stencil.height = rows * cell;
    for (const layer of [canvas, stencil, haze]) { layer.style.width = cols * S + 'px'; layer.style.height = rows * S + 'px'; }
    const n = cols * rows;
    bufR = new Float32Array(n); bufG = new Float32Array(n); bufB = new Float32Array(n); bufA = new Float32Array(n);
    touched = new Int32Array(n); count = 0;
    img = ctx.createImageData(cols, rows);
    // Full strength in the page margins, quieter behind the column of text.
    lane = new Float32Array(cols);
    const half = Math.min(W, 1188) / 2;
    const quiet = W < 700 ? .42 : .56;
    for (let cx = 0; cx < cols; cx++) lane[cx] = quiet + (1 - quiet) * clamp((Math.abs((cx + .5) * S - W / 2) - half * .9) / 130, 0, 1);
    if (scene) { buildStencil(); scene.init(); frame(0); }
  }
  function frame(dt) {
    if (!cols || !scene) return;
    if (dt > 0) scene.step(dt);
    scene.draw(clock);
    flush();
  }
  // Add #fps to the page address to see how the backdrop is really running in this browser.
  const meter = location.hash === '#fps' ? document.createElement('div') : null;
  if (meter) {
    meter.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99;font:12px/1.6 ui-monospace,Consolas,monospace;color:#fff;background:rgba(0,0,0,.8);padding:9px 12px;border-radius:8px;white-space:pre;pointer-events:none';
    meter.textContent = 'measuring...';
    document.body.append(meter);
  }
  let mFrames = 0, mCost = 0, mWorst = 0, mSince = 0, mPrev = 0;
  // The backdrop redraws once for every frame the screen shows.
  function loop(now) {
    const dt = Math.min((now - last) / 1000, .06);
    last = now; clock += dt;
    const t0 = meter ? performance.now() : 0;
    frame(dt);
    if (meter) {
      mFrames++; mCost += performance.now() - t0;
      if (mPrev && now - mPrev > mWorst) mWorst = now - mPrev;
      mPrev = now;
      if (now - mSince >= 1000) {
        meter.textContent = `${Math.round(mFrames * 1000 / (now - mSince))} frames a second\n${(mCost / mFrames).toFixed(2)} ms to draw one\nlongest gap ${mWorst.toFixed(0)} ms\n${cols} x ${rows} tiles, window ${W} x ${H}, scale ${q}`;
        mFrames = 0; mCost = 0; mWorst = 0; mSince = now;
      }
    }
    raf = requestAnimationFrame(loop);
  }
  // The backdrop keeps moving while the page scrolls. It stops only when motion is off or the tab is hidden.
  function sync() {
    cancelAnimationFrame(raf);
    if (motion && !document.hidden) { last = performance.now(); mPrev = 0; raf = requestAnimationFrame(loop); }
    else if (scene) frame(0);
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); });
  window.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') { pointer.x = e.clientX; pointer.y = e.clientY; } }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer.x = -9999; pointer.y = -9999; });
  window.addEventListener('pointerdown', (e) => { if (scene === pond && motion) pond.ripple(e.clientX, e.clientY); }, { passive: true });
  document.addEventListener('visibilitychange', sync);
  // The characters are drawn once into the stencil, so redo it when the real font has arrived.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (scene && cols) buildStencil(); });

  window.Backdrop = {
    setTheme(name) {
      themeName = SCENES[name] ? name : 'pond';
      scene = SCENES[themeName];
      if (!cols) resize(); else { buildStencil(); scene.init(); frame(0); }
    },
    setMotion(on) { motion = on; sync(); },
    // Draws n frames back to back and returns the average cost of one, in milliseconds.
    bench(n = 120) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { clock += 1 / 30; frame(1 / 30); }
      return +((performance.now() - t0) / n).toFixed(2);
    }
  };
})();
