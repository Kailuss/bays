// La barra de scroll de la vista, dibujada encima del contenido.
//
// La nativa está apagada en el CSS porque RESERVA su ancho: la lista acaba diez
// píxeles antes del borde del panel, y ese hueco aparece y desaparece según haya
// bays de sobra o no. Lo que se dibuja en su lugar es un deslizador TENDIDO
// sobre el contenido, que no ocupa nada y que no está cuando no se está
// haciendo scroll, que es lo que hace VS Code en todas sus listas.
//
// El scroller es el DOCUMENTO —la lista es lo único que hay en el panel— así que
// la barra va `position: fixed` y no tiene que viajar con nada: se queda quieta
// en pantalla mientras el contenido pasa por debajo.

/** Lo más corto que se pone el deslizador: por debajo no se puede coger. */
const MIN_THUMB = 20;

/** Cuánto se queda después de que el scroll pare. */
const FADE_MS = 800;

/** Aire contra los bordes del panel. Espeja `--bays-scroll-gap` de la hoja. */
const GAP = 4;

let lane: HTMLElement | null = null;
let thumb: HTMLElement | null = null;
let hideTimer: number | null = null;
let dragging = false;

/** Lo que un frame de la barra necesita. `null` es "no hay nada que enseñar". */
type Geometry = {
  /** Cuánto puede viajar el CONTENIDO, y cuánto el DESLIZADOR. */
  max: number;
  travel: number;
  /** El carril y el deslizador dentro de él. */
  laneHeight: number;
  height: number;
  top: number;
};

function measure(): Geometry | null {
  const doc = document.documentElement;
  const max = doc.scrollHeight - doc.clientHeight;

  // Nada que desplazar. Se pregunta con un margen de un píxel porque el alto del
  // viewport es fraccionario y `clientHeight` no: sin él, una lista que CABE
  // reporta un píxel de desbordamiento y dibuja una barra del alto entero con
  // nada que buscar dentro.
  if (max <= 1) { return null; }

  const laneHeight = doc.clientHeight - GAP * 2;
  const ratio = doc.clientHeight / doc.scrollHeight;
  const height = Math.max(MIN_THUMB, Math.floor(laneHeight * ratio));
  const travel = laneHeight - height;

  // Un deslizador clavado en su sitio se lee como uno que ha dejado de
  // funcionar: sin recorrido, mejor no dibujar nada.
  if (travel <= 0) { return null; }

  const top = Math.round((doc.scrollTop / max) * travel);
  return { max, travel, laneHeight, height, top };
}

function ensure(): void {
  if (lane) { return; }

  lane = document.createElement('div');
  lane.className = 'bays-scrollbar';
  thumb = document.createElement('div');
  thumb.className = 'bays-scrollbar-thumb';
  lane.appendChild(thumb);
  document.body.appendChild(lane);

  thumb.addEventListener('pointerdown', onGrab);
}

/**
 * Redibuja la barra.
 *
 * Solo se ESCRIBE lo que cambia: un scroll mueve la posición del deslizador y
 * casi nunca su alto, y esto corre en cada evento de scroll.
 */
export function updateScrollbar(): void {
  const geometry = measure();
  if (!geometry) {
    lane?.classList.remove('enabled', 'visible');
    return;
  }

  ensure();
  if (!lane || !thumb) { return; }

  lane.classList.add('enabled');
  lane.style.height = `${geometry.laneHeight}px`;

  const height = `${geometry.height}px`;
  const top    = `${geometry.top}px`;
  if (thumb.style.height !== height) { thumb.style.height = height; }
  if (thumb.style.top !== top) { thumb.style.top = top; }
}

/** La enseña, y arma el temporizador que la baja cuando el scroll pare. */
function flash(): void {
  updateScrollbar();
  if (!lane?.classList.contains('enabled')) { return; }

  lane.classList.add('visible');
  if (hideTimer !== null) { clearTimeout(hideTimer); }
  hideTimer = window.setTimeout(() => {
    hideTimer = null;
    // Con el puntero encima o con el deslizador cogido se queda: bajarla ahí
    // sería quitarla justo de debajo de la mano.
    if (!dragging && !lane?.matches(':hover')) { lane?.classList.remove('visible'); }
  }, FADE_MS);
}

/**
 * El arrastre del deslizador.
 *
 * Con captura de puntero: el puntero corre más que el deslizador —éste se mueve
 * una fracción de lo que se mueve la mano— así que sin ella el gesto se cortaría
 * en cuanto lo dejara atrás.
 *
 * Y la proporción se recalcula en CADA movimiento y no se toma una vez al
 * empezar: la lista se reconcilia mientras tanto, así que puede crecer bajo un
 * arrastre ya en marcha, y una proporción de antes recorrería el contenido a la
 * velocidad equivocada durante el resto del gesto.
 */
function onGrab(e: PointerEvent): void {
  // Solo el botón primario: el central es autoscroll y el derecho va de camino
  // a un menú.
  if (e.button !== 0) { return; }
  const geometry = measure();
  if (!geometry) { return; }

  e.preventDefault();
  e.stopPropagation();

  dragging = true;
  document.body.classList.add('scrollbar-dragging');
  const startY = e.clientY;
  const startTop = geometry.top;

  const move = (event: PointerEvent) => {
    const now = measure();
    if (!now) { return; }
    const wanted = Math.min(Math.max(startTop + (event.clientY - startY), 0), now.travel);
    window.scrollTo(0, (wanted / now.travel) * now.max);
  };

  const release = () => {
    dragging = false;
    document.body.classList.remove('scrollbar-dragging');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', release);
    window.removeEventListener('pointercancel', release);
    flash();
  };

  try { thumb?.setPointerCapture(e.pointerId); } catch { /* el gesto sigue por los oyentes de abajo */ }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
}

export function initScrollbar(): void {
  window.addEventListener('scroll', flash, { passive: true });
  window.addEventListener('resize', () => updateScrollbar());

  // Que el CONTENIDO crezca no es un scroll y nadie más se lo diría: la lista se
  // reconcilia por clave, así que una bay abierta cambia el alto sin que se
  // mueva nada.
  const list = document.getElementById('bays');
  if (list && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => updateScrollbar()).observe(list);
  }

  updateScrollbar();
}
