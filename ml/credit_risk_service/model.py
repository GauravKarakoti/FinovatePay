"""
Simple heuristic model for credit risk used as a placeholder ML service.
This file contains helper scoring functions used by the Flask API.
"""
import math

def score_behavioral(b):
    score = 50
    age = b.get('account_age_months', 0)
    if age >= 12:
        score += 15
    elif age >= 6:
        score += 10
    elif age >= 3:
        score += 5

    if b.get('kyc_verified'):
        score += 20

    activity = b.get('activity_rate', 0)
    if activity > 0.5:
        score += 10
    elif activity > 0.25:
        score += 5

    volume = b.get('total_volume', 0)
    if volume > 50000:
        score += 10
    elif volume > 10000:
        score += 5

    return max(0, min(100, int(score)))

def score_payment(p):
    score = 50
    completion = p.get('completion_rate', 0)
    overdue = p.get('overdue_rate', 0)
    if completion >= 0.95:
        score += 25
    elif completion >= 0.85:
        score += 15

    if overdue <= 0.05:
        score += 15
    elif overdue > 0.25:
        score -= 20

    avg_early = p.get('avg_days_early', 0)
    if avg_early > 5:
        score += 10

    consistency = p.get('payment_consistency_score', 0.5)
    score += int(consistency * 10)

    return max(0, min(100, int(score)))

def score_market(m):
    score = 50
    vol_ratio = m.get('volume_ratio', 0)
    if vol_ratio >= 1.0:
        score += 15
    elif vol_ratio >= 0.5:
        score += 5

    if m.get('market_trend') == 'up':
        score += 10

    return max(0, min(100, int(score)))

def score_financial(f):
    score = 50
    total_revenue = f.get('total_revenue', 0)
    if total_revenue > 100000:
        score += 20
    elif total_revenue > 50000:
        score += 15

    liquidity = f.get('liquidity_indicator', 0)
    if liquidity > 0.5:
        score += 10
    elif liquidity < 0:
        score -= 10

    return max(0, min(100, int(score)))

def aggregate_scores(b_score, p_score, m_score, f_score, traditional=50):
    # weights aligned with backend service
    weights = {
        'behavioral': 0.20,
        'payment_velocity': 0.30,
        'market_alignment': 0.15,
        'financial_health': 0.20,
        'traditional': 0.15
    }

    risk_score = int(
        b_score * weights['behavioral'] +
        p_score * weights['payment_velocity'] +
        m_score * weights['market_alignment'] +
        f_score * weights['financial_health'] +
        traditional * weights['traditional']
    )

    # lower is better; convert to 0-100 normalized where lower score -> lower risk
    # We'll return as-is and let backend interpret
    return max(0, min(100, risk_score))

def categorize(score):
    if score >= 80:
        return 'excellent'
    if score >= 65:
        return 'good'
    if score >= 50:
        return 'moderate'
    if score >= 35:
        return 'high'
    return 'very_high'
