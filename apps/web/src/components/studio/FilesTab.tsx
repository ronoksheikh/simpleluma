import { Button } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type DragEvent } from 'react';
import { api } from '../../lib/api';
import { notify } from '../../lib/notify';
import type { Attachment } from '../../lib/types';
import { FileIcon, PlusIcon, TrashIcon } from '../icons';

const MAX = 20;

export function FilesTab({ projectId, attachments }: { projectId: string; attachments: Attachment[] }) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { data: files = [] } = useQuery({ queryKey: ['files', projectId], queryFn: () => api.get<string[]>(`/api/projects/${projectId}/files`) });
  const refresh = () => client.invalidateQueries({ queryKey: ['project', projectId] });

  const upload = useMutation({
    mutationFn: (list: File[]) => api.upload(`/api/projects/${projectId}/attachments`, list),
    onSuccess: refresh,
    onError: (e) => notify.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (name: string) => api.del(`/api/projects/${projectId}/attachments/${encodeURIComponent(name)}`),
    onSuccess: refresh,
  });

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) upload.mutate([...e.dataTransfer.files]);
  };

  return (
    <div className="flex flex-col gap-5">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-3xl border-2 border-dashed px-6 py-8 text-center transition-colors ${dragging ? 'border-lumablue bg-lumablue/5' : 'border-night/15 bg-white'}`}
      >
        <input ref={input} type="file" multiple hidden accept="image/*,.svg,.pdf" onChange={(e) => e.target.files && upload.mutate([...e.target.files])} />
        <p className="font-medium">Attach images, SVGs or PDFs</p>
        <p className="text-sm text-night/60">Luma reads them for brand colours, logos and content. {attachments.length} of {MAX} used.</p>
        <Button variant="secondary" size="sm" isPending={upload.isPending} isDisabled={attachments.length >= MAX} onPress={() => input.current?.click()}><PlusIcon size={15} />Choose files</Button>
      </div>

      {attachments.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {attachments.map((a) => (
            <li key={a.name} className="group relative overflow-hidden rounded-2xl bg-white shadow-[0_2px_12px_-4px_rgb(7_23_56/0.08)]">
              <div className="grid aspect-square place-items-center bg-[conic-gradient(#eff5ff_25%,#fff_0_50%,#eff5ff_0_75%,#fff_0)] bg-[length:16px_16px]">
                {a.type.startsWith('image/') ? (
                  <img src={`/api/projects/${projectId}/files/${a.path}`} alt={a.name} className="max-h-full max-w-full object-contain p-2" />
                ) : (
                  <FileIcon size={36} className="text-night/40" />
                )}
              </div>
              <div className="truncate px-3 py-2 text-xs">{a.name}</div>
              <Button size="sm" isIconOnly variant="secondary" aria-label={`Remove ${a.name}`} className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" onPress={() => remove.mutate(a.name)}>
                <TrashIcon size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <details className="rounded-2xl bg-white px-4 py-3 text-sm shadow-[0_2px_12px_-4px_rgb(7_23_56/0.08)]">
        <summary className="cursor-pointer font-medium">All project files ({files.length})</summary>
        <ul className="mt-2 font-mono text-xs text-night/70">{files.map((f) => <li key={f}>{f}</li>)}</ul>
      </details>
    </div>
  );
}
