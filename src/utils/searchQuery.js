// Search query language for the activity filter.
//   corrida AND (!matinal OR vesperina)      words, AND / OR / NOT, parentheses
//   "treino longo" -chuva                    "quoted phrase", ! or - to exclude
//   tag:prova tipo:corrida equip:salomon     field:term (nome, desc, tipo, tag, equip)
// Adjacent terms mean AND. AND/OR/NOT also as E/OU/NAO and & | . Case and accents are ignored.
// A term matches when it is contained in the text ("contains").

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const FIELDS = {
  nome: 'name', name: 'name', titulo: 'name',
  desc: 'desc', descricao: 'desc', description: 'desc',
  tipo: 'type', type: 'type',
  tag: 'tag', tags: 'tag', etiqueta: 'tag',
  equip: 'gear', equipamento: 'gear', gear: 'gear',
}
const AND_W = new Set(['and', 'e', '&', '&&'])
const OR_W = new Set(['or', 'ou', '|', '||'])
const NOT_W = new Set(['not', 'nao'])

function tokenize(src) {
  const out = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '(' || c === ')') { out.push({ k: c }); i++; continue }
    if (c === '!' || (c === '-' && (i === 0 || /[\s(]/.test(src[i - 1])))) { out.push({ k: 'not' }); i++; continue }
    if (c === '|' || c === '&') { const d = src[i + 1] === c ? 2 : 1; out.push({ k: c === '|' ? 'or' : 'and' }); i += d; continue }
    let field = null, text = ''
    // optional field prefix
    const m = /^([a-zA-ZÀ-ÿ]+):/.exec(src.slice(i))
    if (m && FIELDS[norm(m[1])]) { field = FIELDS[norm(m[1])]; i += m[0].length }
    if (src[i] === '"') {
      const j = src.indexOf('"', i + 1)
      text = src.slice(i + 1, j < 0 ? src.length : j); i = j < 0 ? src.length : j + 1
    } else {
      let j = i
      while (j < src.length && !/[\s()]/.test(src[j])) j++
      text = src.slice(i, j); i = j
    }
    const w = norm(text)
    if (!field && AND_W.has(w)) out.push({ k: 'and' })
    else if (!field && OR_W.has(w)) out.push({ k: 'or' })
    else if (!field && NOT_W.has(w)) out.push({ k: 'not' })
    else if (w) out.push({ k: 'term', field, text: w })
  }
  return out
}

// Returns a predicate (doc) => boolean, or null for an empty query.
// doc = { name, desc, type, tag: [..], gear } (any may be missing)
export function compileSearch(src) {
  const toks = tokenize(String(src || ''))
  if (!toks.length) return null
  let p = 0
  const peek = () => toks[p]
  function parseOr() {
    const parts = [parseAnd()]
    while (peek()?.k === 'or') { p++; parts.push(parseAnd()) }
    return parts.length === 1 ? parts[0] : (d) => parts.some((f) => f(d))
  }
  function parseAnd() {
    const parts = [parseNot()]
    while (p < toks.length && peek().k !== 'or' && peek().k !== ')') {
      if (peek().k === 'and') p++
      parts.push(parseNot())
    }
    return parts.length === 1 ? parts[0] : (d) => parts.every((f) => f(d))
  }
  function parseNot() {
    const t = peek()
    if (!t) return () => true
    if (t.k === 'not') { p++; if (p >= toks.length) return () => true; const f = parseNot(); return (d) => !f(d) }
    return parseAtom()
  }
  function parseAtom() {
    const t = toks[p++]
    if (!t) return () => true
    if (t.k === '(') {
      const f = parseOr()
      if (peek()?.k === ')') p++
      return f
    }
    if (t.k === 'term') {
      const { field, text } = t
      return (d) => {
        const hay = field ? d[field] : [d.name, d.desc, d.type, d.gear, ...(d.tag || [])]
        return (Array.isArray(hay) ? hay : [hay]).some((h) => norm(h).includes(text))
      }
    }
    return () => true // stray operator / ')': ignore
  }
  let f = parseOr()
  while (p < toks.length) { p++; const g = f, h = parseOr(); f = (d) => g(d) && h(d) } // leftovers after a stray ')'
  return f
}
