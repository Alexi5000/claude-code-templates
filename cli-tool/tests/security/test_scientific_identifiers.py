import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[2] / 'components/skills/scientific'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


Citation = load('citation', 'citation-management/scripts/extract_metadata.py').MetadataExtractor
BioRxiv = load('biorxiv', 'biorxiv-database/scripts/biorxiv_search.py').BioRxivSearcher


class ScientificIdentifiers(unittest.TestCase):
    def test_supported_citation_urls(self):
        extractor = Citation()
        for url, expected in [
            ('https://doi.org/10.1101/paper', ('doi', '10.1101/paper')),
            ('https://DX.DOI.ORG/10.1101/paper', ('doi', '10.1101/paper')),
            ('https://pubmed.ncbi.nlm.nih.gov/12345678/', ('pmid', '12345678')),
            ('https://www.ncbi.nlm.nih.gov/pubmed/12345678', ('pmid', '12345678')),
            ('https://arxiv.org/abs/2401.12345', ('arxiv', '2401.12345')),
            ('https://www.arxiv.org/abs/2401.12345', ('arxiv', '2401.12345')),
        ]:
            with self.subTest(url=url):
                self.assertEqual(extractor.identify_type(url), expected)

    def test_lookalike_and_userinfo_urls_are_not_trusted(self):
        extractor = Citation()
        for url in [
            'https://doi.org.attacker.test/not-a-doi',
            'https://notdoi.org/not-a-doi',
            'https://doi.org@attacker.test/not-a-doi',
            'https://pubmed.ncbi.nlm.nih.gov.attacker.test/12345678',
            'https://attacker.test/ncbi.nlm.nih.gov/pubmed/12345678',
            'https://ncbi.nlm.nih.gov/notpubmed/12345678',
            'https://arxiv.org.attacker.test/abs/2401.12345',
            'https://arxiv.org@attacker.test/abs/2401.12345',
        ]:
            with self.subTest(url=url):
                self.assertEqual(extractor.identify_type(url), ('url', url))

    def test_biorxiv_accepts_bare_and_canonical_doi(self):
        searcher = BioRxiv()
        searcher._make_request = Mock(return_value={'collection': [{'title': 'paper'}]})
        for doi in ['10.1101/paper', 'https://doi.org/10.1101/paper', 'https://DX.DOI.ORG/10.1101/paper']:
            self.assertEqual(searcher.get_paper_details(doi), {'title': 'paper'})
            searcher._make_request.assert_called_with('details/biorxiv/10.1101/paper')

    def test_invalid_doi_urls_never_request_or_write(self):
        searcher = BioRxiv()
        searcher._make_request = Mock()
        searcher.session.get = Mock()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'paper.pdf'
            target.write_bytes(b'existing')
            for doi in ['https://doi.org.attacker.test/10.1101/paper', 'https://doi.org@attacker.test/10.1101/paper', 'https://attacker.test/doi.org/10.1101/paper', 'https://doi.org/', '10.1101/']:
                with self.subTest(doi=doi):
                    with self.assertRaises(ValueError):
                        searcher.get_paper_details(doi)
                    with self.assertRaises(ValueError):
                        searcher.download_pdf(doi, str(target))
                    self.assertEqual(target.read_bytes(), b'existing')
        searcher._make_request.assert_not_called()
        searcher.session.get.assert_not_called()

    def test_pdf_download_keeps_canonical_endpoint(self):
        searcher = BioRxiv()
        searcher.session.get = Mock(return_value=Mock(content=b'%PDF-test'))
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'paper.pdf'
            self.assertTrue(searcher.download_pdf('https://doi.org/10.1101/paper', str(target)))
            self.assertEqual(target.read_bytes(), b'%PDF-test')
        searcher.session.get.assert_called_once_with('https://www.biorxiv.org/content/10.1101/paperv1.full.pdf', timeout=60)


if __name__ == '__main__':
    unittest.main()
