import { Button, ProgressBar, Spinner } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { notify } from '../../lib/notify';
import { useStudio } from '../../lib/studio';
import type { Checkpoint, Todo } from '../../lib/types';
import { CheckIcon, FlagIcon, PlusIcon, RestoreIcon, TrashIcon } from '../icons';
import { ConfirmDialog } from '../ConfirmDialog';

function StatusIcon({ status }: { status: Todo['status'] }) {
  if (status === 'done') return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success text-white"><CheckIcon size={12} /></span>;
  if (status === 'in_progress') return <span className="grid size-5 shrink-0 place-items-center"><Spinner size="sm" /></span>;
  return <span className="size-5 shrink-0 rounded-full border-[1.5px] border-ink/20" />;
}

export function PlanTab() {
  const { projectId, chat } = useStudio();
  const client = useQueryClient();
  const [adding, setAdding] = useState('');
  const [restoring, setRestoring] = useState<Checkpoint | null>(null);
  const { data: checkpoints = [] } = useQuery({ queryKey: ['checkpoints', projectId], queryFn: () => api.get<Checkpoint[]>(`/api/projects/${projectId}/checkpoints`) });
  const todos = chat.todos;
  const done = todos.filter((t) => t.status === 'done').length;

  const save = useMutation({
    mutationFn: (items: Array<Pick<Todo, 'text' | 'status'>>) => api.put(`/api/projects/${projectId}/todos`, { items }),
    onError: (e) => notify.error(e.message),
  });
  const cycle = (t: Todo) => {
    const next = t.status === 'pending' ? 'in_progress' : t.status === 'in_progress' ? 'done' : 'pending';
    save.mutate(todos.map((x) => ({ text: x.text, status: x.id === t.id ? next : x.status })));
  };
  const restore = useMutation({
    mutationFn: (c: Checkpoint) => api.post(`/api/projects/${projectId}/checkpoints/${c.id}/restore`),
    onSuccess: () => {
      notify.success('Restored the checkpoint as a new version');
      void client.invalidateQueries({ queryKey: ['history', projectId] });
    },
    onError: (e) => notify.error(e.message),
  });

  return (
    <div className="thin-scroll h-full overflow-y-auto p-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">Plan</h3>
          <p className="text-[12.5px] text-ink/50">The Director keeps this checklist current. Click a step to change its status.</p>
        </div>
        {todos.length > 0 && <span className="text-[13px] font-medium tabular-nums text-ink/60">{done} / {todos.length}</span>}
      </div>
      {todos.length > 0 && (
        <ProgressBar className="mt-3" size="sm" value={Math.round((done / todos.length) * 100)} aria-label="Plan progress">
          <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
        </ProgressBar>
      )}
      <ol className="mt-4 flex flex-col gap-1">
        {todos.map((t, i) => (
          <li key={t.id} className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-ink/[0.03]">
            <button type="button" onClick={() => cycle(t)} aria-label={`Mark “${t.text}”`} className="shrink-0"><StatusIcon status={t.status} /></button>
            <span className="w-5 shrink-0 text-[12px] tabular-nums text-ink/35">{i + 1}</span>
            <span className={`flex-1 text-[13.5px] ${t.status === 'done' ? 'text-ink/45 line-through decoration-ink/20' : t.status === 'in_progress' ? 'font-medium' : ''}`}>{t.text}</span>
            <button type="button" aria-label="Remove step" onClick={() => save.mutate(todos.filter((x) => x.id !== t.id).map(({ text, status }) => ({ text, status })))} className="opacity-0 transition-opacity group-hover:opacity-100"><TrashIcon size={14} className="text-ink/40 hover:text-danger" /></button>
          </li>
        ))}
      </ol>
      {todos.length === 0 && <p className="mt-4 rounded-xl border border-dashed border-ink/15 px-4 py-6 text-center text-[13px] text-ink/50">No plan yet. The Director writes one when it starts a job, or add steps yourself.</p>}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!adding.trim()) return;
          save.mutate([...todos.map(({ text, status }) => ({ text, status })), { text: adding.trim(), status: 'pending' }]);
          setAdding('');
        }}
      >
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a step…" className="flex-1 rounded-xl border border-ink/10 bg-white px-3 py-2 text-[13px] outline-none focus:border-lumablue/50" />
        <Button type="submit" size="sm" variant="secondary" isDisabled={!adding.trim()}><PlusIcon size={14} />Add</Button>
      </form>

      <h3 className="mt-8 text-[15px] font-semibold">Checkpoints</h3>
      <p className="text-[12.5px] text-ink/50">Saved progress on long jobs. Each one is a version you can return to.</p>
      <ol className="mt-3 flex flex-col gap-2">
        {checkpoints.map((c) => (
          <li key={c.id} className="rounded-xl border border-ink/[0.07] bg-white p-3">
            <div className="flex items-center gap-2 text-[12px] text-ink/50">
              <FlagIcon size={13} className={c.auto ? 'text-ink/40' : 'text-lumablue'} />
              <span>{c.auto ? 'Automatic' : 'Director'} · step {c.step} · {timeAgo(c.createdAt)}</span>
              {c.sha && <span className="font-mono">{c.sha.slice(0, 7)}</span>}
              <span className="flex-1" />
              {c.sha && <Button size="sm" variant="ghost" isDisabled={chat.running} onPress={() => setRestoring(c)}><RestoreIcon size={13} />Restore</Button>}
            </div>
            <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[13px] text-ink/80">{c.summary}</p>
          </li>
        ))}
        {checkpoints.length === 0 && <li className="text-[13px] text-ink/45">None yet.</li>}
      </ol>
      <ConfirmDialog
        isOpen={restoring !== null}
        title="Restore this checkpoint?"
        message="The files go back to this checkpoint as a new version. Nothing is lost: History keeps every version."
        confirmLabel="Restore"
        onConfirm={() => restoring && restore.mutate(restoring)}
        onClose={() => setRestoring(null)}
      />
    </div>
  );
}
