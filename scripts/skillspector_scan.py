#!/usr/bin/env python3
"""Batch-orchestrate SkillSpector scans over skill components.

Discovers skill directories under cli-tool/components/skills/, runs the
SkillSpector CLI (`skillspector scan <dir> --no-llm --format json`) on each,
aggregates the per-skill JSON reports, and emits:

  * a Markdown summary (for PR comments / step summaries)
  * an aggregated SARIF 2.1.0 log (for GitHub code scanning)
  * GitHub Action outputs (failed, high_critical_count, scanned, errors)

SkillSpector itself requires Python 3.12+, but this orchestrator only uses the
standard library and runs on 3.9+ so the discovery logic can be exercised
locally without installing the scanner (see --dry-run).

Usage:
    skillspector_scan.py --all
    skillspector_scan.py --changed --base-ref origin/main
    skillspector_scan.py --all --dry-run            # list dirs, no scanning

The CLI exit code of `skillspector scan` is intentionally ignored: it returns
1 when a skill's risk score is high (a signal, not a failure) and 2 on real
errors. We parse stdout JSON and classify per-skill instead, so one broken
skill never aborts the whole batch.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Repo-relative root that holds every skill component.
SKILLS_ROOT = Path("cli-tool/components/skills")

# Accepted manifest filenames (case variants seen in the catalog).
MANIFEST_NAMES = {"skill.md"}

# Risk score above which a skill is considered HIGH/CRITICAL.
DEFAULT_THRESHOLD = 50

# Keep PR comments under GitHub's ~65k character limit.
MAX_COMMENT_CHARS = 60000

# Marker so the PR comment can be found and updated idempotently.
COMMENT_MARKER = "<!-- skillspector-report:v1 -->"


def _has_manifest(directory: Path) -> bool:
    """Return True if directory directly contains a SKILL.md (any case)."""
    try:
        for entry in directory.iterdir():
            if entry.is_file() and entry.name.lower() in MANIFEST_NAMES:
                return True
    except OSError:
        return False
    return False


def discover_all_skills(root: Path = SKILLS_ROOT) -> list[Path]:
    """Find every skill directory (one that directly contains a SKILL.md)."""
    if not root.is_dir():
        return []
    skills: list[Path] = []
    for dirpath, _dirnames, filenames in os.walk(root):
        if any(name.lower() in MANIFEST_NAMES for name in filenames):
            skills.append(Path(dirpath))
    return sorted(set(skills))


def _changed_files(base_ref: str) -> list[Path]:
    """Return repo-relative paths changed vs base_ref (three-dot diff)."""
    try:
        out = subprocess.run(
            ["git", "diff", "--name-only", f"{base_ref}...HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    except subprocess.CalledProcessError:
        # Fall back to two-dot if the merge base is unavailable (shallow clone).
        out = subprocess.run(
            ["git", "diff", "--name-only", base_ref],
            capture_output=True,
            text=True,
            check=False,
            timeout=180,
        ).stdout
    return [Path(line.strip()) for line in out.splitlines() if line.strip()]


def discover_changed_skills(base_ref: str, root: Path = SKILLS_ROOT) -> list[Path]:
    """Map changed files under the skills tree to their owning skill dirs."""
    changed = _changed_files(base_ref)
    skills: set[Path] = set()
    root_resolved = root.resolve()
    for rel in changed:
        # Only consider files under the skills tree.
        try:
            rel.resolve().relative_to(root_resolved)
        except ValueError:
            if root not in rel.parents and rel != root:
                continue
        # Walk up from the file's directory until we find the skill dir.
        current = (rel if rel.is_dir() else rel.parent)
        while True:
            if current == root or current == Path("."):
                break
            if current.is_dir() and _has_manifest(current):
                skills.add(current)
                break
            # Stop once we climb above the skills root.
            if root not in current.parents:
                break
            current = current.parent
    return sorted(skills)


BASELINES_ROOT = Path(__file__).resolve().parent / "security-baselines"


def skill_tree_hash(directory: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(directory.rglob("*")):
        if "__pycache__" in path.parts:
            continue
        if path.is_symlink():
            raise ValueError("Reviewed baselines cannot cover symlinked source")
        if path.is_file():
            digest.update(path.relative_to(directory).as_posix().encode() + b"\0")
            digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def reviewed_baseline_args(directory: Path) -> list[str]:
    manifest_path = BASELINES_ROOT / "manifest.json"
    if not manifest_path.exists():
        return []
    manifest = json.loads(manifest_path.read_text())
    try:
        key = directory.resolve().relative_to(SKILLS_ROOT.resolve()).as_posix()
    except ValueError:
        return []
    entry = manifest.get(key)
    if entry is None:
        return []
    if skill_tree_hash(directory) != entry["source_tree_sha256"]:
        print(f"Source changed; exact baseline disabled for {key}", flush=True)
        return []
    baseline = BASELINES_ROOT / entry["baseline"]
    if baseline.resolve().parent != BASELINES_ROOT.resolve():
        raise ValueError("Baseline path must stay in the reviewed baseline directory")
    data = json.loads(baseline.read_text())
    if data.get("version") != 2 or data.get("rules") or not data.get("scanner_version"):
        raise ValueError("Only exact version-bound fingerprint baselines are permitted")
    return ["--baseline", str(baseline), "--show-suppressed"]


def scan_skill(directory: Path) -> dict:
    """Run skillspector on one skill dir; return a normalized result dict."""
    result: dict = {"path": str(directory), "status": "ok"}
    try:
        proc = subprocess.run(
            [
                "skillspector",
                "scan",
                str(directory),
                "--no-llm",
                "--format",
                "json",
                *reviewed_baseline_args(directory),
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=180,
        )
    except subprocess.TimeoutExpired:
        result["status"] = "error"
        result["error"] = "skillspector scan exceeded 180 seconds"
        return result
    except FileNotFoundError:
        result["status"] = "error"
        result["error"] = "skillspector CLI not found on PATH"
        return result

    # Exit code 2 == real error. 0/1 are both valid (1 == high score).
    if proc.returncode not in (0, 1):
        result["status"] = "error"
        result["error"] = (proc.stderr or proc.stdout or "scan failed").strip()[:500]
        return result

    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        result["status"] = "error"
        result["error"] = "could not parse skillspector JSON output"
        result["raw"] = (proc.stdout or proc.stderr or "")[:500]
        return result

    risk = data.get("risk_assessment") if isinstance(data, dict) else None
    score = risk.get("score") if isinstance(risk, dict) else None
    if (not isinstance(data, dict) or data.get("execution_successful") is False or not isinstance(score, (int, float))
            or isinstance(score, bool) or not 0 <= score <= 100
            or not isinstance(data.get("issues", []), list)):
        result["status"] = "error"
        result["error"] = "Scanner returned an unsuccessful or invalid report"
        return result
    result["name"] = (data.get("skill") or {}).get("name") or directory.name
    result["score"] = int(risk.get("score") or 0)
    result["severity"] = (risk.get("severity") or "LOW").upper()
    result["recommendation"] = risk.get("recommendation") or "SAFE"
    result["issues"] = [
        {**issue,
         "rule_id": issue.get("rule_id") or issue.get("id"),
         "file": issue.get("file") or (issue.get("location") or {}).get("file"),
         "start_line": issue.get("start_line") or (issue.get("location") or {}).get("start_line"),
         "end_line": issue.get("end_line") or (issue.get("location") or {}).get("end_line"),
         "message": issue.get("message") or issue.get("explanation") or issue.get("finding") or "Finding"}
        for issue in data.get("issues") or []
    ]
    result["suppressed_count"] = data.get("suppressed_count", 0)
    result["report"] = data
    return result


_ALWAYS_REPORTED = {"HIGH", "CRITICAL"}


def _rule_descriptor(rule_id: str, issue: dict) -> dict:
    category = (issue.get("category") or "").strip()
    pattern = (issue.get("pattern") or "").strip()
    message = (issue.get("message") or "").strip()
    name = category or rule_id
    short = f"{category}: {pattern}" if category and pattern else (pattern or message or name)
    help_text = message or short
    return {
        "id": rule_id,
        "name": name,
        "shortDescription": {"text": short},
        "fullDescription": {"text": help_text},
        "help": {"text": f"SkillSpector rule {rule_id} ({name}). {help_text}"},
        "helpUri": "https://github.com/NVIDIA/skillspector",
    }


def _aggregate_sarif(results: list[dict], threshold: int | None = None) -> dict:
    """Merge per-skill SARIF-equivalent findings into one SARIF 2.1.0 log.

    With a threshold, only skills whose score exceeds it contribute findings,
    plus HIGH/CRITICAL findings from any skill, so code scanning tracks the
    same set the Markdown summary flags.
    """
    sarif_results: list[dict] = []
    rules: dict[str, dict] = {}
    severity_to_level = {
        "CRITICAL": "error",
        "HIGH": "error",
        "MEDIUM": "warning",
        "LOW": "note",
    }
    for res in results:
        if res.get("status") != "ok":
            continue
        skill_dir = res["path"].rstrip("/")
        over_threshold = threshold is None or res.get("score", 0) > threshold
        for issue in res.get("issues", []):
            severity = (issue.get("severity") or "LOW").upper()
            if not over_threshold and severity not in _ALWAYS_REPORTED:
                continue
            file_rel = issue.get("file") or ""
            # Prefix the issue's file (relative to the skill dir) with the
            # repo-relative skill dir so code scanning links resolve.
            if file_rel and not file_rel.startswith(skill_dir):
                uri = f"{skill_dir}/{file_rel.lstrip('./')}"
            else:
                uri = file_rel or skill_dir
            region: dict = {}
            if issue.get("start_line"):
                region["startLine"] = issue["start_line"]
            if issue.get("end_line"):
                region["endLine"] = issue["end_line"]
            location = {"physicalLocation": {"artifactLocation": {"uri": uri}}}
            if region:
                location["physicalLocation"]["region"] = region
            rule_id = issue.get("rule_id") or "UNKNOWN"
            rules.setdefault(rule_id, _rule_descriptor(rule_id, issue))
            sarif_results.append(
                {
                    "ruleId": rule_id,
                    "level": severity_to_level.get(severity, "note"),
                    "message": {"text": issue.get("message") or ""},
                    "locations": [location],
                }
            )
    return {
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "skillspector",
                        "informationUri": "https://github.com/NVIDIA/skillspector",
                        "rules": [rules[k] for k in sorted(rules)],
                    }
                },
                "results": sarif_results,
            }
        ],
    }


def _severity_emoji(severity: str) -> str:
    return {"LOW": "🟢", "MEDIUM": "🟡", "HIGH": "🔴", "CRITICAL": "🔴"}.get(severity, "")


def build_markdown(results: list[dict], threshold: int) -> str:
    """Produce the PR-comment Markdown summary."""
    scanned = [r for r in results if r.get("status") == "ok"]
    errors = [r for r in results if r.get("status") == "error"]
    flagged = sorted(
        [r for r in scanned if r["score"] > threshold],
        key=lambda r: r["score"],
        reverse=True,
    )
    high_critical = len(flagged)

    sev_counts = {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0}
    for r in scanned:
        sev_counts[r["severity"]] = sev_counts.get(r["severity"], 0) + 1

    status = "❌ ISSUES FOUND" if high_critical else "✅ PASSED"
    emoji = "⚠️" if high_critical else "🎉"

    lines = [COMMENT_MARKER]
    lines.append(f"## {emoji} SkillSpector Security Scan")
    lines.append("")
    lines.append(
        "Static analysis (`--no-llm`) by "
        "[SkillSpector](https://github.com/NVIDIA/skillspector) (NVIDIA, Apache-2.0)."
    )
    lines.append("")
    lines.append(f"**Status:** {status}")
    lines.append("")
    lines.append("| Metric | Count |")
    lines.append("|--------|-------|")
    lines.append(f"| Skills scanned | {len(scanned)} |")
    lines.append(f"| 🔴 HIGH/CRITICAL (score > {threshold}) | {high_critical} |")
    lines.append(f"| 🟡 MEDIUM | {sev_counts['MEDIUM']} |")
    lines.append(f"| 🟢 LOW / clean | {sev_counts['LOW']} |")
    if errors:
        lines.append(f"| ⚠️ Scan errors | {len(errors)} |")
    lines.append("")

    suppressed = sum(r.get("suppressed_count", 0) for r in scanned)
    if suppressed:
        lines.append(f"Reviewed exact finding exceptions: **{suppressed}**. Full evidence and reasons are retained in the JSON artifact.")
        lines.append("")

    if flagged:
        lines.append("### 🔴 Flagged skills")
        lines.append("")
        lines.append("| Skill | Score | Severity | Recommendation | Issues | Top findings |")
        lines.append("|-------|-------|----------|----------------|--------|--------------|")
        for r in flagged[:30]:
            top_rules = ", ".join(
                sorted({str(i.get("rule_id") or "?") for i in r.get("issues", [])})[:5]
            )
            rec = str(r.get("recommendation", "")).replace("_", " ")
            lines.append(
                f"| `{r['name']}` | {r['score']}/100 | "
                f"{_severity_emoji(r['severity'])} {r['severity']} | {rec} | "
                f"{len(r.get('issues', []))} | {top_rules} |"
            )
        if len(flagged) > 30:
            lines.append("")
            lines.append(f"_...and {len(flagged) - 30} more flagged skill(s)._")
        lines.append("")

    if errors:
        lines.append("### ⚠️ Scan errors")
        lines.append("")
        for r in errors[:10]:
            lines.append(f"- `{r['path']}` — {r.get('error', 'unknown error')}")
        if len(errors) > 10:
            lines.append(f"- _...and {len(errors) - 10} more._")
        lines.append("")

    if not flagged and not errors:
        lines.append("No HIGH/CRITICAL findings. ✅")
        lines.append("")

    lines.append("---")
    lines.append(
        "_Generated by SkillSpector. Score bands: 0-20 LOW, 21-50 MEDIUM, "
        "51-80 HIGH, 81-100 CRITICAL._"
    )

    text = "\n".join(lines)
    if len(text) > MAX_COMMENT_CHARS:
        text = text[: MAX_COMMENT_CHARS - 200] + "\n\n_...report truncated (too long)._"
    return text


def _write_output(name: str, value: str) -> None:
    """Append a key=value pair to $GITHUB_OUTPUT (no-op if unset)."""
    out_path = os.environ.get("GITHUB_OUTPUT")
    if not out_path:
        return
    with open(out_path, "a", encoding="utf-8") as fh:
        if "\n" in value:
            fh.write(f"{name}<<__EOF__\n{value}\n__EOF__\n")
        else:
            fh.write(f"{name}={value}\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Batch SkillSpector scanner.")
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--all", action="store_true", help="Scan every skill dir.")
    scope.add_argument(
        "--changed", action="store_true", help="Scan only skills changed vs --base-ref."
    )
    parser.add_argument("--base-ref", default="origin/main", help="Base ref for --changed.")
    parser.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD)
    parser.add_argument(
        "--fail-on-risk",
        action="store_true",
        help="Set output failed=true (and exit 1) if any skill exceeds threshold.",
    )
    parser.add_argument("--output-md", default="skillspector-report.md")
    parser.add_argument("--output-sarif", default="skillspector.sarif")
    parser.add_argument(
        "--dry-run", action="store_true", help="List discovered skills without scanning."
    )
    args = parser.parse_args()

    if args.changed:
        skills = discover_changed_skills(args.base_ref)
    else:
        skills = discover_all_skills()

    print(f"Discovered {len(skills)} skill director{'y' if len(skills) == 1 else 'ies'}.")

    if args.dry_run:
        for s in skills:
            print(f"  {s}")
        return 0

    if not skills:
        # Nothing to scan is a pass.
        Path(args.output_md).write_text(
            f"{COMMENT_MARKER}\n## 🎉 SkillSpector Security Scan\n\n"
            "No skill components were changed in this PR.\n",
            encoding="utf-8",
        )
        Path(args.output_sarif).write_text(json.dumps(_aggregate_sarif([]), indent=2))
        _write_output("scanned", "0")
        _write_output("high_critical_count", "0")
        _write_output("errors", "0")
        _write_output("failed", "false")
        return 0

    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=1) as pool:
        for idx, result in enumerate(pool.map(scan_skill, skills), 1):
            print(f"[{idx}/{len(skills)}] scanned {result['path']}", flush=True)
            results.append(result)

    scanned = [r for r in results if r.get("status") == "ok"]
    errors = [r for r in results if r.get("status") == "error"]
    flagged = [r for r in scanned if r["score"] > args.threshold]

    markdown = build_markdown(results, args.threshold)
    Path(args.output_md).write_text(markdown, encoding="utf-8")
    Path(args.output_sarif).write_text(
        json.dumps(_aggregate_sarif(results, args.threshold), indent=2), encoding="utf-8"
    )

    Path(args.output_md).with_suffix(".json").write_text(json.dumps(results, indent=2), encoding="utf-8")

    print(
        f"Scanned={len(scanned)} flagged={len(flagged)} errors={len(errors)} "
        f"(threshold={args.threshold})"
    )

    failed = bool(errors) or (bool(flagged) and args.fail_on_risk)
    _write_output("scanned", str(len(scanned)))
    _write_output("high_critical_count", str(len(flagged)))
    _write_output("errors", str(len(errors)))
    _write_output("failed", "true" if failed else "false")

    if failed:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
