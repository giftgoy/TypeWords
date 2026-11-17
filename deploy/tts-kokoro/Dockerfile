FROM python:3.12-slim

ARG http_proxy
ARG https_proxy
ENV http_proxy=${http_proxy} https_proxy=${https_proxy}

RUN pip install --no-cache-dir sherpa-onnx aiohttp numpy

ENV http_proxy= https_proxy=

WORKDIR /app
COPY server.py /app/server.py
# 补 lexicon 缺口（make/want/become/believe 的 -s 形式，模型自带词表漏了）
COPY lexicon-extra-en.txt /app/lexicon-extra-en.txt

# 模型不进镜像：compose 挂载 ../kokoro-tts/models/kokoro-multi-lang-v1_1 到
# /app/models/kokoro-multi-lang-v1_1（约 348MB）
EXPOSE 8000
CMD ["python", "/app/server.py"]
