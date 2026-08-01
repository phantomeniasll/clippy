import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { createServer } from "net";
import { getLogger } from "./logger";
import { getModelManager } from "./models";
import {
  LlamaServerChatChunk,
  LlamaServerChatRequest,
  LlamaServerChatResponse,
} from "../types/interfaces";

const SERVER_HOST = "127.0.0.1";
const START_TIMEOUT_MS = 5 * 60 * 1000;

type ChatCompletionResponse = {
  choices?: Array<{
    message?: { content?: string; reasoning_content?: string };
    delta?: { content?: string; reasoning_content?: string };
  }>;
  error?: { message?: string };
  timings?: { predicted_per_second?: number };
  usage?: { completion_tokens?: number };
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
      // Clippy serializes chat requests, so extra server slots only duplicate
      // context/KV memory. On memory-constrained systems that can make --fit
      // move model layers back to the CPU and sharply reduce throughput.
      "--parallel",
      "1",
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

  public async chat(
    request: LlamaServerChatRequest,
    onChunk: (chunk: LlamaServerChatChunk) => void,
  ): Promise<LlamaServerChatResponse> {
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
            stream: true,
            stream_options: { include_usage: true },
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as ChatCompletionResponse;
        throw new Error(
          body.error?.message ||
            `llama-server returned HTTP ${response.status}`,
        );
      }

      if (!response.body) {
        throw new Error("llama-server returned an empty response");
      }

      let content = "";
      let reasoningContent = "";
      let tokensPerSecond: number | undefined;
      let completionTokens: number | undefined;

      await consumeServerSentEvents(response.body, (body) => {
        const choice = body.choices?.[0];
        const contentChunk = choice?.delta?.content;
        const reasoningChunk = choice?.delta?.reasoning_content;

        if (typeof contentChunk === "string" && contentChunk) {
          content += contentChunk;
          onChunk({ content: contentChunk });
        }
        if (typeof reasoningChunk === "string" && reasoningChunk) {
          reasoningContent += reasoningChunk;
          onChunk({ reasoningContent: reasoningChunk });
        }

        if (typeof body.timings?.predicted_per_second === "number") {
          tokensPerSecond = body.timings.predicted_per_second;
        }
        if (typeof body.usage?.completion_tokens === "number") {
          completionTokens = body.usage.completion_tokens;
        }
      });

      const thinkingTokens = reasoningContent
        ? await this.countTokens(reasoningContent, controller.signal)
        : 0;

      return {
        content,
        reasoningContent,
        tokensPerSecond,
        completionTokens,
        thinkingTokens,
      };
    } finally {
      this.requests.delete(request.requestUUID);
    }
  }

  private async countTokens(content: string, signal: AbortSignal) {
    if (!this.port) return 0;

    try {
      const response = await fetch(
        `http://${SERVER_HOST}:${this.port}/tokenize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({ content, add_special: false }),
        },
      );
      if (!response.ok) return 0;

      const body = (await response.json()) as { tokens?: unknown[] };
      return Array.isArray(body.tokens) ? body.tokens.length : 0;
    } catch {
      return 0;
    }
  }

  public abort(requestUUID: string): void {
    this.requests.get(requestUUID)?.abort();
  }
}

async function consumeServerSentEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatCompletionResponse) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeBuffer = (flush = false) => {
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = flush ? "" : blocks.pop() || "";

    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;

      try {
        onEvent(JSON.parse(data) as ChatCompletionResponse);
      } catch (error) {
        getLogger().warn("Could not parse llama-server stream event", {
          error,
        });
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    consumeBuffer();
  }

  buffer += decoder.decode();
  if (buffer.trim()) buffer += "\n\n";
  consumeBuffer(true);
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
