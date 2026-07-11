from titles import extract_title, resolve_title


def test_h1_on_first_line():
    assert extract_title("# My Awesome Note\nsome body") == "My Awesome Note"


def test_resolve_keeps_explicit_title():
    assert resolve_title("My Custom Title", "# Heading\nbody") == "My Custom Title"


def test_resolve_trims_explicit_title():
    assert resolve_title("  Spaced  ", "# Heading") == "Spaced"


def test_resolve_falls_back_when_title_none():
    assert resolve_title(None, "# Derived Heading\nbody") == "Derived Heading"


def test_resolve_falls_back_when_title_blank():
    assert resolve_title("   ", "# Derived Heading") == "Derived Heading"


def test_first_heading_is_deeper_level():
    assert extract_title("## Subheading first\nbody") == "Subheading first"


def test_heading_after_body_text():
    content = "Just some intro text\n\n# The Real Heading\nmore body"
    assert extract_title(content) == "The Real Heading"


def test_no_heading_falls_back_to_first_nonempty_line():
    assert extract_title("\n\nplain body text\nsecond line") == "plain body text"


def test_empty_input_returns_placeholder():
    assert extract_title("   \n\t\n") == "(bez názvu)"


def test_trailing_closing_hashes_stripped():
    assert extract_title("## Centered Title ##\nbody") == "Centered Title"


def test_bold_stripped_to_plain_text():
    assert extract_title("**eeeeeeeee**") == "eeeeeeeee"


def test_italic_stripped_to_plain_text():
    assert extract_title("*sdff*") == "sdff"


def test_bold_italic_stripped_to_plain_text():
    assert extract_title("***loud***") == "loud"


def test_link_reduced_to_its_text():
    assert extract_title("[sdffd](sdfs)") == "sdffd"


def test_inline_code_stripped():
    assert extract_title("`code`") == "code"


def test_heading_with_formatting_stripped():
    assert extract_title("# My **Awesome** Note") == "My Awesome Note"


def test_invalid_link_syntax_left_alone():
    assert extract_title("(sdfs)[ss]") == "(sdfs)[ss]"
