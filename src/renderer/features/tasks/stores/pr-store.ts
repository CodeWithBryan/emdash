import { makeAutoObservable, observable, type IObservableArray } from 'mobx';
import { gitRefChangedChannel, gitWorkspaceChangedChannel } from '@shared/events/gitEvents';
import { commitRef, mergeBaseRange, refsEqual, remoteRef, type GitChange } from '@shared/git';
import { parseGitHubRepository } from '@shared/github-repository';
import {
  isForkPr,
  pullRequestErrorMessage,
  selectCurrentPr,
  type PullRequest,
  type PullRequestComment,
} from '@shared/pull-requests';
import type { Task } from '@shared/tasks';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import { isRegistered, type TaskStore } from './task';

type MergeMode = 'merge' | 'squash' | 'rebase';
export type MergeResult = { success: true } | { success: false; error: string };

/** Extract the numeric PR number from the identifier field (e.g. "#123" → 123). */
function prNumberFromIdentifier(identifier: string | null): number | null {
  if (!identifier) return null;
  const n = Number.parseInt(identifier.replace('#', ''), 10);
  return Number.isNaN(n) ? null : n;
}

export class PrStore {
  private readonly _prFiles = new Map<
    string,
    { resource: Resource<GitChange[]>; headRefOid: string }
  >();
  private readonly _prComments = new Map<
    string,
    { resource: Resource<PullRequestComment[]>; updatedAt: string }
  >();
  /** Per-PR set of comment IDs the user has already injected into a chat. */
  private readonly _consumedCommentIds = observable.map<string, Set<string>>(new Map(), {
    deep: false,
  });

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly repositoryStore: RepositoryStore,
    private readonly tasks: IObservableArray<TaskStore>
  ) {
    makeAutoObservable(this);
  }

  get pullRequests(): PullRequest[] {
    const task = this.tasks[0];
    if (!task || !isRegistered(task)) return [];
    return (task.data as Task).prs ?? [];
  }

  get currentPr(): PullRequest | undefined {
    return selectCurrentPr(this.pullRequests);
  }

  getFiles(pr: PullRequest): Resource<GitChange[]> {
    const key = pr.url;
    const existing = this._prFiles.get(key);
    if (existing && existing.headRefOid !== pr.headRefOid) {
      existing.resource.dispose();
      this._prFiles.delete(key);
    }
    if (!this._prFiles.has(key)) {
      const resource = new Resource<GitChange[]>(
        () => this._fetchPrFiles(pr),
        [
          { kind: 'poll', intervalMs: 60_000, pauseWhenHidden: true, demandGated: true },
          {
            kind: 'event',
            subscribe: (handler) => {
              const unsubHead = events.on(gitWorkspaceChangedChannel, (p) => {
                if (p.workspaceId === this.workspaceId && p.kind === 'head') handler();
              });
              const unsubBaseRef = events.on(gitRefChangedChannel, (p) => {
                if (p.projectId !== this.projectId || p.kind !== 'remote-refs') return;
                const baseRef = remoteRef(this.repositoryStore.configuredRemote, pr.baseRefName);
                const relevant = !p.changedRefs || p.changedRefs.some((r) => refsEqual(r, baseRef));
                if (relevant) handler();
              });
              const unsubPrHead = events.on(gitRefChangedChannel, (p) => {
                if (p.projectId !== this.projectId || p.kind !== 'remote-refs') return;
                const sameRepoRef = remoteRef(
                  this.repositoryStore.configuredRemote,
                  pr.headRefName
                );
                const forkOwner = isForkPr(pr)
                  ? (parseGitHubRepository(pr.headRepositoryUrl)?.owner ?? null)
                  : null;
                const forkRef = forkOwner ? remoteRef(forkOwner, pr.headRefName) : null;
                const relevant =
                  !p.changedRefs ||
                  p.changedRefs.some(
                    (r) => refsEqual(r, sameRepoRef) || (forkRef != null && refsEqual(r, forkRef))
                  );
                if (relevant) handler();
              });
              return () => {
                unsubHead();
                unsubBaseRef();
                unsubPrHead();
              };
            },
            onEvent: 'reload',
            debounceMs: 500,
          },
        ]
      );
      resource.start();
      this._prFiles.set(key, { resource, headRefOid: pr.headRefOid });
    }
    return this._prFiles.get(key)!.resource;
  }

  private _consumedStorageKey(prUrl: string): string {
    return `pr-consumed-comments:${prUrl}`;
  }

  private _loadConsumedFromStorage(prUrl: string): Set<string> {
    try {
      const raw = localStorage.getItem(this._consumedStorageKey(prUrl));
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? new Set(parsed.filter((v) => typeof v === 'string'))
        : new Set();
    } catch {
      return new Set();
    }
  }

  private _persistConsumed(prUrl: string, ids: Set<string>): void {
    try {
      localStorage.setItem(this._consumedStorageKey(prUrl), JSON.stringify(Array.from(ids)));
    } catch {
      // Ignore quota errors — consumed state is best-effort.
    }
  }

  consumedCommentIds(prUrl: string): ReadonlySet<string> {
    let set = this._consumedCommentIds.get(prUrl);
    if (!set) {
      set = this._loadConsumedFromStorage(prUrl);
      this._consumedCommentIds.set(prUrl, set);
    }
    return set;
  }

  getUnsentComments(pr: PullRequest): PullRequestComment[] {
    const all = this.getComments(pr).data ?? [];
    const consumed = this.consumedCommentIds(pr.url);
    if (consumed.size === 0) return all;
    return all.filter((c) => !consumed.has(c.id));
  }

  markCommentsConsumed(prUrl: string, ids: string[]): void {
    if (ids.length === 0) return;
    const next = new Set(this.consumedCommentIds(prUrl));
    for (const id of ids) next.add(id);
    this._consumedCommentIds.set(prUrl, next);
    this._persistConsumed(prUrl, next);
  }

  unmarkCommentConsumed(prUrl: string, id: string): void {
    const current = this.consumedCommentIds(prUrl);
    if (!current.has(id)) return;
    const next = new Set(current);
    next.delete(id);
    this._consumedCommentIds.set(prUrl, next);
    this._persistConsumed(prUrl, next);
  }

  resetConsumedComments(prUrl: string): void {
    if (
      !this._consumedCommentIds.has(prUrl) &&
      !localStorage.getItem(this._consumedStorageKey(prUrl))
    ) {
      return;
    }
    this._consumedCommentIds.set(prUrl, new Set());
    this._persistConsumed(prUrl, new Set());
  }

  getComments(pr: PullRequest): Resource<PullRequestComment[]> {
    const key = pr.url;
    const existing = this._prComments.get(key);
    if (existing && existing.updatedAt !== pr.updatedAt) {
      existing.resource.dispose();
      this._prComments.delete(key);
    }
    if (!this._prComments.has(key)) {
      const resource = new Resource<PullRequestComment[]>(
        () => this._fetchPrComments(pr),
        [{ kind: 'poll', intervalMs: 60_000, pauseWhenHidden: true, demandGated: true }]
      );
      resource.start();
      this._prComments.set(key, { resource, updatedAt: pr.updatedAt });
    }
    return this._prComments.get(key)!.resource;
  }

  private async _fetchPrComments(pr: PullRequest): Promise<PullRequestComment[]> {
    const prNumber = prNumberFromIdentifier(pr.identifier);
    if (!prNumber) return [];
    const result = await rpc.pullRequests.getPullRequestComments(pr.repositoryUrl, prNumber);
    if (!result.success) return [];
    return result.data.comments;
  }

  async mergePr(
    id: string,
    options: { strategy: MergeMode; commitHeadOid?: string }
  ): Promise<MergeResult> {
    const pr = this.pullRequests.find((p) => p.url === id);
    if (!pr) {
      captureTelemetry('pr_merged', {
        strategy: options.strategy,
        success: false,
        error_type: 'pr_not_found',
        project_id: this.projectId,
        task_id: this.workspaceId,
      });
      return { success: false, error: 'Pull request not found' };
    }

    const prNumber = prNumberFromIdentifier(pr.identifier);
    if (!prNumber) return { success: false, error: 'Could not determine PR number' };

    const result = await rpc.pullRequests.mergePullRequest(pr.repositoryUrl, prNumber, options);
    if (result.success) {
      captureTelemetry('pr_merged', {
        strategy: options.strategy,
        success: true,
        project_id: this.projectId,
        task_id: this.workspaceId,
      });
      return { success: true };
    }

    captureTelemetry('pr_merged', {
      strategy: options.strategy,
      success: false,
      error_type: 'merge_failed',
      project_id: this.projectId,
      task_id: this.workspaceId,
    });
    return { success: false, error: pullRequestErrorMessage(result.error) };
  }

  async markReadyForReview(id: string): Promise<void> {
    const pr = this.pullRequests.find((p) => p.url === id);
    if (!pr) return;
    const prNumber = prNumberFromIdentifier(pr.identifier);
    if (!prNumber) return;
    await rpc.pullRequests.markReadyForReview(pr.repositoryUrl, prNumber);
  }

  /**
   * Trigger a single PR refresh from GitHub. The updated PR will arrive via
   * `prUpdatedChannel` and be merged into `task.data.prs` by `TaskManagerStore`.
   */
  refresh(id: string): void {
    const pr = this.pullRequests.find((p) => p.url === id);
    if (!pr) return;

    const prNumber = prNumberFromIdentifier(pr.identifier);
    if (prNumber) {
      void rpc.pullRequests.refreshPullRequest(pr.repositoryUrl, prNumber);
    }

    // Also trigger a check-run sync — the result arrives embedded in the
    // next prUpdatedChannel event emitted by syncChecks.
    void rpc.pullRequests.syncChecks(pr.url, pr.headRefOid);
  }

  dispose(): void {
    for (const entry of this._prFiles.values()) entry.resource.dispose();
    for (const entry of this._prComments.values()) entry.resource.dispose();
  }

  private async _fetchPrFiles(pr: PullRequest): Promise<GitChange[]> {
    const remote = this.repositoryStore.configuredRemote;
    // Dereference the MobX-observable Remote into a plain object — MobX proxies
    // cannot be structured-cloned by Electron IPC and will throw.
    const plainRemote = { name: remote.name, url: remote.url };
    const baseRef = remoteRef(plainRemote, pr.baseRefName);
    const headRef = commitRef(pr.headRefOid);
    const range = mergeBaseRange(baseRef, headRef);

    const tryRange = async (): Promise<GitChange[] | null> => {
      const result = await rpc.git.getChangedFiles(this.projectId, this.workspaceId, range);
      if (!result.success) return null;
      const changes = result.data.changes;
      const expectedChangedFiles = pr.changedFiles ?? 0;
      if (expectedChangedFiles > 0 && changes.length === 0) return null;
      if (expectedChangedFiles > 0 && changes.length > expectedChangedFiles * 2) return null;
      return changes;
    };

    const first = await tryRange();
    if (first) return first;

    // headRefOid not available locally — fetch the PR branch then retry
    const prNumber = prNumberFromIdentifier(pr.identifier);
    if (prNumber) {
      await rpc.repository.fetchPrForReview(
        this.projectId,
        prNumber,
        pr.headRefName,
        pr.headRepositoryUrl,
        isForkPr(pr)
      );
    }
    return (await tryRange()) ?? [];
  }
}
