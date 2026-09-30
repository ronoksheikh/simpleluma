import { Button, Chip, Input, ListBox, Modal, Select } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { timeOfDay } from '../../lib/format';
import { notify } from '../../lib/notify';
import type { ShareInfo } from '../../lib/types';
import { CopyIcon } from '../icons';

export interface ShareTarget {
  kind: 'version' | 'render';
  /** Commit sha or render id; omit to share the current version. */
  target?: string;
  title: string;
}

const EXPIRY = [
  { id: 'never', label: 'Never expires', hours: null },
  { id: '1', label: 'Expires in 1 hour', hours: 1 },
  { id: '24', label: 'Expires in 1 day', hours: 24 },
  { id: '168', label: 'Expires in 7 days', hours: 168 },
  { id: '720', label: 'Expires in 30 days', hours: 720 },
] as const;

const linkFor = (token: string): string => `${location.origin}/s/${token}`;

function status(share: ShareInfo): { label: string; color: 'success' | 'default' | 'danger' } {
  if (share.revokedAt) return { label: 'Turned off', color: 'danger' };
  if (share.expiresAt && share.expiresAt < Date.now()) return { label: 'Expired', color: 'default' };
  return { label: 'Active', color: 'success' };
}

/** Create, copy and turn off share links. Anyone with a link can watch without logging in. */
export function ShareDialog({ projectId, share, onClose }: { projectId: string; share: ShareTarget | null; onClose: () => void }) {
  const client = useQueryClient();
  const [expiry, setExpiry] = useState<string>('never');
  const { data: shares = [] } = useQuery({
    queryKey: ['shares', projectId],
    queryFn: () => api.get<ShareInfo[]>(`/api/projects/${projectId}/shares`),
    enabled: share !== null,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['shares', projectId] });

  const create = useMutation({
    mutationFn: () =>
      api.post<ShareInfo>(`/api/projects/${projectId}/shares`, {
        kind: share!.kind,
        target: share!.target,
        expiresInHours: EXPIRY.find((e) => e.id === expiry)?.hours ?? null,
      }),
    onSuccess: async (created) => {
      await refresh();
      await navigator.clipboard?.writeText(linkFor(created.token)).catch(() => undefined);
      notify.success('Link created and copied');
    },
    onError: (e) => notify.error(e.message),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/api/projects/${projectId}/shares/${id}`), onSuccess: refresh });

  const copy = async (token: string) => {
    await navigator.clipboard?.writeText(linkFor(token));
    notify.success('Link copied');
  };

  return (
    <Modal.Backdrop isOpen={share !== null} onOpenChange={(open) => !open && onClose()}>
      <Modal.Container size="lg">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Share “{share?.title}”</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-5 p-1">
            <p className="text-sm text-night/65">Anyone with the link can watch in a full-screen player, without logging in. You can turn a link off at any time.</p>
            <div className="flex items-end gap-3">
              <Select className="flex-1" selectedKey={expiry} onSelectionChange={(k) => setExpiry(String(k))} aria-label="Link expiry">
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {EXPIRY.map((e) => <ListBox.Item key={e.id} id={e.id} textValue={e.label}>{e.label}<ListBox.ItemIndicator /></ListBox.Item>)}
                  </ListBox>
                </Select.Popover>
              </Select>
              <Button isPending={create.isPending} onPress={() => create.mutate()}>Create link</Button>
            </div>
            {shares.length > 0 && (
              <ul className="thin-scroll flex max-h-72 flex-col gap-2 overflow-auto">
                {shares.map((s) => {
                  const st = status(s);
                  const live = st.label === 'Active';
                  return (
                    <li key={s.id} className="rounded-2xl border border-night/10 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{s.label}</span>
                        <Chip size="sm" color={st.color} variant="soft"><Chip.Label>{st.label}</Chip.Label></Chip>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Input readOnly value={linkFor(s.token)} aria-label="Share link" className="flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                        <Button size="sm" isIconOnly variant="secondary" aria-label="Copy link" isDisabled={!live} onPress={() => void copy(s.token)}><CopyIcon size={15} /></Button>
                        <Button size="sm" variant="ghost" isDisabled={!live} onPress={() => revoke.mutate(s.id)}>Turn off</Button>
                      </div>
                      <p className="mt-1.5 text-xs text-night/50">Created {timeOfDay(s.createdAt)}{s.expiresAt ? ` · expires ${timeOfDay(s.expiresAt)}` : ''}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
