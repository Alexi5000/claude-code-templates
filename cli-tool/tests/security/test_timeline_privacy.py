import contextlib
import importlib.util
import io
import os
from pathlib import Path
import stat
import tempfile
import unittest

SOURCE = Path(__file__).parents[2] / 'components/skills/scientific/treatment-plans/scripts/timeline_generator.py'
spec = importlib.util.spec_from_file_location('timeline_generator', SOURCE)
timeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(timeline)


class TimelinePrivacyTests(unittest.TestCase):
    def setUp(self):
        self.data = {'phases': [('Week 1-4', 'synthetic private treatment marker')],
                     'appointments': [], 'milestones': []}

    def test_returned_text_is_not_logged(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = timeline.create_text_timeline(self.data)
        self.assertIn('synthetic private treatment marker', result)
        self.assertEqual(output.getvalue(), '')

    def test_private_file_with_permissive_umask_and_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'patient-name.txt'
            for existing in (False, True):
                if existing:
                    target.chmod(0o666)
                old_mask = os.umask(0)
                output = io.StringIO()
                try:
                    with contextlib.redirect_stdout(output):
                        result = timeline.create_text_timeline(self.data, target)
                finally:
                    os.umask(old_mask)
                self.assertEqual(target.read_text(), result)
                self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
                self.assertNotIn('synthetic private', output.getvalue())
                self.assertNotIn('patient-name', output.getvalue())

    def test_symlink_destination_does_not_modify_target(self):
        with tempfile.TemporaryDirectory() as directory:
            victim = Path(directory) / 'victim'
            victim.write_text('keep')
            target = Path(directory) / 'timeline.txt'
            target.symlink_to(victim)
            with contextlib.redirect_stdout(io.StringIO()):
                timeline.create_text_timeline(self.data, target)
            self.assertEqual(victim.read_text(), 'keep')
            self.assertFalse(target.is_symlink())
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)

    def test_failed_writer_preserves_existing_output_and_removes_temporary(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'timeline.txt'
            target.write_text('keep')
            with self.assertRaises(RuntimeError):
                with timeline.private_output(target) as stream:
                    stream.write('partial confidential data')
                    raise RuntimeError('writer failure')
            self.assertEqual(target.read_text(), 'keep')
            self.assertEqual(list(Path(directory).iterdir()), [target])

    @unittest.skipUnless(timeline.HAS_MATPLOTLIB, 'matplotlib required for actual rendering')
    def test_visual_render_has_private_permissions_and_no_patient_log(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'patient-name.png'
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                timeline.create_visual_timeline(self.data, target, '2026-01-01')
            self.assertTrue(target.read_bytes().startswith(b'\x89PNG'))
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            self.assertNotIn('synthetic private', output.getvalue())
            self.assertNotIn('patient-name', output.getvalue())
            self.assertEqual(timeline.plt.get_fignums(), [])

    def test_binary_output_has_private_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'timeline.png'
            with timeline.private_output(target, binary=True) as stream:
                stream.write(b'visual output')
            self.assertEqual(target.read_bytes(), b'visual output')
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)


if __name__ == '__main__':
    unittest.main()
