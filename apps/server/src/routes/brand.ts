import type { FastifyPluginAsync } from 'fastify';
import { brandSchema, emptyBrand, readBrand, rescanBrand, writeBrand } from '../brand/brand.js';
import { parse } from '../lib/validate.js';
import { getProject } from '../projects/service.js';

export const brandRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/api/projects/:id/brand', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    const brand = await readBrand(project.id);
    return { exists: brand !== null, brand: brand ?? emptyBrand() };
  });

  app.put<{ Params: { id: string } }>('/api/projects/:id/brand', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    const brand = parse(brandSchema, req.body);
    return writeBrand(project.id, { ...brand, edited: true }, 'Edit brand.json');
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/brand/rescan', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    return { brand: (await rescanBrand(project.id)) ?? (await readBrand(project.id)) ?? emptyBrand() };
  });
};
