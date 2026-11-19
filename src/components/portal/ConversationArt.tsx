export function ConversationArt({ seed = 0, small = false }: { seed?: number; small?: boolean }) {
  return <img className={"sk-art sk-conversation-art" + (small ? " sk-art-small" : "")} src="/brand/teachers/conversation.png" width="360" height="360" alt="" style={{ animationDelay: `${seed % 5 * -.8}s` }} />;
}
