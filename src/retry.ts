import { spawn } from 'node:child_process'
import { info } from './core.js'

export interface RetryResult {
  exitCode: number
  output: string
}

export function shouldRetry(
  exitCode: number,
  retryOnExitCode: number[] | null
): boolean {
  if (exitCode === 0) return false
  if (retryOnExitCode === null) return true
  return retryOnExitCode.includes(exitCode)
}

export function parseRetryOnExitCode(input: string): number[] | null {
  if (!input) return null
  return input
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n))
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Windows has no process groups to signal, so the child is only detached
// where killing the whole tree actually works.
const useProcessGroup = process.platform !== 'win32'

export function executeCommand(
  command: string,
  shell: string,
  timeout: number | null,
  workingDirectory: string
): Promise<RetryResult> {
  return new Promise((resolve, reject) => {
    info(`[command]${shell} -c ${command}`)

    const child = spawn(shell, ['-c', command], {
      ...(workingDirectory && { cwd: workingDirectory }),
      detached: useProcessGroup,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
      process.stdout.write(data)
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
      process.stderr.write(data)
    })

    if (timeout !== null) {
      timer = setTimeout(() => {
        timedOut = true
        const pid = child.pid
        if (pid === undefined) return
        try {
          // Negating the pid signals the whole group, so children the command
          // spawned are torn down with it.
          process.kill(useProcessGroup ? -pid : pid, 'SIGKILL')
        } catch {
          // The process is already gone; nothing left to kill.
        }
      }, timeout * 1000)
    }

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        output: (stdout + stderr).trimEnd()
      })
    })
  })
}
