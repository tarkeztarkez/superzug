import * as FileSystem from "expo-file-system/legacy";
import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";

const enabled = Platform.OS !== "web";
const root = `${FileSystem.documentDirectory}superzug/`;
let database: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;

async function db() {
  if (!enabled) return null;
  database ??= SQLite.openDatabaseAsync("superzug.db");
  const value = await database;
  await value.execAsync(`
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pending_imports (id TEXT PRIMARY KEY, file_uri TEXT NOT NULL, file_name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pending_deletes (id TEXT PRIMARY KEY);
  `);
  await FileSystem.makeDirectoryAsync(root, { intermediates: true });
  return value;
}

async function download(url: string | null | undefined, destination: string, token: string) {
  if (!url || (await FileSystem.getInfoAsync(destination)).exists) return url ? destination : undefined;
  try {
    await FileSystem.downloadAsync(url, destination, { headers: { Authorization: `Bearer ${token}` } });
    return destination;
  } catch {
    return undefined;
  }
}

export async function cacheRemoteState(api: string, token: string, user: unknown, tickets: Record<string, any>[]) {
  const value = await db();
  if (!value) return;
  await value.runAsync("INSERT OR REPLACE INTO state(key,value) VALUES('user',?)", JSON.stringify(user));
  await value.runAsync("DELETE FROM tickets WHERE id NOT LIKE 'local_%'");
  for (const ticket of tickets) {
    const localPdfUri = await download(`${api}${ticket.pdfUrl}`, `${root}${ticket.id}.pdf`, token);
    const localCodeUri = await download(ticket.codeUrl ? `${api}${ticket.codeUrl}` : null, `${root}${ticket.id}-code.png`, token);
    await value.runAsync("INSERT OR REPLACE INTO tickets(id,value) VALUES(?,?)", ticket.id, JSON.stringify({ ...ticket, localPdfUri, localCodeUri }));
  }
}

export async function cachedState() {
  const value = await db();
  if (!value) return null;
  const user = await value.getFirstAsync<{ value: string }>("SELECT value FROM state WHERE key='user'");
  const tickets = await value.getAllAsync<{ value: string }>("SELECT value FROM tickets");
  return { user: user ? JSON.parse(user.value) : null, tickets: tickets.map((row) => JSON.parse(row.value)) };
}

export async function queueImport(uri: string, fileName: string) {
  const value = await db();
  if (!value) return null;
  const id = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const fileUri = `${root}${id}.pdf`;
  await FileSystem.copyAsync({ from: uri, to: fileUri });
  const ticket = { id, file_name: fileName, status: "processing", delay_minutes: 0, pdfUrl: "", localPdfUri: fileUri };
  await value.runAsync("INSERT INTO pending_imports(id,file_uri,file_name) VALUES(?,?,?)", id, fileUri, fileName);
  await value.runAsync("INSERT INTO tickets(id,value) VALUES(?,?)", id, JSON.stringify(ticket));
  return ticket;
}

export async function syncPending(api: string, token: string) {
  const value = await db();
  if (!value) return;
  for (const pending of await value.getAllAsync<{ id: string; file_uri: string; file_name: string }>("SELECT * FROM pending_imports")) {
    try {
      const form = new FormData();
      form.append("file", { uri: pending.file_uri, name: pending.file_name, type: "application/pdf" } as unknown as Blob);
      const response = await fetch(`${api}/api/tickets/import`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      if (!response.ok) continue;
      await value.runAsync("DELETE FROM pending_imports WHERE id=?", pending.id);
      await value.runAsync("DELETE FROM tickets WHERE id=?", pending.id);
      await FileSystem.deleteAsync(pending.file_uri, { idempotent: true });
    } catch {}
  }
  for (const pending of await value.getAllAsync<{ id: string }>("SELECT * FROM pending_deletes")) {
    try {
      const response = await fetch(`${api}/api/tickets/${pending.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (response.ok || response.status === 404) await value.runAsync("DELETE FROM pending_deletes WHERE id=?", pending.id);
    } catch {}
  }
}

export async function removeOffline(id: string, queueServerDelete: boolean) {
  const value = await db();
  if (!value) return;
  await value.runAsync("DELETE FROM tickets WHERE id=?", id);
  await value.runAsync("DELETE FROM pending_imports WHERE id=?", id);
  if (queueServerDelete) await value.runAsync("INSERT OR IGNORE INTO pending_deletes(id) VALUES(?)", id);
  await Promise.all([
    FileSystem.deleteAsync(`${root}${id}.pdf`, { idempotent: true }),
    FileSystem.deleteAsync(`${root}${id}-code.png`, { idempotent: true }),
  ]);
}

export async function localPdf(id: string) {
  const value = await db();
  if (!value) return null;
  const row = await value.getFirstAsync<{ value: string }>("SELECT value FROM tickets WHERE id=?", id);
  return row ? JSON.parse(row.value).localPdfUri ?? null : null;
}
