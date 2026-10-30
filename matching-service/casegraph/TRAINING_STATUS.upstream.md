# Fine-tuning status and limitations

## What is included

`train_finetune.py` is a reproducible supervised fine-tuning pipeline for the existing multilingual MiniLM sentence-transformer. It uses only the supplied synthetic `dev` split, separates entire scenario groups into training and validation partitions, and never loads the held-out `test` split for optimization. It writes a model directory and a provenance manifest.

## What is NOT completed in this ZIP

No fine-tuned model weights are included. The uploaded project did not include the base model snapshot, and this environment cannot establish access to the Hugging Face model cache or download model weights. Therefore no training run was executed and no trained artifact or new accuracy claim is supplied.

The supplied dataset has only 88 synthetic pairs across 22 scenario groups. The existing labels are synthetic/manual labels, not verified AICTE complaint judgments. Fine-tuning on this small dataset is only an engineering demonstration and can overfit. It is not sufficient to claim AICTE-specific training or production accuracy.

## Run on a machine with the model cached

From the repository root:

```bash
python -m pip install -r matching-service/requirements.txt
HF_HOME=matching-service/.cache/huggingface python matching-service/train_finetune.py
```

The script defaults to local-only model loading. If the model is not cached, it stops rather than downloading. To explicitly permit a Hugging Face download, use:

```bash
python matching-service/train_finetune.py --allow-download
```

Use the output model only for isolated experiments until it is evaluated on a larger, independently labelled dataset. The test split must remain untouched until final evaluation. Do not report metrics from the same examples used for training.

## What is needed for a defensible AICTE model

1. Obtain authorization to use complaint text.
2. Build a substantially larger dataset of complaint pairs, with expert judgments for `related` / `unrelated` and reasons.
3. Include hard negatives (same institution but different issues) and cross-bureau paraphrases.
4. Have independent reviewers adjudicate disagreements, including relevant Indian-language examples.
5. Split by institution and scenario so near-duplicates cannot leak across train/validation/test.
6. Fine-tune using the training split, select thresholds on validation only, and report final metrics once on untouched test data.
7. Keep human review mandatory; similarity is not proof of duplication.
