// Where a string sits, for metra/design-tokens-only: is it a class list?
//
// A class list is a string in a `className` / `class` attribute, an argument of
// a class helper (cn, clsx, cva, ...), or a const class map / class-returning
// function whose NAME says so (`const SECTION_LABEL = ...`, `{ chip: ... }`,
// `function barClass() { return ... }`). Anywhere else (a translation key, a
// URL, `data-shape="rounded"`, a MIME string) a lone word like "text-base" is
// not a class, so it is only checked when it cannot be anything else: several
// class-shaped tokens, or one carrying `[...]`, a `:` variant, or a palette or
// weight utility no prose would contain.

const CLASS_ATTRS = new Set(['className', 'class']);
const CLASS_FNS = new Set(['cn', 'clsx', 'cva', 'cx', 'twMerge', 'classNames']);
/** Helpers whose object argument means `{ 'some-class': condition }`. */
const CONDITIONAL_CLASS_FNS = new Set(['cn', 'clsx', 'cx', 'classNames']);
const CLASSY_NAME =
  /class|style|tone|variant|pill|chip|badge|label|cell|grid|ring|base|active|idle|stripe|border/i;
const EXPRESSION_HOPS = new Set([
  'JSXExpressionContainer',
  'TemplateLiteral',
  'ConditionalExpression',
  'LogicalExpression',
  'BinaryExpression',
  'ArrayExpression',
  'ObjectExpression',
  'Property',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'ParenthesizedExpression',
  'SpreadElement',
]);

export function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

function nameOf(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal') return String(node.value);
  return null;
}

/** The nearest function's own name (declaration, or the variable it is bound to). */
function functionName(fn) {
  if (fn.id) return fn.id.name;
  if (fn.parent?.type === 'VariableDeclarator') return nameOf(fn.parent.id);
  if (fn.parent?.type === 'Property') return nameOf(fn.parent.key);
  return null;
}

/**
 * Classify the string `node`: `{ kind: 'class' | 'maybe' | 'no', root }`. `root`
 * is the whole class expression the string belongs to (the attribute value, the
 * helper call, the declarator init), so a pairing such as `font-mono` with
 * `tabular-nums` is seen across separate literals of one expression.
 */
export function classify(node) {
  let child = node;
  let current = node.parent;
  let namedHint = false;
  while (current) {
    switch (current.type) {
      case 'JSXAttribute':
        return CLASS_ATTRS.has(current.name?.name)
          ? { kind: 'class', root: current.value }
          : { kind: 'no' };
      case 'CallExpression':
        if (child === current.callee) return { kind: 'no' };
        return CLASS_FNS.has(calleeName(current.callee))
          ? { kind: 'class', root: current }
          : { kind: 'no' };
      case 'Property':
        // A key is a class only in `cn({ 'some-class': condition })`.
        if (child === current.key && !current.computed && !isConditionalClassObject(current.parent)) {
          return { kind: 'no' };
        }
        if (CLASSY_NAME.test(nameOf(current.key) ?? '')) namedHint = true;
        break;
      case 'VariableDeclarator':
        return {
          kind: namedHint || CLASSY_NAME.test(nameOf(current.id) ?? '') ? 'class' : 'maybe',
          root: current.init,
        };
      case 'ReturnStatement':
      case 'ArrowFunctionExpression': {
        const fn =
          current.type === 'ArrowFunctionExpression'
            ? current
            : findEnclosingFunction(current);
        const named = CLASSY_NAME.test((fn && functionName(fn)) ?? '');
        return { kind: namedHint || named ? 'class' : 'maybe', root: child };
      }
      default:
        if (!EXPRESSION_HOPS.has(current.type)) return { kind: 'no' };
    }
    child = current;
    current = current.parent;
  }
  return { kind: 'no' };
}

function findEnclosingFunction(node) {
  let current = node.parent;
  while (current) {
    if (/Function/.test(current.type)) return current;
    current = current.parent;
  }
  return null;
}

/** Every string inside `root`: literals, template chunks, conditional-class keys. */
export function stringsUnder(root) {
  const out = [];
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Literal' && typeof node.value === 'string') out.push(node.value);
    if (node.type === 'TemplateElement') out.push(node.value.cooked ?? '');
    if (node.type === 'Property' && !node.computed && node.key.type === 'Identifier') {
      out.push(node.key.name);
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value.type === 'string') visit(value);
    }
  };
  visit(root);
  return out;
}

/** `{ 'some-class': condition }` passed straight to cn / clsx / classNames. */
export function isConditionalClassObject(objectNode) {
  let current = objectNode.parent;
  while (current?.type === 'ArrayExpression') current = current.parent;
  return (
    current?.type === 'CallExpression' &&
    CONDITIONAL_CLASS_FNS.has(calleeName(current.callee))
  );
}

/** The string is (part of) the className of a JSX element with dir="ltr". */
export function onLtrElement(node) {
  let current = node.parent;
  while (current && current.type !== 'JSXAttribute') current = current.parent;
  if (!current || !CLASS_ATTRS.has(current.name?.name)) return false;
  return current.parent.attributes.some((attribute) => {
    if (attribute.type !== 'JSXAttribute' || attribute.name?.name !== 'dir') return false;
    const value =
      attribute.value?.type === 'JSXExpressionContainer'
        ? attribute.value.expression
        : attribute.value;
    if (value?.type === 'Literal') return value.value === 'ltr';
    return (
      value?.type === 'TemplateLiteral' &&
      value.expressions.length === 0 &&
      value.quasis[0]?.value.cooked === 'ltr'
    );
  });
}

/** A JSX `style` object, also behind a ternary or `&&`. */
export function isJsxStyleObject(node) {
  let current = node.parent;
  while (current?.type === 'ConditionalExpression' || current?.type === 'LogicalExpression') {
    current = current.parent;
  }
  return (
    current?.type === 'JSXExpressionContainer' &&
    current.parent?.type === 'JSXAttribute' &&
    current.parent.name?.name === 'style'
  );
}
