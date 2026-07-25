// Interacción principal del webview.
// Clicks, menú contextual y actualizaciones parciales que llegan del host.

import { vscode } from './vscodeApi';
import { BaysContextMenu } from './contextmenu';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../shared/protocol';

// Emisor tipado: cada mensaje saliente debe ser un WebviewToHostMessage
// válido. Un campo o `type` que no exista en el protocolo no compila.
function post(message: WebviewToHostMessage): void {
  vscode.postMessage(message);
}

//= COLAPSADO DE GRUPOS

// Collapse a group header and hide its rows (or expand). Shared by the click
// handler and the post-rebuild restore so both stay in sync.
function setGroupCollapsed(header: HTMLElement, collapsed: boolean): void {
  header.classList.toggle('collapsed', collapsed);

  const icon = header.querySelector('[data-action="toggleGroup"] .codicon');
  if (icon) {
    icon.classList.toggle('codicon-folder-opened-compact', !collapsed);
    icon.classList.toggle('codicon-folder-compact',        collapsed);
  }

  let sibling = header.nextElementSibling;
  while (sibling && !sibling.classList.contains('group-header')) {
    (sibling as HTMLElement).style.display = collapsed ? 'none' : '';
    sibling = sibling.nextElementSibling;
  }
}

// Flip a header's collapsed state and persist it so the next full rebuild can
// re-apply it (collapsed state lives only in the DOM otherwise). Shared by the
// twisty button and a plain click anywhere on the header.
function toggleGroupCollapsed(header: HTMLElement | null): void {
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

//= INICIALIZACIÓN

export function initInteractions(): void {
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

  // Collapsed state lives only in the DOM, which a full webview.html rebuild wipes.
  // Persist collapsed group ids via getState()/setState() (like scrollY) and
  // re-apply them after every rebuild so a collapsed group doesn't snap back open
  // the moment any structural change happens.
  (function restoreCollapsedGroups() {
    const st = vscode.getState();
    if (!st || !Array.isArray(st.collapsedGroups) || st.collapsedGroups.length === 0) { return; }
    const collapsed = new Set(st.collapsedGroups.map(String));
    const apply = () => {
      document.querySelectorAll<HTMLElement>('.group-header').forEach(header => {
        if (collapsed.has(String(header.dataset.groupid))) { setGroupCollapsed(header, true); }
      });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', apply);
    } else {
      apply();
    }
  })();

  let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
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
  const closingTabs = new Set<string>();

  document.addEventListener('click', e => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) { return; }

    const btn = target.closest<HTMLElement>('button[data-action]');
    if (btn) {
      e.stopPropagation();
      const action = btn.dataset.action;

      if (action === 'closeBay' || action === 'closeVariant') {
        const bayId = btn.dataset.bayId;
        if (!bayId) { return; }
        const bay = document.querySelector(`.bay[data-bay-id="${CSS.escape(bayId)}"]`);
        if (bay && !closingTabs.has(bayId)) {
          closingTabs.add(bayId);
          bay.classList.add('closing');
          setTimeout(() => {
            post({ type: action, bayId });
            closingTabs.delete(bayId);
          }, 200);
        }
        return;
      }

      if (action === 'fileAction') {
        const bayId = btn.dataset.bayId;
        const actionId = btn.dataset.actionid;
        if (bayId && actionId) { post({ type: 'fileAction', bayId, actionId }); }
        return;
      }

      // Group: collapse / expand (client-side toggle, persisted so it survives rebuilds)
      if (action === 'toggleGroup') {
        toggleGroupCollapsed(btn.closest<HTMLElement>('.group-header'));
        return;
      }

      // Group actions carry a groupId, not a bayId.
      if (action === 'renameGroup' || action === 'setGroupColor' || action === 'toggleGroupLock') {
        post({ type: action, groupId: parseInt(btn.dataset.groupid ?? '', 10) });
        return;
      }

      if (action === 'addToChat') {
        const bayId = btn.dataset.bayId;
        if (bayId) { post({ type: 'addToChat', bayId }); }
        return;
      }
      return;
    }

    // Un clic en cualquier parte de la cabecera (salvo sus botones de acción)
    // colapsa o expande el grupo — el twisty es sólo el ancla visual.
    const header = target.closest<HTMLElement>('.group-header');
    if (header) { toggleGroupCollapsed(header); return; }

    const bay = target.closest<HTMLElement>('.bay');
    const bayId = bay?.dataset.bayId;
    if (bayId) { post({ type: 'openBay', bayId }); }
  });

  document.addEventListener('contextmenu', e => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) { return; }

    // Los grupos no tienen menú contextual: sus tres acciones ya son botones.
    if (target.closest('.group-header')) { e.preventDefault(); return; }

    const bay = target.closest<HTMLElement>('.bay');
    const bayId = bay?.dataset.bayId;
    if (bayId) {
      e.preventDefault();
      // Las coordenadas viajan al host y vuelven con los items: sólo él sabe qué
      // acciones tiene esta bay (grupo bloqueado, si hay URI, si Copilot está).
      post({ type: 'contextMenu', bayId, x: e.clientX, y: e.clientY });
    }
  });

  // Actualización parcial desde el host (evita rebuild completo al cambiar bay activa)
  window.addEventListener('message', (e: MessageEvent<HostToWebviewMessage>) => {
    const msg = e.data;

    if (msg.type === 'showContextMenu') {
      BaysContextMenu.show({
        x: msg.x,
        y: msg.y,
        items: msg.items,
        onSelect: actionId => post({ type: 'menuAction', bayId: msg.bayId, actionId }),
      });
    }

    if (msg.type === 'updateActiveBay') {
      const activeSet = new Set(msg.activeBayIds);
      document.querySelectorAll<HTMLElement>('.bay').forEach(t => {
        t.classList.toggle('active', activeSet.has(t.dataset.bayId ?? ''));
      });
    }

    if (msg.type === 'updateBayLabel') {
      // A webview panel rewrote its title (e.g. Claude Code). Swap only the leading
      // text node of .bay-name so any trailing pin badge / state class survives.
      // Variant rows have no .bay-name — their text lives in .variant-label.
      const bay = document.querySelector(`.bay[data-bay-id="${CSS.escape(msg.bayId)}"]`);
      if (bay) {
        const nameEl = bay.querySelector('.bay-name') || bay.querySelector('.variant-label');
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
      // Use attribute selector with proper escaping for special characters in IDs.
      // Variant rows render no .bay-name/.bay-state (they never show git/diagnostic
      // state), so for them this is intentionally a no-op.
      const bay = document.querySelector(`.bay[data-bay-id="${CSS.escape(msg.bayId)}"]`);
      if (bay && !bay.classList.contains('closing')) {
        const tabName = bay.querySelector('.bay-name');
        const tabState = bay.querySelector('.bay-state');

        if (tabName) {
          // Remover clases de estado anteriores y aplicar la nueva
          tabName.className = 'bay-name' + (msg.stateClass || '');
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
}
