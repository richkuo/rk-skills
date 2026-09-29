import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const emoji = /[\p{Extended_Pictographic}\u{FE0F}]/gu

function descriptionSource(lines) {
  const index = lines.findIndex((line) => line.startsWith('description:'))
  if (index === -1) return null
  const value = lines[index].slice('description:'.length).trim()
  if (value !== '>-') return { style: 'plain', text: value }
  const body = []
  for (const line of lines.slice(index + 1)) {
    if (!/^\s/.test(line)) break
    body.push(line.trim())
  }
  return { style: 'folded', text: body.join(' ') }
}

function checkSkill(name) {
  const path = `skills/${name}/SKILL.md`
  const source = readFileSync(`${root}${path}`, 'utf8')
  const match = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  if (!match) return [`${path}: no frontmatter block delimited by --- lines`]
  let data
  try {
    data = Bun.YAML.parse(match[1])
  } catch (error) {
    return [`${path}: frontmatter is not valid YAML (${error.message})`]
  }
  if (!data || typeof data !== 'object') return [`${path}: frontmatter is not a YAML mapping`]
  const failures = []
  if (data.name !== name) failures.push(`${path}: name ${JSON.stringify(data.name)} does not equal the directory name ${JSON.stringify(name)}`)
  if (typeof data.description !== 'string' || !data.description.trim()) {
    failures.push(`${path}: description is not a non-empty string`)
    return failures
  }
  const expected = descriptionSource(match[1].split('\n'))
  if (!expected) failures.push(`${path}: description is not a top-level key`)
  else if (/^["'|>]/.test(expected.text) && expected.style === 'plain') failures.push(`${path}: description must be a plain scalar or a >- block`)
  else if (data.description !== expected.text) failures.push(`${path}: parsed description (${data.description.length} chars) does not equal its source text (${expected.text.length} chars)`)
  return failures
}

function checkEmoji() {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const failures = []
  for (const file of files) {
    const path = `${root}${file}`
    if (!existsSync(path)) continue
    const buffer = readFileSync(path)
    if (buffer.includes(0)) continue
    buffer.toString('utf8').split('\n').forEach((line, index) => {
      for (const [char] of line.matchAll(emoji)) {
        const code = char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
        failures.push(`${file}:${index + 1}: emoji or pictographic symbol U+${code}`)
      }
    })
  }
  return failures
}

if (typeof Bun === 'undefined') {
  console.error('Usage: bun bin/check-skills.mjs')
  process.exit(2)
}

const skills = []
const folderFailures = []
for (const name of readdirSync(`${root}skills`).sort()) {
  let stats
  try {
    stats = statSync(`${root}skills/${name}`)
  } catch (error) {
    folderFailures.push(`skills/${name}: cannot be read (${error.message})`)
    continue
  }
  if (!stats.isDirectory()) continue
  if (readdirSync(`${root}skills/${name}`).includes('SKILL.md')) skills.push(name)
  else folderFailures.push(`skills/${name}: skill folder has no SKILL.md`)
}
const failures = [...folderFailures, ...skills.flatMap(checkSkill), ...checkEmoji()]
if (!failures.length) {
  console.log(`All ${skills.length} skill frontmatter blocks are valid, and no tracked text file has an emoji.`)
} else {
  console.log(`Skill check failures:\n${failures.join('\n')}`)
  process.exit(1)
}
