import type { DownloadState } from "./sharedState";

export interface Model {
  name: string;
  size: number;
  company?: string;
  url?: string;
  description?: string;
  homepage?: string;
  draftUrl?: string;
  mtpMode?: "embedded" | "draft";
  mtpDraftTokens?: number;
}

export interface ManagedModel extends Model {
  path: string;
  draftPath?: string;
  downloaded?: boolean;
  downloadState?: DownloadState;
  imported?: boolean;
}

export type ModelState = Record<string, ManagedModel>;

export const BUILT_IN_MODELS: Model[] = [
  {
    name: "Gemma 4 (26B A4B, Q4)",
    company: "Google",
    size: 16900,
    url: "https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/resolve/main/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf",
    draftUrl:
      "https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/resolve/main/MTP/mtp-gemma-4-26B-A4B-it-Q8_0.gguf",
    mtpMode: "draft",
    mtpDraftTokens: 4,
    description:
      "Gemma 4's efficient 26B mixture-of-experts instruction model, with about 4B parameters active per token. One click downloads the Unsloth Q4_K_M target and its recommended Q8 MTP drafter.",
    homepage: "https://ai.google.dev/gemma/docs/core",
  },
  {
    name: "Qwen3.6 (35B A3B, Q4 MTP)",
    company: "Qwen",
    size: 22700,
    url: "https://huggingface.co/unsloth/Qwen3.6-35B-A3B-MTP-GGUF/resolve/main/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
    mtpMode: "embedded",
    mtpDraftTokens: 2,
    description:
      "Qwen3.6's 35B mixture-of-experts model with about 3B parameters active per token. This balanced Unsloth Q4 quant includes its MTP head.",
    homepage: "https://huggingface.co/Qwen/Qwen3.6-35B-A3B",
  },
  {
    name: "Qwen3.6 (35B A3B, IQ2 MTP)",
    company: "Qwen",
    size: 11900,
    url: "https://huggingface.co/unsloth/Qwen3.6-35B-A3B-MTP-GGUF/resolve/main/Qwen3.6-35B-A3B-UD-IQ2_M.gguf",
    mtpMode: "embedded",
    mtpDraftTokens: 2,
    description:
      "The smaller Unsloth IQ2_M quant of Qwen3.6 35B-A3B. It is roughly half the Q4 download size and includes the same MTP head, trading some quality for a much lower memory requirement.",
    homepage: "https://huggingface.co/Qwen/Qwen3.6-35B-A3B",
  },
  {
    name: "Gemma 3 (1B)",
    company: "Google",
    size: 806,
    url: "https://huggingface.co/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf",
    description:
      "Gemma 3, Google's new state-of-the-art models come in 1B, 4B, 12B, and 27B sizes. Gemma 3 has a 128K context window, and multilingual support.",
  },
  {
    name: "Gemma 3 (4B)",
    company: "Google",
    size: 2490,
    url: "https://huggingface.co/unsloth/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q3_K_M.gguf",
    description:
      "Gemma 3, Google's new state-of-the-art models come in 1B, 4B, 12B, and 27B sizes. Gemma 3 has a 128K context window, and multilingual support.",
  },
  {
    name: "Gemma 3 (12B)",
    company: "Google",
    size: 5600,
    url: "https://huggingface.co/unsloth/gemma-3-12b-it-GGUF/resolve/main/gemma-3-12b-it-Q3_K_M.gguf",
    description:
      "Gemma 3,Google's new state-of-the-art models come in 1B,4B,12B,and 27B sizes. Gemma 3 has a 128K context window,and multilingual support.",
  },
  {
    name: "Gemma 3 (27B)",
    company: "Google",
    size: 12500,
    url: "https://huggingface.co/unsloth/gemma-3-27b-it-GGUF/resolve/main/gemma-3-27b-it-Q3_K_M.gguf",
    description:
      "Gemma 3,Google's new state-of-the-art models come in 1B,4B,12B,and 27B sizes. Gemma 3 has a 128K context window, and multilingual support.",
  },
  {
    name: "Phi-4 Mini (3.8B)",
    company: "Microsoft",
    size: 2490,
    url: "https://huggingface.co/unsloth/Phi-4-mini-instruct-GGUF/resolve/main/Phi-4-mini-instruct-Q4_K_M.gguf",
    description:
      "Phi-4-mini is a 3.8B parameter model and a dense, decoder-only transformer featuring grouped-query attention, 200,000 vocabulary, and shared input-output embeddings, designed for speed and efficiency. Despite its compact size, it continues outperforming larger models in text-based tasks, including reasoning, math, coding, instruction-following, and function-calling. Supporting sequences up to 128,000 tokens, it delivers high accuracy and scalability, making it a powerful solution for advanced AI applications.",
    homepage:
      "https://azure.microsoft.com/en-us/blog/empowering-innovation-the-next-generation-of-the-phi-family/",
  },
  {
    name: "Qwen3 (4B)",
    company: "Qwen",
    size: 2500,
    url: "https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
    description:
      "Qwen3 is the latest generation of large language models in Qwen series, offering a comprehensive suite of dense and mixture-of-experts (MoE) models. Built upon extensive training, Qwen3 delivers groundbreaking advancements in reasoning, instruction-following, agent capabilities, and multilingual support, with the following key features",
    homepage: "https://qwenlm.github.io/blog/qwen3/",
  },
  {
    name: "Llama 3.2 (1B Instruct)",
    company: "Meta",
    size: 808,
    url: "https://huggingface.co/unsloth/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
    description:
      "The Llama 3.2 collection of multilingual large language models (LLMs) is a collection of pretrained and instruction-tuned generative models in 1B and 3B sizes (text in/text out). The Llama 3.2 instruction-tuned text only models are optimized for multilingual dialogue use cases, including agentic retrieval and summarization tasks. They outperform many of the available open source and closed chat models on common industry benchmarks.",
    homepage:
      "https://ai.meta.com/blog/llama-3-2-connect-2024-vision-edge-mobile-devices/",
  },
  {
    name: "Llama 3.2 (3B Instruct)",
    company: "Meta",
    size: 2020,
    url: "https://huggingface.co/unsloth/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    description:
      "The Llama 3.2 collection of multilingual large language models (LLMs) is a collection of pretrained and instruction-tuned generative models in 1B and 3B sizes (text in/text out). The Llama 3.2 instruction-tuned text only models are optimized for multilingual dialogue use cases, including agentic retrieval and summarization tasks. They outperform many of the available open source and closed chat models on common industry benchmarks.",
    homepage:
      "https://ai.meta.com/blog/llama-3-2-connect-2024-vision-edge-mobile-devices/",
  },
  {
    name: "Llama 3.2 (3B Instruct)",
    company: "Meta",
    size: 2020,
    url: "https://huggingface.co/unsloth/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    description:
      "The Llama 3.2 collection of multilingual large language models (LLMs) is a collection of pretrained and instruction-tuned generative models in 1B and 3B sizes (text in/text out). The Llama 3.2 instruction-tuned text only models are optimized for multilingual dialogue use cases, including agentic retrieval and summarization tasks. They outperform many of the available open source and closed chat models on common industry benchmarks.",
    homepage:
      "https://ai.meta.com/blog/llama-3-2-connect-2024-vision-edge-mobile-devices/",
  },
];
