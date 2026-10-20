# Local Claude API proxy

The optional proxy binds only to 127.0.0.1. Every conversation read and message write requires `Authorization: Bearer <token>`. Set `CLAUDE_API_PROXY_TOKEN` in the launching environment for an external local client; do not put it in URLs or commit it. Without configuration the process generates a fresh capability token, available to embedding callers as `proxy.authToken`, and never logs it.

Programmatic callers can construct `new ClaudeAPIProxy({ authToken, port, allowedOrigins })`. Browser access is denied unless the exact origin is explicitly listed; an allowed origin still requires the bearer token. Host headers must identify the loopback listener and its port. No bundled browser consumer of this optional proxy exists; the teams dashboard uses a separate server.
