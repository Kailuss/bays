/**
 * Protocolo host ↔ webview: la ÚNICA definición de los mensajes que cruzan
 * `postMessage`, importada por ambos lados (extension host y cliente).
 *
 * Reglas:
 * - Solo tipos serializables (cruza postMessage): nada de funciones, URIs ni
 *   instancias. Nada de imports de `vscode` ni de lib DOM — este fichero
 *   compila en los DOS proyectos de TypeScript (tsconfig.json y
 *   tsconfig.webview.json).
 * - Un mensaje nuevo se añade AQUÍ primero; el compilador obliga entonces a
 *   emisor y receptor a cuadrar. Antes el contrato eran strings por convención
 *   y un desajuste descartaba el update en silencio.
 */

import type { IconName } from './icons';

//= MODELO DEL MENÚ CONTEXTUAL

export type MenuSeparator = { type: 'separator' };

export type MenuActionItem = {
  type?: 'item';
  /** Identificador estable que devuelve el webview al elegir el item. */
  id: string;
  label: string;
  /**
   * El glifo de la fila, por su ROL en `shared/icons.ts` y nunca como cadena
   * suelta: un nombre de codicon mal escrito no pinta nada y no lo reporta
   * nadie, así que el tipo es lo que cierra esa puerta antes que el build.
   */
  icon?: IconName;
  keybinding?: string;
  /** `false` lo dibuja atenuado y no seleccionable. */
  enabled?: boolean;
  tooltip?: string;
  submenu?: MenuItem[];
};

/**
 * Un item del menú contextual, tal y como viaja al webview.
 * Serializable a propósito: la acción va como `id` y vuelve por `menuAction`.
 */
export type MenuItem = MenuSeparator | MenuActionItem;

//= HOST → WEBVIEW

export type ShowContextMenuMessage = {
  type: 'showContextMenu';
  bayId: string;
  x: number;
  y: number;
  items: MenuItem[];
};

/** Cambio de bay activa: el cliente alterna la clase `.active` sin rebuild. */
export type UpdateActiveBayMessage = {
  type: 'updateActiveBay';
  activeBayIds: string[];
};

/** Título de webview reescrito en runtime (p.ej. Claude Code). */
export type UpdateBayLabelMessage = {
  type: 'updateBayLabel';
  bayId: string;
  label: string;
};

export type IconPatch = { bayId: string; html: string };

/** Iconos resueltos en diferido tras el primer pintado. */
export type UpdateIconsMessage = {
  type: 'updateIcons';
  icons: IconPatch[];
};

/** El estado de una bay cambió: el cliente redibuja su marca. */

export type BayStateChangedMessage = {
  type: 'bayStateChanged';
  bayId: string;
  /** Ausente: la fila está limpia. */
  state?: BayStateCode;
};

//= EL MODELO DE LA VISTA
//
// Lo que viaja son DATOS y no markup. El host decide QUÉ dice cada fila y el
// cliente decide cómo se dibuja, que es lo que impide que la forma de una fila
// viva en dos sitios a la vez — y lo que permite que un tooltip, una clase de
// animación o una cadena localizada se añadan sin tocar el host.
//
// La única excepción son los ICONOS, y viaja deduplicada: el marcador de un
// tema puede ser un `data:` URI de kilobytes, así que una carpeta con treinta
// ficheros del mismo tipo mandaría treinta copias del mismo SVG. Cada icono
// tiene una CLAVE en `RenderMessage.icons` y las filas la referencian.

/** El estado que una fila reporta, como CÓDIGO. El glifo lo elige el cliente. */
export type BayStateCode =
  | 'error' | 'warning'
  | 'modified' | 'added' | 'deleted' | 'untracked' | 'ignored' | 'conflict'
  | 'dirty';

/** El botón de acción rápida que una fila ofrece según su tipo de fichero. */
export type QuickActionView = {
  actionId : string;
  icon     : IconName;
  tooltip  : string;
};

/** Una variante (un diff, un snapshot, una preview) bajo su parent. */
export type VariantView = {
  id      : string;
  /** Lo que la fila escribe: el tipo de diff, o el label nativo si es huérfana. */
  label   : string;
  icon    : IconName;
  /** La clase del tipo de diff, para el color de la fila. */
  diffClass?: string;
  tooltip : string;
  active  : boolean;
  /** Sin parent en la lista: no se indenta y cierra como una bay normal. */
  orphan  : boolean;
  canClose: boolean;
  /** Lo que la variante cuenta de sí misma (+12-3, "hace 2 h", 3 conflictos). */
  stats?  : { text: string; tooltip: string; conflict?: boolean };
};

/** Una fila de la lista. */
export type BayView = {
  id        : string;
  label     : string;
  /** La ruta que va bajo el nombre, ya formateada. Vacía: no se dibuja. */
  detail?   : string;
  /** Los segmentos de esa ruta, para que el cliente la trunque a lo ancho. */
  pathParts?: string[];
  tooltip   : string;
  /** Clave dentro de `RenderMessage.icons`. */
  iconKey   : string;
  active    : boolean;
  pinned    : boolean;
  groupId   : number;
  state?    : BayStateCode;
  canClose  : boolean;
  /** El botón de chat solo se ofrece con Copilot disponible y con uri. */
  canChat   : boolean;
  quickAction?: QuickActionView;
  variants  : VariantView[];
  /**
   * El bloque NO dibuja fila de parent: lo que se ve es su única variante.
   *
   * Es una variante cuyo parent no está en esta lista (el fichero se cerró, o
   * vive en otro grupo). Sigue SIENDO una variante —misma fila compacta, mismo
   * icono y color de diff— y por eso no se dibuja como una bay normal: así una
   * variante recién abierta no aparenta ser un parent.
   */
  variantOnly?: boolean;
};

/** La cabecera de un grupo de editores. */
export type GroupView = {
  id      : number;
  label   : string;
  color   : BayGroupColor;
  locked  : boolean;
};

/** Uno de los colores con los que se tiñe un grupo. */
export type BayGroupColor = 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'purple';

/**
 * Un grupo con sus filas. Con un solo grupo no hay cabecera ni acento de color:
 * no hay nada de lo que distinguirlo, y por eso `header` es opcional.
 */
export type GroupSection = {
  header?: GroupView;
  bays   : BayView[];
};

/**
 * La lista entera, para reconciliar.
 *
 * Sustituye a reasignar `webview.html`, que destruía el documento —y con él el
 * scroll, el foco, los grupos plegados, el bundle del cliente, el CSS y el
 * `@font-face` del tema— en cada cambio estructural.
 */
export type RenderMessage = {
  type    : 'render';
  sections: GroupSection[];
  /** clave → HTML del icono. Deduplicado: ver arriba. */
  icons   : Record<string, string>;
  /** Drag & drop encendido: el cliente lo arma perezosamente la primera vez. */
  enableDragDrop: boolean;
  /** Modo compacto: nombre y ruta en una línea. */
  compact : boolean;
  /** Dibujar la ruta bajo el nombre. */
  showPath: boolean;
  /**
   * Cuánto descansa el puntero antes de que salga un tooltip. Es el propio
   * `workbench.hover.delay`, LEÍDO y no duplicado como un ajuste nuestro: un
   * webview no alcanza la configuración, así que viaja.
   */
  hoverDelay: number;
  /**
   * Si la vista se mueve. Funde `bays.animations` con `workbench.reduceMotion`,
   * y cualquiera de los dos la para (ver `utils/settingsRules.ts`).
   */
  motion  : boolean;
};

/**
 * El `@font-face` de un tema de iconos basado en fuente, con el fichero dentro
 * como `data:` URI.
 *
 * Viaja por mensaje y no en el `<head>` porque leer esa fuente es I/O de disco:
 * ponerla en el shell dejaría el panel en blanco hasta tenerla, y el tema casi
 * nunca está leído cuando se resuelve la vista. Cadena vacía en los temas SVG.
 */
export type ThemeFontMessage = {
  type : 'themeFont';
  css  : string;
};

/**
 * El tema de iconos de PRODUCTO, como una regla por cada codicon que redefine.
 *
 * Va a un `<style>` propio y no al del tema de ficheros, que es lo que impide
 * que se pisen: aquél se REASIGNA entero en cada cambio de tema de iconos, así
 * que dos escritores sobre el mismo se turnarían borrándose. Y ese elemento va
 * DETRÁS de los `<link>` del shell: las dos reglas empatan en especificidad
 * (`.codicon-x::before`), así que gana la escrita más tarde, y eso es lo que
 * hace que un id del que el pack no diga nada se quede con el codicon que la
 * extensión trae.
 *
 * Cadena vacía: sin pack, con uno ilegible, o con el interruptor apagado.
 */
export type ProductIconsMessage = {
  type : 'productIcons';
  css  : string;
};

export type HostToWebviewMessage =
  | ShowContextMenuMessage
  | UpdateActiveBayMessage
  | UpdateBayLabelMessage
  | UpdateIconsMessage
  | BayStateChangedMessage
  | RenderMessage
  | ThemeFontMessage
  | ProductIconsMessage;

/**
 * Quién ESCUCHA cada mensaje del host.
 *
 * El cliente no tiene despacho central: son `if` independientes dentro de un
 * `addEventListener('message')`, así que una variante añadida a la unión de
 * arriba **compila sin que la escuche nadie** y la feature no hace nada, en
 * silencio. Un `Record` sobre la unión obliga a NOMBRAR su oyente en el mismo
 * fichero donde se añade la variante.
 *
 * Comprueba que se ha nombrado, no que funcione. Pero nombrarlo es el paso que
 * se saltaba.
 */
export const WEBVIEW_MESSAGE_LISTENERS: Record<HostToWebviewMessage['type'], string> = {
  showContextMenu : 'webview/interactions.ts',
  updateActiveBay : 'webview/interactions.ts',
  updateBayLabel  : 'webview/interactions.ts',
  updateIcons     : 'webview/interactions.ts',
  bayStateChanged : 'webview/interactions.ts',
  render          : 'webview/interactions.ts',
  themeFont       : 'webview/interactions.ts',
  productIcons    : 'webview/interactions.ts',
};

//= WEBVIEW → HOST

/**
 * El cliente ha cargado y está escuchando.
 *
 * Es su PRIMERA sentencia, antes de montar nada: un mensaje enviado a un webview
 * que todavía no ha registrado su listener se PIERDE, así que el primer pintado
 * tiene que colgar de aquí y no del momento en que el host asigna el shell.
 */
export type ReadyMessage        = { type: 'ready' };

export type OpenBayMessage      = { type: 'openBay'; bayId: string };
export type CloseBayMessage     = { type: 'closeBay'; bayId: string };
export type CloseVariantMessage = { type: 'closeVariant'; bayId: string };
export type AddToChatMessage    = { type: 'addToChat'; bayId: string };

/** Clic derecho: el host responde con `showContextMenu` (solo él sabe los items). */
export type ContextMenuRequestMessage = {
  type: 'contextMenu';
  bayId: string;
  x: number;
  y: number;
};

/** Item del menú elegido; `actionId` es el `MenuActionItem.id`. */
export type MenuActionMessage = {
  type: 'menuAction';
  bayId: string;
  actionId: string;
};

export type FileActionMessage = {
  type: 'fileAction';
  bayId: string;
  actionId: string;
};

/**
 * Drop de un drag & drop. Reorden local: `targetBayId` + `insertPosition`.
 * Movimiento entre grupos: ambos a null y grupos origen/destino distintos.
 */
export type DropBayMessage = {
  type: 'dropBay';
  sourceBayId: string;
  targetBayId: string | null;
  insertPosition: 'before' | 'after' | null;
  sourceGroupId: number;
  targetGroupId: number;
};

export type RenameGroupMessage     = { type: 'renameGroup'; groupId: number };
export type SetGroupColorMessage   = { type: 'setGroupColor'; groupId: number };
export type ToggleGroupLockMessage = { type: 'toggleGroupLock'; groupId: number };

export type WebviewToHostMessage =
  | ReadyMessage
  | OpenBayMessage
  | CloseBayMessage
  | CloseVariantMessage
  | AddToChatMessage
  | ContextMenuRequestMessage
  | MenuActionMessage
  | FileActionMessage
  | DropBayMessage
  | RenameGroupMessage
  | SetGroupColorMessage
  | ToggleGroupLockMessage;
