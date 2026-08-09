// ESLint rule: ban physical left/right in Tailwind class names and inline style
// objects. Use CSS logical properties (margin-inline-start, text-align: start,
// ms-*/me-*/ps-*/pe-*/start-*/end-*/text-start/text-end) so layouts flip with dir.

const PHYSICAL_TW =
  /^-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|inset-l|inset-r|scroll-ml|scroll-mr|scroll-pl|scroll-pr)(?:-|$)|^(?:text-left|text-right|float-left|float-right|clear-left|clear-right)$/;

const PHYSICAL_STYLE_KEYS = new Set([
  'left',
  'right',
  'marginLeft',
  'marginRight',
  'paddingLeft',
  'paddingRight',
  'borderLeft',
  'borderRight',
  'borderLeftWidth',
  'borderRightWidth',
  'borderLeftColor',
  'borderRightColor',
  'borderLeftStyle',
  'borderRightStyle',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'margin-left',
  'margin-right',
  'padding-left',
  'padding-right',
  'border-left',
  'border-right',
]);

/** @type {import('eslint').Rule.RuleModule} */
export const noPhysicalInlineDirection = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban physical left/right in Tailwind classes and inline styles; use logical properties.',
    },
    schema: [],
    messages: {
      twClass:
        'Physical Tailwind utility "{{token}}" is banned. Use the logical equivalent (ms-/me-/ps-/pe-/start-/end-/text-start/text-end).',
      styleKey:
        'Physical CSS property "{{key}}" is banned. Use a logical property (marginInlineStart, insetInlineStart, textAlign: "start", etc).',
      textAlign: 'text-align "{{value}}" is banned. Use "start" or "end".',
    },
  },
  create(context) {
    function checkClassName(node, raw) {
      if (typeof raw !== 'string') return;
      for (const token of raw.split(/\s+/)) {
        const t = token.trim();
        if (t && PHYSICAL_TW.test(t)) {
          context.report({ node, messageId: 'twClass', data: { token: t } });
        }
      }
    }

    return {
      JSXAttribute(node) {
        const name = node.name && node.name.name;
        if (name !== 'className' && name !== 'class') return;
        const value = node.value;
        if (!value) return;
        if (value.type === 'Literal') {
          checkClassName(node, value.value);
        } else if (value.type === 'JSXExpressionContainer' && value.expression) {
          const expr = value.expression;
          if (expr.type === 'Literal') checkClassName(node, expr.value);
          if (expr.type === 'TemplateLiteral') {
            for (const q of expr.quasis) checkClassName(node, q.value.cooked);
          }
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        const fnName =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' && callee.property
              ? callee.property.name
              : null;
        if (!['clsx', 'cn', 'cva', 'twMerge', 'classNames'].includes(fnName))
          return;
        for (const arg of node.arguments) {
          if (arg.type === 'Literal') checkClassName(node, arg.value);
          if (arg.type === 'TemplateLiteral')
            for (const q of arg.quasis) checkClassName(node, q.value.cooked);
        }
      },
      Property(node) {
        const key =
          node.key.type === 'Identifier'
            ? node.key.name
            : node.key.type === 'Literal'
              ? node.key.value
              : null;
        if (key == null) return;
        if (PHYSICAL_STYLE_KEYS.has(key)) {
          context.report({
            node,
            messageId: 'styleKey',
            data: { key: String(key) },
          });
          return;
        }
        if (key === 'textAlign' || key === 'text-align') {
          const v = node.value;
          const val = v && v.type === 'Literal' ? v.value : null;
          if (val === 'left' || val === 'right') {
            context.report({
              node,
              messageId: 'textAlign',
              data: { value: String(val) },
            });
          }
        }
      },
    };
  },
};

export default noPhysicalInlineDirection;
