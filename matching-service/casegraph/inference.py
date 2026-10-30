"""Local-only multilingual sentence embedding matching for arbitrary complaint text."""

from __future__ import annotations

import hashlib
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

ROOT = Path(__file__).resolve().parent
MODEL_ID = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
SCORE_TYPE = "cosine_similarity"
SCORE_SEMANTICS = "Cosine similarity between L2-normalized multilingual sentence embeddings; not a probability or confidence."
MIN_COMPLAINTS = 2
MAX_COMPLAINTS = 40
MAX_ID_LENGTH = 128
MAX_TEXT_LENGTH = 8_000
MAX_REQUEST_BYTES = 2 * 1024 * 1024
ENCODE_BATCH_SIZE = 16


class InputValidationError(ValueError):
    """Raised when a complaint batch or similarity threshold is invalid."""


class ModelUnavailableError(RuntimeError):
    """Raised when the configured model is not available in the local cache."""


@dataclass(frozen=True)
class ComplaintText:
    id: str
    original_text: str


@dataclass(frozen=True)
class SemanticMatch:
    pair_id: str
    complaint_a_id: str
    complaint_b_id: str
    similarity: float


def validate_threshold(threshold: object) -> float:
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)):
        raise InputValidationError("threshold must be a number between -1 and 1.")
    value = float(threshold)
    if not math.isfinite(value) or not -1.0 <= value <= 1.0:
        raise InputValidationError("threshold must be a finite number between -1 and 1.")
    return value


def validate_complaints(records: object) -> list[ComplaintText]:
    if not isinstance(records, Sequence) or isinstance(records, (str, bytes, bytearray)):
        raise InputValidationError("complaints must be a list of complaint records.")
    if not MIN_COMPLAINTS <= len(records) <= MAX_COMPLAINTS:
        raise InputValidationError(f"complaints must contain between {MIN_COMPLAINTS} and {MAX_COMPLAINTS} records.")

    complaints: list[ComplaintText] = []
    seen_ids: set[str] = set()
    request_bytes = 0
    for index, record in enumerate(records, start=1):
        if isinstance(record, ComplaintText):
            complaint_id, original_text = record.id, record.original_text
        elif isinstance(record, Mapping):
            if set(record) != {"id", "original_text"}:
                raise InputValidationError(f"complaint {index} must contain exactly id and original_text.")
            complaint_id, original_text = record.get("id"), record.get("original_text")
        else:
            raise InputValidationError(f"complaint {index} must be an object with id and original_text.")

        if not isinstance(complaint_id, str) or not complaint_id.strip() or len(complaint_id) > MAX_ID_LENGTH:
            raise InputValidationError(f"complaint {index} id must be a non-blank string of at most {MAX_ID_LENGTH} characters.")
        if complaint_id in seen_ids:
            raise InputValidationError(f"complaint IDs must be unique; duplicate ID at record {index}.")
        if not isinstance(original_text, str) or not original_text.strip() or len(original_text) > MAX_TEXT_LENGTH:
            raise InputValidationError(f"complaint {index} original_text must be non-blank and at most {MAX_TEXT_LENGTH} characters.")

        request_bytes += len(complaint_id.encode("utf-8")) + len(original_text.encode("utf-8"))
        if request_bytes > MAX_REQUEST_BYTES:
            raise InputValidationError(f"complaint text exceeds the {MAX_REQUEST_BYTES}-byte request limit.")
        seen_ids.add(complaint_id)
        complaints.append(ComplaintText(complaint_id, original_text))

    return sorted(complaints, key=lambda complaint: complaint.id)


def stable_pair_id(complaint_a_id: str, complaint_b_id: str) -> str:
    """Create an input-order-independent SHA-256 pair key from two distinct IDs."""
    if complaint_a_id == complaint_b_id:
        raise InputValidationError("a complaint cannot be matched with itself.")
    first, second = sorted((complaint_a_id, complaint_b_id))
    first_bytes, second_bytes = first.encode("utf-8"), second.encode("utf-8")
    material = len(first_bytes).to_bytes(4, "big") + first_bytes + len(second_bytes).to_bytes(4, "big") + second_bytes
    return hashlib.sha256(material).hexdigest()


def _vector_values(vector: Any) -> tuple[float, ...]:
    values = vector.tolist() if hasattr(vector, "tolist") else vector
    if not isinstance(values, Sequence) or isinstance(values, (str, bytes, bytearray)):
        raise ValueError("embedding must be a one-dimensional numeric vector.")
    try:
        result = tuple(float(value) for value in values)
    except (TypeError, ValueError) as error:
        raise ValueError("embedding must contain only numeric values.") from error
    if not result or not all(math.isfinite(value) for value in result):
        raise ValueError("embedding must be non-empty and finite.")
    return result


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    """Compute cosine similarity, returning zero when either vector has zero norm."""
    left_values, right_values = _vector_values(left), _vector_values(right)
    if len(left_values) != len(right_values):
        raise ValueError("embedding dimensions do not match.")
    left_norm = math.sqrt(math.fsum(value * value for value in left_values))
    right_norm = math.sqrt(math.fsum(value * value for value in right_values))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    dot = math.fsum(a * b for a, b in zip(left_values, right_values))
    return max(-1.0, min(1.0, dot / (left_norm * right_norm)))


class LocalSemanticMatcher:
    """Score every distinct complaint pair with one already-loaded local encoder."""

    def __init__(self, encoder: Any, model_id: str = MODEL_ID) -> None:
        self._encoder = encoder
        self.model_id = model_id

    def match(self, records: object, threshold: object) -> list[SemanticMatch]:
        complaints = validate_complaints(records)
        min_score = validate_threshold(threshold)
        texts = [complaint.original_text for complaint in complaints]
        embeddings = self._encoder.encode(
            texts,
            batch_size=min(ENCODE_BATCH_SIZE, len(texts)),
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        if len(embeddings) != len(complaints):
            raise RuntimeError("model returned an unexpected number of embeddings.")

        matches: list[SemanticMatch] = []
        for left_index, left in enumerate(complaints):
            for right_index in range(left_index + 1, len(complaints)):
                right = complaints[right_index]
                score = cosine_similarity(embeddings[left_index], embeddings[right_index])
                if score >= min_score:
                    matches.append(SemanticMatch(
                        pair_id=stable_pair_id(left.id, right.id),
                        complaint_a_id=left.id,
                        complaint_b_id=right.id,
                        similarity=score,
                    ))
        return sorted(matches, key=lambda match: (-match.similarity, match.pair_id))


def load_local_matcher(
    *,
    snapshot_resolver: Any | None = None,
    encoder_factory: Any | None = None,
) -> LocalSemanticMatcher:
    """Load MiniLM from the local Hugging Face cache only; never download weights."""
    os.environ.setdefault("HF_HOME", str(ROOT / ".cache" / "huggingface"))
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

    if snapshot_resolver is None:
        try:
            from huggingface_hub import snapshot_download
        except ImportError as error:
            raise ModelUnavailableError("huggingface_hub is unavailable; install matching-service requirements manually.") from error
        snapshot_resolver = snapshot_download
    if encoder_factory is None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as error:
            raise ModelUnavailableError("sentence-transformers is unavailable; install matching-service requirements manually.") from error
        encoder_factory = SentenceTransformer

    try:
        model_path = snapshot_resolver(MODEL_ID, local_files_only=True)
    except Exception as error:
        # The local-only resolver is deliberately fail-closed; no retry or network fallback occurs.
        raise ModelUnavailableError(
            f"{MODEL_ID} is not available in the local model cache. Cache it manually before starting the service; automatic downloads are disabled."
        ) from error

    try:
        encoder = encoder_factory(str(model_path), device="cpu", local_files_only=True)
    except Exception as error:
        raise ModelUnavailableError(
            f"{MODEL_ID} could not be loaded from the local cache; automatic downloads are disabled."
        ) from error
    return LocalSemanticMatcher(encoder)
