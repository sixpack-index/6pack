/* 6PACK PACKAGING — the basket's six cans as a single object.

   Can model: "Aluminium can 500ml", YouniqueIdeaStudio, CC-BY-4.0.
   The licence requires crediting the author on the page itself.

   ABOUT THE SKETCHFAB FILE. It has two traps baked into it:
     • the Sketchfab_model node carries an arbitrary rotation matrix — the
       model was uploaded in a tilted pose, and the pose was saved in it;
     • the RootNode node scales by a factor of 1000 (0.01 × 100000).
   So the hierarchy is discarded entirely, the can is assembled from two bare
   geometries, and they are normalised once at load time. The meshes are
   clean: +Z axis, height 162.3 mm, diameter 65.9 mm. From there on
   everything is in fractions of the height.

   ABOUT THE LAYOUT. The first attempt raised the back row so that all six
   cans could be read at once. That was dropped: it came out as a display
   stand, not a pack. Here the cans stand flush, as in a real six-pack, and
   what shows all six is not the arrangement but a full turn — and the
   cardboard sleeve with the holdings printed on it.
   ========================================================================= */

import { labelTexture, sleeveFace, sleeveSide, LABEL_FACTS } from './canlabel.js';

/* =========================================================================
   FIXING THE NECK UV UNWRAP

   Above the straight wall the model has a shoulder — a taper to the lid
   about 15 mm high. Measured from the buffer: at 142 mm the V coordinate is
   0.991, at 147 mm it reaches 1.000, and at 162 mm it is back to 0.000. That
   is, the shoulder runs the ENTIRE texture range through itself from top to
   bottom and crushes a whole label into a fifteen-millimetre band.

   This is exactly what looked like a "white stripe above the label": not a
   highlight and not texture wrap-around, but a picture crushed into a ribbon
   — zoom in and the icon and the letters are still distinguishable. Neither
   edge clamping nor changing the material helps here: the V values stay
   within [0,1], and any texture will smear the same way.

   We fix the mesh coordinates once at load time: everything that does not
   belong to the straight wall gets the V of the canvas's edge row, and that
   row is deliberately painted the colour of metal. The wall is identified by
   radius — on the shoulder and the base it is smaller, and that is more
   reliable than a height threshold, which would have to be tuned.
   ========================================================================= */
function fixShoulderUV(THREE, geo) {
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  if (!pos || !uv) return 0;

  let rMax = 0;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    if (r > rMax) rMax = r;
  }
  const wall = rMax * 0.985;

  let fixed = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.hypot(pos.getX(i), pos.getZ(i)) >= wall) continue;   // this is the wall
    uv.setY(i, pos.getY(i) > 0 ? 1 : LABEL_FACTS.WALL_V0);
    fixed++;
  }
  uv.needsUpdate = true;
  return fixed;
}

const CAN_D = 0.407;            // can diameter in fractions of its height (66/162)
const D = CAN_D + 0.012;        // pitch: cans nearly touch, as in a real pack
const ROW_Z = D;                // rows are flush too — this is a true 3×2

/* The sleeve. Height 0.36 of the can: on a real pack the cardboard covers
   the bottom and leaves the shoulders and lids open — that is how a pack is
   recognised. The first attempt gave 0.42 and the cardboard cut the tickers
   in half. This figure is tied to PANEL_U in canlabel.js: there the label
   artwork is lifted to sit exactly above that line. Change it here, change
   it there. */
const SLEEVE_H = 0.36;
const SLEEVE_PAD = 0.028;       // how far the cardboard sticks out past the cans
const SLEEVE_BOTTOM = -0.5;     // cardboard bottom flush with the cans' bottoms

/* Where the label's front panel faces at zero can rotation.

   Measured from the model's buffer, not tuned by renders: the centre of the
   front panel falls at U = 1/6, and in the unwrap that coordinate answers to
   an angle of −118.1° about the vertical. So the can has to be turned by a
   further +118.1° for the face to look into the camera. The unwrap does not
   begin on the side turned towards the viewer, and that cannot be guessed. */
const FRONT_TURN = 2.0617;      // +118.1°

/* The geometries are loaded once and reused by all six cans: six copies of
   one mesh is six extra megabytes and nothing in return. */
export async function loadCan(THREE, GLTFLoader, url) {
  const gl = await new GLTFLoader().loadAsync(url);
  const geos = {};
  gl.scene.traverse(o => { if (o.isMesh) geos[o.material.name] = o.geometry; });
  if (!geos.Material || !geos.aluminium) throw new Error('the model is missing the expected meshes');

  const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);   // +Z axis → +Y
  const body = geos.Material.clone().applyMatrix4(m);
  const lid = geos.aluminium.clone().applyMatrix4(m);
  body.computeBoundingBox();
  const bb = body.boundingBox, h = bb.max.y - bb.min.y, k = 1 / h;
  const c = new THREE.Matrix4()
    .makeTranslation(0, -(bb.min.y + h / 2) * k, 0)
    .multiply(new THREE.Matrix4().makeScale(k, k, k));
  body.applyMatrix4(c); lid.applyMatrix4(c);
  body.computeBoundingBox();

  const fixed = fixShoulderUV(THREE, body);

  return { body, lid, heightMm: h * 1000, shoulderVerts: fixed };
}

/* =========================================================================
   LIGHT FOR THE METAL

   The lid is polished aluminium. Without an environment map, metal in three
   shows only the highlights from the light sources: the wide rim caught them
   whole and came out as a white ribbon above the label — the thing that read
   as "unpainted". It was not the texture: the texture itself never reaches
   the rim.

   The real fix is to give the metal something to reflect. A small
   environment map generated from a canvas: dark at the bottom, light at the
   top, a band of accent. Then the rim reflects the scene instead of flaring.
   ========================================================================= */
export function makeEnv(THREE, renderer) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');

  const sky = g.createLinearGradient(0, 0, 0, 128);
  sky.addColorStop(0, '#4a4a42');       // ceiling — the main source
  sky.addColorStop(.42, '#22221c');
  sky.addColorStop(.55, '#111009');     // the horizon line
  sky.addColorStop(1, '#080805');
  g.fillStyle = sky; g.fillRect(0, 0, 256, 128);

  /* A soft band of accent: it gives the rim a coloured glint instead of a
     white one. The colour comes from the theme, as on the labels — otherwise
     a theme switch would leave the metal reflecting yellow on a green site.
     We draw the band with transparency via globalAlpha: the theme colour
     arrives as a string in any format, and rgba() cannot be built from it. */
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-neon').trim() || '#ccff00';
  g.save();
  g.globalAlpha = .30;
  const acc = g.createLinearGradient(0, 0, 256, 0);
  acc.addColorStop(0, 'transparent');
  acc.addColorStop(.28, accent);
  acc.addColorStop(.5, 'transparent');
  g.fillStyle = acc; g.fillRect(0, 8, 256, 42);
  g.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose(); tex.dispose();
  return env;
}

function makeCan(THREE, geos, seat, scale) {
  const g = new THREE.Group();
  g.add(
    new THREE.Mesh(geos.body, new THREE.MeshStandardMaterial({
      map: labelTexture(THREE, seat, scale),
      /* The label is paint on metal, not the metal itself. At 0.35 it shone
         like a mirror and drowned the text. */
      metalness: .10, roughness: .55,
    })),
    new THREE.Mesh(geos.lid, new THREE.MeshStandardMaterial({
      /* A tone darker than real aluminium and a higher roughness. Polished
         light metal on a dark can blew out along the rim. */
      color: 0x8b9296, metalness: .85, roughness: .42,
    })));
  return g;
}

/* The cardboard sleeve. A box with six materials: face and back printed,
   the ends narrow, top and bottom not drawn at all — the cans show through
   there, and any fill would read as the lid of a box. */
function makeSleeve(THREE, seats, scale) {
  const w = D * 3 + SLEEVE_PAD * 2;
  const d = ROW_Z * 2 + SLEEVE_PAD * 2;
  const box = new THREE.BoxGeometry(w, SLEEVE_H, d);

  /* The canvases are drawn to the REAL ratio of their own face. Both used to
     be a fixed size, and the texture stretched across the width: letters on
     the face came out wider than intended, and on the ends narrower. */
  const face = new THREE.CanvasTexture(sleeveFace(seats, { aspect: w / SLEEVE_H, scale }));
  const side = new THREE.CanvasTexture(sleeveSide({ aspect: d / SLEEVE_H, scale }));
  for (const t of [face, side]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; }

  const paper = { metalness: 0, roughness: .92 };
  const printed = new THREE.MeshStandardMaterial({ map: face, ...paper });
  const flank = new THREE.MeshStandardMaterial({ map: side, ...paper });
  const none = new THREE.MeshStandardMaterial({ visible: false });

  /* Face order in BoxGeometry: +X, −X, +Y, −Y, +Z, −Z.
     The printed face looks at the viewer (+Z) and at the back (−Z) — as on
     a real pack, otherwise for half a turn the viewer sees blank cardboard. */
  const mesh = new THREE.Mesh(box, [flank, flank, none, none, printed, printed]);
  mesh.position.y = SLEEVE_BOTTOM + SLEEVE_H / 2;
  return mesh;
}

/**
 * The assembled pack. seats — the basket's six seats in order.
 * Returns the group and a frame function.
 */
export function buildPack(THREE, geos, seats, { scale = 2 } = {}) {
  const pack = new THREE.Group();
  const cans = [];

  seats.slice(0, 6).forEach((seat, i) => {
    const col = i % 3, row = (i / 3) | 0;      // 0 — the front row
    const can = makeCan(THREE, geos, seat, scale);
    can.position.set((col - 1) * D, 0, row ? -ROW_Z / 2 : ROW_Z / 2);
    /* The cans are turned face outwards: the front row towards the viewer,
       the back row away from it, the way a real pack is set out in a shop
       window. The icon is now printed on one panel, and if a can is turned
       arbitrarily it ends up on the hidden side.

       FRONT_TURN is the correction for where the front panel actually ends
       up at zero rotation. Measured by render, not tuned by eye. */
    can.rotation.y = FRONT_TURN + (row ? Math.PI : 0);
    pack.add(can);
    cans.push(can);
  });

  pack.add(makeSleeve(THREE, seats, scale));

  /* The frame: an even full turn.

     Half-turns with a stop facing forward were tried — so that the icon,
     which is now printed on one panel, could be studied a little longer.
     The idea was dropped deliberately: an object that freezes and jerks
     pulls the eye and argues with the text of the first screen, whereas an
     even rotation stays background. That the icon is not visible all the
     time is no loss: the ticker is on the can from every side, and the full
     holdings are printed on the sleeve and never go away.

     The cans inside the pack do not move: in a real pack they do not spin,
     and turning them at all gives the fake away at once. */
  const PERIOD = 34;                          // seconds per full turn

  return {
    pack, cans,
    tick(t) { pack.rotation.y = t / PERIOD * Math.PI * 2; },
  };
}

/* Framing by the bounding box.

   Computed from the box, not from a sphere: the sphere's radius stretches
   along the diagonal through the whole depth of the pack, and the camera
   backed off almost twice as far as it needed to. The measurement is taken
   at a 45° rotation, where the pack is widest: otherwise at that angle it
   runs off the edge of the frame. */
export function framePack(THREE, pack, cam, { margin = 1.02, lift = .05 } = {}) {
  const keep = pack.rotation.y;
  pack.rotation.y = Math.PI / 4;
  pack.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(pack);
  pack.rotation.y = keep;
  pack.updateMatrixWorld(true);

  const size = box.getSize(new THREE.Vector3());
  const look = box.getCenter(new THREE.Vector3());
  const vFov = cam.fov * Math.PI / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * cam.aspect);
  const dist = size.z / 2 + Math.max(
    (size.y / 2) * margin / Math.tan(vFov / 2),
    (size.x / 2) * margin / Math.tan(hFov / 2));

  cam.position.set(look.x, look.y + dist * lift, look.z + dist);
  cam.lookAt(look);
  cam.near = Math.max(.01, dist - size.length());
  cam.far = dist + size.length() * 2;
  cam.updateProjectionMatrix();
  return { center: look, dist };
}

export const PACK_FACTS = { CAN_D, D, ROW_Z, SLEEVE_H };
