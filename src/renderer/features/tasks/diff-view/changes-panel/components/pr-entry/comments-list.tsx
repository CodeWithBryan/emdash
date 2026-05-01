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

function reviewBadge(state: PullRequestComment['reviewState']): {
  icon: React.ReactNode;
  label: string;
} | null {
  switch (state) {
    case 'APPROVED':
      return {
        icon: <CheckCircle2 className="size-3 text-green-500" />,
        label: 'approved',
      };
    case 'CHANGES_REQUESTED':
      return {
        icon: <XCircle className="size-3 text-foreground-destructive" />,
        label: 'requested changes',
      };
    case 'COMMENTED':
      return {
        icon: <MessageSquare className="size-3 text-foreground-muted" />,
        label: 'reviewed',
      };
    case 'DISMISSED':
      return { icon: <XCircle className="size-3 text-foreground-muted" />, label: 'dismissed' };
    default:
      return null;
  }
}

function CommentItem({ comment }: { comment: PullRequestComment }) {
  const badge = comment.kind === 'review' ? reviewBadge(comment.reviewState ?? null) : null;
  const author = comment.author;

  return (
    <div className="group flex flex-col gap-1.5 rounded-md border border-border bg-background-1 px-3 py-2.5">
      <div className="flex items-center gap-2 text-xs text-foreground-muted">
        {author?.avatarUrl ? (
          <img src={author.avatarUrl} alt={author.login} className="size-4 rounded-full" />
        ) : null}
        <span className="font-medium text-foreground">{author?.login ?? 'unknown'}</span>
        {badge ? (
          <span className="flex items-center gap-1">
            {badge.icon}
            <span>{badge.label}</span>
          </span>
        ) : null}
        {comment.kind === 'review-thread' && comment.path ? (
          <span className="truncate font-mono text-[11px] text-foreground-passive">
            {comment.path}
            {comment.line ? `:${comment.line}` : ''}
            {comment.outdated ? ' (outdated)' : ''}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          <RelativeTime value={comment.createdAt} compact ago />
          {comment.url ? (
            <button
              type="button"
              onClick={() => rpc.app.openExternal(comment.url!)}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Open on GitHub"
            >
              <ExternalLink className="size-3" />
            </button>
          ) : null}
        </span>
      </div>
      {comment.body.trim().length > 0 ? (
        <MarkdownRenderer
          content={comment.body}
          variant="compact"
          className="text-sm leading-snug"
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
    <div className="flex flex-col gap-2 py-3">
      {sorted.map((c) => (
        <CommentItem key={c.id} comment={c} />
      ))}
    </div>
  );
});
