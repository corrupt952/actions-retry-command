/**
 * Unit tests for src/expression.ts
 */
import { evaluateExpression } from '../src/expression.js'

describe('evaluateExpression', () => {
  describe('basic arithmetic', () => {
    it('Evaluates a single integer', () => {
      expect(evaluateExpression('30')).toBe(30)
    })

    it('Evaluates zero', () => {
      expect(evaluateExpression('0')).toBe(0)
    })

    it('Evaluates addition', () => {
      expect(evaluateExpression('5 + 3')).toBe(8)
    })

    it('Evaluates subtraction', () => {
      expect(evaluateExpression('10 - 4')).toBe(6)
    })

    it('Evaluates multiplication', () => {
      expect(evaluateExpression('3 * 7')).toBe(21)
    })

    it('Evaluates division', () => {
      expect(evaluateExpression('20 / 4')).toBe(5)
    })

    it('Evaluates modulo', () => {
      expect(evaluateExpression('10 % 3')).toBe(1)
    })

    it('Evaluates exponentiation', () => {
      expect(evaluateExpression('2 ^ 10')).toBe(1024)
    })
  })

  describe('precedence', () => {
    it('Multiplication before addition', () => {
      expect(evaluateExpression('2 + 3 * 4')).toBe(14)
    })

    it('Parentheses override precedence', () => {
      expect(evaluateExpression('(2 + 3) * 4')).toBe(20)
    })

    it('Right-associative exponentiation', () => {
      expect(evaluateExpression('2 ^ 2 ^ 3')).toBe(256)
    })
  })

  describe('unary operators', () => {
    it('Unary minus', () => {
      expect(evaluateExpression('-5')).toBe(-5)
    })

    it('Unary minus with addition', () => {
      expect(evaluateExpression('-5 + 10')).toBe(5)
    })

    it('Unary minus with parentheses', () => {
      expect(evaluateExpression('-(3 + 2)')).toBe(-5)
    })

    it('Unary plus', () => {
      expect(evaluateExpression('+5')).toBe(5)
    })
  })

  describe('variables', () => {
    it('Resolves a single variable', () => {
      expect(evaluateExpression('attempt', { attempt: 3 })).toBe(3)
    })

    it('Uses variable in multiplication', () => {
      expect(evaluateExpression('attempt * 5', { attempt: 3 })).toBe(15)
    })

    it('Uses multiple variables', () => {
      expect(
        evaluateExpression('max_attempts - attempt', {
          attempt: 2,
          max_attempts: 5
        })
      ).toBe(3)
    })
  })

  describe('functions', () => {
    it('Evaluates min()', () => {
      expect(evaluateExpression('min(3, 7)')).toBe(3)
    })

    it('Evaluates max()', () => {
      expect(evaluateExpression('max(3, 7)')).toBe(7)
    })

    it('Evaluates floor()', () => {
      expect(evaluateExpression('floor(3.7)')).toBe(3)
    })

    it('Evaluates ceil()', () => {
      expect(evaluateExpression('ceil(3.2)')).toBe(4)
    })

    it('Evaluates zero-argument function call', () => {
      expect(() => evaluateExpression('min()')).not.toThrow()
    })

    it('Evaluates random(1) as 0', () => {
      expect(evaluateExpression('random(1)')).toBe(0)
    })

    it('Evaluates random(100) within range', () => {
      const result = evaluateExpression('random(100)')
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThan(100)
    })
  })

  describe('complex expressions', () => {
    it('Evaluates capped exponential backoff (small attempt)', () => {
      expect(evaluateExpression('min(2 ^ attempt, 60)', { attempt: 3 })).toBe(8)
    })

    it('Evaluates capped exponential backoff (large attempt)', () => {
      expect(evaluateExpression('min(2 ^ attempt, 60)', { attempt: 10 })).toBe(
        60
      )
    })
  })

  describe('whitespace handling', () => {
    it('Handles leading and trailing whitespace', () => {
      expect(evaluateExpression('  30  ')).toBe(30)
    })

    it('Handles whitespace around operators', () => {
      expect(evaluateExpression(' 2 + 3 ')).toBe(5)
    })

    it('Handles no whitespace', () => {
      expect(evaluateExpression('attempt*5', { attempt: 3 })).toBe(15)
    })
  })

  describe('error handling', () => {
    it('Throws on empty input', () => {
      expect(() => evaluateExpression('')).toThrow()
    })

    it('Throws on undefined variable', () => {
      expect(() => evaluateExpression('abc')).toThrow()
    })

    it('Throws on unknown function', () => {
      expect(() => evaluateExpression('foo(5)')).toThrow()
    })

    it('Throws on unclosed function call', () => {
      expect(() => evaluateExpression('min(3, 7')).toThrow("Expected ')'")
    })

    it('Throws on incomplete expression', () => {
      expect(() => evaluateExpression('2 +')).toThrow()
    })

    it('Throws on unclosed parenthesis', () => {
      expect(() => evaluateExpression('(2 + 3')).toThrow()
    })

    it('Throws on extra closing parenthesis', () => {
      expect(() => evaluateExpression('2 + 3)')).toThrow()
    })
  })

  describe('attack vectors', () => {
    it('Rejects process.exit(1)', () => {
      expect(() => evaluateExpression('process.exit(1)')).toThrow()
    })

    it("Rejects require('fs')", () => {
      expect(() => evaluateExpression("require('fs')")).toThrow()
    })

    it("Rejects eval('1+1')", () => {
      expect(() => evaluateExpression("eval('1+1')")).toThrow()
    })

    it("Rejects Function('return 1')()", () => {
      expect(() => evaluateExpression("Function('return 1')()")).toThrow()
    })

    it('Rejects __proto__', () => {
      expect(() => evaluateExpression('__proto__')).toThrow()
    })

    it('Rejects constructor', () => {
      expect(() => evaluateExpression('constructor')).toThrow()
    })

    it('Rejects this', () => {
      expect(() => evaluateExpression('this')).toThrow()
    })

    it('Rejects globalThis', () => {
      expect(() => evaluateExpression('globalThis')).toThrow()
    })

    it("Rejects import('fs')", () => {
      expect(() => evaluateExpression("import('fs')")).toThrow()
    })
  })

  describe('division edge cases', () => {
    it('Division by zero returns Infinity', () => {
      expect(evaluateExpression('1 / 0')).toBe(Infinity)
    })

    it('Zero divided by zero returns NaN', () => {
      expect(evaluateExpression('0 / 0')).toBeNaN()
    })
  })

  describe('floating point', () => {
    it('Evaluates float addition', () => {
      expect(evaluateExpression('0.5 + 0.5')).toBe(1)
    })

    it('Evaluates a float literal', () => {
      expect(evaluateExpression('3.14')).toBe(3.14)
    })
  })
})
