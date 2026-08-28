/* ЭТИКЕТКА БАНКИ И ОБЁРТКА УПАКОВКИ — рисуются на canvas, идут текстурами.

   ЗАМЕРЫ РАЗВЁРТКИ (модель «Aluminium can 500ml», меш Material).
   Взяты из буфера модели, а не подобраны:
     • V растёт снизу вверх, corr(V, высота) = 0.999 — развёртка честно
       цилиндрическая, картинка ложится без искажений;
     • прямая стенка занимает 8..147 мм высоты, что по V даёт 0.472..1.000.
   Отсюда WALL_V0 = 0.472: текстуру растягиваем ровно на этот отрезок, и
   тогда рисовать можно во всю площадь холста.
     • U обходит круг один раз и в нужную сторону — разворачивать не надо.
       Проверено четырьмя вариантами в один кадр: без разворота надписи
       читаются, с разворотом зеркалятся.

   ПРО ПОВТОР РИСУНКА. С любой точки видно около 40% окружности. Нарисуешь
   один раз — две трети времени зритель смотрит на пустой бок. Поэтому
   рисунок обходит банку PANELS раз. Так же сделаны настоящие банки. */

const WALL_V0 = 0.472;                 // низ прямой стенки в координатах V
const PANELS = 3;                      // сколько раз рисунок обходит банку

/* РАЗМЕР ХОЛСТА СЧИТАЕТСЯ ИЗ ГЕОМЕТРИИ, А НЕ БЕРЁТСЯ КРУГЛЫМ.

   Панель на банке — это 1/3 окружности в ширину и вся прямая стенка в
   высоту: π × 65.9 / 3 = 69.0 мм на 139 мм, то есть соотношение 0.4965.

   Первый заход дал 512 × 512 на панель, и это ровно вдвое сплющивало
   рисунок вбок: по горизонтали выходило 7.4 пикселя на миллиметр, по
   вертикали 3.7. Квадратная иконка садилась на банку прямоугольником
   вдвое выше своей ширины, а буквы читались узкими и вытянутыми.

   Держим одинаковую плотность по обеим осям: 512 / 0.4965 ≈ 1031, берём
   1024 — степень двойки, видеопамяти дружелюбнее, ошибка 0.7%. */
const W = 1536, H = 1024;

/* Какая панель лицевая. Иконка печатается только на ней: у настоящей банки
   лицо одно, а рисовать её на всех трёх — значит показывать две иконки
   разом на скруглении, что и выглядело странно. Остальные панели несут
   шапку и тикер, поэтому пустого бока всё равно не бывает. */
const FRONT_PANEL = 0;

/* =========================================================================
   ЦВЕТА БЕРУТСЯ ИЗ ТЕМЫ, А НЕ ВПИСАНЫ

   Тем на сайте пятнадцать, и акцент у каждой свой. Вписанный сюда жёлтый
   держался ровно до первой смены темы: на зелёном сайте банки светились
   чужим цветом, и это выглядело как чужая картинка, вставленная в макет.

   Читаем те же переменные, что и вёрстка. Значения снимаются на каждой
   отрисовке холста: тему переключают на живой странице, и закешированная
   палитра пережила бы переключение.
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

/* Какая доля этикетки остаётся на виду.

   Банка стоит в упаковке, и картонная обхватка закрывает ей низ. Считаем,
   что именно она закрывает: прямая стенка тянется от y = −0.45 до +0.41
   в системе банки, верх обхватки — на −0.14. Значит снизу съедается
   (−0.14 + 0.45) / 0.86 = 0.36 высоты этикетки.

   Весь рисунок поэтому живёт в верхних 62%. Раньше он занимал всю площадь,
   и картон резал тикеры ровно пополам — на упаковке от PIPEDOG читалось
   «PIPEDO». Ниже этой черты остаётся только фон: рисовать туда нечего. */
const PANEL_U = 0.62;

/* Толщина крайних полос холста — цвет плеча и донышка. Там у настоящей
   банки голый металл, рисунок туда не заходит. Тон берём из темы
   (--color-ink-2): тёмный, но не чёрный — в чёрном горлышко проваливается
   и банка теряет форму. */
const SHOULDER_PX = 6;

const DISP = '"Archivo", system-ui, sans-serif';
const MONO = '"Azeret Mono", ui-monospace, monospace';

/* =========================================================================
   ИКОНКИ ТОКЕНОВ

   Иконки лежат на cdn.dexscreener.com, и CDN отдаёт их БЕЗ заголовка
   access-control-allow-origin — проверено запросом. Для <img> это неважно,
   но холст, куда такую картинку нарисовали, становится испорченным
   (tainted), и WebGL отказывается брать из него текстуру: страница падает
   на ровном месте. Поэтому всё идёт через наш /api/icon, который тот же
   байт-в-байт файл отдаёт со своим CORS.

   Промах не должен ронять первый экран: не загрузилась иконка — рисуем
   заглушку с первой буквой тикера и живём дальше.
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

/* Межбуквенное расстояние canvas не умеет — вручную. */
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

/* Иконка квадратом со скруглением — как на карточках корзины на странице.
   Одна форма во всех местах сайта: круг здесь и квадрат там читались бы
   разными сущностями. */
function drawIcon(g, img, x, y, size, ticker, P) {
  const r = size * .22;
  g.save();
  roundRect(g, x, y, size, size, r);
  g.clip();
  if (img) {
    g.drawImage(img, x, y, size, size);
  } else {
    // Заглушка: буква тикера. Пустой квадрат читался бы дырой в этикетке.
    g.fillStyle = P.BLOCK; g.fillRect(x, y, size, size);
    g.fillStyle = P.NEON; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${size * .52}px ${DISP}`;
    g.fillText((ticker || '?')[0].toUpperCase(), x + size / 2, y + size / 2);
    g.textBaseline = 'alphabetic';
  }
  g.restore();
  // Кант: без него тёмная иконка сливается с тёмной банкой.
  g.strokeStyle = 'rgba(255,255,255,.22)';
  g.lineWidth = Math.max(1, size * .018);
  roundRect(g, x, y, size, size, r);
  g.stroke();
}

/* Одна панель этикетки. Координаты в долях, чтобы можно было поднять
   разрешение холста под ретину, ничего не переписывая. */
function panel(g, x, w, hFull, seat, P, isFront) {
  const cx = x + w / 2;
  const m = w * .085;
  const h = hFull * PANEL_U;              // рисуем только в видимой части

  g.strokeStyle = 'rgba(255,255,255,.13)';
  g.lineWidth = Math.max(1, w * .004);
  // Рамка уходит вниз за обхватку: обрезанная картоном, она читается как
  // продолжение печати под упаковкой, а замкнутая снизу — как наклейка.
  g.strokeRect(x + m, h * .10, w - m * 2, hFull);

  // --- шапка: имя индекса и номер места ---
  g.fillStyle = P.DIM; g.font = `500 ${w * .038}px ${MONO}`;
  g.textAlign = 'left';
  tracked(g, '6PACK INDEX', x + m + w * .030, h * .215, w * .011, 'left');
  g.textAlign = 'right'; g.fillStyle = P.NEON;
  tracked(g, String(seat.n).padStart(2, '0'), x + w - m - w * .030, h * .215, w * .011, 'right');

  // --- иконка токена: только на лицевой панели ---
  const isz = w * .40;
  if (isFront) drawIcon(g, seat.iconImg, cx - isz / 2, h * .265, isz, seat.ticker, P);

  // --- тикер ---
  g.textAlign = 'center'; g.fillStyle = P.BONE;
  let px = w * .150;
  g.font = `800 ${px}px ${DISP}`;
  const t = seat.ticker.toUpperCase();
  /* Длинные тикеры вроде STONKBROKER не влезают. Ужимаем шрифт, а НЕ режем
     текст: обрезанный тикер — это уже другой токен. */
  while (g.measureText(t).width > w - m * 2.4 && px > w * .05) {
    px *= .93; g.font = `800 ${px}px ${DISP}`;
  }
  g.fillText(t, cx, h * .845);

  const tw = g.measureText(t).width;
  g.fillStyle = P.NEON;
  g.fillRect(cx - tw / 2, h * .885, tw, Math.max(2, hFull * .008));

  /* Доли и состав отсюда убраны: они попадали ровно под картон. Их место —
     на лице обхватки, где они и напечатаны. */
}

/** Холст этикетки. seat: { n, ticker, iconImg } */
export function labelCanvas(seat, scale = 1) {
  const c = document.createElement('canvas');
  c.width = W * scale; c.height = H * scale;
  const g = c.getContext('2d');
  g.scale(scale, scale);

  /* Фон не плоский: вертикальный градиент даёт банке объём даже там, куда
     не достаёт свет сцены. С плоской заливкой бок читается наклейкой. */
  const P = palette();
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, P.BLOCK); bg.addColorStop(.55, P.INK); bg.addColorStop(1, '#050505');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  const pw = W / PANELS;
  for (let i = 0; i < PANELS; i++) panel(g, i * pw, pw, H, seat, P, i === FRONT_PANEL);

  g.fillStyle = 'rgba(255,255,255,.06)';
  for (let i = 0; i < PANELS; i++) g.fillRect(i * pw, H * .075, 1, H * .85);

  /* Крайние полосы — цвет плеча и донышка. Работают в паре с зажимом края
     в labelTexture: всё выше прямой стенки берёт цвет верхней строки, всё
     ниже — нижней. Без этого текстура заворачивалась и на горлышке
     проступали светлые ленты. */
  g.fillStyle = P.INK2;
  g.fillRect(0, 0, W, SHOULDER_PX);
  g.fillRect(0, H - SHOULDER_PX, W, SHOULDER_PX);

  return c;
}

export function labelTexture(THREE, seat, scale = 1) {
  const t = new THREE.CanvasTexture(labelCanvas(seat, scale));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;          // по кругу — повтор, шов сходится
  t.wrapT = THREE.ClampToEdgeWrapping;     // по высоте — зажим, см. выше
  t.repeat.y = 1 / (1 - WALL_V0);
  t.offset.y = -WALL_V0 / (1 - WALL_V0);
  return t;
}

/* =========================================================================
   ОБЁРТКА УПАКОВКИ

   Настоящий сикспак держится картонной обхваткой по низу банок. Её лицо —
   готовое место под карточку индекса, и это единственная плоская
   поверхность во всей сцене: на цилиндре крупный текст всегда изогнут, а
   заголовок должен читаться прямо.

   Лицо и спина печатаются одинаково — как на настоящей упаковке. Иначе
   половину оборота зритель смотрит на пустой картон.
   ========================================================================= */

/** Лицевая сторона обхватки: карточка индекса. */
export function sleeveFace(seats, { aspect = 3.6, h = 460, scale = 1 } = {}) {
  /* Ширина холста считается из соотношения самой грани, а не задаётся
     числом: иначе текстуру растягивает и печать «плывёт» по ширине. */
  const w = Math.round(h * aspect);
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const g = c.getContext('2d'); g.scale(scale, scale);

  const P = palette();
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, P.BLOCK); bg.addColorStop(1, P.INK);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);

  // Кант по краю — картон имеет толщину, и грань должна её показывать.
  g.strokeStyle = 'rgba(255,255,255,.10)'; g.lineWidth = 3;
  g.strokeRect(22, 22, w - 44, h - 44);

  /* Грань длинная и низкая, поэтому вёрстка в две колонки: слева имя,
     справа состав. В одну колонку заголовок и шесть иконок не помещались
     без того, чтобы всё стало мелким. */
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

  /* Состав — шесть иконок с тикерами. Ровно то, что человек хочет узнать
     про индекс с одного взгляда, и ровно то, что печатают на упаковке. */
  /* Ширина ряда иконок считается от МЕСТА, которое осталось, а не задаётся
     наперёд: при первом заходе ряд начинался фиксированно и наезжал на
     слово 6PACK. Левая колонка уже отрисована, её правый край известен —
     от него и пляшем. */
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

/** Торец обхватки — узкая полоса, на ней помещается только имя. */
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
