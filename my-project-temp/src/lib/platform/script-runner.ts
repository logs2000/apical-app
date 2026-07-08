// Server-side script execution with dependency support.
//
// Lets agents (and frozen workflow code nodes) run Node.js or Python scripts
// that use real packages: pass packages:["axios", ...] and they are installed
// into a cached, per-package-set environment under the OS temp dir before the
// script runs. Repeat runs with the same package set reuse the env, so only
// the first run pays the install cost.

import { spawn, type ChildProcess } from 'child_process'
import { createHash } from 'crypto'
import { mkdir, writeFile, readFile, rm, stat, readdir } from 'fs/promises'
import { existsSync } from 'fs'
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

// Env vars a child process is allowed to inherit. Everything else — most
// importantly DATABASE_URL, APICAL_VAULT_KEY, and every provider/relay/worker
// secret — is withheld, so a malicious or hallucinated script can't read
// secrets or connect to the platform DB. Package managers still get PATH +
// proxy vars so installs work. The keys we DO pass a child (APICAL_DATA,
// APICAL_JOB_DIR, NODE_PATH) are added explicitly via opts.env.
const ENV_ALLOWLIST = new Set([
  'PATH', 'HOME', 'HOSTNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TERM',
  'SHELL', 'USER', 'LOGNAME', 'TZ', 'NODE_VERSION', 'PYTHONUNBUFFERED',
  // Proxy config so npm/pip installs reach the registry through the agent proxy.
  'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy',
  'npm_config_registry', 'PIP_INDEX_URL', 'NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE',
])

/** A minimal, secret-free environment for a child process. */
function scrubbedEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {
    // Scripts must never see the server's real mode/config — pin a neutral one.
    NODE_ENV: 'production',
  }
  for (const k of ENV_ALLOWLIST) {
    const v = process.env[k]
    if (typeof v === 'string') out[k] = v
  }
  return { ...out, ...(extra ?? {}) }
}

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

const POSIX = process.platform !== 'win32'

// prlimit (util-linux) lets us cap resources on untrusted code without a full
// container: CPU seconds, address space, process count (fork-bomb), file size,
// open files. Best-effort — if it isn't installed the code still runs, just
// without the caps. Detected once.
let prlimitPath: string | null | undefined
function findPrlimit(): string | null {
  if (prlimitPath !== undefined) return prlimitPath
  prlimitPath = POSIX
    ? (['/usr/bin/prlimit', '/bin/prlimit', '/sbin/prlimit'].find((p) => {
        try {
          return existsSync(p)
        } catch {
          return false
        }
      }) ?? null)
    : null
  return prlimitPath
}

/** Resource caps for untrusted user code (override via env). */
const HARD_CPU_SECONDS = Number(process.env.APICAL_SANDBOX_CPU_SECONDS) || 60
const HARD_AS_BYTES = Number(process.env.APICAL_SANDBOX_MEM_BYTES) || 2 * 1024 * 1024 * 1024
const HARD_NPROC = Number(process.env.APICAL_SANDBOX_NPROC) || 256
const HARD_FSIZE_BYTES = Number(process.env.APICAL_SANDBOX_FSIZE_BYTES) || 512 * 1024 * 1024
const HARD_NOFILE = 1024

// When `hardened`, prepend prlimit so a runaway can't fork-bomb, exhaust memory,
// or fill the disk. Returns the (possibly wrapped) command + args.
function applyLimits(cmd: string, args: string[], hardened: boolean): { cmd: string; args: string[] } {
  if (!hardened) return { cmd, args }
  const prlimit = findPrlimit()
  if (!prlimit) return { cmd, args }
  return {
    cmd: prlimit,
    args: [
      `--cpu=${HARD_CPU_SECONDS}`,
      `--as=${HARD_AS_BYTES}`,
      `--nproc=${HARD_NPROC}`,
      `--fsize=${HARD_FSIZE_BYTES}`,
      `--nofile=${HARD_NOFILE}`,
      '--',
      cmd,
      ...args,
    ],
  }
}

function run(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs: number
    input?: string
    /** Untrusted user code: run under resource limits (installs stay off). */
    hardened?: boolean
  },
): Promise<ScriptRunResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    const launch = applyLimits(cmd, args, !!opts.hardened)
    try {
      child = spawn(launch.cmd, launch.args, {
        cwd: opts.cwd,
        env: scrubbedEnv(opts.env),
        stdio: ['pipe', 'pipe', 'pipe'],
        // Own process group so a timeout kills the whole tree, not just the
        // direct child — a script that spawns subprocesses can't orphan them.
        detached: POSIX,
      })
    } catch (e) {
      resolve({ ok: false, stdout: '', stderr: '', exitCode: null, error: (e as Error).message })
      return
    }
    // Kill the process GROUP (negative pid) when we can, so grandchildren die too.
    const killTree = () => {
      try {
        if (POSIX && typeof child.pid === 'number') process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      }
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      killTree()
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
      'npm',
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
      hardened: true,
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

  let python = 'python3'
  if (packages.length > 0) {
    const dir = envDirFor('py', packages)
    const venvPython = path.join(dir, 'venv', 'bin', 'python')
    if (!(await exists(venvPython))) {
      await mkdir(dir, { recursive: true })
      const venv = await run('python3', ['-m', 'venv', path.join(dir, 'venv')], {
        timeoutMs: 60_000,
      })
      if (!venv.ok) {
        return {
          ...venv,
          error: `Could not create Python env (is python3 installed on the server?): ${venv.error}`,
        }
      }
      const install = await run(
        venvPython,
        ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', ...packages],
        { timeoutMs: INSTALL_TIMEOUT_MS },
      )
      if (!install.ok) {
        await rm(path.join(dir, 'venv'), { recursive: true, force: true }).catch(() => {})
        return { ...install, error: `pip install failed: ${install.error}` }
      }
    }
    python = venvPython
  }

  return run(python, ['-c', code], {
    ...(opts.data ? { env: { APICAL_DATA: opts.data } } : {}),
    timeoutMs: opts.timeoutMs ?? 60_000,
    hardened: true,
  })
}

// ---------------- code_eval (isolated) ----------------
//
// code_eval used to run in-process via `new Function`, which is NOT a sandbox:
// `({}).constructor.constructor('return process')()` reaches Node globals and
// leaks process.env (vault key, DB URL, secrets). It now runs in a scrubbed
// short-lived subprocess with no secrets in its env, so even a full escape
// yields nothing useful. Returns the last-expression value + captured logs.

export interface CodeEvalResult {
  ok: boolean
  result?: unknown
  logs?: string
  error?: string
}

const CODE_EVAL_TIMEOUT_MS = 10_000

export async function runCodeEval(code: string, data?: unknown): Promise<CodeEvalResult> {
  const wrapper =
    `const __logs=[];` +
    `const __push=(...a)=>__logs.push(a.map(x=>typeof x==='string'?x:(()=>{try{return JSON.stringify(x)}catch{return String(x)}})()).join(' '));` +
    `const console={log:__push,info:__push,warn:__push,error:__push,debug:__push};` +
    `const data=process.env.APICAL_DATA?JSON.parse(process.env.APICAL_DATA):undefined;` +
    `(async()=>{return (function(){\n${code}\n})()})().then((r)=>{` +
    `process.stdout.write('__APICAL_EVAL__'+JSON.stringify({ok:true,result:r===undefined?undefined:r,logs:__logs.join('\\n')||undefined}));` +
    `}).catch((e)=>{` +
    `process.stdout.write('__APICAL_EVAL__'+JSON.stringify({ok:false,error:(e&&e.message)||String(e),logs:__logs.join('\\n')||undefined}));` +
    `});`
  const dir = path.join(tmpdir(), 'apical-code-eval')
  await mkdir(dir, { recursive: true })
  const scriptPath = path.join(dir, `eval-${process.pid}-${randomStamp()}.cjs`)
  await writeFile(scriptPath, wrapper)
  try {
    const res = await run('node', [scriptPath], {
      cwd: dir,
      timeoutMs: CODE_EVAL_TIMEOUT_MS,
      ...(data !== undefined ? { env: { APICAL_DATA: JSON.stringify(data) } } : {}),
      hardened: true,
    })
    if (!res.ok && res.error && !res.stdout.includes('__APICAL_EVAL__')) {
      return { ok: false, error: res.error }
    }
    const marker = res.stdout.indexOf('__APICAL_EVAL__')
    if (marker < 0) return { ok: false, error: 'code produced no result' }
    try {
      const parsed = JSON.parse(res.stdout.slice(marker + '__APICAL_EVAL__'.length)) as CodeEvalResult
      return parsed
    } catch {
      return { ok: false, error: 'could not parse eval result' }
    }
  } finally {
    void rm(scriptPath, { force: true }).catch(() => {})
  }
}

// A collision-resistant stamp without Date.now/Math.random (avoids surprises in
// resumable contexts) — a monotonic counter is enough for temp filenames.
let __stamp = 0
function randomStamp(): string {
  __stamp = (__stamp + 1) % 1_000_000
  return `${process.hrtime.bigint().toString(36)}-${__stamp}`
}

// ---------------- Long-running detached jobs ----------------
//
// Unlike run() above (which buffers output and resolves on close), a job runs
// for minutes-to-hours: output streams to files, progress is read from a
// progress.json the script writes, and output files under out/ become
// artifacts. The job's env is a dedicated scratch dir (not the shared package
// cache), so concurrent jobs never collide.

export interface JobHandle {
  /** Kill the running job. */
  cancel(): void
  /** Resolves when the process exits (or is killed / times out). */
  done: Promise<JobRunResult>
}

export interface JobRunResult {
  ok: boolean
  exitCode: number | null
  stdoutTail: string
  stderrTail: string
  error?: string
  timedOut: boolean
  /** Absolute paths of files the job wrote under its out/ dir. */
  artifactPaths: string[]
}

export interface JobProgress {
  progress?: number
  note?: string
}

const JOB_ROOT = process.env.JOB_SCRATCH_DIR || path.join(tmpdir(), 'apical-jobs')
const JOB_OUTPUT_TAIL = 40_000

function tailStr(s: string): string {
  return s.length > JOB_OUTPUT_TAIL ? `…(truncated)\n${s.slice(-JOB_OUTPUT_TAIL)}` : s
}

/** The dir a job runs in. Callers read progress.json + out/ from here. */
export function jobScratchDir(jobId: string): string {
  return path.join(JOB_ROOT, jobId)
}

/** Read a job's current progress (written by the script to progress.json). */
export async function readJobProgress(jobId: string): Promise<JobProgress | null> {
  try {
    const raw = await readFile(path.join(jobScratchDir(jobId), 'progress.json'), 'utf8')
    const parsed = JSON.parse(raw) as JobProgress
    return {
      progress: typeof parsed.progress === 'number' ? Math.max(0, Math.min(1, parsed.progress)) : undefined,
      note: typeof parsed.note === 'string' ? parsed.note.slice(0, 500) : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Launch a long-running Node/Python job as a detached-in-process child. The
 * script gets:
 *   - APICAL_DATA  (JSON args, same as short scripts)
 *   - APICAL_JOB_DIR  (its scratch dir; write outputs to $APICAL_JOB_DIR/out)
 *   - a progress.json it can rewrite to report { progress: 0..1, note }
 * The runner does NOT block — it returns a handle; poll readJobProgress and
 * await handle.done.
 */
export async function startScriptJob(params: {
  jobId: string
  language: 'javascript' | 'python' | 'shell'
  source: string
  packages?: string[]
  data?: string
  args?: string[]
  timeoutMs: number
}): Promise<JobHandle> {
  const { jobId, language, source, packages = [], data, timeoutMs } = params
  const dir = jobScratchDir(jobId)
  const outDir = path.join(dir, 'out')
  await mkdir(outDir, { recursive: true })

  const re = language === 'python' ? PIP_PKG_RE : NPM_PKG_RE
  const bad = language === 'shell' ? null : validatePackages(packages, re, language)
  if (bad) {
    return { cancel() {}, done: Promise.resolve(jobFail(bad)) }
  }

  // Resolve the interpreter + install deps into the shared package cache.
  let cmd: string
  let cmdArgs: string[]
  const env: Record<string, string> = {
    APICAL_JOB_DIR: dir,
    ...(data ? { APICAL_DATA: data } : {}),
  }

  if (language === 'python') {
    let python = 'python3'
    if (packages.length > 0) {
      const pkgDir = envDirFor('py', packages)
      const venvPython = path.join(pkgDir, 'venv', 'bin', 'python')
      if (!(await exists(venvPython))) {
        await mkdir(pkgDir, { recursive: true })
        const venv = await run('python3', ['-m', 'venv', path.join(pkgDir, 'venv')], { timeoutMs: 60_000 })
        if (!venv.ok) return { cancel() {}, done: Promise.resolve(jobFail(`venv failed: ${venv.error}`)) }
        const install = await run(
          venvPython,
          ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', ...packages],
          { timeoutMs: INSTALL_TIMEOUT_MS },
        )
        if (!install.ok) return { cancel() {}, done: Promise.resolve(jobFail(`pip install failed: ${install.error}`)) }
      }
      python = venvPython
    }
    const scriptPath = path.join(dir, 'job.py')
    await writeFile(scriptPath, source)
    cmd = python
    cmdArgs = [scriptPath, ...(params.args ?? [])]
  } else if (language === 'shell') {
    const scriptPath = path.join(dir, 'job.sh')
    await writeFile(scriptPath, source)
    cmd = 'bash'
    cmdArgs = [scriptPath, ...(params.args ?? [])]
  } else {
    const pkgDir = envDirFor('node', packages)
    await mkdir(pkgDir, { recursive: true })
    if (packages.length > 0 && !(await exists(path.join(pkgDir, 'node_modules')))) {
      await writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'apical-job', private: true }))
      const install = await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', ...packages], {
        cwd: pkgDir,
        timeoutMs: INSTALL_TIMEOUT_MS,
      })
      if (!install.ok) return { cancel() {}, done: Promise.resolve(jobFail(`npm install failed: ${install.error}`)) }
    }
    const scriptPath = path.join(dir, 'job.cjs')
    await writeFile(scriptPath, source)
    // Resolve installed packages from the shared cache via NODE_PATH.
    if (packages.length > 0) env.NODE_PATH = path.join(pkgDir, 'node_modules')
    cmd = 'node'
    cmdArgs = [scriptPath, ...(params.args ?? [])]
  }

  let child: ChildProcess
  try {
    child = spawn(cmd, cmdArgs, { cwd: dir, env: scrubbedEnv(env), stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    return { cancel() {}, done: Promise.resolve(jobFail((e as Error).message)) }
  }

  let stdout = ''
  let stderr = ''
  let killed = false
  let timedOut = false
  child.stdout?.on('data', (d) => (stdout += String(d)).length > JOB_OUTPUT_TAIL * 2 && (stdout = stdout.slice(-JOB_OUTPUT_TAIL)))
  child.stderr?.on('data', (d) => (stderr += String(d)).length > JOB_OUTPUT_TAIL * 2 && (stderr = stderr.slice(-JOB_OUTPUT_TAIL)))

  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, timeoutMs)

  const done = new Promise<JobRunResult>((resolve) => {
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, exitCode: null, stdoutTail: tailStr(stdout), stderrTail: tailStr(stderr), error: e.message, timedOut, artifactPaths: [] })
    })
    child.on('close', async (code) => {
      clearTimeout(timer)
      const artifactPaths = await listArtifacts(outDir)
      resolve({
        ok: !timedOut && !killed && code === 0,
        exitCode: code,
        stdoutTail: tailStr(stdout),
        stderrTail: tailStr(stderr),
        error: timedOut ? `Timed out after ${Math.round(timeoutMs / 1000)}s` : code === 0 ? undefined : tailStr(stderr) || `exit code ${code}`,
        timedOut,
        artifactPaths,
      })
    })
  })

  return {
    cancel() {
      killed = true
      child.kill('SIGKILL')
    },
    done,
  }
}

function jobFail(error: string): JobRunResult {
  return { ok: false, exitCode: null, stdoutTail: '', stderrTail: '', error, timedOut: false, artifactPaths: [] }
}

async function listArtifacts(outDir: string): Promise<string[]> {
  try {
    const names = await readdir(outDir)
    return names.map((n) => path.join(outDir, n))
  } catch {
    return []
  }
}

/** Remove a finished job's scratch dir. */
export async function cleanupJobDir(jobId: string): Promise<void> {
  await rm(jobScratchDir(jobId), { recursive: true, force: true }).catch(() => {})
}
