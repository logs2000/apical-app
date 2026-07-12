// Destructive-action risk classification.
//
// Every agent tool call is graded before it runs (see executeWorkTool). The
// grade drives the approval policy: 'safe' runs freely, 'caution' is gated
// under the 'ask' tier, and 'critical' is ALWAYS gated — even under full
// authority — and auto-denied in a headless/scheduled run. This is the
// enforced backstop to the model's voluntary request_review: whether the agent
// pauses before `rm -rf ~` must not depend on the LLM's judgment.
//
// Pure + dependency-free so it's exhaustively unit-testable and importable from
// the engine, the workflow runtime, and tests alike.

export type RiskLevel = 'safe' | 'caution' | 'critical'

export interface RiskAssessment {
  level: RiskLevel
  /** Machine-ish reason slug, e.g. 'recursive_delete', 'privilege_escalation'. */
  reason: string
  /** One-line human summary for the approval card. */
  summary: string
}

const SAFE: RiskAssessment = { level: 'safe', reason: 'read_only', summary: '' }

/** Absolute paths whose subtree is part of the OS / user profile root — writing
 *  or deleting here is critical regardless of flags. */
const SYSTEM_PATH_RE =
  /^(\/|\/etc|\/bin|\/sbin|\/usr|\/var|\/lib|\/boot|\/dev|\/sys|\/proc|\/system|\/library|\/opt|\/root|[a-z]:\\?$|[a-z]:\\(windows|program files|system32)|\/applications)(\/|\\|$)/i

/** A path that is the root of a home directory (not a file deep inside it). */
const HOME_ROOT_RE = /^(~|\$home|\/home\/[^/]+|\/users\/[^/]+|c:\\users\\[^\\]+)\/?$/i

export function isSystemPath(p: string): boolean {
  const t = p.trim().replace(/['"]/g, '')
  return SYSTEM_PATH_RE.test(t) || HOME_ROOT_RE.test(t)
}

/** Does a delete/wipe target look like a root/home/wildcard (catastrophic scope)? */
function isCatastrophicTarget(target: string): boolean {
  const t = target.trim().replace(/['"]/g, '')
  if (t === '' ) return false
  if (t === '/' || t === '/*' || t === '~' || t === '~/' || t === '~/*') return true
  if (t === '.' || t === './' || t === '..' || t === '*') return true
  if (/^\$home\/?\*?$/i.test(t)) return true
  return isSystemPath(t)
}

interface Rule {
  re: RegExp
  reason: string
  summary: string
}

// Ordered CRITICAL rules for a shell command string. First match wins.
const CRITICAL_SHELL_RULES: Rule[] = [
  { re: /\bsudo\b|\bdoas\b|\bpkexec\b/, reason: 'privilege_escalation', summary: 'Runs a command with elevated privileges (sudo).' },
  { re: /\bmkfs\b|\bdiskutil\s+erase|\bfdisk\b|\bwipefs\b|\bformat\s+[a-z]:/i, reason: 'disk_format', summary: 'Formats or erases a disk.' },
  { re: /\bdd\b[^|]*\bof=\/dev\/|>\s*\/dev\/(sd|nvme|disk|hd)/i, reason: 'raw_disk_write', summary: 'Writes directly to a raw disk device.' },
  { re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'fork_bomb', summary: 'Fork bomb — exhausts the machine.' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b|\bkill\s+-9\s+-1\b/, reason: 'system_control', summary: 'Shuts down, reboots, or halts the machine.' },
  { re: /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh|python|node|perl)\b/i, reason: 'remote_code_exec', summary: 'Pipes a downloaded script straight into a shell.' },
  { re: /\bgit\s+push\b[^\n]*(--force\b|(^|\s)-f(\s|$))/, reason: 'force_push', summary: 'Force-pushes git history (can overwrite remote work).' },
  { re: /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i, reason: 'destructive_sql', summary: 'Drops or truncates a database object.' },
  { re: /\bchmod\s+-[a-z]*R|\bchown\s+-[a-z]*R/i, reason: 'recursive_perms', summary: 'Recursively changes permissions/ownership.' },
]

/** Extract the operands of an `rm` invocation (tokens that aren't flags). */
function rmTargets(cmd: string): string[] {
  const m = cmd.match(/\brm\b([^\n;&|]*)/)
  if (!m) return []
  return m[1]
    .trim()
    .split(/\s+/)
    .filter((t) => t && !t.startsWith('-'))
}

function hasRecursiveForce(cmd: string): boolean {
  // rm -rf, -fr, -r -f, --recursive --force, del /s, rd /s
  return (
    /\brm\b[^\n;&|]*-[a-z]*r[a-z]*f|\brm\b[^\n;&|]*-[a-z]*f[a-z]*r|\brm\b[^\n;&|]*(--recursive|--force)/i.test(cmd) ||
    /\b(rd|rmdir)\b[^\n]*\/s/i.test(cmd) ||
    /\bdel\b[^\n]*\/[sq]/i.test(cmd)
  )
}

/** Classify a raw shell command line. cli_run and shell script_run share this. */
export function classifyShellCommand(raw: string): RiskAssessment {
  const cmd = raw.trim()
  if (!cmd) return { level: 'caution', reason: 'shell', summary: 'Runs a shell command.' }

  for (const rule of CRITICAL_SHELL_RULES) {
    if (rule.re.test(cmd)) return { level: 'critical', reason: rule.reason, summary: rule.summary }
  }

  // Recursive/forced deletes: critical if the scope looks catastrophic.
  if (hasRecursiveForce(cmd)) {
    const targets = rmTargets(cmd)
    if (targets.length === 0 || targets.some(isCatastrophicTarget)) {
      return { level: 'critical', reason: 'recursive_delete', summary: 'Recursively force-deletes files at a broad or system path.' }
    }
    return { level: 'caution', reason: 'recursive_delete', summary: 'Recursively deletes files.' }
  }

  // Non-recursive but still mutating shell verbs → caution.
  if (/\b(rm|rmdir|unlink|mv|shred|truncate|git\s+reset\s+--hard|git\s+clean|npm\s+publish|kill|pkill)\b|>\s*[^>\s]/.test(cmd)) {
    return { level: 'caution', reason: 'mutating_shell', summary: 'Modifies or removes files.' }
  }

  // Any other shell command is caution by default — it can do anything.
  return { level: 'caution', reason: 'shell', summary: 'Runs a shell command on the machine.' }
}

/**
 * Grade a single agent tool call. `input` is the tool's argument object.
 * Unknown/read-only tools are 'safe'; the caller only gates caution/critical.
 */
export function classifyToolCall(tool: string, input: Record<string, unknown>): RiskAssessment {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  switch (tool) {
    case 'cli_run': {
      const command = [str(input.command), ...(Array.isArray(input.args) ? input.args.map(str) : [])].join(' ')
      return classifyShellCommand(command)
    }
    case 'script_run':
    case 'job_submit': {
      // Only the shell language actually runs an arbitrary command line; js/python
      // run in the hardened script-runner (sandboxed), so they're caution, not critical.
      const language = str(input.language).toLowerCase()
      if (language === 'shell' || language === 'bash' || language === 'sh') {
        return classifyShellCommand(str(input.code) || str(input.source) || str(input.command))
      }
      return { level: 'caution', reason: 'script_exec', summary: 'Runs a script.' }
    }
    case 'fs_write': {
      const p = str(input.path)
      if (isSystemPath(p)) return { level: 'critical', reason: 'system_write', summary: `Overwrites a system file: ${p}` }
      return { level: 'caution', reason: 'file_overwrite', summary: `Writes/overwrites ${p || 'a file'}.` }
    }
    case 'fs_move': {
      const from = str(input.from)
      const to = str(input.to)
      if (isSystemPath(from) || isSystemPath(to)) {
        return { level: 'critical', reason: 'system_move', summary: `Moves a system path: ${from} → ${to}` }
      }
      return { level: 'caution', reason: 'file_move', summary: `Moves ${from || 'a file'} → ${to || '…'}.` }
    }
    // Outward-facing / spend actions the taxonomy calls out (send/post/pay).
    case 'email_send':
    case 'send_email':
    case 'mcp_call_tool': {
      // Generic external side-effect surface — caution (the model still owns
      // whether it's mass/external; this is a floor, not a ceiling).
      return { level: 'caution', reason: 'external_action', summary: 'Performs an external action (send/post/call).' }
    }
    default:
      return SAFE
  }
}

/** True when the tool is one the classifier can meaningfully grade (i.e. it can
 *  produce a non-safe level). Lets the engine skip the check cheaply. */
export function isGradableTool(tool: string): boolean {
  return (
    tool === 'cli_run' ||
    tool === 'script_run' ||
    tool === 'job_submit' ||
    tool === 'fs_write' ||
    tool === 'fs_move' ||
    tool === 'email_send' ||
    tool === 'send_email' ||
    tool === 'mcp_call_tool'
  )
}
