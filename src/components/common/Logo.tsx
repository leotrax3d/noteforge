/** App-Logo (Quelle: assets/logo.svg, ausgeliefert als /logo.svg). */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return <img src="/logo.svg" width={size} height={size} alt="" aria-hidden className={className} draggable={false} />;
}
