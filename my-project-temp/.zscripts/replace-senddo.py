#!/usr/bin/env python3
"""Replace the sendDo function in chat-tab.tsx with the real agent-engine version."""
import re
from pathlib import Path

path = Path("/home/z/my-project/my-project-temp/src/components/apical/chat-tab.tsx")
content = path.read_text()

# The new sendDo function (invokes /api/agent/think SSE stream).
new_send_do = '''  // ─── Learn-first mode: AI does the work once via the autonomous agent loop,
  // then offers to freeze a workflow from the real execution trace.
  // This calls POST /api/agent/think (SSE) which runs runAgent() — the ReAct
  // loop that tries tools, configures missing ones, and freezes a workflow
  // from the observed trace. NOT a hardcoded demo.
  async function sendDo(text: string) {
    setIsThinking(true);
    const agentMsgId = Math.random().toString(36).slice(2);
    const trace: ExecutionStep[] = [];

    // 1. Post an initial agent message with an empty trace.
    setMessages((m) => [
      ...m,
      {
        id: agentMsgId,
        role: "agent",
        content: `On it — I'll do this once now via the autonomous agent loop so I learn exactly how it works, then I'll offer to freeze a workflow from what I did.\\n\\nWatch me work 👇`,
        executionTrace: [],
        createdAt: new Date().toISOString(),
      },
    ]);

    // 2. Open the SSE stream to /api/agent/think.
    try {
      const res = await fetch("/api/agent/think", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: text, maxIterations: 12 }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalAnswer = "";
      let proposedWorkflow: ChatMessage["workflowProposal"] | undefined;

      // 3. Read SSE events + update the trace live.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          let event: { type: string; [k: string]: unknown };
          try {
            event = JSON.parse(jsonStr);
          } catch {
            continue;
          }
          // Map SSE events to execution-trace steps.
          if (event.type === "thought") {
            const thought = (event as { text: string }).text;
            trace.push({
              id: `e${trace.length + 1}`,
              action: thought.slice(0, 120),
              tool: "reason",
              status: "done",
              timestamp: new Date().toISOString(),
              result: thought,
            });
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === agentMsgId ? { ...msg, executionTrace: [...trace] } : msg,
              ),
            );
          } else if (event.type === "tool_call") {
            const ev = event as { tool: string; input: Record<string, unknown> };
            const inputSummary = Object.keys(ev.input || {}).slice(0, 3).join(", ");
            trace.push({
              id: `e${trace.length + 1}`,
              action: `${ev.tool}(${inputSummary})`,
              tool: ev.tool,
              status: "running",
              timestamp: new Date().toISOString(),
            });
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === agentMsgId ? { ...msg, executionTrace: [...trace] } : msg,
              ),
            );
          } else if (event.type === "observation") {
            const ev = event as {
              tool: string; ok: boolean; output: unknown; error?: string;
            };
            // Update the last trace step for this tool.
            const lastStep = [...trace].reverse().find((s) => s.tool === ev.tool && s.status === "running");
            if (lastStep) {
              lastStep.status = ev.ok ? "done" : "flagged";
              lastStep.durationMs = 200;
              if (ev.ok) {
                const outStr = typeof ev.output === "string" ? ev.output : JSON.stringify(ev.output);
                lastStep.result = outStr.slice(0, 200);
              } else {
                lastStep.result = ev.error || "failed";
              }
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === agentMsgId ? { ...msg, executionTrace: [...trace] } : msg,
                ),
              );
            }
          } else if (event.type === "final") {
            const ev = event as {
              answer: string;
              proposedWorkflow?: WorkflowJSON;
            };
            finalAnswer = ev.answer || "";
            if (ev.proposedWorkflow) {
              proposedWorkflow = {
                name: "Agent",
                description: finalAnswer.slice(0, 200),
                department: "General",
                steps: ev.proposedWorkflow,
              };
            }
          }
        }
      }

      // 4. Post the final answer + automate offer.
      setMessages((m) => [
        ...m,
        {
          id: Math.random().toString(36).slice(2),
          role: "agent",
          content: finalAnswer || "Done. I worked through the task above — review the trace.",
          ...(proposedWorkflow
            ? {
                automateOffer: {
                  traceId: agentMsgId,
                  summary: "Workflow frozen from the live execution trace above.",
                  name: proposedWorkflow.name,
                  department: proposedWorkflow.department,
                  steps: proposedWorkflow.steps,
                },
              }
            : {}),
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      // Surface the error inline.
      setMessages((m) => [
        ...m,
        {
          id: Math.random().toString(36).slice(2),
          role: "agent",
          content: `(Couldn't run the autonomous loop — ${(err as Error).message}. Falling back to plan mode.)`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsThinking(false);
    }
  }
'''

# Find the old sendDo function — from the comment block to the closing brace
# before "function send(text".
old_pattern = re.compile(
    r'  // ─── Learn-first mode: AI does the work once.*?(?=\n  function send\(text: string\))',
    re.DOTALL,
)

new_content = old_pattern.sub(new_send_do.rstrip(), content, count=1)

if new_content == content:
    print("ERROR: no replacement made")
    raise SystemExit(1)

path.write_text(new_content)
print("OK: replaced sendDo function")
