import { describe, expect, test } from 'bun:test'

/**
 * Semantic guard for the docs-sync / release procedure, which exists in three
 * independently-consumed copies: two local runner agents (agents/*.md, installed
 * by bin/install.mjs) and the CI prompt (templates/claude-workflow/prompts/
 * sync-docs-release.md, fetched standalone by consumer repos' Actions runs).
 * The copies cannot reference each other at run time, so drift is guarded here.
 * Checks shared semantics, not exact prose.
 *
 * Known, unguarded divergence: the CLAUDE.md size-cap numbers differ today
 * (CI prompt: condense over 40000 bytes back under 38000; local runner:
 * condense over 35000 back under 30000). Unify or document before guarding.
 */
const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const CI_PROMPT = 'templates/claude-workflow/prompts/sync-docs-release.md'
const SYNC_RUNNER = 'agents/sync-docs-runner.md'
const RELEASE_RUNNER = 'agents/create-release-runner.md'

const SYNC_COPIES = [CI_PROMPT, SYNC_RUNNER]
const RELEASE_COPIES = [CI_PROMPT, RELEASE_RUNNER]

const texts = Object.fromEntries(
  await Promise.all(
    [CI_PROMPT, SYNC_RUNNER, RELEASE_RUNNER].map(async (path) => [path, await read(path)]),
  ),
)

describe('sync-docs / release contract', () => {
  test('docs-sync copies find a docs-sync baseline and range from it', () => {
    for (const path of SYNC_COPIES) {
      const text = texts[path]
      expect(text, path).toMatch(/baseline/i)
      expect(text, path).toMatch(/baseline.?\.\.\.?HEAD|<last-sync-sha>\.\.HEAD/i)
    }
  })

  test('docs-sync copies state the bidirectional rule and its verification gate', () => {
    for (const path of SYNC_COPIES) {
      const text = texts[path]
      expect(text, path).toMatch(/bidirectional/i)
      expect(text, path).toMatch(/delete or correct|remove or correct/i)
      expect(text, path).toMatch(/never remove a claim you.{0,20}(have not|haven't) (confirmed|verified)/i)
    }
  })

  test('docs-sync copies forbid creating new top-level docs during a sync', () => {
    for (const path of SYNC_COPIES) {
      expect(texts[path], path).toMatch(
        /(must not create|never create) (either|one|a new top-level doc)/i,
      )
    }
  })

  test('release copies never force-overwrite an existing tag', () => {
    for (const path of RELEASE_COPIES) {
      expect(texts[path], path).toMatch(/(never|do not) force-overwrite/i)
    }
  })

  test('release copies use generated release notes and real tag inspection', () => {
    for (const path of RELEASE_COPIES) {
      const text = texts[path]
      expect(text, path).toMatch(/--generate-notes/)
      expect(text, path).toMatch(/git tag.{0,30}-v:refname/)
      expect(text, path).toMatch(/never rely on memory/i)
    }
  })

  test('CI prompt completes history and tags before any range analysis', () => {
    // CI checkouts are shallow; the local runners never need this.
    const text = texts[CI_PROMPT]
    expect(text).toMatch(/--unshallow/)
    expect(text).toMatch(/--tags/)
  })
})
