CREATE TABLE IF NOT EXISTS word_pairs (
  word_pair_id TEXT PRIMARY KEY,
  civilian_word TEXT NOT NULL,
  undercover_word TEXT NOT NULL,
  category TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  source_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  game_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  revision INTEGER NOT NULL,
  event_seq INTEGER NOT NULL,
  stream_seq INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_game
ON games ((1))
WHERE status IN ('preparing', 'in_progress', 'awaiting_spectator');

CREATE TABLE IF NOT EXISTS game_players (
  game_id TEXT NOT NULL REFERENCES games(game_id),
  player_id TEXT NOT NULL,
  seat_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  camp TEXT NOT NULL,
  word_card TEXT NOT NULL,
  alive INTEGER NOT NULL,
  silhouette TEXT,
  agent_role_id TEXT,
  PRIMARY KEY (game_id, player_id),
  UNIQUE (game_id, seat_index)
);

CREATE TABLE IF NOT EXISTS game_events (
  event_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(game_id),
  event_seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  visibility TEXT NOT NULL,
  command_id TEXT,
  action_id TEXT,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE (game_id, event_seq)
);

CREATE TABLE IF NOT EXISTS public_stream_entries (
  game_id TEXT NOT NULL REFERENCES games(game_id),
  stream_seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  event_seq INTEGER,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (game_id, stream_seq)
);

CREATE TABLE IF NOT EXISTS processed_commands (
  command_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  revision_before INTEGER NOT NULL,
  revision_after INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_actions (
  action_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(game_id),
  player_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  belief_json TEXT NOT NULL,
  output_json TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_attempts (
  attempt_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  player_id TEXT,
  role_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  attempt_kind TEXT NOT NULL,
  result_code TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  UNIQUE (action_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS model_attempts_game_started
  ON model_attempts (game_id, started_at);

CREATE TABLE IF NOT EXISTS model_attempt_stages (
  attempt_id TEXT NOT NULL REFERENCES model_attempts(attempt_id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (attempt_id, stage)
);

CREATE TABLE IF NOT EXISTS game_runtime_recovery (
  game_id TEXT PRIMARY KEY REFERENCES games(game_id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  status TEXT NOT NULL,
  interrupted_at TEXT NOT NULL,
  resolved_at TEXT
);
