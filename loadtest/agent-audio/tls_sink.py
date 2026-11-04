"""Soniox 대신 음성을 받는 로컬 TLS WebSocket 서버. 받은 것은 버린다(따로 프로세스라 에이전트 쪽 CPU에 섞이지 않는다).

인증서는 loadtest/results/agent-audio/에 만든다(report/agent-audio-2026-11-04.md 부록).

    ai/.venv/Scripts/python.exe loadtest/agent-audio/tls_sink.py
"""

import ssl
from pathlib import Path

from aiohttp import WSMsgType, web

CERTS = Path(__file__).resolve().parents[1] / "results" / "agent-audio"


async def ws(request: web.Request) -> web.WebSocketResponse:
    sock = web.WebSocketResponse()
    await sock.prepare(request)
    async for message in sock:
        if message.type == WSMsgType.TEXT and message.data == "":
            await sock.send_json({"tokens": [], "finished": True})
            break
    return sock


ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
ctx.load_cert_chain(CERTS / "cert.pem", CERTS / "key.pem")
app = web.Application()
app.router.add_get("/ws", ws)
web.run_app(app, host="127.0.0.1", port=8765, ssl_context=ctx, print=None)
