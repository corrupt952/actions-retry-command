import { jest } from '@jest/globals'

export const exec =
  jest.fn<
    (
      commandLine: string,
      args?: string[],
      options?: {
        ignoreReturnCode?: boolean
        listeners?: {
          stdout?: (data: Buffer) => void
          stderr?: (data: Buffer) => void
        }
      }
    ) => Promise<number>
  >()
