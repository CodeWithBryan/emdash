import type { PullRequestComment } from '@shared/pull-requests';
import type { Issue } from '@shared/tasks';
import { ISSUE_PROVIDER_META } from '@renderer/features/integrations/issue-provider-meta';

const MAX_LABEL_TITLE_LENGTH = 24;

export type ContextActionKind = 'linked-issue' | 'draft-comments' | 'review-prompt' | 'pr-comments';

export interface ContextAction {
  id: string;
  kind: ContextActionKind;
  label: string;
  text: string;
  provider?: Issue['provider'];
}

function normalizeWhitespace(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function issueLabel(issue: Issue): string {
  const identifier = normalizeWhitespace(issue.identifier);
  const title = truncate(normalizeWhitespace(issue.title), MAX_LABEL_TITLE_LENGTH);
  if (identifier && title) return `${identifier} ${title}`;
  if (identifier) return identifier;
  if (title) return title;
  return 'Linked issue';
}

function issueInjectionText(issue: Issue): string {
  const providerDisplay = ISSUE_PROVIDER_META[issue.provider]?.displayName ?? issue.provider;
  const parts = [
    `Provider: ${providerDisplay}`,
    `Identifier: ${normalizeWhitespace(issue.identifier)}`,
    `Title: ${normalizeWhitespace(issue.title)}`,
    `URL: ${normalizeWhitespace(issue.url)}`,
    issue.description ? `Description: ${normalizeWhitespace(issue.description)}` : undefined,
    issue.status ? `Status: ${normalizeWhitespace(issue.status)}` : undefined,
    issue.assignees?.length
      ? `Assignees: ${issue.assignees.map(normalizeWhitespace).filter(Boolean).join(', ')}`
      : undefined,
    issue.project ? `Project: ${normalizeWhitespace(issue.project)}` : undefined,
  ].filter(Boolean);

  if (parts.length === 0) {
    return 'Linked issue context';
  }

  return parts.join(' | ');
}

export function buildLinkedIssueContextAction(issue?: Issue): ContextAction | null {
  if (!issue) return null;
  const normalizedIdentifier = normalizeWhitespace(issue.identifier) || 'unknown';
  return {
    id: `linked-issue:${issue.provider}:${normalizedIdentifier}`,
    kind: 'linked-issue',
    label: issueLabel(issue),
    text: issueInjectionText(issue),
    provider: issue.provider,
  };
}

export function buildReviewPromptContextAction(reviewPrompt?: string): ContextAction | null {
  const text = (reviewPrompt ?? '').trim();
  if (!text) return null;
  return {
    id: 'review-prompt',
    kind: 'review-prompt',
    label: 'Review prompt',
    text,
  };
}

export function buildDraftCommentsContextAction(args: {
  count: number;
  formattedComments?: string;
}): ContextAction | null {
  const text = (args.formattedComments ?? '').trim();
  if (!text || args.count <= 0) return null;

  return {
    id: 'draft-comments',
    kind: 'draft-comments',
    label: `Comments (${args.count})`,
    text,
  };
}

const MAX_PR_COMMENTS_FOR_CONTEXT = 200;
const MAX_PR_COMMENT_BODY_CHARS = 500;

function formatPrCommentForAgent(comment: PullRequestComment): string {
  const author = comment.author?.login ?? 'unknown';
  const normalized = normalizeWhitespace(comment.body) || '(no body)';
  const body = truncate(normalized, MAX_PR_COMMENT_BODY_CHARS);
  const headerParts: string[] = [author];
  if (comment.kind === 'review' && comment.reviewState) {
    headerParts.push(comment.reviewState.toLowerCase().replace('_', ' '));
  }
  if (comment.kind === 'review-thread' && comment.path) {
    const loc = comment.line ? `${comment.path}:${comment.line}` : comment.path;
    headerParts.push(`on ${loc}${comment.outdated ? ' (outdated)' : ''}`);
  }
  return `[${headerParts.join(' — ')}] ${body}`;
}

export function buildPrCommentsContextAction(
  comments?: PullRequestComment[]
): ContextAction | null {
  if (!comments || comments.length === 0) return null;
  const total = comments.length;
  const capped = comments.slice(0, MAX_PR_COMMENTS_FOR_CONTEXT);
  const lines = capped.map(formatPrCommentForAgent);
  const truncatedNote =
    total > capped.length
      ? `\n(${total - capped.length} additional comment${total - capped.length === 1 ? '' : 's'} omitted)`
      : '';
  const text = `PR comments:\n${lines.map((l) => `- ${l}`).join('\n')}${truncatedNote}`;
  return {
    id: 'pr-comments',
    kind: 'pr-comments',
    label: `PR comments (${total})`,
    text,
  };
}

export function buildTaskContextActions(
  linkedIssue?: Issue,
  reviewPrompt?: string,
  draftComments?: { count: number; formattedComments?: string },
  prComments?: PullRequestComment[]
): ContextAction[] {
  const linkedIssueAction = buildLinkedIssueContextAction(linkedIssue);
  const draftCommentsAction = draftComments ? buildDraftCommentsContextAction(draftComments) : null;
  const reviewPromptAction = buildReviewPromptContextAction(reviewPrompt);
  const prCommentsAction = buildPrCommentsContextAction(prComments);
  const actions: ContextAction[] = [];
  if (linkedIssueAction) actions.push(linkedIssueAction);
  if (draftCommentsAction) actions.push(draftCommentsAction);
  if (prCommentsAction) actions.push(prCommentsAction);
  if (reviewPromptAction) actions.push(reviewPromptAction);
  return actions;
}
