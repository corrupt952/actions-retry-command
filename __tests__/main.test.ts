/**
 * Unit tests for the action's main functionality, src/main.ts
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import * as execFixture from '../__fixtures__/exec.js'
import { createSimulateExec } from '../__fixtures__/helpers.js'

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/exec', () => execFixture)

const { run } = await import('../src/main.js')

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

const simulateExec = createSimulateExec(execFixture.exec)

describe('main.ts', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('successful execution', () => {
    it('Succeeds on first attempt', async () => {
      setupInputs({ command: 'echo hello' })
      simulateExec(0, 'hello\n')

      await run()

      expect(execFixture.exec).toHaveBeenCalledTimes(1)
      expect(core.setOutput).toHaveBeenCalledWith('exit_code', '0')
      expect(core.setOutput).toHaveBeenCalledWith('result', 'hello')
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('Retries and succeeds on second attempt', async () => {
      setupInputs({ command: 'test-cmd', max_attempts: '3' })
      simulateExec(1, 'fail\n')
      simulateExec(0, 'success\n')

      await run()

      expect(execFixture.exec).toHaveBeenCalledTimes(2)
      expect(core.setOutput).toHaveBeenCalledWith('exit_code', '0')
      expect(core.setOutput).toHaveBeenCalledWith('result', 'success')
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('Retries and succeeds on last attempt', async () => {
      setupInputs({ command: 'cmd', max_attempts: '3' })
      simulateExec(1, 'fail1\n')
      simulateExec(1, 'fail2\n')
      simulateExec(0, 'finally\n')

      await run()

      expect(execFixture.exec).toHaveBeenCalledTimes(3)
      expect(core.setOutput).toHaveBeenCalledWith('exit_code', '0')
      expect(core.setOutput).toHaveBeenCalledWith('result', 'finally')
      expect(core.setFailed).not.toHaveBeenCalled()
    })
  })

  describe('failure handling', () => {
    it('Fails after exhausting all attempts', async () => {
      setupInputs({ command: 'fail-cmd', max_attempts: '3' })
      simulateExec(1, 'fail1\n')
      simulateExec(1, 'fail2\n')
      simulateExec(1, 'fail3\n')

      await run()

      expect(execFixture.exec).toHaveBeenCalledTimes(3)
      expect(core.setOutput).toHaveBeenCalledWith('exit_code', '1')
      expect(core.setFailed).toHaveBeenCalledWith(
        'Command failed with exit code 1'
      )
    })

    it('Preserves specific exit code', async () => {
      setupInputs({ command: 'exit 42', max_attempts: '1' })
      simulateExec(42)

      await run()

      expect(core.setOutput).toHaveBeenCalledWith('exit_code', '42')
      expect(core.setFailed).toHaveBeenCalledWith(
        'Command failed with exit code 42'
      )
    })

    it('Preserves exit code 255', async () => {
      setupInputs({ command: 'exit 255', max_attempts: '1' })
      simulateExec(255)

      await run()

      expect(core.setOutput).toHaveBeenCalledWith('exit_code', '255')
    })

    it('Fails with single attempt', async () => {
      setupInputs({ command: 'fail', max_attempts: '1' })
      simulateExec(1, 'error\n')

      await run()

      expect(execFixture.exec).toHaveBeenCalledTimes(1)
      expect(core.setFailed).toHaveBeenCalled()
    })
  })

  describe('output handling', () => {
    it('Captures multiline output', async () => {
      setupInputs({ command: 'multi' })
      simulateExec(0, 'line1\nline2\nline3\n')

      await run()

      expect(core.setOutput).toHaveBeenCalledWith(
        'result',
        'line1\nline2\nline3'
      )
    })

    it('Captures both stdout and stderr', async () => {
      setupInputs({ command: 'mixed' })
      simulateExec(0, 'out\n', 'err\n')

      await run()

      expect(core.setOutput).toHaveBeenCalledWith('result', 'out\nerr')
    })

    it('Handles empty output', async () => {
      setupInputs({ command: 'true' })
      simulateExec(0)

      await run()

      expect(core.setOutput).toHaveBeenCalledWith('exit_code', '0')
      expect(core.setOutput).toHaveBeenCalledWith('result', '')
    })

    it('Only outputs the last attempt result', async () => {
      setupInputs({ command: 'cmd', max_attempts: '3' })
      simulateExec(1, 'first\n')
      simulateExec(0, 'second\n')

      await run()

      expect(core.setOutput).toHaveBeenCalledWith('result', 'second')
    })

    it('Outputs last attempt result on failure', async () => {
      setupInputs({ command: 'cmd', max_attempts: '2' })
      simulateExec(1, 'attempt1\n')
      simulateExec(1, 'attempt2\n')

      await run()

      expect(core.setOutput).toHaveBeenCalledWith('result', 'attempt2')
    })
  })

  describe('retry_on_exit_code', () => {
    it('Does not retry when exit code is not in retry list', async () => {
      setupInputs({
        command: 'fail',
        max_attempts: '3',
        retry_on_exit_code: '2,3'
      })
      simulateExec(1, 'not retryable\n')

      await run()

      expect(execFixture.exec).toHaveBeenCalledTimes(1)
      expect(core.setOutput).toHaveBeenCalledWith('exit_code', '1')
      expect(core.info).toHaveBeenCalledWith(
        'Exit code 1 is not in retry list, stopping retries'
      )
    })

    it('Retries when exit code matches retry list', async () => {
      setupInputs({
        command: 'fail',
        max_attempts: '3',
        retry_on_exit_code: '2,3'
      })
      simulateExec(2, 'retryable\n')
      simulateExec(0, 'ok\n')

      await run()

      expect(execFixture.exec).toHaveBeenCalledTimes(2)
      expect(core.setOutput).toHaveBeenCalledWith('exit_code', '0')
    })

    it('Does not retry when all exit codes are invalid', async () => {
      setupInputs({
        command: 'fail',
        max_attempts: '3',
        retry_on_exit_code: 'abc,def'
      })
      simulateExec(1, 'fail\n')
      await run()
      expect(execFixture.exec).toHaveBeenCalledTimes(1)
      expect(core.info).toHaveBeenCalledWith(
        'Exit code 1 is not in retry list, stopping retries'
      )
    })

    it('Exhausts retries when exit code always matches', async () => {
      setupInputs({
        command: 'fail',
        max_attempts: '2',
        retry_on_exit_code: '3'
      })
      simulateExec(3, 'try1\n')
      simulateExec(3, 'try2\n')

      await run()

      expect(execFixture.exec).toHaveBeenCalledTimes(2)
      expect(core.setOutput).toHaveBeenCalledWith('exit_code', '3')
    })
  })

  describe('shell selection', () => {
    it('Uses bash by default', async () => {
      setupInputs({ command: 'echo test', shell: '' })
      simulateExec(0, 'test\n')

      await run()

      expect(execFixture.exec).toHaveBeenCalledWith(
        'bash',
        ['-c', 'echo test'],
        expect.any(Object)
      )
    })

    it('Uses the specified shell', async () => {
      setupInputs({ command: 'echo test', shell: 'sh' })
      simulateExec(0, 'test\n')

      await run()

      expect(execFixture.exec).toHaveBeenCalledWith(
        'sh',
        ['-c', 'echo test'],
        expect.any(Object)
      )
    })
  })

  describe('timeout', () => {
    it('Passes timeout to executeCommand', async () => {
      jest.useFakeTimers()

      setupInputs({ command: 'slow-cmd', timeout: '30' })
      simulateExec(0, 'done\n')

      const promise = run()
      await jest.advanceTimersByTimeAsync(0)
      await promise

      jest.useRealTimers()

      expect(core.setOutput).toHaveBeenCalledWith('exit_code', '0')
    })

    it('Handles timeout with no value as null', async () => {
      setupInputs({ command: 'cmd', timeout: '' })
      simulateExec(0, 'ok\n')

      await run()

      expect(core.setOutput).toHaveBeenCalledWith('exit_code', '0')
    })
  })

  describe('default values', () => {
    it('Uses default max_attempts of 5', async () => {
      setupInputs({ command: 'fail', max_attempts: '' })
      for (let i = 0; i < 5; i++) {
        simulateExec(1, `fail${i}\n`)
      }

      await run()

      expect(execFixture.exec).toHaveBeenCalledTimes(5)
    })

    it('Uses default shell of bash', async () => {
      setupInputs({ command: 'cmd', shell: '' })
      simulateExec(0)

      await run()

      expect(execFixture.exec).toHaveBeenCalledWith(
        'bash',
        expect.any(Array),
        expect.any(Object)
      )
    })

    it('Uses default retry_interval of 5', async () => {
      jest.useFakeTimers()

      setupInputs({ command: 'fail', max_attempts: '2', retry_interval: '' })
      simulateExec(1, 'fail\n')
      simulateExec(0, 'ok\n')

      const promise = run()
      await jest.advanceTimersByTimeAsync(5000)
      await promise

      jest.useRealTimers()

      expect(core.info).toHaveBeenCalledWith('Retrying in 5 seconds...')
    })
  })

  describe('group annotations', () => {
    it('Uses group annotations for each attempt', async () => {
      setupInputs({ command: 'cmd', max_attempts: '2' })
      simulateExec(1)
      simulateExec(0, 'ok\n')

      await run()

      expect(core.startGroup).toHaveBeenCalledWith('Attempt 1 of 2')
      expect(core.startGroup).toHaveBeenCalledWith('Attempt 2 of 2')
      expect(core.endGroup).toHaveBeenCalledTimes(2)
    })

    it('Shows correct attempt count on first success', async () => {
      setupInputs({ command: 'cmd', max_attempts: '5' })
      simulateExec(0, 'ok\n')

      await run()

      expect(core.startGroup).toHaveBeenCalledTimes(1)
      expect(core.startGroup).toHaveBeenCalledWith('Attempt 1 of 5')
      expect(core.endGroup).toHaveBeenCalledTimes(1)
    })
  })

  describe('retry interval', () => {
    it('Logs retry interval message', async () => {
      jest.useFakeTimers()

      setupInputs({
        command: 'fail',
        max_attempts: '2',
        retry_interval: '10'
      })
      simulateExec(1, 'fail\n')
      simulateExec(0, 'ok\n')

      const promise = run()
      await jest.advanceTimersByTimeAsync(10000)
      await promise

      jest.useRealTimers()

      expect(core.info).toHaveBeenCalledWith('Retrying in 10 seconds...')
    })

    it('Fails when retry_interval evaluates to negative', async () => {
      setupInputs({
        command: 'fail',
        max_attempts: '2',
        retry_interval: '-5'
      })
      simulateExec(1, 'fail\n')

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        'retry_interval evaluated to a negative number'
      )
    })

    it('Supports expression-based retry_interval', async () => {
      jest.useFakeTimers()

      setupInputs({
        command: 'fail',
        max_attempts: '3',
        retry_interval: 'attempt * 2'
      })
      simulateExec(1, 'fail\n')
      simulateExec(0, 'ok\n')

      const promise = run()
      await jest.advanceTimersByTimeAsync(2000)
      await promise

      jest.useRealTimers()

      expect(core.info).toHaveBeenCalledWith('Retrying in 2 seconds...')
    })
  })

  describe('input validation', () => {
    it('Fails when max_attempts is not a number', async () => {
      setupInputs({ command: 'cmd', max_attempts: 'abc' })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        'max_attempts must be a positive integer'
      )
      expect(execFixture.exec).not.toHaveBeenCalled()
    })

    it('Fails when max_attempts is zero', async () => {
      setupInputs({ command: 'cmd', max_attempts: '0' })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        'max_attempts must be a positive integer'
      )
      expect(execFixture.exec).not.toHaveBeenCalled()
    })

    it('Fails when max_attempts is negative', async () => {
      setupInputs({ command: 'cmd', max_attempts: '-1' })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        'max_attempts must be a positive integer'
      )
      expect(execFixture.exec).not.toHaveBeenCalled()
    })

    it('Fails when timeout is not a number', async () => {
      setupInputs({ command: 'cmd', timeout: 'abc' })
      await run()
      expect(core.setFailed).toHaveBeenCalledWith(
        'timeout must be a non-negative integer'
      )
      expect(execFixture.exec).not.toHaveBeenCalled()
    })

    it('Fails when timeout is negative', async () => {
      setupInputs({ command: 'cmd', timeout: '-1' })
      await run()
      expect(core.setFailed).toHaveBeenCalledWith(
        'timeout must be a non-negative integer'
      )
      expect(execFixture.exec).not.toHaveBeenCalled()
    })

    it('Allows timeout of zero', async () => {
      jest.useFakeTimers()
      setupInputs({ command: 'cmd', timeout: '0' })
      simulateExec(0, 'ok\n')
      const promise = run()
      await jest.advanceTimersByTimeAsync(0)
      await promise
      jest.useRealTimers()
      expect(core.setOutput).toHaveBeenCalledWith('exit_code', '0')
    })
  })

  describe('error handling', () => {
    it('Catches thrown Error and calls setFailed', async () => {
      core.getInput.mockImplementation(() => {
        throw new Error('input error')
      })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith('input error')
    })

    it('Handles non-Error throws by calling setFailed', async () => {
      core.getInput.mockImplementation(() => {
        throw 'string error'
      })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith('string error')
    })
  })

  describe('working_directory', () => {
    it('Passes working_directory to executeCommand', async () => {
      setupInputs({ command: 'pwd', working_directory: '/tmp' })
      simulateExec(0, '/tmp\n')

      await run()

      expect(execFixture.exec).toHaveBeenCalledWith(
        'bash',
        ['-c', 'pwd'],
        expect.objectContaining({ cwd: '/tmp' })
      )
      expect(core.setOutput).toHaveBeenCalledWith('result', '/tmp')
    })

    it('Uses empty working_directory by default', async () => {
      setupInputs({ command: 'pwd' })
      simulateExec(0, '/home\n')

      await run()

      expect(execFixture.exec).toHaveBeenCalledWith(
        'bash',
        ['-c', 'pwd'],
        expect.not.objectContaining({ cwd: expect.anything() })
      )
    })
  })
})
