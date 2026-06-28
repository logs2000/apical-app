/**
 * Execute desktop bridge tools directly on the local machine.
 * Used when DESKTOP_LOCAL=true (Tauri prod server on the same host).
 * Hosted web agents still use the socket.io desktop-bridge on port 3005.
 */

import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'

function expandPath(p: string): string {
  const trimmed = p.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('~')) {
    return path.join(os.homedir(), trimmed.slice(1).replace(/^\//, ''))
  }
  return path.resolve(trimmed)
}

function runCli(
  cmd: string,
  cliArgs: string[],
  cwd: string | undefined,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cliArgs, {
      cwd: cwd ? expandPath(cwd) : undefined,
      shell: false,
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('timeout'))
    }, timeoutMs)
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code ?? 1 })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

export function isLocalDesktopRuntime(): boolean {
  return process.env.DESKTOP_LOCAL === 'true'
}

export async function invokeLocalDesktopTool(
  tool: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  try {
    switch (tool) {
      case 'desktop.fs.list': {
        const dir = expandPath(String(args.path ?? ''))
        if (!dir) return { ok: false, error: 'path is required' }
        const names = await fs.readdir(dir, { withFileTypes: true })
        const entries = await Promise.all(
          names.map(async (d) => {
            const full = path.join(dir, d.name)
            let size = 0
            try {
              if (d.isFile()) {
                const st = await fs.stat(full)
                size = st.size
              }
            } catch {
              /* stat may fail for symlinks etc. */
            }
            return {
              name: d.name,
              type: d.isDirectory() ? 'directory' : d.isFile() ? 'file' : 'other',
              size,
            }
          }),
        )
        return { ok: true, result: { entries } }
      }

      case 'desktop.fs.read': {
        const filePath = expandPath(String(args.path ?? ''))
        if (!filePath) return { ok: false, error: 'path is required' }
        const encoding = String(args.encoding ?? 'utf8') === 'base64' ? 'base64' : 'utf8'
        const buf = await fs.readFile(filePath)
        const content =
          encoding === 'base64' ? buf.toString('base64') : buf.toString('utf8')
        return { ok: true, result: { content } }
      }

      case 'desktop.fs.write': {
        const filePath = expandPath(String(args.path ?? ''))
        if (!filePath) return { ok: false, error: 'path is required' }
        const content = String(args.content ?? '')
        const encoding = String(args.encoding ?? 'utf8') === 'base64' ? 'base64' : 'utf8'
        const buf = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8')
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, buf)
        return { ok: true, result: { ok: true, bytes: buf.length } }
      }

      case 'desktop.fs.move': {
        const from = expandPath(String(args.from ?? ''))
        const to = expandPath(String(args.to ?? ''))
        if (!from || !to) return { ok: false, error: 'from and to are required' }
        await fs.mkdir(path.dirname(to), { recursive: true })
        await fs.rename(from, to)
        return { ok: true, result: { ok: true } }
      }

      case 'desktop.fs.watch': {
        return { ok: true, result: { ok: true, note: 'watch registered (local mode)' } }
      }

      case 'desktop.cli.run': {
        const cmd = String(args.cmd ?? '')
        if (!cmd) return { ok: false, error: 'cmd is required' }
        const cliArgs = Array.isArray(args.args) ? args.args.map(String) : []
        const cwd = typeof args.cwd === 'string' ? args.cwd : undefined
        const cliTimeout = Math.min(
          60_000,
          Math.max(1000, Number(args.timeoutMs) || timeoutMs),
        )
        const out = await runCli(cmd, cliArgs, cwd, cliTimeout)
        return { ok: true, result: out }
      }

      case 'desktop.net.fetch': {
        const url = String(args.url ?? '')
        if (!url) return { ok: false, error: 'url is required' }
        const method = typeof args.method === 'string' ? args.method : 'GET'
        const headers =
          args.headers && typeof args.headers === 'object' && !Array.isArray(args.headers)
            ? (args.headers as Record<string, string>)
            : undefined
        const body =
          args.body !== undefined && args.body !== null
            ? typeof args.body === 'string'
              ? args.body
              : JSON.stringify(args.body)
            : undefined
        const res = await fetch(url, { method, headers, body })
        const text = await res.text()
        const resHeaders: Record<string, string> = {}
        res.headers.forEach((v, k) => {
          resHeaders[k] = v
        })
        return { ok: true, result: { status: res.status, headers: resHeaders, body: text } }
      }

      case 'desktop.notify': {
        return { ok: true, result: { ok: true } }
      }

      case 'desktop.secrets.get': {
        const key = String(args.key ?? '')
        const envVal = key ? process.env[key] ?? null : null
        return { ok: true, result: { value: envVal } }
      }

      default:
        return { ok: false, error: `unknown_tool: ${tool}` }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
