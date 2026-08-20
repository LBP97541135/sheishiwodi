import {
  activeGameDataSchema,
  apiErrorResponseSchema,
  apiSuccessSchema,
  availableModelListSchema,
  characterProfileListSchema,
  characterProfileSchema,
  developerFullRecordClearResultSchema,
  developerFullRecordDetailSchema,
  developerFullRecordListSchema,
  developerOverviewSchema,
  fullRecordingStateSchema,
  humanGameViewSchema,
  modelProfileListSchema,
  modelProfileSchema,
  reviewSummarySchema,
  type AbandonGameRequest,
  type ContinueSpectatingRequest,
  type UpsertCharacterProfile,
  type CreateGameRequest,
  type HumanGameView,
  type ReviewSummary,
  type ResolveInterruptedGameRequest,
  type StartGameRequest,
  type SubmitDefenseRequest,
  type SubmitDescriptionRequest,
  type SubmitGuessRequest,
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
  return (await getActiveGameState()).game;
}

export async function getActiveGameState() {
  const body = await request('/api/games/active');
  return apiSuccessSchema(activeGameDataSchema).parse(body).data;
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

export async function submitGuess(gameId: string, input: SubmitGuessRequest) {
  const body = await request(`/api/games/${gameId}/guesses`, {
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

export async function getCharacterProfiles() {
  const body = await request('/api/character-profiles');
  return apiSuccessSchema(characterProfileListSchema).parse(body).data;
}

export async function createCharacterProfile(input: UpsertCharacterProfile) {
  const body = await request('/api/character-profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return apiSuccessSchema(characterProfileSchema).parse(body).data;
}

export async function updateCharacterProfile(profileId: string, input: UpsertCharacterProfile) {
  const body = await request(`/api/character-profiles/${encodeURIComponent(profileId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return apiSuccessSchema(characterProfileSchema).parse(body).data;
}

export async function copyCharacterProfile(profileId: string) {
  const body = await request(`/api/character-profiles/${encodeURIComponent(profileId)}/copies`, {
    method: 'POST',
  });
  return apiSuccessSchema(characterProfileSchema).parse(body).data;
}

export async function deleteCharacterProfile(profileId: string) {
  const response = await fetch(`/api/character-profiles/${encodeURIComponent(profileId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const parsed = apiErrorResponseSchema.parse(await response.json());
    throw new ApiClientError(parsed.error.code, parsed.error.message);
  }
}

export async function setAutomationMode(gameId: string, mode: 'auto' | 'paused' | 'step') {
  const body = await request(`/api/games/${gameId}/automation`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  return apiSuccessSchema(humanGameViewSchema).parse(body).data;
}

export async function addRequestBudget(gameId: string, amount: number) {
  const body = await request(`/api/games/${gameId}/request-budget`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount }),
  });
  return apiSuccessSchema(humanGameViewSchema).parse(body).data;
}

export async function getDeveloperOverview(gameId?: string) {
  const query = gameId ? `?gameId=${encodeURIComponent(gameId)}` : '';
  const body = await request(`/api/developer/overview${query}`);
  return apiSuccessSchema(developerOverviewSchema).parse(body).data;
}

export async function setFullContextRecording(enabled: boolean) {
  const body = await request('/api/developer/full-recording', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  return apiSuccessSchema(fullRecordingStateSchema).parse(body).data;
}

export async function getDeveloperFullRecords(gameId?: string) {
  const query = gameId ? `?gameId=${encodeURIComponent(gameId)}` : '';
  const body = await request(`/api/developer/full-records${query}`);
  return apiSuccessSchema(developerFullRecordListSchema).parse(body).data.records;
}

export async function getDeveloperFullRecord(attemptId: string) {
  const body = await request(`/api/developer/full-records/${encodeURIComponent(attemptId)}`);
  return apiSuccessSchema(developerFullRecordDetailSchema).parse(body).data;
}

export async function clearDeveloperFullRecords() {
  const body = await request('/api/developer/full-records', { method: 'DELETE' });
  return apiSuccessSchema(developerFullRecordClearResultSchema).parse(body).data;
}
