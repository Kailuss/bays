/**
 * TODOS los codicons que dibuja la vista, nombrados por lo que DICEN y no por su
 * forma.
 *
 * Está en `shared/` porque los dos lados dibujan los mismos hechos: el host
 * compone el menú contextual y las filas, y el cliente pinta el chevrón del
 * plegado y la marca de un submenú. Antes de la tabla ya habían discrepado (el
 * plegado se escribía dos veces, una en el renderer y otra en `interactions.ts`).
 *
 * Va por ROL y nunca por forma: `state.untracked` y `state.added` son los dos
 * `diff-added`, y son dos hechos distintos sobre un fichero. Escrita por forma,
 * cambiar uno cambiaría el otro.
 *
 * Un nombre de codicon es una cadena, y `codicon.css` no lleva regla para uno que
 * no conoce: mal escrito no pinta NADA, con el type-check, el lint y el build en
 * verde. Por eso `esbuild.js` comprueba que cada valor de aquí exista en el
 * `codicon.css` que se copia al lado, y que la vista no deletree ningún glifo
 * fuera de esta tabla.
 */

export const ICONS = {
  /** Lo que una fila dice de su fichero. */
  state: {
    error     : 'error',
    warning   : 'warning',
    modified  : 'diff-modified',
    added     : 'diff-added',
    deleted   : 'diff-removed',
    untracked : 'diff-added',
    ignored   : 'circle-slash',
    conflict  : 'diff-ignored',
    dirty     : 'close-dirty',
  },

  /** Los controles de una fila. */
  row: {
    pinned : 'pinned',
    chat   : 'attach',
    close  : 'remove-close',
    /** La X de una variante: la fila es más estrecha y la marca más ligera. */
    closeVariant : 'close',
  },

  /** La cabecera de un grupo de editores. */
  group: {
    expanded  : 'chevron-down',
    collapsed : 'chevron-right',
    rename    : 'edit',
    color     : 'symbol-color',
    /** El candado REPORTA además de alternar: bloqueado se queda a la vista. */
    locked    : 'lock',
    unlocked  : 'unlock',
  },

  /** Una variante cuyo tipo de diff no se ha podido clasificar. */
  variant: {
    generic : 'diff',
  },

  /** El menú contextual propio: su mobiliario y sus órdenes. */
  menu: {
    submenu : 'chevron-right',

    close        : 'close',
    /** Cerrar VARIAS: el plural se dibuja, no se deduce del rótulo. */
    closeMany    : 'close-all',
    pin          : 'pinned',
    unpin        : 'pin',
    revealInView : 'files',
    revealInOs   : 'folder-opened',
    timeline     : 'history',
    copyRelative : 'clippy',
    copyPath     : 'copy',
    duplicate    : 'files',
    compare      : 'diff',
    changes      : 'git-compare',
    split        : 'split-horizontal',
    newWindow    : 'multiple-windows',
    chat         : 'attach',
  },

  /** Los repliegues cuando el tema de iconos no ofrece nada utilizable. */
  theme: {
    file : 'file',
  },
} as const;

/**
 * Los nombres que la tabla lleva. Todo campo que reciba un glifo se declara con
 * este tipo, así que un nombre que la tabla no tenga no llega al DOM.
 */
export type IconName =
  | (typeof ICONS)['state'][keyof (typeof ICONS)['state']]
  | (typeof ICONS)['row'][keyof (typeof ICONS)['row']]
  | (typeof ICONS)['group'][keyof (typeof ICONS)['group']]
  | (typeof ICONS)['variant'][keyof (typeof ICONS)['variant']]
  | (typeof ICONS)['menu'][keyof (typeof ICONS)['menu']]
  | (typeof ICONS)['theme'][keyof (typeof ICONS)['theme']];
