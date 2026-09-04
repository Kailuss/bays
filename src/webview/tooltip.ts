// Los tooltips de la vista, dibujados aquí en vez de dejados al atributo
// `title`.
//
// Un `title` es el tooltip del SISTEMA: tarda lo suyo en salir, lo pinta la
// plataforma con sus propios colores y no sabe nada del tema, así que al lado de
// los hovers del workbench se lee como algo de otro programa. VS Code no lo usa
// en ninguna parte de su UI por lo mismo, y el menú contextual de esta vista es
// una réplica por una razón de la misma familia.
//
// Lo que lleva tip lleva `data-tip`; nada lleva ya `title`, o saldrían los dos
// uno encima del otro. El nombre accesible no es trabajo de este atributo:
// `aria-label` es lo que lo dice.

/** El elemento bajo el puntero que lleva tip. */
const SELECTOR = '[data-tip]';

/**
 * Cuánto tiene que descansar el puntero antes de que salga el tip: el propio
 * `workbench.hover.delay` de VS Code, que es lo que hace que los dos se sientan
 * como una sola UI. Con uno más corto, pasar el puntero por una fila de botones
 * enciende cinco tips seguidos.
 *
 * Se LEE y no se duplica como un ajuste nuestro, el mismo trato que reciben las
 * confirmaciones del explorador: dos números para una misma espera serían esta
 * vista contradiciendo en voz baja una respuesta que el usuario ya ha dado. Un
 * webview no alcanza la configuración, así que llega en el render.
 *
 * El valor inicial es el defecto del propio workbench, que es lo que gobierna
 * durante el instante anterior a ese mensaje.
 */
let delayMs = 500;

export function setTipDelay(ms: number): void {
  delayMs = ms;
}

/** Aire entre el elemento y su tip, y entre el tip y el borde del panel. */
const GAP = 4;

let tipEl: HTMLElement | null = null;
let anchor: HTMLElement | null = null;
let timer: number | null = null;

/**
 * Le da a un elemento su tip, o se lo quita cuando no hay nada que decir.
 *
 * Vacío significa NINGUNO, y el atributo se va: dejado puesto seguiría siendo un
 * blanco de hover, y el tip saldría como una caja en blanco.
 */
export function setTip(el: HTMLElement, text: string): void {
  if (text) {
    el.dataset.tip = text;
  } else {
    delete el.dataset.tip;
  }
}

/**
 * Un tip que solo REPITE el texto del propio elemento: se enseña cuando ese
 * texto está recortado y en ningún otro momento.
 *
 * Con el nombre entero a la vista, el tip no dice nada que la fila no diga ya, y
 * una caja saliendo sobre cada fila por la que pasa el puntero se lee como ruido
 * y no como ayuda.
 *
 * `selector` nombra al descendiente que lleva la elipsis, y se MIDE cuando el
 * tip toca y no aquí: qué cabe cambia con cada redimensionado.
 */
export function setOverflowTip(el: HTMLElement, text: string, selector: string): void {
  setTip(el, text);
  if (text) {
    el.dataset.tipOverflow = selector;
  } else {
    delete el.dataset.tipOverflow;
  }
}

export function initTooltips(): void {
  // Delegado en el documento: las filas van y vienen con cada reconciliación, y
  // un listener por elemento sería uno que hay que soltar en cada una.
  document.addEventListener('mouseover', onOver);
  document.addEventListener('mouseout', onOut);
  // El teclado llega a los mismos botones con Tab, y ahí el tip es lo único que
  // los nombra: son iconos.
  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', hide);

  // Todo lo que significa que el usuario se ha ido a otra cosa lo baja en el
  // acto, sin gracia ninguna: un tip flotando sobre un menú que acaba de abrirse
  // se lee como un panel colgado.
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('keydown', hide, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
}

/**
 * Baja el tip si el elemento del que cuelga ya no está en el documento.
 *
 * La lista se reconcilia por clave, así que un bloque sustituido se lleva su
 * ancla por delante y el tip se quedaría flotando sobre donde estuvo.
 */
export function hideOrphanedTip(): void {
  if (anchor && !anchor.isConnected) { hide(); }
}

function onOver(e: MouseEvent): void {
  const target = (e.target as HTMLElement | null)?.closest?.(SELECTOR) as HTMLElement | null;
  if (!target || target === anchor) { return; }
  schedule(target);
}

function onOut(e: MouseEvent): void {
  const target = (e.target as HTMLElement | null)?.closest?.(SELECTOR);
  if (!target || target !== anchor) { return; }
  // Sigue dentro del ancla, solo que sobre otro de sus hijos: `mouseout` salta
  // también al cruzar esa frontera, y esconderlo ahí reinicia la espera entera
  // — un tip que parpadea mientras el puntero recorre la fila que describe, y
  // que no llega a salir nunca si el puntero sigue moviéndose.
  if (anchor.contains(e.relatedTarget as Node | null)) { return; }
  hide();
}

/**
 * Solo un aterrizaje del TECLADO, nunca un clic: `focusin` salta también al
 * pulsar un botón con el ratón, y un tip que aparece bajo el puntero justo
 * después de pulsar tapa lo que se acaba de hacer.
 */
function onFocus(e: FocusEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target?.matches?.(`${SELECTOR}:focus-visible`)) { return; }
  schedule(target);
}

function schedule(target: HTMLElement): void {
  hide();
  anchor = target;
  timer = window.setTimeout(() => show(target), delayMs);
}

function show(target: HTMLElement): void {
  const text = target.dataset.tip ?? '';
  // Puede haberse ido mientras corría el temporizador: una fila sustituida por
  // la reconciliación, un tip vaciado.
  if (!text || !target.isConnected) { hide(); return; }

  // Un tip redundante (ver `setOverflowTip`) se gana su sitio solo cuando el
  // texto que repite está cortado. Se mide AHORA y no cuando se puso: el panel
  // se arrastra, y estar truncado es un hecho del ancho de ahora mismo.
  const overflow = target.dataset.tipOverflow;
  if (overflow !== undefined && !isTruncated(target, overflow)) { hide(); return; }

  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'bays-tip';
    tipEl.setAttribute('role', 'tooltip');
    // Es una copia de lo que el `aria-label` ya dice: anunciarlo otra vez leería
    // el botón dos veces.
    tipEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tipEl);
  }

  tipEl.textContent = text;

  // Se coloca ANTES de enseñarlo: medirlo mientras solo está en
  // `visibility: hidden` da su tamaño de verdad, y enseñarlo primero lo pintaría
  // un frame donde estuviera el anterior.
  place(tipEl, target);
  tipEl.classList.add('visible');
}

/** ¿El elemento que nombra el selector enseña menos de lo que dice? */
function isTruncated(target: HTMLElement, selector: string): boolean {
  const el = selector ? target.querySelector<HTMLElement>(selector) : target;
  return !!el && el.scrollWidth > el.clientWidth;
}

/**
 * Debajo del elemento y alineado con su borde izquierdo, que es donde los pone
 * el workbench; encima cuando no cabe debajo, y corrido a la izquierda cuando el
 * borde derecho del panel está más cerca de lo que el tip mide de ancho.
 *
 * `position: fixed` y acotado al panel: esta vista mide unos cientos de píxeles,
 * así que un tip anclado a un botón del extremo derecho se saldría, y aquí no
 * hay ventana a la que desbordar.
 *
 * **La medida se toma desde el borde IZQUIERDO, y eso no es aseo.** Una caja
 * `fixed` sigue maquetándose contra el espacio que su propio `left` le deja:
 * medida donde se colocó el tip ANTERIOR —normalmente contra el borde derecho,
 * porque ahí es donde están los botones de una fila— una línea se plegaba en
 * varias y reportaba el alto de varias, y la colocación esquivaba después un
 * obstáculo que solo existía por dónde se había medido. Aparcarlo en el hueco
 * primero le da el panel entero para ser todo lo ancho que quiera, que es lo que
 * hace que deslizarlo a la izquierda después baste.
 */
function place(tip: HTMLElement, target: HTMLElement): void {
  tip.style.left = `${GAP}px`;
  tip.style.top = `${GAP}px`;

  const rect = target.getBoundingClientRect();
  const box = tip.getBoundingClientRect();

  let top = rect.bottom + GAP;
  if (top + box.height > window.innerHeight - GAP) {
    top = Math.max(GAP, rect.top - box.height - GAP);
  }

  const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - box.width - GAP));

  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(left)}px`;
}

function hide(): void {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  anchor = null;
  tipEl?.classList.remove('visible');
}
