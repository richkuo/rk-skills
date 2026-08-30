export function workflowConstant(source, name) {
  const start = source.indexOf(`const ${name} = `)
  if (start < 0) throw new Error(`${name} is not declared in the workflow`)
  const open = start + `const ${name} = `.length
  const opener = source[open]
  const closer = opener === '[' ? ']' : opener === '{' ? '}' : null
  if (!closer) throw new Error(`${name} is not an array or object literal`)
  let depth = 0
  let quote = null
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '\'' || ch === '"' || ch === '`') quote = ch
    else if (ch === '[' || ch === '{') depth += 1
    else if (ch === ']' || ch === '}') {
      depth -= 1
      if (depth === 0) return new Function(`return ${source.slice(open, i + 1)}`)()
    }
  }
  throw new Error(`${name} literal is unterminated`)
}
