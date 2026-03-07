import * as vscode         from 'vscode';
import * as path           from 'path';
import { BayStateService } from '../core/BayStateService';
import type { GitStatus }  from '../../models/Bay';

/**
 * Encapsula toda la sincronización con Git (status + listeners de repositorio).
 */
export class GitSyncService {
  private disposables                  : vscode.Disposable[] = [];
  private _gitApi                      : any | null = null;
  private _gitRepoListeners            = new Set<string>();
  private _gitOpenRepoListenerAttached = false;

  constructor(private stateService: BayStateService) {}

  activate(context: vscode.ExtensionContext): void {
    this._gitApi = this.resolveGitApi();

    // Extension change listener (for when Git extension is installed/enabled)
    this.disposables.push(
      vscode.extensions.onDidChange(() => {
        const oldApi = this._gitApi;
        this._gitApi = this.resolveGitApi();
        if (!oldApi && this._gitApi) {
          this.setupGitListeners();
          this.refreshAllGitStatuses();
        }
      }),
    );

    // Try to initialize immediately if Git is ready
    if (this._gitApi && this._gitApi.repositories.length > 0) {
      this.setupGitListeners();
      this.refreshAllGitStatuses();
    } else {

      // Setup listener for when Git opens a repository
      const setupOnRepoOpen = () => {
        const gitApi = this.resolveGitApi();
        if (gitApi && !this._gitOpenRepoListenerAttached) {
          this._gitApi = gitApi;
          this._gitOpenRepoListenerAttached = true;

          this.disposables.push(
            gitApi.onDidOpenRepository((repo: any) => {
              this.attachGitRepoListener(repo);
              this.updateGitStatusForRepo(repo);
            }),
          );

          // If repositories already exist, setup listeners now
          if (gitApi.repositories.length > 0) {
            this.setupGitListeners();
            this.refreshAllGitStatuses();
          }
        }
      };

      // Try immediately
      setupOnRepoOpen();

      // Retry after delays
      setTimeout(() => {
        if (!this._gitApi || this._gitApi.repositories.length === 0) {
          setupOnRepoOpen();
        }
      }, 500);

      setTimeout(() => {
        if (!this._gitApi || this._gitApi.repositories.length === 0) {
          setupOnRepoOpen();
        }
      }, 2000);
    }

    context.subscriptions.push(...this.disposables);
  }

  getGitStatus(uri: vscode.Uri): GitStatus {
    try {
      const targetPath = this.normalizeFsPath(uri.fsPath);
      if (!targetPath) { return null; }

      if (!this._gitApi) { this._gitApi = this.resolveGitApi(); }
      if (!this._gitApi || this._gitApi.repositories.length === 0) { return null; }


      for (const repo of this._gitApi.repositories) {
        const repoRoot = this.normalizeFsPath(repo?.rootUri?.fsPath);
        if (!repoRoot || !this.isPathInsideRepo(targetPath, repoRoot)) { continue; }

        const mergeChanges = repo.state.mergeChanges || [];
        const hasMergeConflict = mergeChanges.some((c: any) => this.changeMatchesPath(c, targetPath));
        if (hasMergeConflict) {
          return 'conflict';
        }

        const indexChanges = repo.state.indexChanges || [];
        const indexChange = indexChanges.find((c: any) => this.changeMatchesPath(c, targetPath));

        const workingTreeChanges = repo.state.workingTreeChanges || [];
        const workingChange = workingTreeChanges.find((c: any) => this.changeMatchesPath(c, targetPath));

        const indexStatus = this.mapGitApiStatus(indexChange?.status);
        const workingStatus = this.mapGitApiStatus(workingChange?.status);

        if (indexStatus === 'added' && workingStatus === 'modified') {
          return 'modified';
        }

        const finalStatus = workingStatus ?? indexStatus ?? null;
        return finalStatus;
      }
    } catch {
      // Silently fail if git is not available
    }

    return null;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this._gitRepoListeners.clear();
    this._gitOpenRepoListenerAttached = false;
  }

  private resolveGitApi(): any | null {
    try {
      const ext = vscode.extensions.getExtension('vscode.git');
      const api = ext?.isActive ? ext.exports?.getAPI(1) ?? null : null;
      return api;
    } catch (err) {
      return null;
    }
  }

  private setupGitListeners(): void {
    try {
      if (!this._gitApi) { this._gitApi = this.resolveGitApi(); }
      const gitApi = this._gitApi;
      if (!gitApi) {
        return;
      }

      for (const repo of gitApi.repositories) {
        this.attachGitRepoListener(repo);
      }

      if (!this._gitOpenRepoListenerAttached) {
        this._gitOpenRepoListenerAttached = true;
        this.disposables.push(
          gitApi.onDidOpenRepository((repo: any) => {
            this.attachGitRepoListener(repo);
            this.updateGitStatusForRepo(repo);
          }),
        );
      }
    } catch {
      // Silently fail if git setup fails
    }
  }

  private attachGitRepoListener(repo: any): void {
    const repoRoot = this.normalizeFsPath(repo?.rootUri?.fsPath);
    if (!repoRoot) {
      return;
    }
    if (this._gitRepoListeners.has(repoRoot)) {
      return;
    }

    this._gitRepoListeners.add(repoRoot);
    this.disposables.push(
      repo.state.onDidChange(() => {
        this.updateGitStatusForRepo(repo);
      }),
    );
  }

  private refreshAllGitStatuses(): void {
    for (const bay of this.stateService.getAllBays()) {
      const uri = bay.metadata.uri;
      if (!uri) { continue; }

      const newGitStatus = this.getGitStatus(uri);
      if (bay.state.gitStatus !== newGitStatus) {
        bay.state.gitStatus = newGitStatus;
        this.stateService.updateBayStateWithAnimation(bay);
      }
    }
  }

  private updateGitStatusForRepo(repo: any): void {
    const repoRoot = this.normalizeFsPath(repo?.rootUri?.fsPath);
    if (!repoRoot) { return; }

    for (const bay of this.stateService.getAllBays()) {
      const uri = bay.metadata.uri;
      if (!uri) { continue; }
      const targetPath = this.normalizeFsPath(uri.fsPath);
      if (!targetPath || !this.isPathInsideRepo(targetPath, repoRoot)) { continue; }

      const newGitStatus = this.getGitStatus(uri);

      if (bay.state.gitStatus !== newGitStatus) {
        bay.state.gitStatus = newGitStatus;
        this.stateService.updateBayStateWithAnimation(bay);
      }
    }
  }

  private mapGitApiStatus(status: number | undefined): GitStatus {
    switch (status) {
      case 7: return 'untracked';
      case 1:
      case 9: return 'added';
      case 0:
      case 3:
      case 4:
      case 5:
      case 10:
      case 11:
        return 'modified';
      case 2:
      case 6: return 'deleted';
      case 8: return 'ignored';
      case 12:
      case 13:
      case 14:
      case 15:
      case 16:
      case 17:
      case 18:
        return 'conflict';
      default:
        return status === undefined ? null : 'modified';
    }
  }

  private changeMatchesPath(change: any, targetPath: string): boolean {
    const current = this.normalizeFsPath(change?.uri?.fsPath);
    const original = this.normalizeFsPath(change?.originalUri?.fsPath);
    return current === targetPath || original === targetPath;
  }

  private isPathInsideRepo(filePath: string, repoRoot: string): boolean {
    return filePath === repoRoot || filePath.startsWith(`${repoRoot}${path.sep}`);
  }

  private normalizeFsPath(fsPath: string | undefined): string | null {
    if (!fsPath) { return null; }
    const normalized = path.normalize(fsPath);
    return path.sep === '\\' ? normalized.toLowerCase() : normalized;
  }
}
