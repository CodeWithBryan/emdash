/**
 * Strip artifacts that bot-authored PR comments leak into bodies (HTML comments,
 * stray `<details>`/`<summary>` markers from collapsed sections, leading
 * whitespace runs). Returns markdown-safe text.
 */
export function sanitizeCommentBody(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?details[^>]*>/gi, '')
    .replace(/<\/?summary[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Reduce a markdown body to a single-line plain-text preview suitable for
 * dense list rows (popover items). Removes markdown syntax, HTML tags, and
 * collapses whitespace.
 */
export function summarizeCommentBody(body: string, maxLen = 240): string {
  const stripped = sanitizeCommentBody(body)
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/^>\s?/gm, '')
    .replace(/^#+\s+/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped.length <= maxLen) return stripped || '(no body)';
  return `${stripped.slice(0, maxLen - 1).trimEnd()}…`;
}
