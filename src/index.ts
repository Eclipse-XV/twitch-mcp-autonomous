import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Client } from "tmi.js";
import { AutonomousMonitor } from "./autonomous-monitor.js";
import { AutonomousConfig, ChatMessage as AutonomousMessage, AIAnalysisFunction } from "./autonomous-types.js";
import path from "path";

// Configuration schema for Twitch API credentials
export const configSchema = z.object({
  debug: z.boolean().default(false).describe("Enable debug logging"),
  twitchClientId: z.string().describe("Twitch Client ID for API access"),
  twitchAuthToken: z.string().describe("Twitch OAuth token (without 'oauth:' prefix)"),
  twitchBroadcasterId: z.string().describe("Twitch broadcaster user ID"),
  twitchChannel: z.string().describe("Twitch channel name for chat monitoring"),
  autonomous: z.object({
    enabled: z.boolean().default(false).describe("Enable autonomous monitoring at startup"),
    monitoringInterval: z.number().int().default(5000).describe("Monitoring interval in milliseconds"),
    rules: z.object({
      spamDetection: z.object({
        enabled: z.boolean().default(true),
        threshold: z.number().default(5),
        action: z.enum(['timeout', 'ban', 'warn']).default('timeout'),
        duration: z.number().default(300).optional()
      }),
      toxicityDetection: z.object({
        enabled: z.boolean().default(true),
        severityThreshold: z.number().default(6),
        action: z.enum(['timeout', 'ban', 'warn']).default('timeout'),
        duration: z.number().default(1800).optional()
      }),
      chatEngagement: z.object({
        enabled: z.boolean().default(false),
        quietPeriodThreshold: z.number().default(10),
        responses: z.array(z.string()).default(['Hey chat! How is everyone doing?', 'Any questions about the game?'])
      }),
      pollAutomation: z.object({
        enabled: z.boolean().default(false),
        trigger: z.enum(['viewerRequest', 'scheduled', 'gameEvent']).default('viewerRequest'),
        cooldown: z.number().default(15)
      })
    })
  }).default({}),
  feedbackDir: z.string().default(path.join(process.cwd(), 'autonomous_feedback')).describe("Directory for autonomous feedback storage"),
  maxFeedbackRetentionDays: z.number().int().default(30).describe("Days to retain feedback data")
});

// Types for API responses and data structures
interface ChatMessage {
  username: string;
  content: string;
  timestamp: Date;
}

interface TwitchApiError {
  error: string;
  status: number;
  message: string;
}

// Descriptor keywords for moderation targeting
const DESCRIPTOR_KEYWORDS = {
  toxic: ["idiot", "stupid", "hate", "kill", "dumb", "trash", "noob", "loser", "shut up", "annoying", "toxic", "rude", "mean", "sucks", "bad", "worst", "report", "ban"],
  spam: ["buy followers", "free", "promo", "visit", "http", "www", "spam", "emote", "caps", "repeated"],
  rude: ["shut up", "idiot", "stupid", "dumb", "annoying", "rude", "mean", "trash", "loser", "bad", "worst"]
};

// Common words to filter out from chat analysis
const COMMON_WORDS = new Set([
  "the", "and", "that", "have", "for", "not", "with", "you", "this", "but",
  "his", "from", "they", "say", "her", "she", "will", "one", "all", "would",
  "there", "their", "what", "so", "up", "out", "if", "about", "who", "get",
  "which", "go", "me", "when", "make", "can", "like", "time", "no", "just",
  "him", "know", "take", "people", "into", "year", "your", "good", "some",
  "could", "them", "see", "other", "than", "then", "now", "look", "only",
  "come", "its", "over", "think", "also", "back", "after", "use", "two",
  "how", "our", "work", "first", "well", "way", "even", "new", "want",
  "because", "any", "these", "give", "day", "most", "us"
]);

export default function createStatelessServer({
  config,
}: {
  config: z.infer<typeof configSchema>;
}) {
  const server = new McpServer({
    name: "Twitch MCP Server",
    version: "1.0.0",
  });

  // In-memory chat message storage (in production, you might want to use a database)
  let recentMessages: ChatMessage[] = [];
  const MAX_MESSAGES = 100;

  // Autonomous monitoring instance
  let autoMonitor: AutonomousMonitor | null = null;

  // Utility function to safely stringify JSON for tool responses
  function safeJsonStringify(obj: any, maxLength = 8000): string {
    try {
      const json = JSON.stringify(obj, null, 2);
      if (json.length > maxLength) {
        return json.substring(0, maxLength) + '\n\n[Output truncated due to length]';
      }
      return json;
    } catch (error) {
      return `[JSON stringify error: ${error.message}]`;
    }
  }

  // Heuristic AI analysis function for autonomous monitoring
  const aiAnalyzeFunction: AIAnalysisFunction = async (prompt: string): Promise<string> => {
    // For now, return a basic heuristic analysis
    // In the future, this could be replaced with actual LLM API calls
    
    if (config.debug) {
      console.log('AI Analysis prompt:', prompt.substring(0, 200) + '...');
    }
    
    // Extract analysis type from prompt
    const lowerPrompt = prompt.toLowerCase();
    
    if (lowerPrompt.includes('toxicity')) {
      return JSON.stringify([]);
    } else if (lowerPrompt.includes('spam')) {
      return JSON.stringify([]);
    } else if (lowerPrompt.includes('engagement')) {
      return JSON.stringify([]);
    } else if (lowerPrompt.includes('sentiment')) {
      return JSON.stringify({
        overallSentiment: 0,
        reasoning: 'Basic heuristic analysis - LLM integration needed',
        keyIndicators: ['neutral chat']
      });
    } else if (lowerPrompt.includes('activity')) {
      return JSON.stringify({
        activityLevel: 5,
        description: 'Moderate activity detected',
        recommendations: ['Monitor chat for engagement opportunities']
      });
    }
    
    return JSON.stringify({ error: 'Unknown analysis type' });
  };

  // MCP tool executor for autonomous actions
  const mcpExecutor = async (toolName: string, parameters: Record<string, any>): Promise<{ success: boolean; result: any; error?: string }> => {
    try {
      if (config.debug) {
        console.log(`Autonomous executor: ${toolName}`, parameters);
      }

      switch (toolName) {
        case 'sendMessageToChat': {
          const connected = await ensureIrcConnection();
          if (!connected) {
            return { success: false, result: null, error: 'IRC connection not available' };
          }
          await tmiClient.say(`#${config.twitchChannel}`, parameters.message);
          addChatMessage(config.twitchChannel, `[BOT] ${parameters.message}`);
          return { success: true, result: { message: parameters.message } };
        }

        case 'timeoutUser': {
          const targetUser = resolveModerationTarget(parameters.usernameOrDescriptor);
          if (!targetUser) {
            return { success: false, result: null, error: 'Could not resolve target user' };
          }
          const userId = await getUserIdFromUsername(targetUser);
          if (!userId) {
            return { success: false, result: null, error: `Could not resolve user ID for ${targetUser}` };
          }
          const duration = parameters.duration || guessTimeoutDuration(parameters.reason || '');
          await makeTwitchApiCall('/moderation/bans', 'POST', {
            broadcaster_id: config.twitchBroadcasterId,
            moderator_id: config.twitchBroadcasterId,
            data: {
              user_id: userId,
              reason: parameters.reason || 'Autonomous moderation',
              duration
            }
          });
          return { success: true, result: { user: targetUser, duration, reason: parameters.reason } };
        }

        case 'banUser': {
          const targetUser = resolveModerationTarget(parameters.usernameOrDescriptor);
          if (!targetUser) {
            return { success: false, result: null, error: 'Could not resolve target user' };
          }
          const userId = await getUserIdFromUsername(targetUser);
          if (!userId) {
            return { success: false, result: null, error: `Could not resolve user ID for ${targetUser}` };
          }
          await makeTwitchApiCall('/moderation/bans', 'POST', {
            broadcaster_id: config.twitchBroadcasterId,
            moderator_id: config.twitchBroadcasterId,
            data: {
              user_id: userId,
              reason: parameters.reason || 'Autonomous moderation'
            }
          });
          return { success: true, result: { user: targetUser, reason: parameters.reason } };
        }

        case 'createTwitchPoll': {
          const choicesArray = parameters.choices.split(',').map((c: string) => ({ title: c.trim() }));
          const response = await makeTwitchApiCall('/polls', 'POST', {
            broadcaster_id: config.twitchBroadcasterId,
            title: parameters.title,
            choices: choicesArray,
            duration: parameters.duration
          });
          return { success: true, result: response };
        }

        case 'createTwitchPrediction': {
          const outcomesArray = parameters.outcomes.split(',').map((o: string) => ({ title: o.trim() }));
          const response = await makeTwitchApiCall('/predictions', 'POST', {
            broadcaster_id: config.twitchBroadcasterId,
            title: parameters.title,
            outcomes: outcomesArray,
            prediction_window: parameters.duration
          });
          return { success: true, result: response };
        }

        case 'createTwitchClip': {
          const response = await makeTwitchApiCall(`/clips?broadcaster_id=${config.twitchBroadcasterId}`, 'POST');
          return { success: true, result: response };
        }

        case 'updateStreamTitle': {
          await makeTwitchApiCall('/channels', 'PATCH', {
            broadcaster_id: config.twitchBroadcasterId,
            title: parameters.title
          });
          return { success: true, result: { title: parameters.title } };
        }

        case 'updateStreamCategory': {
          const searchResponse = await makeTwitchApiCall(`/search/categories?query=${encodeURIComponent(parameters.category)}`);
          if (!searchResponse.data || searchResponse.data.length === 0) {
            return { success: false, result: null, error: `Could not find category: ${parameters.category}` };
          }
          const categoryId = searchResponse.data[0].id;
          await makeTwitchApiCall('/channels', 'PATCH', {
            broadcaster_id: config.twitchBroadcasterId,
            game_id: categoryId
          });
          return { success: true, result: { category: parameters.category, categoryId } };
        }

        default:
          return { success: false, result: null, error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      const err = error as TwitchApiError;
      return { success: false, result: null, error: err.message || error.message || 'Unknown error' };
    }
  };

  // Initialize Twitch IRC client
  const tmiClient = new Client({
    options: { debug: config.debug },
    connection: {
      secure: true,
      reconnect: true,
    },
    identity: {
      username: config.twitchChannel,
      password: `oauth:${config.twitchAuthToken}`
    },
    channels: [`#${config.twitchChannel}`]
  });

  // Connect to Twitch IRC
  let ircConnected = false;
  tmiClient.connect().then(() => {
    ircConnected = true;
    if (config.debug) {
      console.log('Connected to Twitch IRC');
    }
    
    // Initialize AutonomousMonitor after IRC connection
    try {
      autoMonitor = new AutonomousMonitor(
        {
          autonomous: config.autonomous as AutonomousConfig,
          feedbackDir: config.feedbackDir,
          maxFeedbackRetentionDays: config.maxFeedbackRetentionDays
        },
        aiAnalyzeFunction,
        mcpExecutor
      );
      
      if (config.autonomous.enabled) {
        autoMonitor.start();
        console.log(`Autonomous monitoring started with ${config.autonomous.monitoringInterval}ms interval`);
      }
      
      if (config.debug) {
        console.log('AutonomousMonitor initialized successfully');
      }
    } catch (error) {
      console.error('Failed to initialize AutonomousMonitor:', error);
    }
  }).catch((error) => {
    console.error('Failed to connect to Twitch IRC:', error);
  });

  // Listen for incoming chat messages and add them to our log
  tmiClient.on('message', (channel, tags, message, self) => {
    if (!self) { // Don't log our own messages
      const username = tags.username || tags['display-name'] || 'unknown';
      const content = message;
      
      // Add to regular message log
      addChatMessage(username, content);
      
      // Forward to autonomous monitor if available
      if (autoMonitor) {
        const autonomousMessage: AutonomousMessage = {
          username,
          content,
          timestamp: new Date()
        };
        autoMonitor.addChatMessages([autonomousMessage]);
      }
    }
  });

  // Function to ensure IRC connection is ready
  async function ensureIrcConnection(): Promise<boolean> {
    if (ircConnected) {
      return true;
    }
    
    try {
      await tmiClient.connect();
      ircConnected = true;
      return true;
    } catch (error) {
      console.error('Failed to establish IRC connection:', error);
      return false;
    }
  }

  // Utility function to make Twitch API calls
  async function makeTwitchApiCall(
    endpoint: string, 
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET', 
    body?: any
  ): Promise<any> {
    const url = `https://api.twitch.tv/helix${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${config.twitchAuthToken}`,
      'Client-Id': config.twitchClientId,
      'Content-Type': 'application/json'
    };

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw {
          error: 'API_ERROR',
          status: response.status,
          message: errorText || `HTTP ${response.status}`
        } as TwitchApiError;
      }

      if (response.status === 204) {
        return { success: true }; // No content response
      }

      return await response.json();
    } catch (error) {
      if (error.error) {
        throw error; // Re-throw our formatted error
      }
      throw {
        error: 'NETWORK_ERROR', 
        status: 0, 
        message: error.message || 'Network request failed'
      } as TwitchApiError;
    }
  }

  // Get user ID from username
  async function getUserIdFromUsername(username: string): Promise<string | null> {
    try {
      const response = await makeTwitchApiCall(`/users?login=${encodeURIComponent(username)}`);
      return response.data?.[0]?.id || null;
    } catch {
      return null;
    }
  }

  // Add a simulated chat message (in production, this would be from IRC/WebSocket)
  function addChatMessage(username: string, content: string) {
    const message: ChatMessage = {
      username,
      content,
      timestamp: new Date()
    };
    
    recentMessages.push(message);
    if (recentMessages.length > MAX_MESSAGES) {
      recentMessages.shift();
    }
  }

  // Analyze recent chat messages
  function analyzeChat(): string {
    if (recentMessages.length === 0) {
      return "No recent chat messages to analyze.";
    }

    const wordFrequency = new Map<string, number>();
    let totalWords = 0;

    for (const message of recentMessages) {
      const words = message.content.toLowerCase().split(/\s+/);
      totalWords += words.length;
      
      for (const word of words) {
        if (word.length > 3 && !COMMON_WORDS.has(word)) {
          wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
        }
      }
    }

    const topWords = Array.from(wordFrequency.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([word, count]) => `${word} (${count} mentions)`);

    const avgWordsPerMessage = (totalWords / recentMessages.length).toFixed(1);
    
    return `Chat Analysis:\n- Total messages: ${recentMessages.length}\n- Average words per message: ${avgWordsPerMessage}\n- Top topics: ${topWords.length > 0 ? topWords.join(', ') : 'No significant topics detected'}`;
  }

  // Find user by descriptor (toxic, spam, etc.) or partial name
  function findUserByDescriptor(descriptor: string): string | null {
    const keywords = DESCRIPTOR_KEYWORDS[descriptor.toLowerCase() as keyof typeof DESCRIPTOR_KEYWORDS] || [descriptor];
    const userScores = new Map<string, number>();

    for (const message of recentMessages) {
      const content = message.content.toLowerCase();
      for (const keyword of keywords) {
        if (content.includes(keyword)) {
          userScores.set(message.username, (userScores.get(message.username) || 0) + 1);
        }
      }
    }

    if (userScores.size === 0) return null;
    
    return Array.from(userScores.entries())
      .sort(([,a], [,b]) => b - a)[0][0];
  }

  // Resolve moderation target
  function resolveModerationTarget(input: string): string | null {
    if (!input?.trim()) return null;
    
    const lowered = input.toLowerCase();
    // Check for explicit username patterns
    if (lowered.includes("user named") || /^[a-zA-Z0-9_]{3,25}$/.test(input.trim())) {
      const username = input.replace(/.*user named\s+/, "").trim();
      // Try to find in recent messages
      const found = recentMessages.find(m => m.username.toLowerCase().includes(username.toLowerCase()));
      return found?.username || username;
    }
    
    return null; // Let LLM review chat log
  }

  // Guess timeout duration based on reason
  function guessTimeoutDuration(reason: string): number {
    const lowerReason = reason.toLowerCase();
    if (lowerReason.includes("spam") || lowerReason.includes("caps") || lowerReason.includes("emote")) {
      return 300; // 5 minutes
    } else if (lowerReason.includes("toxic") || lowerReason.includes("rude") || lowerReason.includes("mean")) {
      return 1800; // 30 minutes
    } else if (lowerReason.includes("severe") || lowerReason.includes("serious")) {
      return 3600; // 1 hour
    }
    return 600; // Default 10 minutes
  }

  // Get recent chat log as formatted strings
  function getRecentChatLog(n: number = 20): string[] {
    const messages = recentMessages.slice(-n);
    return messages.map(m => `${m.username}: ${m.content}`);
  }

  // Tool: Send message to Twitch chat
  server.tool(
    "sendMessageToChat",
    "Send message to the Twitch Chat",
    {
      message: z.string().describe("The message to send to chat")
    },
    async ({ message }) => {
      try {
        // Ensure IRC connection is ready
        const connected = await ensureIrcConnection();
        if (!connected) {
          return {
            content: [{ type: "text", text: `Failed to send message: IRC connection not available` }]
          };
        }

        // Send the message to Twitch chat via IRC
        await tmiClient.say(`#${config.twitchChannel}`, message);
        
        // Add to our local message log for analysis
        addChatMessage(config.twitchChannel, `[BOT] ${message}`);
        
        return {
          content: [{ type: "text", text: `Successfully sent message to Twitch chat: ${message}` }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: "text", text: `Failed to send message: ${errorMessage}` }]
        };
      }
    }
  );

  // Tool: Create Twitch Poll
  server.tool(
    "createTwitchPoll",
    "Create a Twitch Poll",
    {
      title: z.string().describe("Poll title"),
      choices: z.string().describe("Comma-separated choices"),
      duration: z.number().int().describe("Duration in seconds")
    },
    async ({ title, choices, duration }) => {
      try {
        const choicesArray = choices.split(',').map(c => ({ title: c.trim() }));
        
        const response = await makeTwitchApiCall('/polls', 'POST', {
          broadcaster_id: config.twitchBroadcasterId,
          title,
          choices: choicesArray,
          duration
        });

        return {
          content: [{ type: "text", text: "Poll created successfully!" }]
        };
      } catch (error) {
        const err = error as TwitchApiError;
        return {
          content: [{ type: "text", text: `Error creating poll: ${err.message}` }]
        };
      }
    }
  );

  // Tool: Create Twitch Prediction
  server.tool(
    "createTwitchPrediction",
    "Create a Twitch Prediction",
    {
      title: z.string().describe("Prediction title"),
      outcomes: z.string().describe("Comma-separated outcomes"),
      duration: z.number().int().describe("Duration in seconds")
    },
    async ({ title, outcomes, duration }) => {
      try {
        const outcomesArray = outcomes.split(',').map(o => ({ title: o.trim() }));
        
        const response = await makeTwitchApiCall('/predictions', 'POST', {
          broadcaster_id: config.twitchBroadcasterId,
          title,
          outcomes: outcomesArray,
          prediction_window: duration
        });

        return {
          content: [{ type: "text", text: "Prediction created successfully!" }]
        };
      } catch (error) {
        const err = error as TwitchApiError;
        return {
          content: [{ type: "text", text: `Error creating prediction: ${err.message}` }]
        };
      }
    }
  );

  // Tool: Create Twitch Clip
  server.tool(
    "createTwitchClip",
    "Create a Twitch clip of the current stream",
    {},
    async () => {
      try {
        const response = await makeTwitchApiCall(`/clips?broadcaster_id=${config.twitchBroadcasterId}`, 'POST');
        
        const editUrl = response.data?.[0]?.edit_url;
        const clipUrl = editUrl ? `Clip created successfully! You can view it at: ${editUrl}` : "Clip created successfully!";
        
        return {
          content: [{ type: "text", text: clipUrl }]
        };
      } catch (error) {
        const err = error as TwitchApiError;
        return {
          content: [{ type: "text", text: `Error creating clip: ${err.message}` }]
        };
      }
    }
  );

  // Tool: Analyze Chat
  server.tool(
    "analyzeChat",
    "Analyze recent Twitch chat messages and provide a summary of topics and activity",
    {},
    async () => {
      const analysis = analyzeChat();
      return {
        content: [{ type: "text", text: analysis }]
      };
    }
  );

  // Tool: Get Recent Chat Log
  server.tool(
    "getRecentChatLog",
    "Get the last 20 chat messages for moderation context",
    {},
    async () => {
      const log = getRecentChatLog(20);
      if (log.length === 0) {
        return {
          content: [{ type: "text", text: "No recent chat messages available." }]
        };
      }
      return {
        content: [{ type: "text", text: log.join('\n') }]
      };
    }
  );

  // Tool: Timeout User
  server.tool(
    "timeoutUser",
    "Timeout a user in the Twitch chat. If no username is provided, it will return the recent chat log for LLM review.",
    {
      usernameOrDescriptor: z.string().describe("Username or descriptor to timeout (e.g. 'toxic', 'spammer', or a username)"),
      reason: z.string().optional().describe("Reason for timeout (optional)")
    },
    async ({ usernameOrDescriptor, reason }) => {
      try {
        const targetUser = resolveModerationTarget(usernameOrDescriptor);
        
        if (!targetUser) {
          const log = getRecentChatLog(20);
          return {
            content: [{ type: "text", text: `No explicit username provided. Here are the last 20 chat messages:\n${log.join('\n')}` }]
          };
        }

        const userId = await getUserIdFromUsername(targetUser);
        if (!userId) {
          return {
            content: [{ type: "text", text: `Could not resolve user ID for username: ${targetUser}` }]
          };
        }

        const timeoutReason = reason || "inappropriate behavior";
        const duration = guessTimeoutDuration(timeoutReason);
        
        await makeTwitchApiCall('/moderation/bans', 'POST', {
          broadcaster_id: config.twitchBroadcasterId,
          moderator_id: config.twitchBroadcasterId,
          data: {
            user_id: userId,
            reason: timeoutReason,
            duration
          }
        });

        return {
          content: [{ type: "text", text: `Successfully timed out ${targetUser} for ${duration} seconds. Reason: ${timeoutReason}` }]
        };
      } catch (error) {
        const err = error as TwitchApiError;
        return {
          content: [{ type: "text", text: `Error timing out user: ${err.message}` }]
        };
      }
    }
  );

  // Tool: Ban User
  server.tool(
    "banUser",
    "Ban a user from the Twitch chat. If no username is provided, it will return the recent chat log for LLM review.",
    {
      usernameOrDescriptor: z.string().describe("Username or descriptor to ban (e.g. 'toxic', 'spammer', or a username)"),
      reason: z.string().optional().describe("Reason for ban (optional)")
    },
    async ({ usernameOrDescriptor, reason }) => {
      try {
        const targetUser = resolveModerationTarget(usernameOrDescriptor);
        
        if (!targetUser) {
          const log = getRecentChatLog(20);
          return {
            content: [{ type: "text", text: `No explicit username provided. Here are the last 20 chat messages:\n${log.join('\n')}` }]
          };
        }

        const userId = await getUserIdFromUsername(targetUser);
        if (!userId) {
          return {
            content: [{ type: "text", text: `Could not resolve user ID for username: ${targetUser}` }]
          };
        }

        const banReason = reason || "severe violation of chat rules";
        
        await makeTwitchApiCall('/moderation/bans', 'POST', {
          broadcaster_id: config.twitchBroadcasterId,
          moderator_id: config.twitchBroadcasterId,
          data: {
            user_id: userId,
            reason: banReason
          }
        });

        return {
          content: [{ type: "text", text: `Successfully banned ${targetUser}. Reason: ${banReason}` }]
        };
      } catch (error) {
        const err = error as TwitchApiError;
        return {
          content: [{ type: "text", text: `Error banning user: ${err.message}` }]
        };
      }
    }
  );

  // Tool: Update Stream Title
  server.tool(
    "updateStreamTitle",
    "Update the stream title",
    {
      title: z.string().describe("The new title for the stream")
    },
    async ({ title }) => {
      try {
        await makeTwitchApiCall('/channels', 'PATCH', {
          broadcaster_id: config.twitchBroadcasterId,
          title: title.replace(/"/g, '\\"') // Escape quotes
        });

        return {
          content: [{ type: "text", text: `Successfully updated stream title to: ${title}` }]
        };
      } catch (error) {
        const err = error as TwitchApiError;
        return {
          content: [{ type: "text", text: `Failed to update stream title: ${err.message}` }]
        };
      }
    }
  );

  // Tool: Update Stream Category
  server.tool(
    "updateStreamCategory",
    "Update the game category of the stream",
    {
      category: z.string().describe("The new game category, e.g. 'Fortnite'")
    },
    async ({ category }) => {
      try {
        // First, search for the category to get its ID
        const searchResponse = await makeTwitchApiCall(`/search/categories?query=${encodeURIComponent(category)}`);
        
        if (!searchResponse.data || searchResponse.data.length === 0) {
          return {
            content: [{ type: "text", text: `Could not find a Twitch category named '${category}'.` }]
          };
        }

        const categoryId = searchResponse.data[0].id;
        
        // Update the channel with the new game_id
        await makeTwitchApiCall('/channels', 'PATCH', {
          broadcaster_id: config.twitchBroadcasterId,
          game_id: categoryId
        });

        return {
          content: [{ type: "text", text: `Successfully updated stream category to: ${category}` }]
        };
      } catch (error) {
        const err = error as TwitchApiError;
        return {
          content: [{ type: "text", text: `Failed to update stream category: ${err.message}` }]
        };
      }
    }
  );

  // ===== AUTONOMOUS MONITORING TOOLS =====

  // Tool: Start Autonomous Monitoring
  server.tool(
    "startAutonomousMonitoring",
    "Start autonomous chat monitoring and moderation",
    {},
    async () => {
      try {
        if (!autoMonitor) {
          return {
            content: [{ type: "text", text: "AutonomousMonitor is not initialized. Please check server configuration." }]
          };
        }

        await autoMonitor.start();
        const state = autoMonitor.getState();
        
        return {
          content: [{ type: "text", text: `✅ Autonomous monitoring started successfully!\n\n` +
            `- Status: ${state.isActive ? 'Active' : 'Inactive'}\n` +
            `- Monitoring interval: ${config.autonomous.monitoringInterval}ms\n` +
            `- Recent actions: ${state.recentActions.length}`
          }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: "text", text: `❌ Failed to start autonomous monitoring: ${errorMessage}` }]
        };
      }
    }
  );

  // Tool: Stop Autonomous Monitoring
  server.tool(
    "stopAutonomousMonitoring",
    "Stop autonomous chat monitoring and moderation",
    {},
    async () => {
      try {
        if (!autoMonitor) {
          return {
            content: [{ type: "text", text: "AutonomousMonitor is not initialized." }]
          };
        }

        await autoMonitor.stop();
        
        return {
          content: [{ type: "text", text: "🛑 Autonomous monitoring stopped successfully. Daily report has been generated." }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: "text", text: `❌ Failed to stop autonomous monitoring: ${errorMessage}` }]
        };
      }
    }
  );

  // Tool: Force Analysis
  server.tool(
    "forceAnalysis",
    "Force immediate analysis of current chat and execute any necessary actions",
    {},
    async () => {
      try {
        if (!autoMonitor) {
          return {
            content: [{ type: "text", text: "AutonomousMonitor is not initialized." }]
          };
        }

        const analysis = await autoMonitor.forceAnalysis();
        
        const summary = `🔍 Forced Analysis Results:\n\n` +
          `📊 **Patterns Detected:** ${analysis.patterns.length}\n` +
          `🤖 **Decisions Made:** ${analysis.decisions.length}\n` +
          `⚡ **Actions Executed:** ${analysis.executed.length}\n\n`;
        
        if (analysis.executed.length > 0) {
          const actionSummary = analysis.executed.map(action => 
            `- ${action.action}: ${action.reason} (confidence: ${Math.round(action.confidence * 100)}%)`
          ).join('\n');
          
          return {
            content: [{ type: "text", text: summary + "**Executed Actions:**\n" + actionSummary }]
          };
        } else {
          return {
            content: [{ type: "text", text: summary + "No actions were needed at this time." }]
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: "text", text: `❌ Failed to perform forced analysis: ${errorMessage}` }]
        };
      }
    }
  );

  // Tool: Get Monitoring State
  server.tool(
    "getMonitoringState",
    "Get current status and statistics of the autonomous monitoring system",
    {},
    async () => {
      try {
        if (!autoMonitor) {
          return {
            content: [{ type: "text", text: "AutonomousMonitor is not initialized." }]
          };
        }

        const state = autoMonitor.getState();
        
        const stateReport = `🤖 **Autonomous Monitoring State**\n\n` +
          `**Status:** ${state.isActive ? '🟢 Active' : '🔴 Inactive'}\n` +
          `**Last Analysis:** ${state.lastAnalysis.toISOString()}\n` +
          `**Recent Actions:** ${state.recentActions.length}\n\n` +
          `**📈 Today's Statistics:**\n` +
          `- Actions taken: ${state.statistics.actionsToday}\n` +
          `- Success rate: ${(state.statistics.successRate * 100).toFixed(1)}%\n` +
          `- Average confidence: ${(state.statistics.averageConfidence * 100).toFixed(1)}%\n` +
          `- Most common action: ${state.statistics.mostCommonAction || 'None'}`;
        
        return {
          content: [{ type: "text", text: stateReport }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: "text", text: `❌ Failed to get monitoring state: ${errorMessage}` }]
        };
      }
    }
  );

  // Tool: Generate Performance Report
  server.tool(
    "generatePerformanceReport",
    "Generate a detailed performance report for the autonomous monitoring system",
    {},
    async () => {
      try {
        if (!autoMonitor) {
          return {
            content: [{ type: "text", text: "AutonomousMonitor is not initialized." }]
          };
        }

        const report = await autoMonitor.generatePerformanceReport();
        
        return {
          content: [{ type: "text", text: report }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: "text", text: `❌ Failed to generate performance report: ${errorMessage}` }]
        };
      }
    }
  );

  // Tool: Add Monitoring Feedback
  server.tool(
    "addMonitoringFeedback",
    "Provide feedback on an autonomous action to help improve the system's learning",
    {
      actionTimestamp: z.string().describe("ISO timestamp of the action to provide feedback for"),
      rating: z.number().int().min(1).max(5).describe("Rating from 1 (poor) to 5 (excellent)"),
      comment: z.string().optional().describe("Optional comment about the action"),
      source: z.enum(['chat', 'manual', 'streamer']).default('manual').describe("Source of the feedback")
    },
    async ({ actionTimestamp, rating, comment, source }) => {
      try {
        if (!autoMonitor) {
          return {
            content: [{ type: "text", text: "AutonomousMonitor is not initialized." }]
          };
        }

        const timestamp = new Date(actionTimestamp);
        if (isNaN(timestamp.getTime())) {
          return {
            content: [{ type: "text", text: "❌ Invalid timestamp format. Please use ISO format (e.g., 2023-12-01T10:30:00Z)." }]
          };
        }

        const success = await autoMonitor.addUserFeedback(
          timestamp,
          rating as 1 | 2 | 3 | 4 | 5,
          comment,
          source
        );

        if (success) {
          return {
            content: [{ type: "text", text: `✅ Feedback recorded successfully!\n\n` +
              `- Rating: ${rating}/5\n` +
              `- Source: ${source}\n` +
              `- Comment: ${comment || 'None'}\n\n` +
              `This feedback will help improve future autonomous decisions.`
            }]
          };
        } else {
          return {
            content: [{ type: "text", text: "❌ Failed to record feedback. The action timestamp may not be found." }]
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: "text", text: `❌ Failed to add feedback: ${errorMessage}` }]
        };
      }
    }
  );

  // Tool: Get Debug Info
  server.tool(
    "getDebugInfo",
    "Get detailed debug information about the autonomous monitoring system",
    {},
    async () => {
      try {
        if (!autoMonitor) {
          return {
            content: [{ type: "text", text: "AutonomousMonitor is not initialized." }]
          };
        }

        const debugInfo = autoMonitor.getDebugInfo();
        
        return {
          content: [{ type: "text", text: `🐛 **Debug Information:**\n\n` +
            safeJsonStringify(debugInfo, 6000)
          }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: "text", text: `❌ Failed to get debug info: ${errorMessage}` }]
        };
      }
    }
  );

  return server.server;
}
