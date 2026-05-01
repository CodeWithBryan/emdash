import { ArrowUp, CheckCircle2, MessageSquare, MessagesSquare, XCircle } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PullRequestComment } from '@shared/pull-requests';
import { summarizeCommentBody } from '@renderer/features/tasks/diff-view/changes-panel/components/pr-entry/pr-comment-utils';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';

interface PrCommentsPopoverProps {
  comments: PullRequestComment[];
  canApplyContext: boolean;
  onApply: (selected: PullRequestComment[]) => void | Promise<void>;
}

function groupKey(comment: PullRequestComment): string {
  if (comment.kind === 'review-thread') {
    return comment.path ? `thread:${comment.path}` : 'thread:(unknown path)';
  }
  if (comment.kind === 'review') return 'reviews';
  return 'comments';
}

function groupLabel(key: string): string {
  if (key === 'reviews') return 'Reviews';
  if (key === 'comments') return 'Conversation';
  return key.startsWith('thread:') ? key.slice('thread:'.length) : key;
}

function reviewMeta(state: PullRequestComment['reviewState']): {
  icon: React.ReactNode;
  label: string;
} | null {
  switch (state) {
    case 'APPROVED':
      return { icon: <CheckCircle2 className="size-3 text-green-500" />, label: 'approved' };
    case 'CHANGES_REQUESTED':
      return {
        icon: <XCircle className="size-3 text-foreground-destructive" />,
        label: 'requested changes',
      };
    case 'COMMENTED':
      return {
        icon: <MessageSquare className="size-3 text-foreground-muted" />,
        label: 'commented',
      };
    case 'DISMISSED':
      return { icon: <XCircle className="size-3 text-foreground-muted" />, label: 'dismissed' };
    default:
      return null;
  }
}

export const PrCommentsPopover = observer(function PrCommentsPopover({
  comments,
  canApplyContext,
  onApply,
}: PrCommentsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(comments.map((c) => c.id))
  );
  const lastIdSetRef = useRef<string>(
    comments
      .map((c) => c.id)
      .sort()
      .join('|')
  );

  // Preserve manual selections across polled refreshes. Only reset when the
  // underlying comment ID set actually changes (added/removed comments).
  useEffect(() => {
    const nextKey = comments
      .map((c) => c.id)
      .sort()
      .join('|');
    if (nextKey === lastIdSetRef.current) return;
    lastIdSetRef.current = nextKey;
    setSelectedIds((prev) => {
      const validIds = new Set(comments.map((c) => c.id));
      const newIds = comments.map((c) => c.id).filter((id) => !prev.has(id));
      const next = new Set<string>();
      for (const id of prev) if (validIds.has(id)) next.add(id);
      for (const id of newIds) next.add(id); // newly arrived comments default to selected
      return next;
    });
  }, [comments]);

  const grouped = useMemo(() => {
    const groups = new Map<string, PullRequestComment[]>();
    for (const c of comments) {
      const k = groupKey(c);
      const existing = groups.get(k) ?? [];
      existing.push(c);
      groups.set(k, existing);
    }
    return groups;
  }, [comments]);

  const summaries = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of comments) map.set(c.id, summarizeCommentBody(c.body, 220));
    return map;
  }, [comments]);

  const count = comments.length;
  const selectedCount = selectedIds.size;
  const allSelected = selectedCount === count && count > 0;

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) =>
      prev.size === count ? new Set<string>() : new Set(comments.map((c) => c.id))
    );
  };

  const handleApply = () => {
    const selected = comments.filter((c) => selectedIds.has(c.id));
    if (selected.length === 0) return;
    void onApply(selected);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Show ${count} PR comment${count === 1 ? '' : 's'}`}
        className="relative self-center flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border bg-background-1 px-2 text-xs font-normal text-foreground hover:bg-background-1/80"
      >
        <MessagesSquare className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-72 truncate">PR comments</span>
        <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-background-3 px-1 text-[10px] font-semibold text-foreground-muted">
          {count}
        </span>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[min(560px,92vw)] gap-0 p-0">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">PR comments</div>
            <div className="text-xs text-muted-foreground">
              {selectedCount} of {count} selected
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={toggleAll} disabled={count === 0}>
              {allSelected ? 'Clear' : 'Select all'}
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canApplyContext || selectedCount === 0}
                    onClick={handleApply}
                    aria-label="Add selected PR comments to chat input"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Add selected PR comments to chat input
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <div className="max-h-[min(480px,65vh)] overflow-y-auto">
          {Array.from(grouped.entries()).map(([key, groupComments]) => (
            <div key={key} className="border-b last:border-b-0">
              <div
                className="sticky top-0 z-[1] truncate bg-background-1/95 px-4 py-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur"
                title={groupLabel(key)}
              >
                {groupLabel(key)}
              </div>
              <div>
                {groupComments.map((comment) => {
                  const stateMeta =
                    comment.kind === 'review' ? reviewMeta(comment.reviewState ?? null) : null;
                  const isSelected = selectedIds.has(comment.id);
                  const summary = summaries.get(comment.id) ?? '';
                  return (
                    <label
                      key={comment.id}
                      className="group flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                    >
                      <Checkbox
                        className="mt-1"
                        checked={isSelected}
                        onCheckedChange={() => toggleOne(comment.id)}
                        aria-label={`Toggle comment from ${comment.author?.login ?? 'unknown'}`}
                      />
                      {comment.author?.avatarUrl ? (
                        <img
                          src={comment.author.avatarUrl}
                          alt={comment.author.login}
                          className="mt-0.5 size-5 shrink-0 rounded-full"
                        />
                      ) : (
                        <div className="mt-0.5 size-5 shrink-0 rounded-full bg-background-3" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {comment.author?.login ?? 'unknown'}
                          </span>
                          {stateMeta ? (
                            <span className="flex items-center gap-1">
                              {stateMeta.icon}
                              <span>{stateMeta.label}</span>
                            </span>
                          ) : null}
                          {comment.kind === 'review-thread' && comment.line ? (
                            <span className="font-mono text-[11px]">
                              line {comment.line}
                              {comment.outdated ? ' (outdated)' : ''}
                            </span>
                          ) : null}
                          <span className="ml-auto">
                            <RelativeTime value={comment.createdAt} compact ago />
                          </span>
                        </div>
                        <div className="mt-1 line-clamp-3 break-words text-sm leading-snug text-foreground">
                          {summary || '(no body)'}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
});
