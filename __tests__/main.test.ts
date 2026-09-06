/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * Nothing is stubbed: inputs are set as the runner sets them, commands are
 * executed for real, and outputs are read back out of a GITHUB_OUTPUT file.
 */
import assert from 'node:assert/strict'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { run } from '../src/main.ts'
import {
  captureOutput,
  clearInputs,
  outputFile,
  readOutputs,
  scripted,
  setInputs,
  workspace
} from './helpers.ts'

interface Outcome {
  outputs: Record<string, string>
  log: string
  failed: boolean
}

async function runAction(
  inputs: Record<string, string> = {}
): Promise<Outcome> {
  const output = outputFile()
  process.env.GITHUB_OUTPUT = output
  setInputs({
    command: 'echo hello',
    max_attempts: '3',
    retry_interval: '0',
    timeout: '',
    shell: 'bash',
    retry_on_exit_code: '',
    working_directory: '',
    ...inputs
  })

  const log = await captureOutput(async () => {
    await run()
  })

  return { outputs: readOutputs(output), log, failed: process.exitCode === 1 }
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/** A command that leaves a trace, so a test can assert it never ran. */
function neverRuns(): { command: string; ran: () => boolean } {
  const marker = join(workspace(), 'ran')
  return { command: `touch ${marker}`, ran: () => existsSync(marker) }
}

afterEach(() => {
  clearInputs()
  delete process.env.GITHUB_OUTPUT
  process.exitCode = 0
})

describe('run', () => {
  describe('successful execution', () => {
    it('Succeeds on first attempt', async () => {
      const job = scripted(0)

      const { outputs, failed } = await runAction({ command: job.command })

      assert.equal(job.attempts(), 1)
      assert.deepEqual(outputs, { exit_code: '0', result: 'ok1' })
      assert.equal(failed, false)
    })

    it('Retries and succeeds on second attempt', async () => {
      const job = scripted(1)

      const { outputs, failed } = await runAction({
        command: job.command,
        max_attempts: '3'
      })

      assert.equal(job.attempts(), 2)
      assert.deepEqual(outputs, { exit_code: '0', result: 'ok2' })
      assert.equal(failed, false)
    })

    it('Retries and succeeds on the last attempt', async () => {
      const job = scripted(2)

      const { outputs, failed } = await runAction({
        command: job.command,
        max_attempts: '3'
      })

      assert.equal(job.attempts(), 3)
      assert.deepEqual(outputs, { exit_code: '0', result: 'ok3' })
      assert.equal(failed, false)
    })
  })

  describe('failure handling', () => {
    it('Fails after exhausting all attempts', async () => {
      const job = scripted(5)

      const { outputs, log } = await runAction({
        command: job.command,
        max_attempts: '3'
      })

      assert.equal(job.attempts(), 3)
      assert.equal(outputs.exit_code, '1')
      assert.ok(log.includes('::error::Command failed with exit code 1'))
    })

    it('Preserves a specific exit code', async () => {
      const { outputs, log } = await runAction({
        command: 'exit 42',
        max_attempts: '1'
      })

      assert.equal(outputs.exit_code, '42')
      assert.ok(log.includes('::error::Command failed with exit code 42'))
    })

    it('Preserves exit code 255', async () => {
      const { outputs } = await runAction({
        command: 'exit 255',
        max_attempts: '1'
      })

      assert.equal(outputs.exit_code, '255')
    })

    it('Runs once when max_attempts is 1', async () => {
      const job = scripted(5)

      const { failed } = await runAction({
        command: job.command,
        max_attempts: '1'
      })

      assert.equal(job.attempts(), 1)
      assert.equal(failed, true)
    })
  })

  describe('output handling', () => {
    it('Captures multiline output', async () => {
      const { outputs } = await runAction({
        command: "printf 'line1\\nline2\\nline3\\n'"
      })

      assert.equal(outputs.result, 'line1\nline2\nline3')
    })

    it('Captures both stdout and stderr', async () => {
      const { outputs } = await runAction({
        command: 'echo out; echo err >&2'
      })

      assert.equal(outputs.result, 'out\nerr')
    })

    it('Handles empty output', async () => {
      const { outputs } = await runAction({ command: 'true' })

      assert.deepEqual(outputs, { exit_code: '0', result: '' })
    })

    it('Only reports the last attempt result', async () => {
      const job = scripted(1)

      const { outputs } = await runAction({
        command: job.command,
        max_attempts: '3'
      })

      assert.equal(outputs.result, 'ok2')
    })

    it('Reports the last attempt result on failure', async () => {
      const job = scripted(5)

      const { outputs } = await runAction({
        command: job.command,
        max_attempts: '2'
      })

      assert.equal(outputs.result, 'fail2')
    })
  })

  describe('retry_on_exit_code', () => {
    it('Does not retry when the exit code is not in the retry list', async () => {
      const job = scripted(5, 1)

      const { outputs, log } = await runAction({
        command: job.command,
        max_attempts: '3',
        retry_on_exit_code: '2,3'
      })

      assert.equal(job.attempts(), 1)
      assert.equal(outputs.exit_code, '1')
      assert.ok(
        log.includes('Exit code 1 is not in retry list, stopping retries')
      )
    })

    it('Retries when the exit code matches the retry list', async () => {
      const job = scripted(1, 2)

      const { outputs } = await runAction({
        command: job.command,
        max_attempts: '3',
        retry_on_exit_code: '2,3'
      })

      assert.equal(job.attempts(), 2)
      assert.equal(outputs.exit_code, '0')
    })

    it('Does not retry when every exit code in the list is invalid', async () => {
      const job = scripted(5)

      const { log } = await runAction({
        command: job.command,
        max_attempts: '3',
        retry_on_exit_code: 'abc,def'
      })

      assert.equal(job.attempts(), 1)
      assert.ok(
        log.includes('Exit code 1 is not in retry list, stopping retries')
      )
    })

    it('Exhausts retries when the exit code always matches', async () => {
      const job = scripted(5, 3)

      const { outputs } = await runAction({
        command: job.command,
        max_attempts: '2',
        retry_on_exit_code: '3'
      })

      assert.equal(job.attempts(), 2)
      assert.equal(outputs.exit_code, '3')
    })
  })

  describe('shell selection', () => {
    // $0 is the shell as it was invoked, so this reports the binary that
    // actually ran rather than whatever it is aliased to.
    const reportShell = 'echo "$0"'

    it('Uses bash by default', async () => {
      const { outputs } = await runAction({ command: reportShell, shell: '' })

      assert.equal(outputs.result, 'bash')
    })

    it('Uses the specified shell', async () => {
      const { outputs } = await runAction({ command: reportShell, shell: 'sh' })

      assert.equal(outputs.result, 'sh')
    })
  })

  describe('timeout', () => {
    it('Completes normally when the command finishes in time', async () => {
      const { outputs } = await runAction({
        command: 'echo done',
        timeout: '30'
      })

      assert.deepEqual(outputs, { exit_code: '0', result: 'done' })
    })

    it('Reports exit code 124 when the command times out', async () => {
      const { outputs, log } = await runAction({
        command: 'sleep 5',
        timeout: '1',
        max_attempts: '1'
      })

      assert.equal(outputs.exit_code, '124')
      assert.ok(log.includes('::error::Command failed with exit code 124'))
    })

    it('Treats an empty timeout as no timeout', async () => {
      const { outputs } = await runAction({ command: 'echo ok', timeout: '' })

      assert.equal(outputs.exit_code, '0')
    })
  })

  describe('default values', () => {
    it('Uses a default max_attempts of 5', async () => {
      const job = scripted(9)

      await runAction({ command: job.command, max_attempts: '' })

      assert.equal(job.attempts(), 5)
    })

    it('Uses a default retry_interval of 5 seconds', async () => {
      const job = scripted(1)

      // The retry genuinely sleeps, so this test pays the five seconds.
      const { log } = await runAction({
        command: job.command,
        max_attempts: '2',
        retry_interval: ''
      })

      assert.ok(log.includes('Retrying in 5 seconds...'))
    })
  })

  describe('group annotations', () => {
    it('Wraps every attempt in a group', async () => {
      const job = scripted(1)

      const { log } = await runAction({
        command: job.command,
        max_attempts: '2'
      })

      assert.ok(log.includes('::group::Attempt 1 of 2'))
      assert.ok(log.includes('::group::Attempt 2 of 2'))
      assert.equal(occurrences(log, '::endgroup::'), 2)
    })

    it('Opens a single group when the first attempt succeeds', async () => {
      const { log } = await runAction({ command: 'true', max_attempts: '5' })

      assert.ok(log.includes('::group::Attempt 1 of 5'))
      assert.equal(occurrences(log, '::group::'), 1)
      assert.equal(occurrences(log, '::endgroup::'), 1)
    })
  })

  describe('retry interval', () => {
    it('Logs the interval before sleeping', async () => {
      const job = scripted(1)

      const { log } = await runAction({
        command: job.command,
        max_attempts: '2',
        retry_interval: '0'
      })

      assert.ok(log.includes('Retrying in 0 seconds...'))
    })

    it('Evaluates an expression against the attempt number', async () => {
      const job = scripted(1)

      const { log } = await runAction({
        command: job.command,
        max_attempts: '2',
        retry_interval: 'attempt - 1'
      })

      assert.ok(log.includes('Retrying in 0 seconds...'))
    })

    it('Fails when the interval evaluates to a negative number', async () => {
      const job = scripted(5)

      const { log } = await runAction({
        command: job.command,
        max_attempts: '2',
        retry_interval: '-5'
      })

      assert.ok(
        log.includes('::error::retry_interval evaluated to a negative number')
      )
    })
  })

  describe('input validation', () => {
    it('Fails when command is not supplied', async () => {
      const { log } = await runAction({ command: '' })

      assert.ok(
        log.includes('::error::Input required and not supplied: command')
      )
    })

    it('Fails when max_attempts is not a number', async () => {
      const job = neverRuns()

      const { log } = await runAction({
        command: job.command,
        max_attempts: 'abc'
      })

      assert.ok(
        log.includes('::error::max_attempts must be a positive integer')
      )
      assert.equal(job.ran(), false)
    })

    it('Fails when max_attempts is zero', async () => {
      const job = neverRuns()

      const { log } = await runAction({
        command: job.command,
        max_attempts: '0'
      })

      assert.ok(
        log.includes('::error::max_attempts must be a positive integer')
      )
      assert.equal(job.ran(), false)
    })

    it('Fails when max_attempts is negative', async () => {
      const job = neverRuns()

      const { log } = await runAction({
        command: job.command,
        max_attempts: '-1'
      })

      assert.ok(
        log.includes('::error::max_attempts must be a positive integer')
      )
      assert.equal(job.ran(), false)
    })

    it('Fails when timeout is not a number', async () => {
      const job = neverRuns()

      const { log } = await runAction({ command: job.command, timeout: 'abc' })

      assert.ok(log.includes('::error::timeout must be a non-negative integer'))
      assert.equal(job.ran(), false)
    })

    it('Fails when timeout is negative', async () => {
      const job = neverRuns()

      const { log } = await runAction({ command: job.command, timeout: '-1' })

      assert.ok(log.includes('::error::timeout must be a non-negative integer'))
      assert.equal(job.ran(), false)
    })
  })

  describe('error handling', () => {
    it('Reports a shell that cannot be spawned', async () => {
      const { failed } = await runAction({
        command: 'echo hi',
        shell: 'no-such-shell-xyz'
      })

      assert.equal(failed, true)
    })
  })

  describe('working_directory', () => {
    it('Runs the command in the given directory', async () => {
      const dir = workspace()

      const { outputs } = await runAction({
        command: 'pwd -P',
        working_directory: dir
      })

      assert.equal(outputs.result, realpathSync(dir))
    })

    it('Runs in the current directory by default', async () => {
      const { outputs } = await runAction({ command: 'pwd -P' })

      assert.equal(outputs.result, realpathSync(process.cwd()))
    })
  })
})
