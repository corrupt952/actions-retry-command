import * as core from '@actions/core'
import * as exec from '@actions/exec'

/**
 * Sleep for specified number of seconds
 */
function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}

/**
 * Retry a command with exponential backoff
 *
 * @param command - The shell command to execute
 * @param workingDirectory - Directory where command should run
 * @param maxAttempts - Maximum number of retry attempts
 * @param retryInterval - Seconds to wait between retries
 */
export async function retryCommand(
  command: string,
  workingDirectory: string,
  maxAttempts: number,
  retryInterval: number
): Promise<void> {
  let lastExitCode = 0
  let lastOutput = ''

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    core.info(`Attempts: ${attempt}`)

    // Capture stdout and stderr
    let stdout = ''
    let stderr = ''

    const options: exec.ExecOptions = {
      cwd: workingDirectory,
      ignoreReturnCode: true,
      listeners: {
        stdout: (data: Buffer) => {
          stdout += data.toString()
        },
        stderr: (data: Buffer) => {
          stderr += data.toString()
        }
      }
    }

    try {
      lastExitCode = await exec.exec(command, [], options)
    } catch (error) {
      // If exec itself throws, treat as failure
      lastExitCode = 1
      core.error(`Command execution failed: ${error}`)
    }

    // Combine stdout and stderr (matching bash behavior with 2>&1)
    lastOutput = (stdout + stderr).trim()

    core.info(`Exit code: ${lastExitCode}`)
    core.info(`Result: ${lastOutput}`)

    // Success condition: exit code is 0 OR this is the final attempt
    if (lastExitCode === 0 || attempt === maxAttempts) {
      // Set outputs
      core.setOutput('result', lastOutput)
      core.setOutput('exit_code', lastExitCode.toString())

      // If command failed, throw error
      if (lastExitCode !== 0) {
        throw new Error(
          `Command failed after ${maxAttempts} attempts with exit code: ${lastExitCode}`
        )
      }

      // Success - exit early
      return
    }

    // Not the final attempt and command failed - retry
    core.info(`sleep: ${retryInterval}`)
    await sleep(retryInterval)
  }
}

/**
 * Main entry point for the action
 */
export async function run(): Promise<void> {
  try {
    // Get inputs
    const command = core.getInput('command', { required: true })
    const workingDirectory = core.getInput('working_directory', { required: true })
    const maxAttempts = parseInt(core.getInput('max_attempts', { required: true }), 10)
    const retryInterval = parseInt(core.getInput('retry_interval', { required: true }), 10)

    // Validate inputs
    if (!command) {
      throw new Error('command input is required')
    }

    if (isNaN(maxAttempts) || maxAttempts < 1) {
      throw new Error('max_attempts must be a positive integer')
    }

    if (isNaN(retryInterval) || retryInterval < 0) {
      throw new Error('retry_interval must be a non-negative integer')
    }

    // Execute command with retry logic
    await retryCommand(command, workingDirectory, maxAttempts, retryInterval)
  } catch (error) {
    // Action failed
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unknown error occurred')
    }
  }
}
