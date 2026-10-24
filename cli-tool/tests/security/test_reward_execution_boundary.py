import importlib.util
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[3] / "cli-tool/components/skills/ai-research/post-training-grpo-rl-training/examples/reward_functions_library.py"
spec = importlib.util.spec_from_file_location("reward_library", SOURCE)
library = importlib.util.module_from_spec(spec)
spec.loader.exec_module(library)


class RewardExecutionBoundary(unittest.TestCase):
    def test_unconfigured_runner_cannot_execute_generated_code(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "executed"
            code = f"open({str(marker)!r}, 'w').write('executed')"
            with self.assertRaises(ValueError):
                library.run_test_cases(code, [])
            self.assertFalse(marker.exists())

    def test_reward_requires_runner_before_scoring(self):
        with self.assertRaises(ValueError):
            library.code_execution_reward([], [], [])

    def test_reward_delegates_and_retains_pass_fail_scores(self):
        completions = [[{"content": "```python\nsolution = 42\n```"}]]
        calls = []
        def runner(code, cases):
            calls.append((code, cases))
            return True
        self.assertEqual(library.code_execution_reward([], completions, [(1, 2)], sandbox_runner=runner), [2.0])
        self.assertEqual(calls, [("solution = 42", [(1, 2)])])
        self.assertEqual(library.code_execution_reward([], completions, [], sandbox_runner=lambda *_: False), [0.0])

    def test_combined_reward_preserves_runner_and_syntax_scoring(self):
        completions = [[{"content": "```python\nsolution = 42\n```"}]]
        self.assertEqual(library.code_generation_reward([], completions, [], sandbox_runner=lambda *_: True), [2.7])
        invalid = [[{"content": "```python\ndef broken(\n```"}]]
        self.assertEqual(library.no_syntax_error_reward(invalid), [0.0])

    def test_nonboolean_completion_is_rejected(self):
        with self.assertRaises(TypeError):
            library.run_test_cases("unused", [], sandbox_runner=lambda *_: {"passed": True})


if __name__ == "__main__":
    unittest.main()
