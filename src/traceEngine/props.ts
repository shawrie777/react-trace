import { Node, Identifier, PropertyAccessExpression, BindingElement, ParameterDeclaration, Statement } from "ts-morph";
import { getNodeId, nodesReferToSameSymbol } from "../nodeUtils";
import { ScanResult, TraceTarget } from "./types";
import { findIdentifierDefinitions } from "./identifiers";
import { getContainingOuterStatement, getContainingStatement, getSiblingStatements } from "./relatedNodes";
import { getParameterDeclarationForIdentifier } from "./parameters";
import { findCallReturnValues } from "./callExpressions";
import { getComponentReferenceNameNodes, getParameterFunction } from "./functions";
import { findExpressionSources } from "./returns";
import { dedupeTargets, emptyScanResult, statementAlwaysTerminates, toTarget } from "./utils";
import { getStaticElementAccessName } from "./elementAccess";

export function findPropertyAccessSources(
  propertyAccess: PropertyAccessExpression,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const reaching = findLocalReachingPropertyDefinitions(propertyAccess, bindings);
  if (reaching.length > 0) return reaching;

  return findPropertySourcesForExpression(
    propertyAccess.getExpression(),
    propertyAccess.getName(),
    bindings
  );
}

export function getPropertyAccessNameParent(node: Identifier): PropertyAccessExpression | undefined {
  const parent = node.getParent();

  if (
    Node.isPropertyAccessExpression(parent) &&
    parent.getNameNode() === node
  ) {
    return parent;
  }

  return undefined;
}

function findLocalReachingPropertyDefinitions(
  propertyAccess: PropertyAccessExpression,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const statement = getContainingStatement(propertyAccess);
  if (!statement) return [];

  return scanOutwardForReachingPropertyDefinitions(statement, propertyAccess, bindings).targets;
}

export function findPropertySourcesForExpression(
  expression: Node,
  propertyName: string,
  bindings: Map<string, TraceTarget>,
  allowObjectFallback: boolean = true,
): TraceTarget[] {
  if (Node.isIdentifier(expression)) {
    const parameter = getParameterDeclarationForIdentifier(expression);

    if (parameter) {
      const boundArgument = bindings.get(getNodeId(parameter));
      if (boundArgument) {
        return extractPropertyFromTarget(boundArgument, propertyName);
      }

      return findReactPropArguments(parameter, propertyName, bindings);
    }

    const objectDefinitions = findIdentifierDefinitions(expression, bindings);
    const propertyDefinitions = objectDefinitions.flatMap(definition =>
      extractPropertyFromTarget(definition, propertyName, allowObjectFallback)
    );

    return propertyDefinitions.length > 0 || !allowObjectFallback
      ? propertyDefinitions
      : objectDefinitions;
  }

  if (Node.isObjectLiteralExpression(expression)) {
    return extractPropertyFromObjectLiteral(expression, propertyName, bindings, allowObjectFallback);
  }

  if (Node.isCallExpression(expression)) {
    return findCallReturnValues(expression, bindings).flatMap(target =>
      extractPropertyFromTarget(target, propertyName, allowObjectFallback)
    );
  }

  return findExpressionSources(expression, bindings);
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

export function extractPropertyFromTarget(
  target: TraceTarget,
  propertyName: string,
  allowObjectFallback: boolean = true,
): TraceTarget[] {
  const { node, bindings: context } = target;

  if (Node.isObjectLiteralExpression(node)) {
    return extractPropertyFromObjectLiteral(node, propertyName, context, allowObjectFallback);
  }

  if (Node.isReturnStatement(node)) {
    const expression = node.getExpression();
    return expression
      ? findPropertySourcesForExpression(expression, propertyName, context, allowObjectFallback)
      : [];
  }

  if (Node.isCallExpression(node)) {
    return findCallReturnValues(node, context).flatMap(returnTarget =>
      extractPropertyFromTarget(returnTarget, propertyName, allowObjectFallback)
    );
  }

  if (Node.isIdentifier(node)) {
    return findPropertySourcesForExpression(node, propertyName, context, allowObjectFallback);
  }

  return allowObjectFallback ? [target] : [];
}

export function findReactPropArguments(
  parameter: ParameterDeclaration,
  propertyName: string,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const functionLike = getParameterFunction(parameter);

  return getComponentReferenceNameNodes(functionLike)
    .flatMap(nameNode => findJsxPropValuesForComponent(nameNode, propertyName, bindings));
}

function extractPropertyFromObjectLiteral(
  objectLiteral: Node,
  propertyName: string,
  bindings: Map<string, TraceTarget>,
  allowObjectFallback: boolean = true
): TraceTarget[] {
  if (!Node.isObjectLiteralExpression(objectLiteral)) return [];

  const targets: TraceTarget[] = [];
  const properties = objectLiteral.getProperties();

  for (let index = properties.length - 1; index >= 0; index -= 1) {
    const property = properties[index];

    if (
      Node.isPropertyAssignment(property) &&
      getStaticPropertyName(property.getNameNode()) === propertyName
    ) {
      const initializer = property.getInitializer();
      if (initializer) targets.push(toTarget(initializer, bindings, "property"));
      break;
    }

    if (Node.isShorthandPropertyAssignment(property) && property.getName() === propertyName) {
      targets.push(toTarget(property.getNameNode(), bindings, "property"));
      break;
    }

    if (Node.isSpreadAssignment(property)) {
      targets.push(...findPropertySourcesForExpression(
        property.getExpression(),
        propertyName,
        bindings,
        allowObjectFallback
      ));
    }
  }

  return dedupeTargets(targets);
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

export function getBindingElementDeclarationForIdentifier(node: Identifier): BindingElement | undefined {
  const declarations = node.getSymbol()?.getDeclarations() ?? [];

  return declarations.find((declaration): declaration is BindingElement =>
    Node.isBindingElement(declaration)
  );
}

export function findReactPropsObjectArguments(
  parameter: ParameterDeclaration,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  const functionLike = getParameterFunction(parameter);

  return getComponentReferenceNameNodes(functionLike)
    .flatMap(nameNode => findJsxAllPropValuesForComponent(nameNode, bindings));
}

export function getBindingElementPropertyName(bindingElement: BindingElement): string | undefined {
  const propertyNameNode = bindingElement.getPropertyNameNode();

  if (propertyNameNode) {
    return getStaticPropertyName(propertyNameNode);
  }

  const nameNode = bindingElement.getNameNode();
  return Node.isIdentifier(nameNode) ? nameNode.getText() : undefined;
}

export function getObjectRestOmittedNames(restElement: BindingElement): Set<string> {
  const bindingPattern = restElement.getParent();
  if (!Node.isObjectBindingPattern(bindingPattern)) return new Set();

  return new Set(
    bindingPattern
      .getElements()
      .filter(element => element !== restElement)
      .map(getBindingElementPropertyName)
      .filter((name): name is string => !!name)
  );
}

export function extractObjectRestFromTarget(
  target: TraceTarget,
  omittedNames: Set<string>
): TraceTarget[] {
  const { node, bindings: context } = target;

  if (Node.isObjectLiteralExpression(node)) {
    return extractObjectRestFromObjectLiteral(node, omittedNames, context);
  }

  if (Node.isReturnStatement(node)) {
    const expression = node.getExpression();
    return expression
      ? extractObjectRestFromExpression(expression, omittedNames, context)
      : [];
  }

  if (Node.isCallExpression(node)) {
    return findCallReturnValues(node, context).flatMap(returnTarget =>
      extractObjectRestFromTarget(returnTarget, omittedNames)
    );
  }

  if (Node.isIdentifier(node)) {
    return extractObjectRestFromExpression(node, omittedNames, context);
  }

  return [{ ...target, note: target.note ?? "Object rest source" }];
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

export function extractObjectRestFromExpression(
  expression: Node,
  omittedNames: Set<string>,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (Node.isIdentifier(expression)) {
    const objectDefinitions = findIdentifierDefinitions(expression, bindings);
    const restTargets = objectDefinitions.flatMap(definition =>
      extractObjectRestFromTarget(definition, omittedNames)
    );

    return restTargets.length > 0
      ? restTargets
      : [toTarget(expression, bindings, "property", "Object rest source")];
  }

  if (Node.isObjectLiteralExpression(expression)) {
    return extractObjectRestFromObjectLiteral(expression, omittedNames, bindings);
  }

  if (Node.isCallExpression(expression)) {
    return findCallReturnValues(expression, bindings).flatMap(target =>
      extractObjectRestFromTarget(target, omittedNames)
    );
  }

  return [toTarget(expression, bindings, "property", "Object rest source")];
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

function getStaticPropertyName(nameNode: Node): string | undefined {
  if (Node.isIdentifier(nameNode)) return nameNode.getText();

  if (
    Node.isStringLiteral(nameNode) ||
    Node.isNumericLiteral(nameNode) ||
    Node.isNoSubstitutionTemplateLiteral(nameNode)
  ) {
    return nameNode.getLiteralText();
  }

  if (Node.isComputedPropertyName(nameNode)) {
    return getStaticElementAccessName(nameNode.getExpression());
  }

  return undefined;
}

function extractObjectRestFromObjectLiteral(
  objectLiteral: Node,
  omittedNames: Set<string>,
  bindings: Map<string, TraceTarget>
): TraceTarget[] {
  if (!Node.isObjectLiteralExpression(objectLiteral)) return [];

  return objectLiteral.getProperties().flatMap(property => {
    if (Node.isPropertyAssignment(property)) {
      const propertyName = getStaticPropertyName(property.getNameNode());
      const initializer = property.getInitializer();

      return propertyName && !omittedNames.has(propertyName) && initializer
        ? [toTarget(initializer, bindings, "property", `Object rest property: ${propertyName}`)]
        : [];
    }

    if (Node.isShorthandPropertyAssignment(property) && !omittedNames.has(property.getName())) {
      return [
        toTarget(property.getNameNode(), bindings, "property", `Object rest property: ${property.getName()}`),
      ];
    }

    if (Node.isSpreadAssignment(property)) {
      return [toTarget(property.getExpression(), bindings, "property", "Object spread source for rest")];
    }

    return [];
  });
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