import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as fssync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Bay } from '../../models/Bay';
import { BayHelpers } from '../../models/BayHelpers';
import { Logger } from '../../platform/logger';

/**
 * Reads Claude Code's conversation title from its on-disk transcripts and uses it
 * as the bay's display name.
 *
 * Why this exists: a Claude Code chat tab is a webview whose title VS Code exposes
 * (`Tab.label`) is deliberately truncated by Claude to `summary.substring(0,24)+"…"`.
 * The FULL untruncated title lives in the session transcript at
 * `~/.claude/projects/<workspace-slug>/<sessionId>.jsonl` as the last `ai-title`
 * line: `{type:"ai-title", aiTitle:"…", sessionId:"…"}`. There's no VS Code API to
 * read another extension's webview state, so we go to the transcript directly.
 *
 * Coupling warning: this depends on Claude Code's `~/.claude` layout and JSONL
 * format (verified on v2.1.218) and degrades cleanly — if nothing matches, the bay
 * keeps the native (truncated) tab label.
 */

// Lowercased substring of the chat panel's viewType (`mainThreadWebview-claudeVSCodePanel`).
const CLAUDE_PANEL_VIEWTYPE = 'claudevscodepanel';
// How much of the transcript tail to scan for the last ai-title before a full read.
const TAIL_BYTES = 256 * 1024;
// Cap on transcripts scanned per project dir (newest first) when matching a tab.
const MAX_TRANSCRIPTS = 24;

export class ClaudeConversationService {
  private readonly projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  // transcript path → { title, mtimeMs } — invalidated when the file's mtime moves.
  private readonly titleCache = new Map<string, { title: string; mtimeMs: number }>();
  private watchers: fssync.FSWatcher[] = [];
  private disposed = false;

  /** True for Claude Code conversation (chat) webview tabs. */
  static isClaudeConversationBay(bay: Bay): boolean {
    return bay.metadata.bayType === 'webview'
      && (bay.metadata.viewType ?? '').toLowerCase().includes(CLAUDE_PANEL_VIEWTYPE);
  }

  /** Workspace fsPath → Claude project-dir slug: `c:\A\B` → `c--A-B`. */
  private slugFor(fsPath: string): string {
    return fsPath.replace(/[:\\/]/g, '-');
  }

  /** Existing `projects/<slug>` dirs for the open workspace folders (case-insensitive). */
  private async projectDirs(): Promise<string[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) { return []; }

    let entries: string[];
    try { entries = await fs.readdir(this.projectsRoot); }
    catch { return []; }

    const byLower = new Map(entries.map(e => [e.toLowerCase(), e]));
    const dirs: string[] = [];
    for (const folder of folders) {
      const slug = this.slugFor(folder.uri.fsPath);
      const real = byLower.get(slug.toLowerCase());
      if (real) { dirs.push(path.join(this.projectsRoot, real)); }
      else { Logger.log(`[ClaudeConv] no transcript dir for workspace "${folder.uri.fsPath}" (slug "${slug}")`); }
    }
    return dirs;
  }

  /** Last `ai-title` in a transcript, cached by mtime. Reads only the tail first. */
  private async lastTitle(file: string): Promise<string | undefined> {
    let stat: fssync.Stats;
    try { stat = await fs.stat(file); }
    catch { return undefined; }

    const cached = this.titleCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) { return cached.title; }

    const title = await this.scanTitle(file, stat.size);
    if (title !== undefined) { this.titleCache.set(file, { title, mtimeMs: stat.mtimeMs }); }
    return title;
  }

  private async scanTitle(file: string, size: number): Promise<string | undefined> {
    // Title lines are emitted frequently, so the current title is almost always in
    // the tail; only fall back to a full read if the tail doesn't contain one.
    const fromTail = await this.readTitle(file, Math.max(0, size - TAIL_BYTES), size, size > TAIL_BYTES);
    if (fromTail !== undefined) { return fromTail; }
    if (size <= TAIL_BYTES) { return undefined; }
    return this.readTitle(file, 0, size, false);
  }

  /**
   * Most recent conversation title in a transcript range. Claude's tab title is the
   * user's `custom-title` when set, otherwise the auto-generated `ai-title` — so a
   * non-empty custom title wins. Scans from the end for the newest of each type.
   */
  private async readTitle(file: string, start: number, end: number, dropPartialFirstLine: boolean): Promise<string | undefined> {
    let fh: fs.FileHandle | undefined;
    try {
      fh = await fs.open(file, 'r');
      const len = end - start;
      if (len <= 0) { return undefined; }
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start);
      let text = buf.toString('utf8');
      if (dropPartialFirstLine) {
        const nl = text.indexOf('\n');
        if (nl >= 0) { text = text.slice(nl + 1); }
      }
      const lines = text.split('\n');
      let custom: string | undefined;
      let ai: string | undefined;
      for (let i = lines.length - 1; i >= 0 && (custom === undefined || ai === undefined); i--) {
        const line = lines[i];
        if (custom === undefined && line.includes('"custom-title"')) {
          try {
            const obj = JSON.parse(line);
            if (obj?.type === 'custom-title' && typeof obj.customTitle === 'string') { custom = obj.customTitle; }
          } catch { /* partial line */ }
        } else if (ai === undefined && line.includes('"ai-title"')) {
          try {
            const obj = JSON.parse(line);
            if (obj?.type === 'ai-title' && typeof obj.aiTitle === 'string') { ai = obj.aiTitle; }
          } catch { /* partial line */ }
        }
      }
      // A non-empty custom title overrides the ai one; a cleared (empty) custom
      // title falls back to ai. undefined means "not in this range".
      const title = custom && custom.trim() ? custom : ai;
      return title || undefined;
    } catch {
      return undefined;
    } finally {
      await fh?.close();
    }
  }

  /**
   * Full conversation title for a Claude bay, resolved by matching its (truncated)
   * tab label against candidate transcripts' latest ai-title. Returns undefined
   * when there's no unambiguous match (caller falls back to the native label).
   */
  private async resolveFullTitle(tabLabel: string): Promise<string | undefined> {
    // Claude sets the tab title to `aiTitle.substring(0,24)+"…"`; strip the marker
    // to get the prefix. A brand-new session shows the generic "Claude Code".
    const prefix = tabLabel.endsWith('…') ? tabLabel.slice(0, -1) : tabLabel;
    if (!prefix || prefix === 'Claude Code') { return undefined; }

    const matches = new Set<string>();
    for (const dir of await this.projectDirs()) {
      let files: string[];
      try { files = (await fs.readdir(dir)).filter(f => f.endsWith('.jsonl')); }
      catch { continue; }

      const stated = await Promise.all(files.map(async f => {
        const p = path.join(dir, f);
        try { return { p, m: (await fs.stat(p)).mtimeMs }; }
        catch { return { p, m: 0 }; }
      }));
      stated.sort((a, b) => b.m - a.m);

      for (const { p } of stated.slice(0, MAX_TRANSCRIPTS)) {
        const title = await this.lastTitle(p);
        if (title && title.startsWith(prefix)) { matches.add(title); }
      }
    }
    return matches.size === 1 ? [...matches][0] : undefined;
  }

  /**
   * Resolves the best display name for each Claude bay (full ai-title when found,
   * else the current native tab label) and mutates `metadata.label` in place.
   * Returns the ids whose label actually changed, for a partial webview patch.
   *
   * Mutating metadata.label is safe here: a webview bay's identity derives from the
   * stable viewType, never the label (see tabConverter.generateId).
   */
  async enrichLabels(bays: Bay[]): Promise<string[]> {
    const changed: string[] = [];
    for (const bay of bays) {
      const full   = await this.resolveFullTitle(bay.metadata.label);
      const native = BayHelpers.findNativeTab(bay.metadata, bay.state)?.label;
      const desired = full ?? native ?? bay.metadata.label;

      if (desired && desired !== bay.metadata.label) {
        Logger.log(`[ClaudeConv] "${bay.metadata.label}" → "${desired}"${full ? '' : ' (native fallback — no transcript match)'}`);
        bay.metadata.label = desired;
        bay.metadata.tooltipText = full ?? desired;
        changed.push(bay.metadata.id);
      }
    }
    return changed;
  }

  /** Watches the workspace transcript dirs; fires `onChange` (debounced) on any write. */
  watch(onChange: () => void): void {
    void this.projectDirs().then(dirs => {
      if (this.disposed) { return; }
      let timer: NodeJS.Timeout | undefined;
      const fire = () => {
        if (timer) { clearTimeout(timer); }
        timer = setTimeout(onChange, 800);
      };
      for (const dir of dirs) {
        try {
          this.watchers.push(fssync.watch(dir, { persistent: false }, () => fire()));
          Logger.log(`[ClaudeConv] Watching transcripts: ${dir}`);
        } catch (err) {
          Logger.warn(`[ClaudeConv] watch failed for ${dir}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.watchers) { try { w.close(); } catch { /* already gone */ } }
    this.watchers = [];
  }
}
