// Main webview interaction script.
// Handles clicks, context menu and partial active-state updates from the host.
// Served as a static resource via webview.asWebviewUri().

const vscode = acquireVsCodeApi();
console.log('[webview.js] Script loaded');

// Preserve scroll across full HTML rebuilds. Reassigning webview.html reloads
// the document (scroll resets to 0), but vscode.getState()/setState() persist
// across reloads within the webview's lifetime, so we restore from there.
(function restoreScroll() {
  const st = vscode.getState();
  if (st && typeof st.scrollY === 'number' && st.scrollY > 0) {
    const y = st.scrollY;
    // Restore after layout so the target offset exists
    requestAnimationFrame(() => window.scrollTo(0, y));
  }
})();

// Collapse a group header and hide its rows (or expand). Shared by the click
// handler and the post-rebuild restore so both stay in sync.
function setGroupCollapsed(header, collapsed) {
  header.classList.toggle('collapsed', collapsed);

  const icon = header.querySelector('[data-action="toggleGroup"] .codicon');
  if (icon) {
    icon.classList.toggle('codicon-chevron-down',  !collapsed);
    icon.classList.toggle('codicon-chevron-right', collapsed);
  }

  let sibling = header.nextElementSibling;
  while (sibling && !sibling.classList.contains('group-header')) {
    sibling.style.display = collapsed ? 'none' : '';
    sibling = sibling.nextElementSibling;
  }
}

// Flip a header's collapsed state and persist it so the next full rebuild can
// re-apply it (collapsed state lives only in the DOM otherwise). Shared by the
// twisty button and a plain click anywhere on the header.
function toggleGroupCollapsed(header) {
  if (!header) { return; }
  const isCollapsed = !header.classList.contains('collapsed');
  setGroupCollapsed(header, isCollapsed);

  const groupId = header.dataset.groupid;
  if (groupId !== undefined) {
    const st = vscode.getState() || {};
    const collapsed = new Set((st.collapsedGroups || []).map(String));
    if (isCollapsed) { collapsed.add(String(groupId)); } else { collapsed.delete(String(groupId)); }
    st.collapsedGroups = Array.from(collapsed);
    vscode.setState(st);
  }
}

// Collapsed state lives only in the DOM, which a full webview.html rebuild wipes.
// Persist collapsed group ids via getState()/setState() (like scrollY) and
// re-apply them after every rebuild so a collapsed group doesn't snap back open
// the moment any structural change happens.
(function restoreCollapsedGroups() {
  const st = vscode.getState();
  if (!st || !Array.isArray(st.collapsedGroups) || st.collapsedGroups.length === 0) { return; }
  const collapsed = new Set(st.collapsedGroups.map(String));
  const apply = () => {
    document.querySelectorAll('.group-header').forEach(header => {
      if (collapsed.has(String(header.dataset.groupid))) { setGroupCollapsed(header, true); }
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();

let scrollSaveTimer = null;
window.addEventListener('scroll', () => {
  if (scrollSaveTimer) { return; }
  scrollSaveTimer = setTimeout(() => {
    scrollSaveTimer = null;
    const st = vscode.getState() || {};
    st.scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    vscode.setState(st);
  }, 100);
}, { passive: true });

// Fade in body after initial render (solo si no tiene la clase loaded)
if (!document.body.classList.contains('loaded')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      requestAnimationFrame(() => {
        document.body.classList.add('loaded');
      });
    });
  } else {
    requestAnimationFrame(() => {
      document.body.classList.add('loaded');
    });
  }
}

// Evitar mensajes duplicados durante la animación de cierre
const closingTabs = new Set();

document.addEventListener('click', e => {
  console.log('[webview] Click event:', e.target, 'closest bay:', e.target.closest('.bay'));
  const btn = e.target.closest('button[data-action]');
  if (btn) {
    console.log('[webview] Button clicked:', btn.dataset.action);
    e.stopPropagation();
    const action = btn.dataset.action;

    if (action === 'closeBay') {
      const bayId = btn.dataset.bayId;
      const bay   = document.querySelector(`.bay[data-bay-id="${CSS.escape(bayId)}"]`);
      if (bay && !closingTabs.has(bayId)) {
        closingTabs.add(bayId);
        bay.classList.add('closing');
        setTimeout(() => {
          vscode.postMessage({ type: 'closeBay', bayId });
          closingTabs.delete(bayId);
        }, 200);
      }
      return;
    }

    if (action === 'closeVariant') {
      const bayId = btn.dataset.bayId;
      const bay   = document.querySelector(`.bay[data-bay-id="${CSS.escape(bayId)}"]`);
      if (bay && !closingTabs.has(bayId)) {
        closingTabs.add(bayId);
        bay.classList.add('closing');
        setTimeout(() => {
          vscode.postMessage({ type: 'closeVariant', bayId });
          closingTabs.delete(bayId);
        }, 200);
      }
      return;
    }

    if (action === 'fileAction') {
      vscode.postMessage({ type: 'fileAction', bayId: btn.dataset.bayId, actionId: btn.dataset.actionid });
      return;
    }

    // Group: collapse / expand (client-side toggle, persisted so it survives rebuilds)
    if (action === 'toggleGroup') {
      toggleGroupCollapsed(btn.closest('.group-header'));
      return;
    }

    // Group actions carry a groupId, not a bayId — the generic postMessage at
    // the end of this handler would send `bayId: undefined` instead.
    if (action === 'renameGroup' || action === 'setGroupColor' || action === 'toggleGroupLock') {
      vscode.postMessage({ type: action, groupId: parseInt(btn.dataset.groupid, 10) });
      return;
    }

    // Header actions that only require a simple postMessage
    if (action === 'saveAll' || action === 'reorder' || action === 'toggleCompactMode' || action === 'refresh') {
      vscode.postMessage({ type: action });
      return;
    }

    vscode.postMessage({ type: action, bayId: btn.dataset.bayId });
    return;
  }

  // Un clic en cualquier parte de la cabecera (salvo sus botones de acción)
  // colapsa o expande el grupo — el twisty es sólo el ancla visual.
  const header = e.target.closest('.group-header');
  if (header) { toggleGroupCollapsed(header); return; }

  const bay = e.target.closest('.bay');
  console.log('[webview] Bay found:', bay, 'bayId:', bay?.dataset?.bayId);
  if (bay) { vscode.postMessage({ type: 'openBay', bayId: bay.dataset.bayId }); }
});

document.addEventListener('contextmenu', e => {
  // Los grupos no tienen menú contextual: sus tres acciones ya son botones.
  if (e.target.closest('.group-header')) { e.preventDefault(); return; }

  const bay = e.target.closest('.bay');
  if (bay) {
    e.preventDefault();
    // Las coordenadas viajan al host y vuelven con los items: sólo él sabe qué
    // acciones tiene esta bay (grupo bloqueado, si hay URI, si Copilot está).
    vscode.postMessage({ type: 'contextMenu', bayId: bay.dataset.bayId, x: e.clientX, y: e.clientY });
  }
});

// Actualización parcial desde el host (evita rebuild completo al cambiar bay activa)
window.addEventListener('message', e => {
  const msg = e.data;

  if (msg.type === 'showContextMenu') {
    BaysContextMenu.show({
      x: msg.x,
      y: msg.y,
      items: msg.items,
      onSelect: actionId => vscode.postMessage({ type: 'menuAction', bayId: msg.bayId, actionId }),
    });
  }

  if (msg.type === 'updateActiveBay') {
    const activeSet = new Set(msg.activeBayIds);
    document.querySelectorAll('.bay').forEach(t => {
      t.classList.toggle('active', activeSet.has(t.dataset.bayId));
    });
  }

  if (msg.type === 'updateBayLabel') {
    // A webview panel rewrote its title (e.g. Claude Code). Swap only the leading
    // text node of .bay-name so any trailing pin badge / state class survives.
    const bay = document.querySelector(`.bay[data-bay-id="${CSS.escape(msg.bayId)}"]`);
    if (bay) {
      const nameEl = bay.querySelector('.bay-name');
      if (nameEl) {
        const first = nameEl.firstChild;
        if (first && first.nodeType === Node.TEXT_NODE) {
          first.nodeValue = msg.label;
        } else {
          nameEl.insertBefore(document.createTextNode(msg.label), nameEl.firstChild);
        }
      }
    }
  }

  if (msg.type === 'updateIcons') {
    // Deferred icons resolved by the host — swap each placeholder in place
    for (const it of msg.icons) {
      const bay = document.querySelector(`.bay[data-bay-id="${CSS.escape(it.bayId)}"]`);
      if (bay) {
        const iconEl = bay.querySelector('.bay-icon');
        if (iconEl) { iconEl.innerHTML = it.html; }
      }
    }
  }

  if (msg.type === 'bayStateChanged') {
    // Use attribute selector with proper escaping for special characters in IDs
    const bay = document.querySelector(`.bay[data-bay-id="${CSS.escape(msg.bayId)}"]`);
    if (bay && !bay.classList.contains('closing')) {
      const tabName = bay.querySelector('.bay-name');
      const tabState = bay.querySelector('.bay-state');

      if (tabName) {
        // Remover clases de estado anteriores
        tabName.className = 'bay-name';
        // Agregar nueva clase de estado
        if (msg.stateClass) {
          tabName.className = 'bay-name' + msg.stateClass;
        }
        // Aplicar animación de cambio
        tabName.classList.add('changing');
        setTimeout(() => {
          tabName.classList.remove('changing');
        }, 1000);
      }

      // Actualizar el indicador de estado
      if (tabState && msg.stateHtml) {
        tabState.outerHTML = msg.stateHtml;
      }
    }
  }
});
