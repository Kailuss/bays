// Drag & Drop script for the bays webview.
// Served as a static resource via webview.asWebviewUri().
// Only loaded when drag & drop is enabled in settings.
//
// Unit de arrastre: .bay-block (contiene la bay parent + sus child bays).
// Un cloneNode(true) del bloque captura todo el contenido de una vez,
// sin necesidad de gestionar clones hijos por separado.

console.log('[dragdrop.js] Script loaded');

const DRAG_THRESHOLD = 5;   // Pixels antes de iniciar el drag

let isDragging         = false;
let startY             = 0;
let startMouseY        = 0;
let sourceEl           = null;  // .bay-block original que se arrastra
let cloneEl            = null;  // clon flotante del bloque completo
let siblings           = [];    // .bay-block reordenables (excluye pinned y el arrastrado)
let originalOrder      = [];    // rect.top y altura de cada sibling al iniciar
let currentInsertIndex = -1;    // índice de inserción actual (en siblings)
let sourceIndex        = -1;    // índice original del bloque arrastrado
let tabGroupId         = null;  // grupo de origen (string, del dataset)
let blockHeight        = 0;     // Alto total del bloque (parent + children automático)

// Cross-group: regiones verticales de cada grupo y grupo bajo el cursor.
let groupRegions       = [];    // [{ groupId, top, bottom, headerEl }] al iniciar el drag
let targetGroupId      = null;  // grupo actualmente bajo el cursor (string)
let highlightedGroupId = null;  // grupo con resaltado de destino activo

// --- Mousedown: preparar un posible drag ---
document.addEventListener('mousedown', e => {
  console.log('[dragdrop] Mousedown:', e.target);
  if (e.button !== 0) { return; }
  const block = e.target.closest('.bay-block');
  if (!block) { console.log('[dragdrop] No bay-block found'); return; }
  if (e.target.closest('button')) { console.log('[dragdrop] Button clicked, ignoring'); return; }

  // Los child bays no actúan como handle — sólo la fila padre inicia el drag
  const clickedTab = e.target.closest('.bay');
  if (clickedTab && clickedTab.classList.contains('variant')) { return; }

  if (block.dataset.pinned === 'true') { return; }

  sourceEl    = block;
  startMouseY = e.clientY;
  startY      = block.getBoundingClientRect().top;
  tabGroupId  = block.dataset.groupid;
});

// --- Mousemove: iniciar o continuar el drag ---
document.addEventListener('mousemove', e => {
  if (!sourceEl) { return; }

  if (!isDragging) {
    if (Math.abs(e.clientY - startMouseY) < DRAG_THRESHOLD) { return; }
    beginDrag();
  }

  const dy = e.clientY - startMouseY;
  cloneEl.style.transform = 'translateY(' + dy + 'px)';

  // Centro del bloque clonado para determinar posición de inserción
  const cloneCenter = startY + (blockHeight / 2) + dy;
  const overGroup   = groupAt(cloneCenter);

  if (overGroup === null || overGroup === tabGroupId) {
    // Sobre el grupo de origen (o sin grupos): reordenar in situ.
    clearTargetGroupHighlight();
    updateSiblingPositions(cloneCenter);
    targetGroupId = tabGroupId;
  } else {
    // Sobre otro grupo: cancelar el desplazamiento local y resaltar el destino.
    clearSiblingShifts();
    setTargetGroupHighlight(overGroup);
    targetGroupId = overGroup;
  }
});

// --- Mouseup: terminar el drag ---
document.addEventListener('mouseup', () => {
  if (!sourceEl) { return; }
  if (!isDragging) { sourceEl = null; return; }
  commitDrop();
});

// --- Cancelar si se sale de la ventana ---
document.addEventListener('mouseleave', () => {
  if (isDragging) { cancelDrag(); }
});

// ------------ helpers ------------

function beginDrag() {
  isDragging = true;
  document.body.classList.add('drag-active');

  const rect = sourceEl.getBoundingClientRect();

  // blockHeight = alto real del bloque completo (parent + todos sus children)
  // getBoundingClientRect() ya lo calcula porque .bay-block los contiene
  blockHeight = Math.round(rect.height) + 1;

  // Regiones verticales de cada grupo (para detectar arrastre entre grupos).
  // Sin cabeceras (un solo grupo visible) queda vacío ⇒ sólo reordenación local.
  groupRegions  = buildGroupRegions();
  targetGroupId = tabGroupId;

  // Todos los bloques arrastrables del mismo grupo (excluir pinned)
  const allBlocks      = Array.from(document.querySelectorAll('.bay-block[data-groupid="' + tabGroupId + '"]'));
  const draggable      = allBlocks.filter(b => b.dataset.pinned !== 'true');
  sourceIndex          = draggable.indexOf(sourceEl);
  currentInsertIndex   = sourceIndex;
  siblings             = draggable.filter(b => b !== sourceEl);

  // Guardar posición y alto originales de cada sibling
  originalOrder = siblings.map(b => {
    const r = b.getBoundingClientRect();
    return { el: b, origTop: r.top, height: Math.round(r.height) + 1 };
  });

  // Clonar el bloque entero (parent + children) en una sola operación
  cloneEl = sourceEl.cloneNode(true);
  cloneEl.classList.add('drag-clone');
  cloneEl.style.top    = rect.top    + 'px';
  cloneEl.style.left   = rect.left   + 'px';
  cloneEl.style.width  = rect.width  + 'px';
  cloneEl.style.height = rect.height + 'px';   // fijar alto para que fixed no colapse
  document.body.appendChild(cloneEl);

  sourceEl.classList.add('drag-placeholder');
  siblings.forEach(b => b.classList.add('drag-shifting'));
}

function updateSiblingPositions(cloneCenter) {
  let newIndex = siblings.length; // por defecto: al final

  for (let i = 0; i < originalOrder.length; i++) {
    if (cloneCenter < originalOrder[i].origTop + (originalOrder[i].height / 2)) {
      newIndex = i;
      break;
    }
  }

  if (newIndex === currentInsertIndex) { return; }
  currentInsertIndex = newIndex;

  for (let i = 0; i < originalOrder.length; i++) {
    const s           = originalOrder[i];
    const origLogical = (i < sourceIndex) ? i : i + 1;
    let   shift       = 0;

    if      (origLogical < sourceIndex && i >= currentInsertIndex) { shift =  blockHeight; }
    else if (origLogical > sourceIndex && i <  currentInsertIndex) { shift = -blockHeight; }

    s.el.style.transform = shift ? ('translateY(' + shift + 'px)') : '';
  }
}

function commitDrop() {
  // --- Movimiento entre grupos ---
  // El host cierra la bay y la reabre en el grupo destino; eso dispara los
  // eventos nativos de tabs y provoca un rebuild completo. No hacemos un
  // movimiento de DOM en cliente: sólo animamos el clon hacia el destino como
  // puente visual y dejamos que el rebuild ponga el orden autoritativo.
  if (targetGroupId !== tabGroupId) {
    vscode.postMessage({
      type          : 'dropBay',
      sourceBayId   : sourceEl.dataset.bayId,
      targetBayId   : null,
      insertPosition: null,
      sourceGroupId : parseInt(tabGroupId, 10),
      targetGroupId : parseInt(targetGroupId, 10),
    });

    const region  = groupRegions.find(r => r.groupId === targetGroupId);
    const destTop = region ? region.headerEl.getBoundingClientRect().bottom : startY;
    cloneEl.style.transition = 'transform 160ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity 160ms ease-out';
    cloneEl.style.transform  = 'translateY(' + (destTop - startY) + 'px) scale(0.85)';
    cloneEl.style.opacity    = '0';
    setTimeout(() => teardown(), 170);
    return;
  }

  if (currentInsertIndex !== sourceIndex) {
    let targetTabId, insertPosition, refEl, insertAfter;
    if (currentInsertIndex < originalOrder.length) {
      refEl          = originalOrder[currentInsertIndex].el;
      targetTabId    = refEl.dataset.bayId;
      insertPosition = 'before';
      insertAfter    = false;
    } else {
      refEl          = originalOrder[originalOrder.length - 1].el;
      targetTabId    = refEl.dataset.bayId;
      insertPosition = 'after';
      insertAfter    = true;
    }

    // El host actualiza el modelo en silencio (sin rebuild). El movimiento
    // visual lo confirma el propio cliente al terminar la animación.
    vscode.postMessage({
      type           : 'dropBay',
      sourceBayId    : sourceEl.dataset.bayId,
      targetBayId    : targetTabId,
      insertPosition : insertPosition,
      sourceGroupId  : parseInt(tabGroupId, 10),
      targetGroupId  : parseInt(tabGroupId, 10),
    });

    // Animar el clon hasta su slot como puente visual
    const finalDy = (currentInsertIndex - sourceIndex) * blockHeight;
    cloneEl.style.transition = 'transform 150ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity 150ms ease-out';
    cloneEl.style.transform  = 'translateY(' + finalDy + 'px)';
    cloneEl.style.opacity    = '0';

    const movedSrc = sourceEl, movedRef = refEl, movedAfter = insertAfter;
    setTimeout(() => {
      commitDomMove(movedSrc, movedRef, movedAfter);
      teardown();
    }, 160);

  } else {
    // Sin cambio de posición — fade-out en sitio
    cloneEl.style.transition = 'transform 150ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity 120ms ease-out';
    cloneEl.style.transform  = 'translateY(0)';
    cloneEl.style.opacity    = '0';
    setTimeout(() => teardown(), 160);
  }
}

// Mueve físicamente el bloque arrastrado a su nueva posición en el DOM,
// de modo que el orden sea correcto sin reconstruir todo el HTML.
function commitDomMove(src, ref, after) {
  if (!src || !ref || src === ref || !ref.parentNode) { return; }
  if (after) {
    ref.parentNode.insertBefore(src, ref.nextSibling);
  } else {
    ref.parentNode.insertBefore(src, ref);
  }
}

// ------------ cross-group helpers ------------

// Calcula la banda vertical [top, bottom) que ocupa cada grupo, delimitada por
// las cabeceras. Con una sola cabecera (o ninguna) no hay destino alternativo.
function buildGroupRegions() {
  const headers = Array.from(document.querySelectorAll('.group-header'));
  if (headers.length === 0) { return []; }

  const regions = headers.map(h => ({
    groupId : h.dataset.groupid,
    top     : h.getBoundingClientRect().top,
    bottom  : Number.POSITIVE_INFINITY,
    headerEl: h,
  }));
  for (let i = 0; i < regions.length - 1; i++) {
    regions[i].bottom = regions[i + 1].top;
  }
  return regions;
}

// Devuelve el groupId (string) cuya banda contiene la coordenada y, o null.
function groupAt(y) {
  for (const r of groupRegions) {
    if (y >= r.top && y < r.bottom) { return r.groupId; }
  }
  return null;
}

// Deshace el desplazamiento de los siblings del grupo de origen (al salir hacia
// otro grupo, el hueco de reordenación local debe cerrarse).
function clearSiblingShifts() {
  if (currentInsertIndex === sourceIndex) { return; }
  originalOrder.forEach(s => { s.el.style.transform = ''; });
  currentInsertIndex = sourceIndex;
}

function setTargetGroupHighlight(groupId) {
  if (highlightedGroupId === groupId) { return; }
  clearTargetGroupHighlight();

  const header = document.querySelector('.group-header[data-groupid="' + groupId + '"]');
  if (header) { header.classList.add('drag-over'); }
  document
    .querySelectorAll('.bay-block[data-groupid="' + groupId + '"]')
    .forEach(b => b.classList.add('drag-target-group'));
  highlightedGroupId = groupId;
}

function clearTargetGroupHighlight() {
  if (highlightedGroupId === null) { return; }
  document
    .querySelectorAll('.group-header.drag-over')
    .forEach(h => h.classList.remove('drag-over'));
  document
    .querySelectorAll('.bay-block.drag-target-group')
    .forEach(b => b.classList.remove('drag-target-group'));
  highlightedGroupId = null;
}

function cancelDrag() { teardown(); }

function teardown() {
  document.querySelectorAll('.drag-clone').forEach(el => el.remove());
  cloneEl = null;

  clearTargetGroupHighlight();

  if (sourceEl) {
    sourceEl.classList.remove('drag-placeholder');
    sourceEl = null;
  }

  siblings.forEach(b => {
    b.classList.remove('drag-shifting');
    b.style.transform = '';
  });
  originalOrder.forEach(s => { s.el.style.transform = ''; });

  document.body.classList.remove('drag-active');
  isDragging         = false;
  siblings           = [];
  originalOrder      = [];
  currentInsertIndex = -1;
  sourceIndex        = -1;
  blockHeight        = 0;
  groupRegions       = [];
  targetGroupId      = null;
}
