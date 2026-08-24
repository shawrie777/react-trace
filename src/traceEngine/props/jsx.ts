import { Identifier, Node, ParameterDeclaration } from "ts-morph";
import { getComponentReferenceNameNodes } from "../components";
import { getParameterFunction } from "../functions";
import { TraceTarget } from "../types";
import { toTarget } from "../utils";
import { findPropertySourcesForExpression } from "./sources";

export function findReactPropArguments(
  parameter: ParameterDeclaration,
  propertyName: string,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const functionLike = getParameterFunction(parameter);

  return getComponentReferenceNameNodes(functionLike)
    .flatMap(nameNode => findJsxPropValuesForComponent(nameNode, propertyName, bindings));
}

export function findReactPropsObjectArguments(
  parameter: ParameterDeclaration,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const functionLike = getParameterFunction(parameter);

  return getComponentReferenceNameNodes(functionLike)
    .flatMap(nameNode => findJsxAllPropValuesForComponent(nameNode, bindings));
}

export function findReactRestPropArguments(
  parameter: ParameterDeclaration,
  omittedNames: Set<string>,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const functionLike = getParameterFunction(parameter);

  return getComponentReferenceNameNodes(functionLike)
    .flatMap(nameNode => findJsxRestPropValuesForComponent(nameNode, omittedNames, bindings));
}

function findJsxPropValuesForComponent(
  componentName: Identifier,
  propertyName: string,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  return componentName
    .findReferencesAsNodes()
    .flatMap(ref => getJsxElementPropTargets(ref, propertyName, bindings));
}

function findJsxAllPropValuesForComponent(
  componentName: Identifier,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  return componentName
    .findReferencesAsNodes()
    .flatMap(ref => getJsxElementAllPropTargets(ref, bindings));
}

function findJsxRestPropValuesForComponent(
  componentName: Identifier,
  omittedNames: Set<string>,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  return componentName
    .findReferencesAsNodes()
    .flatMap(ref => getJsxElementRestPropTargets(ref, omittedNames, bindings));
}

function getJsxElementPropTargets(
  ref: Node,
  propertyName: string,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const parent = ref.getParent();

  if (
    Node.isJsxSelfClosingElement(parent) &&
    parent.getTagNameNode() === ref
  ) {
    return getJsxPropTargets(parent, propertyName, bindings);
  }

  if (
    Node.isJsxOpeningElement(parent) &&
    parent.getTagNameNode() === ref
  ) {
    return getJsxPropTargets(parent, propertyName, bindings);
  }

  return [];
}

function getJsxElementRestPropTargets(
  ref: Node,
  omittedNames: Set<string>,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const parent = ref.getParent();

  if (
    Node.isJsxSelfClosingElement(parent) &&
    parent.getTagNameNode() === ref
  ) {
    return getJsxRestPropTargets(parent, omittedNames, bindings);
  }

  if (
    Node.isJsxOpeningElement(parent) &&
    parent.getTagNameNode() === ref
  ) {
    return getJsxRestPropTargets(parent, omittedNames, bindings);
  }

  return [];
}

function getJsxElementAllPropTargets(ref: Node, bindings: Map<string, TraceTarget>): TraceTarget[] {
  const parent = ref.getParent();

  if (
    Node.isJsxSelfClosingElement(parent) &&
    parent.getTagNameNode() === ref
  ) {
    return getAllJsxPropTargets(parent, bindings);
  }

  if (
    Node.isJsxOpeningElement(parent) &&
    parent.getTagNameNode() === ref
  ) {
    return getAllJsxPropTargets(parent, bindings);
  }

  return [];
}

export function getJsxPropTargets(
  element: Node,
  propertyName: string,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (!Node.isJsxSelfClosingElement(element) && !Node.isJsxOpeningElement(element)) {
    return [];
  }

  const directAttribute = element.getAttribute(propertyName);
  if (directAttribute && Node.isJsxAttribute(directAttribute)) {
    return getJsxAttributeTargets(directAttribute, bindings);
  }

  return element.getAttributes().flatMap(attribute => {
    if (!Node.isJsxSpreadAttribute(attribute)) return [];
    return findPropertySourcesForExpression(attribute.getExpression(), propertyName, bindings);
  });
}

function getJsxRestPropTargets(
  element: Node,
  omittedNames: Set<string>,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (!Node.isJsxSelfClosingElement(element) && !Node.isJsxOpeningElement(element)) {
    return [];
  }

  return element.getAttributes().flatMap(attribute => {
    if (Node.isJsxAttribute(attribute)) {
      const attributeName = attribute.getNameNode().getText();

      return omittedNames.has(attributeName)
        ? []
        : getJsxAttributeTargets(attribute, bindings).map(target => ({
            ...target,
            note: target.note ?? `JSX rest prop: ${attributeName}`,
          }));
    }

    if (Node.isJsxSpreadAttribute(attribute)) {
      return [toTarget(attribute.getExpression(), bindings, "property", "JSX spread props for rest")];
    }

    return [];
  });
}

function getAllJsxPropTargets(element: Node, bindings: Map<string, TraceTarget>): TraceTarget[] {
  if (!Node.isJsxSelfClosingElement(element) && !Node.isJsxOpeningElement(element)) {
    return [];
  }

  return element.getAttributes().flatMap(attribute => {
    if (Node.isJsxAttribute(attribute)) {
      return getJsxAttributeTargets(attribute, bindings);
    }

    if (Node.isJsxSpreadAttribute(attribute)) {
      return [toTarget(attribute.getExpression(), bindings, "property", "JSX spread props")];
    }

    return [];
  });
}

function getJsxAttributeTargets(attribute: Node, bindings: Map<string, TraceTarget>): TraceTarget[] {
  if (!Node.isJsxAttribute(attribute)) return [];

  const initializer = attribute.getInitializer();

  if (!initializer) {
    return [toTarget(attribute, bindings, "literal", "Boolean JSX prop")];
  }

  if (Node.isJsxExpression(initializer)) {
    const expression = initializer.getExpression();
    return expression
      ? [toTarget(expression, bindings, "property")]
      : [toTarget(initializer, bindings, "unknown", "Empty JSX expression")];
  }

  return [toTarget(initializer, bindings, "property")];
}