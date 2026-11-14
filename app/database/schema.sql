-- Ejecutar en el SQL Editor de una base PostgreSQL dedicada al proyecto.
-- No incluye DROP, TRUNCATE ni borrado de registros existentes.
BEGIN;

CREATE TABLE IF NOT EXISTS camaras (
  id text PRIMARY KEY,
  nombre text NOT NULL,
  ubicacion text,
  creada_en timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO camaras (id, nombre) VALUES ('camara-1', 'Camara XIAO 1')
ON CONFLICT (id) DO NOTHING;

-- Solo una fila por camara: ventana de promedio y ultima miniatura.
CREATE TABLE IF NOT EXISTS estado_camara (
  camara_id text PRIMARY KEY REFERENCES camaras(id),
  revision bigint NOT NULL CHECK (revision > 0),
  estado jsonb NOT NULL CHECK (jsonb_typeof(estado) = 'object'),
  actualizado_en timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Una fila por captura analizada. Las probabilidades se guardan entre 0 y 1.
CREATE TABLE IF NOT EXISTS mediciones (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  camara_id text NOT NULL REFERENCES camaras(id),
  recibido_en timestamptz NOT NULL,
  arranque text NOT NULL CHECK (arranque ~ '^[a-f0-9]{16}$'),
  secuencia bigint NOT NULL CHECK (secuencia >= 0),
  conclusion text NOT NULL CHECK (conclusion IN ('Hay basura', 'Sin basura', 'No seguro')),
  p_sin_basura double precision NOT NULL CHECK (p_sin_basura BETWEEN 0 AND 1),
  p_botellas double precision NOT NULL CHECK (p_botellas BETWEEN 0 AND 1),
  p_papeles_cartones double precision NOT NULL CHECK (p_papeles_cartones BETWEEN 0 AND 1),
  p_bolsas double precision NOT NULL CHECK (p_bolsas BETWEEN 0 AND 1),
  basura_actual double precision NOT NULL CHECK (basura_actual BETWEEN 0 AND 1),
  basura_promedio double precision NOT NULL CHECK (basura_promedio BETWEEN 0 AND 1),
  umbral double precision NOT NULL CHECK (umbral BETWEEN 0.60 AND 0.95),
  capturas_promedio smallint NOT NULL CHECK (capturas_promedio BETWEEN 1 AND 5),
  confirmaciones smallint NOT NULL CHECK (confirmaciones BETWEEN 0 AND 3),
  analisis_ms integer NOT NULL CHECK (analisis_ms >= 0),
  UNIQUE (camara_id, arranque, secuencia),
  CHECK (abs(p_sin_basura + p_botellas + p_papeles_cartones + p_bolsas - 1) <= 0.001)
);

CREATE INDEX IF NOT EXISTS mediciones_camara_id_desc ON mediciones (camara_id, id DESC);
COMMIT;
