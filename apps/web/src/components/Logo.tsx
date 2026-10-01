import { Link } from 'react-router-dom';

/** The Luma Studio fan emblem on its gradient tile. */
export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return <img src="/luma-icon.svg" alt="" width={size} height={size} className={`shrink-0 ${className}`} draggable={false} />;
}

/** The emblem alone, in the brand gradient (or white on colour). */
export function LogoSymbol({ size = 28, light = false }: { size?: number; light?: boolean }) {
  return <img src={light ? '/luma-mark-white.svg' : '/luma-mark.svg'} alt="" width={size} height={size} className="shrink-0" draggable={false} />;
}

export function Logo({ to = '/', light = false, size = 30 }: { to?: string; light?: boolean; size?: number }) {
  return (
    <Link to={to} className="flex items-center gap-2" aria-label="Luma Studio home">
      <LogoSymbol size={size} light={light} />
      <span className={`wordmark text-[18px] ${light ? 'text-white' : 'text-ink'}`}>Luma Studio</span>
    </Link>
  );
}
