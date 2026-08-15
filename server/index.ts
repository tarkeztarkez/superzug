import postgres from "postgres";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let sql = postgres(process.env.DATABASE_URL!, { max: 10 });
const encoder = new TextEncoder();
const staticRoot = `${import.meta.dir}/../dist`;

type Identity = { id: string; email: string; name: string; is_admin: boolean; scopes: string[] };
type LiveTrip = { start_date: string; numbers: string[]; stop_times: { arrival?: string; departure?: string; platform?: string; track?: string }[] };

let liveCache: { expires: number; trips: LiveTrip[] } | null = null;

const json = (data: unknown, status = 200) => Response.json(data, { status });
const sha256 = async (value: string) => Buffer.from(await crypto.subtle.digest("SHA-256", encoder.encode(value))).toString("hex");
const bearer = (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

async function migrate() {
  try {
    await sql.file(`${import.meta.dir}/schema.sql`);
  } catch (error) {
    if (!(error instanceof postgres.PostgresError) || error.code !== "3D000") throw error;
    const url = new URL(process.env.DATABASE_URL!);
    const database = url.pathname.slice(1);
    if (!/^[a-z][a-z0-9_]*$/.test(database)) throw new Error("Invalid database name");
    url.pathname = "/postgres";
    const admin = postgres(url.toString(), { max: 1 });
    await admin.unsafe(`CREATE DATABASE ${database}`);
    await admin.end();
    await sql.end();
    sql = postgres(process.env.DATABASE_URL!, { max: 10 });
    await sql.file(`${import.meta.dir}/schema.sql`);
  }
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    const hash = await Bun.password.hash(password);
    await sql`INSERT INTO users (email, name, password_hash, is_admin)
      VALUES (${email}, ${process.env.ADMIN_NAME ?? "Admin"}, ${hash}, true)
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, is_admin = true`;
    await sql`DELETE FROM users WHERE is_admin = true AND email <> ${email}`;
  }
}

async function authenticate(request: Request): Promise<Identity | null> {
  const token = bearer(request);
  if (!token) return null;
  const hash = await sha256(token);
  const [identity] = await sql<Identity[]>`
    SELECT u.id, u.email, u.name, u.is_admin,
      CASE WHEN s.token_hash IS NOT NULL THEN ARRAY['tickets:read','tickets:write','tickets:delete']::text[] ELSE p.scopes END AS scopes
    FROM users u
    LEFT JOIN sessions s ON s.user_id = u.id AND s.token_hash = ${hash} AND s.expires_at > now()
    LEFT JOIN access_tokens p ON p.user_id = u.id AND p.token_hash = ${hash}
    WHERE s.token_hash IS NOT NULL OR p.token_hash IS NOT NULL`;
  if (identity && token.startsWith("sz_pat_")) await sql`UPDATE access_tokens SET last_used_at = now() WHERE token_hash = ${hash}`;
  return identity ?? null;
}

function ticket(row: Record<string, unknown>) {
  return {
    ...row,
    pdf: undefined,
    code_image: undefined,
    pdfUrl: `/api/tickets/${row.id}/pdf`,
    codeUrl: row.code_content_type ? `/api/tickets/${row.id}/code` : null,
  };
}

function polishDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

async function enrichLive(rows: Record<string, any>[]) {
  const candidates = rows.filter((row) => row.train_number && row.departure_at && new Date(row.arrival_at ?? row.departure_at).getTime() > Date.now() - 3_600_000);
  if (!candidates.length) return;
  try {
    if (!liveCache || liveCache.expires < Date.now()) {
      const response = await fetch(process.env.LIVE_UPDATES_URL ?? "https://mkuran.pl/gtfs/polish_trains/updates.json");
      if (!response.ok) throw new Error(`live updates returned ${response.status}`);
      const body = await response.json() as { trip_updates: LiveTrip[] };
      liveCache = { trips: body.trip_updates, expires: Date.now() + 120_000 };
    }
    for (const row of candidates) {
      const scheduled = new Date(row.departure_at);
      const number = String(row.train_number).match(/\d+/g)?.join("") ?? "";
      const trip = liveCache.trips.find((item) => item.start_date === polishDate(scheduled) && item.numbers.some((value) => value.replace(/\D/g, "") === number));
      if (!trip) continue;
      const stop = trip.stop_times.map((item) => ({ item, time: new Date(item.departure ?? item.arrival ?? 0) })).filter(({ time }) => Number.isFinite(time.getTime())).sort((a, b) => Math.abs(a.time.getTime() - scheduled.getTime()) - Math.abs(b.time.getTime() - scheduled.getTime()))[0];
      if (!stop || Math.abs(stop.time.getTime() - scheduled.getTime()) > 6 * 3_600_000) continue;
      row.delay_minutes = Math.max(0, Math.round((stop.time.getTime() - scheduled.getTime()) / 60_000));
      row.platform = stop.item.platform || row.platform;
      row.track = stop.item.track || row.track;
    }
  } catch (error) {
    console.error("live journey enrichment failed", error);
  }
}

async function cropTicketCode(id: string, pdf: Uint8Array) {
  const directory = await mkdtemp(join(tmpdir(), "superzug-"));
  try {
    const source = join(directory, "ticket.pdf");
    await writeFile(source, pdf);
    const render = Bun.spawn(["pdftoppm", "-f", "1", "-l", "2", "-r", "220", "-png", source, join(directory, "page")]);
    if (await render.exited) return;
    for (const name of (await readdir(directory)).filter((file) => file.endsWith(".png")).sort()) {
      const page = join(directory, name);
      const scan = Bun.spawn(["zbarimg", "--xml", "--quiet", page], { stdout: "pipe", stderr: "ignore" });
      const xml = await new Response(scan.stdout).text();
      await scan.exited;
      const points = [...xml.matchAll(/<point\s+x=['"](\d+)['"]\s+y=['"](\d+)['"]\s*\/?\s*>/g)].map((match) => [Number(match[1]), Number(match[2])]);
      if (points.length < 3) continue;
      const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
      const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
      const padding = Math.ceil(Math.max(maxX - minX, maxY - minY) * .08);
      const output = join(directory, "code.png");
      const crop = Bun.spawn(["convert", page, "-crop", `${maxX - minX + padding * 2}x${maxY - minY + padding * 2}+${Math.max(0, minX - padding)}+${Math.max(0, minY - padding)}`, "+repage", output], { stderr: "ignore" });
      if (await crop.exited) continue;
      await sql`UPDATE tickets SET code_image = ${new Uint8Array(await readFile(output))}, code_content_type = 'image/png', updated_at = now() WHERE id = ${id}`;
      return;
    }
  } catch (error) {
    console.error("ticket code crop failed", error);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function extractTicket(id: string, pdf: Uint8Array, token?: string) {
  void cropTicketCode(id, pdf);
  try {
    let apiToken = token || process.env.OPENAI_API_KEY;
    let accountId = "";
    if (process.env.SUB_AUTH_API_KEY) {
      const sync = await fetch(`${process.env.SUB_AUTH_URL ?? "https://sub-auth.marcinszyda.com"}/api/v1/sync`, { headers: { Authorization: `Bearer ${process.env.SUB_AUTH_API_KEY}` } });
      if (!sync.ok) throw new Error(`sub-auth returned ${sync.status}`);
      const data = await sync.json() as { auth: { tokens: { access_token: string; account_id?: string } } };
      apiToken = data.auth.tokens.access_token;
      accountId = data.auth.tokens.account_id ?? "";
    }
    if (!apiToken) return;
    const codex = Boolean(process.env.SUB_AUTH_API_KEY);
    const response = await fetch(codex ? "https://chatgpt.com/backend-api/codex/responses" : `${process.env.AI_BASE_URL ?? "https://api.openai.com/v1"}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "ChatGPT-Account-Id": accountId, "Content-Type": "application/json", Accept: codex ? "text/event-stream" : "application/json", originator: "codex_cli_rs" },
      body: JSON.stringify({
        model: process.env.EXTRACTION_MODEL ?? (codex ? "gpt-5.6-terra" : "gpt-terra-high"),
        ...(codex ? { instructions: "Extract ticket data exactly. Do not call tools.", tools: [], tool_choice: "auto", parallel_tool_calls: false, reasoning: { effort: "high", summary: "none" }, store: false, stream: true } : {}),
        input: [{ role: "user", content: [
          { type: "input_text", text: "Extract this train ticket. Return only JSON with operator, trainNumber, origin, destination, departureAt, arrivalAt, platform, track, carriage, seat. Dates must be ISO 8601 with timezone. Use null when absent." },
          { type: "input_file", filename: "ticket.pdf", file_data: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}` },
        ] }],
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const body = await response.text();
    let raw = "{}";
    if (codex) {
      for (const line of body.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try { const event = JSON.parse(line.slice(5)); if (event.type === "response.output_text.done") raw = event.text; } catch {}
      }
    } else {
      const result = JSON.parse(body) as { output_text?: string; output?: { content?: { text?: string }[] }[] };
      raw = result.output_text ?? result.output?.flatMap((item) => item.content ?? []).find((item) => item.text)?.text ?? "{}";
    }
    const value = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ""));
    await sql`UPDATE tickets SET
      operator = ${value.operator}, train_number = ${value.trainNumber}, origin = ${value.origin}, destination = ${value.destination},
      departure_at = ${value.departureAt}, arrival_at = ${value.arrivalAt}, platform = ${value.platform}, track = ${value.track},
      carriage = ${value.carriage}, seat = ${value.seat}, status = 'ready', updated_at = now() WHERE id = ${id}`;
  } catch (error) {
    console.error("ticket extraction failed", error);
    await sql`UPDATE tickets SET status = 'needs_review', updated_at = now() WHERE id = ${id}`;
  }
}

async function api(request: Request, url: URL): Promise<Response> {
  if (url.pathname === "/api/health") return json({ ok: true });
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const body = await request.json() as { email?: string; password?: string };
    const [user] = await sql`SELECT * FROM users WHERE email = ${body.email?.toLowerCase() ?? ""}`;
    if (!user || !body.password || !(await Bun.password.verify(body.password, user.password_hash))) return json({ error: "Invalid email or password" }, 401);
    const token = `sz_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${await sha256(token)}, ${user.id}, now() + interval '30 days')`;
    return json({ token, user: { id: user.id, email: user.email, name: user.name, isAdmin: user.is_admin } });
  }

  const user = await authenticate(request);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const can = (scope: string) => user.is_admin || user.scopes.includes(scope);

  if (url.pathname === "/api/me") return json({ id: user.id, email: user.email, name: user.name, isAdmin: user.is_admin });
  if (url.pathname === "/api/users" && request.method === "POST" && user.is_admin) {
    const body = await request.json() as { email: string; name: string; password: string };
    if (!body.email || !body.name || !body.password || body.password.length < 10) return json({ error: "Name, email and a 10 character password are required" }, 400);
    const [created] = await sql`INSERT INTO users (email, name, password_hash) VALUES (${body.email.toLowerCase()}, ${body.name}, ${await Bun.password.hash(body.password)}) RETURNING id, email, name`;
    return json(created, 201);
  }
  if (url.pathname === "/api/tokens" && request.method === "GET") {
    return json(await sql`SELECT id, name, scopes, last_used_at, created_at FROM access_tokens WHERE user_id = ${user.id} ORDER BY created_at DESC`);
  }
  if (url.pathname === "/api/tokens" && request.method === "POST") {
    const body = await request.json() as { name?: string; scopes?: string[] };
    const token = `sz_pat_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const scopes = (body.scopes ?? ["tickets:read"]).filter((scope) => ["tickets:read", "tickets:write", "tickets:delete"].includes(scope));
    const [created] = await sql`INSERT INTO access_tokens (user_id, name, token_hash, scopes) VALUES (${user.id}, ${body.name ?? "Hermes"}, ${await sha256(token)}, ${scopes}) RETURNING id, name, scopes, created_at`;
    return json({ ...created, token }, 201);
  }
  if (url.pathname === "/api/tickets" && request.method === "GET" && can("tickets:read")) {
    const rows = user.is_admin && url.searchParams.get("all") === "true"
      ? await sql`SELECT * FROM tickets ORDER BY departure_at NULLS LAST`
      : await sql`SELECT * FROM tickets WHERE user_id = ${user.id} ORDER BY departure_at NULLS LAST`;
    await enrichLive(rows);
    return json(rows.map(ticket));
  }
  if (url.pathname === "/api/tickets/import" && request.method === "POST" && can("tickets:write")) {
    const form = await request.formData() as unknown as { get(name: string): FormDataEntryValue | null };
    const file = form.get("file");
    if (!(file instanceof File) || file.type !== "application/pdf" || file.size > 15_000_000) return json({ error: "Choose a PDF up to 15 MB" }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const [created] = await sql`INSERT INTO tickets (user_id, file_name, pdf) VALUES (${user.id}, ${file.name}, ${bytes}) RETURNING *`;
    void extractTicket(created.id, bytes, request.headers.get("x-sub-auth-token") ?? undefined);
    return json(ticket(created), 202);
  }

  const match = url.pathname.match(/^\/api\/tickets\/([0-9a-f-]+)(?:\/(pdf|code))?$/);
  if (match) {
    const [row] = await sql`SELECT * FROM tickets WHERE id = ${match[1]} AND (${user.is_admin} OR user_id = ${user.id})`;
    if (!row) return json({ error: "Not found" }, 404);
    if (request.method === "GET" && match[2] === "pdf" && can("tickets:read")) return new Response(row.pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${row.file_name.replaceAll('"', '')}"` } });
    if (request.method === "GET" && match[2] === "code" && row.code_image && can("tickets:read")) return new Response(row.code_image, { headers: { "Content-Type": row.code_content_type } });
    if (request.method === "DELETE" && can("tickets:delete")) { await sql`DELETE FROM tickets WHERE id = ${row.id}`; return new Response(null, { status: 204 }); }
    if (request.method === "PATCH" && can("tickets:write")) {
      const body = await request.json() as Record<string, string | number | null>;
      const [updated] = await sql`UPDATE tickets SET
        train_number = COALESCE(${body.trainNumber}, train_number), origin = COALESCE(${body.origin}, origin), destination = COALESCE(${body.destination}, destination),
        departure_at = COALESCE(${body.departureAt}, departure_at), arrival_at = COALESCE(${body.arrivalAt}, arrival_at), platform = COALESCE(${body.platform}, platform),
        track = COALESCE(${body.track}, track), carriage = COALESCE(${body.carriage}, carriage), seat = COALESCE(${body.seat}, seat),
        status = 'ready', updated_at = now() WHERE id = ${row.id} RETURNING *`;
      return json(ticket(updated));
    }
  }
  return json({ error: "Not found" }, 404);
}

await migrate();
const purge = () => sql`DELETE FROM tickets WHERE arrival_at < now() - interval '7 days'`.catch(console.error);
await purge();
setInterval(purge, 60 * 60 * 1000);

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  maxRequestBodySize: 16_000_000,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, url).catch((error) => { console.error(error); return json({ error: "Server error" }, 500); });
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`${staticRoot}${path}`);
    if (await file.exists()) return new Response(file);
    return new Response(Bun.file(`${staticRoot}/index.html`));
  },
});
