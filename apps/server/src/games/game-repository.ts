import {
  factReviewSchema,
  gameSnapshotSchema,
  humanGameViewSchema,
  projectHumanGameView,
  reviewSummarySchema,
  type ActionType,
  type BeliefSnapshot,
  type FactReview,
  type GameEvent,
  type GameSnapshot,
  type HumanGameView,
  type PublicTimelineItem,
  type ReviewSummary,
} from '@sheishiwodi/shared';

import type { AppDatabase } from '../db/client.js';

interface ProcessedCommand {
  requestHash: string;
  response: HumanGameView;
}

export interface PublicStreamFrame {
  streamSeq: number;
  type: string;
  eventSeq: number | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface PrivateAgentAction {
  actionId: string;
  playerId: string;
  roundNumber: number;
  actionType: string;
  baseRevision: number;
  belief: BeliefSnapshot;
  output: Record<string, unknown>;
  completedAt: string;
}

const eventToTimelineItem = (event: GameEvent): PublicTimelineItem => ({
  eventSeq: event.eventSeq,
  type: event.type,
  occurredAt: event.occurredAt,
  payload: event.payload,
});

export class GameRepository {
  constructor(private readonly database: AppDatabase) {}

  findProcessedCommand(commandId: string): ProcessedCommand | null {
    const row = this.database.sqlite
      .prepare('SELECT request_hash, response_json FROM processed_commands WHERE command_id = ?')
      .get(commandId) as { request_hash: string; response_json: string } | undefined;

    if (!row) {
      return null;
    }

    return {
      requestHash: row.request_hash,
      response: humanGameViewSchema.parse(JSON.parse(row.response_json)),
    };
  }

  findActiveSnapshot(): GameSnapshot | null {
    const row = this.database.sqlite
      .prepare(
        "SELECT game_id FROM games WHERE status IN ('preparing', 'in_progress', 'awaiting_spectator') LIMIT 1",
      )
      .get() as { game_id: string } | undefined;

    return row ? this.findSnapshot(row.game_id) : null;
  }

  findSnapshot(gameId: string): GameSnapshot | null {
    const row = this.database.sqlite
      .prepare('SELECT snapshot_json FROM games WHERE game_id = ?')
      .get(gameId) as { snapshot_json: string } | undefined;

    if (!row) return null;
    const snapshot = gameSnapshotSchema.parse(JSON.parse(row.snapshot_json));
    const eventHighWater = this.database.sqlite
      .prepare('SELECT COALESCE(MAX(event_seq), 0) AS value FROM game_events WHERE game_id = ?')
      .get(gameId) as { value: number };
    const streamHighWater = this.database.sqlite
      .prepare('SELECT COALESCE(MAX(stream_seq), 0) AS value FROM public_stream_entries WHERE game_id = ?')
      .get(gameId) as { value: number };
    if (eventHighWater.value !== snapshot.eventSeq || streamHighWater.value !== snapshot.streamSeq) {
      throw new Error('DATA_INCONSISTENT');
    }
    return snapshot;
  }

  getHumanView(gameId: string): HumanGameView | null {
    const snapshot = this.findSnapshot(gameId);
    if (!snapshot) {
      return null;
    }

    return projectHumanGameView(
      snapshot,
      this.listPublicTimeline(gameId),
      snapshot.status === 'finished' ? this.getFactReview(gameId) : undefined,
    );
  }

  saveCreated(
    snapshot: GameSnapshot,
    events: readonly GameEvent[],
    commandId: string,
    requestHash: string,
    response: HumanGameView,
  ) {
    const save = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          `INSERT INTO games (
            game_id, status, phase, revision, event_seq, stream_seq,
            snapshot_json, schema_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          snapshot.gameId,
          snapshot.status,
          snapshot.phase,
          snapshot.revision,
          snapshot.eventSeq,
          snapshot.streamSeq,
          JSON.stringify(snapshot),
          snapshot.schemaVersion,
          snapshot.createdAt,
          snapshot.updatedAt,
        );

      const insertPlayer = this.database.sqlite.prepare(
        `INSERT INTO game_players (
          game_id, player_id, seat_index, kind, display_name, camp, word_card,
          alive, silhouette, agent_role_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const player of snapshot.players) {
        insertPlayer.run(
          snapshot.gameId,
          player.playerId,
          player.seatIndex,
          player.kind,
          player.displayName,
          player.camp,
          player.wordCard,
          player.alive ? 1 : 0,
          player.silhouette ?? null,
          player.agentRoleId ?? null,
        );
      }

      this.insertEvents(events);
      this.database.sqlite
        .prepare(
          `INSERT INTO public_stream_entries (
            game_id, stream_seq, type, event_seq, payload_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          snapshot.gameId,
          snapshot.streamSeq,
          'state_synced',
          events[0]?.eventSeq ?? null,
          JSON.stringify({
            revision: snapshot.revision,
            status: snapshot.status,
            phase: snapshot.phase,
          }),
          snapshot.updatedAt,
        );
      this.insertProcessedCommand({
        commandId,
        gameId: snapshot.gameId,
        actorId: snapshot.humanPlayerId,
        requestHash,
        revisionBefore: 0,
        revisionAfter: snapshot.revision,
        response,
        completedAt: snapshot.updatedAt,
      });
    });

    save();
  }

  saveStarted(
    previous: GameSnapshot,
    snapshot: GameSnapshot,
    events: readonly GameEvent[],
    commandId: string,
    requestHash: string,
    response: HumanGameView,
  ) {
    this.commitTransition({ previous, snapshot, events, commandId, requestHash, response });
  }

  commitTransition(input: {
    previous: GameSnapshot;
    snapshot: GameSnapshot;
    events: readonly GameEvent[];
    commandId: string;
    requestHash: string;
    response: HumanGameView;
    privateAction?: PrivateAgentAction;
  }) {
    const save = this.database.sqlite.transaction(() => {
      const current = this.database.sqlite
        .prepare('SELECT revision FROM games WHERE game_id = ?')
        .get(input.snapshot.gameId) as { revision: number } | undefined;
      if (!current || current.revision !== input.previous.revision) {
        throw new Error('REVISION_CONFLICT');
      }

      this.insertEvents(input.events);
      if (input.privateAction) {
        this.database.sqlite
          .prepare(
            `INSERT INTO agent_actions (
              action_id, game_id, player_id, round_number, action_type, base_revision,
              belief_json, output_json, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.privateAction.actionId,
            input.snapshot.gameId,
            input.privateAction.playerId,
            input.privateAction.roundNumber,
            input.privateAction.actionType,
            input.privateAction.baseRevision,
            JSON.stringify(input.privateAction.belief),
            JSON.stringify(input.privateAction.output),
            input.privateAction.completedAt,
          );
      }

      const insertStream = this.database.sqlite.prepare(
        `INSERT INTO public_stream_entries (
          game_id, stream_seq, type, event_seq, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      let streamSeq = input.previous.streamSeq;
      for (const event of input.events.filter((candidate) => candidate.visibility === 'public')) {
        streamSeq += 1;
        insertStream.run(
          input.snapshot.gameId,
          streamSeq,
          event.type,
          event.eventSeq,
          JSON.stringify(event.payload),
          event.occurredAt,
        );
      }

      const update = this.database.sqlite
        .prepare(
          `UPDATE games SET
            status = ?, phase = ?, revision = ?, event_seq = ?, stream_seq = ?,
            snapshot_json = ?, updated_at = ?
          WHERE game_id = ? AND revision = ?`,
        )
        .run(
          input.snapshot.status,
          input.snapshot.phase,
          input.snapshot.revision,
          input.snapshot.eventSeq,
          input.snapshot.streamSeq,
          JSON.stringify(input.snapshot),
          input.snapshot.updatedAt,
          input.snapshot.gameId,
          input.previous.revision,
        );
      if (update.changes !== 1) throw new Error('REVISION_CONFLICT');

      this.insertProcessedCommand({
        commandId: input.commandId,
        gameId: input.snapshot.gameId,
        actorId: input.privateAction?.playerId ?? input.snapshot.humanPlayerId,
        requestHash: input.requestHash,
        revisionBefore: input.previous.revision,
        revisionAfter: input.snapshot.revision,
        response: input.response,
        completedAt: input.snapshot.updatedAt,
      });
    });
    save();
  }

  getFactReview(gameId: string): FactReview {
    const rows = this.database.sqlite
      .prepare(
        `SELECT action_id, player_id, round_number, action_type, base_revision,
                belief_json, output_json, completed_at
         FROM agent_actions WHERE game_id = ? ORDER BY round_number, base_revision, action_id`,
      )
      .all(gameId) as Array<{
      action_id: string;
      player_id: string;
      round_number: number;
      action_type: string;
      base_revision: number;
      belief_json: string;
      output_json: string;
      completed_at: string;
    }>;

    return factReviewSchema.parse({
      agentActions: rows.map((row) => ({
        actionId: row.action_id,
        playerId: row.player_id,
        roundNumber: row.round_number,
        actionType: row.action_type as ActionType,
        baseRevision: row.base_revision,
        belief: JSON.parse(row.belief_json) as BeliefSnapshot,
        output: JSON.parse(row.output_json) as Record<string, unknown>,
        completedAt: row.completed_at,
      })),
    });
  }

  listAgentBeliefs(gameId: string, playerId: string): BeliefSnapshot[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT belief_json FROM agent_actions
         WHERE game_id = ? AND player_id = ? ORDER BY round_number, base_revision`,
      )
      .all(gameId, playerId) as Array<{ belief_json: string }>;

    return rows.map((row) => JSON.parse(row.belief_json) as BeliefSnapshot);
  }

  listPublicFramesAfter(gameId: string, after: number): PublicStreamFrame[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT stream_seq, type, event_seq, payload_json, created_at
         FROM public_stream_entries WHERE game_id = ? AND stream_seq > ? ORDER BY stream_seq`,
      )
      .all(gameId, after) as Array<{
      stream_seq: number;
      type: string;
      event_seq: number | null;
      payload_json: string;
      created_at: string;
    }>;

    return rows.map((row) => ({
      streamSeq: row.stream_seq,
      type: row.type,
      eventSeq: row.event_seq,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      occurredAt: row.created_at,
    }));
  }

  listPublicTimeline(gameId: string): PublicTimelineItem[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT event_seq, type, payload_json, occurred_at
         FROM game_events WHERE game_id = ? AND visibility = 'public' ORDER BY event_seq`,
      )
      .all(gameId) as Array<{
      event_seq: number;
      type: string;
      payload_json: string;
      occurred_at: string;
    }>;

    return rows.map((row) => ({
      eventSeq: row.event_seq,
      type: row.type,
      occurredAt: row.occurred_at,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    }));
  }

  private insertEvents(events: readonly GameEvent[]) {
    const insert = this.database.sqlite.prepare(
      `INSERT INTO game_events (
        event_id, game_id, event_seq, type, visibility, command_id, action_id,
        payload_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const event of events) {
      insert.run(
        event.eventId,
        event.gameId,
        event.eventSeq,
        event.type,
        event.visibility,
        event.commandId ?? null,
        event.actionId ?? null,
        JSON.stringify(event.payload),
        event.occurredAt,
      );
    }
  }

  private insertProcessedCommand(input: {
    commandId: string;
    gameId: string;
    actorId: string;
    requestHash: string;
    revisionBefore: number;
    revisionAfter: number;
    response: HumanGameView;
    completedAt: string;
  }) {
    this.database.sqlite
      .prepare(
        `INSERT INTO processed_commands (
          command_id, game_id, actor_id, request_hash, revision_before,
          revision_after, response_json, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.commandId,
        input.gameId,
        input.actorId,
        input.requestHash,
        input.revisionBefore,
        input.revisionAfter,
        JSON.stringify(input.response),
        input.completedAt,
      );
  }

  publicTimelineWith(events: readonly GameEvent[]) {
    return events.filter((event) => event.visibility === 'public').map(eventToTimelineItem);
  }

  /** 复盘摘要 upsert：首次写入 created_at，之后仅更新状态/内容/error/updated_at。 */
  upsertReviewSummary(summary: ReviewSummary, now: string) {
    const parsed = reviewSummarySchema.parse(summary);
    this.database.sqlite
      .prepare(
        `INSERT INTO review_summaries (
          game_id, status, model_id, summary_json, error_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(game_id) DO UPDATE SET
          status = excluded.status,
          model_id = excluded.model_id,
          summary_json = excluded.summary_json,
          error_code = excluded.error_code,
          updated_at = excluded.updated_at`,
      )
      .run(
        parsed.gameId,
        parsed.status,
        parsed.modelId,
        JSON.stringify(parsed),
        parsed.errorCode ?? null,
        now,
        now,
      );
  }

  getReviewSummary(gameId: string): ReviewSummary | null {
    const row = this.database.sqlite
      .prepare('SELECT summary_json FROM review_summaries WHERE game_id = ?')
      .get(gameId) as { summary_json: string } | undefined;
    if (!row) return null;
    return reviewSummarySchema.parse(JSON.parse(row.summary_json));
  }

  /** 服务重启后需要重新生成的复盘（遗留在 pending/generating 的 game_id）。 */
  listRecoverableReviewGameIds(): string[] {
    const rows = this.database.sqlite
      .prepare(
        "SELECT game_id FROM review_summaries WHERE status IN ('pending', 'generating') ORDER BY created_at",
      )
      .all() as Array<{ game_id: string }>;
    return rows.map((row) => row.game_id);
  }
}
