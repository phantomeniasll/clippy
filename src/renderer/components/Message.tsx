import Markdown from "react-markdown";
import questionIcon from "../images/icons/question.png";
import defaultClippy from "../images/animations/Default.png";
import { MessageRecord } from "../../types/interfaces";

export interface Message extends MessageRecord {
  id: string;
  content?: string;
  children?: React.ReactNode;
  createdAt: number;
  sender: "user" | "clippy";
}

export function Message({ message }: { message: Message }) {
  const hasGenerationStats =
    message.tokensPerSecond !== undefined ||
    message.completionTokens !== undefined ||
    message.thinkingTokens !== undefined;

  return (
    <div
      className="message"
      style={{ display: "flex", alignItems: "flex-start" }}
    >
      <img
        src={message.sender === "user" ? questionIcon : defaultClippy}
        alt={`${message.sender === "user" ? "You" : "Clippy"}`}
        style={{ width: "24px", height: "24px", marginRight: "8px" }}
      />
      <div className="message-content">
        {message.reasoningContent && (
          <ul className="tree-view thinking-tree">
            <li>
              <details
                className="thinking-view"
                open={message.id === "streaming"}
              >
                <summary>
                  Thinking
                  {message.thinkingTokens !== undefined
                    ? ` · ${message.thinkingTokens} tokens`
                    : "…"}
                </summary>
                <div className="thinking-content">
                  <Markdown>{message.reasoningContent}</Markdown>
                </div>
              </details>
            </li>
          </ul>
        )}
        {message.children ? (
          message.children
        ) : (
          <Markdown
            components={{
              a: ({ node, ...props }) => (
                <a target="_blank" rel="noopener noreferrer" {...props} />
              ),
            }}
          >
            {message.content}
          </Markdown>
        )}
        {hasGenerationStats && (
          <div className="generation-stats" aria-label="Generation statistics">
            {message.tokensPerSecond !== undefined && (
              <span>{message.tokensPerSecond.toFixed(1)} tok/s</span>
            )}
            {message.completionTokens !== undefined && (
              <span>{message.completionTokens} generated</span>
            )}
            {message.thinkingTokens !== undefined && (
              <span>{message.thinkingTokens} thinking</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
