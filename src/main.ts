import * as core from '@actions/core'
import {
  executeCommand,
  parseRetryOnExitCode,
  shouldRetry,
  sleep
} from './retry.js'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const command = core.getInput('command', { required: true })
    const maxAttempts = parseInt(core.getInput('max_attempts') || '5', 10)
    const retryInterval = parseInt(core.getInput('retry_interval') || '5', 10)
    const timeoutInput = core.getInput('timeout')
    const timeout = timeoutInput ? parseInt(timeoutInput, 10) : null
    if (timeout !== null && (isNaN(timeout) || timeout < 0)) {
      core.setFailed('timeout must be a non-negative integer')
      return
    }
    if (isNaN(maxAttempts) || maxAttempts < 1) {
      core.setFailed('max_attempts must be a positive integer')
      return
    }
    if (isNaN(retryInterval) || retryInterval < 0) {
      core.setFailed('retry_interval must be a non-negative integer')
      return
    }
    const shell = core.getInput('shell') || 'bash'
    const retryOnExitCode = parseRetryOnExitCode(
      core.getInput('retry_on_exit_code')
    )

    let lastExitCode = 0
    let lastOutput = ''

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      core.startGroup(`Attempt ${attempt} of ${maxAttempts}`)

      const result = await executeCommand(command, shell, timeout)
      lastExitCode = result.exitCode
      lastOutput = result.output

      core.endGroup()

      if (result.exitCode === 0) {
        break
      }

      if (attempt === maxAttempts) {
        break
      }

      if (!shouldRetry(result.exitCode, retryOnExitCode)) {
        core.info(
          `Exit code ${result.exitCode} is not in retry list, stopping retries`
        )
        break
      }

      core.info(`Retrying in ${retryInterval} seconds...`)
      await sleep(retryInterval * 1000)
    }

    core.setOutput('exit_code', lastExitCode.toString())
    core.setOutput('result', lastOutput)

    if (lastExitCode !== 0) {
      core.setFailed(`Command failed with exit code ${lastExitCode}`)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
    else core.setFailed(String(error))
  }
}
