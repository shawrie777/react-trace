import { Identifier, Node } from "ts-morph";
import { getReturnTargets, findExpressionSources } from "./expressions";
import { TraceTarget } from "./types";
import { toTarget } from "./utils";
import { getValueDeclarations } from "./symbols";

export function declarationTargets(declaration: Node, bindings: Map<string, TraceTarget>): TraceTarget[] {
  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer
      ? [toTarget(initializer, bindings, "assignment")]
      : [toTarget(declaration, bindings, "assignment", "Declared without an initializer")];
  }

  if (
    Node.isFunctionDeclaration(declaration) ||
    Node.isFunctionExpression(declaration) ||
    Node.isArrowFunction(declaration) ||
    Node.isMethodDeclaration(declaration)
  ) {
    return getReturnTargets(declaration, bindings);
  }

  if (Node.isParameterDeclaration(declaration)) {
    return [toTarget(declaration, bindings, "parameter")];
  }

  if (Node.isBindingElement(declaration)) {
    return [toTarget(declaration, bindings, "parameter")];
  }

  if (Node.isExportAssignment(declaration) && !declaration.isExportEquals()) {
    return findExpressionSources(declaration.getExpression(), bindings);
  }

  return [];
}

export function findDeclarationInitializers(node: Identifier, bindings: Map<string, TraceTarget>): TraceTarget[] {
  const declarations = getValueDeclarations(node);

  return declarations.flatMap(declaration => {
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      return initializer
        ? [toTarget(initializer, bindings, "assignment")]
        : [toTarget(declaration, bindings, "assignment", "Declared without an initializer")];
    }

    if (Node.isImportSpecifier(declaration) || Node.isImportClause(declaration)) {
      const importedTargets = findImportedDeclarationTargets(declaration, bindings);
      return importedTargets.length > 0
        ? importedTargets
        : [toTarget(declaration, bindings, "unknown", "Imported value")];
    }

    if (Node.isExportSpecifier(declaration)) {
      return declaration.getLocalTargetDeclarations().flatMap(localDeclaration =>
        declarationTargets(localDeclaration, bindings)
      );
    }

    return declarationTargets(declaration, bindings);
  });
}

function findImportedDeclarationTargets(declaration: Node, bindings: Map<string, TraceTarget>): TraceTarget[] {
  const symbol = declaration.getSymbol()?.getAliasedSymbol();
  if (!symbol) return [];

  return symbol.getDeclarations().flatMap(targetDeclaration =>
    declarationTargets(targetDeclaration, bindings)
  );
}