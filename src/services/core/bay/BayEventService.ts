import * as vscode from 'vscode';
import { convertToBay, demoteOrphanVariant, generateIdFromNativeTab, remapFileBayUri } from '../helpers/tabConverter';
import { BayStateService } from '../BayStateService';
import { GitSyncService } from '../../integration/GitSyncService';
import { ClaudeConversationService } from '../../integration/ClaudeConversationService';
import { BayHierarchyService } from '../BayHierarchyService';
import { BayHeadService } from './BayHeadService';
import { ActiveStateService } from './ActiveStateService';
import type { Bay } from '../../../models/Bay';
import { Logger } from '../../../utils/logger';

/**
 * BayEventService - Gestión de Eventos de VS Code
 * 
 * Registra y procesa eventos de VS Code (tabs, editores, diagnósticos).
 * Delega a servicios especializados según el tipo de evento.
 */
export class BayEventService {
  private disposables: vscode.Disposable[] = [];
  // Cached so the high-frequency selection handler doesn't read configuration
  // (nor scan bays) on every keystroke when cursor sync is off (the default).
  private syncCursorEnabled = false;

  constructor(
    private stateService: BayStateService,
    private gitSyncService: GitSyncService,
    private hierarchyService: BayHierarchyService,
    private bayHeadService: BayHeadService,
    private activeStateService: ActiveStateService,
    /** Full resync on structural group changes (queued by BaySyncService). */
    private resyncAll: () => Promise<void>,
    /**
     * Cola de serialización compartida de BaySyncService. Todo handler que mute
     * el estado pasa por aquí: VS Code NO espera a los listeners async, así que
     * sin la cola dos eventos de tabs podían procesarse a la vez (el await de
     * ensureParentExists abría la ventana de reentrada).
     */
    private enqueue: (task: () => Promise<void>) => Promise<void>
  ) {}

  /**
   * Registra todos los event listeners necesarios.
   */
  activate(): void {
    Logger.log('[BayEvent] Activating event listeners');

    // Cache the cursor-sync flag; refresh it only when the setting changes.
    const readSyncCursor = () => {
      this.syncCursorEnabled = vscode.workspace
        .getConfiguration('bays')
        .get<boolean>('syncCursorPosition', false);
    };
    readSyncCursor();
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('bays.syncCursorPosition')) { readSyncCursor(); }
      })
    );

    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        void this.enqueue(() => this.handleTabChanges(event));
      })
    );

    // Filesystem-level events. On a rename/move VS Code updates the open editor in
    // place, but onDidChangeTabs only reports it as a `changed` flag event whose
    // recomputed id no longer matches the stored bay (the id embeds the URI) — so the
    // bay would keep its stale URI/label/path/git forever. Handle the rename (and the
    // matching delete cleanup) explicitly against the filesystem events.
    this.disposables.push(
      vscode.workspace.onDidRenameFiles((event) => {
        void this.enqueue(async () => this.handleFilesRenamed(event));
      })
    );

    this.disposables.push(
      vscode.workspace.onDidDeleteFiles((event) => {
        void this.enqueue(async () => this.handleFilesDeleted(event));
      })
    );

    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabGroups((event) => {
        void this.enqueue(async () => this.handleGroupChanges(event));
      })
    );

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        // Active-only change → partial update (toggle .active), no full rebuild
        const { hasChanges } = this.activeStateService.syncActiveState();
        if (hasChanges) {
          this.stateService.notifyActiveChange();
        }
      })
    );

    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        // Fast path: cursor sync disabled → skip the per-event bay lookup entirely
        if (!this.syncCursorEnabled) { return; }

        const uri = event.textEditor.document.uri;
        const bay = this.stateService.findBayByUri(uri);
        if (!bay || !event.selections[0]) { return; }

        const selection = event.selections[0];
        const line = selection.active.line + 1;
        const column = selection.active.character + 1;

        void this.hierarchyService.syncCursorPosition(bay.metadata.id, line, column);
      })
    );

    Logger.log('[BayEvent] Event listeners activated');
  }

  /**
   * Maneja cambios en bays (opened/closed/changed).
   * Asegura que los variants tengan parents y actualiza el estado.
   */
  private async handleTabChanges(event: vscode.TabChangeEvent): Promise<void> {
    let hasChanges = false;
    // Structural changes (open/close/pin/preview) need a full rebuild.
    // Dirty-only changes can be patched in place via the state animation channel.
    let structuralChange = false;
    // Un cierre nativo puede dejar previews vivas sin parent (VS Code no las
    // cierra con su .md) → resync completo, que reabre el source y re-enlaza.
    let orphanedPreviews = false;
    const dirtyChangedBays: Bay[] = [];
    const labelChangedBays: Bay[] = [];

    for (const bay of event.opened) {
      let st = convertToBay(bay, this.gitSyncService);
      if (!st) { continue; }

      // REGLA DE JERARQUÍA: una variante nunca vive sin bay parent. Una preview
      // que llega huérfana (su .md no está abierto — p.ej. "Open Preview"
      // reemplaza al editor) abre su source y se reconvierte ya enlazada. Si el
      // source no se puede resolver, se degrada a bay normal (nunca se descarta).
      if (st.metadata.diffType === 'preview' && !st.metadata.sourceBayId) {
        st = (await this.bayHeadService.adoptPreviewOrphan(st, bay)) ?? demoteOrphanVariant(st);
      }

      // Si es variante (diff o preview), asegurar que el parent existe PRIMERO.
      // Para las previews sourceUri es el propio .md, así que BayHeadService
      // puede reabrirlo exactamente igual que hace con los diffs.
      if (st.metadata.sourceBayId) {
        const parent = await this.bayHeadService.ensureParentExists(st, bay);

        if (parent) {
          Logger.log(`[BayEvent] Parent confirmed for variant: ${st.metadata.label} → ${parent.metadata.label}`);
        } else {
          // El parent no se pudo resolver ni crear (p.ej. edit de Claude Code
          // sobre un archivo movido/renombrado). REGLA: nunca una variante
          // suelta — se degrada a bay raíz. Descartarla tampoco es opción (la
          // hacía desaparecer del panel hasta el siguiente resync).
          st = demoteOrphanVariant(st);
          Logger.warn(`[BayEvent] Parent unresolvable for variant: ${st.metadata.label} — demoted to root bay`);
        }
      }

      // Añadir la bay/variant al estado
      this.stateService.addBay(st);

      // Si es variant, registrar en hierarchy (no-op si el parent no existe)
      if (st.metadata.sourceBayId) {
        this.hierarchyService.linkVariantToParentBay(st.metadata.id, st.metadata.sourceBayId);
        Logger.log(`[BayEvent] Variant registered in hierarchy: ${st.metadata.label}`);
      }

      hasChanges = true;
      structuralChange = true;
    }

    for (const bay of event.closed) {
      const id = generateIdFromNativeTab(bay);
      if (!id) { continue; }

      // Verificar si es un cierre intencional (ya procesado).
      // NO llamar clearIntentionalClose aquí: el mismo parent puede recibir
      // múltiples eventos de cierre si varios variants cierran a la vez.
      // handleCloseVariant (BaysWebviewProvider) limpia los marcadores al
      // terminar su polling (y siempre, vía try/finally).
      if (this.stateService.isIntentionalClose(id)) {
        Logger.log(`[BayEvent] Ignoring intentional close (already processed): ${id}`);
        continue;
      }

      const existingBay = this.stateService.getBayById(id);
      if (existingBay) {
        Logger.log(`[BayEvent] Processing external close: ${existingBay.metadata.label} (ID: ${id}, parentId: ${existingBay.metadata.sourceBayId || 'none'}, hasChildren: ${existingBay.state.hasVariant})`);

        // REGLA DE JERARQUÍA: si el bay cerrado deja variantes de preview en el
        // estado (removeBay las conserva porque su tab nativa sigue viva),
        // quedarían huérfanas — marcar para resync, que reabre el source.
        if (existingBay.state.hasVariant &&
            this.hierarchyService.fetchVariants(id).some(v => v.metadata.diffType === 'preview')) {
          orphanedPreviews = true;
        }

        this.stateService.removeBay(id);
        hasChanges = true;
        structuralChange = true;
      }
    }

    if (orphanedPreviews) {
      Logger.log('[BayEvent] Close left orphan previews — full resync to reopen their source');
      void this.resyncAll();
      return;
    }

    for (const bay of event.changed) {
      const id = generateIdFromNativeTab(bay);
      if (!id) { continue; }

      const existingBay = this.stateService.getBayById(id);
      if (existingBay) {
        // isPreview (VS Code italic preview editor) is NOT rendered anywhere, so
        // a change needs no rebuild — just keep the state in sync silently.
        if (existingBay.state.isPreview !== bay.isPreview) {
          existingBay.state.isPreview = bay.isPreview;
        }

        if (existingBay.state.isPinned !== bay.isPinned) {
          existingBay.state.isPinned = bay.isPinned;
          hasChanges = true;
          structuralChange = true;
        }

        // isDirty is a purely visual per-bay change → patch in place
        if (existingBay.state.isDirty !== bay.isDirty) {
          existingBay.state.isDirty = bay.isDirty;
          hasChanges = true;
          dirtyChangedBays.push(existingBay);
        }

        // Active flips also arrive here. onDidChangeActiveTextEditor only fires for
        // TEXT editors, so a switch between two non-text tabs (e.g. Claude Code ↔ a
        // markdown preview) never reaches the highlight sync otherwise. Flag the
        // change and let the post-loop syncActiveState reconcile it (partial update).
        if (existingBay.state.isActive !== bay.isActive) {
          hasChanges = true;
        }

        // Webview panels rewrite their title at runtime (Claude Code shows the
        // current session). The bay id derives from the stable viewType, not the
        // label, so the tab still resolves here — just refresh the display name in
        // place. Restricted to webviews: file/custom labels only change on rename,
        // which re-keys the bay through onDidRenameFiles instead. Claude chat tabs
        // are excluded: ClaudeConversationService owns their label (it shows the
        // full, untruncated ai-title) and would fight a 24-char native update here.
        if (existingBay.metadata.bayType === 'webview'
            && existingBay.metadata.label !== bay.label
            && !ClaudeConversationService.isClaudeConversationBay(existingBay)) {
          existingBay.metadata.label = bay.label;
          existingBay.metadata.tooltipText = bay.label;
          hasChanges = true;
          labelChangedBays.push(existingBay);
        }
      }
    }

    if (hasChanges) {
      // Sync active state from native tabs, then decide how to notify
      const { hasChanges: activeChanges } = this.activeStateService.syncActiveState();

      if (structuralChange) {
        // Full rebuild also refreshes the active highlight and dirty indicators
        this.stateService.notifyChange();
      } else {
        // Only lightweight changes → partial updates, no full DOM rebuild
        for (const b of dirtyChangedBays) {
          this.stateService.updateBayStateWithAnimation(b);
        }
        for (const b of labelChangedBays) {
          this.stateService.notifyBayLabelChange(b.metadata.id);
        }
        if (activeChanges) {
          this.stateService.notifyActiveChange();
        }
      }
    }
  }

  /**
   * VS Code renamed/moved one or more files (or whole folders). The open editors follow
   * to the new URIs, but a bay's id embeds its URI, so every affected bay must be
   * re-keyed or it keeps stale label/path/git decorations.
   *
   * Clean file bays are re-keyed in place (manual drag order preserved). Anything that
   * touches a variant — a diff/preview child, or a parent that has them — falls back to
   * a full resync, which rebuilds the hierarchy from native truth instead of risking a
   * child left pointing at a stale parent id.
   *
   * The remap is derived from the event's newUri (not the native tab), so it does NOT
   * depend on VS Code having already propagated the tab-model update to the extension
   * host by the time this event fires.
   */
  private handleFilesRenamed(event: vscode.FileRenameEvent): void {
    const affected: Array<{ bay: Bay; newUri: vscode.Uri }> = [];
    for (const { oldUri, newUri } of event.files) {
      for (const bay of this.stateService.getAllBays()) {
        const u = bay.metadata.uri;
        if (!u || !this.isSameOrUnder(u, oldUri)) { continue; }
        if (u.path === oldUri.path) {
          affected.push({ bay, newUri });
        } else {
          // Descendant of a renamed folder: swap the folder prefix, keep the suffix.
          const suffix = u.path.slice(oldUri.path.length); // includes leading '/'
          affected.push({ bay, newUri: newUri.with({ path: newUri.path + suffix }) });
        }
      }
    }
    if (affected.length === 0) { return; }

    // Variants and parents-with-variants need coordinated id + sourceBayId rewiring
    // (and diff URIs the targeted path can't reconstruct) → reconcile from native truth.
    if (affected.some(a => a.bay.metadata.sourceBayId || a.bay.state.hasVariant)) {
      Logger.log('[BayEvent] Rename touches a variant/parent — full resync');
      void this.resyncAll();
      return;
    }

    for (const { bay, newUri } of affected) {
      const fresh = remapFileBayUri(bay, newUri, this.gitSyncService);
      if (!this.stateService.rekeyBay(bay.metadata.id, fresh)) {
        // Only fails on an id collision (rename overwrote another open file) — that
        // genuinely needs native reconciliation, so hand off to a full resync.
        Logger.warn(`[BayEvent] Rekey rejected for ${bay.metadata.label} — full resync`);
        void this.resyncAll();
        return;
      }
      Logger.log(`[BayEvent] Rekeyed bay after rename: ${bay.metadata.label} → ${newUri.fsPath}`);
    }
    // rekeyBay fired onDidChangeState per bay (debounced by the provider into one rebuild).
  }

  /**
   * VS Code deleted one or more files/folders. It normally closes the affected editors
   * (handled by onDidChangeTabs.closed), but a bay can linger if VS Code kept the editor
   * open (e.g. unsaved changes) or a close event was missed. Purge any top-level file
   * bay whose file was deleted AND no longer has a live native tab; leave the rest so an
   * intentionally-kept editor still shows.
   */
  private handleFilesDeleted(event: vscode.FileDeleteEvent): void {
    for (const deletedUri of event.files) {
      for (const bay of this.stateService.getAllBays()) {
        const u = bay.metadata.uri;
        if (!u || !this.isSameOrUnder(u, deletedUri)) { continue; }
        // Variants follow their parent's removal; don't purge them standalone.
        if (bay.metadata.sourceBayId) { continue; }
        // Leave bays whose editor VS Code intentionally kept open.
        if (this.findNativeTabByUri(u, bay.state.viewColumn)) { continue; }
        Logger.log(`[BayEvent] Removing bay for deleted file: ${bay.metadata.label}`);
        this.stateService.removeBay(bay.metadata.id);
      }
    }
  }

  /** True if `u` is `base` itself or lives under it (same scheme/authority). */
  private isSameOrUnder(u: vscode.Uri, base: vscode.Uri): boolean {
    if (u.scheme !== base.scheme || u.authority !== base.authority) { return false; }
    return u.path === base.path || u.path.startsWith(base.path + '/');
  }

  /** Live native tab (text / custom editor / notebook) backing `uri` in `viewColumn`. */
  private findNativeTabByUri(
    uri: vscode.Uri,
    viewColumn: vscode.ViewColumn
  ): vscode.Tab | undefined {
    const group = vscode.window.tabGroups.all.find(g => g.viewColumn === viewColumn);
    if (!group) { return undefined; }
    const target = uri.toString();
    return group.tabs.find(t => {
      const input = t.input;
      if (input instanceof vscode.TabInputText)     { return input.uri.toString() === target; }
      if (input instanceof vscode.TabInputCustom)   { return input.uri.toString() === target; }
      if (input instanceof vscode.TabInputNotebook) { return input.uri.toString() === target; }
      return false;
    });
  }

  /**
   * Maneja cambios en grupos de editores.
   */
  private handleGroupChanges(event: vscode.TabGroupChangeEvent): void {
    // STRUCTURAL: a split was created or closed. VS Code renumbers viewColumns,
    // which invalidates our bay IDs (they embed the column), so incremental
    // patching is hopeless — rebuild the state from the native API. resyncAll
    // preserves local-only state (manual drag&drop order) and notifies once.
    if (event.opened.length > 0 || event.closed.length > 0) {
      void this.resyncAll();
      return;
    }

    // NON-STRUCTURAL (event.changed): active group moved and/or group flags.
    // Keep the group-active marker in state (rendered on the next full rebuild;
    // a partial message for it arrives with Fase 2), and update the highlight.
    const nativeActive = vscode.window.tabGroups.activeTabGroup?.viewColumn;
    for (const group of this.stateService.getGroups()) {
      group.isActive = group.id === nativeActive;
    }

    const { hasChanges } = this.activeStateService.syncActiveState();
    if (hasChanges) {
      this.stateService.notifyActiveChange();
    }
  }

  /**
   * Limpia todos los event listeners.
   */
  dispose(): void {
    Logger.log('[BayEvent] Disposing event listeners');
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
