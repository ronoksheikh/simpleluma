import { Button, Chip, TextArea } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { notify } from '../../lib/notify';
import type { Memory } from '../../lib/types';
import { BrainIcon, TrashIcon } from '../icons';

/** Memory the Director reads in every conversation: this project's notes, and notes about the user for every project. */
export function MemoryList({ projectId }: { projectId: string | null }) {
  const client = useQueryClient();
  const key = ['memories', projectId ?? 'global'];
  const { data: memories = [] } = useQuery({ queryKey: key, queryFn: () => api.get<Memory[]>(`/api/memories${projectId ? `?project=${projectId}` : ''}`) });
  const [text, setText] = useState('');
  const [global, setGlobal] = useState(projectId === null);
  const refresh = () => client.invalidateQueries({ queryKey: ['memories'] });
  const add = useMutation({
    mutationFn: () => api.post('/api/memories', { content: text, project: global ? undefined : projectId }),
    onSuccess: () => {
      setText('');
      void refresh();
    },
    onError: (e) => notify.error(e.message),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/memories/${id}`), onSuccess: refresh });
  const shown = projectId ? memories : memories.filter((m) => !m.projectId);

  return (
    <div>
      <ul className="flex flex-col gap-2">
        {shown.map((m) => (
          <li key={m.id} className="group flex items-start gap-3 rounded-xl border border-ink/[0.07] bg-white px-3 py-2.5">
            <BrainIcon size={15} className="mt-0.5 shrink-0 text-lumablue" />
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap text-[13.5px]">{m.content}</p>
              <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink/45">
                <Chip size="sm" variant="soft" color={m.projectId ? 'accent' : 'default'}><Chip.Label>{m.projectId ? 'This video' : 'All videos'}</Chip.Label></Chip>
                {m.source === 'director' ? 'saved by the Director' : 'added by you'} · {timeAgo(m.createdAt)}
              </p>
            </div>
            <button type="button" aria-label="Forget" onClick={() => remove.mutate(m.id)} className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"><TrashIcon size={14} className="text-ink/40 hover:text-danger" /></button>
          </li>
        ))}
        {shown.length === 0 && <li className="rounded-xl border border-dashed border-ink/15 px-4 py-6 text-center text-[13px] text-ink/50">Nothing remembered yet. The Director saves preferences and decisions here as you work.</li>}
      </ul>
      <form className="mt-4 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }}>
        <TextArea aria-label="Something to remember" value={text} onChange={(e) => setText(e.target.value)} placeholder={global ? 'e.g. I prefer calm motion and lots of whitespace' : 'e.g. The client approved the blue gradient ending'} rows={2} />
        <div className="flex items-center gap-2">
          {projectId && (
            <label className="flex items-center gap-2 text-[12.5px] text-ink/60">
              <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} className="accent-[#2970EC]" />
              Remember for all videos
            </label>
          )}
          <span className="flex-1" />
          <Button type="submit" size="sm" isDisabled={!text.trim()} isPending={add.isPending}>Remember</Button>
        </div>
      </form>
    </div>
  );
}

export function MemoryTab({ projectId }: { projectId: string }) {
  return (
    <div className="thin-scroll h-full overflow-y-auto p-5">
      <h3 className="text-[15px] font-semibold">Memory</h3>
      <p className="mb-4 text-[12.5px] text-ink/50">The Director reads this in every conversation. Notes for “all videos” follow you to every project.</p>
      <MemoryList projectId={projectId} />
    </div>
  );
}
