// El markup de la lista, construido AQUÍ.
//
// El host manda datos (`GroupSection`, `BayView`, `VariantView`) y este módulo
// decide cómo se dibujan. Antes componía el host las cadenas de HTML y el
// cliente las pegaba, así que la forma de una fila vivía en dos sitios: cambiar
// un tooltip, una clase de animación o una cadena localizada obligaba a tocar la
// capa de servicios del extension host.
//
// Se construye con `document.createElement` y nunca con `innerHTML`, así que no
// hay ningún `esc()` que recordar: un nombre de fichero con `<` es texto porque
// entra por `textContent`. La ÚNICA excepción son los iconos, que llegan como
// HTML deduplicado por clave — es markup que compone el host a partir del tema
// de iconos, y pasa por la lista blanca de `utils/iconHtml.ts`.

import type { BayView, GroupSection, GroupView, VariantView } from '../shared/protocol';
import { BAY_STATES } from '../shared/bayState';
import { ICONS } from '../shared/icons';
import { setTip, setOverflowTip } from './tooltip';
import { t } from './l10n';

/** Los iconos del render actual: clave → HTML. */
let iconDictionary: Record<string, string> = {};

export function setIconDictionary(icons: Record<string, string>): void {
  iconDictionary = icons;
}

/** Cómo se dibuja la lista: lo dicen los dos ajustes que la vista conmuta. */
export type RowLayout = { compact: boolean; showPath: boolean };

//= PIEZAS

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) { node.className = className; }
  return node;
}

/** Un codicon suelto. El nombre sale de `shared/icons.ts`, que el build fija. */
function glyph(name: string): HTMLSpanElement {
  return el('span', `codicon codicon-${name}`);
}

/** Un botón de acción de fila: su glifo, su tooltip y a qué bay apunta. */
function actionButton(action: string, bayId: string, icon: string, label: string): HTMLButtonElement {
  const button = el('button');
  button.dataset.action = action;
  button.dataset.bayId  = bayId;
  // El nombre accesible va en `aria-label` y lo que se lee al sobrevolarlo en
  // `data-tip`: son dos lectores distintos, y un `title` intentaría servir a los
  // dos con el tooltip del sistema.
  button.setAttribute('aria-label', label);
  setTip(button, label);
  button.appendChild(glyph(icon));
  return button;
}

/**
 * El icono de una fila.
 *
 * Es lo único de aquí que entra por `innerHTML`, y solo porque el markup de un
 * icono lo compone el host: puede ser un `<img>` con un `data:` URI del tema, un
 * glifo de su fuente o un SVG de reserva. Lo que impide que eso sea una puerta
 * es que cada valor interpolado pasa por la lista blanca de `utils/iconHtml.ts`.
 */
function iconSlot(key: string): HTMLSpanElement {
  const slot = el('span', 'bay-icon');
  slot.innerHTML = iconDictionary[key] ?? '';
  return slot;
}

/** La marca de estado de una fila, o la ranura vacía que la reserva. */
export function stateSlot(state: BayView['state']): HTMLSpanElement {
  if (!state) { return el('span', 'bay-state clean'); }

  const { icon, title } = BAY_STATES[state];
  const slot = el('span', `bay-state state-${state}`);
  setTip(slot, t(title));
  slot.appendChild(glyph(icon));
  return slot;
}

/** La clase con la que el nombre se tiñe. */
export function nameClassFor(state: BayView['state']): string {
  return state ? ` ${BAY_STATES[state].nameClass}` : '';
}

//= LAS FILAS

function buildBayRow(bay: BayView, layout: RowLayout): HTMLDivElement {
  const row = el('div', `bay${layout.compact ? ' compact' : ''}${bay.active ? ' active' : ''}`);
  row.dataset.bayId = bay.id;
  // La ruta entera, y SOLO cuando el nombre no cabe: con el nombre a la vista el
  // tip no diría nada que la fila no diga ya, y una caja saliendo sobre cada fila
  // por la que pasa el puntero es ruido y no ayuda.
  setOverflowTip(row, bay.tooltip, '.bay-name');

  row.appendChild(iconSlot(bay.iconKey));

  const text = el('div', 'bay-text');

  const name = el('div', `bay-name${nameClassFor(bay.state)}`);
  name.appendChild(document.createTextNode(bay.label));
  if (bay.pinned) {
    const badge = el('span', `pin-badge codicon codicon-${ICONS.row.pinned}`);
    setTip(badge, t('Pinned'));
    name.appendChild(badge);
  }
  text.appendChild(name);

  // La ruta va en su propio nodo, con los segmentos en un atributo: el truncado
  // dinámico (`pathTruncation.ts`) los necesita para recortar por la izquierda.
  if (bay.detail) {
    const path = el('div', layout.compact ? 'bay-path-inline' : 'bay-path');
    path.dataset.pathParts = JSON.stringify(bay.pathParts ?? []);
    path.textContent = bay.detail;
    text.appendChild(path);
  }
  row.appendChild(text);
  row.appendChild(stateSlot(bay.state));

  const actions = el('span', 'bay-actions');
  if (bay.quickAction) {
    const button = actionButton('fileAction', bay.id, bay.quickAction.icon, bay.quickAction.tooltip);
    button.dataset.actionid = bay.quickAction.actionId;
    actions.appendChild(button);
  }
  if (bay.canChat)  { actions.appendChild(actionButton('addToChat', bay.id, ICONS.row.chat, t('Add to Copilot Chat'))); }
  if (bay.canClose) { actions.appendChild(actionButton('closeBay',  bay.id, ICONS.row.close, t('Close'))); }
  row.appendChild(actions);

  return row;
}

function buildVariantRow(variant: VariantView): HTMLDivElement {
  const classes = ['bay', 'variant'];
  if (variant.active) { classes.push('active'); }
  if (variant.diffClass) { classes.push(variant.diffClass); }
  if (variant.orphan) { classes.push('orphan'); }

  const row = el('div', classes.join(' '));
  row.dataset.bayId = variant.id;
  setTip(row, variant.tooltip);

  const icon = el('span', 'bay-icon');
  icon.appendChild(glyph(variant.icon));
  row.appendChild(icon);

  const label = el('span', 'variant-label');
  label.textContent = variant.label;
  row.appendChild(label);

  if (variant.stats) {
    const stats = el('span', `variant-stats${variant.stats.conflict ? ' conflict' : ''}`);
    setTip(stats, variant.stats.tooltip);
    stats.textContent = variant.stats.text;
    row.appendChild(stats);
  }

  const actions = el('span', 'bay-actions');
  if (variant.canClose) {
    // Sin parent no hay jerarquía que preservar: cierre normal.
    const action = variant.orphan ? 'closeBay' : 'closeVariant';
    actions.appendChild(actionButton(action, variant.id, ICONS.row.closeVariant, t('Close variant')));
  }
  row.appendChild(actions);

  return row;
}

/**
 * El bloque de una bay: la unidad del drag & drop, con la fila y sus variantes
 * dentro. El acento de color viaja en el BLOQUE y no en la cabecera, para que
 * las filas se lean como pertenecientes al grupo también al hacer scroll.
 */
export function buildBayBlock(
  bay: BayView,
  layout: RowLayout,
  color: GroupView['color'] | undefined,
): HTMLDivElement {
  const block = el('div', 'bay-block');
  block.dataset.bayId  = bay.id;
  block.dataset.pinned = String(bay.pinned);
  block.dataset.groupid = String(bay.groupId);
  if (color) { block.dataset.groupColor = color; }

  if (bay.variantOnly) {
    block.dataset.variant = 'true';
  } else {
    if (bay.variants.length > 0) { block.classList.add('has-children'); }
    block.appendChild(buildBayRow(bay, layout));
  }

  for (const variant of bay.variants) {
    block.appendChild(buildVariantRow(variant));
  }

  return block;
}

export function buildGroupHeader(group: GroupView): HTMLDivElement {
  const header = el('div', 'group-header');
  header.dataset.groupid = String(group.id);
  header.dataset.color   = group.color;
  header.dataset.locked  = String(group.locked);

  const twisty = el('button', 'group-toggle');
  twisty.dataset.action = 'toggleGroup';
  twisty.dataset.groupid = String(group.id);
  // El nombre accesible y el hover se escriben de la MISMA cadena, que es lo que
  // impide que se separen: los dos dicen que hace pulsarlo.
  const twistyName = t('Collapse or Expand');
  twisty.setAttribute('aria-label', twistyName);
  setTip(twisty, twistyName);
  twisty.appendChild(glyph(ICONS.group.expanded));
  header.appendChild(twisty);

  const label = el('span', 'group-label');
  label.textContent = group.label;
  header.appendChild(label);

  const actions = el('span', 'group-actions');
  actions.appendChild(groupButton(group.id, 'renameGroup', ICONS.group.rename, t('Rename Group')));
  actions.appendChild(groupButton(group.id, 'setGroupColor', ICONS.group.color, t('Set Color')));

  // El candado refleja el estado además de alternarlo: bloqueado, el botón se
  // queda visible sin hover (ver group-header.css) y es el único indicio de por
  // qué a las bays de este grupo les falta la X.
  const lock = groupButton(
    group.id, 'toggleGroupLock',
    group.locked ? ICONS.group.locked : ICONS.group.unlocked,
    group.locked ? t('Unlock Group') : t('Lock Group'),
  );
  lock.classList.add('group-lock-btn');
  actions.appendChild(lock);

  header.appendChild(actions);
  return header;
}

function groupButton(groupId: number, action: string, icon: string, label: string): HTMLButtonElement {
  const button = el('button', 'group-btn');
  button.dataset.action  = action;
  button.dataset.groupid = String(groupId);
  button.setAttribute('aria-label', label);
  setTip(button, label);
  button.appendChild(glyph(icon));
  return button;
}

/** La fila que se dibuja cuando no hay ninguna bay abierta. */
export function buildEmpty(): HTMLDivElement {
  const empty = el('div', 'empty');
  empty.textContent = t('No open bays');
  return empty;
}

/** Los bloques de una lista entera, en orden y con su clave. */
export function buildBlocks(
  sections: GroupSection[],
  layout: RowLayout,
): { key: string; el: HTMLElement }[] {
  const blocks: { key: string; el: HTMLElement }[] = [];

  for (const section of sections) {
    if (section.header) {
      blocks.push({ key: `group:${section.header.id}`, el: buildGroupHeader(section.header) });
    }
    for (const bay of section.bays) {
      blocks.push({ key: `bay:${bay.id}`, el: buildBayBlock(bay, layout, section.header?.color) });
    }
  }

  return blocks;
}
