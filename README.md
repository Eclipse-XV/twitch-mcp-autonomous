# Twitch MCP Autonomous Server

🤖 AI-powered autonomous chat monitoring and management for Twitch streamers. Built on the Model Context Protocol (MCP) for seamless AI integration.

## 🌟 Features

### Autonomous AI Agent
- **AI-Powered Pattern Detection**: Uses actual AI models (not keywords) to detect toxicity, spam, and engagement opportunities
- **Intelligent Decision Making**: Autonomously decides when to timeout, ban, engage with chat, or create polls
- **Continuous Learning**: Improves over time based on user feedback (1-5 star ratings)
- **Comprehensive Logging**: All actions and decisions logged in markdown for transparency

### Original MCP Tools
All the original Twitch MCP tools are included:
- Send messages to chat
- Create polls and predictions
- Generate clips
- Moderate chat (timeout/ban)
- Update stream title and category
- Analyze chat activity

### New Autonomous Tools
- startAutonomousMonitoring - Start the AI agent
- stopAutonomousMonitoring - Stop and generate reports
- getAutonomousStatus - View current status and statistics
- orceAutonomousAnalysis - Force immediate analysis
- ddUserFeedbackToAutonomous - Rate the AI's actions
- generateAutonomousReport - Generate performance reports

## 🚀 Quick Start on Smithery

### For Streamers (No coding required!)
1. Visit the Smithery server page (deployment pending)
2. Click "Connect" to add to Cursor
3. Configure with your Twitch credentials
4. Start autonomous monitoring!

### Configuration Required
| Parameter | Description |
|-----------|-------------|
| 	witchClientId | Your Twitch application client ID |
| 	witchAuthToken | OAuth token (without 'oauth:' prefix) |
| 	witchBroadcasterId | Your Twitch user ID |
| 	witchChannel | Your Twitch channel name |

### Optional Autonomous Configuration
| Parameter | Default | Description |
|-----------|---------|-------------|
| utonomous.enabled | false | Enable autonomous monitoring |
| utonomous.monitoringInterval | 30000 | Check interval in ms |
| utonomous.confidenceThreshold | 0.7 | Min confidence for actions |
| utonomous.spamDetection.enabled | true | Enable spam detection |
| utonomous.toxicityDetection.enabled | true | Enable toxicity detection |

## 🎯 How It Works

1. **Continuous Monitoring**: AI monitors chat in real-time
2. **Pattern Analysis**: Detects toxicity (with severity), spam, engagement opportunities
3. **Smart Decisions**: AI decides which actions to take based on patterns
4. **Action Execution**: Automatically executes timeouts, polls, engagement messages
5. **Feedback Loop**: Streamers can rate actions to improve AI behavior
6. **Learning & Adaptation**: System learns from feedback and adjusts over time

## 📁 Feedback & Learning System

The AI agent creates detailed logs in markdown:
- eedback/actions-YYYY-MM-DD.md - Daily action log
- eedback/feedback-YYYY-MM-DD.md - Detailed feedback entries
- eedback/learning-insights.md - AI learning recommendations
- eedback/daily-report-YYYY-MM-DD.md - Daily performance reports

## 🔧 Local Development

\\\ash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/twitch-mcp-autonomous.git
cd twitch-mcp-autonomous

# Install dependencies
npm install

# Run with Smithery CLI
npm run dev
\\\

## 🤝 AI Integration

The system is designed to work with any AI model. To connect your AI:

1. Implement the AIAnalysisFunction interface
2. Pass your AI function when initializing the autonomous monitor
3. The system will use your AI for all pattern detection and decision making

Example AI prompts are provided for:
- Toxicity detection with severity scoring
- Spam identification
- Engagement opportunity detection
- Sentiment analysis
- Decision making

## 📊 Performance Metrics

The autonomous system tracks:
- Total actions taken
- Success rate (based on feedback)
- Average user rating
- Most/least successful action types
- Pattern recognition accuracy
- Tool usage statistics

## 🛡️ Safety Features

- **Confidence Thresholds**: Only acts on high-confidence decisions
- **Cooldown Periods**: Prevents spam and over-moderation
- **Manual Override**: Stop autonomous mode anytime
- **Severity-Based Actions**: Graduated responses based on severity
- **Comprehensive Logging**: Full transparency of all decisions

## 📝 License

ISC

## 🙏 Credits

Built on the original Twitch MCP Server foundation, enhanced with autonomous AI capabilities.

---

**Note**: This is an enhanced version of the original twitch-mcp-smithery with autonomous AI features. For the basic version without AI monitoring, see the original repository.
