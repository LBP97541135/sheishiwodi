import {
  activeGameDataSchema,
  apiErrorResponseSchema,
  apiSuccessSchema,
  availableModelListSchema,
  humanGameViewSchema,
  modelProfileListSchema,
  modelProfileSchema,
  reviewSummarySchema,
  type AbandonGameRequest,
  type ContinueSpectatingRequest,
  type CreateGameRequest,
  type HumanGameView,
  type ReviewSummary,
  type ResolveInterruptedGameRequest,
  type StartGameRequest,
  type SubmitDefenseRequest,
  type SubmitDescriptionRequest,
  type SubmitVoteRequest,
} from '@sheishiwodi/shared';

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const body: unknown = await response.json();

  if (!response.ok) {
    const parsed = apiErrorResponseSchema.parse(body);
    throw new ApiClientError(parsed.error.code, parsed.error.message);
  }

  return body;
}

export async function getActiveGame() {
  const body = await request('/api/games/active');
  return apiSuccessSchema(activeGameDataSchema).parse(body).data.game;
}

export async function createGame(input: CreateGameRequest) {
  const body = await request('/api/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return apiSuccessSchema(humanGameViewSchema).parse(body).data;
}

export async function startGame(gameId: string, input: StartGameRequest) {
  const body = await request(`/api/games/${gameId}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return apiSuccessSchema(humanGameViewSchema).parse(body).data;
}

export async function getGame(gameId: string) {
  const body = await request(`/api/games/${gameId}`);
  return apiSuccessSchema(humanGameViewSchema).parse(body).data;
}

export async function submitDescription(gameId: string, input: SubmitDescriptionRequest) {
  const body = await request(`/api/games/${gameId}/descriptions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return apiSuccessSchema(humanGameViewSchema).parse(body).data;
}

export async function submitDefense(gameId: string, input: SubmitDefenseRequest) {
  const body = await request(`/api/games/${gameId}/defenses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return apiSuccessSchema(humanGameViewSchema).parse(body).data;
}

export async function submitVote(gameId: string, input: SubmitVoteRequest) {
  const body = await request(`/api/games/${gameId}/votes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return apiSuccessSchema(humanGameViewSchema).parse(body).data;
}

export async function continueSpectating(gameId: string, input: ContinueSpectatingRequest) {
  const body = await request(`/api/games/${gameId}/spectate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return apiSuccessSchema(humanGameViewSchema).parse(body).data;
}

export async function abandonGame(gameId: string, input: AbandonGameRequest) {
  const body = await request(`/api/games/${gameId}/abandon`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return apiSuccessSchema(humanGameViewSchema).parse(body).data;
}

export async function resolveInterruptedGame(
  gameId: string,
  input: ResolveInterruptedGameRequest,
) {
  const body = await request(`/api/games/${gameId}/recovery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return apiSuccessSchema(humanGameViewSchema).parse(body).data;
}

export type { HumanGameView, ReviewSummary };

export async function getReview(gameId: string) {
  const body = await request(`/api/games/${gameId}/review`);
  return apiSuccessSchema(reviewSummarySchema).parse(body).data;
}

/** 复盘 Markdown 导出地址（同源，经 Vite 代理到服务端；附件下载）。 */
export function reviewExportPath(gameId: string) {
  return `/api/games/${gameId}/export.md`;
}

export async function regenerateReview(gameId: string) {
  const body = await request(`/api/games/${gameId}/review/regenerate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  return apiSuccessSchema(reviewSummarySchema).parse(body).data;
}

export async function getModelProfiles() {
  const body = await request('/api/model-profiles');
  return apiSuccessSchema(modelProfileListSchema).parse(body).data;
}

export async function getModels() {
  const body = await request('/api/models');
  return apiSuccessSchema(availableModelListSchema).parse(body).data;
}

export async function updateModelSelection(roleId: string, modelId: string) {
  const body = await request(`/api/model-profiles/${roleId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modelId }),
  });
  return apiSuccessSchema(modelProfileSchema).parse(body).data;
}
