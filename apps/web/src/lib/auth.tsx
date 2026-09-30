import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';

export interface Me {
  id: string;
  email: string;
  hasModel: boolean;
}

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/api/auth/me').catch((e: unknown) => (e instanceof ApiError && e.status === 401 ? null : Promise.reject(e))),
    staleTime: 60_000,
  });
}

export function useRefreshMe(): () => Promise<void> {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['me'] });
}
