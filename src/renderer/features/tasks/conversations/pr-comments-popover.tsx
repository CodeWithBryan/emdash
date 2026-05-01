import { ArrowUp, MessagesSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import type { PullRequestComment } from '@shared/pull-requests';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
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

function reviewStateLabel(state: PullRequestComment['reviewState']): string | null {
  switch (state) {
    case 'APPROVED':
      return 'approved';
    case 'CHANGES_REQUESTED':
      return 'requested changes';
    case 'COMMENTED':
      return 'commented';
    case 'DISMISSED':
      return 'dismissed';
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // Default to all selected; reset when comment set changes (added/removed).
  useEffect(() => {
    setSelectedIds(new Set(comments.map((c) => c.id)));
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
      <Tooltip>
        <TooltipTrigger>
          <PopoverTrigger className="relative self-center flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border bg-background-1 px-2 text-xs font-normal text-foreground hover:bg-background-1/80">
            <MessagesSquare className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-72 truncate">PR comments</span>
            <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-background-3 px-1 text-[10px] font-semibold text-foreground-muted">
              {count}
            </span>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {canApplyContext
            ? `${count} PR comment${count === 1 ? '' : 's'}`
            : 'Create and select a conversation first'}
        </TooltipContent>
      </Tooltip>

      <PopoverContent align="start" className="w-[min(520px,92vw)] gap-0 p-0">
        <div className="border-b px-4 py-3 flex flex-row justify-between items-center gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">PR comments</div>
            <div className="text-xs text-muted-foreground">
              {selectedCount} of {count} selected
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
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

        <div className="max-h-[min(420px,60vh)] overflow-y-auto">
          <div className="divide-y">
            {Array.from(grouped.entries()).map(([key, groupComments]) => (
              <div key={key} className="py-2">
                <div
                  className="truncate px-4 pb-1 text-xs font-medium text-muted-foreground"
                  title={groupLabel(key)}
                >
                  {groupLabel(key)}
                </div>
                <div className="space-y-1">
                  {groupComments.map((comment) => {
                    const stateLabel =
                      comment.kind === 'review'
                        ? reviewStateLabel(comment.reviewState ?? null)
                        : null;
                    const isSelected = selectedIds.has(comment.id);
                    return (
                      <label
                        key={comment.id}
                        className="group flex cursor-pointer items-start gap-2 px-4 py-2 transition-colors hover:bg-muted/40"
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={isSelected}
                          onCheckedChange={() => toggleOne(comment.id)}
                          aria-label={`Toggle comment from ${comment.author?.login ?? 'unknown'}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {comment.author?.login ?? 'unknown'}
                            </span>
                            {stateLabel ? <span>{stateLabel}</span> : null}
                            {comment.kind === 'review-thread' && comment.line ? (
                              <span className="font-mono text-[11px]">
                                line {comment.line}
                                {comment.outdated ? ' (outdated)' : ''}
                              </span>
                            ) : null}
                          </div>
                          <div className="line-clamp-3 break-words text-sm leading-snug">
                            {comment.body.trim().length > 0 ? comment.body : '(no body)'}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
});
