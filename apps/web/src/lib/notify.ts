import { toast } from '@heroui/react';

export const notify = {
  success: (message: string) => toast.success(message),
  error: (message: string) => toast.danger(message),
};
