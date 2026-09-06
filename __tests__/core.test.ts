/**
 * Unit tests for src/core.ts
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { EOL, tmpdir } from 'node:os'
import { join } from 'node:path'
import { jest } from '@jest/globals'
import {
  endGroup,
  getInput,
  info,
  setFailed,
  setOutput,
  startGroup
} from '../src/core.ts'

const originalEnv = process.env

function captureStdout(): { written: () => string } {
  const chunks: string[] = []
  jest
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(chunk.toString())
      return true
    })
  return { written: () => chunks.join('') }
}

function outputFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'core-test-')), 'output')
  writeFileSync(path, '')
  return path
}

beforeEach(() => {
  process.env = { ...originalEnv }
})

afterEach(() => {
  process.env = originalEnv
  jest.restoreAllMocks()
})

describe('getInput', () => {
  it('Reads the INPUT_ environment variable for the name', () => {
    process.env.INPUT_COMMAND = 'echo hello'

    expect(getInput('command')).toBe('echo hello')
  })

  it('Uppercases the name and replaces spaces with underscores', () => {
    process.env.INPUT_MAX_ATTEMPTS = '3'
    process.env.INPUT_TWO_WORDS = 'value'

    expect(getInput('max_attempts')).toBe('3')
    expect(getInput('two words')).toBe('value')
  })

  it('Trims surrounding whitespace', () => {
    process.env.INPUT_SHELL = '  sh  '

    expect(getInput('shell')).toBe('sh')
  })

  it('Returns an empty string when the variable is unset', () => {
    delete process.env.INPUT_TIMEOUT

    expect(getInput('timeout')).toBe('')
  })

  it('Preserves newlines inside the value', () => {
    process.env.INPUT_COMMAND = 'echo one\necho two'

    expect(getInput('command')).toBe('echo one\necho two')
  })

  it('Throws when a required input is unset', () => {
    delete process.env.INPUT_COMMAND

    expect(() => getInput('command', { required: true })).toThrow(
      'Input required and not supplied: command'
    )
  })

  it('Throws when a required input is empty', () => {
    process.env.INPUT_COMMAND = ''

    expect(() => getInput('command', { required: true })).toThrow(
      'Input required and not supplied: command'
    )
  })
})

describe('setOutput', () => {
  it('Appends the value using a delimited heredoc', () => {
    const path = outputFile()
    process.env.GITHUB_OUTPUT = path

    setOutput('exit_code', '0')

    const written = readFileSync(path, 'utf8')
    expect(written).toMatch(/^exit_code<<ghadelimiter_/)
    expect(written.split(EOL)[1]).toBe('0')
  })

  it('Round-trips a multiline value', () => {
    const path = outputFile()
    process.env.GITHUB_OUTPUT = path

    setOutput('result', `line1${EOL}line2${EOL}line3`)

    const lines = readFileSync(path, 'utf8').split(EOL)
    const delimiter = lines[0].split('<<')[1]
    expect(lines.slice(1, lines.indexOf(delimiter, 1))).toEqual([
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
    expect(lines[0].split('<<')[1]).not.toBe(lines[3].split('<<')[1])
  })

  it('Appends without truncating earlier outputs', () => {
    const path = outputFile()
    process.env.GITHUB_OUTPUT = path

    setOutput('exit_code', '0')
    setOutput('result', 'hello')

    const written = readFileSync(path, 'utf8')
    expect(written).toContain('exit_code<<')
    expect(written).toContain('result<<')
  })

  it('Throws when GITHUB_OUTPUT is not set', () => {
    delete process.env.GITHUB_OUTPUT

    expect(() => setOutput('exit_code', '0')).toThrow(
      'Unable to find environment variable for file command OUTPUT'
    )
  })
})

describe('info', () => {
  it('Writes the message followed by a line ending', () => {
    const stdout = captureStdout()

    info('hello')

    expect(stdout.written()).toBe(`hello${EOL}`)
  })
})

describe('startGroup and endGroup', () => {
  it('Issues the group workflow commands', () => {
    const stdout = captureStdout()

    startGroup('Attempt 1 of 3')
    endGroup()

    expect(stdout.written()).toBe(
      `::group::Attempt 1 of 3${EOL}::endgroup::${EOL}`
    )
  })

  it('Escapes characters that would break the command', () => {
    const stdout = captureStdout()

    startGroup('100% done\nnext')

    expect(stdout.written()).toBe(`::group::100%25 done%0Anext${EOL}`)
  })
})

describe('setFailed', () => {
  afterEach(() => {
    process.exitCode = 0
  })

  it('Issues an error command and marks the process as failed', () => {
    const stdout = captureStdout()

    setFailed('Command failed with exit code 1')

    expect(stdout.written()).toBe(
      `::error::Command failed with exit code 1${EOL}`
    )
    expect(process.exitCode).toBe(1)
  })

  it('Escapes newlines and percent signs in the message', () => {
    const stdout = captureStdout()

    setFailed('bad\r\nmessage 50%')

    expect(stdout.written()).toBe(`::error::bad%0D%0Amessage 50%25${EOL}`)
  })
})
