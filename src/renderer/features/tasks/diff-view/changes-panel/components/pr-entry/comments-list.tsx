import { CheckCircle2, ExternalLink, MessageSquare, XCircle } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import type { PullRequest, PullRequestComment } from '@shared/pull-requests';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';
import { sanitizeCommentBody } from './pr-comment-utils';

function reviewBadge(state: PullRequestComment['reviewState']): {
  icon: React.ReactNode;
  label: string;
  accentClass: string;
} | null {
  switch (state) {
    case 'APPROVED':
      return {
        icon: <CheckCircle2 className="size-3.5 text-green-500" />,
        label: 'approved',
        accentClass: 'border-l-green-500/60',
      };
    case 'CHANGES_REQUESTED':
      return {
        icon: <XCircle className="size-3.5 text-foreground-destructive" />,
        label: 'requested changes',
        accentClass: 'border-l-foreground-destructive/70',
      };
    case 'COMMENTED':
      return {
        icon: <MessageSquare className="size-3.5 text-foreground-muted" />,
        label: 'reviewed',
        accentClass: 'border-l-border',
      };
    case 'DISMISSED':
      return {
        icon: <XCircle className="size-3.5 text-foreground-muted" />,
        label: 'dismissed',
        accentClass: 'border-l-border',
      };
    default:
      return null;
  }
}

function CommentItem({ comment }: { comment: PullRequestComment }) {
  const badge = comment.kind === 'review' ? reviewBadge(comment.reviewState ?? null) : null;
  const author = comment.author;
  const sanitized = useMemo(() => sanitizeCommentBody(comment.body), [comment.body]);

  return (
    <div
      className={cn(
        'group relative flex flex-col gap-2 rounded-md border border-border bg-background-1 px-3.5 py-3 border-l-2',
        badge?.accentClass ?? 'border-l-border'
      )}
    >
      <div className="flex items-center gap-2 text-xs">
        {author?.avatarUrl ? (
          <img src={author.avatarUrl} alt={author.login} className="size-5 shrink-0 rounded-full" />
        ) : (
          <div className="size-5 shrink-0 rounded-full bg-background-3" />
        )}
        <span className="font-medium text-foreground">{author?.login ?? 'unknown'}</span>
        {badge ? (
          <span className="flex items-center gap-1 text-foreground-muted">
            {badge.icon}
            <span>{badge.label}</span>
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-2 text-foreground-passive">
          <RelativeTime value={comment.createdAt} compact ago />
          {comment.url ? (
            <button
              type="button"
              onClick={() => rpc.app.openExternal(comment.url!)}
              className="rounded p-0.5 opacity-0 transition-opacity hover:bg-background-3 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
              aria-label="Open on GitHub"
            >
              <ExternalLink className="size-3" />
            </button>
          ) : null}
        </span>
      </div>

      {comment.kind === 'review-thread' && comment.path ? (
        <div className="flex items-center gap-1.5 rounded-sm bg-background-2 px-2 py-1 font-mono text-[11px] text-foreground-muted">
          <span className="truncate">
            {comment.path}
            {comment.line ? `:${comment.line}` : ''}
          </span>
          {comment.outdated ? (
            <span className="ml-auto shrink-0 rounded-sm bg-background-3 px-1 py-0.5 text-[10px] uppercase tracking-wide text-foreground-passive">
              outdated
            </span>
          ) : null}
        </div>
      ) : null}

      {sanitized.length > 0 ? (
        <MarkdownRenderer
          content={sanitized}
          variant="compact"
          className="text-sm leading-relaxed"
        />
      ) : (
        <span className="text-xs italic text-foreground-passive">(no body)</span>
      )}
    </div>
  );
}

export const PrCommentsList = observer(function PrCommentsList({ pr }: { pr: PullRequest }) {
  const provisioned = useProvisionedTask();
  const prStore = provisioned.workspace.pr;
  const resource = prStore.getComments(pr);
  const isLoading = resource.data == null;
  const sorted = useMemo(
    () => [...(resource.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [resource.data]
  );

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (sorted.length === 0) {
    return <EmptyState label="No comments" description="No PR comments yet" />;
  }

  return (
    <div className="flex flex-col gap-3 py-3">
      {sorted.map((c) => (
        <CommentItem key={c.id} comment={c} />
      ))}
    </div>
  );
});
