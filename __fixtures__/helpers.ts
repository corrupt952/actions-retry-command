import { jest } from '@jest/globals'

export function createSimulateExec(execMock: jest.Mock) {
  return function simulateExec(
    exitCode: number,
    stdout: string = '',
    stderr: string = ''
  ): void {
    execMock.mockImplementationOnce(
      async (
        _cmd: string,
        _args?: string[],
        options?: {
          listeners?: {
            stdout?: (data: Buffer) => void
            stderr?: (data: Buffer) => void
          }
        }
      ) => {
        if (stdout && options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from(stdout))
        }
        if (stderr && options?.listeners?.stderr) {
          options.listeners.stderr(Buffer.from(stderr))
        }
        return exitCode
      }
    )
  }
}
