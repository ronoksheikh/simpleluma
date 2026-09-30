import { Link } from 'react-router-dom';

export function LogoMark({ size = 32 }: { size?: number }) {
  return <img src="/Lumademy_Icon_Blue.svg" alt="" width={size} height={size} className="shrink-0 rounded-[28%]" />;
}

export function Logo({ to = '/', light = false }: { to?: string; light?: boolean }) {
  return (
    <Link to={to} className="flex items-center gap-2.5" aria-label="Luma Studio home">
      <LogoMark />
      <span className={`wordmark text-[19px] ${light ? 'text-white' : 'text-night'}`}>Luma Studio</span>
    </Link>
  );
}
