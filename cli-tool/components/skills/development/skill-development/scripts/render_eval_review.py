import argparse
import html
import json
import re
from pathlib import Path


def render_eval_review(items, name, description):
    if not isinstance(items, list) or any(not isinstance(item, dict) or not isinstance(item.get("query"), str) or not isinstance(item.get("should_trigger"), bool) for item in items):
        raise ValueError("Eval items require string query and boolean should_trigger")
    template = (Path(__file__).resolve().parent.parent / "assets/eval_review.html").read_text()
    data = json.dumps(items, ensure_ascii=True).replace("<", "\\u003c")
    replacements = {"__EVAL_DATA_PLACEHOLDER__": data, "__SKILL_NAME_PLACEHOLDER__": html.escape(name, quote=True), "__SKILL_DESCRIPTION_PLACEHOLDER__": html.escape(description, quote=True)}
    return re.sub(r"__(?:EVAL_DATA|SKILL_NAME|SKILL_DESCRIPTION)_PLACEHOLDER__", lambda match: replacements[match.group(0)], template)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--description", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(render_eval_review(json.loads(args.data.read_text()), args.name, args.description))


if __name__ == "__main__":
    main()
