const chevrotain = require("chevrotain")
const assert = require("assert")

const lexer = new chevrotain.Lexer(
  [
    chevrotain.createToken({
      name: "Letter",
      pattern: /\p{L}/u
    })
  ],
  { ensureOptimizations: false }
)

const result = lexer.tokenize("a")
assert(result.errors.length === 0)
