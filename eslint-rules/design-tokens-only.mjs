// ESLint rule: the design system is six type sizes, four corner sizes (plus
// none / full), semantic colours and four font weights. Anything else drifts.
// Uppercase, letter-spacing and mono are Latin-only and must be scoped so.
//
// It checks CLASS LISTS (see design-tokens-context.mjs for what counts as one:
// className, class helpers, named const class maps, class-returning functions),
// the keys of `cn({ 'class': condition })`, and JSX `style` objects. Comments
// are never visited: prose that names a banned class is fine.
//
// Each string is split on whitespace; per token a leading `!` is dropped and
// the variant chain is split on `:` outside `[...]`. The last segment is the
// utility; the rest are its variants (`sm:`, `hover:`, `file:`, ...).

import {
  classify,
  isConditionalClassObject,
  isJsxStyleObject,
  onLtrElement,
  stringsUnder,
} from './design-tokens-context.mjs';

const TYPE_TOKENS = 'caption, small, body, title, heading, display';
const RADIUS_VALUES = new Set(['none', 'item', 'panel', 'frame', 'pill', 'full']);

// An arbitrary text value is a SIZE when it is a number, a math function, or
// hinted `length:` (`text-[color:...]` and a bare `text-[var(--x)]` are colours).
const OFF_SCALE_TYPE =
  /^text-(\[(length:|[0-9.]|calc\(|clamp\(|min\(|max\()|(xs|sm|base|lg|xl|[2-9]xl)$)/;
const RADIUS = /^rounded(?:-(s|e|t|b|ss|se|es|ee|tl|tr|bl|br))?(?:-(.+))?$/;
const PALETTE_COLOUR =
  /^(bg|text|border|ring|outline|fill|stroke|from|via|to|divide|placeholder|decoration|shadow|accent|caret)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}(\/[0-9]+)?$/;
const OFF_SET_WEIGHT = /^font-(thin|extralight|light|extrabold|black|\[.+\])$/;
const BANNED_STYLE_KEY =
  /^(fontSize|fontWeight|letterSpacing|lineHeight|font|border(Top|Bottom|Start|End)?(Left|Right|Start|End)?Radius)$/;
// Arabic script is joined: letter-spacing tears the joins apart, a monospace
// face has no Arabic glyphs worth the name, and Arabic has no case. These are
// Latin-only typography, so they must be scoped to Latin (an `ltr:` variant, an
// element marked dir="ltr", or figures: `tabular` in the same class expression).
const ARABIC_UNSAFE = /^(uppercase|tracking-.+|font-mono)$/;
const ALWAYS_SAFE = new Set(['tracking-[var(--tracking-num)]']);
const FIGURES = new Set(['tabular', 'tabular-nums']);

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

/** A lone token outside a class position is checked only when no prose looks like it. */
function unmistakablyAClass(token) {
  const { variants, utility } = splitVariants(token);
  return (
    variants.length > 0 ||
    token.includes('[') ||
    PALETTE_COLOUR.test(utility) ||
    OFF_SET_WEIGHT.test(utility) ||
    /^rounded-/.test(utility)
  );
}

function hasFigures(strings) {
  return strings.some((value) =>
    value.split(/\s+/).some((token) => token && FIGURES.has(splitVariants(token).utility)),
  );
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
      arabicUnsafe:
        '"{{token}}" breaks Arabic (joined script, no case, no mono glyphs). Scope it with ltr:, put it on a dir="ltr" element, or (mono/tracking) pair it with tabular figures.',
    },
  },
  create(context) {
    const filename = context.filename.replace(/\\/g, '/');
    const displayAllowed = DISPLAY_ALLOWED.some((path) => filename.includes(path));

    function checkToken(node, token, latinScoped, figures) {
      const { variants, utility } = splitVariants(token);
      const report = (messageId) => context.report({ node, messageId, data: { token } });
      if (OFF_SCALE_TYPE.test(withoutModifier(utility))) return report('offScaleType');
      if (utility === 'text-display' && !displayAllowed) return report('displayOutsideDashboard');
      if (isOffScaleRadius(utility)) return report('offScaleRadius');
      if (PALETTE_COLOUR.test(utility)) return report('paletteColour');
      if (OFF_SET_WEIGHT.test(utility)) return report('offSetWeight');
      if (ARABIC_UNSAFE.test(utility) && !ALWAYS_SAFE.has(utility)) {
        const scoped = latinScoped || variants.includes('ltr');
        const isFigure = figures && utility !== 'uppercase';
        if (!scoped && !isFigure) return report('arabicUnsafe');
      }
    }

    /** `node` is the reporting node; `stringNode` the string's own AST position. */
    function checkString(node, value, stringNode = node) {
      if (typeof value !== 'string') return;
      const tokens = value.split(/\s+/).filter(Boolean);
      if (tokens.length === 0) return;
      const { kind, root } = classify(stringNode);
      if (kind === 'no') return;
      const inTemplateWithExpressions =
        stringNode.type === 'TemplateElement' && stringNode.parent.expressions.length > 0;
      if (
        kind === 'maybe' &&
        tokens.length === 1 &&
        !inTemplateWithExpressions &&
        !unmistakablyAClass(tokens[0])
      ) {
        return;
      }
      const latinScoped = onLtrElement(stringNode);
      const figures = hasFigures(root ? stringsUnder(root) : [value]);
      for (const token of tokens) checkToken(node, token, latinScoped, figures);
    }

    return {
      Literal(node) {
        checkString(node, node.value);
      },
      TemplateElement(node) {
        checkString(node, node.value.cooked);
      },
      // `cn({ uppercase: isLabel })`: an identifier key there is a class.
      Property(node) {
        if (node.computed || node.key.type !== 'Identifier') return;
        if (!isConditionalClassObject(node.parent)) return;
        checkString(node.key, node.key.name, node.value);
      },
      ObjectExpression(node) {
        if (!isJsxStyleObject(node)) return;
        for (const property of node.properties) {
          if (property.type !== 'Property') continue;
          const key =
            property.key.type === 'Identifier' ? property.key.name : property.key.value;
          if (BANNED_STYLE_KEY.test(String(key))) {
            context.report({ node: property, messageId: 'styleKey', data: { key: String(key) } });
          }
        }
      },
    };
  },
};

export default designTokensOnly;
