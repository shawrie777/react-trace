import {
  ArrowFunction,
  BindingElement,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  MethodDeclaration,
  Node,
  ParameterDeclaration,
  PropertyAccessExpression,
  Statement,
  SyntaxKind,
} from "ts-morph";
import { GraphNode, GraphNodeKind } from "./traceTypes";
import {
  getContainingFunctionName,
  getLineNumber,
  getLinePreview,
  getNodeId,
  getNodeKind,
  isTerminalValue,
  nodesReferToSameSymbol,
} from "./nodeUtils";

type FunctionLike =
  | ArrowFunction
  | FunctionDeclaration
  | FunctionExpression
  | MethodDeclaration;

type TraceTarget = {
  node: Node;
  context: TraceContext;
  kind?: GraphNodeKind;
  note?: string;
};

type TraceContext = {
  bindings: Map<string, TraceTarget>;
};

type ScanResult = {
  targets: TraceTarget[];
  definitelyAssigned: boolean;
};

const emptyScanResult: ScanResult = {
  targets: [],
  definitelyAssigned: false,
};

export async function buildTraceTree(node: Node): Promise<GraphNode | undefined> {
  return trace({
    node,
    context: createTraceContext(),
  });
}

async function trace(
  target: TraceTarget,
  path = new Set<string>()
): Promise<GraphNode | undefined> {
  const { node } = target;
  const id = getNodeId(node);
  const isCycle = path.has(id);

  const nextPath = new Set(path);
  nextPath.add(id);

  const children = isCycle
    ? []
    : (await Promise.all(
        dedupeTargets(findDefinitions(target)).map(child => trace(child, nextPath))
      )).filter((child): child is GraphNode => !!child);

  return {
    id,
    kind: isCycle ? "cycle" : target.kind ?? getNodeKind(node),
    file: node.getSourceFile().getFilePath(),
    line: getLineNumber(node),
    preview: getLinePreview(node),
    containingFunc: getContainingFunctionName(node),
    note: isCycle ? "Cycle detected" : target.note,
    children,
  };
}

function createTraceContext(bindings = new Map<string, TraceTarget>()): TraceContext {
  return { bindings };
}

function findDefinitions(target: TraceTarget): TraceTarget[] {
  const { node } = target;

  if (isTerminalValue(node)) return [];
  if (Node.isIdentifier(node)) return findIdentifierDefinitions(node, target.context);
  if (Node.isPropertyAccessExpression(node)) return findPropertyAccessSources(node, target.context);
  if (Node.isCallExpression(node)) return findCallReturnValues(node, target.context);
  if (Node.isReturnStatement(node)) return findReturnedValueSources(node, target.context);
  if (Node.isParameterDeclaration(node)) return findParameterArguments(node, target.context);
  if (Node.isBindingElement(node)) return findBindingElementSources(node, target.context);

  return findExpressionSources(node, target.context);
}

function findIdentifierDefinitions(node: Identifier, context: TraceContext): TraceTarget[] {
  const propertyAccess = getPropertyAccessNameParent(node);
  if (propertyAccess) return findPropertyAccessSources(propertyAccess, context);

  const parameter = getParameterDeclarationForIdentifier(node);
  if (parameter) {
    return [toTarget(parameter, context, "parameter")];
  }

  const bindingElement = getBindingElementDeclarationForIdentifier(node);
  if (bindingElement) {
    return [toTarget(bindingElement, context, "parameter")];
  }

  const reaching = findLocalReachingDefinitions(node, context);
  if (reaching.length > 0) return reaching;

  return findDeclarationInitializers(node, context);
}

function getPropertyAccessNameParent(node: Identifier): PropertyAccessExpression | undefined {
  const parent = node.getParent();

  if (
    Node.isPropertyAccessExpression(parent) &&
    parent.getNameNode() === node
  ) {
    return parent;
  }

  return undefined;
}

function getParameterDeclarationForIdentifier(node: Identifier): ParameterDeclaration | undefined {
  const declarations = node.getSymbol()?.getDeclarations() ?? [];

  return declarations.find((declaration): declaration is ParameterDeclaration =>
    Node.isParameterDeclaration(declaration)
  );
}

function getBindingElementDeclarationForIdentifier(node: Identifier): BindingElement | undefined {
  const declarations = node.getSymbol()?.getDeclarations() ?? [];

  return declarations.find((declaration): declaration is BindingElement =>
    Node.isBindingElement(declaration)
  );
}

function findDeclarationInitializers(node: Identifier, context: TraceContext): TraceTarget[] {
  const declarations = node.getSymbol()?.getDeclarations() ?? [];

  return declarations.flatMap(declaration => {
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      return initializer
        ? [toTarget(initializer, context, "assignment")]
        : [toTarget(declaration, context, "assignment", "Declared without an initializer")];
    }

    if (Node.isImportSpecifier(declaration) || Node.isImportClause(declaration)) {
      return [toTarget(declaration, context, "unknown", "Imported value")];
    }

    return [];
  });
}

function findLocalReachingDefinitions(identifier: Identifier, context: TraceContext): TraceTarget[] {
  const statement = getContainingStatement(identifier);
  if (!statement) return [];

  return scanOutwardForReachingDefinitions(statement, identifier, context).targets;
}

function scanOutwardForReachingDefinitions(
  statement: Statement,
  target: Identifier,
  context: TraceContext
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
      context
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

function scanStatementsBackward(
  statements: Statement[],
  target: Identifier,
  context: TraceContext
): ScanResult {
  const targets: TraceTarget[] = [];

  for (let index = statements.length - 1; index >= 0; index -= 1) {
    const result = scanStatementForDefinition(statements[index], target, context);

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
  context: TraceContext
): ScanResult {
  if (Node.isBlock(statement)) {
    return scanStatementsBackward(statement.getStatements(), target, context);
  }

  if (Node.isVariableStatement(statement)) {
    const targets = statement
      .getDeclarations()
      .flatMap(declaration => getVariableDeclarationTargets(declaration, target, context));

    return {
      targets,
      definitelyAssigned: targets.length > 0,
    };
  }

  if (Node.isExpressionStatement(statement)) {
    return scanExpressionForDefinition(statement.getExpression(), target, context);
  }

  if (Node.isIfStatement(statement)) {
    const thenResult = scanBranchForDefinition(
      statement.getThenStatement(),
      target,
      context
    );
    const elseStatement = statement.getElseStatement();
    const elseResult = elseStatement
      ? scanBranchForDefinition(elseStatement, target, context)
      : emptyScanResult;

    return {
      targets: dedupeTargets([...thenResult.targets, ...elseResult.targets]),
      definitelyAssigned: thenResult.definitelyAssigned && elseResult.definitelyAssigned,
    };
  }

  if (
    Node.isForStatement(statement) ||
    Node.isForInStatement(statement) ||
    Node.isForOfStatement(statement) ||
    Node.isWhileStatement(statement)
  ) {
    return {
      targets: findExpressionSources(statement, context),
      definitelyAssigned: false,
    };
  }

  return emptyScanResult;
}

function scanBranchForDefinition(
  statement: Statement,
  target: Identifier,
  context: TraceContext
): ScanResult {
  if (Node.isBlock(statement)) {
    return scanStatementsBackward(statement.getStatements(), target, context);
  }

  return scanStatementForDefinition(statement, target, context);
}

function scanExpressionForDefinition(
  expression: Node,
  target: Identifier,
  context: TraceContext
): ScanResult {
  if (!Node.isBinaryExpression(expression)) return emptyScanResult;

  const operator = expression.getOperatorToken().getText();
  const left = expression.getLeft();

  if (operator === "=" && isIdentifierWrite(left, target)) {
    return {
      targets: [toTarget(expression.getRight(), context, "assignment")],
      definitelyAssigned: true,
    };
  }

  if (
    ["+=", "-=", "*=", "/=", "%=", "??=", "||=", "&&="].includes(operator) &&
    isIdentifierWrite(left, target)
  ) {
    return {
      targets: [
        toTarget(left, context, "assignment", "Previous value participates in compound assignment"),
        toTarget(expression.getRight(), context, "assignment"),
      ],
      definitelyAssigned: true,
    };
  }

  return emptyScanResult;
}

function getVariableDeclarationTargets(
  declaration: Node,
  target: Identifier,
  context: TraceContext
): TraceTarget[] {
  if (!Node.isVariableDeclaration(declaration)) return [];

  const nameNode = declaration.getNameNode();

  if (Node.isIdentifier(nameNode) && nodesReferToSameSymbol(nameNode, target)) {
    const initializer = declaration.getInitializer();

    return [
      initializer
        ? toTarget(initializer, context, "assignment")
        : toTarget(declaration, context, "assignment", "Declared without an initializer"),
    ];
  }

  if (Node.isObjectBindingPattern(nameNode)) {
    const matchingElement = nameNode.getElements().find(element =>
      bindingElementMatchesIdentifier(element, target)
    );

    return matchingElement
      ? [toTarget(matchingElement, context, "parameter")]
      : [];
  }

  return [];
}

function bindingElementMatchesIdentifier(element: BindingElement, target: Identifier): boolean {
  const nameNode = element.getNameNode();

  return Node.isIdentifier(nameNode) && nodesReferToSameSymbol(nameNode, target);
}

function isIdentifierWrite(left: Node, target: Identifier): boolean {
  return Node.isIdentifier(left) && nodesReferToSameSymbol(left, target);
}

function getContainingStatement(node: Node): Statement | undefined {
  if (Node.isStatement(node)) return node;
  return node.getFirstAncestor(Node.isStatement);
}

function getSiblingStatements(statement: Statement): Statement[] | undefined {
  const parent = statement.getParent();

  if (Node.isBlock(parent) || Node.isSourceFile(parent)) {
    return parent.getStatements();
  }

  return undefined;
}

function getContainingOuterStatement(statement: Statement): Statement | undefined {
  let current = statement.getParent();

  while (current) {
    if (Node.isSourceFile(current)) return undefined;

    if (
      Node.isFunctionDeclaration(current) ||
      Node.isFunctionExpression(current) ||
      Node.isArrowFunction(current) ||
      Node.isMethodDeclaration(current)
    ) {
      return undefined;
    }

    if (Node.isStatement(current)) return current;

    current = current.getParent();
  }

  return undefined;
}

function findCallReturnValues(call: CallExpression, context: TraceContext): TraceTarget[] {
  const functionLikes = getCallableDeclarations(call);

  if (functionLikes.length === 0) {
    return [];
  }

  return functionLikes.flatMap(functionLike => {
    const callContext = createCallContextForFunction(functionLike, call, context);
    return getReturnTargets(functionLike, callContext);
  });
}

function getCallableDeclarations(call: CallExpression): FunctionLike[] {
  const callee = call.getExpression();
  const symbol = callee.getSymbol();
  const aliasedSymbol = symbol?.getAliasedSymbol();
  const declarations = [
    ...(symbol?.getDeclarations() ?? []),
    ...(aliasedSymbol?.getDeclarations() ?? []),
  ];

  return dedupeNodes(declarations.flatMap(getFunctionLikesFromDeclaration));
}

function getFunctionLikesFromDeclaration(declaration: Node): FunctionLike[] {
  if (
    Node.isFunctionDeclaration(declaration) ||
    Node.isFunctionExpression(declaration) ||
    Node.isArrowFunction(declaration) ||
    Node.isMethodDeclaration(declaration)
  ) {
    return [declaration];
  }

  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();

    if (
      Node.isFunctionExpression(initializer) ||
      Node.isArrowFunction(initializer)
    ) {
      return [initializer];
    }
  }

  return [];
}

function createCallContextForFunction(
  functionLike: FunctionLike,
  call: CallExpression,
  callerContext: TraceContext
): TraceContext {
  const bindings = new Map(callerContext.bindings);
  const args = call.getArguments();

  functionLike.getParameters().forEach((parameter, index) => {
    const arg = args[index];
    if (!arg) return;

    bindings.set(
      getNodeId(parameter),
      toTarget(arg, callerContext, "parameter", "Argument passed to this function call")
    );
  });

  return createTraceContext(bindings);
}

function getReturnTargets(functionLike: FunctionLike, context: TraceContext): TraceTarget[] {
  if (Node.isArrowFunction(functionLike)) {
    const body = functionLike.getBody();

    if (Node.isBlock(body)) {
      return body
        .getDescendantsOfKind(SyntaxKind.ReturnStatement)
        .map(returnStatement => toTarget(returnStatement, context, "return"));
    }

    return [toTarget(body, context, "return", "Implicit arrow-function return")];
  }

  const body = functionLike.getBody();
  if (!body) return [];

  return body
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .map(returnStatement => toTarget(returnStatement, context, "return"));
}

function findReturnedValueSources(node: Node, context: TraceContext): TraceTarget[] {
  if (!Node.isReturnStatement(node)) return [];

  const expression = node.getExpression();
  if (!expression) return [];

  return findExpressionSources(expression, context);
}

function findParameterArguments(
  parameter: ParameterDeclaration,
  context: TraceContext
): TraceTarget[] {
  const boundArgument = context.bindings.get(getNodeId(parameter));
  if (boundArgument) return [boundArgument];

  return [
    ...findCallSiteArguments(parameter, context),
    ...findReactPropsObjectArguments(parameter, context),
  ];
}

function findCallSiteArguments(
  parameter: ParameterDeclaration,
  context: TraceContext
): TraceTarget[] {
  const functionLike = getParameterFunction(parameter);
  const nameNode = getFunctionNameNode(functionLike);
  if (!functionLike || !nameNode) return [];

  const parameterIndex = functionLike.getParameters().findIndex(candidate => candidate === parameter);
  if (parameterIndex === -1) return [];

  return nameNode
    .findReferencesAsNodes()
    .flatMap(ref => {
      const parent = ref.getParent();

      if (
        Node.isCallExpression(parent) &&
        parent.getExpression() === ref
      ) {
        const arg = parent.getArguments()[parameterIndex];
        return arg ? [toTarget(arg, context, "parameter")] : [];
      }

      return [];
    });
}

function findBindingElementSources(
  bindingElement: BindingElement,
  context: TraceContext
): TraceTarget[] {
  const propertyName = getBindingElementPropertyName(bindingElement);
  const bindingPattern = bindingElement.getParent();
  const bindingOwner = bindingPattern.getParent();

  if (!propertyName) {
    return bindingElement.getInitializer()
      ? [toTarget(bindingElement.getInitializer()!, context, "parameter")]
      : [];
  }

  if (Node.isParameterDeclaration(bindingOwner)) {
    const boundArgument = context.bindings.get(getNodeId(bindingOwner));
    if (boundArgument) {
      return extractPropertyFromTarget(boundArgument, propertyName);
    }

    return findReactPropArguments(bindingOwner, propertyName, context);
  }

  if (Node.isVariableDeclaration(bindingOwner)) {
    const initializer = bindingOwner.getInitializer();
    if (!initializer) return [];

    return findPropertySourcesForExpression(initializer, propertyName, context);
  }

  return [];
}

function getBindingElementPropertyName(bindingElement: BindingElement): string | undefined {
  const propertyNameNode = bindingElement.getPropertyNameNode();

  if (propertyNameNode) {
    return propertyNameNode.getText().replace(/^["']|["']$/g, "");
  }

  const nameNode = bindingElement.getNameNode();
  return Node.isIdentifier(nameNode) ? nameNode.getText() : undefined;
}

function findPropertyAccessSources(
  propertyAccess: PropertyAccessExpression,
  context: TraceContext
): TraceTarget[] {
  return findPropertySourcesForExpression(
    propertyAccess.getExpression(),
    propertyAccess.getName(),
    context
  );
}

function findPropertySourcesForExpression(
  expression: Node,
  propertyName: string,
  context: TraceContext
): TraceTarget[] {
  if (Node.isIdentifier(expression)) {
    const parameter = getParameterDeclarationForIdentifier(expression);

    if (parameter) {
      const boundArgument = context.bindings.get(getNodeId(parameter));
      if (boundArgument) {
        return extractPropertyFromTarget(boundArgument, propertyName);
      }

      return findReactPropArguments(parameter, propertyName, context);
    }

    const objectDefinitions = findIdentifierDefinitions(expression, context);
    const propertyDefinitions = objectDefinitions.flatMap(definition =>
      extractPropertyFromTarget(definition, propertyName)
    );

    return propertyDefinitions.length > 0 ? propertyDefinitions : objectDefinitions;
  }

  if (Node.isObjectLiteralExpression(expression)) {
    return extractPropertyFromObjectLiteral(expression, propertyName, context);
  }

  if (Node.isCallExpression(expression)) {
    return findCallReturnValues(expression, context).flatMap(target =>
      extractPropertyFromTarget(target, propertyName)
    );
  }

  return findExpressionSources(expression, context);
}

function extractPropertyFromTarget(target: TraceTarget, propertyName: string): TraceTarget[] {
  const { node, context } = target;

  if (Node.isObjectLiteralExpression(node)) {
    return extractPropertyFromObjectLiteral(node, propertyName, context);
  }

  if (Node.isReturnStatement(node)) {
    const expression = node.getExpression();
    return expression
      ? findPropertySourcesForExpression(expression, propertyName, context)
      : [];
  }

  if (Node.isCallExpression(node)) {
    return findCallReturnValues(node, context).flatMap(returnTarget =>
      extractPropertyFromTarget(returnTarget, propertyName)
    );
  }

  if (Node.isIdentifier(node)) {
    return findPropertySourcesForExpression(node, propertyName, context);
  }

  return [target];
}

function extractPropertyFromObjectLiteral(
  objectLiteral: Node,
  propertyName: string,
  context: TraceContext
): TraceTarget[] {
  if (!Node.isObjectLiteralExpression(objectLiteral)) return [];

  return objectLiteral.getProperties().flatMap(property => {
    if (Node.isPropertyAssignment(property) && getPropertyName(property.getName()) === propertyName) {
      const initializer = property.getInitializer();
      return initializer ? [toTarget(initializer, context, "property")] : [];
    }

    if (Node.isShorthandPropertyAssignment(property) && property.getName() === propertyName) {
      return [toTarget(property.getNameNode(), context, "property")];
    }

    if (Node.isSpreadAssignment(property)) {
      return findPropertySourcesForExpression(property.getExpression(), propertyName, context);
    }

    return [];
  });
}

function getPropertyName(name: string): string {
  return name.replace(/^["']|["']$/g, "");
}

function findReactPropsObjectArguments(
  parameter: ParameterDeclaration,
  context: TraceContext
): TraceTarget[] {
  const functionLike = getParameterFunction(parameter);
  const nameNode = getFunctionNameNode(functionLike);

  if (!functionLike || !nameNode) return [];

  return findJsxAllPropValuesForComponent(nameNode, context);
}

function findReactPropArguments(
  parameter: ParameterDeclaration,
  propertyName: string,
  context: TraceContext
): TraceTarget[] {
  const functionLike = getParameterFunction(parameter);
  const nameNode = getFunctionNameNode(functionLike);

  if (!functionLike || !nameNode) return [];

  return findJsxPropValuesForComponent(nameNode, propertyName, context);
}

function findJsxPropValuesForComponent(
  componentName: Identifier,
  propertyName: string,
  context: TraceContext
): TraceTarget[] {
  return componentName
    .findReferencesAsNodes()
    .flatMap(ref => getJsxElementPropTargets(ref, propertyName, context));
}

function findJsxAllPropValuesForComponent(
  componentName: Identifier,
  context: TraceContext
): TraceTarget[] {
  return componentName
    .findReferencesAsNodes()
    .flatMap(ref => getJsxElementAllPropTargets(ref, context));
}

function getJsxElementPropTargets(
  ref: Node,
  propertyName: string,
  context: TraceContext
): TraceTarget[] {
  const parent = ref.getParent();

  if (
    Node.isJsxSelfClosingElement(parent) &&
    parent.getTagNameNode() === ref
  ) {
    return getJsxPropTargets(parent, propertyName, context);
  }

  if (
    Node.isJsxOpeningElement(parent) &&
    parent.getTagNameNode() === ref
  ) {
    return getJsxPropTargets(parent, propertyName, context);
  }

  return [];
}

function getJsxElementAllPropTargets(ref: Node, context: TraceContext): TraceTarget[] {
  const parent = ref.getParent();

  if (
    Node.isJsxSelfClosingElement(parent) &&
    parent.getTagNameNode() === ref
  ) {
    return getAllJsxPropTargets(parent, context);
  }

  if (
    Node.isJsxOpeningElement(parent) &&
    parent.getTagNameNode() === ref
  ) {
    return getAllJsxPropTargets(parent, context);
  }

  return [];
}

function getJsxPropTargets(
  element: Node,
  propertyName: string,
  context: TraceContext
): TraceTarget[] {
  if (!Node.isJsxSelfClosingElement(element) && !Node.isJsxOpeningElement(element)) {
    return [];
  }

  const directAttribute = element.getAttribute(propertyName);
  if (directAttribute && Node.isJsxAttribute(directAttribute)) {
    return getJsxAttributeTargets(directAttribute, context);
  }

  return element.getAttributes().flatMap(attribute => {
    if (!Node.isJsxSpreadAttribute(attribute)) return [];
    return findPropertySourcesForExpression(attribute.getExpression(), propertyName, context);
  });
}

function getAllJsxPropTargets(element: Node, context: TraceContext): TraceTarget[] {
  if (!Node.isJsxSelfClosingElement(element) && !Node.isJsxOpeningElement(element)) {
    return [];
  }

  return element.getAttributes().flatMap(attribute => {
    if (Node.isJsxAttribute(attribute)) {
      return getJsxAttributeTargets(attribute, context);
    }

    if (Node.isJsxSpreadAttribute(attribute)) {
      return [toTarget(attribute.getExpression(), context, "property", "JSX spread props")];
    }

    return [];
  });
}

function getJsxAttributeTargets(attribute: Node, context: TraceContext): TraceTarget[] {
  if (!Node.isJsxAttribute(attribute)) return [];

  const initializer = attribute.getInitializer();

  if (!initializer) {
    return [toTarget(attribute, context, "literal", "Boolean JSX prop")];
  }

  if (Node.isJsxExpression(initializer)) {
    const expression = initializer.getExpression();
    return expression
      ? [toTarget(expression, context, "property")]
      : [toTarget(initializer, context, "unknown", "Empty JSX expression")];
  }

  return [toTarget(initializer, context, "property")];
}

function findExpressionSources(node: Node, context: TraceContext): TraceTarget[] {
  if (isTerminalValue(node)) return [];

  if (Node.isIdentifier(node)) {
    return findIdentifierDefinitions(node, context);
  }

  if (Node.isPropertyAccessExpression(node)) {
    return findPropertyAccessSources(node, context);
  }

  if (Node.isCallExpression(node)) {
    return [toTarget(node, context, "call")];
  }

  if (Node.isBinaryExpression(node)) {
    return [
      ...findExpressionSources(node.getLeft(), context),
      ...findExpressionSources(node.getRight(), context),
    ];
  }

  if (Node.isConditionalExpression(node)) {
    return [
      ...findExpressionSources(node.getWhenTrue(), context),
      ...findExpressionSources(node.getWhenFalse(), context),
    ];
  }

  if (Node.isParenthesizedExpression(node)) {
    return findExpressionSources(node.getExpression(), context);
  }

  if (Node.isAsExpression(node) || Node.isSatisfiesExpression(node) || Node.isNonNullExpression(node)) {
    return findExpressionSources(node.getExpression(), context);
  }

  if (Node.isArrayLiteralExpression(node)) {
    return node.getElements().flatMap(element => findExpressionSources(element, context));
  }

  if (Node.isObjectLiteralExpression(node)) {
    return node.getProperties().flatMap(property => {
      if (Node.isPropertyAssignment(property)) {
        const initializer = property.getInitializer();
        return initializer ? [toTarget(initializer, context, "property")] : [];
      }

      if (Node.isShorthandPropertyAssignment(property)) {
        return [toTarget(property.getNameNode(), context, "property")];
      }

      if (Node.isSpreadAssignment(property)) {
        return findExpressionSources(property.getExpression(), context);
      }

      return [];
    });
  }

  return node
    .getDescendants()
    .filter(Node.isIdentifier)
    .flatMap(identifier => findIdentifierDefinitions(identifier, context));
}

function getParameterFunction(parameter: ParameterDeclaration): FunctionLike | undefined {
  const parent = parameter.getParent();

  if (
    Node.isFunctionDeclaration(parent) ||
    Node.isFunctionExpression(parent) ||
    Node.isArrowFunction(parent) ||
    Node.isMethodDeclaration(parent)
  ) {
    return parent;
  }

  return undefined;
}

function getFunctionNameNode(functionLike: FunctionLike | undefined): Identifier | undefined {
  if (!functionLike) return undefined;

  if (Node.isFunctionDeclaration(functionLike) || Node.isMethodDeclaration(functionLike)) {
    const nameNode = functionLike.getNameNode();
    return Node.isIdentifier(nameNode) ? nameNode : undefined;
  }

  const parent = functionLike.getParent();
  if (Node.isVariableDeclaration(parent)) {
    const nameNode = parent.getNameNode();
    return Node.isIdentifier(nameNode) ? nameNode : undefined;
  }

  return undefined;
}

function toTarget(
  node: Node,
  context: TraceContext,
  kind?: GraphNodeKind,
  note?: string
): TraceTarget {
  return { node, context, kind, note };
}

function dedupeTargets(targets: TraceTarget[]): TraceTarget[] {
  const seen = new Set<string>();
  const result: TraceTarget[] = [];

  for (const target of targets) {
    const key = `${getNodeId(target.node)}:${target.kind ?? ""}:${target.note ?? ""}`;
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(target);
  }

  return result;
}

function dedupeNodes<TNode extends Node>(nodes: TNode[]): TNode[] {
  const seen = new Set<string>();
  const result: TNode[] = [];

  for (const node of nodes) {
    const key = getNodeId(node);
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(node);
  }

  return result;
}
