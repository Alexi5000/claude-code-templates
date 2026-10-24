[![npm version](https://img.shields.io/npm/v/claude-code-templates.svg)](https://www.npmjs.com/package/claude-code-templates)
[![npm downloads](https://img.shields.io/npm/dt/claude-code-templates.svg)](https://www.npmjs.com/package/claude-code-templates)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Open Source](https://badges.frapsoft.com/os/v1/open-source.svg?v=103)](https://opensource.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/davila7/claude-code-templates/blob/main/CONTRIBUTING.md)
[![GitHub stars](https://img.shields.io/github/stars/davila7/claude-code-templates.svg?style=social&label=Star)](https://github.com/davila7/claude-code-templates)

# Claude Code Templates

**CLI tool for configuring and monitoring Claude Code** - Quick setup for any project with framework-specific commands and real-time monitoring dashboard.

The local sandbox execution server binds to IPv4 loopback and accepts browser requests only from its own origin. Open it through its localhost URL; reverse-proxy and cross-origin access are intentionally rejected. Local execution requires the native `claude` executable on PATH, including on Windows. Prompt text is passed as a literal argument, never through a shell. Agent installation accepts catalog-style identifiers only. This is a local operator tool, not an authenticated multi-user service; other processes running locally remain trusted.

Analytics, mobile chats, teams, and plugin dashboards accept up to 600 API requests per minute per running server, shared across clients. Excess API requests return HTTP 429 with a `Retry-After` header before data loading or request-body parsing. Dashboard pages and static assets remain available. Mobile conversation-search logs contain aggregate match counts without copying search terms or conversation identifiers.

The analytics Console Bridge listener (`ws://127.0.0.1:3334`) binds to loopback only and requires a per-session token generated at startup. The full connection URL, including `?token=`, is printed to the operator's terminal; clients may instead send the token in an `x-console-bridge-token` header. Set `CLAUDE_CONSOLE_BRIDGE_TOKEN` to supply your own token for a trusted local client. Browser connections from non-loopback origins are rejected, and socket responses must carry the `interactionId` of the pending prompt.

## 🚀 Quick Start

```bash
# Interactive setup (recommended)
npx claude-code-templates@latest

# Real-time analytics dashboard
npx claude-code-templates@latest --analytics

# System health check
npx claude-code-templates@latest --health-check
```

## ✨ Core Features

- **📋 Smart Project Setup** - Auto-detect and configure any project with framework-specific commands
- **📊 Real-time Analytics** - Monitor Claude Code sessions with live state detection and performance metrics
- **🔍 Health Check** - Comprehensive system validation with actionable recommendations
- **🧩 Individual Components** - Install specialized agents, commands, and MCPs individually
- **🌍 Global Agents** - Create AI agents accessible from anywhere using Claude Code SDK

## 🎯 What You Get

| Component | Description | Example |
|-----------|-------------|---------|
| **CLAUDE.md** | Project-specific Claude Code configuration | Framework best practices, coding standards |
| **Commands** | Custom slash commands for development tasks | `/generate-tests`, `/check-file`, `/optimize-bundle` |
| **Agents** | AI specialists for specific domains | API security audit, React performance, database optimization |
| **MCPs** | External service integrations | GitHub, databases, development tools |
| **Skills** | Modular capabilities with progressive disclosure | PDF processing, algorithmic art, MCP builder |
| **Analytics** | Real-time monitoring dashboard | Live session tracking, usage statistics, exports |

## 🛠️ Supported Technologies

| Language | Frameworks | Status |
|----------|------------|---------|
| **JavaScript/TypeScript** | React, Vue, Angular, Node.js | ✅ Ready |
| **Python** | Django, Flask, FastAPI | ✅ Ready |
| **Common** | Universal configurations | ✅ Ready |
| **Go** | Gin, Echo, Fiber | 🚧 Coming Soon |
| **Rust** | Axum, Warp, Actix | 🚧 Coming Soon |

## 🌍 Global Agents (Claude Code SDK Integration)

Create AI agents that can be executed from anywhere using the Claude Code SDK:

```bash
# Create a global agent (one-time setup)
npx claude-code-templates@latest --create-agent customer-support

# Use the agent from anywhere
customer-support "Help me with ticket #12345"
sre-logs "Analyze error patterns in app.log"  
code-reviewer "Review this PR for security issues"
```

### Available Global Agents

| Agent | Usage | Description |
|-------|-------|-------------|
| `customer-support` | `customer-support "query"` | AI customer support specialist |
| `api-security-audit` | `api-security-audit "analyze endpoints"` | Security auditing for APIs |
| `react-performance-optimization` | `react-performance-optimization "optimize components"` | React performance expert |
| `database-optimization` | `database-optimization "improve queries"` | Database performance tuning |

### Global Agent Management

```bash
# List installed global agents
npx claude-code-templates@latest --list-agents

# Update an agent to latest version
npx claude-code-templates@latest --update-agent customer-support

# Remove an agent
npx claude-code-templates@latest --remove-agent customer-support
```

### How It Works

1. **Download Agent**: Fetches the latest agent from GitHub
2. **Generate Executable**: Creates a Node.js script that calls Claude Code SDK
3. **Add to PATH**: Makes the agent available globally in your shell
4. **Ready to Use**: Execute `agent-name "your prompt"` from any directory

The agents use the Claude Code SDK internally to provide specialized AI assistance with domain-specific knowledge and best practices.

## 🎨 Skills (Anthropic Format)

Install modular capabilities that Claude loads dynamically using Anthropic's progressive disclosure pattern:

```bash
# Install individual skills
npx claude-code-templates@latest --skill pdf-processing-pro
npx claude-code-templates@latest --skill algorithmic-art
npx claude-code-templates@latest --skill mcp-builder

# Install multiple skills
npx claude-code-templates@latest --skill pdf-anthropic,docx,xlsx,pptx
```

### Featured Skills

#### 🎨 Creative & Design
- **algorithmic-art** - Create generative art using p5.js with seeded randomness
- **canvas-design** - Design beautiful visual art in .png and .pdf formats
- **slack-gif-creator** - Create animated GIFs optimized for Slack

#### 💻 Development & Technical
- **mcp-builder** - Guide for creating high-quality MCP servers
- **artifacts-builder** - Build complex HTML artifacts with React and Tailwind
- **webapp-testing** - Test local web applications using Playwright
- **skill-creator** - Guide for creating effective skills

#### 📄 Document Processing
- **pdf-processing-pro** - Production-ready PDF toolkit (forms, tables, OCR)
- **pdf-anthropic** - Anthropic's comprehensive PDF manipulation toolkit
- **docx** - Create, edit, and analyze Word documents
- **xlsx** - Create, edit, and analyze Excel spreadsheets
- **pptx** - Create, edit, and analyze PowerPoint presentations

#### 🏢 Enterprise & Communication
- **brand-guidelines** - Apply Anthropic's official brand guidelines
- **internal-comms** - Write internal communications (reports, newsletters, FAQs)
- **theme-factory** - Style artifacts with professional themes

### Skills Architecture

Skills follow Anthropic's progressive disclosure pattern:
- **Metadata** - Always loaded (name, description)
- **Instructions** - Loaded when skill is triggered
- **Resources** - Reference files loaded only when needed
- **Scripts** - Execute without loading code into context

### Attribution

Skills from [anthropics/skills](https://github.com/anthropics/skills):
- **Open Source** (Apache 2.0): algorithmic-art, mcp-builder, skill-creator, artifacts-builder, and more
- **Source-Available** (Reference): docx, pdf-anthropic, pptx, xlsx

See [ANTHROPIC_ATTRIBUTION.md](cli-tool/components/skills/ANTHROPIC_ATTRIBUTION.md) for complete license information.

## 📖 Documentation

**[📚 Complete Documentation](https://docs.aitmpl.com/)** - Comprehensive guides, examples, and API reference

Quick links:
- [Getting Started](https://docs.aitmpl.com/docs/intro) - Installation and first steps
- [Project Setup](https://docs.aitmpl.com/docs/project-setup/interactive-setup) - Configure your projects
- [Analytics Dashboard](https://docs.aitmpl.com/docs/analytics/overview) - Real-time monitoring
- [Individual Components](https://docs.aitmpl.com/docs/components/overview) - Agents, Commands, MCPs
- [CLI Options](https://docs.aitmpl.com/docs/cli-options) - All available commands

## 🤝 Contributing

We welcome contributions! Browse available templates and components at **[aitmpl.com](https://aitmpl.com)**, then check our [contributing guidelines](https://github.com/davila7/claude-code-templates/blob/main/CONTRIBUTING.md).

## 📄 License

MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- **🌐 Browse Components**: [aitmpl.com](https://aitmpl.com)
- **📚 Documentation**: [docs.aitmpl.com](https://docs.aitmpl.com)
- **🐛 Issues**: [GitHub Issues](https://github.com/davila7/claude-code-templates/issues)
- **💬 Discussions**: [GitHub Discussions](https://github.com/davila7/claude-code-templates/discussions)

---

**⭐ Found this useful? Give us a star to support the project!**

## Private local conversation dashboards

Analytics and mobile chats bind to `127.0.0.1` and require the per-process access link printed by the CLI. Opening that link creates an HttpOnly, SameSite session cookie and removes the token from the URL. API clients can instead send `Authorization: Bearer <token>`. WebSocket connections enforce the same session and origin checks. Restarting the process invalidates prior links. Cloudflare tunnels remain optional; anyone with an access link can read the dashboard, so keep it private.
