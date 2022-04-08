import first from "lodash/first"
import isEmpty from "lodash/isEmpty"
import drop from "lodash/drop"
import flatten from "lodash/flatten"
import difference from "lodash/difference"
import map from "lodash/map"
import forEach from "lodash/forEach"
import groupBy from "lodash/groupBy"
import reduce from "lodash/reduce"
import pickBy from "lodash/pickBy"
import values from "lodash/values"
import includes from "lodash/includes"
import flatMap from "lodash/flatMap"
import clone from "lodash/clone"
import {
  IParserDuplicatesDefinitionError,
  ParserDefinitionErrorType
} from "../parser/parser"
import { getProductionDslName, isOptionalProd } from "@chevrotain/gast"
import { getLookaheadPathsForOptionalProd, getProdType } from "./lookahead"
import {
  Alternation,
  Alternative as AlternativeGAST,
  NonTerminal,
  Option,
  Repetition,
  RepetitionMandatory,
  RepetitionMandatoryWithSeparator,
  RepetitionWithSeparator,
  Rule,
  Terminal
} from "@chevrotain/gast"
import { GAstVisitor } from "@chevrotain/gast"
import {
  IProduction,
  IProductionWithOccurrence,
  TokenType
} from "@chevrotain/types"
import {
  IGrammarValidatorErrorMessageProvider,
  IParserDefinitionError
} from "./types"

export function validateGrammar(
  topLevels: Rule[],
  tokenTypes: TokenType[],
  errMsgProvider: IGrammarValidatorErrorMessageProvider,
  grammarName: string
): IParserDefinitionError[] {
  const duplicateErrors = flatMap(topLevels, (currTopLevel) =>
    validateDuplicateProductions(currTopLevel, errMsgProvider)
  )
  const leftRecursionErrors = flatMap(topLevels, (currTopRule) =>
    validateNoLeftRecursion(currTopRule, currTopRule, errMsgProvider)
  )

  let emptyRepetitionErrors: IParserDefinitionError[] = []

  // left recursion could cause infinite loops in the following validations.
  // It is safest to first have the user fix the left recursion errors first and only then examine Further issues.
  if (isEmpty(leftRecursionErrors)) {
    emptyRepetitionErrors = validateSomeNonEmptyLookaheadPath(
      topLevels,
      errMsgProvider
    )
  }

  const termsNamespaceConflictErrors = checkTerminalAndNoneTerminalsNameSpace(
    topLevels,
    tokenTypes,
    errMsgProvider
  )

  const tooManyAltsErrors = flatMap(topLevels, (curRule) =>
    validateTooManyAlts(curRule, errMsgProvider)
  )

  const duplicateRulesError = flatMap(topLevels, (curRule) =>
    validateRuleDoesNotAlreadyExist(
      curRule,
      topLevels,
      grammarName,
      errMsgProvider
    )
  )

  return (duplicateErrors as IParserDefinitionError[]).concat(
    emptyRepetitionErrors,
    leftRecursionErrors,
    termsNamespaceConflictErrors,
    tooManyAltsErrors,
    duplicateRulesError
  )
}

function validateDuplicateProductions(
  topLevelRule: Rule,
  errMsgProvider: IGrammarValidatorErrorMessageProvider
): IParserDuplicatesDefinitionError[] {
  const collectorVisitor = new OccurrenceValidationCollector()
  topLevelRule.accept(collectorVisitor)
  const allRuleProductions = collectorVisitor.allProductions

  const productionGroups = groupBy(
    allRuleProductions,
    identifyProductionForDuplicates
  )

  const duplicates: any = pickBy(productionGroups, (currGroup) => {
    return currGroup.length > 1
  })

  const errors = map(values(duplicates), (currDuplicates: any) => {
    const firstProd: any = first(currDuplicates)
    const msg = errMsgProvider.buildDuplicateFoundError(
      topLevelRule,
      currDuplicates
    )
    const dslName = getProductionDslName(firstProd)
    const defError: IParserDuplicatesDefinitionError = {
      message: msg,
      type: ParserDefinitionErrorType.DUPLICATE_PRODUCTIONS,
      ruleName: topLevelRule.name,
      dslName: dslName,
      occurrence: firstProd.idx
    }

    const param = getExtraProductionArgument(firstProd)
    if (param) {
      defError.parameter = param
    }

    return defError
  })
  return errors
}

export function identifyProductionForDuplicates(
  prod: IProductionWithOccurrence
): string {
  return `${getProductionDslName(prod)}_#_${
    prod.idx
  }_#_${getExtraProductionArgument(prod)}`
}

function getExtraProductionArgument(prod: IProductionWithOccurrence): string {
  if (prod instanceof Terminal) {
    return prod.terminalType.name
  } else if (prod instanceof NonTerminal) {
    return prod.nonTerminalName
  } else {
    return ""
  }
}

export class OccurrenceValidationCollector extends GAstVisitor {
  public allProductions: IProductionWithOccurrence[] = []

  public visitNonTerminal(subrule: NonTerminal): void {
    this.allProductions.push(subrule)
  }

  public visitOption(option: Option): void {
    this.allProductions.push(option)
  }

  public visitRepetitionWithSeparator(manySep: RepetitionWithSeparator): void {
    this.allProductions.push(manySep)
  }

  public visitRepetitionMandatory(atLeastOne: RepetitionMandatory): void {
    this.allProductions.push(atLeastOne)
  }

  public visitRepetitionMandatoryWithSeparator(
    atLeastOneSep: RepetitionMandatoryWithSeparator
  ): void {
    this.allProductions.push(atLeastOneSep)
  }

  public visitRepetition(many: Repetition): void {
    this.allProductions.push(many)
  }

  public visitAlternation(or: Alternation): void {
    this.allProductions.push(or)
  }

  public visitTerminal(terminal: Terminal): void {
    this.allProductions.push(terminal)
  }
}

export function validateRuleDoesNotAlreadyExist(
  rule: Rule,
  allRules: Rule[],
  className: string,
  errMsgProvider: IGrammarValidatorErrorMessageProvider
): IParserDefinitionError[] {
  const errors = []
  const occurrences = reduce(
    allRules,
    (result, curRule) => {
      if (curRule.name === rule.name) {
        return result + 1
      }
      return result
    },
    0
  )
  if (occurrences > 1) {
    const errMsg = errMsgProvider.buildDuplicateRuleNameError({
      topLevelRule: rule,
      grammarName: className
    })
    errors.push({
      message: errMsg,
      type: ParserDefinitionErrorType.DUPLICATE_RULE_NAME,
      ruleName: rule.name
    })
  }

  return errors
}

// TODO: is there anyway to get only the rule names of rules inherited from the super grammars?
// This is not part of the IGrammarErrorProvider because the validation cannot be performed on
// The grammar structure, only at runtime.
export function validateRuleIsOverridden(
  ruleName: string,
  definedRulesNames: string[],
  className: string
): IParserDefinitionError[] {
  const errors = []
  let errMsg

  if (!includes(definedRulesNames, ruleName)) {
    errMsg =
      `Invalid rule override, rule: ->${ruleName}<- cannot be overridden in the grammar: ->${className}<-` +
      `as it is not defined in any of the super grammars `
    errors.push({
      message: errMsg,
      type: ParserDefinitionErrorType.INVALID_RULE_OVERRIDE,
      ruleName: ruleName
    })
  }

  return errors
}

export function validateNoLeftRecursion(
  topRule: Rule,
  currRule: Rule,
  errMsgProvider: IGrammarValidatorErrorMessageProvider,
  path: Rule[] = []
): IParserDefinitionError[] {
  const errors: IParserDefinitionError[] = []
  const nextNonTerminals = getFirstNoneTerminal(currRule.definition)
  if (isEmpty(nextNonTerminals)) {
    return []
  } else {
    const ruleName = topRule.name
    const foundLeftRecursion = includes(<any>nextNonTerminals, topRule)
    if (foundLeftRecursion) {
      errors.push({
        message: errMsgProvider.buildLeftRecursionError({
          topLevelRule: topRule,
          leftRecursionPath: path
        }),
        type: ParserDefinitionErrorType.LEFT_RECURSION,
        ruleName: ruleName
      })
    }

    // we are only looking for cyclic paths leading back to the specific topRule
    // other cyclic paths are ignored, we still need this difference to avoid infinite loops...
    const validNextSteps = difference(nextNonTerminals, path.concat([topRule]))
    const errorsFromNextSteps = flatMap(validNextSteps, (currRefRule) => {
      const newPath = clone(path)
      newPath.push(currRefRule)
      return validateNoLeftRecursion(
        topRule,
        currRefRule,
        errMsgProvider,
        newPath
      )
    })

    return errors.concat(errorsFromNextSteps)
  }
}

export function getFirstNoneTerminal(definition: IProduction[]): Rule[] {
  let result: Rule[] = []
  if (isEmpty(definition)) {
    return result
  }
  const firstProd = first(definition)

  /* istanbul ignore else */
  if (firstProd instanceof NonTerminal) {
    result.push(firstProd.referencedRule)
  } else if (
    firstProd instanceof AlternativeGAST ||
    firstProd instanceof Option ||
    firstProd instanceof RepetitionMandatory ||
    firstProd instanceof RepetitionMandatoryWithSeparator ||
    firstProd instanceof RepetitionWithSeparator ||
    firstProd instanceof Repetition
  ) {
    result = result.concat(
      getFirstNoneTerminal(<IProduction[]>firstProd.definition)
    )
  } else if (firstProd instanceof Alternation) {
    // each sub definition in alternation is a FLAT
    result = flatten(
      map(firstProd.definition, (currSubDef) =>
        getFirstNoneTerminal((<AlternativeGAST>currSubDef).definition)
      )
    )
  } else if (firstProd instanceof Terminal) {
    // nothing to see, move along
  } else {
    throw Error("non exhaustive match")
  }

  const isFirstOptional = isOptionalProd(firstProd)
  const hasMore = definition.length > 1
  if (isFirstOptional && hasMore) {
    const rest = drop(definition)
    return result.concat(getFirstNoneTerminal(rest))
  } else {
    return result
  }
}

class OrCollector extends GAstVisitor {
  public alternations: Alternation[] = []

  public visitAlternation(node: Alternation): void {
    this.alternations.push(node)
  }
}

export class RepetitionCollector extends GAstVisitor {
  public allProductions: IProductionWithOccurrence[] = []

  public visitRepetitionWithSeparator(manySep: RepetitionWithSeparator): void {
    this.allProductions.push(manySep)
  }

  public visitRepetitionMandatory(atLeastOne: RepetitionMandatory): void {
    this.allProductions.push(atLeastOne)
  }

  public visitRepetitionMandatoryWithSeparator(
    atLeastOneSep: RepetitionMandatoryWithSeparator
  ): void {
    this.allProductions.push(atLeastOneSep)
  }

  public visitRepetition(many: Repetition): void {
    this.allProductions.push(many)
  }
}

export function validateTooManyAlts(
  topLevelRule: Rule,
  errMsgProvider: IGrammarValidatorErrorMessageProvider
): IParserDefinitionError[] {
  const orCollector = new OrCollector()
  topLevelRule.accept(orCollector)
  const ors = orCollector.alternations

  const errors = flatMap(ors, (currOr) => {
    if (currOr.definition.length > 255) {
      return [
        {
          message: errMsgProvider.buildTooManyAlternativesError({
            topLevelRule: topLevelRule,
            alternation: currOr
          }),
          type: ParserDefinitionErrorType.TOO_MANY_ALTS,
          ruleName: topLevelRule.name,
          occurrence: currOr.idx
        }
      ]
    } else {
      return []
    }
  })

  return errors
}

export function validateSomeNonEmptyLookaheadPath(
  topLevelRules: Rule[],
  errMsgProvider: IGrammarValidatorErrorMessageProvider
): IParserDefinitionError[] {
  const errors: IParserDefinitionError[] = []
  forEach(topLevelRules, (currTopRule) => {
    const collectorVisitor = new RepetitionCollector()
    currTopRule.accept(collectorVisitor)
    const allRuleProductions = collectorVisitor.allProductions
    forEach(allRuleProductions, (currProd) => {
      const prodType = getProdType(currProd)
      const currOccurrence = currProd.idx
      const paths = getLookaheadPathsForOptionalProd(
        currOccurrence,
        currTopRule,
        prodType,
        1
      )
      const pathsInsideProduction = paths[0]
      if (isEmpty(flatten(pathsInsideProduction))) {
        const errMsg = errMsgProvider.buildEmptyRepetitionError({
          topLevelRule: currTopRule,
          repetition: currProd
        })
        errors.push({
          message: errMsg,
          type: ParserDefinitionErrorType.NO_NON_EMPTY_LOOKAHEAD,
          ruleName: currTopRule.name
        })
      }
    })
  })

  return errors
}

function checkTerminalAndNoneTerminalsNameSpace(
  topLevels: Rule[],
  tokenTypes: TokenType[],
  errMsgProvider: IGrammarValidatorErrorMessageProvider
): IParserDefinitionError[] {
  const errors: IParserDefinitionError[] = []

  const tokenNames = map(tokenTypes, (currToken) => currToken.name)

  forEach(topLevels, (currRule) => {
    const currRuleName = currRule.name
    if (includes(tokenNames, currRuleName)) {
      const errMsg = errMsgProvider.buildNamespaceConflictError(currRule)

      errors.push({
        message: errMsg,
        type: ParserDefinitionErrorType.CONFLICT_TOKENS_RULES_NAMESPACE,
        ruleName: currRuleName
      })
    }
  })

  return errors
}
