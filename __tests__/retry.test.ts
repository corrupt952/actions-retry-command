/**
 * Unit tests for src/retry.ts
 *
 * executeCommand runs real child processes rather than a mocked exec layer,
 * so the timeout behaviour under test is the behaviour that ships.
 */
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { jest } from '@jest/globals'
import {
  executeCommand,
  parseRetryOnExitCode,
  shouldRetry,
  sleep
} from '../src/retry.ts'

describe('shouldRetry', () => {
  it('Returns false for exit code 0', () => {
    expect(shouldRetry(0, null)).toBe(false)
  })

  it('Returns false for exit code 0 even with retry list', () => {
    expect(shouldRetry(0, [0, 1])).toBe(false)
  })

  it('Returns true for non-zero exit code when no filter is set', () => {
    expect(shouldRetry(1, null)).toBe(true)
    expect(shouldRetry(255, null)).toBe(true)
    expect(shouldRetry(124, null)).toBe(true)
  })

  it('Returns true when exit code is in the retry list', () => {
    expect(shouldRetry(2, [2, 3])).toBe(true)
    expect(shouldRetry(3, [2, 3])).toBe(true)
  })

  it('Returns false when exit code is not in the retry list', () => {
    expect(shouldRetry(1, [2, 3])).toBe(false)
    expect(shouldRetry(255, [2, 3])).toBe(false)
  })

  it('Handles single-element retry list', () => {
    expect(shouldRetry(1, [1])).toBe(true)
    expect(shouldRetry(2, [1])).toBe(false)
  })

  it('Handles empty retry list', () => {
    expect(shouldRetry(1, [])).toBe(false)
  })
})

describe('parseRetryOnExitCode', () => {
  it('Returns null for empty string', () => {
    expect(parseRetryOnExitCode('')).toBeNull()
  })

  it('Parses single exit code', () => {
    expect(parseRetryOnExitCode('1')).toEqual([1])
  })

  it('Parses comma-separated exit codes', () => {
    expect(parseRetryOnExitCode('1,2,3')).toEqual([1, 2, 3])
  })

  it('Handles whitespace around values', () => {
    expect(parseRetryOnExitCode(' 1 , 2 , 3 ')).toEqual([1, 2, 3])
  })

  it('Filters out NaN values', () => {
    expect(parseRetryOnExitCode('1,abc,3')).toEqual([1, 3])
  })

  it('Handles all NaN values', () => {
    expect(parseRetryOnExitCode('abc,def')).toEqual([])
  })

  it('Parses exit code 0', () => {
    expect(parseRetryOnExitCode('0,1')).toEqual([0, 1])
  })

  it('Parses high exit codes', () => {
    expect(parseRetryOnExitCode('124,255')).toEqual([124, 255])
  })
})

describe('sleep', () => {
  it('Resolves after the specified time', async () => {
    const start = Date.now()
    await sleep(100)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(90)
  })

  it('Resolves immediately for 0ms', async () => {
    const start = Date.now()
    await sleep(0)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(50)
  })
})

describe('executeCommand', () => {
  beforeEach(() => {
    // The command's own output is streamed to the runner log; keep it out of
    // the test report.
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('Runs the command through the given shell', async () => {
    const result = await executeCommand('echo hello', 'bash', null, '')

    expect(result.exitCode).toBe(0)
    expect(result.output).toBe('hello')
  })

  it('Runs the command through sh', async () => {
    const result = await executeCommand('echo test', 'sh', null, '')

    expect(result.exitCode).toBe(0)
    expect(result.output).toBe('test')
  })

  it('Returns a non-zero exit code', async () => {
    const result = await executeCommand('exit 42', 'bash', null, '')

    expect(result.exitCode).toBe(42)
  })

  it('Preserves exit code 255', async () => {
    const result = await executeCommand('exit 255', 'bash', null, '')

    expect(result.exitCode).toBe(255)
  })

  it('Captures stderr', async () => {
    const result = await executeCommand('echo oops >&2', 'bash', null, '')

    expect(result.output).toBe('oops')
  })

  it('Captures stdout before stderr', async () => {
    const result = await executeCommand(
      'echo out; echo err >&2',
      'bash',
      null,
      ''
    )

    expect(result.output).toBe('out\nerr')
  })

  it('Trims trailing whitespace from output', async () => {
    const result = await executeCommand(
      "printf 'hello\\n\\n\\n'",
      'bash',
      null,
      ''
    )

    expect(result.output).toBe('hello')
  })

  it('Returns empty output when the command produces none', async () => {
    const result = await executeCommand('true', 'bash', null, '')

    expect(result.exitCode).toBe(0)
    expect(result.output).toBe('')
  })

  it('Handles multiline output', async () => {
    const result = await executeCommand(
      "printf 'line1\\nline2\\nline3\\n'",
      'bash',
      null,
      ''
    )

    expect(result.output).toBe('line1\nline2\nline3')
  })

  it('Handles output with special characters', async () => {
    const result = await executeCommand(
      'echo \'{"key": "value"}\'',
      'bash',
      null,
      ''
    )

    expect(result.output).toBe('{"key": "value"}')
  })

  it('Runs in workingDirectory when one is given', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retry-cwd-'))

    const result = await executeCommand('pwd -P', 'bash', null, dir)

    const { realpathSync } = await import('node:fs')
    expect(result.output).toBe(realpathSync(dir))
  })

  it('Runs in the current directory when workingDirectory is empty', async () => {
    const result = await executeCommand('pwd -P', 'bash', null, '')

    const { realpathSync } = await import('node:fs')
    expect(result.output).toBe(realpathSync(process.cwd()))
  })

  it('Rejects when the shell cannot be spawned', async () => {
    await expect(
      executeCommand('echo hi', 'no-such-shell-xyz', null, '')
    ).rejects.toThrow()
  })

  describe('timeout', () => {
    it('Completes normally when the command finishes in time', async () => {
      const result = await executeCommand('echo fast', 'bash', 5, '')

      expect(result.exitCode).toBe(0)
      expect(result.output).toBe('fast')
    })

    it('Returns exit code 124 when the command times out', async () => {
      const result = await executeCommand('sleep 5', 'bash', 1, '')

      expect(result.exitCode).toBe(124)
    })

    it('Captures partial output on timeout', async () => {
      const result = await executeCommand(
        'echo partial; sleep 5',
        'bash',
        1,
        ''
      )

      expect(result.exitCode).toBe(124)
      expect(result.output).toBe('partial')
    })

    it('Kills processes the command spawned', async () => {
      const marker = join(mkdtempSync(join(tmpdir(), 'retry-kill-')), 'marker')

      const result = await executeCommand(
        `(sleep 2; touch ${marker}) & sleep 10`,
        'bash',
        1,
        ''
      )
      expect(result.exitCode).toBe(124)

      // Outlive the moment the orphan would have created the marker.
      await sleep(2500)
      expect(existsSync(marker)).toBe(false)
    }, 15000)
  })
})
