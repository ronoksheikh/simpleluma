import { Button, Chip, Tooltip } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStudio } from '../../lib/studio';
import type { Attachment } from '../../lib/types';
import { EyeIcon, FileIcon, FolderIcon, PaperclipIcon, PlusIcon, TrashIcon, XIcon, ZipIcon } from '../icons';
import { useUpload } from './ChatPanel';

const ACCEPT = 'image/*,.svg,.pdf,.zip,.html,.htm,.md,.txt,.json,.woff,.woff2,.ttf,.otf,.mp3,.wav,.m4a';

function ReferencePlayer({ path, onClose }: { path: string; onClose: () => void }) {
  const { projectId } = useStudio();
  const { data: token } = useQuery({ queryKey: ['preview-token', projectId], queryFn: () => api.post<{ base: string }>(`/api/projects/${projectId}/preview-token`), staleTime: 10 * 3600 * 1000 });
  const [run, setRun] = useState(0);
  return (
    <div className="overflow-hidden rounded-2xl border border-ink/[0.08] bg-white">
      <div className="flex items-center gap-2 border-b border-ink/[0.06] px-3 py-2 text-[12.5px]">
        <EyeIcon size={14} className="text-lumablue" />
        <span className="min-w-0 flex-1 truncate font-medium">{path}</span>
        <Button size="sm" variant="ghost" onPress={() => setRun((r) => r + 1)}>Replay</Button>
        <button type="button" aria-label="Close" onClick={onClose} className="text-ink/40 hover:text-ink"><XIcon size={15} /></button>
      </div>
      <div className="aspect-video bg-stage">
        {token && <iframe key={run} title={`Reference ${path}`} src={`${token.base}/${path.split('/').map(encodeURIComponent).join('/')}`} sandbox="allow-scripts" className="h-full w-full border-0" />}
      </div>
    </div>
  );
}

export function AssetsTab({ attachments }: { attachments: Attachment[] }) {
  const { projectId, attachToDraft, send, chat } = useStudio();
  const client = useQueryClient();
  const { upload, uploading } = useUpload();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (path: string) => api.del(`/api/projects/${projectId}/attachments?path=${encodeURIComponent(path)}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['project', projectId] }),
    onError: (e) => notify.error(e.message),
  });

  const references = attachments.filter((a) => a.reference);
  const groups = useMemo(() => {
    const map = new Map<string, Attachment[]>();
    for (const a of attachments.filter((x) => !x.reference)) {
      const folder = a.name.includes('/') ? a.name.slice(0, a.name.lastIndexOf('/')) : '';
      map.set(folder, [...(map.get(folder) ?? []), a]);
    }
    return [...map].sort(([a], [b]) => a.localeCompare(b));
  }, [attachments]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void upload([...e.dataTransfer.files], false);
  };

  return (
    <div className="thin-scroll h-full overflow-y-auto p-5">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-7 text-center transition-colors ${dragging ? 'border-lumablue bg-lumablue/5' : 'border-ink/12 bg-white'}`}
      >
        <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { void upload([...(e.target.files ?? [])], false); e.target.value = ''; }} />
        <span className="flex gap-1.5 text-ink/40"><PaperclipIcon size={18} /><ZipIcon size={18} /><EyeIcon size={18} /></span>
        <p className="text-[14px] font-medium">Drop brand kits, logos, docs, fonts or a zip</p>
        <p className="max-w-sm text-[12.5px] text-ink/50">The Director reads them: logos and guidelines become brand.json, HTML files become motion references it can watch and study.</p>
        <Button variant="secondary" size="sm" isPending={uploading} onPress={() => input.current?.click()}><PlusIcon size={14} />Choose files</Button>
      </div>

      {references.length > 0 && (
        <section className="mt-6">
          <h3 className="text-[13.5px] font-semibold">Motion references</h3>
          <p className="text-[12px] text-ink/50">HTML demos the Director can watch frame by frame and match.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {references.map((r) => (
              <li key={r.path} className="flex items-center gap-2 rounded-xl border border-ink/[0.07] bg-white px-3 py-2">
                <EyeIcon size={15} className="text-lumablue" />
                <span className="min-w-0 flex-1 truncate text-[13px]">{r.name}</span>
                <Button size="sm" variant="ghost" onPress={() => setPlaying(r.path)}>Play</Button>
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={chat.running}
                  onPress={() => void send(`Use ${r.path} as the motion reference: watch it with view_reference, read its source, then recreate its pacing, easing and layout for this video with our brand.`, { attachments: [r.path] })}
                >
                  Use as reference
                </Button>
                <button type="button" aria-label={`Delete ${r.name}`} onClick={() => remove.mutate(r.path)} className="text-ink/35 hover:text-danger"><TrashIcon size={14} /></button>
              </li>
            ))}
          </ul>
          {playing && <div className="mt-3"><ReferencePlayer path={playing} onClose={() => setPlaying(null)} /></div>}
        </section>
      )}

      {groups.map(([folder, items]) => (
        <section key={folder || 'root'} className="mt-6">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink/70"><FolderIcon size={14} />assets/{folder}<span className="font-normal text-ink/40">· {items.length}</span></h3>
          <ul className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
            {items.map((a) => (
              <li key={a.path} className="group relative overflow-hidden rounded-xl border border-ink/[0.07] bg-white">
                <div className="checker grid aspect-[4/3] place-items-center">
                  {a.type.startsWith('image/') ? (
                    <img src={`/api/projects/${projectId}/files/${a.path}`} alt={a.name} className="max-h-full max-w-full object-contain p-2" loading="lazy" />
                  ) : (
                    <span className="flex flex-col items-center gap-1 text-ink/40"><FileIcon size={26} /><span className="font-mono text-[10px] uppercase">{a.name.split('.').pop()}</span></span>
                  )}
                </div>
                <div className="truncate px-2.5 py-1.5 text-[11.5px]" title={a.path}>{a.name.split('/').pop()}</div>
                <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <Tooltip delay={200}>
                    <Tooltip.Trigger>
                      <Button size="sm" isIconOnly variant="secondary" aria-label={`Add ${a.name} to the message`} onPress={() => attachToDraft([a.path])}><PaperclipIcon size={13} /></Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>Add to message</Tooltip.Content>
                  </Tooltip>
                  <Button size="sm" isIconOnly variant="secondary" aria-label={`Delete ${a.name}`} onPress={() => remove.mutate(a.path)}><TrashIcon size={13} /></Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {attachments.length === 0 && <p className="mt-6 text-center text-[13px] text-ink/45">No files yet.</p>}
      {attachments.length > 0 && <p className="mt-6 text-center"><Chip size="sm" variant="soft"><Chip.Label>{attachments.length} files</Chip.Label></Chip></p>}
    </div>
  );
}
