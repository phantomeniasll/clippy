import path from "path";

import { HuggingFaceModelFile } from "../models";

type HuggingFaceSibling = {
  rfilename?: string;
  size?: number;
  lfs?: { size?: number };
};

type HuggingFaceModelResponse = {
  id?: string;
  siblings?: HuggingFaceSibling[];
  error?: string;
};

type ParsedSource = {
  repoId: string;
  requestedQuant?: string;
  directFile?: {
    filename: string;
    url: string;
  };
};

const HUGGING_FACE_HOSTS = new Set([
  "huggingface.co",
  "www.huggingface.co",
  "hf.co",
]);

export async function resolveHuggingFaceSource(
  source: string,
): Promise<HuggingFaceModelFile[]> {
  const parsed = parseHuggingFaceSource(source);

  if (parsed.directFile) {
    return [
      {
        repoId: parsed.repoId,
        filename: parsed.directFile.filename,
        size: await getRemoteFileSize(parsed.directFile.url),
        url: parsed.directFile.url,
      },
    ];
  }

  const response = await fetch(
    `https://huggingface.co/api/models/${encodeRepoId(parsed.repoId)}?blobs=true`,
  );
  const body = (await response
    .json()
    .catch(() => ({}))) as HuggingFaceModelResponse;

  if (!response.ok) {
    throw new Error(
      body.error ||
        `Hugging Face returned HTTP ${response.status} for ${parsed.repoId}`,
    );
  }

  const files = (body.siblings || [])
    .flatMap((sibling): HuggingFaceModelFile[] => {
      const filename = sibling.rfilename;
      if (!filename || !isRunnableGguf(filename)) return [];

      return [
        {
          repoId: body.id || parsed.repoId,
          filename,
          size: bytesToMegabytes(sibling.lfs?.size ?? sibling.size ?? 0),
          url: createResolveUrl(body.id || parsed.repoId, filename),
        },
      ];
    })
    .filter(
      (file) =>
        !parsed.requestedQuant ||
        normalizeQuant(file.filename).includes(
          normalizeQuant(parsed.requestedQuant),
        ),
    )
    .sort((left, right) => {
      if (!left.size) return 1;
      if (!right.size) return -1;
      return left.size - right.size;
    });

  if (files.length === 0) {
    const suffix = parsed.requestedQuant
      ? ` matching "${parsed.requestedQuant}"`
      : "";
    throw new Error(
      `No runnable, single-file GGUF models${suffix} were found.`,
    );
  }

  return files;
}

export function validateHuggingFaceModelFile(
  file: HuggingFaceModelFile,
): HuggingFaceModelFile {
  const parsed = parseHuggingFaceSource(file.url);
  if (!parsed.directFile || !isRunnableGguf(parsed.directFile.filename)) {
    throw new Error("Select a valid Hugging Face GGUF file");
  }

  if (parsed.repoId.toLowerCase() !== file.repoId.toLowerCase()) {
    throw new Error(
      "The selected file does not belong to the specified repository",
    );
  }

  return {
    repoId: parsed.repoId,
    filename: parsed.directFile.filename,
    size: Math.max(0, Math.round(file.size)),
    url: parsed.directFile.url,
  };
}

export function getHuggingFaceStorageFileName(
  repoId: string,
  filename: string,
): string {
  const repoPrefix = repoId.replace(/[^a-z0-9._-]+/gi, "--");
  return `${repoPrefix}--${path.basename(filename)}`;
}

function parseHuggingFaceSource(source: string): ParsedSource {
  let input = source.trim();
  if (!input) throw new Error("Enter a Hugging Face repository or GGUF URL");

  if (
    !/^https?:\/\//i.test(input) &&
    /^(?:www\.)?(?:huggingface\.co|hf\.co)\//i.test(input)
  ) {
    input = `https://${input}`;
  }

  if (/^https?:\/\//i.test(input)) {
    const url = new URL(input);
    if (!HUGGING_FACE_HOSTS.has(url.hostname.toLowerCase())) {
      throw new Error("Only huggingface.co model links are supported");
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      throw new Error("The Hugging Face link is missing owner/repository");
    }

    const repoId = `${parts[0]}/${parts[1]}`;
    if ((parts[2] === "blob" || parts[2] === "resolve") && parts.length >= 5) {
      const filename = decodeURIComponent(parts.slice(4).join("/"));
      if (!filename.toLowerCase().endsWith(".gguf")) {
        throw new Error("The Hugging Face file must be a GGUF model");
      }

      return {
        repoId,
        directFile: {
          filename,
          url: createResolveUrl(repoId, filename, parts[3]),
        },
      };
    }

    return { repoId };
  }

  const match = input.match(/^([^/\s:]+)\/([^/\s:]+)(?::(.+))?$/);
  if (!match) {
    throw new Error(
      "Use owner/repository, owner/repository:quant, or a Hugging Face URL",
    );
  }

  return {
    repoId: `${match[1]}/${match[2]}`,
    requestedQuant: match[3],
  };
}

function isRunnableGguf(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.endsWith(".gguf") &&
    !lower.includes("mmproj") &&
    !lower.includes("imatrix") &&
    !lower.includes("/mtp/") &&
    !/-\d{5}-of-\d{5}\.gguf$/i.test(filename)
  );
}

function createResolveUrl(
  repoId: string,
  filename: string,
  revision = "main",
): string {
  const encodedFilename = filename
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://huggingface.co/${encodeRepoId(repoId)}/resolve/${encodeURIComponent(revision)}/${encodedFilename}`;
}

function encodeRepoId(repoId: string): string {
  return repoId
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function normalizeQuant(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function getRemoteFileSize(url: string): Promise<number> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) return 0;
    return bytesToMegabytes(
      Number(response.headers.get("content-length")) || 0,
    );
  } catch {
    return 0;
  }
}

function bytesToMegabytes(bytes: number): number {
  return bytes > 0 ? Math.round(bytes / (1024 * 1024)) : 0;
}
