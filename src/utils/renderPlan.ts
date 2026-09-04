// Qué hay que hacer con cada bloque de la lista, como REGLA PURA.
//
// El paseo por el DOM se queda en `webview/render.ts`, que es lo que de verdad
// necesita un documento; lo que se decide antes de tocarlo —qué se va, qué se
// deja en paz y qué se sustituye— es aritmética sobre dos listas de claves, y
// separada se puede fijar con tests que corren sin navegador.
//
// La distinción que importa es `keep` contra `replace`: un bloque que se DEJA en
// paz conserva su foco, su clase de plegado y cualquier animación en curso, y
// ésa es toda la ganancia de reconciliar en vez de reconstruir. Un plan que
// devolviera `replace` de más seguiría pintando bien y perdería justo eso, sin
// que nada lo reportara.

/**
 * Un bloque, identificado por su CLAVE y descrito por una FIRMA.
 *
 * Qué sea la firma no es asunto de este módulo: solo la compara. El cliente usa
 * el JSON del modelo de la fila más los dos ajustes que cambian cómo se dibuja,
 * así que dos firmas iguales significan que el bloque saldría idéntico.
 */
export type KeyedItem = { key: string; signature: string };

export type BlockAction = { key: string; op: 'keep' | 'replace' | 'insert' };

export type RenderPlan = {
  /** Claves pintadas que la lista nueva ya no lleva. */
  remove: string[];
  /** Qué hacer con cada bloque de la lista nueva, EN ORDEN. */
  actions: BlockAction[];
};

/**
 * @param painted clave → firma de lo que hay pintado ahora mismo.
 * @param items la lista nueva, en el orden en que va.
 */
export function planRender(painted: ReadonlyMap<string, string>, items: KeyedItem[]): RenderPlan {
  const incoming = new Set(items.map(item => item.key));

  const remove: string[] = [];
  for (const key of painted.keys()) {
    if (!incoming.has(key)) { remove.push(key); }
  }

  const actions: BlockAction[] = items.map(item => {
    const current = painted.get(item.key);
    if (current === undefined)        { return { key: item.key, op: 'insert' as const }; }
    if (current === item.signature)   { return { key: item.key, op: 'keep' as const }; }
    return { key: item.key, op: 'replace' as const };
  });

  return { remove, actions };
}

/**
 * La clave del bloque con el que se dibuja una lista VACÍA.
 *
 * Lleva clave propia a propósito: así entra y sale por el mismo camino que los
 * demás, en vez de ser un estado aparte que alguien tenga que acordarse de
 * limpiar cuando vuelve a haber filas.
 */
export const EMPTY_KEY = 'empty';

/** La lista que de verdad se pinta: la de verdad, o el bloque de vacío. */
export function itemsToPaint(items: KeyedItem[]): KeyedItem[] {
  return items.length > 0 ? items : [{ key: EMPTY_KEY, signature: EMPTY_KEY }];
}
