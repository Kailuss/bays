import * as vscode         from 'vscode';
import * as path           from 'path';
import { BayStateService } from '../core/BayStateService';
import type { GitStatus }  from '../../models/Bay';
import type { GitApi, GitChange, GitExtensionExports, GitRepository } from './gitApiTypes';

/**
 * Encapsula toda la sincronización con Git (status + listeners de repositorio).
 */
export class GitSyncService {
  private disposables                  : vscode.Disposable[] = [];
  private _gitApi                      : GitApi | null = null;
  private _gitRepoListeners            = new Map<string, vscode.Disposable>();
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
          this.attachRepoLifecycleListeners(gitApi);

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

      // The timed retries above only help if vscode.git is already active.
      // extensions.onDidChange does NOT fire on activation (only install/enable),
      // so on a slow workspace where git activates after 2s the retries would all
      // resolve to null and live git badge updates would be lost for the session.
      // Proactively activate the git extension and wire listeners once its API is up.
      const gitExt = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
      if (gitExt) {
        const wireWhenReady = () => {
          const api = this.resolveGitApi();
          if (api) {
            this._gitApi = api;
            this.setupGitListeners();       // idempotent: guarded per-repo + single lifecycle listener
            this.refreshAllGitStatuses();
          }
        };
        if (gitExt.isActive) {
          wireWhenReady();
        } else {
          gitExt.activate().then(wireWhenReady, () => { /* ignore activation failure */ });
        }
      }
    }

    context.subscriptions.push(...this.disposables);
  }

  getGitStatus(uri: vscode.Uri): GitStatus {
    try {
      const targetPath = this.normalizeFsPath(uri.fsPath);
      if (!targetPath) { return null; }

      if (!this._gitApi) { this._gitApi = this.resolveGitApi(); }
      if (!this._gitApi || this._gitApi.repositories.length === 0) { return null; }


      // Pick the MOST SPECIFIC repository: a file inside a submodule/nested repo
      // is prefix-"inside" both the parent and the inner root, so returning from
      // the first prefix match (parent, whose change lists never contain inner
      // files) would report null forever. The longest matching root is the repo
      // that actually tracks the file.
      let bestRepo: GitRepository | null = null;
      let bestRootLen = -1;
      for (const repo of this._gitApi.repositories) {
        const repoRoot = this.normalizeFsPath(repo?.rootUri?.fsPath);
        if (!repoRoot || !this.isPathInsideRepo(targetPath, repoRoot)) { continue; }
        if (repoRoot.length > bestRootLen) {
          bestRootLen = repoRoot.length;
          bestRepo = repo;
        }
      }

      if (bestRepo) {
        const mergeChanges = bestRepo.state.mergeChanges || [];
        const hasMergeConflict = mergeChanges.some(c => this.changeMatchesPath(c, targetPath));
        if (hasMergeConflict) {
          return 'conflict';
        }

        const indexChanges = bestRepo.state.indexChanges || [];
        const indexChange = indexChanges.find(c => this.changeMatchesPath(c, targetPath));

        const workingTreeChanges = bestRepo.state.workingTreeChanges || [];
        const workingChange = workingTreeChanges.find(c => this.changeMatchesPath(c, targetPath));

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
    this._gitRepoListeners.forEach(sub => sub.dispose());
    this._gitRepoListeners.clear();
    this._gitOpenRepoListenerAttached = false;
  }

  private resolveGitApi(): GitApi | null {
    try {
      const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
      return ext?.isActive ? ext.exports?.getAPI(1) ?? null : null;
    } catch {
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

      this.attachRepoLifecycleListeners(gitApi);
    } catch {
      // Silently fail if git setup fails
    }
  }

  private attachGitRepoListener(repo: GitRepository): void {
    const repoRoot = this.normalizeFsPath(repo?.rootUri?.fsPath);
    if (!repoRoot) {
      return;
    }
    if (this._gitRepoListeners.has(repoRoot)) {
      return;
    }

    const sub = repo.state.onDidChange(() => {
      this.updateGitStatusForRepo(repo);
    });
    this._gitRepoListeners.set(repoRoot, sub);
    this.disposables.push(sub);
  }

  /**
   * Detaches the state listener for a closed repository so that reopening it
   * (which delivers a brand-new repo object) re-attaches a fresh subscription.
   * Without this, the root stays in the map forever and the reopened repo's
   * stage/unstage/commit events never refresh git badges until a full restart.
   */
  private detachGitRepoListener(repo: GitRepository): void {
    const repoRoot = this.normalizeFsPath(repo?.rootUri?.fsPath);
    if (!repoRoot) { return; }
    const sub = this._gitRepoListeners.get(repoRoot);
    if (sub) {
      sub.dispose();
      this._gitRepoListeners.delete(repoRoot);
    }
  }

  /**
   * Subscribes to repository open/close lifecycle events exactly once. Kept in a
   * helper so both bootstrap paths (immediate setup and the delayed retry) wire
   * the same listeners under a single guard.
   */
  private attachRepoLifecycleListeners(gitApi: GitApi): void {
    if (this._gitOpenRepoListenerAttached) { return; }
    this._gitOpenRepoListenerAttached = true;

    this.disposables.push(
      gitApi.onDidOpenRepository(repo => {
        this.attachGitRepoListener(repo);
        this.updateGitStatusForRepo(repo);
      }),
    );
    this.disposables.push(
      gitApi.onDidCloseRepository(repo => {
        this.detachGitRepoListener(repo);
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

  private updateGitStatusForRepo(repo: GitRepository): void {
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

  private changeMatchesPath(change: GitChange, targetPath: string): boolean {
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
