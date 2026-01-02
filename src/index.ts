import type { Plugin } from '@opencode-ai/plugin'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const TDDPlugin: Plugin = async ({ directory }) => {
  return {
    'tool.execute.before': async (input, output) => {
      if (['edit', 'write'].includes(input.tool)) {
        const filePath = output.args.filePath as string
        console.log(`[TDD] Intercepted ${input.tool}: ${filePath}`)

        const projectRoot = directory ?? process.cwd()
        const testOutputPath = join(
          projectRoot,
          '.opencode',
          'tdd',
          'test-output.txt',
        )

        const testOutput = await readFile(testOutputPath, 'utf8').catch(
          () => '',
        )
        if (testOutput.includes('FAIL')) {
          return
        }
      }
    },
  }
}
