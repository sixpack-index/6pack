/* =========================================================================
   The figure in the stage box.

   THE ENGINE is the original's, THE FIGURE is ours.

   The engine was reverse-engineered from the original build: the archive
   held only
   a baked frame, while the animation itself loaded as a separate chunk that
   is not in the archive; the chunk was taken from the live site. three.js
   renders a real three-dimensional frame into a tiny canvas the size of the
   text grid, and every pixel is turned into a character by brightness. No
   ASCII maths at all.

   The engine's numbers are his, not tuned by eye:
     camera          PerspectiveCamera(42, 0.52*w/h, 0.1, 100)
     material        MeshPhongMaterial, shininess 36, specular 0x999999
     frame step      at most every 40 ms — that is ~25 frames a second, not 60
     rotation        y += 0.011, x += 0.004 per frame, smoothing 0.12
     dragging        0.008 radians per pixel
     grid            104 columns, 72 on a narrow screen
     brightness      0.299R + 0.587G + 0.114B

   ALL OF THIS IS NOW THE FALLBACK PATH. In the stage box stands a real pack
   of six cans — it is assembled in canpack.js and shown as is, with no
   translation into characters. The characters stay for the case when the
   pack cannot be assembled: no WebGL, the model did not arrive, the network
   did not answer with the basket's holdings. An empty stage box is worse
   than a stage box with the wrong figure.

   Further down this same path is the original's ASCII donut: it does not
   even need WebGL and is drawn with arithmetic.
   ========================================================================= */

/* The original's ramp: 88 characters from empty to densest. */
const RAMP =
  " .`-_':,^=;><+!rc*/z?sLTv)J7|F{C}fI31tlu[neoZ5Yxjya]2ESwqkP6h9d4VpOGbUAKXHm8RD#$Bg0MNWQ%&@";

/* =========================================================================
   The figure for the fallback display in characters.

   Two more used to live alongside it — a die and a torus knot on six — and
   they were picked through `?fig=`. The choice has been made, both are
   deleted: an unused figure is code you have to keep from breaking with
   every edit next to it.

   We keep the light more contrasty than the original. Its knot is one
   smooth tube, soft light is enough for it; we have six separate bodies,
   and at the old ambient 0x1a1a1a the cans stuck together into one solid
   white wall. Measured, not eyeballed.

   A black material is the only way to draw a hole in ASCII: there is
   nothing to subtract geometry with, and black turns into a space. The
   first version of the die set the pips recessed, and it came out a smooth
   cube without a single pip.
   ========================================================================= */

const FIGURES = {
  /* Six cans in a plastic yoke.

     The yoke is not one big ring around the whole group. It was, and that
     is not how it works: a hoop with a radius larger than the bundle
     inevitably passes THROUGH the outer cans, and in the real view that is
     the first thing you see — iron arcs going into metal.

     A real yoke is built differently: six separate rings, each slipped over
     the neck of its own can, and webs between neighbours. The rings sit
     where the can is already tapering towards the lid, and they bite into
     it slightly — that is what holds them.

     A can that tapers upwards, not a tube: a plain cylinder has no top and
     no bottom, and the bundle reads as a set of sticks. */
  sixpack(THREE, M) {
    const g = new THREE.Group();

    const R_BOT = .40, R_TOP = .345, H = 1.20;
    const STEP_X = .92, STEP_Z = 1.0;
    const YOKE_Y = .40;
    /* The can's radius at the yoke's height — an interpolation between the
       bottom and the top. Computed, not tuned: a tuned number would drift
       out of step with the geometry on the first change to the can height. */
    const rAt = y => R_BOT + (R_TOP - R_BOT) * ((y + H / 2) / H);
    const R_RING = rAt(YOKE_Y) + .03;
    const TUBE = .038;

    const can = new THREE.CylinderGeometry(R_TOP, R_BOT, H, 24, 1);
    const lid = new THREE.CylinderGeometry(R_TOP + .012, R_TOP + .012, .05, 24, 1);
    const ring = new THREE.TorusGeometry(R_RING, TUBE, 7, 22);

    const at = (i, k) => [(i - 1) * STEP_X, (k - .5) * STEP_Z];

    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 2; k++) {
        const [x, z] = at(i, k);
        const m = new THREE.Mesh(can, M.body);
        m.position.set(x, 0, z);
        g.add(m);
        /* A dark lid: without it the top is a solid fill and the cans
           cannot be counted — neither in characters nor in the real view. */
        const l = new THREE.Mesh(lid, M.hole);
        l.position.set(x, H / 2 + .025, z);
        g.add(l);

        const r = new THREE.Mesh(ring, M.body);
        r.rotation.x = Math.PI / 2;
        r.position.set(x, YOKE_Y, z);
        g.add(r);
      }
    }

    /* The webs. Length computed from the pitch and the ring radius: a
       hardcoded number would survive a pitch change and hang in the air. */
    const web = (len, horiz) => new THREE.BoxGeometry(
      horiz ? len : .07, .028, horiz ? .07 : len);
    const lenX = STEP_X - 2 * R_RING;
    const lenZ = STEP_Z - 2 * R_RING;

    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < 2; i++) {
        const [x1, z] = at(i, k);
        const m = new THREE.Mesh(web(lenX, true), M.body);
        m.position.set(x1 + STEP_X / 2, YOKE_Y, z);
        g.add(m);
      }
    }
    for (let i = 0; i < 3; i++) {
      const [x] = at(i, 0);
      const m = new THREE.Mesh(web(lenZ, false), M.body);
      m.position.set(x, YOKE_Y, 0);
      g.add(m);
    }

    return { obj: g, z: 6.1, tilt: .62 };
  },

};

/* The fallback path's ramp — short, from the original's bakedFrame. */
const RAMP_FALLBACK = '.,-~:;=!*#$@';

/** Ratio of a character's width to its font size. Measured, default is 0.6. */
let ASPECT = 0.6;

/**
 * The original's ASCII donut, letter for letter from his code. It lives as a
 * fallback path: without WebGL the page must show a figure, not a blank box.
 */
function renderDonutFrame(cols, rows, A, B) {
  const out = new Array(cols * rows).fill(' ');
  const zb = new Array(cols * rows).fill(0);
  for (let th = 0; th < 6.283; th += 0.06) {
    const ct = Math.cos(th), st = Math.sin(th);
    const cx = ct + 2;
    for (let ph = 0; ph < 6.283; ph += 0.015) {
      const sp = Math.sin(ph), cp = Math.cos(ph);
      const sA = Math.sin(A), cA = Math.cos(A);
      const sB = Math.sin(B), cB = Math.cos(B);
      const ooz = 1 / (sp * cx * sA + st * cA + 5);
      const t = sp * cx * cA - st * sA;
      const x = Math.floor(cols / 2 + 0.21 * cols * ooz * (cp * cx * cB - t * sB));
      const y = Math.floor(rows / 2 + 0.42 * rows * ooz * (cp * cx * sB + t * cB));
      const i = x + cols * y;
      const lum = Math.floor(
        8 * ((st * sA - sp * ct * cA) * cB - sp * ct * sA - st * cA - cp * ct * sB)
      );
      if (y >= 0 && y < rows && x >= 0 && x < cols && ooz > zb[i]) {
        zb[i] = ooz;
        out[i] = RAMP_FALLBACK[lum > 0 ? lum : 0];
      }
    }
  }
  let s = '';
  for (let r = 0; r < rows; r++) s += out.slice(r * cols, (r + 1) * cols).join('') + '\n';
  return s;
}

/** Character grid: 104 columns, 72 on narrow screens; rows — as many as fit. */
function gridFor(stage) {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (w < 40 || h < 40) return null;
  const cols = w < 480 ? 72 : 104;
  const fs = w / (cols * ASPECT);
  return { w: cols, h: Math.max(8, Math.floor(h / fs)), fs };
}

/**
 * Starts the figure. Returns a stop function — as in the original: without
 * it, leaving the page would leave a dead frame spinning.
 */
/* =========================================================================
   THE PACK — what stands in the stage box by default.

   It lives separately, in canpack.js: assembling the object and its UV
   unwrap have nothing to do with turning a frame into characters, which is
   what this file was written for.

   Here there is only the wiring: wait for the basket's holdings, assemble,
   spin, and — above all — do not end up with an empty stage box if any of
   that did not work out.
   ========================================================================= */
async function startPack(THREE, stage, pre, fpsEl, seatsPromise, hooks) {
  const [{ GLTFLoader }, pack3d, { loadIcon }] = await Promise.all([
    import('./vendor/GLTFLoader.js'),
    import('./canpack.js'),
    import('./canlabel.js'),
  ]);

  const rows = (await seatsPromise) || [];
  if (rows.length < 6) throw new Error('the basket has ' + rows.length + ' tokens, six are needed');

  /* Wait for the fonts. Canvas draws with what is ALREADY loaded, and app.js
     pulls them in on the fly: starting earlier means silently getting the
     fallback font on all six labels and seeing the difference only by eye,
     with no error. */
  try { await document.fonts.ready; } catch (_) {}

  /* The icons load all at once rather than one by one: six requests in a row
     means six network delays one after another. A miss on any of them is not
     fatal, loadIcon returns null and the label draws the ticker's letter. */
  const seats = await Promise.all(rows.slice(0, 6).map(async (r, i) => ({
    n: i + 1,
    ticker: r.sym || r.symbol || '?',
    iconImg: await loadIcon(r.icon, hooks.apiBase || ''),
  })));

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearAlpha(0);
  /* Without tone mapping the highlights on the aluminium clip to pure white
     and the lid turns into a flat blob. */
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;display:block';
  stage.appendChild(renderer.domElement);
  pre.style.display = 'none';

  const scene = new THREE.Scene();
  scene.environment = pack3d.makeEnv(THREE, renderer);
  const camera = new THREE.PerspectiveCamera(26, 1, .01, 100);

  const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(3, 5, 4);
  const fill = new THREE.DirectionalLight(0xffffff, .6); fill.position.set(-4, 1, 3);
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-neon').trim() || '#ccff00';
  const rim = new THREE.DirectionalLight(0xffffff, 1.4);
  try { rim.color.set(accent); } catch (_) {}
  rim.position.set(-2, 2, -4);
  scene.add(key, fill, rim, new THREE.AmbientLight(0x2a2a20, .9));

  const geos = await pack3d.loadCan(THREE, GLTFLoader, new URL('models/can/scene.gltf', import.meta.url).href);
  const built = pack3d.buildPack(THREE, geos, seats);
  scene.add(built.pack);

  const fit = () => {
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    pack3d.framePack(THREE, built.pack, camera);
  };
  fit();

  let first = true;
  return {
    fit,
    draw(t) {
      built.tick(t / 1000 + hooks.drag());
      renderer.render(scene, camera);
      /* The loading state is cleared AFTER the first render, not once the
         canvas appears: the canvas exists from the very start and is empty,
         and clearing the bar on it would show a black hole for an instant. */
      if (first) { first = false; stage.classList.add('ready'); }
    },
    dispose() {
      geos.body.dispose(); geos.lid.dispose();
      renderer.dispose(); renderer.domElement.remove();
      pre.style.display = '';
    },
  };
}

/**
 * @param seatsPromise promise with the basket's holdings. The stage box must
 *   not wait on the network to appear, but a pack with no holdings is six
 *   nameless cans, that is, a lie about the index. So we wait right here.
 */
export function start(stage, pre, fpsEl, seatsPromise, apiBase) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dead = false;

  // We measure the character width, not guess it: it depends on the font.
  const probe = document.createElement('span');
  probe.textContent = '0'.repeat(20);
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit';
  pre.appendChild(probe);
  const fontSize = parseFloat(getComputedStyle(pre).fontSize) || 10;
  const ratio = probe.getBoundingClientRect().width / 20 / fontSize;
  probe.remove();
  ASPECT = ratio > 0.3 && ratio < 1 ? ratio : 0.6;

  let grid = gridFor(stage) ?? { w: 104, h: 44, fs: 0 };

  /* Target and current position kept apart: the rotation catches up to the
     target by 12% per frame, so the figure starts smoothly, not with a jerk. */
  let targetX = 0.4, targetY = 0.2;
  let curX = 0.4, curY = 0.2;

  let dragging = false, lastPX = 0, lastPY = 0;
  let lastFrame = 0, frames = 0, fpsAt = performance.now();
  let onScreen = true, raf = 0;
  let draw = null, resize = null, dispose = null;

  const applyFontSize = () => { if (grid.fs > 0) pre.style.fontSize = grid.fs + 'px'; };

  const put = text => {
    /* The character path is a display too: the moment letters appear in the
       stage box, the loading state has to go. Without this the bar would
       hang over the figure for everyone whose pack failed to assemble. */
    stage.classList.add('ready');
    pre.textContent = text;
    frames++;
    const now = performance.now();
    if (now - fpsAt > 1000) {
      fpsEl.textContent = frames + ' fps';
      frames = 0;
      fpsAt = now;
    }
  };

  const loop = t => {
    raf = 0;
    if (dead || !draw) return;
    draw(t);
    if (onScreen && !document.hidden && !reduced) raf = requestAnimationFrame(loop);
  };
  const kick = () => { if (!raf && !dead && draw) raf = requestAnimationFrame(loop); };

  const onDown = e => {
    dragging = true; lastPX = e.clientX; lastPY = e.clientY;
    stage.setPointerCapture(e.pointerId);
  };
  const onUp = () => { dragging = false; };
  const onMove = e => {
    if (!dragging) return;
    targetY += (e.clientX - lastPX) * 0.008;
    targetX += (e.clientY - lastPY) * 0.008;
    lastPX = e.clientX; lastPY = e.clientY;
    kick();
  };
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('pointermove', onMove);

  const io = new IntersectionObserver(es => {
    onScreen = es.some(x => x.isIntersecting);
    if (onScreen) kick();
  });
  io.observe(stage);

  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener('visibilitychange', onVis);

  const ro = new ResizeObserver(() => {
    const g = gridFor(stage);
    if (!g) return;
    if (g.w === grid.w && g.h === grid.h && Math.abs(g.fs - grid.fs) < 0.1) return;
    grid = g; applyFontSize(); resize?.(); lastFrame = 0; kick();
  });
  ro.observe(stage);

  (async () => {
    applyFontSize();
    const canvas = document.createElement('canvas');
    canvas.width = grid.w;
    canvas.height = grid.h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (hasWebGL() && ctx) {
      const THREE = await import('./vendor/three.module.min.js');
      if (dead) return;

      /* ---------- the pack: what the visitor sees ---------- */
      {
        try {
          const p = await startPack(THREE, stage, pre, fpsEl, seatsPromise, {
            apiBase: apiBase || '',
            /* Dragging turns the pack on top of its own motion: the object
               stays alive, but the viewer can turn it around. */
            drag: () => targetY * 4,
          });
          if (dead) { p.dispose(); return; }
          resize = p.fit;
          dispose = p.dispose;
          draw = t => {
            if (t - lastFrame < 16) return;
            lastFrame = t;
            p.draw(t);
            frames++;
            const now = performance.now();
            if (now - fpsAt > 1000) { fpsEl.textContent = frames + ' fps'; frames = 0; fpsAt = now; }
          };
          /* kick() is required here: the early return skips the one that sits
             at the end of the wrapper, and you get an assembled scene without
             a single frame — from outside, no different from total breakage. */
          kick();
          return;
        } catch (e) {
          /* It did not work — rather than leave a black hole on the first
             screen we fall back to ASCII: it depends on neither network nor
             model. */
          console.warn('pack failed to assemble, showing characters:', e && e.message || e);
          pre.style.display = '';
        }
      }

      THREE.ColorManagement.enabled = false;
      const renderer = new THREE.WebGLRenderer({
        antialias: false, preserveDrawingBuffer: true, alpha: false,
      });
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      renderer.setPixelRatio(1);
      renderer.setSize(grid.w, grid.h);
      renderer.setClearColor(0, 1);

      const scene = new THREE.Scene();
      // 0.52 — correction for a character being twice as tall as it is wide.
      const camera = new THREE.PerspectiveCamera(42, 0.52 * grid.w / grid.h, 0.1, 100);
      camera.position.z = 4.6;

      const material = new THREE.MeshPhongMaterial({
        color: 0xffffff, shininess: 36, specular: 0x999999,
      });
      /* Black becomes a space in ASCII — that is what draws the die's pips
         and the cans' lids. There would be nothing to subtract geometry with. */
      const holeMat = new THREE.MeshPhongMaterial({ color: 0x000000, shininess: 0 });
      const built = FIGURES.sixpack(THREE, { body: material, hole: holeMat });
      const knot = built.obj;
      scene.add(knot);

      camera.position.z = built.z || 4.6;
      targetX = built.tilt ?? 0.4;
      curX = targetX;

      const key = new THREE.DirectionalLight(0xffffff, 1.25 * Math.PI);
      key.position.set(2.4, 2.6, 3);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xffffff, 0.22 * Math.PI);
      fill.position.set(-2.5, -1.4, -2);
      scene.add(fill);
      scene.add(new THREE.AmbientLight(0x080808, Math.PI));

      resize = () => {
        renderer.setSize(grid.w, grid.h);
        camera.aspect = 0.52 * grid.w / grid.h;
        camera.updateProjectionMatrix();
        canvas.width = grid.w;
        canvas.height = grid.h;
      };
      dispose = () => {
        knot.traverse?.(o => o.geometry?.dispose?.());
        knot.geometry?.dispose?.();
        material.dispose(); holeMat.dispose(); renderer.dispose();
      };

      draw = t => {
        // At most every 40 ms: in the original the figure runs at 25 fps, not 60.
        if (t - lastFrame < 40) return;
        lastFrame = t;
        if (!dragging) { targetY += 0.011; targetX += 0.004; }
        curX += (targetX - curX) * 0.12;
        curY += (targetY - curY) * 0.12;
        knot.rotation.x = curX;
        knot.rotation.y = curY;
        built.tick?.(t);
        renderer.render(scene, camera);
        ctx.drawImage(renderer.domElement, 0, 0);

        const px = ctx.getImageData(0, 0, grid.w, grid.h).data;
        let out = '';
        for (let y = 0; y < grid.h; y++) {
          for (let x = 0; x < grid.w; x++) {
            const i = (y * grid.w + x) * 4;
            const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
            out += RAMP[Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length))];
          }
          out += '\n';
        }
        put(out);
      };
    } else {
      // No WebGL — the original's donut, with his own step and speeds.
      let x = 0, y = 0;
      draw = t => {
        if (t - lastFrame < 45) return;
        lastFrame = t;
        if (!dragging) { targetY += 0.05; targetX += 0.025; }
        x += (targetX - x) * 0.15;
        y += (targetY - y) * 0.15;
        put(renderDonutFrame(grid.w, grid.h, x, y));
      };
    }
    kick();
  })();

  return () => {
    dead = true;
    if (raf) cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    stage.removeEventListener('pointerdown', onDown);
    stage.removeEventListener('pointerup', onUp);
    stage.removeEventListener('pointercancel', onUp);
    stage.removeEventListener('pointermove', onMove);
    dispose?.();
    draw = null;
  };
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (_) {
    return false;
  }
}
