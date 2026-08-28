/* УПАКОВКА 6PACK — шесть банок корзины одним предметом.

   Модель банки: «Aluminium can 500ml», YouniqueIdeaStudio, CC-BY-4.0.
   Условие лицензии — указание автора на самой странице.

   ПРО ФАЙЛ СО SKETCHFAB. В нём две запечённые ловушки:
     • узел Sketchfab_model несёт произвольную матрицу поворота — модель
       загружали в наклонённой позе, и поза сохранилась в файле;
     • узел RootNode масштабирует в 1000 раз (0.01 × 100000).
   Поэтому иерархия отбрасывается целиком, банка собирается из двух голых
   геометрий, и они нормируются один раз при загрузке. Меши чистые:
   ось +Z, высота 162.3 мм, диаметр 65.9 мм. Дальше всё в долях высоты.

   ПРО КОМПОНОВКУ. Первый заход поднимал задний ряд, чтобы читались все
   шесть банок сразу. От этого отказались: получалась витрина, а не
   упаковка. Здесь банки стоят вплотную, как в настоящем сикспаке, а все
   шесть показывает не расстановка, а полный оборот — и картонная обхватка,
   на которой напечатан состав.
   ========================================================================= */

import { labelTexture, sleeveFace, sleeveSide, LABEL_FACTS } from './canlabel.js';

/* =========================================================================
   ПОЧИНКА РАЗВЁРТКИ ГОРЛЫШКА

   Над прямой стенкой у модели идёт плечо — сужение к крышке высотой около
   15 мм. Замер по буферу: на 142 мм координата V равна 0.991, на 147 мм
   доходит до 1.000, а на 162 мм снова 0.000. То есть плечо прогоняет через
   себя ВЕСЬ диапазон текстуры сверху вниз и сминает целую этикетку в
   пятнадцатимиллиметровую полоску.

   Именно это выглядело как «белая полоса над этикеткой»: не блик и не
   заворот текстуры, а раздавленная в ленту картинка — при увеличении в ней
   различимы иконка и буквы. Ни зажим края, ни смена материала тут не
   помогают: значения V остаются в пределах [0,1], и любая текстура
   размажется одинаково.

   Чиним координаты меша один раз при загрузке: всё, что не принадлежит
   прямой стенке, получает V крайней строки холста, а она нарочно закрашена
   цветом металла. Стенка определяется по радиусу — на плече и донышке он
   меньше, и это надёжнее порога по высоте, который пришлось бы подбирать.
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
    if (Math.hypot(pos.getX(i), pos.getZ(i)) >= wall) continue;   // это стенка
    uv.setY(i, pos.getY(i) > 0 ? 1 : LABEL_FACTS.WALL_V0);
    fixed++;
  }
  uv.needsUpdate = true;
  return fixed;
}

const CAN_D = 0.407;            // диаметр банки в долях её высоты (66/162)
const D = CAN_D + 0.012;        // шаг: банки почти касаются, как в упаковке
const ROW_Z = D;                // ряды тоже вплотную — это настоящий 3×2

/* Обхватка. Высота 0.36 от банки: у настоящей упаковки картон закрывает
   низ и оставляет открытыми плечи и крышки — по ним пачка и узнаётся.
   Первый заход дал 0.42, и картон резал тикеры пополам. Эта цифра связана
   с PANEL_U в canlabel.js: там рисунок этикетки поднят ровно над этой
   чертой. Меняешь здесь — меняй и там. */
const SLEEVE_H = 0.36;
const SLEEVE_PAD = 0.028;       // насколько картон выступает за банки
const SLEEVE_BOTTOM = -0.5;     // низ картона вровень с дном банок

/* Куда смотрит лицевая панель этикетки при нулевом повороте банки.

   Замерено по буферу модели, а не подобрано рендерами: центр лицевой
   панели приходится на U = 1/6, а этой координате в развёртке отвечает
   угол −118.1° вокруг вертикали. Значит банку надо довернуть на +118.1°,
   чтобы лицо смотрело в камеру. Развёртка начинается не с той стороны,
   что обращена к зрителю, и угадать это нельзя. */
const FRONT_TURN = 2.0617;      // +118.1°

/* Геометрии грузятся один раз и переиспользуются всеми шестью банками:
   шесть копий одной сетки — это шесть лишних мегабайт и ничего взамен. */
export async function loadCan(THREE, GLTFLoader, url) {
  const gl = await new GLTFLoader().loadAsync(url);
  const geos = {};
  gl.scene.traverse(o => { if (o.isMesh) geos[o.material.name] = o.geometry; });
  if (!geos.Material || !geos.aluminium) throw new Error('в модели нет ожидаемых мешей');

  const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);   // ось +Z → +Y
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
   СВЕТ ДЛЯ МЕТАЛЛА

   Крышка — полированный алюминий. Без карты окружения металл в three
   показывает только блики от источников: широкий кант ловил их целиком и
   выходил белой лентой над этикеткой — то, что читалось как «недокрашено».
   Дело было не в текстуре: сама текстура на кант не заходит.

   Настоящее решение — дать металлу что отражать. Небольшая карта
   окружения, сгенерированная из холста: тёмный низ, светлый верх, полоса
   акцента. Тогда кант отражает сцену, а не вспыхивает.
   ========================================================================= */
export function makeEnv(THREE, renderer) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');

  const sky = g.createLinearGradient(0, 0, 0, 128);
  sky.addColorStop(0, '#4a4a42');       // потолок — главный источник
  sky.addColorStop(.42, '#22221c');
  sky.addColorStop(.55, '#111009');     // линия горизонта
  sky.addColorStop(1, '#080805');
  g.fillStyle = sky; g.fillRect(0, 0, 256, 128);

  /* Мягкая полоса акцента: даёт канту цветной отблеск вместо белого.
     Цвет из темы, как и на этикетках, — иначе при смене темы металл
     отражал бы жёлтый на зелёном сайте. Рисуем полосу с прозрачностью
     через globalAlpha: цвет темы приходит строкой любого формата, и
     собрать из него rgba() вручную нельзя. */
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
      /* Этикетка — краска на металле, а не сам металл. На 0.35 она блестела
         как зеркало и топила текст. */
      metalness: .10, roughness: .55,
    })),
    new THREE.Mesh(geos.lid, new THREE.MeshStandardMaterial({
      /* Тон темнее настоящего алюминия и шероховатость выше. Полированный
         светлый металл на тёмной банке пересвечивался кантом. */
      color: 0x8b9296, metalness: .85, roughness: .42,
    })));
  return g;
}

/* Картонная обхватка. Коробка с шестью материалами: лицо и спина печатные,
   торцы узкие, верх и низ не рисуются вовсе — сквозь них видно банки, и
   любая заливка там читалась бы крышкой коробки. */
function makeSleeve(THREE, seats, scale) {
  const w = D * 3 + SLEEVE_PAD * 2;
  const d = ROW_Z * 2 + SLEEVE_PAD * 2;
  const box = new THREE.BoxGeometry(w, SLEEVE_H, d);

  /* Холсты рисуются под НАСТОЯЩЕЕ соотношение своей грани. Раньше оба были
     фиксированного размера, и текстура растягивалась по ширине: буквы на
     лице выходили шире, чем задуманы, а на торцах — уже. */
  const face = new THREE.CanvasTexture(sleeveFace(seats, { aspect: w / SLEEVE_H, scale }));
  const side = new THREE.CanvasTexture(sleeveSide({ aspect: d / SLEEVE_H, scale }));
  for (const t of [face, side]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; }

  const paper = { metalness: 0, roughness: .92 };
  const printed = new THREE.MeshStandardMaterial({ map: face, ...paper });
  const flank = new THREE.MeshStandardMaterial({ map: side, ...paper });
  const none = new THREE.MeshStandardMaterial({ visible: false });

  /* Порядок граней в BoxGeometry: +X, −X, +Y, −Y, +Z, −Z.
     Печатное лицо смотрит на зрителя (+Z) и в спину (−Z) — как на
     настоящей упаковке, иначе полоборота зритель видит пустой картон. */
  const mesh = new THREE.Mesh(box, [flank, flank, none, none, printed, printed]);
  mesh.position.y = SLEEVE_BOTTOM + SLEEVE_H / 2;
  return mesh;
}

/**
 * Собранная упаковка. seats — шесть мест корзины по порядку.
 * Возвращает группу и функцию кадра.
 */
export function buildPack(THREE, geos, seats, { scale = 2 } = {}) {
  const pack = new THREE.Group();
  const cans = [];

  seats.slice(0, 6).forEach((seat, i) => {
    const col = i % 3, row = (i / 3) | 0;      // 0 — передний ряд
    const can = makeCan(THREE, geos, seat, scale);
    can.position.set((col - 1) * D, 0, row ? -ROW_Z / 2 : ROW_Z / 2);
    /* Банки развёрнуты лицом наружу: передний ряд к зрителю, задний — от
       него, как расставляют настоящую упаковку в витрине. Иконка теперь
       печатается на одной панели, и если банку повернуть произвольно, она
       окажется на скрытом боку.

       FRONT_TURN — поправка на то, где именно оказывается лицевая панель
       при нулевом повороте. Замерена рендером, а не подобрана на глаз. */
    can.rotation.y = FRONT_TURN + (row ? Math.PI : 0);
    pack.add(can);
    cans.push(can);
  });

  pack.add(makeSleeve(THREE, seats, scale));

  /* Кадр: ровный полный оборот.

     Пробовались полуобороты с остановкой лицом — чтобы иконку, которая
     теперь печатается на одной панели, можно было разглядеть подольше.
     Решение отменено сознательно: предмет, который замирает и дёргается,
     притягивает взгляд и спорит с текстом первого экрана, а ровное
     вращение остаётся фоном. Что иконка видна не всё время — не беда:
     тикер на банке есть с любой стороны, а полный состав напечатан на
     обхватке и никуда не уезжает.

     Банки внутри упаковки неподвижны: в настоящей пачке они не крутятся,
     и любое их доворачивание сразу выдаёт подделку. */
  const PERIOD = 34;                          // секунд на полный оборот

  return {
    pack, cans,
    tick(t) { pack.rotation.y = t / PERIOD * Math.PI * 2; },
  };
}

/* Кадрирование по габариту.

   Считается по коробке, а не по сфере: радиус сферы тянется по диагонали
   через всю глубину упаковки, и камера от него отъезжала почти вдвое
   дальше нужного. Замер берётся на повороте 45°, где упаковка шире всего:
   иначе на этом угле она вылезет за край кадра. */
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
