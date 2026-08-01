import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { createServer } from "net";
import { getLogger } from "./logger";
import { getModelManager } from "./models";
import { LlamaServerChatRequest } from "../types/interfaces";

const SERVER_HOST = "127.0.0.1";
const START_TIMEOUT_MS = 5 * 60 * 1000;

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

class LlamaServerManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private port: number | null = null;
  private activeModel: string | null = null;
  private startingModel: string | null = null;
  private startPromise: Promise<void> | null = null;
  private requests = new Map<string, AbortController>();

  public async start(modelName: string): Promise<void> {
    if (this.activeModel === modelName && this.child && this.port) return;
    if (this.startingModel === modelName && this.startPromise) {
      return this.startPromise;
    }

    this.startingModel = modelName;
    this.startPromise = this.startProcess(modelName);

    try {
      await this.startPromise;
    } finally {
      this.startingModel = null;
      this.startPromise = null;
    }
  }

  private async startProcess(modelName: string): Promise<void> {
    await this.stop();

    const executable = process.env.CLIPPY_LLAMA_SERVER;
    if (!executable) {
      throw new Error(
        "MTP backend is unavailable: CLIPPY_LLAMA_SERVER is not configured",
      );
    }

    const model = getModelManager().getModelByName(modelName);
    if (!model?.downloaded || !model.path || !model.mtpMode) {
      throw new Error(`MTP model is not ready: ${modelName}`);
    }
    if (model.mtpMode === "draft" && !model.draftPath) {
      throw new Error(`MTP drafter is missing for ${modelName}`);
    }

    const port = await getAvailablePort();
    const args = [
      "--model",
      model.path,
      "--host",
      SERVER_HOST,
      "--port",
      String(port),
      "--ctx-size",
      "8192",
      "--fit",
      "on",
      "--fit-target",
      "2048",
      "--jinja",
      "--no-webui",
      "--spec-type",
      "draft-mtp",
      "--spec-draft-n-max",
      String(model.mtpDraftTokens || 2),
    ];

    if (model.mtpMode === "draft" && model.draftPath) {
      args.push("--spec-draft-model", model.draftPath);
    }

    getLogger().info("Starting llama-server MTP backend", {
      executable,
      model: modelName,
      port,
      mtpMode: model.mtpMode,
    });

    const child = spawn(executable, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    this.port = port;

    child.stdout.on("data", (data: Buffer) =>
      getLogger().info(`[llama-server] ${data.toString().trimEnd()}`),
    );
    child.stderr.on("data", (data: Buffer) =>
      getLogger().info(`[llama-server] ${data.toString().trimEnd()}`),
    );
    child.once("exit", (code, signal) => {
      getLogger().info("llama-server exited", { code, signal });
      if (this.child === child) {
        this.child = null;
        this.port = null;
        this.activeModel = null;
      }
    });

    try {
      await waitUntilHealthy(child, port);
      if (this.child !== child) {
        throw new Error("llama-server was stopped while loading");
      }
      this.activeModel = modelName;
    } catch (error) {
      child.kill("SIGTERM");
      if (this.child === child) {
        this.child = null;
        this.port = null;
      }
      throw error;
    }
  }

  public async stop(): Promise<void> {
    for (const controller of this.requests.values()) controller.abort();
    this.requests.clear();
    this.activeModel = null;

    const child = this.child;
    this.child = null;
    this.port = null;
    if (!child || child.exitCode !== null) return;

    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
          resolve();
        }, 5000),
      ),
    ]);
  }

  public stopNow(): void {
    for (const controller of this.requests.values()) controller.abort();
    this.requests.clear();
    this.child?.kill("SIGTERM");
    this.child = null;
    this.port = null;
    this.activeModel = null;
  }

  public async chat(request: LlamaServerChatRequest): Promise<string> {
    if (!this.child || !this.port || !this.activeModel) {
      throw new Error("MTP backend is not running");
    }

    const controller = new AbortController();
    this.requests.set(request.requestUUID, controller);

    try {
      const response = await fetch(
        `http://${SERVER_HOST}:${this.port}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            messages: [
              { role: "system", content: request.systemPrompt },
              ...request.messages,
            ],
            temperature: request.temperature,
            top_k: request.topK,
            stream: false,
          }),
        },
      );
      const body = (await response.json()) as ChatCompletionResponse;
      if (!response.ok) {
        throw new Error(
          body.error?.message ||
            `llama-server returned HTTP ${response.status}`,
        );
      }

      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("llama-server returned an empty response");
      }
      return content;
    } finally {
      this.requests.delete(request.requestUUID);
    }
  }

  public abort(requestUUID: string): void {
    this.requests.get(requestUUID)?.abort();
  }
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, SERVER_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a llama-server port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitUntilHealthy(
  child: ChildProcessWithoutNullStreams,
  port: number,
): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `llama-server exited while loading (code ${child.exitCode})`,
      );
    }

    try {
      const response = await fetch(`http://${SERVER_HOST}:${port}/health`);
      if (response.ok) return;
    } catch {
      // The socket is not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out while loading the MTP model");
}

let manager: LlamaServerManager | null = null;
export function getLlamaServerManager(): LlamaServerManager {
  if (!manager) manager = new LlamaServerManager();
  return manager;
}
