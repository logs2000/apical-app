/**
 * Plain-English labels for agent tool calls, shown as quiet one-line action
 * rows in chat. Never surfaces raw dotted tool ids to the user.
 */

type Phase = 'running' | 'done' | 'error'

function clip(v: unknown, max = 60): string {
  if (typeof v !== 'string') return ''
  const s = v.trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** Filename (last path segment) from a path-ish string, home-tilde shortened. */
function fileName(p: unknown): string {
  const s = clip(p, 200)
  if (!s) return ''
  const home = s.replace(/^\/Users\/[^/]+/, '~')
  const parts = home.split('/').filter(Boolean)
  return clip(parts[parts.length - 1] || home)
}

function hostname(u: unknown): string {
  const s = clip(u, 200)
  if (!s) return ''
  try {
    return new URL(s).hostname.replace(/^www\./, '')
  } catch {
    return clip(s)
  }
}

/** Sentence-case a raw tool id as a last-resort label. */
function humanizeToolId(tool: string): string {
  const words = tool.replace(/[._-]+/g, ' ').trim()
  if (!words) return 'task'
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * A friendly, human sentence for a tool call at a given phase.
 * running → present continuous ("Searching the web for …")
 * done    → past tense ("Searched the web for …")
 * error   → "Couldn't …"
 */
export function friendlyActionLabel(
  tool: string,
  input?: Record<string, unknown>,
  phase: Phase = 'done',
): string {
  const i = input ?? {}
  const pick = (running: string, done: string, error: string) =>
    phase === 'running' ? running : phase === 'error' ? error : done

  switch (tool) {
    case 'web_search': {
      const q = clip(i.query)
      const suffix = q ? ` for "${q}"` : ''
      return pick(`Searching the web${suffix}`, `Searched the web${suffix}`, `Couldn't search the web${suffix}`)
    }
    case 'web_read': {
      const host = hostname(i.url)
      const suffix = host ? ` ${host}` : ' a page'
      return pick(`Reading${suffix}`, `Read${suffix}`, `Couldn't read${suffix}`)
    }
    case 'http_request':
    case 'http': {
      const host = hostname(i.url)
      const suffix = host ? ` ${host}` : ' an API'
      return pick(`Calling${suffix}`, `Called${suffix}`, `Couldn't reach${suffix}`)
    }
    case 'fs_list': {
      const dir = fileName(i.path) || 'folder'
      return pick(`Listing ${dir}`, `Listed ${dir}`, `Couldn't list ${dir}`)
    }
    case 'fs_read': {
      const f = fileName(i.path) || 'a file'
      return pick(`Reading ${f}`, `Read ${f}`, `Couldn't read ${f}`)
    }
    case 'fs_write': {
      const f = fileName(i.path) || 'a file'
      return pick(`Writing ${f}`, `Created ${f}`, `Couldn't write ${f}`)
    }
    case 'fs_move': {
      const f = fileName(i.to) || fileName(i.from) || 'a file'
      return pick(`Moving ${f}`, `Moved ${f}`, `Couldn't move ${f}`)
    }
    case 'asset_save': {
      const f = clip(i.name) || 'a file'
      return pick(`Saving ${f}`, `Saved ${f}`, `Couldn't save ${f}`)
    }
    case 'code_eval':
    case 'script_run':
    case 'cli_run':
      return pick('Running code', 'Ran code', "Code didn't run")
    case 'mcp_call_tool':
    case 'mcp': {
      const t = clip(i.toolName ?? i.tool ?? i.name) || 'a connected tool'
      return pick(`Using ${t}`, `Used ${t}`, `Couldn't use ${t}`)
    }
    case 'data_table_create':
      return pick('Creating a data table', 'Created a data table', "Couldn't create the data table")
    case 'data_table_insert':
      return pick('Saving rows to the table', 'Saved rows to the table', "Couldn't save rows")
    case 'data_table_query':
      return pick('Querying the data table', 'Queried the data table', "Couldn't query the table")
    case 'integration_list':
    case 'mcp_list_servers':
      return pick('Checking connected apps', 'Checked connected apps', "Couldn't check connected apps")
    case 'credential_list':
      return pick('Checking saved keys', 'Checked saved keys', "Couldn't check saved keys")
    case 'credential_request':
      return pick('Requesting an API key', 'Requested an API key', "Couldn't request the key")
    case 'tool_configure':
      return pick('Adding a new capability', 'Added a new capability', "Couldn't add the capability")
    case 'workflow_freeze':
      return pick('Saving the automation', 'Saved the automation', "Couldn't save the automation")
    case 'workflow_update':
    case 'workflow_step_append':
    case 'workflow_step_patch':
    case 'workflow_improve':
      return pick('Updating the automation', 'Updated the automation', "Couldn't update the automation")
    case 'workflow_monitor':
      return pick('Reviewing recent runs', 'Reviewed recent runs', "Couldn't review runs")
    case 'schedule_agent':
      return pick('Scheduling the automation', 'Scheduled the automation', "Couldn't schedule it")
    case 'watch_folder':
      return pick('Setting up a folder watch', 'Set up a folder watch', "Couldn't set up the watch")
    case 'agent_list':
      return pick('Checking your agents', 'Checked your agents', "Couldn't check your agents")
    case 'agent_create':
      return pick('Creating a new agent', 'Created a new agent', "Couldn't create the agent")
    default: {
      const name = humanizeToolId(tool)
      return pick(`Running ${name}`, `Finished ${name}`, `${name} failed`)
    }
  }
}
