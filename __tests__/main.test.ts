import * as core from '@actions/core'
import * as exec from '@actions/exec'
import { retryCommand } from '../src/main'

// Mock the GitHub Actions modules
jest.mock('@actions/core')
jest.mock('@actions/exec')

const mockedCore = core as jest.Mocked<typeof core>
const mockedExec = exec as jest.Mocked<typeof exec>

describe('retryCommand', () => {
  let infoLogs: string[] = []
  let errorLogs: string[] = []
  let outputs: Record<string, string> = {}

  beforeEach(() => {
    // Clear mocks
    jest.clearAllMocks()
    infoLogs = []
    errorLogs = []
    outputs = {}

    // Mock core.info to capture logs
    mockedCore.info.mockImplementation((message: string) => {
      infoLogs.push(message)
    })

    // Mock core.error
    mockedCore.error.mockImplementation((message: string | Error) => {
      errorLogs.push(typeof message === 'string' ? message : message.message)
    })

    // Mock core.setOutput to capture outputs
    mockedCore.setOutput.mockImplementation((name: string, value: string | number) => {
      outputs[name] = String(value)
    })

    // Mock core.setFailed
    mockedCore.setFailed.mockImplementation((message: string | Error) => {
      errorLogs.push(typeof message === 'string' ? message : message.message)
    })
  })

  describe('Test 1: Output result on success', () => {
    it('should capture command output when command succeeds', async () => {
      // Mock successful command execution
      mockedExec.exec.mockImplementation(
        async (_commandLine, _args, options): Promise<number> => {
          if (options?.listeners?.stdout) {
            options.listeners.stdout(Buffer.from('hello\n'))
          }
          return 0
        }
      )

      await retryCommand('echo "hello"', process.cwd(), 5, 1)

      expect(outputs.result).toBe('hello')
      expect(outputs.exit_code).toBe('0')
    })
  })

  describe('Test 2: Outcome is success', () => {
    it('should complete successfully when command exits with 0', async () => {
      mockedExec.exec.mockResolvedValue(0)

      await expect(retryCommand('echo "hello"', process.cwd(), 5, 1)).resolves.not.toThrow()
    })
  })

  describe('Test 3: Output result on error (after all retries)', () => {
    it('should return output from last attempt when all attempts fail', async () => {
      let attemptCount = 0

      mockedExec.exec.mockImplementation(
        async (_commandLine, _args, options): Promise<number> => {
          attemptCount++
          if (options?.listeners?.stdout) {
            options.listeners.stdout(Buffer.from(`count ${attemptCount}\n`))
          }
          return 1 // Fail
        }
      )

      await expect(retryCommand('echo "count $i" && exit 1', process.cwd(), 3, 1)).rejects.toThrow()

      expect(attemptCount).toBe(3)
      expect(outputs.result).toBe('count 3')
    })
  })

  describe('Test 4: Outcome is failure on error', () => {
    it('should throw error when all attempts fail', async () => {
      mockedExec.exec.mockResolvedValue(1)

      await expect(retryCommand('exit 1', process.cwd(), 3, 1)).rejects.toThrow(
        'Command failed after 3 attempts with exit code: 1'
      )
    })
  })

  describe('Test 5: Exit code captured on success', () => {
    it('should capture exit code 0 on success', async () => {
      mockedExec.exec.mockResolvedValue(0)

      await retryCommand('exit 0', process.cwd(), 5, 1)

      expect(outputs.exit_code).toBe('0')
    })
  })

  describe('Test 6: Exit code captured on error', () => {
    it('should capture non-zero exit code on failure', async () => {
      mockedExec.exec.mockResolvedValue(255)

      await expect(retryCommand('exit 255', process.cwd(), 5, 1)).rejects.toThrow()

      expect(outputs.exit_code).toBe('255')
    })
  })

  describe('Test 7: Multiline output preservation', () => {
    it('should preserve multiline output with newlines', async () => {
      mockedExec.exec.mockImplementation(
        async (_commandLine, _args, options): Promise<number> => {
          if (options?.listeners?.stdout) {
            options.listeners.stdout(Buffer.from('hello\nworld\ngithub\n'))
          }
          return 0
        }
      )

      await retryCommand('echo -e "hello\\nworld\\ngithub"', process.cwd(), 5, 1)

      expect(outputs.result).toBe('hello\nworld\ngithub')
    })
  })

  describe('Test 8: Retry behavior', () => {
    it('should retry the specified number of times on failure', async () => {
      let attemptCount = 0

      mockedExec.exec.mockImplementation(async () => {
        attemptCount++
        return 1 // Always fail
      })

      await expect(retryCommand('exit 1', process.cwd(), 3, 1)).rejects.toThrow()

      expect(attemptCount).toBe(3)
    })

    it('should log attempt numbers correctly', async () => {
      mockedExec.exec.mockResolvedValue(1)

      await expect(retryCommand('exit 1', process.cwd(), 3, 1)).rejects.toThrow()

      expect(infoLogs).toContain('Attempts: 1')
      expect(infoLogs).toContain('Attempts: 2')
      expect(infoLogs).toContain('Attempts: 3')
    })

    it('should stop retrying once command succeeds', async () => {
      let attemptCount = 0

      mockedExec.exec.mockImplementation(async () => {
        attemptCount++
        // Succeed on 3rd attempt
        return attemptCount === 3 ? 0 : 1
      })

      await retryCommand('test', process.cwd(), 5, 1)

      expect(attemptCount).toBe(3) // Should stop at 3, not continue to 5
    })
  })

  describe('Test 9: Command succeeds on retry', () => {
    it('should succeed when command passes on later attempt', async () => {
      let attemptCount = 0

      mockedExec.exec.mockImplementation(
        async (_commandLine, _args, options): Promise<number> => {
          attemptCount++
          const exitCode = attemptCount < 3 ? 1 : 0

          if (options?.listeners?.stdout) {
            const message = exitCode === 0 ? 'success' : 'failed'
            options.listeners.stdout(Buffer.from(`${message}\n`))
          }

          return exitCode
        }
      )

      await retryCommand('test', process.cwd(), 5, 1)

      expect(attemptCount).toBe(3)
      expect(outputs.result).toBe('success')
      expect(outputs.exit_code).toBe('0')
    })
  })

  describe('Test 10: Output with special characters', () => {
    it('should handle tabs and special characters correctly', async () => {
      mockedExec.exec.mockImplementation(
        async (_commandLine, _args, options): Promise<number> => {
          if (options?.listeners?.stdout) {
            options.listeners.stdout(Buffer.from('line1\nline2\ttab\nline3\n'))
          }
          return 0
        }
      )

      await retryCommand('printf "line1\\nline2\\ttab\\nline3"', process.cwd(), 5, 1)

      expect(outputs.result).toBe('line1\nline2\ttab\nline3')
    })

    it('should handle output containing "EOS" delimiter', async () => {
      mockedExec.exec.mockImplementation(
        async (_commandLine, _args, options): Promise<number> => {
          if (options?.listeners?.stdout) {
            options.listeners.stdout(Buffer.from('line1\nEOS\nline3\n'))
          }
          return 0
        }
      )

      await retryCommand('printf "line1\\nEOS\\nline3"', process.cwd(), 5, 1)

      expect(outputs.result).toBe('line1\nEOS\nline3')
    })
  })

  describe('Test 11: Empty output', () => {
    it('should handle commands with no output', async () => {
      mockedExec.exec.mockResolvedValue(0)

      await retryCommand('exit 0', process.cwd(), 5, 1)

      expect(outputs.result).toBe('')
      expect(outputs.exit_code).toBe('0')
    })
  })

  describe('Test 12: stderr and stdout merging', () => {
    it('should merge stderr and stdout in output', async () => {
      mockedExec.exec.mockImplementation(
        async (_commandLine, _args, options): Promise<number> => {
          if (options?.listeners?.stdout) {
            options.listeners.stdout(Buffer.from('stdout message\n'))
          }
          if (options?.listeners?.stderr) {
            options.listeners.stderr(Buffer.from('stderr message\n'))
          }
          return 0
        }
      )

      await retryCommand('test', process.cwd(), 5, 1)

      // Both stdout and stderr should be in result
      expect(outputs.result).toContain('stdout message')
      expect(outputs.result).toContain('stderr message')
    })
  })

  describe('Test 13: Timing verification', () => {
    it('should respect retry intervals', async () => {
      jest.useFakeTimers()
      let attemptCount = 0

      mockedExec.exec.mockImplementation(async () => {
        attemptCount++
        return 1 // Always fail
      })

      const promise = retryCommand('exit 1', process.cwd(), 3, 2).catch(() => {
        // Catch to prevent unhandled rejection
      })

      // Let first attempt complete
      await jest.advanceTimersByTimeAsync(0)
      expect(attemptCount).toBe(1)

      // Advance 2 seconds for sleep, then let second attempt run
      await jest.advanceTimersByTimeAsync(2000)
      expect(attemptCount).toBe(2)

      // Advance 2 seconds for sleep, then let third attempt run
      await jest.advanceTimersByTimeAsync(2000)
      expect(attemptCount).toBe(3)

      // Wait for promise to settle
      await promise

      jest.useRealTimers()
    })
  })

  describe('Test 14: Logging behavior', () => {
    it('should log exit code and result for each attempt', async () => {
      jest.useFakeTimers()
      let attemptCount = 0

      mockedExec.exec.mockImplementation(
        async (_commandLine, _args, options): Promise<number> => {
          attemptCount++
          if (options?.listeners?.stdout) {
            options.listeners.stdout(Buffer.from(`attempt ${attemptCount}\n`))
          }
          return 1
        }
      )

      const promise = retryCommand('test', process.cwd(), 2, 1).catch(() => {
        // Catch to prevent unhandled rejection
      })
      await jest.runAllTimersAsync()
      await promise

      // Check that exit codes were logged
      expect(infoLogs.some(log => log.includes('Exit code: 1'))).toBe(true)

      // Check that results were logged
      expect(infoLogs.some(log => log.includes('Result: attempt'))).toBe(true)

      jest.useRealTimers()
    })

    it('should log sleep duration between retries', async () => {
      jest.useFakeTimers()

      mockedExec.exec.mockResolvedValue(1)

      const promise = retryCommand('exit 1', process.cwd(), 2, 5).catch(() => {
        // Catch to prevent unhandled rejection
      })
      await jest.runAllTimersAsync()
      await promise

      expect(infoLogs.some(log => log.includes('sleep: 5'))).toBe(true)

      jest.useRealTimers()
    })
  })

  describe('Test 15: Input parameter edge cases', () => {
    it('should handle max_attempts of 1 (no retries)', async () => {
      let attemptCount = 0

      mockedExec.exec.mockImplementation(async () => {
        attemptCount++
        return 1
      })

      await expect(retryCommand('exit 1', process.cwd(), 1, 1)).rejects.toThrow()

      expect(attemptCount).toBe(1)
    })

    it('should handle large retry intervals', async () => {
      jest.useFakeTimers()

      mockedExec.exec.mockResolvedValue(1)

      const promise = retryCommand('exit 1', process.cwd(), 2, 100).catch(() => {
        // Catch to prevent unhandled rejection
      })
      await jest.runAllTimersAsync()
      await promise

      expect(infoLogs.some(log => log.includes('sleep: 100'))).toBe(true)

      jest.useRealTimers()
    })
  })

  describe('Test 16: Working directory', () => {
    it('should execute command in specified working directory', async () => {
      const customDir = '/custom/path'
      let actualCwd: string | undefined

      mockedExec.exec.mockImplementation(
        async (_commandLine, _args, options): Promise<number> => {
          actualCwd = options?.cwd
          return 0
        }
      )

      await retryCommand('pwd', customDir, 5, 1)

      expect(actualCwd).toBe(customDir)
    })
  })

  describe('Test 17: Final attempt behavior', () => {
    it('should set outputs even when final attempt fails', async () => {
      mockedExec.exec.mockImplementation(
        async (_commandLine, _args, options): Promise<number> => {
          if (options?.listeners?.stdout) {
            options.listeners.stdout(Buffer.from('final output\n'))
          }
          return 1
        }
      )

      await expect(retryCommand('exit 1', process.cwd(), 1, 1)).rejects.toThrow()

      expect(outputs.result).toBe('final output')
      expect(outputs.exit_code).toBe('1')
    })
  })
})
