const FNV_OFFSET = 2166136261 >>> 0;
const FNV_PRIME = 16777619 >>> 0;

function fnv1a(input: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

export interface Embedder {
  readonly dim: number;
  embed(text: string): number[];
  embedMany(texts: string[]): number[][];
}

export class HashingEmbedder implements Embedder {
  readonly dim: number;

  constructor(dim = 1536) {
    if (dim <= 0 || (dim & 1) !== 0) {
      throw new Error(`embedder dim must be a positive even number, got ${dim}`);
    }
    this.dim = dim;
  }

  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9_./-]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  embed(text: string): number[] {
    const v = new Float64Array(this.dim);
    const tokens = this.tokenize(text);
    if (tokens.length === 0) {
      v[0] = 1;
      return Array.from(this.normalize(v));
    }
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      const h = fnv1a(t);
      const bucket = h % (this.dim / 2);
      const sign = (h & 1) === 0 ? 1 : -1;
      const idx = bucket * 2;
      v[idx] = sign * 1 + (v[idx] ?? 0);
      if (i + 1 < tokens.length) {
        const bg = `${t}__${tokens[i + 1]}`;
        const h2 = fnv1a(bg);
        const bucket2 = h2 % (this.dim / 2);
        const sign2 = (h2 & 1) === 0 ? 1 : -1;
        const idx2 = bucket2 * 2;
        v[idx2] = sign2 * 2 + (v[idx2] ?? 0);
      }
    }
    return Array.from(this.normalize(v));
  }

  embedMany(texts: string[]): number[][] {
    return texts.map((t) => this.embed(t));
  }

  private normalize(v: Float64Array): Float64Array {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += (v[i] ?? 0) ** 2;
    const norm = Math.sqrt(s);
    if (norm === 0) return v;
    for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / norm;
    return v;
  }
}

export function vectorToSql(vec: number[]): string {
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error("vectorToSql: empty vector");
  }
  const parts: string[] = [];
  for (let i = 0; i < vec.length; i++) {
    const n = vec[i];
    if (typeof n !== "number" || !Number.isFinite(n)) {
      throw new Error(`vectorToSql: non-finite at index ${i}`);
    }
    parts.push(n.toFixed(8));
  }
  return `[${parts.join(",")}]`;
}
