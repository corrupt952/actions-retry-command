import { jest } from '@jest/globals'
import type * as core from '../src/core.ts'

export const info = jest.fn<typeof core.info>()
export const getInput = jest.fn<typeof core.getInput>()
export const setOutput = jest.fn<typeof core.setOutput>()
export const setFailed = jest.fn<typeof core.setFailed>()
export const startGroup = jest.fn<typeof core.startGroup>()
export const endGroup = jest.fn<typeof core.endGroup>()
