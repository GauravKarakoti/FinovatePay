# Credit Risk ML Microservice (Heuristic)

This is a minimal placeholder ML microservice used for development and integration testing. It exposes a `/predict` endpoint that accepts assembled features and returns a heuristic risk score and component scores.

Quick start:

```bash
cd ml/credit_risk_service
python -m venv .venv
.venv\Scripts\activate    # Windows
pip install -r requirements.txt
python app.py
```

Endpoint:
- `POST /predict` - accepts JSON `{ features: { behavioral, payment_velocity, market, financial } }` and returns `riskScore`, `category`, `componentScores`, `modelVersion`, and `confidence`.

Replace this with a proper trained model and secure deployment for production.
