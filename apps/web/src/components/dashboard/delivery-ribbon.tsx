import { SPINE_NODES, type SpinePosition } from '@/lib/engagements/stage-spine';

/**
 * Eight stage marks and the two gates between them.
 *
 * Wide marks are stages, narrow uprights are gates. An AMBER upright says the
 * delivery is sitting AT that gate — the design is done and the approval or the
 * instalment is not, which is a different situation from "the 3D is in progress"
 * and the one that decides whether the studio picks up the phone.
 *
 * Purely decorative: every row states its stage in words underneath and its
 * blocker in the badge beside it, so nothing here is carried by shape or colour
 * alone.
 */
// NOTE: --brand is an HSL TRIPLET (`220 79% 54%`), not a colour, so it must be
// wrapped in hsl(). Written bare it silently resolves to nothing and every
// "done" mark renders as an empty box — which is exactly how this shipped the
// first time. The direct-colour tokens (--rule, --warn, --brand-tint, …) are
// used as-is; only the shadcn triplets need the wrapper.
export function DeliveryRibbon({ position }: { position: SpinePosition }) {
  let stageIndex = -1;
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {SPINE_NODES.map((node) => {
        if (node.kind === 'stage') {
          stageIndex += 1;
          const done = position.allComplete || stageIndex < position.index;
          const here = !position.allComplete && stageIndex === position.index;
          return (
            <span
              key={node.key}
              className="block h-1 w-[9px] rounded-sm"
              style={{
                background:
                  done || here ? 'hsl(var(--brand))' : 'var(--rule)',
                boxShadow: here ? '0 0 0 2px var(--brand-tint)' : undefined,
                opacity: position.closed ? 0.4 : 1,
              }}
            />
          );
        }
        // The gate sits AFTER the stage just drawn, so it is behind us only
        // once the current stage is past that one.
        const at = position.atGate === node.key;
        const passed = position.allComplete || position.index > stageIndex;
        return (
          <span
            key={node.key}
            className="block h-[9px] w-1 rounded-[1px]"
            style={{
              background: at
                ? 'var(--warn)'
                : passed
                  ? 'hsl(var(--brand))'
                  : 'var(--rule)',
              boxShadow: at ? '0 0 0 2px var(--warn-tint)' : undefined,
              opacity: position.closed ? 0.4 : 1,
            }}
          />
        );
      })}
    </span>
  );
}
