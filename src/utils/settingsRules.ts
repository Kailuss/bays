// Los ajustes que llegan del usuario, normalizados.
//
// Puro y con tests porque lo que se lee de la configuración no tiene tipo: un
// `get` devuelve lo que haya escrito en el settings.json, y ahí puede haber una
// cadena donde se espera un número o un valor que el enum no nombra. Lo que cada
// regla de aquí afirma es que lo que sale es utilizable, y en qué dirección
// falla cuando lo que entra no lo es.

/**
 * El defecto del propio workbench para `workbench.hover.delay`.
 *
 * Se declara aquí y en ningún otro sitio: el cliente lleva el mismo número como
 * valor de partida para el instante anterior al primer mensaje, y dos copias de
 * una misma espera son dos respuestas esperando a separarse.
 */
export const HOVER_DELAY_MS = 500;

/**
 * Cuánto descansa el puntero antes de que salga un tooltip.
 *
 * Se LEE del workbench en vez de duplicarse como un ajuste nuestro: dos números
 * para una misma espera serían esta vista contradiciendo en voz baja una
 * respuesta que el usuario ya ha dado.
 *
 * Se acota por los dos extremos. Un valor negativo o absurdo no es una
 * preferencia sino un settings.json roto, y lo que costaría honrarlo es un tip
 * que sale con cada píxel que cruza el puntero, o uno que no sale nunca.
 */
export function parseHoverDelay(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) { return HOVER_DELAY_MS; }
  return Math.min(Math.max(Math.round(value), 0), 5000);
}

/**
 * Si la vista se MUEVE, fundiendo las dos respuestas que lo deciden.
 *
 * Son dos entradas a un mismo hecho y cualquiera de las dos vale para pararlo:
 * `bays.animations`, que es el interruptor maestro de esta vista, y
 * `workbench.reduceMotion`, que es la respuesta del workbench a la misma
 * pregunta.
 *
 * La media query `prefers-reduced-motion` NO se mira, y ésa es la parte
 * deliberada: reporta el SISTEMA, y esa bandera se enciende por motivos que no
 * tienen nada que ver con este panel — una máquina configurada para menos
 * animación en todo, una sesión de escritorio remoto que la fuerza. Aterrizando
 * aquí pararía la vista sin que nada en pantalla dijera por qué, y la única
 * vuelta atrás estaría en otra aplicación. La pregunta se le hace al workbench,
 * que es donde está el usuario: solo un `on` explícito para algo, y `auto` —el
 * defecto, o sea casi todo el mundo— SE MUEVE.
 */
export function parseMotion(animations: unknown, reduceMotion: unknown): boolean {
  if (animations === false) { return false; }
  return reduceMotion !== 'on';
}
