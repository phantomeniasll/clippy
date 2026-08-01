import { useState } from "react";

import { Message } from "./Message";
import { ChatInput } from "./ChatInput";
import { ANIMATION_KEYS_BRACKETS } from "../clippy-animation-helpers";
import { useChat } from "../contexts/ChatContext";
import { clippyApi, electronAi } from "../clippyApi";
import { useSharedState } from "../contexts/SharedStateContext";

export type ChatProps = {
  style?: React.CSSProperties;
};

export function Chat({ style }: ChatProps) {
  const {
    setAnimationKey,
    setStatus,
    status,
    messages,
    addMessage,
    setAnswerReady,
  } = useChat();
  const [streamingMessageContent, setStreamingMessageContent] =
    useState<string>("");
  const [streamingReasoningContent, setStreamingReasoningContent] =
    useState<string>("");
  const [lastRequestUUID, setLastRequestUUID] = useState<string>(
    crypto.randomUUID(),
  );
  const { settings, models } = useSharedState();
  const selectedModel = settings.selectedModel
    ? models[settings.selectedModel]
    : undefined;
  const useMtpBackend = Boolean(settings.useMtp && selectedModel?.mtpMode);

  const handleAbortMessage = () => {
    if (useMtpBackend) {
      void clippyApi.abortLlamaServerRequest(lastRequestUUID);
    } else {
      electronAi.abortRequest(lastRequestUUID);
    }
  };

  const handleSendMessage = async (message: string) => {
    if (status !== "idle") {
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      content: message,
      sender: "user",
      createdAt: Date.now(),
    };

    await addMessage(userMessage);
    setAnswerReady(false);
    setStreamingMessageContent("");
    setStreamingReasoningContent("");
    setStatus("thinking");

    try {
      const requestUUID = crypto.randomUUID();
      setLastRequestUUID(requestUUID);

      let fullContent = "";
      let filteredContent = "";
      let hasSetAnimationKey = false;
      let receivedStreamedContent = false;

      const consumeChunk = (chunk: string) => {
        if (fullContent === "") {
          setStatus("responding");
        }

        if (!hasSetAnimationKey) {
          const { text, animationKey } = filterMessageContent(
            fullContent + chunk,
          );

          filteredContent = text;
          fullContent = fullContent + chunk;

          if (animationKey) {
            setAnimationKey(animationKey);
            hasSetAnimationKey = true;
          }
        } else {
          filteredContent += chunk;
        }

        setStreamingMessageContent(filteredContent);
      };

      if (useMtpBackend) {
        const response = await clippyApi.llamaServerChat(
          {
            requestUUID,
            systemPrompt: (settings.systemPrompt || "").replace(
              "[LIST OF ANIMATIONS]",
              ANIMATION_KEYS_BRACKETS.join(", "),
            ),
            topK: settings.topK,
            temperature: settings.temperature,
            messages: [
              ...messages
                .filter((item) => item.content)
                .map((item) => ({
                  role:
                    item.sender === "clippy"
                      ? ("assistant" as const)
                      : ("user" as const),
                  content: item.content || "",
                })),
              { role: "user", content: message },
            ],
          },
          (chunk) => {
            if (chunk.reasoningContent) {
              setStreamingReasoningContent(
                (current) => current + chunk.reasoningContent,
              );
            }
            if (chunk.content) {
              receivedStreamedContent = true;
              consumeChunk(chunk.content);
            }
          },
        );

        if (!receivedStreamedContent && response.content) {
          consumeChunk(response.content);
        }

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          content: filteredContent,
          reasoningContent: response.reasoningContent,
          tokensPerSecond: response.tokensPerSecond,
          completionTokens: response.completionTokens,
          thinkingTokens: response.thinkingTokens,
          sender: "clippy",
          createdAt: Date.now(),
        };
        await addMessage(assistantMessage);
        setAnswerReady(true);
      } else {
        const response = await window.electronAi.promptStreaming(message, {
          requestUUID,
        });

        for await (const chunk of response) consumeChunk(chunk);

        await addMessage({
          id: crypto.randomUUID(),
          content: filteredContent,
          sender: "clippy",
          createdAt: Date.now(),
        });
        setAnswerReady(true);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setStreamingMessageContent("");
      setStreamingReasoningContent("");
      setStatus("idle");
    }
  };

  return (
    <div style={style} className="chat-container">
      {messages.map((message) => (
        <Message key={message.id} message={message} />
      ))}
      {(status === "responding" || streamingReasoningContent) && (
        <Message
          message={{
            id: "streaming",
            content: streamingMessageContent,
            reasoningContent: streamingReasoningContent,
            sender: "clippy",
            createdAt: Date.now(),
          }}
        />
      )}
      <ChatInput onSend={handleSendMessage} onAbort={handleAbortMessage} />
    </div>
  );
}

/**
 * Filter the message content to get the text and animation key
 *
 * @param content - The content of the message
 * @returns The text and animation key
 */
function filterMessageContent(content: string): {
  text: string;
  animationKey: string;
} {
  let text = content;
  let animationKey = "";

  if (content === "[") {
    text = "";
  } else if (/^\[[A-Za-z]*$/m.test(content)) {
    text = content.replace(/^\[[A-Za-z]*$/m, "").trim();
  } else {
    // Check for animation keys in brackets
    for (const key of ANIMATION_KEYS_BRACKETS) {
      if (content.startsWith(key)) {
        animationKey = key.slice(1, -1);
        text = content.slice(key.length).trim();
        break;
      }
    }
  }

  return { text, animationKey };
}
