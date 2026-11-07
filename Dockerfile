FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN useradd --system --uid 10001 app

COPY --chown=app:app main.py .

USER app

EXPOSE 8000

CMD ["python", "main.py"]
