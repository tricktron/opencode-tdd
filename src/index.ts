import type { Plugin } from '@opencode-ai/plugin'

export const TDDPlugin: Plugin = async () => {
  return {
    'tool.execute.before': async (input, output) => {
      if (['edit', 'write'].includes(input.tool)) {
        const filePath = output.args.filePath as string
        console.log(`[TDD] Intercepted ${input.tool}: ${filePath}`)
      }

      if (input.tool === 'bash') {
        const command = output.args.command as string
        console.log(`[TDD] Intercepted bash: ${command}`)
      }
    },
  }
}
