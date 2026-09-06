/**
 * Shared plumbing for driving the action the way the runner does: inputs in
 * INPUT_* environment variables, outputs in a GITHUB_OUTPUT file, and logging
 * on stdout.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { EOL, tmpdir } from 'node:os'
import { join } from 'node:path'

export function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'retry-command-'))
}

export function outputFile(): string {
  const path = join(workspace(), 'output')
  writeFileSync(path, '')
  return path
}

/** Parses the delimited heredocs the runner expects in GITHUB_OUTPUT. */
export function readOutputs(path: string): Record<string, string> {
  const lines = readFileSync(path, 'utf8').split(EOL)
  const outputs: Record<string, string> = {}

  let index = 0
  while (index < lines.length) {
    const [name, delimiter, ...rest] = lines[index].split('<<')
    if (delimiter === undefined || rest.length > 0) {
      index += 1
      continue
    }
    const end = lines.indexOf(delimiter, index + 1)
    outputs[name] = lines.slice(index + 1, end).join(EOL)
    index = end + 1
  }

  return outputs
}

export function setInputs(inputs: Record<string, string>): void {
  for (const [name, value] of Object.entries(inputs)) {
    process.env[`INPUT_${name.toUpperCase()}`] = value
  }
}

export function clearInputs(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('INPUT_')) delete process.env[key]
  }
}

/**
 * Runs `fn` and returns everything it wrote to stdout.
 *
 * Writes are recorded and then passed through to the real stream. Swallowing
 * them instead loses the test runner's own records, which it writes to stdout
 * whatever --test-reporter-destination says, and the affected tests silently
 * drop out of the run summary.
 */
export async function captureOutput(fn: () => Promise<void>): Promise<string> {
  const original = process.stdout.write.bind(process.stdout)
  const chunks: string[] = []

  process.stdout.write = ((
    chunk: string | Uint8Array,
    ...rest: unknown[]
  ): boolean => {
    chunks.push(chunk.toString())
    return (original as (...args: unknown[]) => boolean)(chunk, ...rest)
  }) as typeof process.stdout.write
  try {
    await fn()
  } finally {
    process.stdout.write = original
  }

  return chunks.join('')
}

export interface Scripted {
  command: string
  attempts: () => number
}

/**
 * A command that records how many times it ran and fails the first `failures`
 * invocations. It prints `failN` while failing and `okN` once it succeeds.
 */
export function scripted(failures: number, exitCode = 1): Scripted {
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
