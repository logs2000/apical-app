/**
 * GFM remark plugin without autolink literals.
 *
 * mdast-util-gfm-autolink-literal uses `(?<=...)` lookbehind in its email
 * regex, which Safari 15 (Tauri WebView on macOS 12) cannot parse. Tables,
 * strikethrough, task lists, and footnotes are kept; bare URLs/emails in
 * prose are not auto-linked (explicit `[text](url)` still works).
 */
import { combineExtensions } from "micromark-util-combine-extensions";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import type { Root } from "mdast";
import type { Processor } from "unified";
import type { Pluggable } from "unified";

function remarkGfmSafe(this: Processor<Root>) {
  const self = this;
  // remark-parse stores extension arrays on processor data (untyped in unified).
  const data = self.data() as Record<string, unknown>;

  const micromarkExtensions =
    (data.micromarkExtensions as unknown[]) ||
    ((data.micromarkExtensions = []) as unknown[]);
  const fromMarkdownExtensions =
    (data.fromMarkdownExtensions as unknown[]) ||
    ((data.fromMarkdownExtensions = []) as unknown[]);

  micromarkExtensions.push(
    combineExtensions([
      gfmFootnote(),
      gfmStrikethrough({ singleTilde: false }),
      gfmTable(),
      gfmTaskListItem(),
    ]),
  );
  fromMarkdownExtensions.push(
    gfmFootnoteFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTableFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
  );
}

/** Safari 15–compatible GFM plugin (no autolink lookbehind regex). */
export const remarkGfmSafePlugin = remarkGfmSafe as Pluggable;
