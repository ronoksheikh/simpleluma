import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  elevenLabsKeyEnc: text('elevenlabs_key_enc'),
  createdAt: integer('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
});

export const modelProfiles = sqliteTable('model_profiles', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKeyEnc: text('api_key_enc').notNull(),
  model: text('model').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
});

export const secrets = sqliteTable(
  'secrets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    valueEnc: text('value_enc').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('secrets_user_name').on(t.userId, t.name)],
);

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'tool'] }).notNull(),
    content: text('content').notNull().default(''),
    /** Assistant messages: OpenAI-format tool calls as JSON. */
    toolCalls: text('tool_calls'),
    /** Tool messages: the call this result answers, and whether it failed. */
    toolCallId: text('tool_call_id'),
    failed: integer('failed', { mode: 'boolean' }).notNull().default(false),
    /** Extra data for the UI (frame image URL, render id, share link…) as JSON. */
    meta: text('meta'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('messages_project').on(t.projectId, t.id)],
);

export const renders = sqliteTable(
  'renders',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['preview', 'final'] }).notNull(),
    status: text('status', { enum: ['queued', 'rendering', 'done', 'failed'] }).notNull(),
    commit: text('commit_sha').notNull(),
    height: integer('height').notNull(),
    framesDone: integer('frames_done').notNull().default(0),
    framesTotal: integer('frames_total').notNull().default(0),
    chunksTotal: integer('chunks_total').notNull().default(0),
    chunksCached: integer('chunks_cached').notNull().default(0),
    progress: real('progress').notNull().default(0),
    error: text('error'),
    sizeBytes: integer('size_bytes'),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('renders_project').on(t.projectId, t.createdAt)],
);

export const shares = sqliteTable('shares', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  kind: text('kind', { enum: ['version', 'render'] }).notNull(),
  /** Version shares: the git commit. Render shares: the render id. */
  target: text('target').notNull(),
  label: text('label').notNull(),
  expiresAt: integer('expires_at'),
  revokedAt: integer('revoked_at'),
  createdAt: integer('created_at').notNull(),
});
