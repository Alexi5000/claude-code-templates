import re


def is_notebooklm_url(url: str) -> bool:
    return isinstance(url, str) and re.fullmatch(
        r"https://notebooklm\.google\.com(?::443)?(?:[/?#][^\s\\]*)?",
        url,
        re.IGNORECASE | re.ASCII,
    ) is not None
