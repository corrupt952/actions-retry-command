type Vars = Record<string, number>

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  random: (n) => Math.floor(Math.random() * n),
  min: (a, b) => Math.min(a, b),
  max: (a, b) => Math.max(a, b),
  floor: (n) => Math.floor(n),
  ceil: (n) => Math.ceil(n)
}

export function evaluateExpression(input: string, vars: Vars = {}): number {
  let pos = 0
  function peek(): string {
    while (pos < input.length && /\s/.test(input[pos])) pos++
    return input[pos] || ''
  }
  function advance(): string {
    return input[pos++]
  }
  function match(ch: string): boolean {
    if (peek() === ch) {
      pos++
      return true
    }
    return false
  }
  function parseExpr(): number {
    let left = parseTerm()
    while (true) {
      if (match('+')) left = left + parseTerm()
      else if (match('-')) left = left - parseTerm()
      else break
    }
    return left
  }
  function parseTerm(): number {
    let left = parsePower()
    while (true) {
      if (match('*')) left = left * parsePower()
      else if (match('/')) left = left / parsePower()
      else if (match('%')) left = left % parsePower()
      else break
    }
    return left
  }
  function parsePower(): number {
    const base = parseUnary()
    if (match('^')) return Math.pow(base, parsePower())
    return base
  }
  function parseUnary(): number {
    if (match('-')) return -parsePrimary()
    if (match('+')) return +parsePrimary()
    return parsePrimary()
  }
  function parsePrimary(): number {
    if (/[0-9.]/.test(peek())) {
      let num = ''
      while (pos < input.length && /[0-9.]/.test(input[pos])) num += advance()
      return parseFloat(num)
    }
    if (/[a-zA-Z_]/.test(peek())) {
      let name = ''
      while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos]))
        name += advance()
      if (peek() === '(') {
        advance()
        const args: number[] = []
        if (peek() !== ')') {
          args.push(parseExpr())
          while (match(',')) args.push(parseExpr())
        }
        if (!match(')')) throw new Error("Expected ')'")
        const fn = FUNCTIONS[name]
        if (!fn) throw new Error(`Unknown function: ${name}`)
        return fn(...args)
      }
      if (!Object.hasOwn(vars, name))
        throw new Error(`Undefined variable: ${name}`)
      return vars[name]
    }
    if (match('(')) {
      const val = parseExpr()
      if (!match(')')) throw new Error("Expected ')'")
      return val
    }
    throw new Error(`Unexpected '${peek()}' at position ${pos}`)
  }
  const result = parseExpr()
  if (pos < input.length && /\S/.test(input.slice(pos))) {
    throw new Error(`Unexpected '${input[pos]}' at position ${pos}`)
  }
  return result
}
