import { BaseCheckpointSaver, type Checkpoint, type CheckpointMetadata, type CheckpointTuple, type ChannelVersions, type PendingWrite, type CheckpointListOptions } from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

interface StoredCheckpoint {
  config: RunnableConfig;
  checkpoint: Checkpoint;
  metadata?: CheckpointMetadata;
  parentConfig?: RunnableConfig;
  pendingWrites: Array<[string, string, unknown]>;
}

export class FileCheckpointSaver extends BaseCheckpointSaver<number> {
  private readonly dir: string;
  private readonly writes = new Map<string, Array<[string, string, unknown]>>();

  constructor(opts: { dataDir: string }) {
    super();
    this.dir = resolve(opts.dataDir);
  }

  private fileFor(threadId: string, checkpointId: string): string {
    return join(this.dir, "threads", threadId, `${checkpointId}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private async loadAll(threadId: string): Promise<StoredCheckpoint[]> {
    const threadDir = join(this.dir, "threads", threadId);
    try {
      const files = await readdir(threadDir);
      const out: StoredCheckpoint[] = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const txt = await readFile(join(threadDir, f), "utf8");
        out.push(JSON.parse(txt));
      }
      return out;
    } catch {
      return [];
    }
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    await this.ensureDir();
    const threadId = String(config?.configurable?.thread_id ?? "");
    if (!threadId) return undefined;
    const checkpointId = String(config?.configurable?.checkpoint_id ?? "");
    const all = await this.loadAll(threadId);
    if (all.length === 0) return undefined;
    let match: StoredCheckpoint | undefined;
    if (checkpointId) {
      match = all.find((s) => s.checkpoint.id === checkpointId);
    } else {
      match = all.sort((a, b) => (a.checkpoint.ts < b.checkpoint.ts ? 1 : -1))[0];
    }
    if (!match) return undefined;
    const writes = this.writes.get(`${threadId}:${match.checkpoint.id}`) ?? match.pendingWrites ?? [];
    return {
      config: match.config,
      checkpoint: match.checkpoint,
      metadata: match.metadata,
      parentConfig: match.parentConfig,
      pendingWrites: writes as [string, string, unknown][],
    };
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    await this.ensureDir();
    const threadId = String(config?.configurable?.thread_id ?? "");
    if (!threadId) return;
    const all = await this.loadAll(threadId);
    const sorted = all.sort((a, b) => (a.checkpoint.ts < b.checkpoint.ts ? 1 : -1));
    const lim = options?.limit ?? sorted.length;
    for (const s of sorted.slice(0, lim)) {
      yield {
        config: s.config,
        checkpoint: s.checkpoint,
        metadata: s.metadata,
        parentConfig: s.parentConfig,
        pendingWrites: [],
      };
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata, _newVersions: ChannelVersions): Promise<RunnableConfig> {
    await this.ensureDir();
    const threadId = String(config?.configurable?.thread_id ?? "");
    if (!threadId) throw new Error("FileCheckpointSaver: missing thread_id");
    const cpId = checkpoint.id || randomUUID();
    const stored: StoredCheckpoint = {
      config: { configurable: { ...config.configurable, checkpoint_id: cpId } },
      checkpoint: { ...checkpoint, id: cpId },
      metadata,
      parentConfig: config,
      pendingWrites: [],
    };
    await mkdir(join(this.dir, "threads", threadId), { recursive: true });
    await writeFile(this.fileFor(threadId, cpId), JSON.stringify(stored), "utf8");
    return { configurable: { ...config.configurable, checkpoint_id: cpId } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = String(config?.configurable?.thread_id ?? "");
    const cpId = String(config?.configurable?.checkpoint_id ?? "");
    if (!threadId || !cpId) return;
    const key = `${threadId}:${cpId}`;
    const list = this.writes.get(key) ?? [];
    for (const [channel, value] of writes) {
      list.push([taskId, channel, value]);
    }
    this.writes.set(key, list);
  }

  async deleteThread(threadId: string): Promise<void> {
    const threadDir = join(this.dir, "threads", threadId);
    try {
      const files = await readdir(threadDir);
      for (const f of files) {
        await unlink(join(threadDir, f));
      }
    } catch {
      // no-op
    }
  }
}
