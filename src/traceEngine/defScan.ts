import { Identifier, Node, Statement } from "ts-morph";
import { ScanResult, TraceTarget } from "./types";
import { getContainingOuterStatement, getSiblingStatements } from "./relatedNodes";
import { dedupe, emptyScanResult, isIdentifierWrite, toTarget } from "./utils";
import { getVariableDeclarationTargets } from "./bindingElements";
import { statementAlwaysTerminates } from "./controlFlow";
import { findExpressionSources } from "./expressions";
import { findMutationCallTargets } from "./callExpressions";

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
        targets: dedupe(targets),
        definitelyAssigned: true,
      };
    }

    currentStatement = getContainingOuterStatement(currentStatement);
  }

  return {
    targets: dedupe(targets),
    definitelyAssigned: false,
  };
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
        targets: dedupe(targets),
        definitelyAssigned: true,
      };
    }
  }

  return {
    targets: dedupe(targets),
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
      targets: dedupe(targets),
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
    targets: dedupe(clauseResults.flatMap(result => result.targets)),
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
    targets: dedupe([
      ...finallyResult.targets,
      ...tryResult.targets,
      ...catchResult.targets,
    ]),
    definitelyAssigned:
      tryResult.definitelyAssigned &&
      (!catchClause || catchResult.definitelyAssigned),
  };
}