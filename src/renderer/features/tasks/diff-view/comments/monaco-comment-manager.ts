import type * as monaco from 'monaco-editor';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DraftComment } from '../stores/draft-comments-store';
import { CommentInput } from './comment-input';
import { CommentWidget } from './comment-widget';

const GUTTER_GLYPH_MARGIN = 2;
const COMMENT_ZONE_HEIGHT_PX = 140 + 24;

type LineRange = { start: number; end: number };

interface MonacoCommentManagerOptions {
  onAddComment: (
    startLineNumber: number,
    endLineNumber: number,
    content: string,
    lineContent?: string
  ) => void | Promise<void>;
  onEditComment: (id: string, content: string) => void | Promise<void>;
  onDeleteComment: (id: string) => void | Promise<void>;
}

export class MonacoCommentManager {
  private readonly editor: monaco.editor.IStandaloneDiffEditor;
  private readonly options: MonacoCommentManagerOptions;

  private viewZoneRoots: Map<
    string,
    { zoneId: string; root: Root; domNode: HTMLElement; endLineNumber: number }
  > = new Map();

  private decorationIds: string[] = [];
  private hoverDecorationIds: string[] = [];
  private pinnedDecorationIds: string[] = [];
  private hoveredLine: number | null = null;

  private inputZoneId: string | null = null;
  private inputRoot: Root | null = null;
  private inputDomNode: HTMLElement | null = null;
  private activeInputRange: LineRange | null = null;

  private dragAnchorLine: number | null = null;
  private dragCurrentLine: number | null = null;
  private documentMouseUpHandler: ((e: MouseEvent) => void) | null = null;

  private disposed = false;
  private gutterMouseDownDisposable: monaco.IDisposable | null = null;
  private hoverMoveDisposable: monaco.IDisposable | null = null;
  private hoverLeaveDisposable: monaco.IDisposable | null = null;

  constructor(editor: monaco.editor.IStandaloneDiffEditor, options: MonacoCommentManagerOptions) {
    this.editor = editor;
    this.options = options;
    this.setupGutterMouseDownHandler();
    this.setupHoverHandler();
  }

  private setupGutterMouseDownHandler() {
    const modifiedEditor = this.editor.getModifiedEditor();

    this.gutterMouseDownDisposable = modifiedEditor.onMouseDown((e) => {
      if (e.target.type !== GUTTER_GLYPH_MARGIN) return;
      const targetElement = e.target.element;
      if (!targetElement?.classList.contains('comment-hover-icon')) return;

      const lineNumber = e.target.position?.lineNumber;
      if (!lineNumber) return;

      e.event?.preventDefault();
      e.event?.stopPropagation();

      this.startDrag(lineNumber);
    });
  }

  private startDrag(lineNumber: number) {
    this.dragAnchorLine = lineNumber;
    this.dragCurrentLine = lineNumber;
    this.setHoverDecorationsForRange(lineNumber, lineNumber);

    const handleUp = () => {
      document.removeEventListener('mouseup', handleUp, true);
      this.documentMouseUpHandler = null;
      this.commitDrag();
    };
    this.documentMouseUpHandler = handleUp;
    document.addEventListener('mouseup', handleUp, true);
  }

  private commitDrag() {
    if (this.dragAnchorLine === null || this.dragCurrentLine === null) {
      this.dragAnchorLine = null;
      this.dragCurrentLine = null;
      return;
    }

    const start = Math.min(this.dragAnchorLine, this.dragCurrentLine);
    const end = Math.max(this.dragAnchorLine, this.dragCurrentLine);
    this.dragAnchorLine = null;
    this.dragCurrentLine = null;

    const modifiedEditor = this.editor.getModifiedEditor();
    const model = modifiedEditor.getModel();
    const lineContent = model
      ? Array.from({ length: end - start + 1 }, (_, i) => model.getLineContent(start + i)).join(
          '\n'
        )
      : '';

    this.showInputAt(start, end, lineContent);
  }

  private setupHoverHandler() {
    const modifiedEditor = this.editor.getModifiedEditor();

    this.hoverMoveDisposable = modifiedEditor.onMouseMove((e) => {
      if (this.disposed) return;

      const lineNumber = e.target.position?.lineNumber ?? null;

      if (this.dragAnchorLine !== null) {
        if (lineNumber && lineNumber !== this.dragCurrentLine) {
          this.dragCurrentLine = lineNumber;
          const start = Math.min(this.dragAnchorLine, lineNumber);
          const end = Math.max(this.dragAnchorLine, lineNumber);
          this.setHoverDecorationsForRange(start, end);
        }
        return;
      }

      const targetElement = e.target.element as HTMLElement | null;
      if (targetElement?.closest?.('.comment-view-zone')) {
        this.clearHoverDecoration();
        this.hoveredLine = null;
        return;
      }

      if (lineNumber && lineNumber !== this.hoveredLine) {
        if (this.activeInputRange && this.isLineInRange(lineNumber, this.activeInputRange)) {
          this.clearHoverDecoration();
          this.hoveredLine = lineNumber;
          return;
        }
        this.setHoverDecorationsForRange(lineNumber, lineNumber);
        this.hoveredLine = lineNumber;
      } else if (!lineNumber && this.hoveredLine !== null) {
        this.clearHoverDecoration();
        this.hoveredLine = null;
      }
    });

    this.hoverLeaveDisposable = modifiedEditor.onMouseLeave(() => {
      if (this.disposed) return;
      if (this.dragAnchorLine !== null) return;
      this.clearHoverDecoration();
      this.hoveredLine = null;
    });
  }

  private isLineInRange(line: number, range: LineRange): boolean {
    return line >= range.start && line <= range.end;
  }

  private buildLineDecorations(
    start: number,
    end: number,
    className: string
  ): monaco.editor.IModelDeltaDecoration[] {
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (let line = start; line <= end; line++) {
      decorations.push({
        range: {
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: 1,
        },
        options: {
          glyphMarginClassName: className,
        },
      });
    }
    return decorations;
  }

  private setHoverDecorationsForRange(start: number, end: number) {
    const modifiedEditor = this.editor.getModifiedEditor();
    const decorations = this.buildLineDecorations(start, end, 'comment-hover-icon');
    this.hoverDecorationIds = modifiedEditor.deltaDecorations(this.hoverDecorationIds, decorations);
  }

  private setPinnedDecorationsForRange(start: number, end: number) {
    const modifiedEditor = this.editor.getModifiedEditor();
    const decorations = this.buildLineDecorations(
      start,
      end,
      'comment-hover-icon comment-hover-icon-pinned'
    );
    this.pinnedDecorationIds = modifiedEditor.deltaDecorations(
      this.pinnedDecorationIds,
      decorations
    );
  }

  private clearHoverDecoration() {
    const modifiedEditor = this.editor.getModifiedEditor();
    this.hoverDecorationIds = modifiedEditor.deltaDecorations(this.hoverDecorationIds, []);
  }

  private clearPinnedDecoration() {
    const modifiedEditor = this.editor.getModifiedEditor();
    this.pinnedDecorationIds = modifiedEditor.deltaDecorations(this.pinnedDecorationIds, []);
  }

  setComments(comments: DraftComment[]) {
    if (this.disposed) return;

    const modifiedEditor = this.editor.getModifiedEditor();
    const nextById = new Map<string, DraftComment>(
      comments.map((comment) => [comment.id, comment])
    );

    this.decorationIds = modifiedEditor.deltaDecorations(this.decorationIds, []);

    modifiedEditor.changeViewZones((accessor) => {
      for (const [commentId, zoneInfo] of Array.from(this.viewZoneRoots.entries())) {
        if (!nextById.has(commentId)) {
          accessor.removeZone(zoneInfo.zoneId);
          zoneInfo.root.unmount();
          this.viewZoneRoots.delete(commentId);
        }
      }

      for (const comment of comments) {
        const existing = this.viewZoneRoots.get(comment.id);
        if (existing) {
          existing.domNode.dataset.lineNumber = String(comment.endLineNumber);
          existing.domNode.style.padding = '12px';
          existing.domNode.style.boxSizing = 'border-box';
          existing.domNode.className = 'comment-view-zone bg-muted/40 border border-border';

          existing.root.render(
            React.createElement(CommentWidget, {
              comment,
              onEdit: (content) => this.options.onEditComment(comment.id, content),
              onDelete: () => this.options.onDeleteComment(comment.id),
            })
          );

          if (existing.endLineNumber !== comment.endLineNumber) {
            accessor.removeZone(existing.zoneId);
            const zoneId = accessor.addZone({
              afterLineNumber: comment.endLineNumber,
              heightInPx: COMMENT_ZONE_HEIGHT_PX,
              domNode: existing.domNode,
              suppressMouseDown: false,
              showInHiddenAreas: true,
            });
            this.viewZoneRoots.set(comment.id, {
              ...existing,
              zoneId,
              endLineNumber: comment.endLineNumber,
            });
          }
          continue;
        }

        const domNode = document.createElement('div');
        domNode.style.padding = '12px';
        domNode.style.boxSizing = 'border-box';
        domNode.className = 'comment-view-zone bg-muted/40 border border-border';
        domNode.style.pointerEvents = 'auto';
        domNode.style.position = 'relative';
        domNode.style.zIndex = '10';
        domNode.style.width = '100%';
        domNode.dataset.lineNumber = String(comment.endLineNumber);

        const root = createRoot(domNode);
        root.render(
          React.createElement(CommentWidget, {
            comment,
            onEdit: (content) => this.options.onEditComment(comment.id, content),
            onDelete: () => this.options.onDeleteComment(comment.id),
          })
        );

        const zoneId = accessor.addZone({
          afterLineNumber: comment.endLineNumber,
          heightInPx: COMMENT_ZONE_HEIGHT_PX,
          domNode,
          suppressMouseDown: false,
          showInHiddenAreas: true,
        });

        this.viewZoneRoots.set(comment.id, {
          zoneId,
          root,
          domNode,
          endLineNumber: comment.endLineNumber,
        });
      }
    });
  }

  showInputAt(startLineNumber: number, endLineNumber: number, lineContent: string) {
    if (
      this.activeInputRange &&
      this.activeInputRange.start === startLineNumber &&
      this.activeInputRange.end === endLineNumber &&
      this.inputDomNode
    ) {
      const textarea = this.inputDomNode.querySelector('textarea');
      if (textarea instanceof HTMLTextAreaElement) textarea.focus();
      return;
    }

    this.hideInput();

    const modifiedEditor = this.editor.getModifiedEditor();
    this.activeInputRange = { start: startLineNumber, end: endLineNumber };
    this.setPinnedDecorationsForRange(startLineNumber, endLineNumber);

    this.inputDomNode = document.createElement('div');
    this.inputRoot = createRoot(this.inputDomNode);

    this.inputRoot.render(
      React.createElement(CommentInput, {
        startLineNumber,
        endLineNumber,
        onSubmit: async (content) => {
          await this.options.onAddComment(startLineNumber, endLineNumber, content, lineContent);
          this.hideInput();
        },
        onCancel: () => this.hideInput(),
      })
    );

    this.inputDomNode.style.padding = '12px';
    this.inputDomNode.style.boxSizing = 'border-box';
    this.inputDomNode.className = 'comment-view-zone bg-muted/40 border border-border';
    this.inputDomNode.style.pointerEvents = 'auto';
    this.inputDomNode.style.position = 'relative';
    this.inputDomNode.style.zIndex = '10';
    this.inputDomNode.style.width = '100%';
    this.inputDomNode.dataset.lineNumber = String(endLineNumber);

    modifiedEditor.changeViewZones((accessor) => {
      this.inputZoneId = accessor.addZone({
        afterLineNumber: endLineNumber,
        heightInPx: COMMENT_ZONE_HEIGHT_PX,
        domNode: this.inputDomNode!,
        suppressMouseDown: false,
        showInHiddenAreas: true,
      });
    });

    const focusTextarea = () => {
      const textarea = this.inputDomNode?.querySelector('textarea');
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.focus();
        textarea.select();
      }
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        focusTextarea();
      });
    });
    setTimeout(() => {
      focusTextarea();
    }, 80);
  }

  hideInput() {
    const modifiedEditor = this.editor.getModifiedEditor();
    if (this.inputZoneId) {
      modifiedEditor.changeViewZones((accessor) => {
        accessor.removeZone(this.inputZoneId!);
      });
      this.inputZoneId = null;
    }

    this.inputRoot?.unmount();
    this.inputRoot = null;
    this.inputDomNode = null;
    this.activeInputRange = null;
    this.clearPinnedDecoration();
  }

  dispose() {
    this.disposed = true;

    if (this.documentMouseUpHandler) {
      document.removeEventListener('mouseup', this.documentMouseUpHandler, true);
      this.documentMouseUpHandler = null;
    }
    this.dragAnchorLine = null;
    this.dragCurrentLine = null;

    this.gutterMouseDownDisposable?.dispose();
    this.hoverMoveDisposable?.dispose();
    this.hoverLeaveDisposable?.dispose();

    this.hideInput();

    const modifiedEditor = this.editor.getModifiedEditor();
    this.decorationIds = modifiedEditor.deltaDecorations(this.decorationIds, []);
    this.hoverDecorationIds = modifiedEditor.deltaDecorations(this.hoverDecorationIds, []);
    this.pinnedDecorationIds = modifiedEditor.deltaDecorations(this.pinnedDecorationIds, []);

    modifiedEditor.changeViewZones((accessor) => {
      for (const zone of this.viewZoneRoots.values()) {
        accessor.removeZone(zone.zoneId);
        zone.root.unmount();
      }
    });
    this.viewZoneRoots.clear();
  }
}
