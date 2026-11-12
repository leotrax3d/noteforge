// Kleines Molekül-Symbol (drei verbundene Atome) im lucide-Stil.
import type { SVGProps } from "react";

export function MoleculeIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      <circle cx="6" cy="16" r="2.5" /><circle cx="12" cy="7" r="2.5" /><circle cx="18" cy="16" r="2.5" />
      <path d="M7.4 13.9 10.6 9.1M13.4 9.1l3.2 4.8M8.5 16h7" />
    </svg>
  );
}
