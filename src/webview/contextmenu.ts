// Réplica del menú contextual nativo de VS Code (monaco-menu) para el webview.
//
// El webview no puede abrir el menú nativo de VS Code (`showQuickPick` aparece
// centrado arriba, no bajo el cursor), así que este módulo lo reproduce: mismos
// tokens de color del tema, mismas medidas, misma navegación por teclado.
//
// Uso:
//   BaysContextMenu.show({
//     x, y,                       // coordenadas de viewport (event.clientX/Y)
//     items: [
//       { id: 'close', label: 'Close', icon: 'close', keybinding: 'Ctrl+W' },
//       { type: 'separator' },
//       { label: 'Color', submenu: [ ... ] },
//       { id: 'x', label: 'Unavailable', enabled: false },
//     ],
//     onSelect: (id, item) => { ... },
//   });
//
// Un único menú vivo a la vez: `show()` cierra el anterior.

import type { MenuItem, MenuActionItem, MenuSeparator } from '../shared/protocol';
import { ICONS } from '../shared/icons';
import { setTip } from './tooltip';

export type { MenuItem } from '../shared/protocol';

export type ShowMenuOptions = {
  x?: number;
  y?: number;
  items?: MenuItem[];
  onSelect?: (id: string, item: MenuActionItem) => void;
  selectFirst?: boolean;
};

/** Nodo raíz de un menú, con el estado de navegación colgado del elemento. */
type MenuEl = HTMLDivElement & {
  _items: MenuItem[];
  _itemEls: HTMLElement[];
  _focusIndex: number;
  _depth: number;
  _openerEl?: HTMLElement;
};

type Anchor = { x: number; y: number; flipX?: number; flipY?: number };

/** Retardo antes de abrir un submenú con el ratón, como el menú nativo. */
const SUBMENU_HOVER_DELAY = 250;
/** Margen mínimo con el borde del viewport al posicionar. */
const VIEWPORT_PADDING = 2;
/** Ventana en la que las teclas escritas cuentan como un mismo prefijo. */
const TYPEAHEAD_TIMEOUT = 800;

/** Pila de menús abiertos: [raíz, submenú, subsubmenú, ...]. */
const menus: MenuEl[] = [];
let overlay: HTMLDivElement | null = null;
let onSelect: ShowMenuOptions['onSelect'] | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let previousFocus: Element | null = null;
const typeahead = { prefix: '', at: 0 };

//= MODELO

function isSeparator(item: MenuItem | undefined): item is MenuSeparator {
  return !!item && item.type === 'separator';
}

/**
 * Item accionable y no deshabilitado. Como type guard además le dice al
 * compilador que puede leer `id`/`label`/`icon` (los separadores no los tienen).
 */
function isEnabled(item: MenuItem | undefined): item is MenuActionItem {
  return !!item && item.type !== 'separator' && item.enabled !== false;
}

function hasSubmenu(item: MenuItem | undefined): item is MenuActionItem & { submenu: MenuItem[] } {
  return !!item && item.type !== 'separator' && Array.isArray(item.submenu) && item.submenu.length > 0;
}

//= CONSTRUCCIÓN

// Sólo el primer item de cada grupo (el que abre la lista o el que sigue a un
// separador) dibuja icono, a modo de rótulo de lo que agrupa esas acciones.
// El hueco existe igual en las demás filas para que el texto quede alineado.
function createIconSlot(item: MenuActionItem, isGroupLeader: boolean): HTMLSpanElement {
  const slot = document.createElement('span');
  slot.className = 'bays-menu-item-icon';

  if (isGroupLeader && item.icon) {
    const glyph = document.createElement('span');
    glyph.className = `codicon codicon-${item.icon}`;
    slot.appendChild(glyph);
  }
  return slot;
}

function createItemEl(item: MenuItem, menuEl: MenuEl, isGroupLeader: boolean): HTMLElement {
  if (isSeparator(item)) {
    const sep = document.createElement('div');
    sep.className = 'bays-menu-separator';
    sep.setAttribute('role', 'separator');
    return sep;
  }

  const el = document.createElement('div');
  el.className = 'bays-menu-item';
  el.setAttribute('role', 'menuitem');
  el.tabIndex = -1;

  if (!isEnabled(item)) {
    el.classList.add('disabled');
    el.setAttribute('aria-disabled', 'true');
  }
  el.appendChild(createIconSlot(item, isGroupLeader));

  const label = document.createElement('span');
  label.className = 'bays-menu-item-label';
  label.textContent = item.label || '';
  el.appendChild(label);

  if (item.keybinding) {
    const kb = document.createElement('span');
    kb.className = 'bays-menu-item-keybinding';
    kb.textContent = item.keybinding;
    el.appendChild(kb);
  }

  if (hasSubmenu(item)) {
    el.setAttribute('aria-haspopup', 'true');
    const chevron = document.createElement('span');
    chevron.className = `bays-menu-submenu-indicator codicon codicon-${ICONS.menu.submenu}`;
    el.appendChild(chevron);
  }

  // Por `data-tip` y no por `title`: nada de esta vista usa el tooltip del
  // sistema, y los dos juntos saldrían uno encima del otro.
  if (item.tooltip) { setTip(el, item.tooltip); }

  el.addEventListener('mouseenter', () => {
    focusItem(menuEl, menuEl._items.indexOf(item), { scroll: false });
    scheduleSubmenu(menuEl, el, item);
  });

  el.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    activate(menuEl, el, item);
  });

  return el;
}

function buildMenu(items: MenuItem[], depth: number): MenuEl {
  const menu = document.createElement('div') as MenuEl;
  menu.className = 'bays-menu';
  menu.setAttribute('role', 'menu');
  menu.tabIndex = -1;
  menu.style.zIndex = String(1001 + depth);

  // Guardado en el nodo: la navegación por teclado necesita ir del índice al
  // elemento y al revés sin volver a recorrer el DOM.
  menu._items = items;
  menu._itemEls = [];
  menu._focusIndex = -1;
  menu._depth = depth;

  // Un grupo es el tramo entre separadores: su primer item lleva icono. El
  // arranque de la lista cuenta como principio de grupo, así que el primer
  // item también lo es.
  let leaderPending = true;
  for (const item of items) {
    const isLeader = leaderPending && !isSeparator(item);
    const el = createItemEl(item, menu, isLeader);
    menu._itemEls.push(el);
    menu.appendChild(el);
    leaderPending = isSeparator(item);
  }

  menu.addEventListener('keydown', event => handleKeydown(menu, event));
  menu.addEventListener('contextmenu', event => event.preventDefault());
  return menu;
}

//= POSICIONAMIENTO

/**
 * Coloca un menú dentro del viewport.
 *
 * `x`/`y` es la esquina preferida (arriba-izquierda). Si no cabe, se voltea
 * respecto a `flipX`/`flipY` —el borde opuesto del ancla— igual que el menú
 * nativo, en vez de limitarse a pegarse al borde de la pantalla.
 */
function place(menu: MenuEl, anchor: Anchor): void {
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const maxX = window.innerWidth - VIEWPORT_PADDING;
  const maxY = window.innerHeight - VIEWPORT_PADDING;

  let left = anchor.x;
  if (left + width > maxX) {
    left = anchor.flipX !== undefined ? anchor.flipX - width : maxX - width;
  }
  if (left < VIEWPORT_PADDING) { left = VIEWPORT_PADDING; }

  let top = anchor.y;
  if (top + height > maxY) {
    top = anchor.flipY !== undefined ? anchor.flipY - height : maxY - height;
  }
  if (top < VIEWPORT_PADDING) { top = VIEWPORT_PADDING; }

  menu.style.left = Math.round(left) + 'px';
  menu.style.top = Math.round(top) + 'px';
}

//= FOCO Y NAVEGACIÓN

function focusItem(menu: MenuEl, index: number, options?: { scroll?: boolean }): void {
  const scroll = !options || options.scroll !== false;

  if (menu._focusIndex >= 0 && menu._itemEls[menu._focusIndex]) {
    menu._itemEls[menu._focusIndex].classList.remove('focused');
  }
  menu._focusIndex = index;
  if (index < 0) { return; }

  const el = menu._itemEls[index];
  if (!el) { return; }
  el.classList.add('focused');
  if (scroll && el.scrollIntoView) { el.scrollIntoView({ block: 'nearest' }); }
}

/** Siguiente item seleccionable saltando separadores y deshabilitados. */
function step(menu: MenuEl, from: number, direction: number): number {
  const total = menu._items.length;
  for (let i = 1; i <= total; i++) {
    const index = (from + direction * i + total * i) % total;
    if (isEnabled(menu._items[index])) { return index; }
  }
  return -1;
}

function firstEnabled(menu: MenuEl): number {
  return step(menu, -1, 1);
}

function lastEnabled(menu: MenuEl): number {
  return step(menu, menu._items.length, -1);
}

function handleKeydown(menu: MenuEl, event: KeyboardEvent): void {
  // Sólo el menú más profundo responde: los de debajo siguen en el DOM pero
  // ya no tienen el foco.
  if (menu !== menus[menus.length - 1]) { return; }

  const key = event.key;
  const current = menu._focusIndex;

  if (key === 'ArrowDown') {
    event.preventDefault();
    focusItem(menu, step(menu, current, 1));
  } else if (key === 'ArrowUp') {
    event.preventDefault();
    focusItem(menu, step(menu, current, -1));
  } else if (key === 'Home' || key === 'PageUp') {
    event.preventDefault();
    focusItem(menu, firstEnabled(menu));
  } else if (key === 'End' || key === 'PageDown') {
    event.preventDefault();
    focusItem(menu, lastEnabled(menu));
  } else if (key === 'ArrowRight') {
    event.preventDefault();
    const item = menu._items[current];
    if (hasSubmenu(item)) { openSubmenu(menu, menu._itemEls[current], item, { focus: true }); }
  } else if (key === 'ArrowLeft') {
    event.preventDefault();
    if (menu._depth > 0) { closeTop(); }
  } else if (key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (menu._depth > 0) { closeTop(); } else { hide(); }
  } else if (key === 'Enter' || key === ' ') {
    event.preventDefault();
    const item = menu._items[current];
    if (item) { activate(menu, menu._itemEls[current], item); }
  } else if (key === 'Tab') {
    event.preventDefault();
    hide();
  } else if (key.length === 1) {
    handleTypeahead(menu, key);
  }
}

/** Salto por prefijo escrito: el equivalente accesible de los mnemónicos. */
function handleTypeahead(menu: MenuEl, key: string): void {
  const now = performance.now();
  typeahead.prefix = now - typeahead.at > TYPEAHEAD_TIMEOUT ? key : typeahead.prefix + key;
  typeahead.at = now;

  const prefix = typeahead.prefix.toLowerCase();
  const total = menu._items.length;
  for (let i = 1; i <= total; i++) {
    const index = (menu._focusIndex + i + total) % total;
    const item = menu._items[index];
    if (isEnabled(item) && (item.label || '').toLowerCase().startsWith(prefix)) {
      focusItem(menu, index);
      return;
    }
  }
}

//= SUBMENÚS

function scheduleSubmenu(menu: MenuEl, itemEl: HTMLElement, item: MenuItem): void {
  if (hoverTimer !== null) { clearTimeout(hoverTimer); }

  // Pasar por otro item cierra el submenú que hubiera abierto el anterior,
  // pero sólo cuando el ratón llega a este menú: si el puntero ya está dentro
  // del submenú, `mouseenter` no se dispara aquí.
  hoverTimer = setTimeout(() => {
    closeDeeperThan(menu);
    if (hasSubmenu(item)) { openSubmenu(menu, itemEl, item); }
  }, hasSubmenu(item) ? SUBMENU_HOVER_DELAY : 0);
}

function openSubmenu(menu: MenuEl, itemEl: HTMLElement, item: MenuItem, options?: { focus?: boolean }): void {
  closeDeeperThan(menu);
  if (!hasSubmenu(item) || !itemEl) { return; }

  itemEl.classList.add('expanded');

  const submenu = buildMenu(item.submenu, menu._depth + 1);
  submenu._openerEl = itemEl;
  document.body.appendChild(submenu);
  menus.push(submenu);

  const parentRect = menu.getBoundingClientRect();
  const itemRect = itemEl.getBoundingClientRect();
  // Solape de 1px con el borde del menú padre: así lo dibuja el nativo, y de
  // paso evita el hueco por el que el ratón perdería el submenú.
  place(submenu, {
    x: parentRect.right - 1,
    y: itemRect.top - 4,
    flipX: parentRect.left + 1,
    flipY: itemRect.bottom + 4,
  });

  submenu.focus({ preventScroll: true });
  if (options && options.focus) { focusItem(submenu, firstEnabled(submenu)); }
}

function closeDeeperThan(menu: MenuEl): void {
  while (menus.length > 0 && menus[menus.length - 1]._depth > menu._depth) { closeTop(); }
}

function closeTop(): void {
  const menu = menus.pop();
  if (!menu) { return; }
  if (menu._openerEl) { menu._openerEl.classList.remove('expanded'); }
  menu.remove();

  const parent = menus[menus.length - 1];
  if (parent) { parent.focus({ preventScroll: true }); }
}

//= ACTIVACIÓN

function activate(menu: MenuEl, itemEl: HTMLElement, item: MenuItem): void {
  if (!isEnabled(item)) { return; }

  if (hasSubmenu(item)) {
    openSubmenu(menu, itemEl, item, { focus: true });
    return;
  }

  // El callback corre con el menú ya cerrado: la acción puede reconstruir el
  // DOM entero (un refresh del host) y no debe encontrarse el menú colgando.
  const callback = onSelect;
  hide();
  if (callback) { callback(item.id, item); }
}

//= API PÚBLICA

function show(options: ShowMenuOptions): void {
  hide();

  const items = (options && options.items) || [];
  if (items.length === 0) { return; }

  onSelect = options && typeof options.onSelect === 'function' ? options.onSelect : null;
  previousFocus = document.activeElement;

  overlay = document.createElement('div');
  overlay.className = 'bays-menu-overlay';

  // El descarte va en dos tiempos a propósito. `mousedown` retira los menús
  // —el nativo tampoco espera a que se suelte el botón—, pero la capa sigue
  // puesta hasta el `click` para tragárselo: si se quitara ya, ese click
  // caería sobre la bay que hubiera debajo y la abriría.
  overlay.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
    closeAllMenus();
    // Red de seguridad por si no llega ningún click (el botón se suelta fuera
    // del webview): la capa no puede quedarse bloqueando la vista.
    setTimeout(() => { if (menus.length === 0) { hide(); } }, 300);
  });
  overlay.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    hide();
  });
  overlay.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    hide();
  });
  document.body.appendChild(overlay);

  const menu = buildMenu(items, 0);
  document.body.appendChild(menu);
  menus.push(menu);

  const x = options.x || 0;
  const y = options.y || 0;
  place(menu, { x, y, flipX: x, flipY: y });

  menu.focus({ preventScroll: true });
  if (options.selectFirst) { focusItem(menu, firstEnabled(menu)); }
}

function closeAllMenus(): void {
  if (hoverTimer !== null) { clearTimeout(hoverTimer); }
  hoverTimer = null;
  while (menus.length > 0) { closeTop(); }
}

function hide(): void {
  closeAllMenus();
  if (overlay) { overlay.remove(); overlay = null; }
  onSelect = null;

  if (previousFocus instanceof HTMLElement) { previousFocus.focus({ preventScroll: true }); }
  previousFocus = null;
}

/** Abierto = hay menú o queda capa por retirar. */
function isOpen(): boolean {
  return menus.length > 0 || !!overlay;
}

// El menú está anclado al viewport: si la lista se desplaza o la vista cambia
// de tamaño, la posición deja de significar nada. El nativo también se cierra.
// El scroll interno del propio menú (listas largas, `scrollIntoView` al
// navegar con el teclado) no cuenta: cerraría el menú al recorrerlo.
window.addEventListener('scroll', event => {
  if (!isOpen()) { return; }
  const target = event.target;
  if (target instanceof Element && target.closest('.bays-menu')) { return; }
  hide();
}, true);
window.addEventListener('resize', () => { if (isOpen()) { hide(); } });
window.addEventListener('blur', () => { if (isOpen()) { hide(); } });

export const BaysContextMenu = { show, hide, isOpen };
