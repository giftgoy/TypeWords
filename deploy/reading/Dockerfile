FROM registry-1.docker.io/library/python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir aiohttp==3.13.3
COPY server.py validation.py ./
EXPOSE 8000
CMD ["python", "server.py"]
