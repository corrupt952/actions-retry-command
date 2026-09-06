/**
 * Unit tests for src/expression.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateExpression } from '../src/expression.ts'

describe('evaluateExpression', () => {
  describe('basic arithmetic', () => {
    it('Evaluates a single integer', () => {
      assert.equal(evaluateExpression('30'), 30)
    })

    it('Evaluates zero', () => {
      assert.equal(evaluateExpression('0'), 0)
    })

    it('Evaluates addition', () => {
      assert.equal(evaluateExpression('5 + 3'), 8)
    })

    it('Evaluates subtraction', () => {
      assert.equal(evaluateExpression('10 - 4'), 6)
    })

    it('Evaluates multiplication', () => {
      assert.equal(evaluateExpression('3 * 7'), 21)
    })

    it('Evaluates division', () => {
      assert.equal(evaluateExpression('20 / 4'), 5)
    })

    it('Evaluates modulo', () => {
      assert.equal(evaluateExpression('10 % 3'), 1)
    })

    it('Evaluates exponentiation', () => {
      assert.equal(evaluateExpression('2 ^ 10'), 1024)
    })
  })

  describe('precedence', () => {
    it('Multiplication before addition', () => {
      assert.equal(evaluateExpression('2 + 3 * 4'), 14)
    })

    it('Parentheses override precedence', () => {
      assert.equal(evaluateExpression('(2 + 3) * 4'), 20)
    })

    it('Right-associative exponentiation', () => {
      assert.equal(evaluateExpression('2 ^ 2 ^ 3'), 256)
    })
  })

  describe('unary operators', () => {
    it('Unary minus', () => {
      assert.equal(evaluateExpression('-5'), -5)
    })

    it('Unary minus with addition', () => {
      assert.equal(evaluateExpression('-5 + 10'), 5)
    })

    it('Unary minus with parentheses', () => {
      assert.equal(evaluateExpression('-(3 + 2)'), -5)
    })

    it('Unary plus', () => {
      assert.equal(evaluateExpression('+5'), 5)
    })
  })

  describe('variables', () => {
    it('Resolves a single variable', () => {
      assert.equal(evaluateExpression('attempt', { attempt: 3 }), 3)
    })

    it('Uses variable in multiplication', () => {
      assert.equal(evaluateExpression('attempt * 5', { attempt: 3 }), 15)
    })

    it('Uses multiple variables', () => {
      assert.equal(
        evaluateExpression('max_attempts - attempt', {
          attempt: 2,
          max_attempts: 5
        }),
        3
      )
    })
  })

  describe('functions', () => {
    it('Evaluates min()', () => {
      assert.equal(evaluateExpression('min(3, 7)'), 3)
    })

    it('Evaluates max()', () => {
      assert.equal(evaluateExpression('max(3, 7)'), 7)
    })

    it('Evaluates floor()', () => {
      assert.equal(evaluateExpression('floor(3.7)'), 3)
    })

    it('Evaluates ceil()', () => {
      assert.equal(evaluateExpression('ceil(3.2)'), 4)
    })

    it('Evaluates zero-argument function call', () => {
      assert.doesNotThrow(() => evaluateExpression('min()'))
    })

    it('Evaluates random(1) as 0', () => {
      assert.equal(evaluateExpression('random(1)'), 0)
    })

    it('Evaluates random(100) within range', () => {
      const result = evaluateExpression('random(100)')
      assert.ok(result >= 0)
      assert.ok(result < 100)
    })
  })

  describe('complex expressions', () => {
    it('Evaluates capped exponential backoff (small attempt)', () => {
      assert.equal(
        evaluateExpression('min(2 ^ attempt, 60)', { attempt: 3 }),
        8
      )
    })

    it('Evaluates capped exponential backoff (large attempt)', () => {
      assert.equal(
        evaluateExpression('min(2 ^ attempt, 60)', { attempt: 10 }),
        60
      )
    })
  })

  describe('whitespace handling', () => {
    it('Handles leading and trailing whitespace', () => {
      assert.equal(evaluateExpression('  30  '), 30)
    })

    it('Handles whitespace around operators', () => {
      assert.equal(evaluateExpression(' 2 + 3 '), 5)
    })

    it('Handles no whitespace', () => {
      assert.equal(evaluateExpression('attempt*5', { attempt: 3 }), 15)
    })
  })

  describe('error handling', () => {
    it('Throws on empty input', () => {
      assert.throws(() => evaluateExpression(''))
    })

    it('Throws on undefined variable', () => {
      assert.throws(() => evaluateExpression('abc'), /Undefined variable/)
    })

    it('Throws on unknown function', () => {
      assert.throws(() => evaluateExpression('foo(5)'), /Unknown function/)
    })

    it('Throws on unclosed function call', () => {
      assert.throws(() => evaluateExpression('min(3, 7'), /Expected '\)'/)
    })

    it('Throws on incomplete expression', () => {
      assert.throws(() => evaluateExpression('2 +'))
    })

    it('Throws on unclosed parenthesis', () => {
      assert.throws(() => evaluateExpression('(2 + 3'))
    })

    it('Throws on extra closing parenthesis', () => {
      assert.throws(() => evaluateExpression('2 + 3)'))
    })
  })

  describe('attack vectors', () => {
    const rejected = [
      'process.exit(1)',
      "require('fs')",
      "eval('1+1')",
      "Function('return 1')()",
      '__proto__',
      'constructor',
      'this',
      'globalThis',
      "import('fs')"
    ]

    for (const input of rejected) {
      it(`Rejects ${input}`, () => {
        assert.throws(() => evaluateExpression(input))
      })
    }
  })

  describe('division edge cases', () => {
    it('Division by zero returns Infinity', () => {
      assert.equal(evaluateExpression('1 / 0'), Infinity)
    })

    it('Zero divided by zero returns NaN', () => {
      assert.ok(Number.isNaN(evaluateExpression('0 / 0')))
    })
  })

  describe('floating point', () => {
    it('Evaluates float addition', () => {
      assert.equal(evaluateExpression('0.5 + 0.5'), 1)
    })

    it('Evaluates a float literal', () => {
      assert.equal(evaluateExpression('3.14'), 3.14)
    })
  })
})
