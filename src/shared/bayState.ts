import { ICONS } from './icons';
import type { BayStateCode } from './protocol';

/**
 * Qué se VE de cada estado de una fila.
 *
 * El host decide el código (`utils/stateIndicator.ts`, que es donde vive la
 * precedencia) y esto dice cómo se dibuja. Está en `shared/` porque el tipo del
 * código lo declara el protocolo y los glifos la tabla de iconos, y las tres
 * respuestas sobre un mismo hecho —el glifo, el título y la clase que tiñe el
 * nombre— tienen que vivir en una sola tabla o se separan.
 *
 * Los `title` se dejan en INGLÉS aquí y se traducen donde se dibujan
 * (`webview/rows.ts`): esta tabla la compilan los dos proyectos, y el traductor
 * del cliente no existe en el host. Son además las claves con las que el bundle
 * busca, así que escribirlas aquí es lo que las mantiene idénticas a las dos
 * mitades del `t()`.
 *
 * `nameClass` no es siempre el código: `untracked` tiñe el nombre como añadido y
 * `dirty` como modificado, porque lo que el nombre dice es de qué COLOR está el
 * fichero y no cuál de las nueve preguntas lo puso ahí.
 */
export const BAY_STATES: Record<BayStateCode, { icon: string; title: string; nameClass: string }> = {
  error     : { icon: ICONS.state.error,     title: 'Error',          nameClass: 'error'     },
  warning   : { icon: ICONS.state.warning,   title: 'Warning',        nameClass: 'warning'   },
  modified  : { icon: ICONS.state.modified,  title: 'Modified',       nameClass: 'modified'  },
  added     : { icon: ICONS.state.added,     title: 'Added (Staged)', nameClass: 'added'     },
  deleted   : { icon: ICONS.state.deleted,   title: 'Deleted',        nameClass: 'deleted'   },
  untracked : { icon: ICONS.state.untracked, title: 'Untracked',      nameClass: 'untracked' },
  ignored   : { icon: ICONS.state.ignored,   title: 'Ignored',        nameClass: 'ignored'   },
  conflict  : { icon: ICONS.state.conflict,  title: 'Conflict',       nameClass: 'conflict'  },
  dirty     : { icon: ICONS.state.dirty,     title: 'Unsaved',        nameClass: 'modified'  },
};
