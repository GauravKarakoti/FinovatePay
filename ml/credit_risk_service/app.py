from flask import Flask, request, jsonify
from flask_cors import CORS
from model import score_behavioral, score_payment, score_market, score_financial, aggregate_scores, categorize

app = Flask(__name__)
CORS(app)


@app.route('/', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'credit-risk-ml'})


@app.route('/predict', methods=['POST'])
def predict():
    data = request.get_json() or {}
    features = data.get('features', {})

    behavioral = features.get('behavioral', {})
    payment = features.get('payment_velocity', {})
    market = features.get('market', {})
    financial = features.get('financial', {})

    try:
        b_score = score_behavioral(behavioral)
        p_score = score_payment(payment)
        m_score = score_market(market)
        f_score = score_financial(financial)

        risk_score = aggregate_scores(b_score, p_score, m_score, f_score)
        category = categorize(risk_score)

        response = {
            'riskScore': risk_score,
            'category': category,
            'componentScores': {
                'behavioral': b_score,
                'paymentVelocity': p_score,
                'marketAlignment': m_score,
                'financial': f_score,
                'traditional': data.get('traditionalScore', 50)
            },
            'modelVersion': 'heuristic-0.1',
            'confidence': 0.65
        }

        return jsonify(response)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
