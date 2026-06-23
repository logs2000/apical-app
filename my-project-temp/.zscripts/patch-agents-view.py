#!/usr/bin/env python3
"""
Patch agents-view.tsx with:
1. Import messagesForAgent + apicalWelcomeMessage
2. Use per-agent messages (fixes 'all chats same' bug)
3. Rename Orchestrator → Apical in sidebar + center header
4. Restyle MessageBubble: no bubbles — user = slate block, agent = plain text
5. Add agent-branching capability to the Apical chat (propose new agents)
6. Use the welcome-back message for Apical
"""
import re
from pathlib import Path

path = Path("/home/z/my-project/my-project-temp/src/components/apical/agents-view.tsx")
content = path.read_text()

# 1. Update imports: add messagesForAgent + apicalWelcomeMessage
content = content.replace(
    "  DEFAULT_PROMPTS,\n  agentInitials,",
    "  DEFAULT_PROMPTS,\n  messagesForAgent,\n  apicalWelcomeMessage,\n  agentInitials,",
)

# 2. Replace the ORCHESTRATOR_REPLY constant + the ChatPane messages logic.
#    Find the ORCHESTRATOR_REPLY const + the ChatPane useEffect that loads messages.
old_orch_reply = '''const ORCHESTRATOR_REPLY = `I'm the Orchestrator — I have context on all your agents (Compass, Atlas, Sentinel, Tally, Beacon, Scout).

Ask me anything about your workspace: "what's flagged?", "what did Compass do today?", "set up a new agent to chase invoices". I'll route to the right agent or coordinate across them.`;'''

new_orch_reply = '''// The Apical (orchestrator) chat no longer uses a static greeting — it uses
// apicalWelcomeMessage() which generates a time-of-day greeting + a live
// summary of what's flagged, what ran while away, and any paused agents.
const AGENT_LIMIT = 5  // free-plan limit; gracefully handled when branching.'''

content = content.replace(old_orch_reply, new_orch_reply)

# 3. Replace the ChatPane messages useEffect to use per-agent messages.
old_effect = '''  // Reset messages when the agent/orchestrator changes — each chat correlates
  // to its own conversation. The Orchestrator gets a fresh greeting; agent
  // chats get the demo messages.
  React.useEffect(() => {
    if (isOrchestrator) {
      setMessages([
        {
          id: "orch-greet",
          role: "agent",
          content: ORCHESTRATOR_REPLY,
          createdAt: new Date().toISOString(),
        },
      ]);
    } else {
      setMessages(DEMO_MESSAGES);
    }
  }, [isOrchestrator, agent?.id]);'''

new_effect = '''  // Each chat correlates to its own conversation. Apical gets a live welcome
  // summary; each agent gets a role-specific thread from messagesForAgent().
  // This fixes the "all agent chats show the same messages" bug.
  React.useEffect(() => {
    if (isOrchestrator) {
      setMessages([
        apicalWelcomeMessage({
          user: { name: "Jordan" },
          agents: DEMO_WORKFLOWS,
          lastSeenAgoHours: 6,
        }),
      ]);
    } else if (agent) {
      setMessages(messagesForAgent(agent));
    } else {
      setMessages([]);
    }
  }, [isOrchestrator, agent?.id]);

  // Branch a new agent from the Apical chat. The user asks for a new task;
  // Apical proposes an agent + switches the conversation to it. Handles the
  // agent limit gracefully (free plan = 5 agents).
  function branchNewAgent(name: string, department: string, description: string) {
    if (DEMO_WORKFLOWS.length >= AGENT_LIMIT) {
      setMessages((m) => [
        ...m,
        {
          id: Math.random().toString(36).slice(2),
          role: "agent",
          content: `I'd normally spin up a new agent ("${name}") for this, but you're at the free-plan limit of ${AGENT_LIMIT} agents. You can either upgrade to Pro (unlimited agents) or pause an existing one to make room. Want me to show you which agents are using the fewest cycles?`,
          createdAt: new Date().toISOString(),
        },
      ]);
      return;
    }
    setMessages((m) => [
      ...m,
      {
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
      },
    ]);
  }'''

content = content.replace(old_effect, new_effect)

# 4. Update the Apical sendPlan to support branching.
old_send_plan = '''  function sendPlan(text: string) {
    setIsThinking(true);
    window.setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          id: Math.random().toString(36).slice(2),
          role: "agent",
          content: isOrchestrator
            ? `Coordinating across your agents for: "${text}". Here's what I'd do:\\n\\n1. Check which agents are relevant\\n2. Route the task to the best one\\n3. Report back with results`
            : AGENT_REPLY,
          ...(isOrchestrator
            ? {}
            : {
                workflowProposal: {
                  name: agent?.name ?? "Agent",
                  description: "Auto-generated workflow.",
                  department: agent?.department ?? "General",
                  steps: {
                    version: 1,
                    steps: [
                      { id: "s1", kind: "tool" as const, label: "List inbox", tool: "files.list" },
                      { id: "s2", kind: "reason" as const, label: "Identify client", prompt: "OCR + match" },
                      { id: "s3", kind: "gate" as const, label: "Approve move" },
                      { id: "s4", kind: "tool" as const, label: "Move file", tool: "files.move" },
                    ],
                  },
                },
              }),
          createdAt: new Date().toISOString(),
        },
      ]);
      setIsThinking(false);
    }, 900 + Math.random() * 400);
  }'''

new_send_plan = '''  function sendPlan(text: string) {
    setIsThinking(true);
    window.setTimeout(() => {
      if (isOrchestrator) {
        // Apical chat: detect if the user is asking for a new task/agent.
        // If so, propose branching into a new agent. Otherwise, coordinate.
        const lower = text.toLowerCase();
        const wantsNewAgent = /new agent|set up|create|hire|spin up|branch|automate this|do this every|track|monitor|watch|chase|sort|audit|find|draft/.test(lower);
        if (wantsNewAgent) {
          // Propose a new agent based on the request.
          const nameGuess = text.split(" ").slice(0, 2).join(" ").replace(/[^a-zA-Z ]/g, "").trim() || "New Agent";
          branchNewAgent(nameGuess, "General", `Automates: ${text.slice(0, 100)}`);
        } else {
          setMessages((m) => [
            ...m,
            {
              id: Math.random().toString(36).slice(2),
              role: "agent",
              content: `I can coordinate across your agents for that. Here's what I'd do:\\n\\n1. Check which agents are relevant\\n2. Route the task to the best one (or set up a new one if needed)\\n3. Report back with results\\n\\nWant me to proceed, or would you rather I set up a new dedicated agent for this?`,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      } else {
        setMessages((m) => [
          ...m,
          {
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
                  { id: "s1", kind: "tool" as const, label: "List inbox", tool: "files.list" },
                  { id: "s2", kind: "reason" as const, label: "Identify client", prompt: "OCR + match" },
                  { id: "s3", kind: "gate" as const, label: "Approve move" },
                  { id: "s4", kind: "tool" as const, label: "Move file", tool: "files.move" },
                ],
              },
            },
            createdAt: new Date().toISOString(),
          },
        ]);
      }
      setIsThinking(false);
    }, 900 + Math.random() * 400);
  }'''

content = content.replace(old_send_plan, new_send_plan)

# 5. Rename "Orchestrator" → "Apical" in the sidebar section header + center pane.
content = content.replace(
    '''          <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Orchestrator
          </div>''',
    '''          <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Apical
          </div>''',
)

# OrchestratorRow subtitle
content = content.replace(
    '<div className="truncate text-[9px] text-muted-foreground">General · all agents</div>',
    '<div className="truncate text-[9px] text-muted-foreground">General · all agents</div>',
)

# Center pane header — "Orchestrator" → "Apical"
content = content.replace(
    '<div className="text-sm font-semibold">Orchestrator</div>',
    '<div className="text-sm font-semibold">Apical</div>',
)

# 6. Restyle MessageBubble — no bubbles.
#    User messages: slate gray block (bg-muted, no rounded bubble look).
#    Agent messages: no bubble at all, plain text on the page background.
old_bubble = '''function MessageBubble({ message, agentName }: { message: ChatMessage; agentName: string }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold",
          isUser ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary",
        )}
      >
        {isUser ? "Y" : agentInitials(agentName)}
      </div>
      <div className={cn("max-w-[80%] space-y-2", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            isUser ? "bg-primary text-primary-foreground" : "bg-card border border-border",
          )}
        >
          <RichText text={message.content} isUser={isUser} />
        </div>
        {message.executionTrace && message.executionTrace.length > 0 && (
          <div className="space-y-1 rounded-lg border border-border bg-muted/30 p-2">
            {message.executionTrace.map((step, i) => (
              <TraceStep key={step.id} step={step} index={i} />
            ))}
          </div>
        )}
        <div className={cn("text-[10px] text-muted-foreground", isUser && "text-right")}>
          {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}'''

new_bubble = '''function MessageBubble({ message, agentName }: { message: ChatMessage; agentName: string }) {
  const isUser = message.role === "user";
  // Flat block style — no bubbles.
  // User messages: a neutral slate-gray block (bg-muted), left-aligned, full-width-ish.
  // Agent messages: no bubble at all — plain text on the page background, with a
  // small agent-name label above for context.
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-1">
          <div className="rounded-md bg-muted px-3 py-2 text-sm text-foreground">
            <RichText text={message.content} isUser />
          </div>
          <div className="text-right text-[10px] text-muted-foreground">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>
    );
  }
  // Agent — no bubble, plain text. Name label for context (which agent is talking).
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <span>{agentName}</span>
      </div>
      <div className="text-sm text-foreground">
        <RichText text={message.content} isUser={false} />
      </div>
      {message.executionTrace && message.executionTrace.length > 0 && (
        <div className="mt-2 space-y-1 rounded-md border border-border bg-muted/30 p-2">
          {message.executionTrace.map((step, i) => (
            <TraceStep key={step.id} step={step} index={i} />
          ))}
        </div>
      )}
      {message.workflowProposal && (
        <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs">
          <div className="mb-1 font-semibold text-primary">Proposed workflow: {message.workflowProposal.name}</div>
          <div className="text-muted-foreground">{message.workflowProposal.description}</div>
          <div className="mt-1.5 text-[10px] text-muted-foreground">{message.workflowProposal.steps.steps.length} steps · {message.workflowProposal.department}</div>
        </div>
      )}
      <div className="text-[10px] text-muted-foreground">
        {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}'''

content = content.replace(old_bubble, new_bubble)

path.write_text(content)
print("OK: patched agents-view.tsx")
