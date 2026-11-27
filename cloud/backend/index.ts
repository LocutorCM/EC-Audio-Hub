import { router, json, error, requireAuth, requireRole, db, storage, ws } from '@appdeploy/sdk';

type Release = {
  name: string; manufacturer: string; version: string; category: string;
  description: string; changelog: string; fileName: string; contentType: string;
  parts: string[]; published: boolean; updatedAt: number;
};

const signedIn = [requireAuth()];
const ownerOnly = [requireAuth(), requireRole('admin')];

async function publishCatalogEvent() {
  const { items } = await db.list('entity_subscriptions', { limit: 500 });
  const connections = [...new Set(items
    .filter((item: Record<string, unknown>) => item.entity_type === 'catalog' && item.entity_id === 'main')
    .map((item: Record<string, unknown>) => item.connection_id)
    .filter((id: unknown): id is string => typeof id === 'string'))];
  if (connections.length) {
    await ws.send(connections, {
      type: 'entity.update',
      payload: { entity_type: 'catalog', entity_id: 'main', changedAt: Date.now() }
    });
  }
}

async function catalog(includeDrafts: boolean) {
  const { items } = await db.list<Release>('plugins', { limit: 100, appdeploy_system_id: true });
  return items.filter(item => includeDrafts || item.published).map(item => ({
    id: item.__appdeploy_ddb_id, name: item.name, manufacturer: item.manufacturer,
    version: item.version, category: item.category, description: item.description,
    changelog: item.changelog, fileName: item.fileName, contentType: item.contentType,
    published: item.published, updatedAt: item.updatedAt
  }));
}

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ ok: true, service: 'EC Audio Cloud' })],
  'GET /api/catalog': [...signedIn, async () => json({ plugins: await catalog(false) })],
  'GET /api/admin/plugins': [...ownerOnly, async () => json({ plugins: await catalog(true) })],

  'POST /api/admin/upload-part': [...ownerOnly, async ({ body }) => {
    const input = body as { uploadId?: string; index?: number; total?: number; content?: string; contentType?: string };
    if (!input.uploadId || !/^[a-zA-Z0-9-]{16,80}$/.test(input.uploadId) ||
        !Number.isInteger(input.index) || !Number.isInteger(input.total) ||
        (input.index as number) < 0 || (input.total as number) < 1 ||
        (input.index as number) >= (input.total as number) ||
        typeof input.content !== 'string' || input.content.length > 700000) {
      return error('Invalid upload part.', 400);
    }
    const path = `staging/${input.uploadId}/part-${String(input.index).padStart(5, '0')}`;
    const [ok] = await storage.write([{ path, content: input.content, contentType: input.contentType || 'application/octet-stream' }]);
    return ok ? json({ ok: true }) : error('Installer storage failed.', 500);
  }],

  'POST /api/admin/plugins': [...ownerOnly, async ({ body }) => {
    const input = body as Partial<Release> & { pluginId?: string | null; uploadId?: string | null; parts?: number };
    if (!input.name?.trim() || !input.manufacturer?.trim() || !input.version?.trim()) {
      return error('Name, manufacturer and version are required.', 400);
    }
    let paths: string[] = [];
    if (input.uploadId) {
      if (!Number.isInteger(input.parts) || (input.parts as number) < 1 || (input.parts as number) > 600) {
        return error('Invalid installer parts.', 400);
      }
      paths = Array.from({ length: input.parts as number }, (_, i) =>
        `staging/${input.uploadId}/part-${String(i).padStart(5, '0')}`);
      const stored = await storage.read(paths);
      if (stored.some(part => part.content === null)) return error('Upload incomplete; missing installer parts.', 400);
    } else if (!input.pluginId) return error('A new plugin requires an installer.', 400);

    const release: Release = {
      name: input.name.trim(), manufacturer: input.manufacturer.trim(), version: input.version.trim(),
      category: input.category?.trim() || 'Other', description: input.description?.trim() || '',
      changelog: input.changelog?.trim() || '', fileName: input.fileName || '',
      contentType: input.contentType || 'application/octet-stream', parts: paths,
      published: input.published !== false, updatedAt: Date.now()
    };
    if (input.pluginId) {
      const [previous] = await db.get<Release>('plugins', [input.pluginId]);
      if (!previous) return error('Plugin not found.', 404);
      if (!paths.length) {
        release.parts = previous.parts; release.fileName = previous.fileName;
        release.contentType = previous.contentType;
      }
      const [ok] = await db.update('plugins', [{ id: input.pluginId, record: release }]);
      if (!ok) return error('Could not update release.', 500);
    } else {
      const [id] = await db.add('plugins', [release as unknown as Record<string, unknown>]);
      if (!id) return error('Could not create release.', 500);
    }
    await publishCatalogEvent();
    return json({ ok: true });
  }],

  'PUT /api/admin/plugins/:id': [...ownerOnly, async ({ params, body }) => {
    const [release] = await db.get<Release>('plugins', [params.id]);
    if (!release) return error('Release not found.', 404);
    const input = body as { published?: boolean };
    const [ok] = await db.update('plugins', [{ id: params.id, record: { ...release, published: input.published === true, updatedAt: Date.now() } }]);
    if (!ok) return error('Could not change publication status.', 500);
    await publishCatalogEvent();
    return json({ ok: true });
  }],

  'DELETE /api/admin/plugins/:id': [...ownerOnly, async ({ params }) => {
    const [release] = await db.get<Release>('plugins', [params.id]);
    if (!release) return error('Release not found.', 404);
    const [ok] = await db.update('plugins', [{ id: params.id, record: { ...release, published: false, updatedAt: Date.now() } }]);
    if (!ok) return error('Could not unpublish release.', 500);
    await publishCatalogEvent();
    return json({ ok: true });
  }],

  'GET /api/plugins/:id/download': [...signedIn, async ({ params }) => {
    const [release] = await db.get<Release>('plugins', [params.id]);
    if (!release || !release.published || !release.parts.length) return error('Release unavailable.', 404);
    const signed = await storage.url(release.parts);
    if (signed.length !== release.parts.length || signed.some(part => !part.url)) return error('Installer temporarily unavailable.', 503);
    return json({ fileName: release.fileName, contentType: release.contentType, version: release.version, urls: signed.map(part => part.url) });
  }],

  'POST /api/subscriptions': [...signedIn, async ({ body }) => {
    const input = body as { entity_type?: string; entity_id?: string; connection_id?: string };
    if (input.entity_type !== 'catalog' || input.entity_id !== 'main' || !input.connection_id) return error('Invalid subscription.', 400);
    const { items } = await db.list('entity_subscriptions', { limit: 500, appdeploy_system_id: true });
    const exists = items.some((item: Record<string, unknown>) => item.connection_id === input.connection_id);
    if (!exists) await db.add('entity_subscriptions', [{
      entity_type: 'catalog', entity_id: 'main', connection_id: input.connection_id,
      createdAt: Date.now()
    }]);
    return json({ ok: true });
  }],

  'POST /api/subscriptions/remove': [...signedIn, async ({ body }) => {
    const input = body as { entity_type?: string; entity_id?: string; connection_id?: string };
    if (input.entity_type !== 'catalog' || input.entity_id !== 'main' || !input.connection_id) return error('Invalid subscription.', 400);
    const { items } = await db.list('entity_subscriptions', { limit: 500, appdeploy_system_id: true });
    const ids = items.filter((item: Record<string, unknown>) => item.connection_id === input.connection_id)
      .map((item: Record<string, unknown>) => item.__appdeploy_ddb_id as string);
    if (ids.length) await db.delete('entity_subscriptions', ids);
    return json({ ok: true });
  }]
});
