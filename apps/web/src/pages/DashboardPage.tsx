import { Button, Dropdown, FieldError, Input, Label, Modal, Skeleton, TextField, buttonVariants } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LogoMark } from '../components/Logo';
import { PlusIcon, TrashIcon } from '../components/icons';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useMe } from '../lib/auth';
import { notify } from '../lib/notify';

interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
}

const TEMPLATES = [
  { id: 'blank', title: 'Blank video', text: 'One empty scene. Ask Luma for anything.' },
  { id: 'demo', title: 'Demo reel', text: 'A 24-second reel with music, to explore how it works.' },
] as const;

function NewVideoDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]['id']>('blank');
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/projects', { name: name.trim() || 'Untitled video', template }),
    onSuccess: ({ id }) => navigate(`/p/${id}`),
    onError: (e) => notify.error(e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Container size="md">
        <Modal.Dialog>
          <form onSubmit={submit}>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>New video</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-5 p-1">
              <TextField fullWidth autoFocus value={name} onChange={setName}>
                <Label>Name</Label>
                <Input placeholder="Lumademy logo intro" />
                <FieldError />
              </TextField>
              <div role="radiogroup" aria-label="Start from" className="grid grid-cols-2 gap-3">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={template === t.id}
                    onClick={() => setTemplate(t.id)}
                    className={`rounded-2xl border p-4 text-left transition-colors ${template === t.id ? 'border-lumablue bg-lumablue/5' : 'border-night/10 hover:border-night/25'}`}
                  >
                    <div className="font-medium">{t.title}</div>
                    <div className="mt-1 text-sm text-night/60">{t.text}</div>
                  </button>
                ))}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" type="button" onPress={onClose}>Cancel</Button>
              <Button type="submit" isPending={create.isPending}>Create video</Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function ProjectCard({ project, onDelete }: { project: ProjectSummary; onDelete: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="group relative">
      <Link to={`/p/${project.id}`} className="block overflow-hidden rounded-3xl bg-white shadow-[0_2px_12px_-4px_rgb(7_23_56/0.1)] transition-shadow hover:shadow-[0_12px_32px_-12px_rgb(7_23_56/0.25)]">
        <div className="relative aspect-video bg-night">
          {broken ? (
            <div className="grid h-full place-items-center bg-offwhite"><LogoMark size={44} /></div>
          ) : (
            <img src={`/api/projects/${project.id}/thumbnail?v=${project.updatedAt}`} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
          )}
        </div>
        <div className="p-4">
          <div className="truncate font-medium">{project.name}</div>
          <div className="mt-0.5 text-sm text-night/55">Edited {timeAgo(project.updatedAt)}</div>
        </div>
      </Link>
      <Dropdown>
        <Dropdown.Trigger
          aria-label={`More actions for ${project.name}`}
          className={`${buttonVariants({ isIconOnly: true, size: 'sm', variant: 'secondary' })} absolute right-3 top-3 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100`}
        >
          <span aria-hidden className="text-lg leading-none">⋯</span>
        </Dropdown.Trigger>
        <Dropdown.Popover>
          <Dropdown.Menu onAction={(key) => key === 'delete' && onDelete()}>
            <Dropdown.Item id="delete" textValue="Delete video" variant="danger">
              <span className="flex items-center gap-2"><TrashIcon size={15} />Delete video</span>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}

export function DashboardPage() {
  const client = useQueryClient();
  const { data: me } = useMe();
  const { data: projects, isLoading } = useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectSummary[]>('/api/projects') });
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/projects/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['projects'] }),
    onError: (e) => notify.error(e.message),
  });

  return (
    <div className="mx-auto max-w-6xl px-6 pb-16 pt-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="wordmark text-3xl">Your videos</h1>
          <p className="mt-1 text-night/60">Every video is its own git project.</p>
        </div>
        <Button size="lg" onPress={() => setCreating(true)}><PlusIcon size={18} />New video</Button>
      </div>

      {me && !me.hasModel && (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-sm">Connect a model so Luma can build your videos.</p>
          <Link to="/setup" className="shrink-0 text-sm font-medium text-lumablue hover:text-royal">Connect a model</Link>
        </div>
      )}

      {isLoading ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[4/3] rounded-3xl" />)}
        </div>
      ) : projects && projects.length > 0 ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => <ProjectCard key={p.id} project={p} onDelete={() => setDeleting(p)} />)}
        </div>
      ) : (
        <div className="mt-10 flex flex-col items-center rounded-3xl bg-white px-6 py-16 text-center shadow-sm">
          <LogoMark size={56} />
          <h2 className="mt-5 text-xl font-semibold">Make your first video</h2>
          <p className="mt-1 max-w-md text-night/60">Start from a blank video and describe what you want, or open the demo reel to see what is possible.</p>
          <Button className="mt-6" size="lg" onPress={() => setCreating(true)}>New video</Button>
        </div>
      )}

      <NewVideoDialog isOpen={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        isOpen={deleting !== null}
        title="Delete this video?"
        message={`“${deleting?.name ?? ''}”, its history and its renders will be removed for good.`}
        confirmLabel="Delete video"
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
