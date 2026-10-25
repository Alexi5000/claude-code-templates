# Network access for speech generation

Speech generation sends the requested text to the configured speech provider. Keep the environment's existing sandbox and approval policy.

If the command is blocked, request approval for the specific speech command and provider endpoint through the environment's normal approval flow. Explain what text will be sent and where output will be written. If approval is unavailable, stop and report the blocked command; a dry run can still prepare its payload without sending it.

For repeated jobs, use an explicitly authorized, narrowly scoped command rule if the environment supports one. Do not change global approval settings or disable sandbox protections to avoid prompts. Never send credentials or unrelated workspace content as speech input.
