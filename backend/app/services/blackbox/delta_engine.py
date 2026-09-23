"""
Delta Engine — pure functions for computing per-principle score movement
between a prior audit and the current re-run audit.

Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
"""

from __future__ import annotations


def classify_movement(prior_pass_rate: float, current_pass_rate: float) -> str:
    """Classify the movement of a principle's pass rate between two audit runs.

    Rules are applied in priority order:
    1. RESOLVED  — prior failing (< 0.5) and now passing (>= 0.7)
    2. REGRESSED — prior passing (>= 0.7) and now failing (< 0.5)
    3. UNCHANGED — absolute change < 0.05
    4. IMPROVING — current > prior (not already RESOLVED)
    5. WORSENING — default (current < prior, not already REGRESSED)

    Args:
        prior_pass_rate: Pass rate (0.0–1.0) from the prior audit.
        current_pass_rate: Pass rate (0.0–1.0) from the current run.

    Returns:
        One of: "RESOLVED", "REGRESSED", "IMPROVING", "WORSENING", "UNCHANGED"
    """
    # 1. RESOLVED: was failing, now clearly passing
    if prior_pass_rate < 0.5 and current_pass_rate >= 0.7:
        return "RESOLVED"

    # 2. REGRESSED: was passing, now clearly failing
    if prior_pass_rate >= 0.7 and current_pass_rate < 0.5:
        return "REGRESSED"

    # 3. UNCHANGED: change is below the noise threshold
    if abs(current_pass_rate - prior_pass_rate) < 0.05:
        return "UNCHANGED"

    # 4. IMPROVING: score moved upward
    if current_pass_rate > prior_pass_rate:
        return "IMPROVING"

    # 5. WORSENING: default — score moved downward
    return "WORSENING"


def compute_principle_deltas(
    prior_category_scores: dict,
    current_category_scores: dict,
) -> list[dict]:
    """Compute per-principle delta entries by comparing prior and current scores.

    Iterates over the union of both dicts' keys. For each principle:
    - If present in both: computes movement_label via classify_movement.
    - If only in prior (not re-probed): carries forward prior score, marks
      not_reprobed=True, no movement_label assigned.
    - If only in current (new principle): treats prior_score as 0.

    Pass rates are derived from 0-100 integer category scores by dividing by 100.

    Args:
        prior_category_scores: Dict mapping principle name → integer score (0–100)
                                from the prior audit.
        current_category_scores: Dict mapping principle name → integer score (0–100)
                                  from the current run.

    Returns:
        List of delta entry dicts, one per principle in the union of both dicts.
        Each entry contains: principle, prior_score, current_score, score_change,
        and either movement_label or not_reprobed=True.
    """
    all_principles = set(prior_category_scores.keys()) | set(current_category_scores.keys())

    deltas: list[dict] = []

    for principle in sorted(all_principles):
        in_prior = principle in prior_category_scores
        in_current = principle in current_category_scores

        if in_prior and not in_current:
            # Principle was probed before but not reprobed in this run
            prior_score = prior_category_scores[principle]
            deltas.append(
                {
                    "principle": principle,
                    "prior_score": prior_score,
                    "current_score": None,
                    "score_change": None,
                    "not_reprobed": True,
                }
            )
        else:
            # Present in current (possibly with prior context)
            prior_score = prior_category_scores.get(principle, 0)
            current_score = current_category_scores[principle]
            score_change = current_score - prior_score

            prior_pass_rate = prior_score / 100.0
            current_pass_rate = current_score / 100.0
            movement_label = classify_movement(prior_pass_rate, current_pass_rate)

            deltas.append(
                {
                    "principle": principle,
                    "prior_score": prior_score,
                    "current_score": current_score,
                    "score_change": score_change,
                    "movement_label": movement_label,
                }
            )

    return deltas


def compute_delta_summary(
    principle_deltas: list[dict],
    prior_overall_score: int,
    current_overall_score: int,
    new_finding_count: int,
) -> dict:
    """Build a high-level summary of score movement across all principles.

    Counts each movement label, builds principles_improved / principles_regressed
    lists, and computes overall_score_change.

    Args:
        principle_deltas: Output of compute_principle_deltas.
        prior_overall_score: Numeric overall score from the prior audit.
        current_overall_score: Numeric overall score from the current run.
        new_finding_count: Count of findings classified as "new" by the
                           Finding Classifier.

    Returns:
        Dict with keys: overall_score_change, resolved_count, regressed_count,
        improving_count, worsening_count, unchanged_count, new_finding_count,
        principles_improved, principles_regressed.
    """
    resolved_count = 0
    regressed_count = 0
    improving_count = 0
    worsening_count = 0
    unchanged_count = 0

    principles_improved: list[str] = []
    principles_regressed: list[str] = []

    for entry in principle_deltas:
        # Skip not_reprobed entries — no movement label to count
        if entry.get("not_reprobed"):
            continue

        label = entry.get("movement_label", "")
        principle = entry["principle"]

        if label == "RESOLVED":
            resolved_count += 1
            principles_improved.append(principle)
        elif label == "REGRESSED":
            regressed_count += 1
            principles_regressed.append(principle)
        elif label == "IMPROVING":
            improving_count += 1
            principles_improved.append(principle)
        elif label == "WORSENING":
            worsening_count += 1
            principles_regressed.append(principle)
        elif label == "UNCHANGED":
            unchanged_count += 1

    overall_score_change = round(current_overall_score - prior_overall_score, 1)

    return {
        "overall_score_change": overall_score_change,
        "resolved_count": resolved_count,
        "regressed_count": regressed_count,
        "improving_count": improving_count,
        "worsening_count": worsening_count,
        "unchanged_count": unchanged_count,
        "new_finding_count": new_finding_count,
        "principles_improved": principles_improved,
        "principles_regressed": principles_regressed,
    }
