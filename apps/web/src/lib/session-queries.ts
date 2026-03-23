/**
 * GraphQL queries and mutations for chat session management.
 */

export const SESSIONS_QUERY = `
  query Sessions {
    sessions {
      id
      threadId
      title
      createdAt
      lastMessageAt
      messageCount
    }
  }
`;

export const SESSION_DETAIL_QUERY = `
  query SessionDetail($id: ID!) {
    session(id: $id) {
      id
      threadId
      title
      createdAt
      lastMessageAt
      messages {
        id
        threadId
        role
        content
        timestamp
      }
    }
  }
`;

export const ACTIVE_SESSION_QUERY = `
  query ActiveSession {
    activeSession {
      id
      threadId
      title
      createdAt
      lastMessageAt
      messageCount
    }
  }
`;

export const CREATE_SESSION_MUTATION = `
  mutation CreateSession {
    createSession {
      id
      threadId
      title
      createdAt
      lastMessageAt
      messageCount
    }
  }
`;

export const DELETE_SESSION_MUTATION = `
  mutation DeleteSession($id: ID!) {
    deleteSession(id: $id)
  }
`;
