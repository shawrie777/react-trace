import { Node, Statement, Identifier, BindingElement } from "ts-morph";
import { isTerminalValue, getNodeId, nodesReferToSameSymbol } from "../nodeUtils";
import { TraceTarget, ScanResult } from "./types";
import { findIdentifierDefinitions } from "./identifiers";
import { extractObjectRestFromExpression, extractObjectRestFromTarget, extractPropertyFromTarget, findPropertyAccessSources, findPropertySourcesForExpression, findReactPropArguments, findReactRestPropArguments, getBindingElementPropertyName, getObjectRestOmittedNames } from "./props";
import { findElementAccessSources } from "./elementAccess";
import { findCallReturnValues, findMutationCallTargets } from "./callExpressions";
import { findReturnedValueSources, findExpressionSources } from "./returns";
import { findParameterArguments } from "./parameters";
import { findArrayBindingElementSources } from "./array";
import { bindingElementHasRestToken, bindingElementMatchesIdentifier, dedupeNodes, dedupeTargets, emptyScanResult, isIdentifierWrite, statementAlwaysTerminates, toTarget, withInitializerFallback } from "./utils";
import { getContainingOuterStatement, getSiblingStatements } from "./relatedNodes";

export function findDefinitions(target: TraceTarget): TraceTarget[] {
  const { node } = target;

  if (isTerminalValue(node)) return [];
  if (Node.isIdentifier(node)) return findIdentifierDefinitions(node, target.bindings);
  if (Node.isPropertyAccessExpression(node)) return findPropertyAccessSources(node, target.bindings);
  if (Node.isElementAccessExpression(node)) return findElementAccessSources(node, target.bindings);
  if (Node.isCallExpression(node)) return findCallReturnValues(node, target.bindings);
  if (Node.isReturnStatement(node)) return findReturnedValueSources(node, target.bindings);
  if (Node.isParameterDeclaration(node)) return findParameterArguments(node, target.bindings);
  if (Node.isBindingElement(node)) return findBindingElementSources(node, target.bindings);

  return findExpressionSources(node, target.bindings);
}

function findBindingElementSources(
  bindingElement: BindingElement,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const propertyName = getBindingElementPropertyName(bindingElement);
  const bindingPattern = bindingElement.getParent();
  const bindingOwner = bindingPattern.getParent();

  if (Node.isArrayBindingPattern(bindingPattern)) {
    return findArrayBindingElementSources(bindingElement, bindings);
  }

  if (bindingElementHasRestToken(bindingElement)) {
    return findObjectRestBindingElementSources(bindingElement, bindings);
  }

  if (!propertyName) {
    return bindingElement.getInitializer()
      ? [toTarget(bindingElement.getInitializer()!, bindings, "parameter")]
      : [];
  }

  if (Node.isParameterDeclaration(bindingOwner)) {
    const boundArgument = bindings.get(getNodeId(bindingOwner));
    const initializer = bindingElement.getInitializer();

    if (boundArgument) {
      return withInitializerFallback(
        extractPropertyFromTarget(
          boundArgument,
          propertyName,
          !initializer,
        ),
        initializer,
        bindings,
        "property",
        "Destructuring default value"
      );
    }

    return withInitializerFallback(
      findReactPropArguments(bindingOwner, propertyName, bindings),
      initializer,
      bindings,
      "property",
      "Destructuring default value"
    );
  }

  if (Node.isVariableDeclaration(bindingOwner)) {
    const initializer = bindingOwner.getInitializer();
    if (!initializer) return [];

    return withInitializerFallback(
      findPropertySourcesForExpression(
        initializer,
        propertyName,
        bindings,
        !bindingElement.getInitializer(),
      ),
      bindingElement.getInitializer(),
      bindings,
      "property",
      "Destructuring default value"
    );
  }

  return [];
}

export function scanOutwardForReachingDefinitions(
  statement: Statement,
  target: Identifier,
  bindings: Map<string, TraceTarget>
): ScanResult {
  const targets: TraceTarget[] = [];
  let currentStatement: Statement | undefined = statement;

  while (currentStatement) {
    const statements = getSiblingStatements(currentStatement);
    if (!statements) break;

    const statementIndex = statements.findIndex(candidate => candidate === currentStatement);
    if (statementIndex === -1) break;

    const result = scanStatementsBackward(
      statements.slice(0, statementIndex),
      target,
      bindings
    );

    targets.push(...result.targets);

    if (result.definitelyAssigned) {
      return {
        targets: dedupeTargets(targets),
        definitelyAssigned: true,
      };
    }

    currentStatement = getContainingOuterStatement(currentStatement);
  }

  return {
    targets: dedupeTargets(targets),
    definitelyAssigned: false,
  };
}

export function getValueDeclarations(node: Identifier): Node[] {
  const symbol = node.getSymbol();
  const aliasedSymbol = symbol?.getAliasedSymbol();
  const declarations = [
    ...(symbol?.getDeclarations() ?? []),
    ...(aliasedSymbol?.getDeclarations() ?? []),
  ];

  return dedupeNodes(declarations);
}

function findObjectRestBindingElementSources(
  bindingElement: BindingElement,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const bindingPattern = bindingElement.getParent();
  if (!Node.isObjectBindingPattern(bindingPattern)) return [];

  const bindingOwner = bindingPattern.getParent();
  const omittedNames = getObjectRestOmittedNames(bindingElement);

  if (Node.isParameterDeclaration(bindingOwner)) {
    const boundArgument = bindings.get(getNodeId(bindingOwner));
    return boundArgument
      ? extractObjectRestFromTarget(boundArgument, omittedNames)
      : findReactRestPropArguments(bindingOwner, omittedNames, bindings);
  }

  if (Node.isVariableDeclaration(bindingOwner)) {
    const initializer = bindingOwner.getInitializer();
    return initializer
      ? extractObjectRestFromExpression(initializer, omittedNames, bindings)
      : [];
  }

  return [];
}

function scanStatementsBackward(
  statements: Statement[],
  target: Identifier,
  bindings: Map<string, TraceTarget>
): ScanResult {
  const targets: TraceTarget[] = [];

  for (let index = statements.length - 1; index >= 0; index -= 1) {
    const result = scanStatementForDefinition(statements[index], target, bindings);

    targets.push(...result.targets);

    if (result.definitelyAssigned) {
      return {
        targets: dedupeTargets(targets),
        definitelyAssigned: true,
      };
    }
  }

  return {
    targets: dedupeTargets(targets),
    definitelyAssigned: false,
  };
}

function scanStatementForDefinition(
  statement: Statement,
  target: Identifier,
  bindings: Map<string, TraceTarget>
): ScanResult {
  if (Node.isBlock(statement)) {
    return scanStatementsBackward(statement.getStatements(), target, bindings);
  }

  if (Node.isVariableStatement(statement)) {
    const targets = statement
      .getDeclarations()
      .flatMap(declaration => getVariableDeclarationTargets(declaration, target, bindings));

    return {
      targets,
      definitelyAssigned: targets.length > 0,
    };
  }

  if (Node.isExpressionStatement(statement)) {
    return scanExpressionForDefinition(statement.getExpression(), target, bindings);
  }

  if (Node.isIfStatement(statement)) {
    const thenStatement = statement.getThenStatement();
    const thenResult = scanBranchForDefinition(
      thenStatement,
      target,
      bindings
    );
    const elseStatement = statement.getElseStatement();
    const elseResult = elseStatement
      ? scanBranchForDefinition(elseStatement, target, bindings)
      : emptyScanResult;
    const thenTerminates = statementAlwaysTerminates(thenStatement);
    const elseTerminates = elseStatement ? statementAlwaysTerminates(elseStatement) : false;
    const targets = [
      ...(thenTerminates ? [] : thenResult.targets),
      ...(elseTerminates ? [] : elseResult.targets),
    ];

    return {
      targets: dedupeTargets(targets),
      definitelyAssigned:
        (thenTerminates || thenResult.definitelyAssigned) &&
        !!elseStatement &&
        (elseTerminates || elseResult.definitelyAssigned) &&
        !(thenTerminates && elseTerminates),
    };
  }

  if (Node.isSwitchStatement(statement)) {
    return scanSwitchForDefinition(statement, target, bindings);
  }

  if (Node.isTryStatement(statement)) {
    return scanTryForDefinition(statement, target, bindings);
  }

  if (
    Node.isForStatement(statement) ||
    Node.isForInStatement(statement) ||
    Node.isForOfStatement(statement) ||
    Node.isWhileStatement(statement)
  ) {
    return {
      targets: findExpressionSources(statement, bindings),
      definitelyAssigned: false,
    };
  }

  return emptyScanResult;
}

function getVariableDeclarationTargets(
  declaration: Node,
  target: Identifier,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (!Node.isVariableDeclaration(declaration)) return [];

  const nameNode = declaration.getNameNode();

  if (Node.isIdentifier(nameNode) && nodesReferToSameSymbol(nameNode, target)) {
    const initializer = declaration.getInitializer();

    return [
      initializer
        ? toTarget(initializer, bindings, "assignment")
        : toTarget(declaration, bindings, "assignment", "Declared without an initializer"),
    ];
  }

  if (Node.isObjectBindingPattern(nameNode)) {
    const matchingElement = nameNode.getElements().find(element =>
      bindingElementMatchesIdentifier(element, target)
    );

    return matchingElement
      ? [toTarget(matchingElement, bindings, "parameter")]
      : [];
  }

  if (Node.isArrayBindingPattern(nameNode)) {
    const matchingElement = nameNode.getElements().find(element =>
      Node.isBindingElement(element) && bindingElementMatchesIdentifier(element, target)
    );

    return matchingElement && Node.isBindingElement(matchingElement)
      ? [toTarget(matchingElement, bindings, "parameter")]
      : [];
  }

  return [];
}

function scanExpressionForDefinition(
  expression: Node,
  target: Identifier,
  bindings: Map<string, TraceTarget>
): ScanResult {
  if (Node.isCallExpression(expression)) {
    const mutationTargets = findMutationCallTargets(expression, target, bindings);

    return mutationTargets.length > 0
      ? {
          targets: mutationTargets,
          definitelyAssigned: false,
        }
      : emptyScanResult;
  }

  if (!Node.isBinaryExpression(expression)) return emptyScanResult;

  const operator = expression.getOperatorToken().getText();
  const left = expression.getLeft();

  if (operator === "=" && isIdentifierWrite(left, target)) {
    return {
      targets: [toTarget(expression.getRight(), bindings, "assignment")],
      definitelyAssigned: true,
    };
  }

  if (
    ["+=", "-=", "*=", "/=", "%=", "??=", "||=", "&&="].includes(operator) &&
    isIdentifierWrite(left, target)
  ) {
    return {
      targets: [
        toTarget(left, bindings, "assignment", "Previous value participates in compound assignment"),
        toTarget(expression.getRight(), bindings, "assignment"),
      ],
      definitelyAssigned: true,
    };
  }

  return emptyScanResult;
}

function scanBranchForDefinition(
  statement: Statement,
  target: Identifier,
  bindings: Map<string, TraceTarget>
): ScanResult {
  if (Node.isBlock(statement)) {
    return scanStatementsBackward(statement.getStatements(), target, bindings);
  }

  return scanStatementForDefinition(statement, target, bindings);
}

function scanSwitchForDefinition(
  statement: Node,
  target: Identifier,
  bindings: Map<string, TraceTarget>
): ScanResult {
  if (!Node.isSwitchStatement(statement)) return emptyScanResult;

  const clauses = statement.getClauses();
  if (clauses.length === 0) return emptyScanResult;

  const clauseResults = clauses.map(clause =>
    scanStatementsBackward(clause.getStatements(), target, bindings)
  );
  const hasDefault = clauses.some(Node.isDefaultClause);

  return {
    targets: dedupeTargets(clauseResults.flatMap(result => result.targets)),
    definitelyAssigned: hasDefault && clauseResults.every(result => result.definitelyAssigned),
  };
}

function scanTryForDefinition(
  statement: Node,
  target: Identifier,
  bindings: Map<string, TraceTarget>
): ScanResult {
  if (!Node.isTryStatement(statement)) return emptyScanResult;

  const finallyBlock = statement.getFinallyBlock();
  const finallyResult = finallyBlock
    ? scanBranchForDefinition(finallyBlock, target, bindings)
    : emptyScanResult;

  if (finallyResult.definitelyAssigned) return finallyResult;

  const tryResult = scanBranchForDefinition(statement.getTryBlock(), target, bindings);
  const catchClause = statement.getCatchClause();
  const catchResult = catchClause
    ? scanBranchForDefinition(catchClause.getBlock(), target, bindings)
    : emptyScanResult;

  return {
    targets: dedupeTargets([
      ...finallyResult.targets,
      ...tryResult.targets,
      ...catchResult.targets,
    ]),
    definitelyAssigned:
      tryResult.definitelyAssigned &&
      (!catchClause || catchResult.definitelyAssigned),
  };
}