/** Tailwind + explicit class for gray text selection inside chat message bodies. */
export const CHAT_CONTENT_SELECT =
  "chat-message-select selection:bg-muted-foreground/25 selection:text-foreground";

/** Body text only — strips markdown headings and collapses excess blank lines. */
export function getCopyableChatText(text: string): string {
  const filtered = text
    .split("\n")
    .filter((line) => !/^#{1,6}\s/.test(line.trim()));
  return filtered
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
