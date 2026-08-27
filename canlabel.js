/* CAN LABEL AND PACK WRAP — drawn on canvas, used as textures.

   UV UNWRAP MEASUREMENTS (model "Aluminium can 500ml", mesh Material).
   Taken from the model's buffer, not guessed:
     • V grows from the bottom up, corr(V, height) = 0.999 — the unwrap is
       honestly cylindrical, the picture lands without distortion;
     • the straight wall spans 8..147 mm of height, which in V is 0.472..1.000.
   Hence WALL_V0 = 0.472: we stretch the texture over exactly that span, and
   then we can draw across the whole area of the canvas.
     • U goes around the circle once and in the right direction — no need to
       flip it. Checked with four variants in a single frame: without the
       flip the lettering reads, with it the lettering comes out mirrored.

   ON REPEATING THE ARTWORK. From any one point about 40% of the
   circumference is visible. Draw it once and two thirds of the time the
   viewer is looking at a blank side. So the artwork goes around the can
   PANELS times. Real cans are made the same way. */

const WALL_V0 = 0.472;                 // bottom of the straight wall in V
const PANELS = 3;                      // how many times the art wraps the can

/* THE CANVAS SIZE IS COMPUTED FROM THE GEOMETRY, NOT ROUNDED OFF.

   A panel on the can is 1/3 of the circumference wide and the whole straight
   wall tall: π × 65.9 / 3 = 69.0 mm by 139 mm, that is, a ratio of 0.4965.

   The first attempt gave 512 × 512 per panel, and that squashed the artwork
   sideways by exactly 2x: horizontally it worked out to 7.4 pixels per
   millimetre, vertically 3.7. A square icon sat on the can as a rectangle
   twice as tall as it was wide, and the letters read narrow and stretched.

   We keep the density equal on both axes: 512 / 0.4965 ≈ 1031, we take
   1024 — a power of two, friendlier to video memory, 0.7% off. */
const W = 1536, H = 1024;

/* Which panel is the front one. The icon is printed only there: a real can
   has one face, and drawing it on all three means showing two icons at once
   on the curve, which is exactly what looked odd. The other panels carry the
   header and the ticker, so there is never a blank side anyway. */
const FRONT_PANEL = 0;

/* =========================================================================
   COLOURS COME FROM THE THEME, THEY ARE NOT HARDCODED

   The site has fifteen themes, and each has its own accent. A yellow written
   in here survived exactly until the first theme switch: on the green site
   the cans glowed in a foreign colour, and that looked like someone else's
   picture pasted into the layout.

   We read the same variables the stylesheet does. The values are sampled on
   every repaint of the canvas: the theme gets switched on a live page, and a
   cached palette would outlive the switch.
   ========================================================================= */
function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
  return {
    INK:  v('--color-ink', '#0f0e09'),
    INK2: v('--color-ink-2', '#16150e'),
    BLOCK: v('--color-block-2', '#1b1a13'),
    BONE: v('--color-bone', '#fff'),
    NEON: v('--color-neon', '#cf0'),
    DIM:  v('--color-dim', '#7f7c73'),
  };
}

/* How much of the label stays in view.

   The can stands in the pack, and the cardboard sleeve covers its bottom.
   Here is what exactly it covers: the straight wall runs from y = −0.45 to
   +0.41 in the can's own frame, and the top of the sleeve is at −0.14. So
   (−0.14 + 0.45) / 0.86 = 0.36 of the label's height is eaten from below.

   The whole artwork therefore lives in the top 62%. It used to take up the
   full area, and the cardboard cut the tickers exactly in half — on the
   PIPEDOG pack it read "PIPEDO". Below that line only the background is
   left: there is nothing to draw down there. */
const PANEL_U = 0.62;

/* Thickness of the canvas edge bands — the colour of the shoulder and of the
   base. On a real can that is bare metal, the artwork does not reach there.
   The tone comes from the theme (--color-ink-2): dark, but not black — in
   black the neck falls away and the can loses its shape. */
const SHOULDER_PX = 6;

const DISP = '"Archivo", system-ui, sans-serif';
const MONO = '"Azeret Mono", ui-monospace, monospace';

/* =========================================================================
   TOKEN ICONS

   The icons live on cdn.dexscreener.com, and the CDN serves them WITHOUT an
   access-control-allow-origin header — verified by request. For an <img>
   that does not matter, but a canvas such a picture has been drawn into
   becomes tainted, and WebGL refuses to take a texture from it: the page
   dies for no visible reason. So everything goes through our /api/icon,
   which serves the same byte-for-byte file with its own CORS.

   A miss must not bring down the first screen: if an icon did not load we
   draw a placeholder with the first letter of the ticker and carry on.
   ========================================================================= */
export function loadIcon(url, apiBase = '') {
  return new Promise(resolve => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = apiBase + '/api/icon?u=' + encodeURIComponent(url);
  });
}

/* Canvas cannot do letter spacing — so do it by hand. */
function tracked(g, text, x, y, spacing, align = 'center') {
  const w = [...text].reduce((s, ch) => s + g.measureText(ch).width + spacing, -spacing);
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  for (const ch of text) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + spacing; }
  return w;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* The icon as a rounded square — as on the basket cards on the page. One
   shape everywhere on the site: a circle here and a square there would read
   as two different things. */
function drawIcon(g, img, x, y, size, ticker, P) {
  const r = size * .22;
  g.save();
  roundRect(g, x, y, size, size, r);
  g.clip();
  if (img) {
    g.drawImage(img, x, y, size, size);
  } else {
    // Placeholder: ticker letter. An empty square would be a hole in the label.
    g.fillStyle = P.BLOCK; g.fillRect(x, y, size, size);
    g.fillStyle = P.NEON; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${size * .52}px ${DISP}`;
    g.fillText((ticker || '?')[0].toUpperCase(), x + size / 2, y + size / 2);
    g.textBaseline = 'alphabetic';
  }
  g.restore();
  // Edging: without it a dark icon merges into the dark can.
  g.strokeStyle = 'rgba(255,255,255,.22)';
  g.lineWidth = Math.max(1, size * .018);
  roundRect(g, x, y, size, size, r);
  g.stroke();
}

/* One panel of the label. Coordinates in fractions, so that the canvas
   resolution can be raised for retina without rewriting anything. */
function panel(g, x, w, hFull, seat, P, isFront) {
  const cx = x + w / 2;
  const m = w * .085;
  const h = hFull * PANEL_U;              // draw only in the visible part

  g.strokeStyle = 'rgba(255,255,255,.13)';
  g.lineWidth = Math.max(1, w * .004);
  // The frame runs down behind the sleeve: cut by cardboard it reads as print
  // continuing under the pack, whereas closed at the bottom it is a sticker.
  g.strokeRect(x + m, h * .10, w - m * 2, hFull);

  // --- header: index name and seat number ---
  g.fillStyle = P.DIM; g.font = `500 ${w * .038}px ${MONO}`;
  g.textAlign = 'left';
  tracked(g, '6PACK INDEX', x + m + w * .030, h * .215, w * .011, 'left');
  g.textAlign = 'right'; g.fillStyle = P.NEON;
  tracked(g, String(seat.n).padStart(2, '0'), x + w - m - w * .030, h * .215, w * .011, 'right');

  // --- token icon: on the front panel only ---
  const isz = w * .40;
  if (isFront) drawIcon(g, seat.iconImg, cx - isz / 2, h * .265, isz, seat.ticker, P);

  // --- ticker ---
  g.textAlign = 'center'; g.fillStyle = P.BONE;
  let px = w * .150;
  g.font = `800 ${px}px ${DISP}`;
  const t = seat.ticker.toUpperCase();
  /* Long tickers like STONKBROKER do not fit. We shrink the font, we do NOT
     cut the text: a truncated ticker is already a different token. */
  while (g.measureText(t).width > w - m * 2.4 && px > w * .05) {
    px *= .93; g.font = `800 ${px}px ${DISP}`;
  }
  g.fillText(t, cx, h * .845);

  const tw = g.measureText(t).width;
  g.fillStyle = P.NEON;
  g.fillRect(cx - tw / 2, h * .885, tw, Math.max(2, hFull * .008));

  /* Weights and holdings are gone from here: they fell exactly under the
     cardboard. Their place is the sleeve face, where they are printed. */
}

/** The label canvas. seat: { n, ticker, iconImg } */
export function labelCanvas(seat, scale = 1) {
  const c = document.createElement('canvas');
  c.width = W * scale; c.height = H * scale;
  const g = c.getContext('2d');
  g.scale(scale, scale);

  /* The background is not flat: a vertical gradient gives the can volume even
     where the scene light does not reach. A flat fill reads as a sticker. */
  const P = palette();
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, P.BLOCK); bg.addColorStop(.55, P.INK); bg.addColorStop(1, '#050505');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  const pw = W / PANELS;
  for (let i = 0; i < PANELS; i++) panel(g, i * pw, pw, H, seat, P, i === FRONT_PANEL);

  g.fillStyle = 'rgba(255,255,255,.06)';
  for (let i = 0; i < PANELS; i++) g.fillRect(i * pw, H * .075, 1, H * .85);

  /* The edge bands — the colour of the shoulder and of the base. They work
     with the edge clamp in labelTexture: everything above the straight wall
     takes the top row's colour, everything below the bottom row's. Without
     this the texture wrapped around and light bands showed on the neck. */
  g.fillStyle = P.INK2;
  g.fillRect(0, 0, W, SHOULDER_PX);
  g.fillRect(0, H - SHOULDER_PX, W, SHOULDER_PX);

  return c;
}

export function labelTexture(THREE, seat, scale = 1) {
  const t = new THREE.CanvasTexture(labelCanvas(seat, scale));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;          // around: repeat, the seam meets
  t.wrapT = THREE.ClampToEdgeWrapping;     // vertically: clamp, see above
  t.repeat.y = 1 / (1 - WALL_V0);
  t.offset.y = -WALL_V0 / (1 - WALL_V0);
  return t;
}

/* =========================================================================
   PACK WRAP

   A real six-pack is held together by a cardboard sleeve around the bottom
   of the cans. Its face is a ready-made spot for the index card, and it is
   the only flat surface in the whole scene: on a cylinder large text is
   always curved, and the heading has to read straight.

   Face and back are printed the same — as on a real pack. Otherwise for
   half of every turn the viewer is looking at blank cardboard.
   ========================================================================= */

/** The face of the sleeve: the index card. */
export function sleeveFace(seats, { aspect = 3.6, h = 460, scale = 1 } = {}) {
  /* The canvas width is computed from the face's own ratio, not given as a
     number: otherwise the texture stretches and the print drifts sideways. */
  const w = Math.round(h * aspect);
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const g = c.getContext('2d'); g.scale(scale, scale);

  const P = palette();
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, P.BLOCK); bg.addColorStop(1, P.INK);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);

  // Border edging — cardboard has thickness, and the face must show it.
  g.strokeStyle = 'rgba(255,255,255,.10)'; g.lineWidth = 3;
  g.strokeRect(22, 22, w - 44, h - 44);

  /* The face is long and low, so the layout is two columns: the name on the
     left, the holdings on the right. In one column the heading and six icons
     would not fit without everything becoming tiny. */
  const pad = h * .13;
  g.textAlign = 'left';

  g.fillStyle = P.DIM; g.font = `500 ${h * .062}px ${MONO}`;
  tracked(g, 'ROBINHOOD CHAIN', pad, h * .225, h * .016, 'left');

  g.fillStyle = P.BONE; g.font = `800 ${h * .34}px ${DISP}`;
  g.fillText('6PACK', pad - h * .012, h * .60);
  const bw = g.measureText('6PACK').width;
  g.fillStyle = P.NEON;
  g.fillRect(pad, h * .655, bw, Math.max(2, h * .019));

  g.fillStyle = P.DIM; g.font = `500 ${h * .072}px ${MONO}`;
  tracked(g, 'HOLD 1. OWN 6.', pad, h * .805, h * .015, 'left');

  /* The holdings — six icons with tickers. Exactly what a person wants to
     know about the index at a glance, and exactly what a pack prints. */
  /* The width of the icon row is computed from the ROOM that is left, not
     fixed up front: on the first attempt the row started at a fixed spot and
     ran into the word 6PACK. The left column is already drawn, its right
     edge is known — that is what we work from. */
  const leftEdge = pad + Math.max(bw, g.measureText('HOLD 1. OWN 6.').width) + h * .22;
  const room = w - pad - leftEdge;
  const n = seats.length;
  let isz = Math.min(h * .30, room / n * 0.78);
  const gap = (room - n * isz) / (n - 1);
  const x0 = leftEdge, y = h * .30;
  seats.forEach((s, i) => {
    const x = x0 + i * (isz + gap);
    drawIcon(g, s.iconImg, x, y, isz, s.ticker, P);
    g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `500 ${h * .046}px ${MONO}`;
    g.textAlign = 'center';
    const tk = s.ticker.length > 8 ? s.ticker.slice(0, 7) + '…' : s.ticker;
    g.fillText(tk, x + isz / 2, y + isz + h * .085);
    g.textAlign = 'left';
  });

  g.fillStyle = P.NEON; g.font = `600 ${h * .058}px ${MONO}`;
  g.textAlign = 'right';
  tracked(g, '0.7% OF EVERY TRADE', w - pad, h * .875, h * .012, 'right');
  g.textAlign = 'left';

  return c;
}

/** The sleeve's end — a narrow strip, only the name fits on it. */
export function sleeveSide({ aspect = 2.4, h = 460, scale = 1 } = {}) {
  const w = Math.round(h * aspect);
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const g = c.getContext('2d'); g.scale(scale, scale);
  const P = palette();
  g.fillStyle = P.INK2; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,.09)'; g.lineWidth = 3;
  g.strokeRect(h * .10, h * .10, w - h * .20, h - h * .20);
  g.fillStyle = P.BONE; g.font = `800 ${h * .30}px ${DISP}`; g.textAlign = 'center';
  g.fillText('6PACK', w / 2, h * .55);
  g.fillStyle = P.NEON; g.font = `500 ${h * .062}px ${MONO}`;
  tracked(g, 'INDEX', w / 2, h * .70, h * .028);
  return c;
}

export const LABEL_FACTS = { WALL_V0, PANELS, W, H, FRONT_PANEL };
