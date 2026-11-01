# AE1 referenced-artifact review

Reviewed security-relevant executable examples, endpoints, credentials, process calls and file operations; these are coverage exceptions, not claims that the scanner fully analyzed them.

| Artifact under cli-tool/components/skills | Initial review lines/bytes | Review |
|---|---:|---|
| career/workorai/scripts/credential-store.mjs |761/23313|No HTTP/network calls. Commands are fixed argv /usr/bin/security, secret-tool, powershell/pwsh; service workorai, candidate/employer accounts only. Token comes stdin or named WORKORAI env; intentional get prints only selected token. Uses role allowlist, redacted errors, consent documented for persistence. Found and fixed descriptor read race; follow-up also fixes save via O_NOFOLLOW+fstat single-link regular file+fchmod before truncate. No generic credential harvesting command.|
| development/bleu/references/advanced-architecture.md |621/44996|Read opt-in integration design and embedded JSON/markdown. Writes are described within blueprint/{raw,plan,.reflection,.graph,.telemetry}, .claude/{agents,rules,settings}; opt-in schedule/agent hooks and named proposer-validator roles. Only explicit URL is documentation code.claude.com/docs/en/scheduled-tasks. No runtime endpoint/credential-reading code. External integrations explicitly opt-in, no destructive integrations, private company source requires approval. Parser limits concern long hook prompt/config examples.|
| development/mcp-builder/reference/node_mcp_server.md |970/28550|TypeScript documentation uses fixed https://api.example.com/v1 placeholder, Axios timeout30s, validated query inputs; EXAMPLE_API_KEY existence checks without logging key. No subprocess credential harvesting; package clean removes dist only. HTTP example previously omitted host bind; now restricted127.0.0.1. Stdio/default local server, optional HTTP must receive authentication for remote production use.|
| development/mcp-builder/reference/python_mcp_server.md |719/25099|Python docs fixed api.example.com placeholder with httpx30s timeout, Pydantic query validation. No process execution in examples. Resource example read docs/{name} lacked containment; fixed resolved root containment including symlinks before file read. Interactive sample explicitly requests API key via typed password input, no hardcoded key or exfil host.|
| development/skill-creator/assets/eval_review.html |146/7058|Read full template. External resources only Google Fonts CSS/font hosts. No fetch/XHR/WebSocket. Local editable evaluation rows use textContent-based escaping before textarea insertion; numeric array indexes in handlers; exports JSON through Blob/objectURL/download and revokes URL. Placeholder data must be JSON/HTML escaped by caller. All three copies identical hash.|
| development/skill-development/assets/eval_review.html |146/7058|Identical to above.|
| productivity/skill-creator/assets/eval_review.html |146/7058|Identical to above.|
| media/speech/scripts/atlas_text_to_speech.py |428/14350|API origin fixed https://api.atlascloud.ai/api/v1; bearer from ATLASCLOUD_API_KEY only; finite POST/poll attempts with timeout, encoded prediction id. Added refusal of authenticated API redirects. Download sends no bearer, validates HTTPS/public hosts and redirect targets,100MiB cap; uses exclusive output creation absent explicit --force. No subprocesses. Removed separate codex-network docs recommending global never-approval policy.|

## Exact exception policy

Each native v2 baseline retains only individually reviewed fingerprint entries with a reason. No rule-wide exceptions are permitted. The manifest binds each baseline to the SHA-256 of every file in its skill directory, including referenced scripts and templates. Any source change disables that skill baseline; new findings remain active. Native fingerprints additionally bind scanner version, rule, file, full source hash and occurrence. Threshold 50 and fail-closed scanner errors/timeouts remain unchanged. Suppressed findings and raw scanner metadata are uploaded alongside the report for audit.

These exceptions distinguish specific false-positive documentation/argv/schema matches and manually reviewed parser coverage limits. They are not certification that a skill is safe in every environment. Unpinned installer, dynamic-call and other unreviewed findings remain visible. Independent parent review approved these specific occurrences after source inspection.

Substantive repairs precede exception acceptance: descriptor-safe credential writes; private Office shim and recalculation profiles; validated evaluation slugs; preservation of unrelated port listeners; deterministic one-pass JSON/HTML template rendering; fixed local server process-group cleanup; contained documentation resource paths; scoped network-approval guidance; authenticated API redirect refusal; public-address-pinned HTTPS downloads preserving TLS hostname/SNI, rejecting private/benchmark/multicast addresses and bypassing ambient proxies; exclusive download writes unless force is explicit.

The deterministic renderer escapes less-than in JSON and HTML-escapes titles/descriptions, with hostile closing-script and nested-placeholder regression tests. Atlas validates each redirect anew and connects to the exact validated address, preventing DNS rebinding between validation and connection. LibreOffice child environments are used only for fixed argv local document operations, never forwarded to remote hosts.

## Final reviewed artifact metadata

Hashes below identify the reviewed coverage-limited sources. The manifest records the wider whole-tree binding.

| Artifact | Lines | Bytes | SHA-256 |
|---|---:|---:|---|
| `career/workorai/scripts/credential-store.mjs` | 766 | 23659 | `b1bceddeba56b0eabc6b194041b7a8f291ef829368d0b587d6c8c03038d49d83` |
| `development/bleu/references/advanced-architecture.md` | 621 | 44996 | `cf3891db755212095b175e10a626036013faf8333005199d38fd2b2352fbde6b` |
| `development/mcp-builder/reference/node_mcp_server.md` | 970 | 28563 | `8a87d8acb06feaaabae013f45812023e47bbbe426804aac394f59fbf870d799d` |
| `development/mcp-builder/reference/python_mcp_server.md` | 723 | 25321 | `96c0302cbf5ed7ff3a41867710bc0555860a4eaa9c5f0c6545314cbf430ed09b` |
| `development/skill-creator/assets/eval_review.html` | 146 | 7058 | `ce477dcc74dc1c0d1d3352646a79167b5a63634e936b1019160025065974e452` |
| `development/skill-development/assets/eval_review.html` | 146 | 7058 | `ce477dcc74dc1c0d1d3352646a79167b5a63634e936b1019160025065974e452` |
| `productivity/skill-creator/assets/eval_review.html` | 146 | 7058 | `ce477dcc74dc1c0d1d3352646a79167b5a63634e936b1019160025065974e452` |
| `media/speech/scripts/atlas_text_to_speech.py` | 445 | 15331 | `8fe0ff2e1f5031d641bdbe58a304412c6ea1b85a4993ebe68f59003b765535a0` |
| `scientific/scholar-evaluation/references/evaluation_framework.md` | 663 | 19950 | `0f771d994c048869a0b9fd33354d1e5fafa29e18108986137ec946ad37fea906` |
| `document-processing/xlsx/recalc.py` | 190 | 6087 | `a8606c128c354fd860c6f73c14ceded5c7e90e9db3fab82e273213bf2d967b1d` |
| `document-processing/xlsx/scripts/recalc.py` | 189 | 6018 | `06f711cbee78cf2afeebe7dae4d3767b01e13e4ec4f573fc9cd15b327abefcbc` |
| `document-processing/xlsx-official/recalc.py` | 190 | 6087 | `a8606c128c354fd860c6f73c14ceded5c7e90e9db3fab82e273213bf2d967b1d` |
| `document-processing/xlsx-official/scripts/recalc.py` | 189 | 6018 | `06f711cbee78cf2afeebe7dae4d3767b01e13e4ec4f573fc9cd15b327abefcbc` |

The scholar framework is a text-only evaluation rubric with no network, process or file execution; its “No ethical considerations” phrase describes a failing methodology criterion. Both spreadsheet entrypoints and their scripts use private temporary LibreOffice profiles and explicit subprocess timeouts; cleanup is limited to their own temporary directories.

## Canonical scanner validation

Baseline fingerprints use the scanner report node's sanitized canonical findings before display deduplication. Display-expanded occurrence records do not reproduce the scanner's suppression input. The reviewed XML BOM and pList schema occurrences in both spreadsheet skills are byte-identical to the reviewed document schemas. All 20 manifest skills were rescanned against the unchanged threshold of 50; the remaining unsuppressed findings remain in the raw report. This does not certify live execution or third-party installer safety.

## Upstream-sync follow-up review

The following exact occurrences were reviewed against current source. The original instruction-override recommendation and direct generated-code execution were repaired, not suppressed. Coverage exceptions identify documentation/parser limits; they do not certify external services, packages, or runtime execution. The whole-tree hash and scanner-version binding remain mandatory. No rule-wide exception or severity threshold changed.

| Skill | Exact fingerprints | Review evidence and limits |
|---|---:|---|
| `ai-research/claude-code-guide` | 1 | Session restart guidance explicitly retains project instructions, permissions and safety. P1 instruction override was repaired before this review. |
| `creative-design/frontend-design` | 1 | Errors do not apologize describes UI error-copy style; adjacent instructions require concrete failure explanations and remedies, not omission of safety warnings. |
| `curviate/curviate-profile` | 2 | Warns that invalid location filters are silently ignored and requires resolving identifiers; does not instruct omission of warnings. HTML comment labels the CLI0.33.0 generated command-surface section. It contains provenance metadata, not hidden behavioral instructions. |
| `curviate/curviate-search` | 2 | Describes an upstream CLI silent-filter failure and prescribes identifier resolution; not suppression of agent warnings. HTML comment labels the CLI0.33.0 generated command-surface section. It contains provenance metadata, not hidden behavioral instructions. |
| `git/worktree-cleaner` | 1 | Explicitly warns Git removes ignored local secrets without warning and requires showing them to the user; opposite of suppressing warnings. |
| `productivity/devil` | 1 | Output rule is a document-review template requiring concrete failure scenarios. No request to reveal system prompts or hidden instructions. |
| `productivity/discernment-nudge` | 1 | Answer-completely instruction concerns response ordering before optional follow-up prompts; no instruction to bypass restrictions or comply with unsafe requests. |
| `productivity/doc-chaser-lite` | 3 | Comments mark synchronization of a visible liability guard and its prohibited-phrase list; no hidden commands. Guard explicitly limits legal/tax advice and masks identifiers. FLAGGED-PHRASES delimiter marks phrases the guard forbids; the comments are synchronization metadata, not hidden agent instructions. |
| `web-data/pricewin-travel-search` | 1 | Safety and output rules constrain booking tools, require explicit cancellation consent and prohibit collecting payment credentials; not prompt disclosure. |
| `development/context-architecture` | 1 | Read complete referenced document. Missing references are example target-repository paths (AGENTS.md, package.json, rules), not absent bundled executables. No subprocess or remote-data execution; incremental changes preserve verification gates. |
| `development/internet-court` | 1 | Read complete router. SKILL.md refers to separately installed protocol packages, explicitly identified as external; no bundled executable claimed. Bounded spending/testnet guidance remains. This exception does not certify external package execution. |
| `development/pudu-task-telemetry` | 1 | Read complete telemetry-contract.md: prose specifies bounded local storage, scoped metrics, privacy exclusions, timeouts, failure codes and lock recovery; no executable expression. Parser span coverage limitation, not concealment. |
| `workflow-automation/rote` | 2 | Read complete router. Missing paths are caller-selected input skills and generated pipeline.yaml outputs, not absent bundled dependencies. Explicit path confirmation, cost disclosure, no remote shell installer, separate deployment and honest result requirements remain. |
| `web-development/building-blog` | 2 | Reviewed referenced specification structure and security-relevant executable examples in sections7,9,20. Generator uses fixed Google endpoint, explicit Gemini/Sanity env credentials, user-authored TOPICS, parameterized Sanity queries and selected-document writes. No arbitrary generated-code execution. Coverage exception is not a claim of full scanner analysis or production hardening; external generation and CMS writes require operator configuration. |
| `curviate/curviate-engage` | 1 | HTML comment labels the CLI0.33.0 generated command-surface section. It contains provenance metadata, not hidden behavioral instructions. |
| `curviate/curviate-inbox` | 1 | HTML comment labels the CLI0.33.0 generated command-surface section. It contains provenance metadata, not hidden behavioral instructions. |
| `curviate/curviate-jobs` | 1 | HTML comment labels the CLI0.33.0 generated command-surface section. It contains provenance metadata, not hidden behavioral instructions. |
| `curviate/curviate-premium` | 1 | HTML comment labels the CLI0.33.0 generated command-surface section. It contains provenance metadata, not hidden behavioral instructions. |

## 2026-11-01 upstream-sync review: productivity/rex-claude

New upstream skill (davila7 #1321). Every file in the skill tree was read: `SKILL.md` (84 lines) and `scripts/rex-claude.sh` (238 lines). The script only runs fixed argv calls to the documented `rex` CLI and `jq`, keeps per-pane timestamps under `${TMPDIR:-/tmp}/rex-claude`, makes no network calls, uses no `eval`, never reads `.claude/` or credential files, and refuses to target its own pane. `--trust` (answering the workspace trust dialog) is opt-in, and the Rules section limits it to a directory created for the task or the user's own project and forbids "always allow" or bypass-mode answers to permission prompts.

| Fingerprint rule | File | Review |
|---|---|---|
| AE1 | SKILL.md | Parser span limit on `scripts/rex-claude.sh`; reviewed manually in full (coverage exception, not a certification). |
| AS1 | SKILL.md | Text explains that the child `claude` loads project and user settings itself; nothing in the skill reads them. |
| RA2 | SKILL.md (MEDIUM) | Advises a scratch project's settings file so the user's own settings stay untouched. |

The baseline is bound to the whole-tree SHA-256 in `manifest.json` and scanner 2.12.0, so any source change re-enables all three findings. With the baseline the skill scores 22 (MEDIUM); a second AS1 occurrence (SKILL.md line 64, same settings-file wording in the Patterns section) is fingerprinted separately by the scanner and stays visible.

## 2026-11-01 changed-skills gate: base comparison

Upstream davila7 #1269 changed only the `name:` frontmatter line in 100 skills. That re-scanned skills whose findings were already on `main` (the catalog records the same scores from the 2026-10-17 and 2026-10-25 full scans) and, because the whole-tree hash changed, also disabled their reviewed baselines. `skill-security-scan.yml` now passes `--compare-base`: a skill over the threshold is rescanned raw at the merge base and blocks only if it is new, its base scan fails, its score rose, or some (rule, file) pair has more HIGH/CRITICAL findings than at base. The threshold (50), fail-closed errors and timeouts, and the exact-fingerprint baseline policy are unchanged. The per-skill timeout is now a flag; the PR gate uses 600 s because `ai-research/fine-tuning-unsloth` (multi-megabyte reference docs) takes about 170 s locally and exceeded 180 s on CI.
