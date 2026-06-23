#!/usr/bin/env python3
"""
Rebuild agents-view.tsx with:
1. NO browser tabs — single center pane.
2. Center pane = CHAT ONLY (no Dashboard/Workflow/Config mode tabs).
3. Right rail houses Dashboard/Workflow/Config as collapsible sections
   (in addition to the existing overview: status/flagged/workflow/stats/runs).
4. User-sent chat messages: slate background + white text.
5. Mobile architecture: bottom tab bar, stacked panes, slide-in detail panel.
   Completely different from desktop 3-rail layout.
6. Responsive: right rail collapses on narrow screens (lg breakpoint).
"""
import re
from pathlib import Path

path = Path("/home/z/my-project/my-project-temp/src/components/apical/agents-view.tsx")
content = path.read_text()
lines = content.split('\n')

# Find the bounds:
# - Start: the line "// ─── Main view: three-pane layout with browser-style tabs"
# - End: the line before "// ─── Chat pane (center)" (which precedes the ChatPane function)
start_idx = None
end_idx = None
for i, line in enumerate(lines):
    if 'Main view: three-pane layout with browser-style tabs' in line:
        start_idx = i
    elif 'Chat pane (center)' in line and start_idx is not None:
        end_idx = i
        break

if start_idx is None or end_idx is None:
    print(f'ERROR: bounds not found. start={start_idx} end={end_idx}')
    raise SystemExit(1)

print(f'Replacing lines {start_idx+1} to {end_idx} (AgentsView + TabBar + AgentNavigator + CenterPane)')

new_section = '''// ─── Main view: responsive 3-rail (desktop) / stacked (mobile) ─────────────
//
// DESKTOP (lg+): left rail (agent navigator) + center (chat) + right rail
// (inspector with Overview/Dashboard/Workflow/Config as collapsible sections).
// On narrow desktops (below lg), the right rail collapses to a toggle.
//
// MOBILE (below md): completely different architecture — bottom tab bar with
// Agents / Chat / Detail tabs. Each shows one pane at a time. The Detail pane
// slides up from the bottom when tapped. No 3-rail layout on mobile.

export function AgentsView() {
  // Mobile detection — below the md breakpoint, use the mobile architecture.
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  if (isMobile) return <MobileAgentsView />;
  return <DesktopAgentsView />;
}

// ─── Desktop: 3-rail layout ─────────────────────────────────────────────────

function DesktopAgentsView() {
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const setActiveConversation = useAppStore((s) => s.setActiveConversation);
  const inspectorOpen = useAppStore((s) => s.inspectorOpen);
  const toggleInspector = useAppStore((s) => s.toggleInspector);

  const activeConvo = DEMO_CONVERSATIONS.find((c) => c.id === activeConversationId);
  const activeAgent = activeConvo?.workflowId
    ? DEMO_WORKFLOWS.find((w) => w.id === activeConvo.workflowId)
    : undefined;
  const isOrchestrator = activeConversationId === "orchestrator";

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail — agent navigator */}
      <AgentNavigator activeId={activeConversationId} onPick={setActiveConversation} />

      {/* Center — chat only (no mode tabs) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <CenterPane
          agent={activeAgent}
          isOrchestrator={isOrchestrator}
          inspectorOpen={inspectorOpen}
          onToggleInspector={toggleInspector}
        />
      </div>

      {/* Right — inspector (collapsible, hidden for Orchestrator, collapses below lg) */}
      {inspectorOpen && activeAgent && !isOrchestrator && (
        <InspectorPane agent={activeAgent} />
      )}
    </div>
  );
}

'''

# Also need to replace the CenterPane to remove the mode tabs.
# Find CenterPane function bounds.
cp_start = None
cp_end = None
for i, line in enumerate(lines):
    if 'function CenterPane(' in line and cp_start is None:
        cp_start = i
    elif 'function ChatPane(' in line and cp_start is not None:
        cp_end = i
        break

print(f'Replacing CenterPane lines {cp_start+1} to {cp_end}')

new_centerpane = '''function CenterPane({
  agent,
  isOrchestrator,
  inspectorOpen,
  onToggleInspector,
}: {
  agent: Workflow | undefined;
  isOrchestrator: boolean;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}) {
  // Center pane is CHAT ONLY now — Dashboard/Workflow/Config live in the right
  // rail (InspectorPane). No mode tabs here.
  return (
    <>
      {/* Sub-header: agent identity + inspector toggle */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        {isOrchestrator ? (
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">Apical</div>
              <div className="text-[10px] text-muted-foreground">General · context to all agents</div>
            </div>
          </div>
        ) : agent ? (
          <div className="flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
              style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}
            >
              {agentInitials(agent.name)}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold">{agent.name}</span>
                <RuntimeBadge runtime={agent.runtime} />
              </div>
              <div className="text-[10px] text-muted-foreground">{agent.department} · {agent.title}</div>
            </div>
          </div>
        ) : null}

        {/* Inspector toggle — only when an agent is selected */}
        {!isOrchestrator && agent && (
          <button
            onClick={onToggleInspector}
            className={cn(
              "ml-auto flex items-center gap-1 rounded-md p-1.5 transition-colors",
              inspectorOpen ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
            title={inspectorOpen ? "Hide inspector" : "Show inspector"}
          >
            {inspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Chat only */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatPane agent={agent} isOrchestrator={isOrchestrator} />
      </div>
    </>
  );
}

'''

# Replace the InspectorPane to add collapsible Dashboard/Workflow/Config sections.
# Find InspectorPane bounds.
ip_start = None
ip_end = None
for i, line in enumerate(lines):
    if 'function InspectorPane(' in line and ip_start is None:
        ip_start = i
    elif 'function AgentDashboard(' in line and ip_start is not None:
        ip_end = i
        break

print(f'Replacing InspectorPane lines {ip_start+1} to {ip_end}')

new_inspector = '''function InspectorPane({ agent }: { agent: Workflow }) {
  const [section, setSection] = React.useState<"overview" | "dashboard" | "workflow" | "config">("overview");
  const status = agentStatus(agent);
  const autoPct = Math.round((agent.automaticCount / Math.max(agent.itemsProcessed, 1)) * 100);

  return (
    <aside className="hidden w-80 shrink-0 flex-col overflow-hidden border-l border-border bg-muted/30 lg:flex">
      {/* Section switcher — Overview / Dashboard / Workflow / Config as tabs WITHIN the right rail */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-background/50 p-1">
        {(["overview", "dashboard", "workflow", "config"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-[10px] font-medium capitalize transition-colors",
              section === s ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {section === "overview" && <InspectorOverview agent={agent} status={status} autoPct={autoPct} onGoSection={setSection} />}
        {section === "dashboard" && <AgentDashboard agent={agent} />}
        {section === "workflow" && <AgentWorkflow agent={agent} />}
        {section === "config" && <AgentConfig agent={agent} />}
      </div>
    </aside>
  );
}

function InspectorOverview({
  agent,
  status,
  autoPct,
  onGoSection,
}: {
  agent: Workflow;
  status: { color: string; label: string };
  autoPct: number;
  onGoSection: (s: "overview" | "dashboard" | "workflow" | "config") => void;
}) {
  return (
    <div className="space-y-3 p-3">
      {/* Status + schedule */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", status.color)} />
          <span className="text-xs font-semibold capitalize">{status.label}</span>
          <RuntimeBadge runtime={agent.runtime} />
        </div>
        <div className="text-[10px] text-muted-foreground">
          {agent.trigger === "schedule" ? `Schedule · ${agent.schedule}` : "Manual trigger"}
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          {agent.runsCount} runs · {agent.itemsProcessed.toLocaleString()} items
        </div>
      </div>

      {/* LOUD flagged button */}
      {agent.flaggedCount > 0 && (
        <button
          onClick={() => onGoSection("dashboard")}
          className="flex w-full items-center gap-2 rounded-lg border-2 border-gate/50 bg-gate/10 p-3 text-left transition-colors hover:border-gate hover:bg-gate/15"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gate/20 text-gate">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-gate">{agent.flaggedCount} flagged → review</div>
            <div className="text-[10px] text-gate/80">Human-in-the-loop items need your call</div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-gate" />
        </button>
      )}

      {/* Workflow steps (summary) */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Workflow</span>
          <button onClick={() => onGoSection("workflow")} className="text-[10px] text-primary hover:underline">View →</button>
        </div>
        <div className="space-y-1">
          {agent.steps.steps.slice(0, 5).map((step, i) => {
            const Icon = step.hardened ? Lock : step.kind === "reason" ? Brain : step.kind === "gate" ? ShieldCheck : Wrench;
            return (
              <div key={step.id} className="flex items-center gap-1.5 text-[10px]">
                <span className="font-mono text-[9px] text-muted-foreground">{i + 1}</span>
                <Icon className={cn("h-2.5 w-2.5", step.hardened ? "text-hardened" : step.kind === "reason" ? "text-reason" : step.kind === "gate" ? "text-gate" : "text-muted-foreground")} />
                <span className="truncate">{step.label}</span>
                {step.hardened && <Lock className="ml-auto h-2 w-2 text-hardened" />}
              </div>
            );
          })}
          {agent.steps.steps.length > 5 && (
            <div className="text-[9px] text-muted-foreground">+ {agent.steps.steps.length - 5} more</div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Stats</span>
          <button onClick={() => onGoSection("dashboard")} className="text-[10px] text-primary hover:underline">Full dashboard →</button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div><div className="text-muted-foreground">Processed</div><div className="font-semibold tabular-nums">{agent.itemsProcessed.toLocaleString()}</div></div>
          <div><div className="text-muted-foreground">Automatic</div><div className="font-semibold tabular-nums">{autoPct}%</div></div>
          <div><div className="text-muted-foreground">Flagged</div><div className="font-semibold tabular-nums text-gate">{agent.flaggedCount.toLocaleString()}</div></div>
          <div><div className="text-muted-foreground">Runs</div><div className="font-semibold tabular-nums">{agent.runsCount}</div></div>
        </div>
      </div>

      {/* Recent runs (mocked) */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Recent runs</div>
        <div className="space-y-1">
          {[
            { status: "completed", when: "15m ago", items: 32 },
            { status: "completed", when: "30m ago", items: 18 },
            { status: "running", when: "now", items: 12 },
            { status: "failed", when: "1h ago", items: 0 },
          ].map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              <div className={cn("h-1.5 w-1.5 rounded-full", r.status === "completed" && "bg-emerald-500", r.status === "running" && "bg-primary", r.status === "failed" && "bg-destructive")} />
              <span className="capitalize">{r.status}</span>
              <span className="text-muted-foreground">· {r.items} items</span>
              <span className="ml-auto text-muted-foreground">{r.when}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick links to other sections */}
      <div className="flex flex-col gap-1">
        <button onClick={() => onGoSection("dashboard")} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-[11px] hover:border-primary/30">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" /> Full dashboard
          <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground" />
        </button>
        <button onClick={() => onGoSection("config")} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-[11px] hover:border-primary/30">
          <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" /> Edit config
          <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

'''

# Now assemble: replace the three sections.
# The file is: [0..start_idx) + new_section + [end_idx..cp_start) + new_centerpane + [cp_end..ip_start) + new_inspector + [ip_end..]
new_lines = (
    lines[:start_idx]
    + new_section.split('\n')
    + lines[end_idx:cp_start]
    + new_centerpane.split('\n')
    + lines[cp_end:ip_start]
    + new_inspector.split('\n')
    + lines[ip_end:]
)
path.write_text('\n'.join(new_lines))
print(f'OK: rebuilt agents-view. New file has {len(new_lines)} lines.')
