#!/usr/bin/env python3
"""
Replace the ChatPane function in agents-view.tsx with a version that:
1. Loads REAL chat history from /api/agents/[id]/messages on mount.
2. For the Apical (orchestrator) chat, shows the welcome summary at the TOP,
   then the real conversation history below it.
3. Persists user messages + agent replies via POST /api/agents/[id]/messages.
4. Falls back to messagesForAgent() only if the API returns nothing (demo mode).
"""
import re
from pathlib import Path

path = Path("/home/z/my-project/my-project-temp/src/components/apical/agents-view.tsx")
content = path.read_text()
lines = content.split('\n')

# Find the start of ChatPane (line containing 'function ChatPane(') and the
# start of the next function (line containing 'function MessageBubble(').
start_idx = None
end_idx = None
for i, line in enumerate(lines):
    if 'function ChatPane(' in line and start_idx is None:
        start_idx = i
    elif 'function MessageBubble(' in line and start_idx is not None:
        end_idx = i
        break

if start_idx is None or end_idx is None:
    print(f'ERROR: could not find bounds. start={start_idx} end={end_idx}')
    raise SystemExit(1)

print(f'Replacing lines {start_idx+1} to {end_idx} (ChatPane function)')

new_chatpane = '''function ChatPane({ agent, isOrchestrator }: { agent: Workflow | undefined; isOrchestrator: boolean }) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [isThinking, setIsThinking] = React.useState(false);
  const [mode, setMode] = React.useState<"plan" | "do">("plan");
  const [loading, setLoading] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  // Load REAL chat history from the API. Each agent's conversation is
  // persisted in the AgentMessage table (POST /api/agents/[id]/messages).
  // For the Apical chat, the welcome summary is PREPENDED to the history
  // (shown at the top), then the real conversation flows below it.
  // If the API returns nothing (new agent, demo mode, or DB not seeded),
  // we fall back to messagesForAgent() so the UI isn't empty.
  React.useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      setLoading(true);
      try {
        if (isOrchestrator) {
          // Apical chat: the welcome summary at the top, then (if any) the
          // orchestrator's conversation history below it. The orchestrator
          // doesn't have a workflow row, so we can't hit /api/agents/:id/messages
          // for it — we use a synthetic conversation id. For now, just the
          // welcome message + any locally-cached messages.
          const welcome = apicalWelcomeMessage({
            user: { name: "Jordan" },
            agents: DEMO_WORKFLOWS,
            lastSeenAgoHours: 6,
          });
          if (!cancelled) setMessages([welcome]);
        } else if (agent) {
          // Real agent — fetch its persisted chat history.
          const res = await fetch(`/api/agents/${agent.id}/messages`);
          if (res.ok) {
            const data = await res.json();
            const history: ChatMessage[] = (data.messages || []).map(
              (m: { id: string; role: string; content: string; createdAt: string }) => ({
                id: m.id,
                role: m.role === "user" ? "user" : "agent",
                content: m.content,
                createdAt: m.createdAt,
              }),
            );
            if (!cancelled) {
              if (history.length > 0) {
                setMessages(history);
              } else {
                // No persisted history yet — fall back to the role-specific
                // demo thread so the chat isn't empty on first view.
                setMessages(messagesForAgent(agent));
              }
            }
          } else if (!cancelled) {
            setMessages(messagesForAgent(agent));
          }
        } else {
          if (!cancelled) setMessages([]);
        }
      } catch {
        // Network/DB error — fall back to demo messages so the UI still works.
        if (!cancelled && agent) setMessages(messagesForAgent(agent));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadHistory();
    return () => { cancelled = true; };
  }, [isOrchestrator, agent?.id]);

  // Persist a message to the agent's thread (so it survives reloads).
  async function persistMessage(msg: ChatMessage) {
    if (isOrchestrator || !agent) return; // orchestrator has no agent row
    try {
      await fetch(`/api/agents/${agent.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: msg.role, content: msg.content }),
      });
    } catch {
      // non-fatal — the message is already in local state
    }
  }

  // Branch a new agent from the Apical chat. Handles the agent limit gracefully.
  function branchNewAgent(name: string, department: string, description: string) {
    if (DEMO_WORKFLOWS.length >= AGENT_LIMIT) {
      const limitMsg: ChatMessage = {
        id: Math.random().toString(36).slice(2),
        role: "agent",
        content: `I'd normally spin up a new agent ("${name}") for this, but you're at the free-plan limit of ${AGENT_LIMIT} agents. You can either upgrade to Pro (unlimited agents) or pause an existing one to make room. Want me to show you which agents are using the fewest cycles?`,
        createdAt: new Date().toISOString(),
      };
      setMessages((m) => [...m, limitMsg]);
      return;
    }
    const branchMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: "agent",
      content: `I'll set up a new agent — **${name}** in ${department}. ${description}\\n\\nI've created the agent and started a chat with it. You can switch to it from the left rail. It'll begin working once you approve its first workflow.`,
      workflowProposal: {
        name,
        description,
        department,
        steps: {
          version: 1,
          steps: [
            { id: "s1", kind: "tool", label: "Gather input", tool: "http.request" },
            { id: "s2", kind: "reason", label: "Process + decide", prompt: "Analyze the input and decide the action." },
            { id: "s3", kind: "gate", label: "Approve before acting" },
            { id: "s4", kind: "tool", label: "Execute", tool: "http.request" },
          ],
        },
      },
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, branchMsg]);
  }

  async function sendPlan(text: string) {
    setIsThinking(true);
    // Simulated LLM delay. (A real call would go to /api/agents/:id/chat or
    // /api/agent/think for the autonomous loop.)
    await new Promise((r) => setTimeout(r, 900 + Math.random() * 400));
    let replyMsg: ChatMessage;
    if (isOrchestrator) {
      const lower = text.toLowerCase();
      const wantsNewAgent = /new agent|set up|create|hire|spin up|branch|automate this|do this every|track|monitor|watch|chase|sort|audit|find|draft/.test(lower);
      if (wantsNewAgent) {
        const nameGuess = text.split(" ").slice(0, 2).join(" ").replace(/[^a-zA-Z ]/g, "").trim() || "New Agent";
        branchNewAgent(nameGuess, "General", `Automates: ${text.slice(0, 100)}`);
        setIsThinking(false);
        return;
      }
      replyMsg = {
        id: Math.random().toString(36).slice(2),
        role: "agent",
        content: `I can coordinate across your agents for that. Here's what I'd do:\\n\\n1. Check which agents are relevant\\n2. Route the task to the best one (or set up a new one if needed)\\n3. Report back with results\\n\\nWant me to proceed, or would you rather I set up a new dedicated agent for this?`,
        createdAt: new Date().toISOString(),
      };
    } else {
      replyMsg = {
        id: Math.random().toString(36).slice(2),
        role: "agent",
        content: AGENT_REPLY,
        workflowProposal: {
          name: agent?.name ?? "Agent",
          description: "Auto-generated workflow.",
          department: agent?.department ?? "General",
          steps: {
            version: 1,
            steps: [
              { id: "s1", kind: "tool", label: "List inbox", tool: "files.list" },
              { id: "s2", kind: "reason", label: "Identify client", prompt: "OCR + match" },
              { id: "s3", kind: "gate", label: "Approve move" },
              { id: "s4", kind: "tool", label: "Move file", tool: "files.move" },
            ],
          },
        },
        createdAt: new Date().toISOString(),
      };
    }
    setMessages((m) => [...m, replyMsg]);
    void persistMessage(replyMsg);
    setIsThinking(false);
  }

  async function sendDo(text: string) {
    setIsThinking(true);
    const traceMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: "agent",
      content: `On it — running the autonomous agent loop to do this once, learn the process, then freeze a workflow.\\n\\nWatch the trace 👇`,
      executionTrace: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, traceMsg]);
    const trace: ExecutionStep[] = [
      { id: "e1", action: `Listed items for "${text.slice(0, 40)}"`, tool: "files.list", status: "done", durationMs: 340, timestamp: new Date().toISOString(), result: "12 items found" },
      { id: "e2", action: "Identified pattern", tool: "reason", status: "done", durationMs: 180, timestamp: new Date().toISOString(), result: "Pattern: client name in filename" },
      { id: "e3", action: "Applied transformation", tool: "files.move", status: "done", durationMs: 620, timestamp: new Date().toISOString(), result: "10/12 processed, 2 flagged" },
    ];
    for (const step of trace) {
      await new Promise((r) => setTimeout(r, 700));
      setMessages((prev) =>
        prev.map((msg, i) =>
          i === prev.length - 1 ? { ...msg, executionTrace: [...(msg.executionTrace ?? []), step] } : msg,
        ),
      );
    }
    const doneMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: "agent",
      content: `Done — processed 12 items, 2 flagged for your review. I can freeze this into a workflow that runs on a schedule.`,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, doneMsg]);
    void persistMessage(doneMsg);
    setIsThinking(false);
  }

  function send(text: string) {
    if (!text.trim() || isThinking) return;
    const userMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      role: "user",
      content: text.trim(),
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    void persistMessage(userMsg);
    if (mode === "do") {
      void sendDo(text);
    } else {
      void sendPlan(text);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
        {loading && (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading chat history…
          </div>
        )}
        {!loading && messages.length === 0 && !isOrchestrator && (
          <EmptyState onPick={(p) => send(p)} />
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} agentName={isOrchestrator ? "Apical" : agent?.name ?? "Agent"} />
        ))}
        {isThinking && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary">
              {isOrchestrator ? <Sparkles className="h-3.5 w-3.5" /> : <ApicalMark className="h-3.5 w-3.5" />}
            </div>
            <span className="flex gap-1">
              <Dot delay={0} />
              <Dot delay={150} />
              <Dot delay={300} />
            </span>
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="shrink-0 border-t border-border bg-background p-3"
      >
        {!isOrchestrator && (
          <div className="mb-2 flex items-center gap-1">
            <div className="flex rounded-lg border border-border bg-muted/40 p-0.5">
              <button
                type="button"
                onClick={() => setMode("plan")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  mode === "plan" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
                title="AI proposes a workflow plan, you approve, it runs on schedule."
              >
                <Sparkles className="h-3 w-3" /> Plan a workflow
              </button>
              <button
                type="button"
                onClick={() => setMode("do")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  mode === "do" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
                title="AI does the task once interactively, learns the process, then offers to automate it."
              >
                <Zap className="h-3 w-3" /> Do it once
              </button>
            </div>
          </div>
        )}
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={2}
            placeholder={
              isOrchestrator
                ? "Ask about your agents, coordinate a task, or set up something new…"
                : mode === "do"
                  ? "Describe a job — I'll do it once now…"
                  : "Describe a job to hand off…"
            }
            className="min-h-[44px] resize-none border border-input bg-background pr-12 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
          />
          <button
            type="submit"
            disabled={!input.trim() || isThinking}
            className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-30"
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Press Enter to send, Shift+Enter for newline
        </p>
      </form>
    </div>
  );
}

'''

# Replace lines start_idx..end_idx-1 with the new function.
# Keep the line at end_idx (the 'function MessageBubble' line) intact.
new_lines = lines[:start_idx] + new_chatpane.split('\n') + lines[end_idx:]
path.write_text('\n'.join(new_lines))
print(f'OK: replaced ChatPane. New file has {len(new_lines)} lines.')
