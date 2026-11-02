FROM registry-1.docker.io/library/python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir edge-tts==7.3.1 aiohttp==3.13.3
COPY server.py .
EXPOSE 8000
CMD ["python", "server.py"]
