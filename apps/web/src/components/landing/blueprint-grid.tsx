interface BlueprintGridProps {
  /** Unique per instance — SVG pattern ids must not collide on the page. */
  patternId: string;
  width: number;
  height: number;
}

/**
 * The dark hero / final-CTA "blueprint grid" backdrop: a tiled hairline grid
 * rendered as an inline SVG pattern. Purely decorative, so it is hidden from
 * assistive tech.
 */
export function BlueprintGrid({ patternId, width, height }: BlueprintGridProps) {
  return (
    <svg
      className="landing-grid-bg"
      preserveAspectRatio="none"
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={patternId}
          width="46"
          height="46"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M46 0H0V46"
            fill="none"
            stroke="#2c60c0"
            strokeWidth="1"
            opacity="0.28"
          />
        </pattern>
      </defs>
      <rect width={width} height={height} fill={`url(#${patternId})`} />
    </svg>
  );
}
