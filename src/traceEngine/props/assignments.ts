import { Node, PropertyAccessExpression, Statement } from "ts-morph";
import { getContainingOuterStatement, getContainingStatement, getSiblingStatements } from "../relatedNodes";
import { ScanResult, TraceTarget } from "../types";
import { dedupeTargets, emptyScanResult, toTarget } from "../utils";
import { statementAlwaysTerminates } from "../controlFlow";
import { nodesReferToSameSymbol } from "../../nodeUtils";

export function findLocalReachingPropertyDefinitions(
  propertyAccess: PropertyAccessExpression,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const statement = getContainingStatement(propertyAccess);
  if (!statement) return [];

  return scanOutwardForReachingPropertyDefinitions(statement, propertyAccess, bindings).targets;
}

function scanOutwardForReachingPropertyDefinitions(
  statement: Statement,
  target: PropertyAccessExpression,
  bindings: Map<string, TraceTarget>
): ScanResult {
  const targets: TraceTarget[] = [];
  let currentStatement: Statement | undefined = statement;

  while (currentStatement) {
    const statements = getSiblingStatements(currentStatement);
    if (!statements) break;

    const statementIndex = statements.findIndex(candidate => candidate === currentStatement);
    if (statementIndex === -1) break;

    const result = scanPropertyStatementsBackward(
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

function scanPropertyStatementsBackward(
  statements: Statement[],
  target: PropertyAccessExpression,
  bindings: Map<string, TraceTarget>
): ScanResult {
  const targets: TraceTarget[] = [];

  for (let index = statements.length - 1; index >= 0; index -= 1) {
    const result = scanStatementForPropertyDefinition(statements[index], target, bindings);

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

function scanStatementForPropertyDefinition(
  statement: Statement,
  target: PropertyAccessExpression,
  bindings: Map<string, TraceTarget>
): ScanResult {
  if (Node.isBlock(statement)) {
    return scanPropertyStatementsBackward(statement.getStatements(), target, bindings);
  }

  if (Node.isExpressionStatement(statement)) {
    return scanExpressionForPropertyDefinition(statement.getExpression(), target, bindings);
  }

  if (Node.isIfStatement(statement)) {
    const thenStatement = statement.getThenStatement();
    const thenResult = scanBranchForPropertyDefinition(
      thenStatement,
      target,
      bindings
    );
    const elseStatement = statement.getElseStatement();
    const elseResult = elseStatement
      ? scanBranchForPropertyDefinition(elseStatement, target, bindings)
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
    return scanSwitchForPropertyDefinition(statement, target, bindings);
  }

  if (Node.isTryStatement(statement)) {
    return scanTryForPropertyDefinition(statement, target, bindings);
  }

  return emptyScanResult;
}

function scanExpressionForPropertyDefinition(
  expression: Node,
  target: PropertyAccessExpression,
  bindings: Map<string, TraceTarget>
): ScanResult {
  if (!Node.isBinaryExpression(expression)) return emptyScanResult;

  const operator = expression.getOperatorToken().getText();
  const left = expression.getLeft();

  if (operator === "=" && propertyAccessesMatch(left, target)) {
    return {
      targets: [toTarget(expression.getRight(), bindings, "property")],
      definitelyAssigned: true,
    };
  }

  if (
    ["+=", "-=", "*=", "/=", "%=", "??=", "||=", "&&="].includes(operator) &&
    propertyAccessesMatch(left, target)
  ) {
    return {
      targets: [
        toTarget(left, bindings, "property", "Previous property value participates in compound assignment"),
        toTarget(expression.getRight(), bindings, "property"),
      ],
      definitelyAssigned: true,
    };
  }

  return emptyScanResult;
}

function scanBranchForPropertyDefinition(
  statement: Statement,
  target: PropertyAccessExpression,
  bindings: Map<string, TraceTarget>
): ScanResult {
  if (Node.isBlock(statement)) {
    return scanPropertyStatementsBackward(statement.getStatements(), target, bindings);
  }

  return scanStatementForPropertyDefinition(statement, target, bindings);
}

function scanSwitchForPropertyDefinition(
  statement: Node,
  target: PropertyAccessExpression,
  bindings: Map<string, TraceTarget>
): ScanResult {
  if (!Node.isSwitchStatement(statement)) return emptyScanResult;

  const clauses = statement.getClauses();
  if (clauses.length === 0) return emptyScanResult;

  const clauseResults = clauses.map(clause =>
    scanPropertyStatementsBackward(clause.getStatements(), target, bindings)
  );
  const hasDefault = clauses.some(Node.isDefaultClause);

  return {
    targets: dedupeTargets(clauseResults.flatMap(result => result.targets)),
    definitelyAssigned: hasDefault && clauseResults.every(result => result.definitelyAssigned),
  };
}

function scanTryForPropertyDefinition(
  statement: Node,
  target: PropertyAccessExpression,
  bindings: Map<string, TraceTarget>
): ScanResult {
  if (!Node.isTryStatement(statement)) return emptyScanResult;

  const finallyBlock = statement.getFinallyBlock();
  const finallyResult = finallyBlock
    ? scanBranchForPropertyDefinition(finallyBlock, target, bindings)
    : emptyScanResult;

  if (finallyResult.definitelyAssigned) return finallyResult;

  const tryResult = scanBranchForPropertyDefinition(statement.getTryBlock(), target, bindings);
  const catchClause = statement.getCatchClause();
  const catchResult = catchClause
    ? scanBranchForPropertyDefinition(catchClause.getBlock(), target, bindings)
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

function propertyAccessesMatch(left: Node, target: PropertyAccessExpression): boolean {
  if (!Node.isPropertyAccessExpression(left)) return false;
  if (left.getName() !== target.getName()) return false;

  const leftExpression = left.getExpression();
  const targetExpression = target.getExpression();

  return (
    Node.isIdentifier(leftExpression) &&
    Node.isIdentifier(targetExpression) &&
    nodesReferToSameSymbol(leftExpression, targetExpression)
  );
}