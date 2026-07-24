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

//= MODELO DEL MENÚ CONTEXTUAL

export type MenuSeparator = { type: 'separator' };

export type MenuActionItem = {
  type?: 'item';
  /** Identificador estable que devuelve el webview al elegir el item. */
  id: string;
  label: string;
  /** Nombre de codicon, sin el prefijo `codicon-`. */
  icon?: string;
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

/** Cambio de estado git/diagnóstico de una bay concreta. */
export type BayStateChangedMessage = {
  type: 'bayStateChanged';
  bayId: string;
  stateClass: string;
  stateHtml: string;
};

export type HostToWebviewMessage =
  | ShowContextMenuMessage
  | UpdateActiveBayMessage
  | UpdateBayLabelMessage
  | UpdateIconsMessage
  | BayStateChangedMessage;

//= WEBVIEW → HOST

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
