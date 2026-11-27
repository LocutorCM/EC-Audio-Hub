import { db } from '@appdeploy/sdk';

export async function realtime(event: { body?: string }) {
  let message: { type?: string; payload?: { connection_id?: string } } = {};
  try { message = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400 }; }

  if (message.type === 'system.disconnected') {
    const connectionId = message.payload?.connection_id;
    if (connectionId) {
      const { items } = await db.list('entity_subscriptions', { limit: 500, appdeploy_system_id: true });
      const ids = items.filter((item: Record<string, unknown>) => item.connection_id === connectionId)
        .map((item: Record<string, unknown>) => item.__appdeploy_ddb_id as string);
      if (ids.length) await db.delete('entity_subscriptions', ids);
    }
  }
  return { statusCode: 200 };
}
