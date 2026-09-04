// La reconciliación de la lista, por CLAVE.
//
// Sustituye a reasignar `webview.html`, que era como se pintaba cualquier cambio
// estructural: abrir una pestaña, cerrarla, fijarla. Aquello destruía el
// documento entero y con él el scroll, el foco, los grupos plegados, el bundle
// del cliente, las hojas de estilo y el `@font-face` del tema en base64, y cada
// una de esas pérdidas costaba después su propia restauración.
//
// Aquí un bloque cuya FIRMA no ha cambiado no se toca. Ese "no se toca" es toda
// la ganancia: lo que conserva es el foco del teclado, la clase de plegado y
// cualquier animación en curso. Y es el caso corriente, porque el render llega
// con cada reporte de git.
//
// QUÉ se hace con cada bloque lo decide `utils/renderPlan.ts`, que es puro y
// tiene tests. Aquí solo queda el paseo por el DOM.

import type { GroupSection } from '../shared/protocol';
import { planRender, itemsToPaint, EMPTY_KEY } from '../utils/renderPlan';
import type { KeyedItem } from '../utils/renderPlan';
import { buildBayBlock, buildEmpty, buildGroupHeader, setIconDictionary } from './rows';
import type { RowLayout } from './rows';

/** La firma de lo que hay pintado, por clave. Es lo que el plan compara. */
const paintedSignature = new Map<string, string>();
/** El elemento de cada clave. */
const paintedEl = new Map<string, HTMLElement>();

/** Dónde va la lista. Lo declara el shell y no cambia nunca. */
function container(): HTMLElement | null {
  return document.getElementById('bays');
}

/** Lo que hace falta para construir un bloque, si toca construirlo. */
type Buildable = KeyedItem & { build: () => HTMLElement };

/**
 * Los bloques de una lista, cada uno con su firma y con cómo se construiría.
 *
 * El constructor va como CALLBACK y no como un elemento ya hecho: la mayoría de
 * los bloques de un render no cambian, y construirlos todos para tirar los que
 * se dejan en paz sería pagar el DOM entero en cada reporte de git.
 */
function buildables(sections: GroupSection[], layout: RowLayout): Buildable[] {
  const out: Buildable[] = [];

  for (const section of sections) {
    const header = section.header;
    if (header) {
      out.push({
        key      : `group:${header.id}`,
        signature: JSON.stringify(header),
        build    : () => buildGroupHeader(header),
      });
    }
    for (const bay of section.bays) {
      out.push({
        key      : `bay:${bay.id}`,
        // La firma lleva el color del grupo y los dos ajustes de disposición
        // además del modelo: los tres cambian lo que la fila dibuja sin cambiar
        // nada de la bay, y sin ellos un cambio de color o del modo compacto
        // dejaría los bloques intactos.
        signature: JSON.stringify([bay, header?.color, layout]),
        build    : () => buildBayBlock(bay, layout, header?.color),
      });
    }
  }

  return out;
}

/**
 * Aplica la lista.
 *
 * @returns si el DOM se ha tocado de verdad. Lo mira quien tiene que volver a
 *   aplicar lo que vive SOLO en el DOM (el plegado de un grupo), para no pagar
 *   esa pasada cuando no ha cambiado nada.
 */
export function applyRender(
  sections: GroupSection[],
  icons: Record<string, string>,
  layout: RowLayout,
): boolean {
  const root = container();
  if (!root) { return false; }

  // El diccionario se pone ANTES de construir nada: es de donde cada fila saca
  // el markup de su icono.
  setIconDictionary(icons);

  const wanted = itemsToPaint(buildables(sections, layout));
  const plan   = planRender(paintedSignature, wanted);
  const byKey  = new Map(wanted.map(item => [item.key, item]));

  let touched = false;

  // Lo que ya no está se va primero: así el recorrido de abajo solo inserta y
  // mueve, y no queda nada en `root` que la lista nueva no lleve.
  for (const key of plan.remove) {
    paintedEl.get(key)?.remove();
    paintedEl.delete(key);
    paintedSignature.delete(key);
    touched = true;
  }

  let cursor: ChildNode | null = root.firstChild;

  for (const action of plan.actions) {
    const item = byKey.get(action.key) as Buildable | { key: string; signature: string };
    let el: HTMLElement;

    if (action.op === 'keep' && paintedEl.has(action.key)) {
      // Se queda tal cual, con su foco y sus clases.
      el = paintedEl.get(action.key) as HTMLElement;
    } else {
      el = action.key === EMPTY_KEY
        ? buildEmpty()
        : (item as Buildable).build();

      const previous = paintedEl.get(action.key);
      if (previous?.isConnected) {
        // El cursor puede estar apuntando justo al nodo que se va. Sustituirlo
        // lo desconecta, y un `insertBefore` contra un nodo que ya no es hijo
        // lanza NotFoundError: hay que llevarlo al que ocupa ahora esa posición
        // ANTES de tocar el DOM.
        if (cursor === previous) { cursor = el; }
        previous.replaceWith(el);
      }

      paintedEl.set(action.key, el);
      paintedSignature.set(action.key, item.signature);
      touched = true;
    }

    // Colocación: solo se mueve el nodo que no está ya donde toca. Un
    // `insertBefore` sobre un nodo que ya ocupa esa posición lo desconecta y lo
    // vuelve a conectar, y eso se lleva por delante el foco que tuviera dentro.
    if (cursor === el) {
      cursor = el.nextSibling;
    } else {
      root.insertBefore(el, cursor);
      touched = true;
    }
  }

  // Restos de un render anterior que el plan no nombra.
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
    touched = true;
  }

  return touched;
}
