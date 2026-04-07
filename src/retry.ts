import * as exec from '@actions/exec'

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
    .filter((n) => !isNaN(n))
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function executeCommand(
  command: string,
  shell: string,
  timeout: number | null
): Promise<RetryResult> {
  let stdout = ''
  let stderr = ''

  const options: exec.ExecOptions = {
    ignoreReturnCode: true,
    listeners: {
      stdout: (data: Buffer) => {
        stdout += data.toString()
      },
      stderr: (data: Buffer) => {
        stderr += data.toString()
      }
    }
  }

  let exitCode: number

  if (timeout !== null) {
    const timeoutMs = timeout * 1000
    let timedOut = false

    let timerId: ReturnType<typeof setTimeout>
    const timeoutPromise = new Promise<number>((resolve) => {
      timerId = setTimeout(() => {
        timedOut = true
        resolve(124)
      }, timeoutMs)
    })

    // Known limitation: @actions/exec does not expose the child process
    // handle, so we cannot kill the spawned process on timeout. The timeout
    // only races the promise; the child process may continue running in the
    // background until the runner terminates it.
    const execPromise = exec
      .exec(shell, ['-c', command], options)
      // Error details are intentionally discarded here because the timeout
      // path only uses the exit code. Logging would require importing
      // @actions/core solely for this edge case.
      .catch(() => 1)

    exitCode = await Promise.race([execPromise, timeoutPromise])
    clearTimeout(timerId!)

    if (timedOut) {
      return { exitCode: 124, output: (stdout + stderr).trimEnd() }
    }
  } else {
    exitCode = await exec.exec(shell, ['-c', command], options)
  }

  return { exitCode, output: (stdout + stderr).trimEnd() }
}
