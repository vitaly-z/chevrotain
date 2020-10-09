import { RegExpParser, RegExpPattern } from "regexp-to-ast"
import { parseRegExpLiteral, AST } from "regexpp"
import { forEach, isArray } from "../utils/utils"

// We are expending the regexpp model with additional information
// to ease our calculations.
declare module "regexpp/ast" {
  export interface CharacterClass extends NodeBase {
    codePoints: (CodePointRange | number)[]
  }

  export interface AnyCharacterSet extends NodeBase {
    codePoints: (CodePointRange | number)[]
  }
}
export type CodePointRange = { from: number; to: number }

let regExpAstCache = {}
// TODO: modify to use regexp P here
const regExpParser = new RegExpParser()

const regExpAstCacheNew: Record<string, AST.RegExpLiteral> = {}

export function getRegExpAst(regExp: RegExp): RegExpPattern {
  const regExpStr = regExp.toString()
  if (regExpAstCache.hasOwnProperty(regExpStr)) {
    return regExpAstCache[regExpStr]
  } else {
    const regExpAst = regExpParser.pattern(regExpStr)
    regExpAstCache[regExpStr] = regExpAst
    return regExpAst
  }
}

export function getRegExpAstNew(regExp: RegExp): AST.RegExpLiteral {
  const regExpStr = regExp.toString()
  if (regExpAstCacheNew.hasOwnProperty(regExpStr)) {
    return regExpAstCacheNew[regExpStr]
  } else {
    const regExpAst = parseRegExpLiteral(regExpStr)
    // TODO: agument the regExpHere
    regExpAstCacheNew[regExpStr] = regExpAst
    return regExpAst
  }
}

export function clearRegExpParserCache() {
  regExpAstCache = {}
}

export class SemanticRegExpVisitor {
  /**
   * Visit a given node and descendant nodes.
   * @param node The root node to visit tree.
   */
  public visit(node: AST.Node): void {
    switch (node.type) {
      case "Alternative":
        this.visitAlternative(node)
        break
      case "Assertion":
        this.visitAssertion(node)
        break
      case "Backreference":
        this.visitBackreference(node)
        break
      case "CapturingGroup":
        this.visitCapturingGroup(node)
        break
      // In this visitor a `Character` would only be "visited" when it is "standalone"
      // meaning when it not inside a `CharacterClass` /[a-z]/ or lookahead / lookbehind
      case "Character":
        this.visitCharacter(node)
        break
      case "CharacterClass":
        this.visitCharacterClass(node)
        // avoid visiting a a `CharacterClass`'s sub-children
        // as we are only interested in their semantic meaning (CodePoints)
        // not the syntactic structure, and we will expand the regexpp AST
        // to hold all the relevant semantic information directly on the `CharacterClass`
        return
      case "CharacterClassRange":
        return
      case "CharacterSet":
        // Same as the above comment for `CharacterClass`
        this.visitCharacterSet(node)
        return
      case "Flags":
        this.visitFlags(node)
        break
      case "Group":
        this.visitGroup(node)
        break
      case "Pattern":
        this.visitPattern(node)
        break
      case "Quantifier":
        this.visitQuantifier(node)
        break
      case "RegExpLiteral":
        this.visitRegExpLiteral(node)
        break
      default:
        throw new Error(`Unknown type: ${(node as any).type}`)
    }

    // TODO: consider transforming the AST for semantic codePoints info
    //  and avoiding traversing characterClass
    const astChildren = getAstChildrenReflective(node)
    forEach(astChildren, (childNode) => this.visit(childNode))
  }

  protected visitAlternative(node: AST.Alternative): void {}

  protected visitAssertion(node: AST.Assertion): void {}

  protected visitBackreference(node: AST.Backreference): void {}

  protected visitCapturingGroup(node: AST.CapturingGroup): void {}

  protected visitCharacter(node: AST.Character): void {}

  protected visitCharacterClass(node: AST.CharacterClass): void {}

  protected visitCharacterSet(node: AST.CharacterSet): void {}

  protected visitFlags(node: AST.Flags): void {}

  protected visitGroup(node: AST.Group): void {}

  protected visitPattern(node: AST.Pattern): void {}

  protected visitQuantifier(node: AST.Quantifier): void {}

  protected visitRegExpLiteral(node: AST.RegExpLiteral): void {}
}

function getAstChildrenReflective(astParent) {
  let astChildren = []

  const propKeys = Object.keys(astParent)
  propKeys.forEach((key) => {
    const prop = astParent[key]
    if (name === "parent") {
      // parent property is never a child...
    } else if (prop["type"] !== undefined) {
      astChildren.push(prop)
    } else if (isArray(prop) && prop.length > 0 && prop["type"] !== undefined) {
      astChildren = astChildren.concat(prop)
    }
  })

  return astChildren
}

export function isNegated() {}
