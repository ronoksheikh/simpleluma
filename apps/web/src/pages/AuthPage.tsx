import { Button, FieldError, Input, Label, TextField } from '@heroui/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { api, ApiError } from '../lib/api';
import { useMe, type Me } from '../lib/auth';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { data: me } = useMe();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  if (me) return <Navigate to={me.hasModel ? '/' : '/setup'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/auth/${mode}`, { email, password });
      const fresh = await api.get<Me>('/api/auth/me');
      client.setQueryData(['me'], fresh);
      navigate(fresh.hasModel ? '/' : '/setup');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <aside className="brand-gradient relative hidden flex-col justify-between p-12 text-white lg:flex">
        <Logo light />
        <div className="max-w-md">
          <h1 className="wordmark text-5xl leading-[1.08]">Describe a video.<br />Watch it move.</h1>
          <p className="mt-5 text-lg text-white/80">
            Chat with an AI motion designer that builds your video in code, previews it live and renders the MP4.
          </p>
        </div>
        <p className="text-sm text-white/60">Every video is its own git project.</p>
      </aside>
      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-[0_10px_40px_-12px_rgb(7_23_56/0.15)]">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h2 className="text-2xl font-semibold tracking-tight">{signup ? 'Create your account' : 'Welcome back'}</h2>
          <p className="mt-1 text-sm text-night/60">{signup ? 'Start making videos in a minute.' : 'Log in to your studio.'}</p>
          <div className="mt-6 flex flex-col gap-4">
            <TextField isRequired fullWidth name="email" type="email" value={email} onChange={setEmail}>
              <Label>Email</Label>
              <Input placeholder="you@example.com" autoComplete="email" />
              <FieldError />
            </TextField>
            <TextField isRequired fullWidth name="password" type="password" value={password} onChange={setPassword}>
              <Label>Password</Label>
              <Input placeholder={signup ? 'At least 8 characters' : 'Your password'} autoComplete={signup ? 'new-password' : 'current-password'} />
              <FieldError />
            </TextField>
          </div>
          {error && <p role="alert" className="mt-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit" fullWidth size="lg" className="mt-6" isPending={busy}>
            {signup ? 'Sign up' : 'Log in'}
          </Button>
          <p className="mt-5 text-center text-sm text-night/60">
            {signup ? 'Already have an account? ' : 'New here? '}
            <Link to={signup ? '/login' : '/signup'} className="font-medium text-lumablue hover:text-royal">
              {signup ? 'Log in' : 'Create an account'}
            </Link>
          </p>
        </form>
      </section>
    </div>
  );
}
