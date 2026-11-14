import pg from 'pg';
let pool;

export function createPool(connectionString) {
  if (!connectionString || !/^postgres(?:ql)?:\/\//.test(connectionString)) throw new Error('Configura DATABASE_URL con la conexion PostgreSQL de Railway.');
  // Se conservan las opciones TLS de la URL. No se desactiva la verificacion.
  const created = new pg.Pool({ connectionString, max: 5,
    connectionTimeoutMillis: 15000, idleTimeoutMillis: 60000,
    statement_timeout: 20000, query_timeout: 25000 });
  created.on('error', error => console.error('Conexion PostgreSQL interrumpida:', error.code || 'error'));
  return created;
}
export function getPool() { return pool ||= createPool(process.env.DATABASE_URL); }
export async function query(text, parameters = []) { return (await getPool().query(text, parameters)).rows; }
export async function closeDatabase() { const current = pool; pool = null; if (current) await current.end(); }
