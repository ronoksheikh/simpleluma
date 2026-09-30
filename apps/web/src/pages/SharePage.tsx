import { Spinner } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LogoMark } from '../components/Logo';
import { api } from '../lib/api';

interface ShareInfo {
  kind: 'version' | 'render';
  title: string;
  label: string;
}

/** The public player: no login, no app chrome. */
export function SharePage() {
  const { token = '' } = useParams();
  const { data, error, isLoading } = useQuery({ queryKey: ['share', token], queryFn: () => api.get<ShareInfo>(`/api/share/${token}`), retry: false });
  const [showTitle, setShowTitle] = useState(true);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setShowTitle(true);
      clearTimeout(timer);
      timer = setTimeout(() => setShowTitle(false), 2500);
    };
    wake();
    window.addEventListener('mousemove', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', wake);
    };
  }, []);

  if (isLoading) return <div className="grid h-full place-items-center bg-night"><Spinner color="current" className="text-white" /></div>;
  if (error || !data) {
    return (
      <div className="brand-gradient grid h-full place-items-center px-6 text-center text-white">
        <div>
          <LogoMark size={48} />
          <h1 className="wordmark mt-5 text-2xl">This link is not available</h1>
          <p className="mt-2 text-white/80">{error?.message ?? 'It may have expired or been turned off by its owner.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-night">
      {data.kind === 'version' ? (
        <iframe title={data.title} src={`/player?base=${encodeURIComponent(`/api/share/${token}/tree`)}`} sandbox="allow-scripts" allow="fullscreen; autoplay" allowFullScreen className="h-full w-full border-0" />
      ) : (
        <video src={`/api/share/${token}/video`} controls playsInline className="h-full w-full object-contain" aria-label={data.title} />
      )}
      <div className={`pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full bg-night/60 py-1.5 pl-2 pr-4 text-sm text-white backdrop-blur transition-opacity duration-500 ${showTitle ? 'opacity-100' : 'opacity-0'}`}>
        <LogoMark size={22} />
        <span>{data.title}</span>
      </div>
    </div>
  );
}
