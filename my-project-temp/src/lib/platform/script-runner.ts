// Server-side script execution with dependency support.
//
// Lets agents (and frozen workflow code nodes) run Node.js or Python scripts
// that use real packages: pass packages:["axios", ...] and they are installed
// into a cached, per-package-set environment under the OS temp dir before the
// script runs. Repeat runs with the same package set reuse the env, so only
// the first run pays the install cost.

import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { mkdir, writeFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

export interface ScriptRunResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  error?: string
}

const ENV_ROOT = path.join(tmpdir(), 'apical-script-envs')
const INSTALL_TIMEOUT_MS = 150_000
const MAX_OUTPUT = 20_000

// Package-name allowlists — installed via spawn (no shell), but keep names sane.
const NPM_PKG_RE = /^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*(@[a-zA-Z0-9.^~<>=*-]+)?$/
const PIP_PKG_RE = /^[A-Za-z0-9._-]+(\[[A-Za-z0-9,._-]+\])?([=<>!~]=?[A-Za-z0-9.*]+)*$/

function validatePackages(packages: string[], re: RegExp, kind: string): string | null {
  if (packages.length > 20) return `Too many packages (max 20).`
  for (const p of packages) {
    if (!re.test(p)) return `Invalid ${kind} package name: "${p}"`
  }
  return null
}

function envDirFor(prefix: string, packages: string[]): string {
  const hash = createHash('sha1').update([...packages].sort().join('\n')).digest('hex').slice(0, 16)
  return path.join(ENV_ROOT, `${prefix}-${hash}`)
}

function truncate(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n…(truncated)` : s
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; timeoutMs: number; input?: string },
): Promise<ScriptRunResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (e) {
      resolve({ ok: false, stdout: '', stderr: '', exitCode: null, error: (e as Error).message })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      resolve({
        ok: false,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        exitCode: null,
        error: `Timed out after ${Math.round(opts.timeoutMs / 1000)}s`,
      })
    }, opts.timeoutMs)
    child.stdout?.on('data', (d) => (stdout += String(d)))
    child.stderr?.on('data', (d) => (stderr += String(d)))
    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, stdout: '', stderr: '', exitCode: null, error: e.message })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        exitCode: code,
        error: code === 0 ? undefined : truncate(stderr) || `exit code ${code}`,
      })
    })
    if (opts.input) child.stdin?.write(opts.input)
    child.stdin?.end()
  })
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

// ---------------- Platform differences ----------------
//
// The desktop app ships to Windows, where none of the POSIX assumptions hold:
// the venv interpreter lives in Scripts\python.exe, there is no `python3` on
// PATH, and npm is a .cmd shim that spawn() cannot exec directly.

const IS_WINDOWS = process.platform === 'win32'

/** The npm executable to spawn. On Windows the shim needs its .cmd extension. */
const NPM_BIN = IS_WINDOWS ? 'npm.cmd' : 'npm'

/** Where a venv puts its interpreter — bin/python on POSIX, Scripts\python.exe on Windows. */
function venvPython(venvDir: string): string {
  return IS_WINDOWS
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')
}

/**
 * Find a usable Python interpreter.
 *
 * Windows installs expose `python` and the `py` launcher but generally not
 * `python3`, so probing in order (and caching the winner) is the only reliable
 * way to work on both a Mac laptop and a Windows desktop.
 */
let cachedPython: string | null = null

async function findPython(): Promise<string | null> {
  if (cachedPython) return cachedPython
  const candidates = IS_WINDOWS ? ['python', 'py', 'python3'] : ['python3', 'python']
  for (const cmd of candidates) {
    const probe = await run(cmd, ['--version'], { timeoutMs: 10_000 })
    if (probe.ok) {
      cachedPython = cmd
      return cmd
    }
  }
  return null
}

/** Reset the cached interpreter — for tests and for retrying after an install. */
export function resetPythonCache(): void {
  cachedPython = null
}

/** Run a Node.js script, optionally with npm packages (require() works). */
export async function runNodeScript(
  code: string,
  packages: string[] = [],
  opts: { data?: string; timeoutMs?: number } = {},
): Promise<ScriptRunResult> {
  const bad = validatePackages(packages, NPM_PKG_RE, 'npm')
  if (bad) return { ok: false, stdout: '', stderr: '', exitCode: null, error: bad }

  const dir = envDirFor('node', packages)
  await mkdir(dir, { recursive: true })

  if (packages.length > 0 && !(await exists(path.join(dir, 'node_modules')))) {
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'apical-script', private: true }, null, 2),
    )
    const install = await run(
      NPM_BIN,
      ['install', '--no-audit', '--no-fund', '--loglevel=error', ...packages],
      { cwd: dir, timeoutMs: INSTALL_TIMEOUT_MS },
    )
    if (!install.ok) {
      await rm(path.join(dir, 'node_modules'), { recursive: true, force: true }).catch(() => {})
      return { ...install, error: `npm install failed: ${install.error}` }
    }
  }

  // Wrap in an async IIFE so top-level await/return work; a returned value is
  // printed as the result (REPL-like), console output passes through.
  const wrapped =
    `const data = process.env.APICAL_DATA ? JSON.parse(process.env.APICAL_DATA) : undefined;\n` +
    `(async () => {\n${code}\n})().then((r) => {\n` +
    `  if (r !== undefined) console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2));\n` +
    `}).catch((e) => { console.error((e && e.stack) || String(e)); process.exit(1); });\n`
  const scriptPath = path.join(dir, `script-${Date.now()}.cjs`)
  await writeFile(scriptPath, wrapped)
  try {
    return await run('node', [scriptPath], {
      cwd: dir,
      ...(opts.data ? { env: { APICAL_DATA: opts.data } } : {}),
      timeoutMs: opts.timeoutMs ?? 60_000,
    })
  } finally {
    void rm(scriptPath, { force: true }).catch(() => {})
  }
}

/** Run a Python script, optionally with PyPI packages (via a cached venv). */
export async function runPythonScript(
  code: string,
  packages: string[] = [],
  opts: { data?: string; timeoutMs?: number } = {},
): Promise<ScriptRunResult> {
  const bad = validatePackages(packages, PIP_PKG_RE, 'PyPI')
  if (bad) return { ok: false, stdout: '', stderr: '', exitCode: null, error: bad }

  const systemPython = await findPython()
  if (!systemPython) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      error: IS_WINDOWS
        ? 'Python is not installed or not on PATH. Install it from python.org (tick "Add python.exe to PATH") or from the Microsoft Store, then retry.'
        : 'Python 3 is not installed or not on PATH.',
    }
  }

  let python = systemPython
  if (packages.length > 0) {
    const dir = envDirFor('py', packages)
    const venvDir = path.join(dir, 'venv')
    const interpreter = venvPython(venvDir)
    if (!(await exists(interpreter))) {
      await mkdir(dir, { recursive: true })
      const venv = await run(systemPython, ['-m', 'venv', venvDir], { timeoutMs: 60_000 })
      if (!venv.ok) {
        return {
          ...venv,
          error: `Could not create Python env with ${systemPython}: ${venv.error}`,
        }
      }
      const install = await run(
        interpreter,
        ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', ...packages],
        { timeoutMs: INSTALL_TIMEOUT_MS },
      )
      if (!install.ok) {
        await rm(venvDir, { recursive: true, force: true }).catch(() => {})
        return { ...install, error: `pip install failed: ${install.error}` }
      }
    }
    python = interpreter
  }

  return run(python, ['-c', code], {
    ...(opts.data ? { env: { APICAL_DATA: opts.data } } : {}),
    timeoutMs: opts.timeoutMs ?? 60_000,
  })
}
