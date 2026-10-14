// The small layout pieces every client link page (/p, /c, /v) shares.

/** A page that has nothing but one sentence to say (a link that does not work). */
export function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-center text-muted-foreground">
      {children}
    </div>
  );
}

/** One label and figure of a totals card. */
export function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span dir="ltr">{value}</span>
    </div>
  );
}
