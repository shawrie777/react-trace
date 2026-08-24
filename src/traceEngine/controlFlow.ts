import { Statement, Node } from "ts-morph";

export function statementAlwaysTerminates(statement: Statement): boolean {
  if (Node.isReturnStatement(statement) || Node.isThrowStatement(statement)) {
    return true;
  }

  if (Node.isBlock(statement)) {
    const statements = statement.getStatements();
    const lastStatement = statements[statements.length - 1];
    return lastStatement ? statementAlwaysTerminates(lastStatement) : false;
  }

  if (Node.isIfStatement(statement)) {
    const elseStatement = statement.getElseStatement();
    return !!elseStatement &&
      statementAlwaysTerminates(statement.getThenStatement()) &&
      statementAlwaysTerminates(elseStatement);
  }

  if (Node.isSwitchStatement(statement)) {
    const clauses = statement.getClauses();
    return clauses.length > 0 &&
      clauses.some(Node.isDefaultClause) &&
      clauses.every(clause => {
        const statements = clause.getStatements();
        const lastStatement = statements[statements.length - 1];
        return lastStatement ? statementAlwaysTerminates(lastStatement) : false;
      });
  }

  if (Node.isTryStatement(statement)) {
    const finallyBlock = statement.getFinallyBlock();
    if (finallyBlock && statementAlwaysTerminates(finallyBlock)) return true;

    const catchClause = statement.getCatchClause();
    return statementAlwaysTerminates(statement.getTryBlock()) &&
      !!catchClause &&
      statementAlwaysTerminates(catchClause.getBlock());
  }

  return false;
}