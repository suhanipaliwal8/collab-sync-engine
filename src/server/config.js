// Local development database (the one in docker-compose.yml).
// In any real deployment, set the DATABASE_URL environment variable instead
// and never commit real passwords.
const DEV_DATABASE_URL = 'postgres://collab:collab_dev_password@localhost:5433/collab_sync';

export function getDatabaseUrl(env = process.env) {
  return env.DATABASE_URL || DEV_DATABASE_URL;
}