import { Button, FieldError, Input, Label, TextField } from '@heroui/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { LogoMark } from '../components/Logo';
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
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-canvas px-6 py-12">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(93_174_255/0.28),transparent)]" />
      <div className="relative w-full max-w-[380px]">
        <div className="flex flex-col items-center text-center">
          <LogoMark size={56} className="rounded-[18px] shadow-[0_18px_40px_-16px_rgb(41_112_236/0.7)]" />
          <p className="wordmark mt-5 text-[15px] text-ink/50">Luma Studio</p>
          <h1 className="wordmark mt-1 text-[28px]">{signup ? 'Create your studio' : 'Welcome back'}</h1>
          <p className="mt-1.5 text-[14px] text-ink/55">{signup ? 'Brief the Director. Get motion graphics, built in code.' : 'Sign in to keep directing.'}</p>
        </div>
        <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
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
          {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
          <Button type="submit" fullWidth size="lg" className="mt-1" isPending={busy}>{signup ? 'Create account' : 'Sign in'}</Button>
        </form>
        <p className="mt-6 text-center text-[13.5px] text-ink/55">
          {signup ? 'Already have an account? ' : 'New to Luma Studio? '}
          <Link to={signup ? '/login' : '/signup'} className="font-medium text-lumablue hover:text-royal">{signup ? 'Sign in' : 'Create an account'}</Link>
        </p>
      </div>
      <p className="relative mt-16 text-[12px] text-ink/35">Self-hosted · every video is its own git project</p>
    </div>
  );
}
