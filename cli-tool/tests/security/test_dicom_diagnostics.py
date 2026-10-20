import importlib.util
import io
import logging
import warnings
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, SecondaryCaptureImageStorage, generate_uid


SCRIPT = Path(__file__).resolve().parents[2] / "components/skills/scientific/pydicom/scripts/anonymize_dicom.py"
SPEC = importlib.util.spec_from_file_location("anonymize_dicom", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
SENTINEL = "PrivatePatient987"
PATIENT_NAME = "Replacement^Private"
PATIENT_ID = "ReplacementID987"


class DicomDiagnosticsTests(unittest.TestCase):
    def make_dicom(self, path):
        meta = FileMetaDataset()
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        meta.MediaStorageSOPClassUID = SecondaryCaptureImageStorage
        meta.MediaStorageSOPInstanceUID = generate_uid()
        dataset = FileDataset(str(path), {}, file_meta=meta, preamble=b"\0" * 128)
        dataset.PatientName = SENTINEL
        dataset.PatientID = SENTINEL
        dataset.PatientBirthDate = "19800101"
        dataset.PatientAddress = SENTINEL
        dataset.Modality = "OT"
        dataset.save_as(path, enforce_file_format=True)

    def run_cli(self, source, destination, *args):
        return subprocess.run(
            [sys.executable, str(SCRIPT), str(source), str(destination), *args],
            capture_output=True, text=True, timeout=15,
        )

    def assert_private(self, text):
        for value in (SENTINEL, PATIENT_NAME, PATIENT_ID):
            self.assertNotIn(value, text)

    def test_verbose_cli_preserves_replacements_without_logging_patient_data(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / f"{SENTINEL}.dcm"
            destination = Path(directory) / f"{SENTINEL}-out.dcm"
            self.make_dicom(source)
            result = self.run_cli(source, destination, "--verbose", "--patient-name", PATIENT_NAME, "--patient-id", PATIENT_ID)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assert_private(result.stdout + result.stderr)
            self.assertIn("PatientName: replaced", result.stdout)
            self.assertIn("PatientAddress: removed", result.stdout)
            dataset = pydicom.dcmread(destination)
            self.assertEqual(str(dataset.PatientName), PATIENT_NAME)
            self.assertEqual(dataset.PatientID, PATIENT_ID)
            self.assertEqual(dataset.PatientBirthDate, "19000101")
            self.assertFalse(hasattr(dataset, "PatientAddress"))
            self.assertEqual(dataset.Modality, "OT")

    def test_function_returns_metadata_only_and_default_replacements_work(self):
        with tempfile.TemporaryDirectory() as directory:
            source, destination = Path(directory) / "in.dcm", Path(directory) / "out.dcm"
            self.make_dicom(source)
            success, result = MODULE.anonymize_dicom(source, destination)
            self.assertTrue(success)
            self.assert_private(str(result))
            self.assertIn("PatientName: replaced", result)
            self.assertEqual(pydicom.dcmread(destination).PatientID, "ANONYMOUS")

    def test_missing_input_fails_without_logging_filename(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.run_cli(Path(directory) / f"{SENTINEL}.dcm", Path(directory) / "out.dcm")
            self.assertEqual(result.returncode, 1)
            self.assertIn("not found", result.stdout)
            self.assert_private(result.stdout + result.stderr)

    def test_missing_output_directory_fails_without_logging_exception_path(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "in.dcm"
            destination = Path(directory) / SENTINEL / "out.dcm"
            self.make_dicom(source)
            success, details = MODULE.anonymize_dicom(source, destination, PATIENT_ID, PATIENT_NAME)
            self.assertFalse(success)
            self.assert_private(details)
            result = self.run_cli(source, destination)
            self.assertEqual(result.returncode, 1)
            self.assert_private(result.stdout + result.stderr)
            self.assertFalse(destination.exists())

    def test_library_warnings_do_not_echo_malformed_patient_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            source, destination = Path(directory) / "in.dcm", Path(directory) / "out.dcm"
            self.make_dicom(source)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                dataset = pydicom.dcmread(source)
                dataset.SpecificCharacterSet = SENTINEL
                dataset.save_as(source)
            result = self.run_cli(source, destination, "--verbose")
            self.assertEqual(result.returncode, 0)
            self.assert_private(result.stdout + result.stderr)
            self.assertIn("DICOM processing warnings:", result.stdout)
            logs = io.StringIO()
            handler = logging.StreamHandler(logs)
            pydicom.config.logger.addHandler(handler)
            original_filters = list(pydicom.config.logger.filters)
            try:
                with warnings.catch_warnings(record=True) as leaked:
                    warnings.simplefilter("always")
                    success, details = MODULE.anonymize_dicom(source, destination)
                self.assertTrue(success)
                self.assertEqual(leaked, [])
                self.assert_private(str(details) + logs.getvalue())
                self.assertIn("details withheld", logs.getvalue())
                self.assertEqual(pydicom.config.logger.filters, original_filters)
            finally:
                pydicom.config.logger.removeHandler(handler)

    def test_invalid_dicom_fails_with_safe_status(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / f"{SENTINEL}.dcm"
            source.write_text(SENTINEL)
            result = self.run_cli(source, Path(directory) / "out.dcm")
            self.assertEqual(result.returncode, 1)
            self.assert_private(result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
