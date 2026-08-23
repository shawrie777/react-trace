import { Node, Identifier } from "ts-morph";
import { TraceTarget } from "./types";
import { scanOutwardForReachingDefinitions, getValueDeclarations } from "./definitions";
import { getPropertyAccessNameParent, findPropertyAccessSources, getBindingElementDeclarationForIdentifier } from "./props";
import { getParameterDeclarationForIdentifier } from "./parameters";
import { getContainingStatement } from "./relatedNodes";
import { toTarget, declarationTargets } from "./utils";

export function findIdentifierDefinitions(node: Identifier, bindings: Map<string, TraceTarget>): TraceTarget[] {
  const propertyAccess = getPropertyAccessNameParent(node);
  if (propertyAccess) return findPropertyAccessSources(propertyAccess, bindings);

  const parameter = getParameterDeclarationForIdentifier(node);
  if (parameter) {
    return [toTarget(parameter, bindings, "parameter")];
  }

  const bindingElement = getBindingElementDeclarationForIdentifier(node);
  if (bindingElement) {
    return [toTarget(bindingElement, bindings, "parameter")];
  }

  const reaching = findLocalReachingDefinitions(node, bindings);
  if (reaching.length > 0) return reaching;

  return findDeclarationInitializers(node, bindings);
}

function findLocalReachingDefinitions(identifier: Identifier, bindings: Map<string, TraceTarget>): TraceTarget[] {
  const statement = getContainingStatement(identifier);
  if (!statement) return [];

  return scanOutwardForReachingDefinitions(statement, identifier, bindings).targets;
}

function findDeclarationInitializers(node: Identifier, bindings: Map<string, TraceTarget>): TraceTarget[] {
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