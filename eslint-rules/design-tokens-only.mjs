// ESLint rule: the design system is six type sizes, four corner sizes (plus
// none / full), semantic colours and four font weights. Anything else drifts.
//
// Unlike `no-physical-inline-direction`, this visits EVERY string literal and
// template chunk in the file, not only className / cn() arguments, so a class
// string kept in a const map (`const STATUS_STYLE = { ... }`) is covered too.
// Comments are never visited: prose that names a banned class is fine.
//
// Each string is split on whitespace; per token a leading `!` is dropped and
// the variant chain is split on `:` outside `[...]`. The last segment is the
// utility; the rest are its variants (`sm:`, `hover:`, `file:`, ...).

const TYPE_TOKENS = 'caption, small, body, title, heading, display';
const RADIUS_VALUES = new Set(['none', 'item', 'panel', 'frame', 'pill', 'full']);

const OFF_SCALE_TYPE = /^text-(\[(length:)?[0-9.]|(xs|sm|base|lg|xl|[2-9]xl)$)/;
const RADIUS = /^rounded(?:-(s|e|t|b|ss|se|es|ee|tl|tr|bl|br))?(?:-(.+))?$/;
const PALETTE_COLOUR =
  /^(bg|text|border|ring|outline|fill|stroke|from|via|to|divide|placeholder|decoration|shadow|accent|caret)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}(\/[0-9]+)?$/;
const OFF_SET_WEIGHT = /^font-(thin|extralight|light|extrabold|black|\[.+\])$/;
const BANNED_STYLE_KEYS = new Set(['fontSize', 'borderRadius', 'fontWeight', 'letterSpacing']);

// Display (28px) is the dashboard's hero figure size and nothing else's.
const DISPLAY_ALLOWED = [
  '/components/dashboard/',
  '/app/[locale]/(app)/dashboard/',
  '/components/ui/stat-card.tsx',
];

/** Split a class token into its variants and the utility, honouring `[...]`. */
export function splitVariants(token) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of token) {
    if (char === '[') depth += 1;
    if (char === ']') depth = Math.max(0, depth - 1);
    if (char === ':' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  const utility = parts.pop().replace(/^!/, '');
  return { variants: parts, utility };
}

function isOffScaleRadius(utility) {
  const match = RADIUS.exec(utility);
  if (!match) return false;
  return !RADIUS_VALUES.has(match[2] ?? '');
}

function withoutModifier(utility) {
  return utility.startsWith('text-[') ? utility : utility.replace(/\/[^/]+$/, '');
}

/** @type {import('eslint').Rule.RuleModule} */
export const designTokensOnly = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Only the design tokens: six type sizes, four radii, semantic colours, four weights.',
    },
    schema: [],
    messages: {
      offScaleType: `Text size "{{token}}" is off the scale. Use one of text-{${TYPE_TOKENS}}.`,
      displayOutsideDashboard:
        '"text-display" is the dashboard hero size only. Use text-heading for a page title.',
      offScaleRadius:
        'Radius "{{token}}" is off the scale. Use rounded-item, -panel, -frame, -pill, -full or -none.',
      paletteColour:
        'Tailwind palette colour "{{token}}" bypasses the theme. Use a semantic token (bg-brand-tint, [color:var(--warn)], ...).',
      offSetWeight:
        'Font weight "{{token}}" is not loaded. Use font-normal, font-medium, font-semibold or font-bold.',
      styleKey:
        'Inline style "{{key}}" bypasses the design tokens. Use the matching Tailwind token class.',
    },
  },
  create(context) {
    const filename = context.filename.replace(/\\/g, '/');
    const displayAllowed = DISPLAY_ALLOWED.some((path) => filename.includes(path));

    function checkToken(node, token) {
      const { utility } = splitVariants(token);
      const report = (messageId) => context.report({ node, messageId, data: { token } });
      if (OFF_SCALE_TYPE.test(withoutModifier(utility))) return report('offScaleType');
      if (utility === 'text-display' && !displayAllowed) return report('displayOutsideDashboard');
      if (isOffScaleRadius(utility)) return report('offScaleRadius');
      if (PALETTE_COLOUR.test(utility)) return report('paletteColour');
      if (OFF_SET_WEIGHT.test(utility)) return report('offSetWeight');
    }

    function checkString(node, value) {
      if (typeof value !== 'string') return;
      for (const token of value.split(/\s+/)) {
        if (token) checkToken(node, token);
      }
    }

    function isJsxStyleObject(node) {
      const container = node.parent;
      return (
        container?.type === 'JSXExpressionContainer' &&
        container.parent?.type === 'JSXAttribute' &&
        container.parent.name?.name === 'style'
      );
    }

    return {
      Literal(node) {
        checkString(node, node.value);
      },
      TemplateElement(node) {
        checkString(node, node.value.cooked);
      },
      ObjectExpression(node) {
        if (!isJsxStyleObject(node)) return;
        for (const property of node.properties) {
          if (property.type !== 'Property') continue;
          const key =
            property.key.type === 'Identifier' ? property.key.name : property.key.value;
          if (BANNED_STYLE_KEYS.has(key)) {
            context.report({ node: property, messageId: 'styleKey', data: { key: String(key) } });
          }
        }
      },
    };
  },
};

export default designTokensOnly;
