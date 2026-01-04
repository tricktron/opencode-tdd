import picomatch from 'picomatch'

export type FileType = 'test' | 'impl'

export const classify = (filePath: string, patterns: string[]): FileType => {
  const isMatch = picomatch(patterns)
  return isMatch(filePath) ? 'test' : 'impl'
}
