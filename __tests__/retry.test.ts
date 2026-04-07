/**
 * Unit tests for src/retry.ts
 */
import { jest } from '@jest/globals'
import * as execFixture from '../__fixtures__/exec.js'
import { createSimulateExec } from '../__fixtures__/helpers.js'

jest.unstable_mockModule('@actions/exec', () => execFixture)

const { shouldRetry, parseRetryOnExitCode, sleep, executeCommand } =
  await import('../src/retry.js')

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
  afterEach(() => {
    jest.resetAllMocks()
  })

  const simulateExec = createSimulateExec(execFixture.exec)

  it('Executes command with the specified shell', async () => {
    simulateExec(0, 'hello\n')

    const result = await executeCommand('echo hello', 'bash', null, '')

    expect(execFixture.exec).toHaveBeenCalledWith(
      'bash',
      ['-c', 'echo hello'],
      expect.objectContaining({ ignoreReturnCode: true })
    )
    expect(result.exitCode).toBe(0)
    expect(result.output).toBe('hello')
  })

  it('Executes command with sh shell', async () => {
    simulateExec(0, 'test\n')

    await executeCommand('echo test', 'sh', null, '')

    expect(execFixture.exec).toHaveBeenCalledWith(
      'sh',
      ['-c', 'echo test'],
      expect.any(Object)
    )
  })

  it('Returns non-zero exit code', async () => {
    simulateExec(42)

    const result = await executeCommand('exit 42', 'bash', null, '')

    expect(result.exitCode).toBe(42)
  })

  it('Captures stdout', async () => {
    simulateExec(0, 'output line\n')

    const result = await executeCommand('echo output', 'bash', null, '')

    expect(result.output).toBe('output line')
  })

  it('Captures stderr', async () => {
    simulateExec(0, '', 'error line\n')

    const result = await executeCommand('cmd', 'bash', null, '')

    expect(result.output).toBe('error line')
  })

  it('Combines stdout and stderr', async () => {
    simulateExec(0, 'out\n', 'err\n')

    const result = await executeCommand('cmd', 'bash', null, '')

    expect(result.output).toBe('out\nerr')
  })

  it('Trims trailing whitespace from output', async () => {
    simulateExec(0, 'hello\n\n\n')

    const result = await executeCommand('cmd', 'bash', null, '')

    expect(result.output).toBe('hello')
  })

  it('Returns empty output when command produces none', async () => {
    simulateExec(0)

    const result = await executeCommand('true', 'bash', null, '')

    expect(result.output).toBe('')
  })

  it('Completes before timeout', async () => {
    jest.useFakeTimers()
    simulateExec(0, 'fast\n')

    const promise = executeCommand('echo fast', 'bash', 5, '')
    await jest.advanceTimersByTimeAsync(0)
    const result = await promise

    jest.useRealTimers()

    expect(result.exitCode).toBe(0)
    expect(result.output).toBe('fast')
  })

  it('Returns exit code 124 when command times out', async () => {
    jest.useFakeTimers()

    execFixture.exec.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60000))
      return 0
    })

    const promise = executeCommand('sleep 60', 'bash', 1, '')
    await jest.advanceTimersByTimeAsync(1000)
    const result = await promise

    jest.useRealTimers()

    expect(result.exitCode).toBe(124)
  })

  it('Captures partial output on timeout', async () => {
    jest.useFakeTimers()

    execFixture.exec.mockImplementationOnce(
      async (
        _cmd: string,
        _args?: string[],
        options?: {
          listeners?: {
            stdout?: (data: Buffer) => void
          }
        }
      ) => {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from('partial\n'))
        }
        await new Promise((resolve) => setTimeout(resolve, 60000))
        return 0
      }
    )

    const promise = executeCommand('cmd', 'bash', 1, '')
    await jest.advanceTimersByTimeAsync(1000)
    const result = await promise

    jest.useRealTimers()

    expect(result.exitCode).toBe(124)
    expect(result.output).toBe('partial')
  })

  it('Handles exec rejection without timeout', async () => {
    execFixture.exec.mockRejectedValueOnce(new Error('exec failed'))

    await expect(executeCommand('bad-cmd', 'bash', null, '')).rejects.toThrow(
      'exec failed'
    )
  })

  it('Handles exec rejection with timeout', async () => {
    jest.useFakeTimers()

    execFixture.exec.mockRejectedValueOnce(new Error('exec failed'))

    const promise = executeCommand('bad-cmd', 'bash', 5, '')
    await jest.advanceTimersByTimeAsync(0)
    const result = await promise

    jest.useRealTimers()

    expect(result.exitCode).toBe(1)
  })

  it('Handles multiline command output', async () => {
    simulateExec(0, 'line1\nline2\nline3\n')

    const result = await executeCommand('cmd', 'bash', null, '')

    expect(result.output).toBe('line1\nline2\nline3')
  })

  it('Handles output with special characters', async () => {
    simulateExec(0, '{"key": "value"}\n')

    const result = await executeCommand('cmd', 'bash', null, '')

    expect(result.output).toBe('{"key": "value"}')
  })

  it('Handles chunked stdout delivery', async () => {
    execFixture.exec.mockImplementationOnce(
      async (
        _cmd: string,
        _args?: string[],
        options?: {
          listeners?: {
            stdout?: (data: Buffer) => void
          }
        }
      ) => {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from('chunk1'))
          options.listeners.stdout(Buffer.from('chunk2'))
          options.listeners.stdout(Buffer.from('chunk3\n'))
        }
        return 0
      }
    )

    const result = await executeCommand('cmd', 'bash', null, '')

    expect(result.output).toBe('chunk1chunk2chunk3')
  })

  it('Sets cwd in exec options when workingDirectory is provided', async () => {
    simulateExec(0, 'output\n')

    await executeCommand('pwd', 'bash', null, '/tmp')

    expect(execFixture.exec).toHaveBeenCalledWith(
      'bash',
      ['-c', 'pwd'],
      expect.objectContaining({ cwd: '/tmp' })
    )
  })

  it('Does not set cwd in exec options when workingDirectory is empty', async () => {
    simulateExec(0, 'output\n')

    await executeCommand('pwd', 'bash', null, '')

    expect(execFixture.exec).toHaveBeenCalledWith(
      'bash',
      ['-c', 'pwd'],
      expect.not.objectContaining({ cwd: expect.anything() })
    )
  })
})
