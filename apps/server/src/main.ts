import { loadDotEnv } from './config/env.js';
import { buildServer, createRuntimeDependencies } from './server.js';

loadDotEnv();

for (const argument of process.argv.slice(2)) {
  if (argument.startsWith('--fake-agent-scenario=')) {
    process.env['FAKE_AGENT_SCENARIO'] = argument.slice('--fake-agent-scenario='.length);
  }
  if (argument.startsWith('--database-path=')) {
    process.env['DATABASE_PATH'] = argument.slice('--database-path='.length);
  }
  if (argument.startsWith('--fake-random-sequence=')) {
    process.env['FAKE_RANDOM_SEQUENCE'] = argument.slice('--fake-random-sequence='.length);
  }
}

const apiPort = readPort(process.env['SHEISHIWODI_API_PORT'], 3001);
const dependencies = createRuntimeDependencies();
const server = buildServer(dependencies);

const close = async () => {
  await server.close();
  dependencies.database.close();
};

process.once('SIGINT', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});

try {
  await server.listen({
    host: '127.0.0.1',
    port: apiPort,
  });
} catch (error) {
  server.log.error(error);
  process.exitCode = 1;
}

function readPort(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('SHEISHIWODI_API_PORT must be an integer between 1 and 65535');
  }
  return parsed;
}
