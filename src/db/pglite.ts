import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { vectorToSql, type Embedder } from "../embeddings.js";
import type { WikiHit } from "../state.js";

export interface MemoryStoreOptions {
  dataDir?: string;
  inMemory?: boolean;
  embedder: Embedder;
}

export interface MemoryStore {
  db: PGlite;
  embedder: Embedder;
  init(): Promise<void>;
  upsertWiki(entitySlug: string, content: string, embedding: number[]): Promise<number>;
  searchWiki(embedding: number[], limit: number): Promise<WikiHit[]>;
  countWiki(): Promise<number>;
  close(): Promise<void>;
}

const SCHEMA = (dim: number) => `
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE IF NOT EXISTS security_knowledge_wiki (
    id SERIAL PRIMARY KEY,
    entity_slug TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(${dim}),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS wiki_entity_idx ON security_knowledge_wiki (entity_slug);
`;

function buildIndexSql(): string {
  return `
    CREATE INDEX IF NOT EXISTS wiki_embedding_idx
    ON security_knowledge_wiki USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
  `;
}

export async function createMemoryStore(opts: MemoryStoreOptions): Promise<MemoryStore> {
  const pgOpts: ConstructorParameters<typeof PGlite>[0] = { extensions: { vector } };
  let db: PGlite;
  if (opts.inMemory) {
    db = await PGlite.create("memory://", pgOpts);
  } else if (!opts.dataDir) {
    throw new Error("dataDir required when not inMemory");
  } else {
    db = new PGlite(opts.dataDir, pgOpts);
  }

  const store: MemoryStore = {
    db,
    embedder: opts.embedder,
    async init() {
      await db.exec(SCHEMA(opts.embedder.dim));
      await db.exec(buildIndexSql());
    },
    async upsertWiki(entitySlug, content, embedding) {
      const vecSql = vectorToSql(embedding);
      const safeSlug = entitySlug.replace(/'/g, "''");
      const safeContent = content.replace(/'/g, "''");
      const sql = `INSERT INTO security_knowledge_wiki (entity_slug, content, embedding) VALUES ('${safeSlug}', '${safeContent}', '${vecSql}'::vector) RETURNING id`;
      const result = await db.query<{ id: number }>(sql);
      return result.rows[0]?.id ?? 0;
    },
    async searchWiki(embedding, limit) {
      const vecSql = vectorToSql(embedding);
      const lim = Math.max(1, Math.min(100, limit));
      const sql = `SELECT entity_slug, content, 1 - (embedding <=> '${vecSql}'::vector) AS similarity FROM security_knowledge_wiki ORDER BY embedding <=> '${vecSql}'::vector LIMIT ${lim}`;
      const result = await db.query<{ entity_slug: string; content: string; similarity: number }>(sql);
      return result.rows.map((r) => ({
        entitySlug: r.entity_slug,
        content: r.content,
        similarity: Number(r.similarity),
      }));
    },
    async countWiki() {
      const r = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM security_knowledge_wiki");
      return r.rows[0]?.n ?? 0;
    },
    async close() {
      await db.close();
    },
  };
  return store;
}
