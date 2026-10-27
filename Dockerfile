FROM python:3.13-slim AS navdata
RUN apt-get update && apt-get install -y --no-install-recommends curl libexpat1 \
    && rm -rf /var/lib/apt/lists/* && pip install --no-cache-dir "osmium>=4,<5"
COPY scripts/build_junctions.py /build_junctions.py
RUN curl -fsSL -o /israel.osm.pbf \
      https://download.geofabrik.de/asia/israel-and-palestine-latest.osm.pbf \
    && python /build_junctions.py /israel.osm.pbf /junctions.db && rm /israel.osm.pbf

FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN addgroup --system tutor && adduser --system --ingroup tutor tutor
WORKDIR /app

COPY pyproject.toml README.md ./
COPY app ./app
RUN pip install --upgrade pip && pip install .

COPY --from=navdata /junctions.db /app/navdata/junctions.db
RUN mkdir -p /app/data && chown -R tutor:tutor /app
USER tutor

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*'"]
