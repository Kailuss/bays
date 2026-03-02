// Drag & Drop script for the bays webview.
// Served as a static resource via webview.asWebviewUri().
// Only loaded when drag & drop is enabled in settings.
//
// Unit de arrastre: .bay-block (contiene la bay parent + sus child bays).
// Un cloneNode(true) del bloque captura todo el contenido de una vez,
// sin necesidad de gestionar clones hijos por separado.

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
let tabGroupId         = null;
let blockHeight        = 0;     // Alto total del bloque (parent + children automático)

// --- Mousedown: preparar un posible drag ---
document.addEventListener('mousedown', e => {
  if (e.button !== 0) { return; }
  const block = e.target.closest('.bay-block');
  if (!block) { return; }
  if (e.target.closest('button')) { return; }

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
  updateSiblingPositions(cloneCenter);
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
  if (currentInsertIndex !== sourceIndex) {
    let targetTabId, insertPosition;
    if (currentInsertIndex < originalOrder.length) {
      targetTabId    = originalOrder[currentInsertIndex].el.dataset.bayid;
      insertPosition = 'before';
    } else {
      targetTabId    = originalOrder[originalOrder.length - 1].el.dataset.bayid;
      insertPosition = 'after';
    }

    // Enviar mensaje primero para que el rebuild del HTML empiece ya
    vscode.postMessage({
      type           : 'dropBay',
      sourceTabId    : sourceEl.dataset.bayid,
      targetTabId    : targetTabId,
      insertPosition : insertPosition,
      sourceGroupId  : parseInt(tabGroupId, 10),
      targetGroupId  : parseInt(tabGroupId, 10),
    });

    // Animar el clon hasta su slot como puente visual mientras llega el rebuild
    const finalDy = (currentInsertIndex - sourceIndex) * blockHeight;
    cloneEl.style.transition = 'transform 150ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity 150ms ease-out';
    cloneEl.style.transform  = 'translateY(' + finalDy + 'px)';
    cloneEl.style.opacity    = '0';
    setTimeout(() => teardown(), 160);

  } else {
    // Sin cambio de posición — fade-out en sitio
    cloneEl.style.transition = 'transform 150ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity 120ms ease-out';
    cloneEl.style.transform  = 'translateY(0)';
    cloneEl.style.opacity    = '0';
    setTimeout(() => teardown(), 160);
  }
}

function cancelDrag() { teardown(); }

function teardown() {
  document.querySelectorAll('.drag-clone').forEach(el => el.remove());
  cloneEl = null;

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
}
