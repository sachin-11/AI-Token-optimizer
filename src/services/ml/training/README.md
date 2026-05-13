# ML Training Scripts

## Setup

```bash
# Create a Python virtual environment (outside the Node project)
python -m venv .venv-ml
source .venv-ml/bin/activate   # Windows: .venv-ml\Scripts\activate

# Install dependencies
pip install -r src/services/ml/training/requirements.txt
```

## Check if you have enough data

```bash
python src/services/ml/training/train_mode_advisor.py --dry-run
```

Output tells you current row count and mode distribution.
**Minimum 100 rows recommended, 500+ for good accuracy.**

## Train the model

```bash
python src/services/ml/training/train_mode_advisor.py
```

This will:
1. Read `DATABASE_URL` from `.env.local`
2. Pull training data from `token_analytics` + `optimization_results`
3. Train a Gradient Boosting classifier (200 trees, depth 4)
4. Print cross-validation accuracy + classification report
5. Export model to `src/services/ml/models/mode-advisor.onnx`

## Deploy to Node.js

```bash
# Install the ONNX runtime (one-time)
npm install onnxruntime-node

# Restart dev server — model loads automatically
npm run dev
```

Look for this log line to confirm the model is active:
```
INFO: ModeAdvisor | ONNX mode advisor model loaded
```

## Retraining schedule

| Data size | Recommended retraining |
|---|---|
| < 500 rows | Monthly |
| 500 – 5,000 rows | Bi-weekly |
| > 5,000 rows | Weekly or on-demand |

## Feature schema (must match `mode-advisor.service.ts`)

| Index | Feature | Type |
|---|---|---|
| 0 | `token_count_norm` | float, 0-1 |
| 1 | `urgency_ordinal_norm` | float, 0-1 |
| 2-8 | `prompt_type_onehot[7]` | float 0/1 |
| 9 | `util_low` (< 50%) | float 0/1 |
| 10 | `util_mid` (50-80%) | float 0/1 |
| 11 | `util_high` (>= 80%) | float 0/1 |

**Total: 12 features**
