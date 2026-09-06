/**
 * Unit tests for src/core.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EOL } from 'node:os'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  endGroup,
  getInput,
  info,
  setFailed,
  setOutput,
  startGroup
} from '../src/core.ts'
import { captureOutput, outputFile } from './helpers.ts'

const originalEnv = process.env

beforeEach(() => {
  process.env = { ...originalEnv }
})

afterEach(() => {
  process.env = originalEnv
  process.exitCode = 0
})

describe('getInput', () => {
  it('Reads the INPUT_ environment variable for the name', () => {
    process.env.INPUT_COMMAND = 'echo hello'

    assert.equal(getInput('command'), 'echo hello')
  })

  it('Uppercases the name and replaces spaces with underscores', () => {
    process.env.INPUT_MAX_ATTEMPTS = '3'
    process.env.INPUT_TWO_WORDS = 'value'

    assert.equal(getInput('max_attempts'), '3')
    assert.equal(getInput('two words'), 'value')
  })

  it('Trims surrounding whitespace', () => {
    process.env.INPUT_SHELL = '  sh  '

    assert.equal(getInput('shell'), 'sh')
  })

  it('Returns an empty string when the variable is unset', () => {
    delete process.env.INPUT_TIMEOUT

    assert.equal(getInput('timeout'), '')
  })

  it('Preserves newlines inside the value', () => {
    process.env.INPUT_COMMAND = 'echo one\necho two'

    assert.equal(getInput('command'), 'echo one\necho two')
  })

  it('Throws when a required input is unset', () => {
    delete process.env.INPUT_COMMAND

    assert.throws(() => getInput('command', { required: true }), {
      message: 'Input required and not supplied: command'
    })
  })

  it('Throws when a required input is empty', () => {
    process.env.INPUT_COMMAND = ''

    assert.throws(() => getInput('command', { required: true }), {
      message: 'Input required and not supplied: command'
    })
  })
})

describe('setOutput', () => {
  it('Appends the value using a delimited heredoc', () => {
    const path = outputFile()
    process.env.GITHUB_OUTPUT = path

    setOutput('exit_code', '0')

    const lines = readFileSync(path, 'utf8').split(EOL)
    assert.match(lines[0], /^exit_code<<ghadelimiter_/)
    assert.equal(lines[1], '0')
    assert.equal(lines[2], lines[0].split('<<')[1])
  })

  it('Round-trips a multiline value', () => {
    const path = outputFile()
    process.env.GITHUB_OUTPUT = path

    setOutput('result', `line1${EOL}line2${EOL}line3`)

    const lines = readFileSync(path, 'utf8').split(EOL)
    const delimiter = lines[0].split('<<')[1]
    assert.deepEqual(lines.slice(1, lines.indexOf(delimiter, 1)), [
      'line1',
      'line2',
      'line3'
    ])
  })

  it('Uses a fresh delimiter for each call', () => {
    const path = outputFile()
    process.env.GITHUB_OUTPUT = path

    setOutput('a', '1')
    setOutput('b', '2')

    const lines = readFileSync(path, 'utf8').split(EOL)
    assert.notEqual(lines[0].split('<<')[1], lines[3].split('<<')[1])
  })

  it('Appends without truncating earlier outputs', () => {
    const path = outputFile()
    process.env.GITHUB_OUTPUT = path

    setOutput('exit_code', '0')
    setOutput('result', 'hello')

    const written = readFileSync(path, 'utf8')
    assert.ok(written.includes('exit_code<<'))
    assert.ok(written.includes('result<<'))
  })

  it('Throws when GITHUB_OUTPUT is not set', () => {
    delete process.env.GITHUB_OUTPUT

    assert.throws(() => setOutput('exit_code', '0'), {
      message: 'Unable to find environment variable for file command OUTPUT'
    })
  })
})

describe('info', () => {
  it('Writes the message followed by a line ending', async () => {
    const written = await captureOutput(async () => {
      info('hello')
    })

    assert.equal(written, `hello${EOL}`)
  })
})

describe('startGroup and endGroup', () => {
  it('Issues the group workflow commands', async () => {
    const written = await captureOutput(async () => {
      startGroup('Attempt 1 of 3')
      endGroup()
    })

    assert.equal(written, `::group::Attempt 1 of 3${EOL}::endgroup::${EOL}`)
  })

  it('Escapes characters that would break the command', async () => {
    const written = await captureOutput(async () => {
      startGroup('100% done\nnext')
    })

    assert.equal(written, `::group::100%25 done%0Anext${EOL}`)
  })
})

describe('setFailed', () => {
  it('Issues an error command and marks the process as failed', async () => {
    const written = await captureOutput(async () => {
      setFailed('Command failed with exit code 1')
    })

    assert.equal(written, `::error::Command failed with exit code 1${EOL}`)
    assert.equal(process.exitCode, 1)
  })

  it('Escapes newlines and percent signs in the message', async () => {
    const written = await captureOutput(async () => {
      setFailed('bad\r\nmessage 50%')
    })

    assert.equal(written, `::error::bad%0D%0Amessage 50%25${EOL}`)
  })
})
