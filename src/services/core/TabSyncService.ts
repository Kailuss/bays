import * as vscode                                             from 'vscode';
import { BayStateService }                                     from './BayStateService';
import { GitSyncService }                                      from '../integration/GitSyncService';
import { BayHierarchyService }                                 from './BayHierarchyService';
import { DocumentManager }                                     from './DocumentManager';
import { SideTab }                                             from '../../models/SideTab';
import { createTabGroup }                                      from '../../models/SideTabGroup';
import { convertToSideTab, generateIdFromNativeTab, getDiagnosticSeverity } from './helpers/tabConverter';
import { Logger }                                              from '../../utils/logger';

/**
 * Mantiene el estado interno de pestañas sincronizado con VS Code.
 * En palabras sencillas: escucha los eventos del editor (abrir/cerrar/mover)
 * y actualiza el `TabStateService` para que la UI muestre datos fiables.
 * Esta capa solo transforma datos — no hace operaciones de disco pesadas.
 * 
 * NOTA: Las tabs de Markdown Preview se filtran directamente en convertToSideTab()
 * y se manejan como estado toggle (viewMode) en la tab del archivo fuente.
 * 
 * REFACTORIZACIÓN: Código modularizado en helpers y servicios especializados.
 * @see docs/PLAN_OPTIMIZACION_TABSYNC.md
 */
export class TabSyncService {
  private disposables: vscode.Disposable[] = [];
  private gitSyncService: GitSyncService;
  private hierarchyService: BayHierarchyService;
  private documentManager: DocumentManager;
  
  // Map para relacionar IDs de tabs con versionIds únicos del DocumentModel
  // Esto permite rastrear qué version del documento corresponde a cada child tab
  private readonly tabIdToVersionId: Map<string, string> = new Map();

  constructor(private stateService: BayStateService) {
    this.gitSyncService = new GitSyncService(this.stateService);
    this.hierarchyService = new BayHierarchyService(this.stateService);
    this.documentManager = new DocumentManager({
      autoCleanup: true,
      cleanupInterval: 300000, // 5 minutes
      inactivityThreshold: 600000, // 10 minutes
    });
    
    // Inject services into state service to avoid circular dependencies
    this.stateService.setHierarchyService(this.hierarchyService);
    this.stateService.setDocumentManager(this.documentManager);
  }
  
  /** Get access to the document manager for external use */
  getDocumentManager(): DocumentManager {
    return this.documentManager;
  }

  /** Registra los listeners necesarios y realiza una sincronización inicial.
   *  Resultado: el `TabStateService` queda poblado y listo para la UI. */
  activate(context: vscode.ExtensionContext): void {
    this.syncAll();

    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs(e => this.handleTabChanges(e)),
    );

    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabGroups(e => this.handleGroupChanges(e)),
    );

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
          this.updateActiveTab(editor.document.uri);
        }
      }),
    );

    // Listener para cambios en diagnósticos (errores/warnings)
    this.disposables.push(
      vscode.languages.onDidChangeDiagnostics(e => {
        for (const uri of e.uris) {
          this.updateTabDiagnostics(uri);
        }
      }),
    );

    // Listener para cambios en la selección del editor (posición del cursor)
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection(e => {
        this.handleCursorChange(e);
      }),
    );

    // Sincronización/estado Git (servicio dedicado)
    this.gitSyncService.activate(context);

    context.subscriptions.push(...this.disposables);
  }

  //: Manejadores de eventos (qué hacer cuando cambian las pestañas)
  private async handleTabChanges(e: vscode.TabChangeEvent): Promise<void> {
    for (const tab of e.opened) {
      const st = convertToSideTab(tab, this.gitSyncService);
      if (st) {
        // ✅ CORREGIDO: Si es child tab, esperar a que parent exista antes de añadir
        if (st.metadata.parentId) {
          await this.ensureParentExists(st, tab);
          const parentTab = this.stateService.getTab(st.metadata.parentId);
          if (parentTab) {
            Logger.log(`[TabSync] Child tab opened: ${st.metadata.label} (id: ${st.metadata.id}, parentId: ${st.metadata.parentId}, diffType: ${st.metadata.diffType})`);
            this.hierarchyService.inheritState(st, parentTab);
            // Añadir tab primero, luego registrar en jerarquía
            this.stateService.addTab(st);
            this.hierarchyService.registerChild(st.metadata.id, st.metadata.parentId);
            
            // Register child version in DocumentManager
            this.registerTabVersion(st, parentTab);
          } else {
            // Parent no existe, añadir como tab huérfana
            Logger.log(`[TabSync] Orphan child tab: ${st.metadata.label} (parentId: ${st.metadata.parentId} not found)`);
            this.stateService.addTab(st);
          }
        } else {
          // Tab normal (no child)
          if (st.state.isPreview) {
            Logger.log('[TabSync] Opened preview tab: ' + st.metadata.label);
          }
          this.stateService.addTab(st);
          
          // Register or create document for non-child tabs with URI
          if (st.metadata.uri) {
            this.ensureDocumentExists(st);
          }
        }
      }
    }

    // For closed tabs, don't try to regenerate the ID (it may not match the
    // original for unknown/webview/diff tabs). Instead, build the set of IDs
    // that *still exist* in VS Code and remove any internal tab that is gone.
    if (e.closed.length > 0) {
      this.removeOrphanedTabs();
    }

    for (const tab of e.changed) {
      const st = convertToSideTab(tab, this.gitSyncService);
      if (!st) { continue; }

      const existing = this.stateService.getTab(st.metadata.id);
      if (!existing) {
        this.stateService.updateTab(st);
        continue;
      }

      const onlyActive =
        existing.state.isDirty   === tab.isDirty   &&
        existing.state.isPinned  === tab.isPinned  &&
        existing.state.isPreview === tab.isPreview &&
        existing.state.isActive  !== tab.isActive;

      // Log cuando una preview tab se convierte en permanente
      if (existing.state.isPreview && !tab.isPreview) {
        Logger.log('[TabSync] Preview tab became permanent: ' + existing.metadata.label);
      }

      existing.state.isActive  = tab.isActive;
      existing.state.isDirty   = tab.isDirty;
      existing.state.isPinned  = tab.isPinned;
      existing.state.isPreview = tab.isPreview;

      // Solo actualizar git/diagnósticos en cambios estructurales (no solo isActive)
      if (!onlyActive && existing.metadata.uri) {
        const oldGitStatus = existing.state.gitStatus;
        const oldDiagnostics = existing.state.diagnosticSeverity;
        existing.state.gitStatus = this.gitSyncService.getGitStatus(existing.metadata.uri);
        existing.state.diagnosticSeverity = getDiagnosticSeverity(existing.metadata.uri);
        if (oldGitStatus !== existing.state.gitStatus || oldDiagnostics !== existing.state.diagnosticSeverity) {
          Logger.log(`[TabSync] handleTabChanges - updated git/diagnostics: ${existing.metadata.label}, gitStatus: ${oldGitStatus} -> ${existing.state.gitStatus}, diagnostics: ${oldDiagnostics} -> ${existing.state.diagnosticSeverity}`);
        }
      }

      if (onlyActive) { this.stateService.updateTabSilent(existing); }
      else            { this.stateService.updateTab(existing);       }
    }

    // Sincronizar estado activo de todas las tabs del grupo afectado
    // Esto es crucial para webview tabs que no disparan onDidChangeActiveTextEditor
    this.syncActiveState();
  }

  private handleGroupChanges(e: vscode.TabGroupChangeEvent): void {
    for (const g of e.opened)  { this.stateService.addGroup(createTabGroup(g)); }
    for (const g of e.closed)  { this.stateService.removeGroup(g.viewColumn); }

    if (e.changed.length > 0) {
      this.stateService.setActiveGroup(vscode.window.tabGroups.activeTabGroup.viewColumn);
    }
  }

  //: Sincronización completa (reconstruir todo el estado) 
  private async syncAll(): Promise<void> {
    for (const group of vscode.window.tabGroups.all) {
      this.stateService.addGroup(createTabGroup(group));
    }

    const allTabs: SideTab[] = [];
    const childTabs: Array<{ sideTab: SideTab; nativeTab: vscode.Tab }> = [];
    
    // First pass: collect all tabs, separating parents from children
    for (const group of vscode.window.tabGroups.all) {
      group.tabs.forEach((tab, idx) => {
        const st = convertToSideTab(tab, this.gitSyncService, idx);
        if (st) {
          if (st.metadata.parentId) {
            // This is a child tab (diff) - defer it
            childTabs.push({ sideTab: st, nativeTab: tab });
          } else {
            // This is a parent tab or standalone tab - add it immediately
            allTabs.push(st);
          }
        }
      });
    }
    
    // Second pass: process child tabs after parents are loaded
    // Process sequentially to ensure parents are opened before children are added
    for (const { sideTab, nativeTab } of childTabs) {
      // Ensure parent exists (will create it if found in native tabs but not yet converted)
      await this.ensureParentExistsForSync(sideTab, nativeTab, allTabs);
      allTabs.push(sideTab);
    }
    
    this.stateService.replaceTabs(allTabs);
    
    // ✅ NUEVO: Recalcular jerarquía después de sync completo
    this.hierarchyService.recalculateAllCounts();
  }

  /**
   * Asegura que el parent tab de un diff exista en el estado.
   * Si el archivo base no está abierto como tab, lo abre automáticamente
   * y lo añade al estado, luego asocia el child tab.
   */
  private async ensureParentExists(childTab: SideTab, nativeChildTab: vscode.Tab): Promise<void> {
    const parentId = childTab.metadata.parentId;
    if (!parentId) { return; }

    // Check if parent already exists
    if (this.stateService.getTab(parentId)) {
      return; // Parent exists, all good
    }

    // Parent doesn't exist - we need to find or create it
    // For diff tabs, the parent is the file tab with the same URI in the same group
    const group = nativeChildTab.group;
    const childUri = childTab.metadata.uri;
    if (!childUri) { return; }

    // Search for a file tab with matching URI in the same group
    let parentNativeTab: vscode.Tab | undefined;
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        if (tab.input.uri.toString() === childUri.toString()) {
          parentNativeTab = tab;
          break;
        }
      }
    }

    // If found in the group, convert and add it
    if (parentNativeTab) {
      const parentSideTab = convertToSideTab(parentNativeTab, this.gitSyncService);
      if (parentSideTab) {
        Logger.log(`[TabSync] Creating parent tab for child: ${childTab.metadata.label} → ${parentSideTab.metadata.label}`);
        this.stateService.addTab(parentSideTab);
        // Inherit state from parent
        this.hierarchyService.inheritState(childTab, parentSideTab);
      }
    } else {
      // Parent tab doesn't exist in VS Code - open it automatically
      Logger.log(`[TabSync] Parent tab not found, opening automatically: ${childUri.fsPath}`);
      
      try {
        // Open the file in the same group as the child tab
        const doc = await vscode.workspace.openTextDocument(childUri);
        await vscode.window.showTextDocument(doc, {
          viewColumn: group.viewColumn,
          preview: false, // Open as non-preview to ensure it stays open
          preserveFocus: true, // Don't steal focus from current tab
        });
        
        // After opening, search for the newly created tab and add it to state
        // The onDidChangeTabs event will eventually catch it, but we can add it immediately
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputText) {
            if (tab.input.uri.toString() === childUri.toString()) {
              const parentSideTab = convertToSideTab(tab, this.gitSyncService);
              if (parentSideTab) {
                Logger.log(`[TabSync] Successfully opened and added parent tab: ${parentSideTab.metadata.label}`);
                this.stateService.addTab(parentSideTab);
                this.hierarchyService.inheritState(childTab, parentSideTab);
              }
              break;
            }
          }
        }
      } catch (error) {
        // If we can't open the parent (e.g., file doesn't exist anymore),
        // the child will be rendered as orphan
        Logger.log(`[TabSync] Failed to open parent tab: ${error}`);
      }
    }
  }

  /**
   * Versión de ensureParentExists para el contexto de syncAll.
   * Busca el parent en el array temporal antes de que se agregue al estado.
   * Si no existe, lo abre automáticamente.
   */
  private async ensureParentExistsForSync(childTab: SideTab, nativeChildTab: vscode.Tab, allTabs: SideTab[]): Promise<void> {
    const parentId = childTab.metadata.parentId;
    if (!parentId) { return; }

    // Check if parent already exists in the array
    const existingParent = allTabs.find(t => t.metadata.id === parentId);
    if (existingParent) {
      // Inherit state from parent
      this.hierarchyService.inheritState(childTab, existingParent);
      return; // Parent exists, all good
    }

    // Parent doesn't exist - we need to find or create it
    const group = nativeChildTab.group;
    const childUri = childTab.metadata.uri;
    if (!childUri) { return; }

    // Search for a file tab with matching URI in the same group
    let parentNativeTab: vscode.Tab | undefined;
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        if (tab.input.uri.toString() === childUri.toString()) {
          parentNativeTab = tab;
          break;
        }
      }
    }

    // If found, convert and add it to the array
    if (parentNativeTab) {
      const parentSideTab = convertToSideTab(parentNativeTab, this.gitSyncService);
      if (parentSideTab) {
        Logger.log(`[TabSync] Creating parent tab for child during syncAll: ${childTab.metadata.label} → ${parentSideTab.metadata.label}`);
        allTabs.push(parentSideTab);
        this.hierarchyService.inheritState(childTab, parentSideTab);
      }
    } else {
      // Parent tab doesn't exist in VS Code - open it automatically
      Logger.log(`[TabSync] Parent tab not found during sync, opening automatically: ${childUri.fsPath}`);
      
      try {
        // Open the file in the same group as the child tab
        const doc = await vscode.workspace.openTextDocument(childUri);
        await vscode.window.showTextDocument(doc, {
          viewColumn: group.viewColumn,
          preview: false, // Open as non-preview to ensure it stays open
          preserveFocus: true, // Don't steal focus from current tab
        });
        
        // After opening, search for the newly created tab and add it to array
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputText) {
            if (tab.input.uri.toString() === childUri.toString()) {
              const parentSideTab = convertToSideTab(tab, this.gitSyncService);
              if (parentSideTab) {
                Logger.log(`[TabSync] Successfully opened and added parent tab during sync: ${parentSideTab.metadata.label}`);
                allTabs.push(parentSideTab);
                this.hierarchyService.inheritState(childTab, parentSideTab);
              }
              break;
            }
          }
        }
      } catch (error) {
        // If we can't open the parent (e.g., file doesn't exist anymore),
        // the child will be rendered as orphan
        Logger.log(`[TabSync] Failed to open parent tab during sync: ${error}`);
      }
    }
  }

  //: Seguimiento de la pestaña activa (actualiza solo isActive) 
  private updateActiveTab(activeUri: vscode.Uri): void {
    // Delegate to syncActiveState which reads tab.isActive from the native API.
    // This correctly handles the same file open in multiple groups
    // (only the focused group's tab will have isActive === true).
    this.syncActiveState();

    // Sync cursor position when activating a tab from the parent-child family
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.toString() === activeUri.toString()) {
      const tab = this.stateService.findTabByUri(activeUri);
      if (tab && (tab.metadata.parentId || tab.state.hasChildren)) {
        // This tab is part of a parent-child family, sync cursor position
        const selection = activeEditor.selection;
        const line = selection.active.line + 1;
        const column = selection.active.character + 1;
        this.hierarchyService.syncCursorPosition(tab.metadata.id, line, column);
      }
    }
  }

  /**
   * Maneja cambios en la posición del cursor (selección).
   * Sincroniza la posición entre parent y children si está habilitado.
   */
  private handleCursorChange(event: vscode.TextEditorSelectionChangeEvent): void {
    const uri = event.textEditor.document.uri;
    const selection = event.selections[0]; // Primary selection
    
    if (!selection) {
      return;
    }

    // Get line and column (1-based)
    const line = selection.active.line + 1;
    const column = selection.active.character + 1;

    // Find tab by URI
    const tab = this.stateService.findTabByUri(uri);
    if (!tab) {
      return;
    }

    // Sync cursor position with family (parent + children)
    this.hierarchyService.syncCursorPosition(tab.metadata.id, line, column);
  }

  /**
   * Actualiza los diagnósticos y git status de una pestaña específica cuando cambian.
   */
  private updateTabDiagnostics(uri: vscode.Uri): void {
    const tab = this.stateService.findTabByUri(uri);
    if (!tab) { return; }

    const newDiagnosticSeverity = getDiagnosticSeverity(uri);
    const newGitStatus = this.gitSyncService.getGitStatus(uri);

    Logger.log(`[TabSync] updateTabDiagnostics - ${tab.metadata.label}: diagnostics: ${tab.state.diagnosticSeverity} -> ${newDiagnosticSeverity}, gitStatus: ${tab.state.gitStatus} -> ${newGitStatus}`);

    if (tab.state.diagnosticSeverity !== newDiagnosticSeverity || 
        tab.state.gitStatus !== newGitStatus) {
      Logger.log('[TabSync] ✅ Updating tab state with animation for: ' + tab.metadata.label);
      tab.state.diagnosticSeverity = newDiagnosticSeverity;
      tab.state.gitStatus = newGitStatus;
      this.stateService.updateTabStateWithAnimation(tab);
    }
  }

  /**
   * Sincroniza el estado isActive e isPreview de todas las tabs con el estado real de VS Code.
   * Esto es especialmente importante para:
   * - Webview tabs (Settings, Extensions, etc.) que no disparan onDidChangeActiveTextEditor.
   * - Preview tabs que pueden convertirse en permanentes sin disparar el evento onChange.
   * - Markdown Previews: cuando están activos, la tab del archivo fuente debe mostrarse activa.
   * - **Garantiza que solo una tab por grupo esté visualmente activa.**
   * 
   * NOTA: viewMode es una preferencia persistente del usuario por tab.
   * Cada tab recuerda si prefiere verse en modo preview o source.
   * 
   * Público para permitir sincronización bajo demanda antes de operaciones críticas.
   */
  public syncActiveState(): void {
    // First, detect if a Markdown Preview is active (we filter these tabs)
    // If so, we need to mark the corresponding source file tab as active
    let activeMarkdownSourceId: string | null = null;
    let activeMarkdownSourceUri: vscode.Uri | null = null;
    
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.isActive && tab.input instanceof vscode.TabInputWebview) {
          // Check if it's a Markdown Preview
          if (tab.input.viewType === 'markdown.preview' || 
              (tab.label.startsWith('Preview ') && (tab.label.endsWith('.md') || tab.label.endsWith('.mdx') || tab.label.endsWith('.markdown')))) {
            
            // Extract the source file name from the preview label
            const sourceFileName = tab.label.replace('Preview ', '');
            
            // Find the actual source tab in the same group by matching the filename
            for (const sourceTab of group.tabs) {
              if (sourceTab.input instanceof vscode.TabInputText) {
                const sourcePath = sourceTab.input.uri.path;
                if (sourcePath.endsWith('/' + sourceFileName) || 
                    sourcePath.endsWith('\\' + sourceFileName)) {
                  // Found the source tab that matches the preview
                  activeMarkdownSourceUri = sourceTab.input.uri;
                  activeMarkdownSourceId = `${sourceTab.input.uri.toString()}-${group.viewColumn}`;
                  
                  // Update the tracker to reflect the currently previewed document
                  // This is important when navigating between documents via internal links
                  if (this.stateService.lastMarkdownPreviewTabId !== activeMarkdownSourceId) {
                    Logger.log(`[TabSync] Preview navigated to different document: ${sourceFileName}`);
                    this.stateService.setLastMarkdownPreviewTabId(activeMarkdownSourceId);
                    
                    // Also update the tab's viewMode to 'preview' if not already set
                    const sourceTabInstance = this.stateService.getTab(activeMarkdownSourceId);
                    if (sourceTabInstance && sourceTabInstance.state.viewMode !== 'preview') {
                      sourceTabInstance.state.viewMode = 'preview';
                      Logger.log(`[TabSync] Set viewMode=preview for newly previewed tab: ${sourceFileName}`);
                    }
                  }
                  break;
                }
              }
            }
            
            // FALLBACK: If we couldn't find by filename match, try using the last tracked ID
            // (but this is less accurate and may be stale)
            if (!activeMarkdownSourceId) {
              const lastPreviewTabId = this.stateService.lastMarkdownPreviewTabId;
              if (lastPreviewTabId) {
                const lastTab = this.stateService.getTab(lastPreviewTabId);
                // Verify it's still in the same group
                if (lastTab && lastTab.state.groupId === group.viewColumn) {
                  activeMarkdownSourceId = lastPreviewTabId;
                }
              }
            }
          }
        }
      }
    }

    // Track active tab per group to ensure only one is active
    const activeTabPerGroup = new Map<number, string>(); // viewColumn -> tabId

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const id = this.generateIdFromNativeTab(tab);
        if (!id) { continue; }

        const existing = this.stateService.getTab(id);
        if (!existing) { continue; }

        // Determine if this tab should be active
        let shouldBeActive = tab.isActive;
        
        // If a Markdown Preview is active, mark its source file as active instead
        if (activeMarkdownSourceId && existing.metadata.id === activeMarkdownSourceId) {
          shouldBeActive = true;
        }

        // Track active tab for this group
        if (shouldBeActive) {
          const viewColumn = existing.state.viewColumn;
          const currentActive = activeTabPerGroup.get(viewColumn);
          
          if (currentActive) {
            // Already have an active tab in this group - deactivate this one
            Logger.log(`[TabSync] Multiple active tabs detected in group ${viewColumn}. Deactivating: ${existing.metadata.label}`);
            shouldBeActive = false;
          } else {
            activeTabPerGroup.set(viewColumn, id);
          }
        }

        // Sincronizar isActive e isPreview para mantener el estado actualizado
        const activeChanged = existing.state.isActive !== shouldBeActive;
        const previewChanged = existing.state.isPreview !== tab.isPreview;
        
        if (activeChanged || previewChanged) {
          existing.state.isActive = shouldBeActive;
          existing.state.isPreview = tab.isPreview;
          this.stateService.updateTabSilent(existing);
        }
      }
    }

    // Additional safety: ensure all tabs in the same group as the active tab are deactivated
    for (const [viewColumn, activeTabId] of activeTabPerGroup) {
      const allTabsInGroup = this.stateService.getAllTabs()
        .filter(tab => tab.state.viewColumn === viewColumn);
      
      for (const tab of allTabsInGroup) {
        if (tab.metadata.id !== activeTabId && tab.state.isActive) {
          Logger.log(`[TabSync] Force deactivating tab in group ${viewColumn}: ${tab.metadata.label}`);
          tab.state.isActive = false;
          this.stateService.updateTabSilent(tab);
        }
      }
    }
  }

  /**
   * Builds the set of IDs that currently exist in VS Code and removes any
   * internal tab whose ID is no longer present. This is more reliable than
   * trying to regenerate the ID from a closed-tab event (which may have
   * different properties than the original open event).
   * 
   * Especialmente importante para preview tabs que pueden ser reemplazadas
   * automáticamente por VS Code sin disparar un evento explícito de cierre.
   */
  private removeOrphanedTabs(): void {
    const nativeIds = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const id = this.generateIdFromNativeTab(tab);
        if (id) { nativeIds.add(id); }
      }
    }

    const allTabs = this.stateService.getAllTabs();
    
    for (const tab of allTabs) {
      // ✅ CRITICAL FIX: Child tabs never appear in vscode.window.tabGroups.all
      // They are internal constructs for visualization. Skip orphan removal.
      if (tab.metadata.parentId) {
        continue;
      }
      
      if (!nativeIds.has(tab.metadata.id)) {
        Logger.log(`[TabSync] Removing orphaned tab: ${tab.metadata.label} (wasPreview: ${tab.state.isPreview})`);
        this.stateService.removeTab(tab.metadata.id);
      }
    }
  }

  /**
   * Lightweight ID extraction from a native tab — avoids full `convertToSideTab()`
   * conversion.  Used by `removeOrphanedTabs` and `syncActiveState`.
   */
  private generateIdFromNativeTab(tab: vscode.Tab): string | null {
    return generateIdFromNativeTab(tab);
  }

  /**
   * Asegura que existe un DocumentModel para una tab.
   * Si no existe, lo crea y lo asocia con la tab.
   * 
   * @param tab SideTab para la cual asegurar que existe un documento
   */
  private ensureDocumentExists(tab: SideTab): void {
    if (!tab.metadata.uri) {
      return;
    }

    // Check if document already exists
    const existing = this.documentManager.getDocumentByUri(tab.metadata.uri);
    if (existing) {
      // Associate parent tab if not already associated
      if (!existing.parentTabId) {
        this.documentManager.associateParentTab(existing.documentId, tab.metadata.id);
      }
      return;
    }

    // Create new document
    const document = this.documentManager.createDocument({
      baseUri: tab.metadata.uri,
      languageId: tab.metadata.languageId || 'plaintext',
      fileName: tab.metadata.fileName || 'untitled',
      fileExtension: tab.metadata.fileExtension,
      parentTabId: tab.metadata.id,
      fileSize: tab.metadata.fileSize,
      isReadOnly: tab.metadata.isReadOnly,
      isBinary: tab.metadata.isBinary,
    });

    Logger.log(`[TabSync] Created document for tab: ${tab.metadata.label} (docId: ${document.documentId})`);
  }

  /**
   * Registra una versión (diff) de un documento en el DocumentManager.
   * 
   * @param childTab Child tab que representa la versión
   * @param parentTab Parent tab del documento base
   */
  private registerTabVersion(childTab: SideTab, parentTab: SideTab): void {
    if (!parentTab.metadata.uri || !childTab.metadata.diffType) {
      return;
    }

    // Get or create the document
    const document = this.documentManager.getOrCreateDocument(
      parentTab.metadata.uri,
      parentTab.metadata.languageId || 'plaintext',
      parentTab.metadata.fileName || 'untitled',
      parentTab.metadata.fileExtension
    );

    // Associate parent if not already
    if (!document.parentTabId) {
      this.documentManager.associateParentTab(document.documentId, parentTab.metadata.id);
    }

    // Register the version
    const versionId = this.documentManager.registerVersion(document.documentId, {
      diffType: childTab.metadata.diffType,
      originalUri: childTab.metadata.originalUri,
      modifiedUri: childTab.metadata.uri,
      label: childTab.metadata.label,
      description: childTab.metadata.detailLabel,
      stats: childTab.state.diffStats,
      relatedTabId: childTab.metadata.id,
    });

    if (versionId) {
      // Associate child tab with document
      this.documentManager.associateChildTab(document.documentId, childTab.metadata.id);
      // Map tab ID to unique versionId for future reference
      this.tabIdToVersionId.set(childTab.metadata.id, versionId);
      Logger.log(`[TabSync] Registered version ${childTab.metadata.diffType} for ${parentTab.metadata.label} (tabId: ${childTab.metadata.id}, versionId: ${versionId})`);
    }
  }

  /**
   * Limpia el mapeo de una child tab cuando se cierra
   */
  private cleanupTabVersionMapping(tabId: string): void {
    this.tabIdToVersionId.delete(tabId);
  }
  
  /**
   * Obtiene el versionId único asociado a una tab
   */
  getVersionIdForTab(tabId: string): string | undefined {
    return this.tabIdToVersionId.get(tabId);
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this.gitSyncService.dispose();
    this.documentManager.dispose();
    this.tabIdToVersionId.clear();
  }
}
