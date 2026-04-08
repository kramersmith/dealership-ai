from __future__ import annotations

import re

# Pre-tool teaser phrases: model often stops at tool_use after these; continuation must deliver substance.
_SUBSTANTIVE_FOLLOWUP_TEASE = re.compile(
    r"(?:"
    r"\blet me (?:break (?:it )?down|explain|walk (?:you )?through)\b"
    r"|\bi(?:'|’)ll (?:break (?:it )?down|walk (?:you )?through|explain)\b"
    r"|\bhere(?:'|’)?s what (?:that|this) means\b"
    r"|\bquick (?:breakdown|take)\b"
    r"|\bbreaking (?:it )?down (?:for you)?\b"
    r"|\bwalk(?:ing)? (?:you )?through (?:it|this)\b"
    r")",
    re.IGNORECASE,
)

_MAX_TEASER_ONLY_CHARS = 450


def promises_substantive_followup_after_tools(visible_pre_tool_text: str) -> bool:
    """True when visible prose before tools teased analysis the model must finish after tools.

    Used to detect empty/too-short continuation turns after set_vehicle / deal extraction.
    """
    stripped_text = visible_pre_tool_text.strip()
    if len(stripped_text) > _MAX_TEASER_ONLY_CHARS:
        return False
    return bool(_SUBSTANTIVE_FOLLOWUP_TEASE.search(stripped_text))


# Thresholds for strip_redundant_continuation_opener overlap detection
_MIN_TEXT_CHARS = 50  # Minimum char length for prior/continuation to attempt dedupe
_MIN_PARAGRAPH_CHARS = 40  # Min chars for paragraph comparison
_MIN_WORD_TOKENS = 8  # Minimum word tokens in continuation paragraph for overlap check
_MAX_OVERLAP_WINDOW = 48  # Maximum word tokens to compare in prefix-match window
_MIN_MATCHING_PREFIX = 6  # Required matching prefix length (word tokens) to strip


def normalize_step_text_for_dedupe(text: str) -> str:
    """Normalize whitespace so identical step prose can be compared reliably."""
    return " ".join(text.split())


def _word_tokens_for_overlap(text: str) -> list[str]:
    """Lowercase word tokens for comparing opener overlap across steps."""
    return re.findall(r"[a-z0-9]+(?:'[a-z]+)?", text.lower())


def strip_redundant_continuation_opener(
    prior_assistant_text: str, continuation: str
) -> str:
    """Drop continuation's first paragraph when it re-opens like the prior step.

    Sonnet often repeats a short opener after tools; the buyer already
    read the pre-tool text.
    """
    prior = prior_assistant_text.strip()
    cont = continuation.strip()
    if len(prior) < _MIN_TEXT_CHARS or len(cont) < _MIN_TEXT_CHARS:
        return continuation
    prior_first = prior.split("\n\n", 1)[0].strip()
    if len(prior_first) < _MIN_PARAGRAPH_CHARS:
        return continuation
    split_parts = re.split(r"\n\s*\n", cont, maxsplit=1)
    first_para = split_parts[0].strip()
    rest = split_parts[1].strip() if len(split_parts) > 1 else ""
    if len(first_para) < _MIN_PARAGRAPH_CHARS or not rest:
        return continuation
    prior_words = _word_tokens_for_overlap(prior_first)
    continuation_words = _word_tokens_for_overlap(first_para)
    if len(continuation_words) < _MIN_WORD_TOKENS:
        return continuation
    matching_prefix_len = 0
    max_compare = min(len(prior_words), len(continuation_words), _MAX_OVERLAP_WINDOW)
    while (
        matching_prefix_len < max_compare
        and prior_words[matching_prefix_len] == continuation_words[matching_prefix_len]
    ):
        matching_prefix_len += 1
    if matching_prefix_len < _MIN_MATCHING_PREFIX:
        return continuation
    return rest
