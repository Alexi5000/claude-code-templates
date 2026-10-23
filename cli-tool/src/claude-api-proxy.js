const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const chalk = require('chalk');
const nativeFs = require('node:fs');
const { randomBytes, timingSafeEqual } = require('node:crypto');

function invalidConversation() {
  const error = new Error('Invalid conversation path');
  error.status = 400;
  return error;
}

class ClaudeAPIProxy {
  constructor(options = {}) {
    this.app = express();
    this.port = options.port ?? 3335;
    this.authToken = options.authToken || process.env.CLAUDE_API_PROXY_TOKEN || randomBytes(32).toString('hex');
    this.allowedOrigins = new Set(options.allowedOrigins || []);
    this.claudeDir = path.join(os.homedir(), '.claude');
    
    // Store active sessions and conversation contexts
    this.activeSessions = new Map();
    this.conversationContexts = new Map();
    
    this.setupMiddleware();
    this.setupRoutes();
  }
  
  setupMiddleware() {
    this.app.use((req, res, next) => {
      const port = req.socket.localPort;
      const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
      if (!hosts.has(req.get('host'))) return res.status(403).json({ error: 'Untrusted host' });
      const origin = req.get('origin');
      if (origin && !this.allowedOrigins.has(origin)) return res.status(403).json({ error: 'Untrusted origin' });
      if (origin) {
        res.set('Access-Control-Allow-Origin', origin);
        res.vary('Origin');
        res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      const supplied = Buffer.from(req.get('authorization') || '');
      const expected = Buffer.from(`Bearer ${this.authToken}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      next();
    });
    this.app.use(express.json({ limit: '64kb' }));
  }
  
  setupRoutes() {
    // Get active conversations/sessions
    this.app.get('/api/sessions', async (req, res) => {
      try {
        const sessions = await this.getActiveSessions();
        res.json({ sessions });
      } catch (error) {
        console.error('Error getting sessions:', error);
        res.status(error.status || 500).json({ error: error.status === 400 ? error.message : 'Unable to read sessions' });
      }
    });
    
    // Send message to Claude (main endpoint)
    this.app.post('/api/send-message', async (req, res) => {
      try {
        const { sessionId, message, projectPath } = req.body;
        
        if (!sessionId || !message) {
          return res.status(400).json({ error: 'sessionId and message are required' });
        }
        
        const result = await this.sendMessageToClaude(sessionId, message, projectPath);
        res.json(result);
        
      } catch (error) {
        console.error('Error sending message:', require('node:util').format('%s', error).replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/[\x00-\x1f\x7f\x85\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
        res.status(error.status || 500).json({ error: error.status === 400 ? error.message : 'Unable to send message' });
      }
    });
    
    // Get conversation history
    this.app.get('/api/conversation/:sessionId', async (req, res) => {
      try {
        const { sessionId } = req.params;
        const conversation = await this.getConversationHistory(sessionId);
        res.json({ conversation });
      } catch (error) {
        console.error('Error getting conversation:', require('node:util').format('%s', error).replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/[\x00-\x1f\x7f\x85\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
        res.status(error.status || 500).json({ error: error.status === 400 ? error.message : 'Unable to read conversation' });
      }
    });
  }
  
  async getActiveSessions() {
    const projectsDir = path.join(this.claudeDir, 'projects');
    
    if (!(await fs.pathExists(projectsDir))) {
      return [];
    }
    
    const sessions = [];
    const projectDirs = await fs.readdir(projectsDir, { withFileTypes: true });
    
    for (const projectEntry of projectDirs) {
      if (!projectEntry.isDirectory()) continue;
      const projectDir = projectEntry.name;
      const projectPath = path.join(projectsDir, projectDir);
      const files = await fs.readdir(projectPath, { withFileTypes: true });
      
      for (const entry of files) {
        const file = entry.name;
        if (entry.isFile() && file.endsWith('.jsonl')) {
          const sessionId = path.basename(file, '.jsonl');
          const filePath = path.join(projectPath, file);
          const stats = await this.withConversationFile(filePath, nativeFs.constants.O_RDONLY, handle => handle.stat());
          
          // Get basic info about the session
          const lastMessage = await this.getLastMessage(filePath);
          
          sessions.push({
            sessionId,
            projectPath: this.decodeProjectPath(projectDir),
            filePath,
            lastModified: stats.mtime,
            lastMessage: lastMessage?.content || 'No messages',
            messageCount: await this.getMessageCount(filePath)
          });
        }
      }
    }
    
    // Sort by most recent activity
    return sessions.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
  }
  
  decodeProjectPath(encodedPath) {
    return encodedPath.replace(/-/g, '/').replace(/^Users/, '/Users');
  }
  
  async getLastMessage(filePath) {
    try {
      const content = await this.withConversationFile(filePath, nativeFs.constants.O_RDONLY, handle => handle.readFile('utf8'));
      const lines = content.trim().split('\n').filter(line => line.trim());
      
      if (lines.length === 0) return null;
      
      const lastLine = lines[lines.length - 1];
      const lastMessage = JSON.parse(lastLine);
      
      return {
        content: this.extractMessageContent(lastMessage),
        timestamp: lastMessage.timestamp,
        role: lastMessage.message?.role || lastMessage.type
      };
    } catch (error) {
      console.error('Error reading last message:', error);
      return null;
    }
  }
  
  async getMessageCount(filePath) {
    try {
      const content = await this.withConversationFile(filePath, nativeFs.constants.O_RDONLY, handle => handle.readFile('utf8'));
      const lines = content.trim().split('\n').filter(line => line.trim());
      return lines.length;
    } catch (error) {
      return 0;
    }
  }
  
  extractMessageContent(messageObj) {
    if (messageObj.message?.content) {
      if (typeof messageObj.message.content === 'string') {
        return messageObj.message.content;
      }
      if (Array.isArray(messageObj.message.content)) {
        const textContent = messageObj.message.content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join(' ');
        return textContent || '[Tool use or other content]';
      }
    }
    return '[No content]';
  }
  
  async sendMessageToClaude(sessionId, messageContent, projectPath) {
    console.log(chalk.blue(require('node:util').format('%s', `📤 Sending message to session ${sessionId}`).replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/[\x00-\x1f\x7f\x85\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))));
    
    // Find the conversation file
    const conversationFile = await this.findConversationFile(sessionId, projectPath);
    
    if (!conversationFile) {
      throw new Error(`Conversation file not found for session ${sessionId}`);
    }
    
    // Get conversation context
    const context = await this.getConversationContext(conversationFile);
    
    // Create user message in Claude Code format
    const userMessage = this.createUserMessage(messageContent, context, sessionId);
    
    // Append to JSONL file
    await this.appendToConversation(conversationFile, userMessage);
    
    console.log(chalk.green(`✅ Message sent to ${conversationFile}`));
    
    // Try to notify Claude Code process about the file change
    await this.notifyClaudeProcess();
    
    // TODO: Monitor for Claude Code response
    
    return {
      success: true,
      messageId: userMessage.uuid,
      sessionId,
      message: 'Message sent to Claude Code conversation'
    };
  }
  
  async findConversationFile(sessionId, projectPath) {
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) {
      throw invalidConversation();
    }
    if (projectPath != null && (typeof projectPath !== 'string' || projectPath.includes('\0'))) {
      throw invalidConversation();
    }
    const projectsDir = path.join(this.claudeDir, 'projects');
    
    const preferred = projectPath ? this.encodeProjectPath(projectPath) : null;
    const projectDirs = (await fs.readdir(projectsDir, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .sort((a, b) => Number(b.name === preferred) - Number(a.name === preferred));
    for (const projectDir of projectDirs) {
      const directory = path.join(projectsDir, projectDir.name);
      const files = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of files) {
        if (entry.name === `${sessionId}.jsonl`) {
          return this.validateConversationPath(path.join(directory, entry.name));
        }
      }
    }
    
    return null;
  }
  
  encodeProjectPath(projectPath) {
    return projectPath.replace(/[\\/]/g, '-').replace(/^-/, '');
  }

  async validateConversationPath(filePath) {
    const root = await fs.realpath(path.join(this.claudeDir, 'projects'));
    const absolute = path.resolve(filePath);
    const configuredRoot = path.resolve(this.claudeDir, 'projects');
    if (!absolute.startsWith(root + path.sep) && !absolute.startsWith(configuredRoot + path.sep)) {
      throw invalidConversation();
    }
    const resolved = await fs.realpath(absolute);
    const relative = path.relative(root, resolved);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw invalidConversation();
    }
    if (!resolved.endsWith('.jsonl')) throw invalidConversation();
    return resolved;
  }

  async withConversationFile(filePath, flags, operation) {
    const resolved = await this.validateConversationPath(filePath);
    const handle = await nativeFs.promises.open(resolved, flags | nativeFs.constants.O_NOFOLLOW | nativeFs.constants.O_NONBLOCK);
    try {
      if (!(await handle.stat()).isFile()) throw invalidConversation();
      return await operation(handle);
    } finally {
      await handle.close();
    }
  }
  
  async getConversationContext(conversationFile) {
    try {
      const content = await this.withConversationFile(conversationFile, nativeFs.constants.O_RDONLY, handle => handle.readFile('utf8'));
      const lines = content.trim().split('\n').filter(line => line.trim());
      
      if (lines.length === 0) {
        return { lastMessage: null, cwd: process.cwd(), version: '1.0.44' };
      }
      
      // Find the last valid JSON line (iterate backwards)
      let lastMessage = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        try {
          lastMessage = JSON.parse(line);
          break; // Found valid JSON, break out of loop
        } catch (jsonError) {
          // Skip invalid JSON lines
          console.warn(`Skipping invalid JSON line ${i + 1}: ${line.substring(0, 50)}...`);
          continue;
        }
      }
      
      if (!lastMessage) {
        console.warn('No valid JSON message found in conversation file');
        return { lastMessage: null, cwd: process.cwd(), version: '1.0.44' };
      }
      
      return {
        lastMessage,
        cwd: lastMessage.cwd || process.cwd(),
        version: lastMessage.version || '1.0.44',
        sessionId: lastMessage.sessionId
      };
    } catch (error) {
      console.error('Error getting conversation context:', error);
      return { lastMessage: null, cwd: process.cwd(), version: '1.0.44' };
    }
  }
  
  createUserMessage(content, context, sessionId) {
    const uuid = uuidv4();
    const timestamp = new Date().toISOString();
    
    return {
      parentUuid: context.lastMessage?.uuid || null,
      isSidechain: false,
      userType: "external",
      cwd: context.cwd,
      sessionId: sessionId,
      version: context.version,
      type: "user",
      message: {
        role: "user",
        content: content
      },
      uuid: uuid,
      timestamp: timestamp
    };
  }
  
  async appendToConversation(conversationFile, messageObj) {
    const messageJson = JSON.stringify(messageObj);
    await this.withConversationFile(conversationFile, nativeFs.constants.O_WRONLY | nativeFs.constants.O_APPEND, async handle => {
      await handle.writeFile(messageJson + '\n');
      const now = new Date();
      await handle.utimes(now, now);
    });
    
    console.log(chalk.green(`📝 Message appended to ${path.basename(conversationFile)}`));
  }
  
  async getConversationHistory(sessionId) {
    const conversationFile = await this.findConversationFile(sessionId);
    
    if (!conversationFile) {
      throw new Error(`Conversation not found for session ${sessionId}`);
    }
    
    const content = await this.withConversationFile(conversationFile, nativeFs.constants.O_RDONLY, handle => handle.readFile('utf8'));
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    const messages = lines
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return null;
        }
      })
      .filter(msg => msg !== null);
    
    return messages;
  }
  
  start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, '127.0.0.1', () => {
        console.log(chalk.green(`🌉 Claude API Proxy running on http://localhost:${this.port}`));
        console.log(chalk.blue(`📡 Ready to intercept and send messages to Claude Code`));
        resolve();
      });
      this.server.once('error', reject);
    });
  }
  
  stop() {
    if (this.server) {
      this.server.close();
      console.log(chalk.yellow(`🔌 Claude API Proxy stopped`));
    }
  }
}

module.exports = ClaudeAPIProxy;

// Method to notify Claude Code process
ClaudeAPIProxy.prototype.notifyClaudeProcess = async function() {
  try {
    console.log(chalk.blue('🔔 Attempting to activate Claude Code process...'));
    
    // Method 1: Find Claude Code process and try to send input
    const { exec, spawn } = require('child_process');
    
    // First, find Claude Code processes
    exec('ps aux | grep "claude"', (error, stdout, stderr) => {
      if (stdout) {
        const claudeProcesses = stdout.split('\n')
          .filter(line => line.includes('claude') && !line.includes('grep'))
          .filter(line => !line.includes('claude-code-templates')); // Exclude our dashboard
        
        console.log(chalk.blue(`🔍 Found ${claudeProcesses.length} Claude process(es)`));
        
        claudeProcesses.forEach(processLine => {
          const pid = processLine.trim().split(/\s+/)[1];
          console.log(chalk.gray(`  - PID ${pid}: ${processLine.substring(0, 100)}...`));
        });
      }
    });
    
    // Method 2: Try to write to the Claude Code terminal using applescript (macOS)
    if (process.platform === 'darwin') {
      this.tryAppleScriptNotification();
    }
    
    // Method 3: Try sending wake-up signal
    try {
      exec('pkill -SIGUSR1 claude', () => {});
    } catch (e) {/* ignore */}
    
  } catch (error) {
    console.log(chalk.gray('🔕 Could not notify Claude Code process'));
  }
};

// Try to use AppleScript to send input to Claude Code terminal
ClaudeAPIProxy.prototype.tryAppleScriptNotification = function() {
  try {
    const { execFile } = require('child_process');
    
    // This AppleScript tries to find Terminal/iTerm with Claude Code and send a key
    const appleScript = `
      tell application "System Events"
        set claudeFound to false
        try
          -- Try Terminal first
          tell application "Terminal"
            repeat with w in windows
              repeat with t in tabs of w
                if (custom title of t contains "claude" or name of t contains "claude") then
                  set claudeFound to true
                  set frontmost to true
                  do script "" in t  -- Send empty command to wake up
                  exit repeat
                end if
              end repeat
              if claudeFound then exit repeat
            end repeat
          end tell
        end try
        
        if not claudeFound then
          try
            -- Try iTerm2
            tell application "iTerm"
              repeat with w in windows
                repeat with t in tabs of w
                  tell current session of t
                    if (name contains "claude") then
                      set claudeFound to true
                      select
                      write text ""
                      exit repeat
                    end if
                  end tell
                end repeat
                if claudeFound then exit repeat
              end repeat
            end tell
          end try
        end if
      end tell
    `;
    
    execFile('osascript', ['-e', appleScript], { timeout: 5000, maxBuffer: 65536 }, (error) => {
      if (error) {
        console.log(chalk.gray('🔕 AppleScript notification failed'));
      } else {
        console.log(chalk.green('✅ AppleScript notification sent'));
      }
    });
    
  } catch (error) {
    // Silent fail
  }
};

// If run directly
if (require.main === module) {
  const proxy = new ClaudeAPIProxy();
  proxy.start();
  
  process.on('SIGINT', () => {
    proxy.stop();
    process.exit(0);
  });
}
