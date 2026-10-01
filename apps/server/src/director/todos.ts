import { asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { hub } from '../lib/hub.js';

export type TodoStatus = 'pending' | 'in_progress' | 'done';

export interface Todo {
  id: number;
  text: string;
  status: TodoStatus;
}

export const listTodos = (projectId: string): Todo[] =>
  db
    .select({ id: schema.todos.id, text: schema.todos.text, status: schema.todos.status })
    .from(schema.todos)
    .where(eq(schema.todos.projectId, projectId))
    .orderBy(asc(schema.todos.position))
    .all();

/** Replace the whole plan (the Director always sends the full list, so order and wording stay its own). */
export function replaceTodos(projectId: string, items: Array<{ text: string; status: TodoStatus }>): Todo[] {
  const now = Date.now();
  db.transaction((tx) => {
    tx.delete(schema.todos).where(eq(schema.todos.projectId, projectId)).run();
    items.forEach((item, position) => tx.insert(schema.todos).values({ projectId, text: item.text, status: item.status, position, updatedAt: now }).run());
  });
  const todos = listTodos(projectId);
  hub.publish(projectId, { type: 'todos.changed', todos });
  return todos;
}

export function setTodoStatus(projectId: string, id: number, status: TodoStatus): Todo[] {
  db.update(schema.todos).set({ status, updatedAt: Date.now() }).where(eq(schema.todos.id, id)).run();
  const todos = listTodos(projectId);
  hub.publish(projectId, { type: 'todos.changed', todos });
  return todos;
}

export function formatTodos(todos: Todo[]): string {
  if (!todos.length) return '(no plan yet)';
  const mark = { pending: '[ ]', in_progress: '[~]', done: '[x]' } as const;
  return todos.map((t, i) => `${i + 1}. ${mark[t.status]} ${t.text}`).join('\n');
}
