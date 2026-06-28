"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import { remarkGfmSafePlugin } from "@/lib/apical/remark-gfm-safe";
import { cn } from "@/lib/utils";
import { CHAT_CONTENT_SELECT } from "@/lib/apical/chat-copy";
import { normalizeMarkdownTables } from "@/lib/apical/markdown-normalize";

const TABLE_WRAPPER = "my-3 max-w-full overflow-x-auto rounded-md border border-border select-none";
const TABLE = "w-full min-w-[280px] border-collapse text-left text-xs";
const TH = "whitespace-nowrap border-b border-border bg-muted px-2.5 py-1.5 font-semibold text-foreground select-none";
const TD = "border-b border-border px-2.5 py-1.5 text-foreground/90 align-top";
const TR = "even:bg-muted/30";

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-1.5 mt-3 select-none text-base font-bold first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-1 mt-2.5 select-none text-sm font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-0.5 mt-2 select-none text-sm font-medium first:mt-0">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => <p className="my-1.5">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="text-foreground">{children}</li>,
  hr: () => <hr className="my-2 border-border" />,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-muted/60 p-2 font-mono text-xs">{children}</pre>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-foreground underline underline-offset-2 hover:text-muted-foreground"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className={TABLE_WRAPPER}>
      <table className={TABLE}>{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead>{children}</thead>,
  tbody: ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: React.ReactNode }) => <tr className={TR}>{children}</tr>,
  th: ({ children }: { children?: React.ReactNode }) => <th className={TH}>{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td className={TD}>{children}</td>,
};

/** Renders agent chat text with markdown (headings, links, lists, tables, etc.). */
export function MarkdownText({
  text,
  isUser,
  className,
}: {
  text: string;
  isUser?: boolean;
  className?: string;
}) {
  if (isUser) {
    return (
      <span className={cn("whitespace-pre-wrap", CHAT_CONTENT_SELECT, className)}>{text}</span>
    );
  }

  const normalized = React.useMemo(() => normalizeMarkdownTables(text), [text]);

  return (
    <div className={cn("text-sm leading-relaxed text-foreground", CHAT_CONTENT_SELECT, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfmSafePlugin]} components={markdownComponents}>
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
