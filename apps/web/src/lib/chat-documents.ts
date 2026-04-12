export const SEND_MESSAGE_MUTATION = `
  mutation SendMessage($threadId: String!, $message: String!, $imageBase64: String, $imageMediaType: String) {
    sendMessage(threadId: $threadId, message: $message, imageBase64: $imageBase64, imageMediaType: $imageMediaType) {
      threadId
      messageId
    }
  }
`;

export const CHAT_SUBSCRIPTION = `
  subscription OnChatMessage($threadId: String!) {
    onChatMessage(threadId: $threadId) {
      type
      threadId
      delta
      accumulatedText
      messageId
      content
      error
      toolName
      piiTypesFound
      toolCard {
        tool
        params
      }
    }
  }
`;
