import { Button, Chip, Skeleton } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { notify } from '../../lib/notify';
import type { CommitInfo } from '../../lib/types';
import { ConfirmDialog } from '../ConfirmDialog';
import { ChevronIcon, RestoreIcon, ShareIcon } from '../icons';
import { DiffView } from './DiffView';

function CommitDiff({ projectId, sha }: { projectId: string; sha: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['commit', projectId, sha], queryFn: () => api.get<{ patch: string }>(`/api/projects/${projectId}/commits/${sha}`), staleTime: Infinity });
  if (isLoading) return <Skeleton className="h-24 rounded-xl" />;
  return <DiffView patch={data?.patch ?? ''} />;
}

/** Every agent change is a commit. Open one to see its diff; restore brings any version back as a new commit. */
export function HistoryTab({ projectId, onShare }: { projectId: string; onShare: (sha: string, label: string) => void }) {
  const client = useQueryClient();
  const { data: commits = [], isLoading } = useQuery({ queryKey: ['history', projectId], queryFn: () => api.get<CommitInfo[]>(`/api/projects/${projectId}/history`) });
  const [open, setOpen] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<CommitInfo | null>(null);
  const restore = useMutation({
    mutationFn: (sha: string) => api.post(`/api/projects/${projectId}/restore`, { sha }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['history', projectId] });
      await client.invalidateQueries({ queryKey: ['project', projectId] });
      notify.success('Version restored');
    },
    onError: (e) => notify.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  return (
    <>
      <ol className="flex flex-col gap-2">
        {commits.map((c, i) => (
          <li key={c.sha} className="rounded-2xl bg-white shadow-[0_2px_12px_-4px_rgb(7_23_56/0.08)]">
            <button type="button" onClick={() => setOpen(open === c.sha ? null : c.sha)} className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={open === c.sha}>
              <ChevronIcon size={16} className={`shrink-0 text-night/40 transition-transform ${open === c.sha ? 'rotate-90' : ''}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.message}</div>
                <div className="text-sm text-night/55">
                  {timeAgo(c.date)} · {c.files} {c.files === 1 ? 'file' : 'files'} · <span className="text-emerald-700">+{c.insertions}</span> <span className="text-rose-700">−{c.deletions}</span>
                </div>
              </div>
              {i === 0 && <Chip size="sm" color="accent" variant="soft"><Chip.Label>Current</Chip.Label></Chip>}
              <code className="font-mono text-xs text-night/50">{c.sha.slice(0, 7)}</code>
            </button>
            {open === c.sha && (
              <div className="flex flex-col gap-3 border-t border-night/10 px-4 py-3">
                <div className="flex gap-2">
                  {i > 0 && <Button size="sm" variant="secondary" onPress={() => setRestoring(c)}><RestoreIcon size={15} />Restore this version</Button>}
                  <Button size="sm" variant="ghost" onPress={() => onShare(c.sha, c.message)}><ShareIcon size={15} />Share</Button>
                </div>
                <CommitDiff projectId={projectId} sha={c.sha} />
              </div>
            )}
          </li>
        ))}
      </ol>
      <ConfirmDialog
        isOpen={restoring !== null}
        title="Restore this version?"
        message={`The video goes back to “${restoring?.message ?? ''}”. Nothing is lost: the restore is saved as a new version on top of your history.`}
        confirmLabel="Restore"
        onConfirm={() => restoring && restore.mutate(restoring.sha)}
        onClose={() => setRestoring(null)}
      />
    </>
  );
}
