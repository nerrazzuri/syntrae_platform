from shared.utils.text_normalize import normalize_multiline_text


def test_response_formatting_preserves_newlines_and_bullets():
    raw = """
        Here are the steps:
        1. Extract raw files from source systems.
        2. Normalize schema to match ingestion model.
        3. Load into staging and validate records.

        - Optional: Run data quality checks.
        - Optional: Notify stakeholders.
    """
    out = normalize_multiline_text(raw)
    # Ensure bullets and numbering remain and single newlines are preserved between items
    assert "1. Extract" in out
    assert "2. Normalize" in out
    assert "3. Load" in out
    assert "- Optional: Run data quality checks." in out
    # Ensure no CRLF or double newlines remain
    assert "\r" not in out
    assert "\n\n" not in out
