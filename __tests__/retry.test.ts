/**
 * Unit tests for src/retry.ts
 *
 * executeCommand runs real child processes rather than a mocked exec layer,
 * so the timeout behaviour under test is the behaviour that ships.
 */
import assert from 'node:assert/strict'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { RetryResult } from '../src/retry.ts'
import {
  executeCommand,
  parseRetryOnExitCode,
  shouldRetry,
  sleep
} from '../src/retry.ts'
import { captureOutput, workspace } from './helpers.ts'

/** Runs a command with its streamed output kept out of the test report. */
async function exec(
  command: string,
  shell = 'bash',
  timeout: number | null = null,
  workingDirectory = ''
): Promise<RetryResult> {
  let result: RetryResult | undefined
  await captureOutput(async () => {
    result = await executeCommand(command, shell, timeout, workingDirectory)
  })
  assert.ok(result)
  return result
}

describe('shouldRetry', () => {
  it('Returns false for exit code 0', () => {
    assert.equal(shouldRetry(0, null), false)
  })

  it('Returns false for exit code 0 even with retry list', () => {
    assert.equal(shouldRetry(0, [0, 1]), false)
  })

  it('Returns true for non-zero exit code when no filter is set', () => {
    assert.equal(shouldRetry(1, null), true)
    assert.equal(shouldRetry(255, null), true)
    assert.equal(shouldRetry(124, null), true)
  })

  it('Returns true when exit code is in the retry list', () => {
    assert.equal(shouldRetry(2, [2, 3]), true)
    assert.equal(shouldRetry(3, [2, 3]), true)
  })

  it('Returns false when exit code is not in the retry list', () => {
    assert.equal(shouldRetry(1, [2, 3]), false)
    assert.equal(shouldRetry(255, [2, 3]), false)
  })

  it('Handles single-element retry list', () => {
    assert.equal(shouldRetry(1, [1]), true)
    assert.equal(shouldRetry(2, [1]), false)
  })

  it('Handles empty retry list', () => {
    assert.equal(shouldRetry(1, []), false)
  })
})

describe('parseRetryOnExitCode', () => {
  it('Returns null for empty string', () => {
    assert.equal(parseRetryOnExitCode(''), null)
  })

  it('Parses single exit code', () => {
    assert.deepEqual(parseRetryOnExitCode('1'), [1])
  })

  it('Parses comma-separated exit codes', () => {
    assert.deepEqual(parseRetryOnExitCode('1,2,3'), [1, 2, 3])
  })

  it('Handles whitespace around values', () => {
    assert.deepEqual(parseRetryOnExitCode(' 1 , 2 , 3 '), [1, 2, 3])
  })

  it('Filters out NaN values', () => {
    assert.deepEqual(parseRetryOnExitCode('1,abc,3'), [1, 3])
  })

  it('Handles all NaN values', () => {
    assert.deepEqual(parseRetryOnExitCode('abc,def'), [])
  })

  it('Parses exit code 0', () => {
    assert.deepEqual(parseRetryOnExitCode('0,1'), [0, 1])
  })

  it('Parses high exit codes', () => {
    assert.deepEqual(parseRetryOnExitCode('124,255'), [124, 255])
  })
})

describe('sleep', () => {
  it('Resolves after the specified time', async () => {
    const start = Date.now()
    await sleep(100)
    assert.ok(Date.now() - start >= 90)
  })

  it('Resolves immediately for 0ms', async () => {
    const start = Date.now()
    await sleep(0)
    assert.ok(Date.now() - start < 50)
  })
})

describe('executeCommand', () => {
  it('Runs the command through the given shell', async () => {
    const result = await exec('echo hello')

    assert.equal(result.exitCode, 0)
    assert.equal(result.output, 'hello')
  })

  it('Runs the command through sh', async () => {
    const result = await exec('echo test', 'sh')

    assert.equal(result.exitCode, 0)
    assert.equal(result.output, 'test')
  })

  it('Returns a non-zero exit code', async () => {
    assert.equal((await exec('exit 42')).exitCode, 42)
  })

  it('Preserves exit code 255', async () => {
    assert.equal((await exec('exit 255')).exitCode, 255)
  })

  it('Captures stderr', async () => {
    assert.equal((await exec('echo oops >&2')).output, 'oops')
  })

  it('Captures stdout before stderr', async () => {
    const result = await exec('echo out; echo err >&2')

    assert.equal(result.output, 'out\nerr')
  })

  it('Trims trailing whitespace from output', async () => {
    assert.equal((await exec("printf 'hello\\n\\n\\n'")).output, 'hello')
  })

  it('Returns empty output when the command produces none', async () => {
    const result = await exec('true')

    assert.equal(result.exitCode, 0)
    assert.equal(result.output, '')
  })

  it('Handles multiline output', async () => {
    const result = await exec("printf 'line1\\nline2\\nline3\\n'")

    assert.equal(result.output, 'line1\nline2\nline3')
  })

  it('Handles output with special characters', async () => {
    const result = await exec('echo \'{"key": "value"}\'')

    assert.equal(result.output, '{"key": "value"}')
  })

  it('Runs in workingDirectory when one is given', async () => {
    const dir = workspace()

    const result = await exec('pwd -P', 'bash', null, dir)

    assert.equal(result.output, realpathSync(dir))
  })

  it('Runs in the current directory when workingDirectory is empty', async () => {
    const result = await exec('pwd -P')

    assert.equal(result.output, realpathSync(process.cwd()))
  })

  it('Rejects when the shell cannot be spawned', async () => {
    await assert.rejects(exec('echo hi', 'no-such-shell-xyz'))
  })

  describe('timeout', () => {
    it('Completes normally when the command finishes in time', async () => {
      const result = await exec('echo fast', 'bash', 5)

      assert.equal(result.exitCode, 0)
      assert.equal(result.output, 'fast')
    })

    it('Returns exit code 124 when the command times out', async () => {
      assert.equal((await exec('sleep 5', 'bash', 1)).exitCode, 124)
    })

    it('Captures partial output on timeout', async () => {
      const result = await exec('echo partial; sleep 5', 'bash', 1)

      assert.equal(result.exitCode, 124)
      assert.equal(result.output, 'partial')
    })

    it('Kills processes the command spawned', async () => {
      const marker = join(workspace(), 'marker')

      const result = await exec(
        `(sleep 2; touch ${marker}) & sleep 10`,
        'bash',
        1
      )
      assert.equal(result.exitCode, 124)

      // Outlive the moment the orphan would have created the marker.
      await sleep(2500)
      assert.equal(existsSync(marker), false)
    })
  })
})
