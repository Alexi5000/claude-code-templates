<div align="center">

# Claude Code Templates - TechTide AI Fork

[![Upstream](https://img.shields.io/badge/Upstream-davila7%2Fclaude--code--templates-111827?style=flat-square&logo=github&logoColor=white)](https://github.com/davila7/claude-code-templates)
[![License](https://img.shields.io/badge/License-MIT-111827?style=flat-square)](LICENSE)
[![TechTide AI](https://img.shields.io/badge/TechTide_AI-0f766e?style=flat-square)](https://github.com/TechTideOhio)

</div>

---

## Why this fork exists

Every Claude Code deployment starts from a template. When we onboard a new enterprise client, the first question is always the same: "What agents, skills, and rules should we install?"

We maintain 30+ production-tested configurations that we ship to clients — covering everything from sprint management and code review to security auditing and document generation. This fork is where those configurations get battle-tested before they reach client environments.

This fork is TechTide's quality-assurance layer for the template ecosystem:

1. **Bug fixes** for scripts and agents that ship broken (invalid git flags, VS Code tool names in Claude Code agents, duplicate skill registry keys)
2. **Validation** of agent tool declarations against the actual Claude Code runtime
3. **Enterprise integration patterns** we've built from deploying Claude Code across fintech, healthcare, and SaaS teams
4. **Production readiness audits** — if a template works in a demo but fails under real workloads, we find and fix it

## What TechTide contributed upstream

| PR | Fix |
|----|-----|
| `git diff --since` bug | `check_staleness.py` used an invalid git flag — staleness checker always reported FRESH |
| VS Code Copilot tool names | 14 devops agents declared tool names Claude Code silently ignores — zero tool access at runtime |
| Duplicate skill names | 4 `-official` skills collided with community variants in the install registry |

## Upstream

This fork tracks [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates). All credit for the template framework, CLI installer, and community skill/agent ecosystem goes to Daniel Avila and the claude-code-templates contributors.

---

<div align="center">
  <sub>Maintained by <a href="https://github.com/Alexi5000">TechTide AI</a> for enterprise Claude Code deployments.</sub>
</div>
