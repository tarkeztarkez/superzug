# Superzug

Private React Native/Expo train-ticket wallet with a Bun API and PostgreSQL PDF storage.

```bash
bun install
bun run web
DATABASE_URL=postgres://... ADMIN_EMAIL=... ADMIN_PASSWORD=... bun run server
```

The server creates its schema and first admin on startup. Ticket PDFs and metadata are deleted hourly once the train's arrival was more than seven days ago.
PDF pages are rendered locally and ZBar crops a detected validation code; AI is only used for ticket-field extraction.

## Server environment

- `DATABASE_URL` — required PostgreSQL connection
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` — initial admin (password should be 10+ characters)
- `AI_BASE_URL` — optional OpenAI-compatible sub-auth endpoint
- `EXTRACTION_MODEL` — defaults to `gpt-terra-high`
- `OPENAI_API_KEY` — fallback extraction authorization; imports may instead send `X-Sub-Auth-Token`
