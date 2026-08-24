import { BindingElement, Identifier, Node } from "ts-morph";
import { getNodeId, nodesReferToSameSymbol } from "../nodeUtils";
import { findArrayBindingElementSources } from "./arrays";
import { TraceTarget } from "./types";
import { bindingElementHasRestToken, bindingElementMatchesIdentifier, toTarget, withInitializerFallback } from "./utils";
import { findReactPropArguments, findReactRestPropArguments } from "./props/jsx";
import { getObjectRestOmittedNames, extractObjectRestFromTarget, extractObjectRestFromExpression } from "./props/rest";
import { extractPropertyFromTarget, findPropertySourcesForExpression, getStaticPropertyName } from "./props/sources";

export function findBindingElementSources(
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

export function getBindingElementDeclarationForIdentifier(node: Identifier): BindingElement | undefined {
  const declarations = node.getSymbol()?.getDeclarations() ?? [];

  return declarations.find((declaration): declaration is BindingElement =>
    Node.isBindingElement(declaration)
  );
}

export function getBindingElementPropertyName(bindingElement: BindingElement): string | undefined {
  const propertyNameNode = bindingElement.getPropertyNameNode();

  if (propertyNameNode) {
    return getStaticPropertyName(propertyNameNode);
  }

  const nameNode = bindingElement.getNameNode();
  return Node.isIdentifier(nameNode) ? nameNode.getText() : undefined;
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

export function getVariableDeclarationTargets(
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