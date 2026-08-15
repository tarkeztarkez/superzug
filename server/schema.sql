CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text UNIQUE NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['tickets:read'],
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  pdf bytea NOT NULL,
  code_image bytea,
  code_content_type text,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'needs_review')),
  operator text,
  train_number text,
  origin text,
  destination text,
  departure_at timestamptz,
  arrival_at timestamptz,
  platform text,
  track text,
  carriage text,
  seat text,
  delay_minutes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tickets_user_departure_idx ON tickets(user_id, departure_at);
CREATE INDEX IF NOT EXISTS tickets_expiry_idx ON tickets(arrival_at);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS legs jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS passengers jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE tickets SET legs = jsonb_build_array(jsonb_build_object(
  'operator', operator, 'trainNumber', train_number, 'origin', origin, 'destination', destination,
  'departureAt', departure_at, 'arrivalAt', arrival_at, 'platform', platform, 'track', track
)) WHERE legs = '[]'::jsonb AND origin IS NOT NULL;

UPDATE tickets SET passengers = jsonb_build_array(jsonb_build_object(
  'name', NULL, 'seats', jsonb_build_array(jsonb_build_object('trainNumber', train_number, 'carriage', carriage, 'seat', seat))
)) WHERE passengers = '[]'::jsonb AND seat IS NOT NULL;
