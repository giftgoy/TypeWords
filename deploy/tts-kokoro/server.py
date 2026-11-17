"""TypeWords 本地 TTS：kokoro（sherpa-onnx 离线推理）。

对外保持原 edge-tts 服务的 HTTP 契约（/health /voices /speak），
但 /voices 只列出英文音色（设置页下拉用），/speak 的 voice 参数
接受本地 voices.bin 里的全部音色——中文音色（zf_* / zm_*）供
磨耳朵读释义等内部调用，不进下拉列表。
"""

import asyncio
import io
import os
import time
import wave

import numpy as np
import sherpa_onnx
from aiohttp import ClientError, web

MODEL_DIR = "/app/models/kokoro-multi-lang-v1_1"

# sid 顺序必须与 voices.bin 一致（sherpa-onnx generate_voices_bin.py 规则）：
# 0=af_maple 1=af_sol 2=bf_vale，然后按文件存在顺序 zf_*，再 zm_*。
ZB = "af_maple af_sol bf_vale".split()
ZF = "zf_001 zf_002 zf_003 zf_004 zf_005 zf_006 zf_007 zf_008 zf_017 zf_018 zf_019 zf_021 zf_022 zf_023 zf_024 zf_026 zf_027 zf_028 zf_032 zf_036 zf_038 zf_039 zf_040 zf_042 zf_043 zf_044 zf_046 zf_047 zf_048 zf_049 zf_051 zf_059 zf_060 zf_067 zf_070 zf_071 zf_072 zf_073 zf_074 zf_075 zf_076 zf_077 zf_078 zf_079 zf_083 zf_084 zf_085 zf_086 zf_087 zf_088 zf_090 zf_092 zf_093 zf_094 zf_099".split()
ZM = "zm_009 zm_010 zm_011 zm_012 zm_013 zm_014 zm_015 zm_016 zm_020 zm_025 zm_029 zm_030 zm_031 zm_033 zm_034 zm_035 zm_037 zm_041 zm_045 zm_050 zm_052 zm_053 zm_054 zm_055 zm_056 zm_057 zm_058 zm_061 zm_062 zm_063 zm_064 zm_065 zm_066 zm_068 zm_069 zm_080 zm_081 zm_082 zm_089 zm_091 zm_095 zm_096 zm_097 zm_098 zm_100".split()
SPEAKERS = ZB + ZF + ZM
SPEAKER2ID = {name: i for i, name in enumerate(SPEAKERS)}

# 对外可见的英文音色；id 与 voices.bin 里的名字一致
PUBLIC_VOICES = [
    {"id": "af_maple", "name": "Maple", "lang": "en-US", "gender": "female"},
    {"id": "af_sol", "name": "Sol", "lang": "en-US", "gender": "female"},
    {"id": "bf_vale", "name": "Vale", "lang": "en-GB", "gender": "female"},
]

DEFAULT_VOICE = "af_maple"
MAX_TEXT = 2000
CACHE_MAX = 256

# kokoro 原始输出响度偏低（rms ≈ -27 dBFS，常规语音约 -20 dBFS），
# 这里整体提升增益；个别峰值用限幅兜底，避免削波失真。
OUTPUT_GAIN = float(os.environ.get("TTS_OUTPUT_GAIN", "2.2"))

tts: sherpa_onnx.OfflineTts = None
cache: dict[str, bytes] = {}


def wav_bytes(samples: np.ndarray, sample_rate: int) -> bytes:
    boosted = np.clip(samples * OUTPUT_GAIN, -0.99, 0.99)
    pcm = (boosted * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def synth(text: str, sid: int, speed: float) -> bytes:
    audio = tts.generate(text, sid=sid, speed=speed)
    if len(audio.samples) == 0:
        raise RuntimeError("empty audio")
    return wav_bytes(np.asarray(audio.samples), audio.sample_rate)


async def health(request):
    return web.json_response({"status": "ok", "engine": "kokoro", "model": "kokoro-multi-lang-v1_1"})


async def voices(request):
    return web.json_response(PUBLIC_VOICES)


async def speak(request):
    text = request.query.get("text", "").strip()
    if not text:
        raise web.HTTPBadRequest(text="missing text")
    if len(text) > MAX_TEXT:
        raise web.HTTPBadRequest(text="text too long")
    # voice 为本服务契约；speaker 兼容 kokoro-tts 原服务的参数名
    voice = (request.query.get("voice") or request.query.get("speaker") or DEFAULT_VOICE).strip()
    if voice not in SPEAKER2ID:
        raise web.HTTPBadRequest(text=f"unknown voice {voice}; see /voices")
    try:
        speed = float(request.query.get("speed", "1.0"))
    except ValueError:
        raise web.HTTPBadRequest(text="speed must be a number")
    speed = min(max(speed, 0.5), 2.0)

    key = f"{text}|{voice}|{speed}"
    if key in cache:
        return web.Response(body=cache[key], content_type="audio/wav", headers={"X-Cache": "hit"})

    t0 = time.perf_counter()
    try:
        data = await asyncio.to_thread(synth, text, SPEAKER2ID[voice], speed)
    except (TimeoutError, RuntimeError, ClientError, OSError):
        import logging
        logging.exception("synthesis failed")
        raise web.HTTPBadGateway(text="Speech synthesis failed")
    elapsed = time.perf_counter() - t0

    if len(cache) >= CACHE_MAX:
        cache.pop(next(iter(cache)))
    cache[key] = data
    return web.Response(
        body=data,
        content_type="audio/wav",
        headers={"X-Cache": "miss", "X-Synth-Seconds": f"{elapsed:.2f}"},
    )


def load_tts():
    global tts
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=f"{MODEL_DIR}/model.onnx",
                voices=f"{MODEL_DIR}/voices.bin",
                tokens=f"{MODEL_DIR}/tokens.txt",
                data_dir=f"{MODEL_DIR}/espeak-ng-data",
                dict_dir=f"{MODEL_DIR}/dict",
                lexicon=",".join(
                    f"{MODEL_DIR}/{f}" for f in ("lexicon-zh.txt", "lexicon-us-en.txt", "lexicon-gb-en.txt")
                ) + ",/app/lexicon-extra-en.txt",
            ),
            num_threads=4,
            debug=0,
            provider="cpu",
        ),
        rule_fsts=f"{MODEL_DIR}/phone-zh.fst,{MODEL_DIR}/number-zh.fst",
        rule_fars=f"{MODEL_DIR}/date-zh.fst",
    )
    if not config.validate():
        raise RuntimeError("invalid sherpa-onnx config; check model paths")
    tts = sherpa_onnx.OfflineTts(config)
    print(f"kokoro loaded, {len(SPEAKERS)} speakers", flush=True)


app = web.Application()
app.add_routes(
    [web.get("/health", health), web.get("/voices", voices), web.get("/speak", speak)]
)
# 别名：nuxt devProxy 不剥路径（dev 下来的是 /api/tts/*），nginx 才会剥成 /speak
app.router.add_get("/api/tts/health", health)
app.router.add_get("/api/tts/voices", voices)
app.router.add_get("/api/tts/speak", speak)

if __name__ == "__main__":
    load_tts()
    web.run_app(app, host="0.0.0.0", port=8000, access_log=None)
