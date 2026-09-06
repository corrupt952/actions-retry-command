/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * Commands are executed for real; only the runner-facing core module is
 * stubbed so inputs can be set and outputs observed.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.ts'

jest.unstable_mockModule('../src/core.ts', () => core)

const { run } = await import('../src/main.ts')

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'main-test-'))
}

interface Scripted {
  command: string
  attempts: () => number
}

/**
 * A command that records how many times it ran and fails the first `failures`
 * invocations. It prints `failN` while failing and `okN` once it succeeds.
 */
function scripted(failures: number, exitCode = 1): Scripted {
  const counter = join(workspace(), 'attempts')
  const command = [
    `n=$(cat ${counter} 2>/dev/null || echo 0)`,
    'n=$((n + 1))',
    `printf %s "$n" > ${counter}`,
    `if [ "$n" -le ${failures} ]; then echo "fail$n"; exit ${exitCode}; fi`,
    'echo "ok$n"'
  ].join('; ')

  return {
    command,
    attempts: () =>
      existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0
  }
}

function setupInputs(overrides: Record<string, string> = {}): void {
  const defaults: Record<string, string> = {
    command: 'echo hello',
    max_attempts: '3',
    retry_interval: '0',
    timeout: '',
    shell: 'bash',
    retry_on_exit_code: '',
    working_directory: ''
  }
  const inputs = { ...defaults, ...overrides }
  core.getInput.mockImplementation((name: string) => inputs[name] ?? '')
}

function outputs(): Record<string, string> {
  return Object.fromEntries(
    core.setOutput.mock.calls.map(([name, value]) => [name, value])
  )
}

beforeEach(() => {
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.resetAllMocks()
})

describe('main.ts', () => {
  describe('successful execution', () => {
    it('Succeeds on first attempt', async () => {
      const job = scripted(0)
      setupInputs({ command: job.command })

      await run()

      expect(job.attempts()).toBe(1)
      expect(outputs()).toEqual({ exit_code: '0', result: 'ok1' })
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('Retries and succeeds on second attempt', async () => {
      const job = scripted(1)
      setupInputs({ command: job.command, max_attempts: '3' })

      await run()

      expect(job.attempts()).toBe(2)
      expect(outputs()).toEqual({ exit_code: '0', result: 'ok2' })
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('Retries and succeeds on the last attempt', async () => {
      const job = scripted(2)
      setupInputs({ command: job.command, max_attempts: '3' })

      await run()

      expect(job.attempts()).toBe(3)
      expect(outputs()).toEqual({ exit_code: '0', result: 'ok3' })
      expect(core.setFailed).not.toHaveBeenCalled()
    })
  })

  describe('failure handling', () => {
    it('Fails after exhausting all attempts', async () => {
      const job = scripted(5)
      setupInputs({ command: job.command, max_attempts: '3' })

      await run()

      expect(job.attempts()).toBe(3)
      expect(outputs().exit_code).toBe('1')
      expect(core.setFailed).toHaveBeenCalledWith(
        'Command failed with exit code 1'
      )
    })

    it('Preserves a specific exit code', async () => {
      setupInputs({ command: 'exit 42', max_attempts: '1' })

      await run()

      expect(outputs().exit_code).toBe('42')
      expect(core.setFailed).toHaveBeenCalledWith(
        'Command failed with exit code 42'
      )
    })

    it('Preserves exit code 255', async () => {
      setupInputs({ command: 'exit 255', max_attempts: '1' })

      await run()

      expect(outputs().exit_code).toBe('255')
    })

    it('Runs once when max_attempts is 1', async () => {
      const job = scripted(5)
      setupInputs({ command: job.command, max_attempts: '1' })

      await run()

      expect(job.attempts()).toBe(1)
      expect(core.setFailed).toHaveBeenCalled()
    })
  })

  describe('output handling', () => {
    it('Captures multiline output', async () => {
      setupInputs({ command: "printf 'line1\\nline2\\nline3\\n'" })

      await run()

      expect(outputs().result).toBe('line1\nline2\nline3')
    })

    it('Captures both stdout and stderr', async () => {
      setupInputs({ command: 'echo out; echo err >&2' })

      await run()

      expect(outputs().result).toBe('out\nerr')
    })

    it('Handles empty output', async () => {
      setupInputs({ command: 'true' })

      await run()

      expect(outputs()).toEqual({ exit_code: '0', result: '' })
    })

    it('Only reports the last attempt result', async () => {
      const job = scripted(1)
      setupInputs({ command: job.command, max_attempts: '3' })

      await run()

      expect(outputs().result).toBe('ok2')
    })

    it('Reports the last attempt result on failure', async () => {
      const job = scripted(5)
      setupInputs({ command: job.command, max_attempts: '2' })

      await run()

      expect(outputs().result).toBe('fail2')
    })
  })

  describe('retry_on_exit_code', () => {
    it('Does not retry when the exit code is not in the retry list', async () => {
      const job = scripted(5, 1)
      setupInputs({
        command: job.command,
        max_attempts: '3',
        retry_on_exit_code: '2,3'
      })

      await run()

      expect(job.attempts()).toBe(1)
      expect(outputs().exit_code).toBe('1')
      expect(core.info).toHaveBeenCalledWith(
        'Exit code 1 is not in retry list, stopping retries'
      )
    })

    it('Retries when the exit code matches the retry list', async () => {
      const job = scripted(1, 2)
      setupInputs({
        command: job.command,
        max_attempts: '3',
        retry_on_exit_code: '2,3'
      })

      await run()

      expect(job.attempts()).toBe(2)
      expect(outputs().exit_code).toBe('0')
    })

    it('Does not retry when every exit code in the list is invalid', async () => {
      const job = scripted(5)
      setupInputs({
        command: job.command,
        max_attempts: '3',
        retry_on_exit_code: 'abc,def'
      })

      await run()

      expect(job.attempts()).toBe(1)
      expect(core.info).toHaveBeenCalledWith(
        'Exit code 1 is not in retry list, stopping retries'
      )
    })

    it('Exhausts retries when the exit code always matches', async () => {
      const job = scripted(5, 3)
      setupInputs({
        command: job.command,
        max_attempts: '2',
        retry_on_exit_code: '3'
      })

      await run()

      expect(job.attempts()).toBe(2)
      expect(outputs().exit_code).toBe('3')
    })
  })

  describe('shell selection', () => {
    // $0 is the shell as it was invoked, so this reports the binary that
    // actually ran rather than whatever it is aliased to.
    const reportShell = 'echo "$0"'

    it('Uses bash by default', async () => {
      setupInputs({ command: reportShell, shell: '' })

      await run()

      expect(outputs().result).toBe('bash')
    })

    it('Uses the specified shell', async () => {
      setupInputs({ command: reportShell, shell: 'sh' })

      await run()

      expect(outputs().result).toBe('sh')
    })
  })

  describe('timeout', () => {
    it('Completes normally when the command finishes in time', async () => {
      setupInputs({ command: 'echo done', timeout: '30' })

      await run()

      expect(outputs()).toEqual({ exit_code: '0', result: 'done' })
    })

    it('Reports exit code 124 when the command times out', async () => {
      setupInputs({
        command: 'sleep 5',
        timeout: '1',
        max_attempts: '1'
      })

      await run()

      expect(outputs().exit_code).toBe('124')
      expect(core.setFailed).toHaveBeenCalledWith(
        'Command failed with exit code 124'
      )
    }, 15000)

    it('Treats an empty timeout as no timeout', async () => {
      setupInputs({ command: 'echo ok', timeout: '' })

      await run()

      expect(outputs().exit_code).toBe('0')
    })
  })

  describe('default values', () => {
    it('Uses a default max_attempts of 5', async () => {
      const job = scripted(9)
      setupInputs({ command: job.command, max_attempts: '' })

      await run()

      expect(job.attempts()).toBe(5)
    })

    it('Uses a default retry_interval of 5 seconds', async () => {
      const job = scripted(1)
      setupInputs({
        command: job.command,
        max_attempts: '2',
        retry_interval: ''
      })

      // The retry genuinely sleeps, so this test pays the five seconds.
      await run()

      expect(core.info).toHaveBeenCalledWith('Retrying in 5 seconds...')
    }, 20000)
  })

  describe('group annotations', () => {
    it('Wraps every attempt in a group', async () => {
      const job = scripted(1)
      setupInputs({ command: job.command, max_attempts: '2' })

      await run()

      expect(core.startGroup).toHaveBeenCalledWith('Attempt 1 of 2')
      expect(core.startGroup).toHaveBeenCalledWith('Attempt 2 of 2')
      expect(core.endGroup).toHaveBeenCalledTimes(2)
    })

    it('Opens a single group when the first attempt succeeds', async () => {
      setupInputs({ command: 'true', max_attempts: '5' })

      await run()

      expect(core.startGroup).toHaveBeenCalledTimes(1)
      expect(core.startGroup).toHaveBeenCalledWith('Attempt 1 of 5')
      expect(core.endGroup).toHaveBeenCalledTimes(1)
    })
  })

  describe('retry interval', () => {
    it('Logs the interval before sleeping', async () => {
      const job = scripted(1)
      setupInputs({
        command: job.command,
        max_attempts: '2',
        retry_interval: '0'
      })

      await run()

      expect(core.info).toHaveBeenCalledWith('Retrying in 0 seconds...')
    })

    it('Evaluates an expression against the attempt number', async () => {
      const job = scripted(1)
      setupInputs({
        command: job.command,
        max_attempts: '2',
        retry_interval: 'attempt - 1'
      })

      await run()

      expect(core.info).toHaveBeenCalledWith('Retrying in 0 seconds...')
    })

    it('Fails when the interval evaluates to a negative number', async () => {
      const job = scripted(5)
      setupInputs({
        command: job.command,
        max_attempts: '2',
        retry_interval: '-5'
      })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        'retry_interval evaluated to a negative number'
      )
    })
  })

  describe('input validation', () => {
    function neverRuns(): { command: string; ran: () => boolean } {
      const marker = join(workspace(), 'ran')
      return {
        command: `touch ${marker}`,
        ran: () => existsSync(marker)
      }
    }

    it('Fails when max_attempts is not a number', async () => {
      const job = neverRuns()
      setupInputs({ command: job.command, max_attempts: 'abc' })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        'max_attempts must be a positive integer'
      )
      expect(job.ran()).toBe(false)
    })

    it('Fails when max_attempts is zero', async () => {
      const job = neverRuns()
      setupInputs({ command: job.command, max_attempts: '0' })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        'max_attempts must be a positive integer'
      )
      expect(job.ran()).toBe(false)
    })

    it('Fails when max_attempts is negative', async () => {
      const job = neverRuns()
      setupInputs({ command: job.command, max_attempts: '-1' })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        'max_attempts must be a positive integer'
      )
      expect(job.ran()).toBe(false)
    })

    it('Fails when timeout is not a number', async () => {
      const job = neverRuns()
      setupInputs({ command: job.command, timeout: 'abc' })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        'timeout must be a non-negative integer'
      )
      expect(job.ran()).toBe(false)
    })

    it('Fails when timeout is negative', async () => {
      const job = neverRuns()
      setupInputs({ command: job.command, timeout: '-1' })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        'timeout must be a non-negative integer'
      )
      expect(job.ran()).toBe(false)
    })
  })

  describe('error handling', () => {
    it('Reports a thrown Error through setFailed', async () => {
      core.getInput.mockImplementation(() => {
        throw new Error('input error')
      })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith('input error')
    })

    it('Reports a non-Error throw through setFailed', async () => {
      core.getInput.mockImplementation(() => {
        throw 'string error'
      })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith('string error')
    })

    it('Reports a shell that cannot be spawned', async () => {
      setupInputs({ command: 'echo hi', shell: 'no-such-shell-xyz' })

      await run()

      expect(core.setFailed).toHaveBeenCalled()
    })
  })

  describe('working_directory', () => {
    it('Runs the command in the given directory', async () => {
      const dir = workspace()
      setupInputs({ command: 'pwd -P', working_directory: dir })

      await run()

      expect(outputs().result).toBe(realpathSync(dir))
    })

    it('Runs in the current directory by default', async () => {
      setupInputs({ command: 'pwd -P' })

      await run()

      expect(outputs().result).toBe(realpathSync(process.cwd()))
    })
  })
})
