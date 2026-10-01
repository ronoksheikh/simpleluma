import { Spinner } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { CodeIcon, FileIcon, FolderIcon } from '../icons';

const TEXT = /\.(m?js|json|md|txt|css|html?|svg)$/i;

/** Read-only view of the project's files: what the Director wrote. */
export function CodeTab({ projectId }: { projectId: string }) {
  const { data: files = [] } = useQuery({ queryKey: ['files', projectId], queryFn: () => api.get<string[]>(`/api/projects/${projectId}/files`) });
  const code = useMemo(() => files.filter((f) => !/^(assets|references)\//.test(f)), [files]);
  const [selected, setSelected] = useState<string | null>(null);
  const current = selected ?? code.find((f) => f.startsWith('scenes/')) ?? code[0] ?? null;
  const { data: content, isFetching } = useQuery({
    queryKey: ['file', projectId, current],
    enabled: current !== null && TEXT.test(current),
    queryFn: async () => (await fetch(`/api/projects/${projectId}/files/${current}`)).text(),
  });
  const folders = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const f of code) {
      const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
      map.set(dir, [...(map.get(dir) ?? []), f]);
    }
    return [...map].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  }, [code]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[200px_1fr] gap-3 p-3">
      <nav className="thin-scroll overflow-y-auto rounded-2xl border border-ink/[0.07] bg-white p-2 text-[12.5px]" aria-label="Files">
        {folders.map(([dir, list]) => (
          <div key={dir || 'root'} className="mb-1">
            {dir && <div className="flex items-center gap-1.5 px-2 py-1 text-ink/45"><FolderIcon size={13} />{dir}</div>}
            {list.map((f) => (
              <button key={f} type="button" onClick={() => setSelected(f)} className={`flex w-full items-center gap-1.5 truncate rounded-lg py-1 text-left ${dir ? 'pl-5 pr-2' : 'px-2'} ${f === current ? 'bg-lumablue/10 text-royal' : 'hover:bg-ink/[0.04]'}`}>
                <FileIcon size={12} className="shrink-0 opacity-50" />
                <span className="truncate">{f.split('/').pop()}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-[#15171c]">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 font-mono text-[12px] text-white/60"><CodeIcon size={13} />{current ?? 'No files'}{isFetching && <Spinner size="sm" />}</div>
        <pre className="thin-scroll min-h-0 flex-1 overflow-auto p-3 font-mono text-[12px] leading-relaxed text-[#e8ecf3]">
          {current && !TEXT.test(current) ? 'Binary file.' : (content ?? '').split('\n').map((line, i) => (
            <div key={i} className="flex"><span className="w-10 shrink-0 select-none pr-3 text-right text-white/25">{i + 1}</span><span className="whitespace-pre">{line}</span></div>
          ))}
        </pre>
      </div>
    </div>
  );
}
