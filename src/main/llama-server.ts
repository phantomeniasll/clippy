import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { createServer } from "net";
import fs from "fs";
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
  private activeMtp = false;
  private startingModel: string | null = null;
  private startingMtp = false;
  private startPromise: Promise<void> | null = null;
  private requests = new Map<string, AbortController>();

  public async start(modelName: string, enableMtp = true): Promise<void> {
    const requestedModel = getModelManager().getModelByName(modelName);
    const forceQwen38Mtp =
      requestedModel?.runtimePreset === "qwen3.8" &&
      requestedModel.mtpMode === "embedded";
    const effectiveEnableMtp = enableMtp || forceQwen38Mtp;

    if (!enableMtp && forceQwen38Mtp) {
      // llama.cpp b10450 incorrectly skips the complete hybrid final block
      // when an embedded Qwen3.8 MTP model is loaded without MTP. The result
      // is corrupt repeated-token output, so keep the known-good graph active.
      getLogger().warn(
        "Qwen3.8 requires MTP with the bundled llama.cpp; ignoring disabled MTP setting",
      );
    }

    if (
      this.activeModel === modelName &&
      this.activeMtp === effectiveEnableMtp &&
      this.child &&
      this.port
    ) {
      return;
    }
    if (
      this.startingModel === modelName &&
      this.startingMtp === effectiveEnableMtp &&
      this.startPromise
    ) {
      return this.startPromise;
    }

    this.startingModel = modelName;
    this.startingMtp = effectiveEnableMtp;
    this.startPromise = this.startProcess(modelName, effectiveEnableMtp);

    try {
      await this.startPromise;
    } finally {
      this.startingModel = null;
      this.startingMtp = false;
      this.startPromise = null;
    }
  }

  private async startProcess(
    modelName: string,
    enableMtp: boolean,
  ): Promise<void> {
    await this.stop();

    const executable = process.env.CLIPPY_LLAMA_SERVER;
    if (!executable) {
      throw new Error(
        "llama-server backend is unavailable: CLIPPY_LLAMA_SERVER is not configured",
      );
    }

    const model = getModelManager().getModelByName(modelName);
    if (!model?.downloaded || !model.path || !model.mtpMode) {
      throw new Error(`llama-server model is not ready: ${modelName}`);
    }
    if (enableMtp && model.mtpMode === "draft" && !model.draftPath) {
      throw new Error(`MTP drafter is missing for ${modelName}`);
    }

    const port = await getAvailablePort();
    const qwen38CpuOnly =
      model.runtimePreset === "qwen3.8" && shouldUseCpuForQwen38();
    const qwen38FullGpu =
      model.runtimePreset === "qwen3.8" &&
      !qwen38CpuOnly &&
      model.size <=
        Number(process.env.CLIPPY_QWEN38_FULL_GPU_MAX_MIB || "10000");
    const args = [
      "--model",
      model.path,
      "--host",
      SERVER_HOST,
      "--port",
      String(port),
      "--ctx-size",
      // A 32K Qwen3.8 context can consume most of a 32 GiB APU's shared GTT
      // before the first token and leave the driver stuck swapping buffers.
      // 8K remains useful for desktop chat while leaving room for MTP.
      "8192",
      // Clippy serializes chat requests, so extra server slots only duplicate
      // context/KV memory. On memory-constrained systems that can make --fit
      // move model layers back to the CPU and sharply reduce throughput.
      "--parallel",
      "1",
      "--jinja",
      "--no-webui",
    ];

    if (model.runtimePreset === "qwen3.8") {
      if (qwen38CpuOnly) {
        args.push(
          "--fit",
          "off",
          "--device",
          "none",
          "--spec-draft-device",
          "none",
        );
      } else if (qwen38FullGpu) {
        // The 9.4 GiB Q2 quant fits completely in the 860M's shared pool.
        // Controlled benchmarks were faster and remained stable with every
        // target and embedded-draft layer explicitly placed on ROCm.
        args.push(
          "--fit",
          "off",
          "--gpu-layers",
          "all",
          "--spec-draft-ngl",
          "all",
          "--flash-attn",
          "on",
        );
      } else {
        args.push(
          "--fit",
          "on",
          // This is shared system RAM on an APU. Keep enough genuinely free
          // for Plasma/Electron instead of treating all 24 GiB of GTT as VRAM.
          "--fit-target",
          process.env.CLIPPY_QWEN38_FIT_TARGET || "4096",
          "--flash-attn",
          "on",
        );
      }

      args.push(
        "--cache-type-k",
        "q8_0",
        "--cache-type-v",
        "q8_0",
        "--reasoning-format",
        "deepseek",
      );
    } else {
      args.push("--fit", "on", "--fit-target", "2048");
    }

    if (enableMtp) {
      args.push(
        "--spec-type",
        "draft-mtp",
        "--spec-draft-n-max",
        model.runtimePreset === "qwen3.8"
          ? process.env.CLIPPY_QWEN38_MTP_DRAFT_TOKENS || "2"
          : String(model.mtpDraftTokens || 2),
      );

      if (model.mtpMode === "draft" && model.draftPath) {
        args.push("--spec-draft-model", model.draftPath);
      }
    }

    getLogger().info("Starting llama-server backend", {
      executable,
      model: modelName,
      port,
      mtpMode: model.mtpMode,
      enableMtp,
      runtimePreset: model.runtimePreset,
      devicePreset: qwen38CpuOnly
        ? "cpu"
        : qwen38FullGpu
          ? "rocm-full"
          : "auto",
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
        this.activeMtp = false;
      }
    });

    try {
      await waitUntilHealthy(child, port);
      if (this.child !== child) {
        throw new Error("llama-server was stopped while loading");
      }
      this.activeModel = modelName;
      this.activeMtp = enableMtp;
    } catch (error) {
      child.kill("SIGTERM");
      if (this.child === child) {
        this.child = null;
        this.port = null;
        this.activeMtp = false;
      }
      throw error;
    }
  }

  public async stop(): Promise<void> {
    for (const controller of this.requests.values()) controller.abort();
    this.requests.clear();
    this.activeModel = null;
    this.activeMtp = false;

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
    this.activeMtp = false;
  }

  public async chat(
    request: LlamaServerChatRequest,
    onChunk: (chunk: LlamaServerChatChunk) => void,
  ): Promise<LlamaServerChatResponse> {
    if (!this.child || !this.port || !this.activeModel) {
      throw new Error("llama-server backend is not running");
    }

    const controller = new AbortController();
    this.requests.set(request.requestUUID, controller);

    try {
      const model = getModelManager().getModelByName(this.activeModel);
      const qwen38Preset = model?.runtimePreset === "qwen3.8";
      const enableThinking = request.reasoningEffort !== "off";
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
            temperature: qwen38Preset
              ? enableThinking
                ? 1.0
                : 0.7
              : request.temperature,
            top_k: qwen38Preset ? 20 : request.topK,
            ...(qwen38Preset
              ? {
                  top_p: enableThinking ? 0.95 : 0.8,
                  min_p: 0.0,
                  presence_penalty: enableThinking ? 0.0 : 1.5,
                  repeat_penalty: 1.0,
                  reasoning_format: "deepseek",
                  chat_template_kwargs: {
                    enable_thinking: enableThinking,
                    preserve_thinking: true,
                    ...(enableThinking
                      ? {
                          reasoning_effort: request.reasoningEffort || "xhigh",
                        }
                      : {}),
                  },
                }
              : {}),
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

function shouldUseCpuForQwen38(): boolean {
  const override = process.env.CLIPPY_QWEN38_DEVICE?.toLowerCase();
  if (override === "cpu" || override === "none") return true;
  if (override === "auto" || override === "gpu") return false;

  // The packaged HIP backend has a gfx1151-compatible kernel build plus UMA
  // enabled for the gfx1152 Radeon 860M. The older Vulkan backend remains
  // unsafe by default on this APU because RADV can stall the desktop while
  // evicting a model-sized GTT allocation.
  if (process.env.CLIPPY_LLAMA_BACKEND?.toLowerCase() === "rocm") return false;

  if (process.platform !== "linux") return false;

  try {
    return fs.readdirSync("/sys/class/drm").some((entry) => {
      if (!/^card\d+$/.test(entry)) return false;
      const deviceId = fs
        .readFileSync(`/sys/class/drm/${entry}/device/device`, "utf8")
        .trim()
        .toLowerCase();
      // AMD Radeon 860M (gfx1152). Vulkan maps the full 16 GB GGUF into GTT
      // before startup and can make the desktop unresponsive while evicting.
      return deviceId === "0x1114";
    });
  } catch {
    return false;
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
  throw new Error("Timed out while loading the llama-server model");
}

let manager: LlamaServerManager | null = null;
export function getLlamaServerManager(): LlamaServerManager {
  if (!manager) manager = new LlamaServerManager();
  return manager;
}
