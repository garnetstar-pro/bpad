import re

_HEADING_RE = re.compile(r"^\s*#{1,6}\s+(.*?)\s*#*\s*$")

_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_CODE_RE = re.compile(r"`([^`]+)`")
_EMPHASIS_RE = re.compile(r"(\*\*\*|\*\*|\*|___|__|_)(.+?)\1")
_STRIKE_RE = re.compile(r"~~(.+?)~~")


def _strip_inline_markdown(text: str) -> str:
    """Reduce inline Markdown to plain text (bold, italic, links, code, ...)."""
    text = _IMAGE_RE.sub(r"\1", text)
    text = _LINK_RE.sub(r"\1", text)
    text = _CODE_RE.sub(r"\1", text)
    text = _EMPHASIS_RE.sub(r"\2", text)
    text = _STRIKE_RE.sub(r"\1", text)
    return text.strip()


def extract_title(content: str) -> str:
    """Derive a plain-text note title from Markdown text.

    Returns the text of the first ATX heading (``#`` .. ``######``). If there is
    no heading, falls back to the first non-empty line. Inline formatting (bold,
    italic, links, code) is stripped to plain text. If the text is empty or only
    whitespace, returns a placeholder.
    """
    lines = content.splitlines()

    for line in lines:
        match = _HEADING_RE.match(line)
        if match:
            return _strip_inline_markdown(match.group(1))

    for line in lines:
        if line.strip():
            return _strip_inline_markdown(line)

    return "(bez názvu)"
