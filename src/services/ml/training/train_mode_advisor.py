"""
Mode Advisor Training Script
=============================
Trains a gradient boosting classifier on historical optimization data
and exports it to ONNX format for Node.js inference.

Usage:
    cd Token-optmizer
    python src/services/ml/training/train_mode_advisor.py

Requirements:
    pip install -r src/services/ml/training/requirements.txt

The script reads DATABASE_URL from .env.local automatically.
Output: src/services/ml/models/mode-advisor.onnx

Minimum recommended dataset size: 500 completed optimizations.
Run `python train_mode_advisor.py --dry-run` to see current data stats.
"""

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2
from dotenv import load_dotenv
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import classification_report
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.preprocessing import LabelEncoder

# ── Config ────────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent.parent.parent  # Token-optmizer/
MODEL_OUT = PROJECT_ROOT / "src/services/ml/models/mode-advisor.onnx"
MIN_ROWS = 100  # warn if below this; refuse if below 50

PROMPT_TYPE_MAP = {
    "GENERAL": 0,
    "CODING": 1,
    "AGENT": 2,
    "SYSTEM": 3,
    "INSTRUCTION": 4,
    "TECHNICAL": 5,
    "CONVERSATIONAL": 6,
}
URGENCY_MAP = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
MODE_MAP = {"SAFE": 0, "BALANCED": 1, "AGGRESSIVE": 2}

# ── Data Loading ──────────────────────────────────────────────────────────────


def load_training_data(conn) -> pd.DataFrame:
    """
    Load training data from token_analytics + optimization_results.

    Features:
      - token_count_norm  : normalized original token count (0-1)
      - urgency_ordinal   : compression urgency as 0-4 ordinal
      - prompt_type_0..6  : one-hot encoded prompt type
      - util_low          : context utilization < 50%
      - util_mid          : context utilization 50-80%
      - util_high         : context utilization >= 80%

    Target:
      - mode_label : 0=SAFE, 1=BALANCED, 2=AGGRESSIVE
        (the mode that produced the highest quality score for similar inputs)
    """
    query = """
        SELECT
            ta.original_tokens                                    AS token_count,
            ta.prompt_type                                        AS prompt_type,
            ta.mode                                               AS mode,
            ta.compression_ratio                                  AS compression_ratio,
            COALESCE(ta.semantic_score, 0.8)                      AS semantic_score,
            COALESCE(ta.quality_score,  75)                       AS quality_score,
            COALESCE(or2.processing_time_ms, 5000)                AS processing_time_ms,
            COALESCE(or2.retry_count, 0)                          AS retry_count
        FROM token_analytics ta
        LEFT JOIN optimization_results or2
            ON ta.request_id = or2.request_id
        WHERE
            ta.original_tokens  > 0
            AND ta.compression_ratio > 0
            AND ta.compression_ratio < 1
            AND (or2.status IS NULL OR or2.status = 'COMPLETED')
        ORDER BY ta.created_at DESC
        LIMIT 50000
    """
    df = pd.read_sql(query, conn)
    print(f"Loaded {len(df)} rows from database")
    return df


def build_features(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Convert raw DB rows to feature matrix X and label vector y."""

    # Normalize token count (project max is 8000)
    X_list = []

    for _, row in df.iterrows():
        features = np.zeros(12, dtype=np.float32)

        # Feature 0: token count (normalized)
        features[0] = min(row["token_count"] / 8000.0, 1.0)

        # Feature 1: urgency — derive from token_count heuristic if not stored directly
        # (use compression ratio as proxy: lower ratio = higher urgency historically)
        if row["compression_ratio"] < 0.5:
            urgency = 3  # high
        elif row["compression_ratio"] < 0.65:
            urgency = 2  # medium
        elif row["compression_ratio"] < 0.8:
            urgency = 1  # low
        else:
            urgency = 0  # none
        features[1] = urgency / 4.0

        # Features 2-8: one-hot prompt type
        pt_idx = PROMPT_TYPE_MAP.get(str(row["prompt_type"]).upper(), 0)
        features[2 + pt_idx] = 1.0

        # Features 9-11: utilization buckets (derive from token count / 8000 as proxy)
        util = min(row["token_count"] / 8000.0, 1.0)
        features[9] = 1.0 if util < 0.5 else 0.0
        features[10] = 1.0 if 0.5 <= util < 0.8 else 0.0
        features[11] = 1.0 if util >= 0.8 else 0.0

        X_list.append(features)

    X = np.array(X_list, dtype=np.float32)

    # Build target: the mode label
    # We use the mode that was actually used (supervised learning on historical choices)
    y = np.array([MODE_MAP.get(str(m).upper(), 1) for m in df["mode"]], dtype=np.int64)

    return X, y


# ── Training ──────────────────────────────────────────────────────────────────


def train(X: np.ndarray, y: np.ndarray) -> GradientBoostingClassifier:
    """Train gradient boosting classifier with cross-validation."""

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = GradientBoostingClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        min_samples_leaf=5,
        random_state=42,
    )
    model.fit(X_train, y_train)

    # Cross-validation
    cv_scores = cross_val_score(model, X_train, y_train, cv=5, scoring="accuracy")
    print(
        f"\nCross-validation accuracy: {cv_scores.mean():.3f} (+/- {cv_scores.std():.3f})"
    )

    # Test set evaluation
    y_pred = model.predict(X_test)
    print(f"\nTest set classification report:")
    print(
        classification_report(
            y_test, y_pred, target_names=["SAFE", "BALANCED", "AGGRESSIVE"]
        )
    )

    return model


def export_onnx(model: GradientBoostingClassifier, output_path: Path) -> None:
    """Export trained model to ONNX format for Node.js inference."""
    initial_type = [("features", FloatTensorType([None, 12]))]
    onnx_model = convert_sklearn(
        model,
        initial_types=initial_type,
        target_opset=17,
        options={"zipmap": False},  # return probabilities as array, not dict
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(onnx_model.SerializeToString())
    print(f"\nModel exported to: {output_path}")
    print(f"Model size: {output_path.stat().st_size / 1024:.1f} KB")


# ── Main ──────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Train the Mode Advisor ML model")
    parser.add_argument(
        "--dry-run", action="store_true", help="Show data stats only, do not train"
    )
    parser.add_argument(
        "--min-rows", type=int, default=MIN_ROWS, help="Minimum rows required to train"
    )
    args = parser.parse_args()

    # Load env
    env_file = PROJECT_ROOT / ".env.local"
    if env_file.exists():
        load_dotenv(env_file)
    else:
        load_dotenv()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL environment variable not set")
        sys.exit(1)

    # Connect
    print(f"Connecting to database...")
    conn = psycopg2.connect(db_url)

    try:
        df = load_training_data(conn)
    finally:
        conn.close()

    if args.dry_run:
        print("\n--- Data Stats (dry run) ---")
        print(f"Total rows: {len(df)}")
        if len(df) > 0:
            print(f"Mode distribution:\n{df['mode'].value_counts()}")
            print(f"Prompt type distribution:\n{df['prompt_type'].value_counts()}")
            print(f"Avg compression ratio: {df['compression_ratio'].mean():.3f}")
        print(f"\nMinimum rows needed to train: {args.min_rows}")
        print(
            f"Status: {'READY' if len(df) >= args.min_rows else 'NOT ENOUGH DATA YET'}"
        )
        return

    if len(df) < 50:
        print(
            f"ERROR: Only {len(df)} rows found. Need at least 50 to train. Collect more data first."
        )
        sys.exit(1)

    if len(df) < args.min_rows:
        print(
            f"WARNING: Only {len(df)} rows (recommended: {args.min_rows}). Model may be inaccurate."
        )

    print("\nBuilding feature matrix...")
    X, y = build_features(df)
    print(f"Feature matrix shape: {X.shape}")
    print(
        f"Label distribution: SAFE={sum(y == 0)}, BALANCED={sum(y == 1)}, AGGRESSIVE={sum(y == 2)}"
    )

    print("\nTraining gradient boosting classifier...")
    model = train(X, y)

    print("\nExporting to ONNX...")
    export_onnx(model, MODEL_OUT)

    print("\nDone! Next steps:")
    print(f"  1. Restart the Next.js dev server — the model loads automatically")
    print(f"  2. Check logs for: 'ONNX mode advisor model loaded'")
    print(f"  3. Retrain periodically as more data accumulates (recommend: monthly)")


if __name__ == "__main__":
    main()
