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

    // Group: collapse / expand (purely client-side, no postMessage)
    if (action === 'toggleGroup') {
      const header = btn.closest('.group-header');
      if (!header) { return; }
      const isCollapsed = header.classList.toggle('collapsed');

      // Toggle icon fold-down ↔ fold-up
      const icon = btn.querySelector('.codicon');
      if (icon) {
        icon.classList.toggle('codicon-fold-down', !isCollapsed);
        icon.classList.toggle('codicon-fold-up',   isCollapsed);
      }

      // Hide / show sibling tabs until next group-header
      let sibling = header.nextElementSibling;
      while (sibling && !sibling.classList.contains('group-header')) {
        sibling.style.display = isCollapsed ? 'none' : '';
        sibling = sibling.nextElementSibling;
      }
      return;
    }

    // Group: close all tabs in the group
    if (action === 'closeGroup') {
      vscode.postMessage({ type: 'closeGroup', groupId: parseInt(btn.dataset.groupid, 10) });
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

  const bay = e.target.closest('.bay');
  console.log('[webview] Bay found:', bay, 'bayId:', bay?.dataset?.bayId);
  if (bay) { vscode.postMessage({ type: 'openBay', bayId: bay.dataset.bayId }); }
});

document.addEventListener('contextmenu', e => {
  const bay = e.target.closest('.bay');
  if (bay) {
    e.preventDefault();
    vscode.postMessage({ type: 'contextMenu', bayId: bay.dataset.bayId });
  }
});

// Actualización parcial desde el host (evita rebuild completo al cambiar bay activa)
window.addEventListener('message', e => {
  const msg = e.data;

  if (msg.type === 'updateActiveBay') {
    const activeSet = new Set(msg.activeBayIds);
    document.querySelectorAll('.bay').forEach(t => {
      t.classList.toggle('active', activeSet.has(t.dataset.bayId));
    });
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
