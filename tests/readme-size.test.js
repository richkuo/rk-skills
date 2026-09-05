import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const README_MAX_BYTES = 14000

describe('README size cap', () => {
  test('README.md stays under the byte cap', async () => {
    const bytes = await Bun.file(new URL('README.md', root)).arrayBuffer()
    expect(bytes.byteLength, `README.md is ${bytes.byteLength} bytes; cap is ${README_MAX_BYTES}`).toBeLessThan(README_MAX_BYTES)
  })
})
