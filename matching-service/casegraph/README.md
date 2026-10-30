# CaseGraph MiniLM inference service

This directory contains only the inference components adapted from the user-provided `casegraph-ai-complete.zip` (`matching-service/inference.py`, `matching-service/api.py`, and its `requirements.txt`). The API addition is bearer-key authentication for server-to-server calls. No CaseGraph UI, fixture data, evaluation dataset, or training pipeline is included.

## Model and provenance

The service uses the pretrained Hugging Face model `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`. The upstream archive's `TRAINING_STATUS.md` confirms no fine-tuned weights or completed training run were included. The service encodes the supplied original text with Sentence Transformers, L2-normalizes embeddings, and ranks every distinct pair with cosine similarity. A score is not a duplicate probability. The upstream inference module performs input validation and does not implement additional linguistic preprocessing.

The model card identifies the model license as Apache-2.0 ([model card](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)). The supplied archive did not include an explicit license file for the CaseGraph source itself. The original project's owner should be consulted for licensing and attribution approval before redistribution or production use. This project retains the upstream project and source-path attribution above; it does not claim ownership or grant a license.

## Local start

Use Python 3.11 or 3.12 in an isolated environment. Install the listed dependencies and ensure the model snapshot has already been cached in Hugging Face's cache. The loader is intentionally offline-only and never downloads model weights at service startup.

```sh
python -m venv .venv-casegraph
. .venv-casegraph/bin/activate
python -m pip install -r matching-service/casegraph/requirements.txt
export HF_HOME="$PWD/matching-service/casegraph/model-cache"
export CASEGRAPH_API_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
uvicorn api:app --app-dir matching-service/casegraph --host 127.0.0.1 --port 8001
```

The model snapshot must be cached manually before startup. Its upstream identifier is available in `inference.py`; use an approved machine and preserve the Hugging Face model's license/terms. Do not start this service on a publicly reachable interface until HTTPS termination and network restrictions are configured. For local end-to-end integration, configure the AICTE server `.env.local` with `CASEGRAPH_MATCHING_URL=http://127.0.0.1:8001`, the same `CASEGRAPH_API_KEY`, `AI_EXTERNAL_COMPLAINT_TEXT_APPROVED=true`, and the existing Supabase server credentials. Localhost is only for local development; use the public HTTPS service URL in Vercel.

To deliberately seed the model cache once (this is the only step that contacts Hugging Face), run this manually before starting the offline-only service:

```sh
HF_HOME="$PWD/matching-service/casegraph/model-cache" python -c 'from huggingface_hub import snapshot_download; print(snapshot_download("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2", local_files_only=False))'
```

## Deployment boundary

The AICTE Vercel function calls `/api/v1/matches` over HTTPS using `CASEGRAPH_MATCHING_URL` and `CASEGRAPH_API_KEY`, both server-only. The CaseGraph service has no Supabase access and stores no complaint data. Only text selected and redacted after the caller's Supabase RLS/role authorization is transmitted. Configure `AI_EXTERNAL_COMPLAINT_TEXT_APPROVED=true` only after the data owner authorizes the external processor and the signed-in official confirms the per-run disclosure.

Vercel does not host this Python model process. A separate Python host must be configured manually, with CPU/RAM sufficient for PyTorch and MiniLM and the model cache available at runtime. Free instances may sleep, lack persistent disk, impose request/CPU limits, or lack enough memory; the first request may time out while a sleeping host wakes. No provider has been selected or provisioned here, and production integration is unverified. If unavailable, the endpoint fails without changing suggestions; the existing rule-based matching flow remains available.

## Model limitations

The model is pretrained, not trained on AICTE complaint records. Similarity has not been calibrated or validated against expert-labeled AICTE examples. Scores identify candidates for official review only; they do not confirm duplicates or alter complaint workflow state. The upstream model service accepts at most 40 texts per request. Its health endpoint reports readiness only and does not disclose secrets.
