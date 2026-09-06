/**
 * The subset of the Actions toolkit this action needs, implemented against the
 * documented runner protocol: inputs arrive as INPUT_* environment variables,
 * outputs are appended to the file named by GITHUB_OUTPUT, and logging goes
 * through workflow commands on stdout.
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { EOL } from 'node:os'

export interface InputOptions {
  required?: boolean
}

export function getInput(name: string, options?: InputOptions): string {
  const value = process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`]
  if (options?.required && !value) {
    throw new Error(`Input required and not supplied: ${name}`)
  }
  return (value || '').trim()
}

function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

export function info(message: string): void {
  process.stdout.write(`${message}${EOL}`)
}

export function startGroup(name: string): void {
  process.stdout.write(`::group::${escapeData(name)}${EOL}`)
}

export function endGroup(): void {
  process.stdout.write(`::endgroup::${EOL}`)
}

export function setOutput(name: string, value: string): void {
  const filePath = process.env.GITHUB_OUTPUT
  if (!filePath) {
    throw new Error(
      'Unable to find environment variable for file command OUTPUT'
    )
  }

  // A random delimiter keeps arbitrary command output from terminating the
  // heredoc early, which is what the runner documentation warns about.
  const delimiter = `ghadelimiter_${randomUUID()}`

  appendFileSync(
    filePath,
    `${name}<<${delimiter}${EOL}${value}${EOL}${delimiter}${EOL}`,
    { encoding: 'utf8' }
  )
}

export function setFailed(message: string): void {
  process.exitCode = 1
  process.stdout.write(`::error::${escapeData(message)}${EOL}`)
}
