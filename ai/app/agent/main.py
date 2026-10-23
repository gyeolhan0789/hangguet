"""LiveKit 연결 전용 에이전트. 이름을 지정해 배정한 방에만 참가한다."""

import asyncio
import logging
import os

from livekit import rtc
from livekit.agents import AgentServer, AutoSubscribe, JobContext, cli

log = logging.getLogger(__name__)
server = AgentServer(num_idle_processes=0)


async def entrypoint(ctx: JobContext) -> None:
    closed = asyncio.Event()

    def on_disconnected(_reason: rtc.DisconnectReason) -> None:
        closed.set()

    async def on_shutdown() -> None:
        closed.set()

    ctx.room.on("disconnected", on_disconnected)
    ctx.add_shutdown_callback(on_shutdown)
    try:
        # 연결 확인 단계이므로 지원자의 음성·영상 트랙은 구독하지 않는다.
        await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_NONE)
        log.info("LiveKit 방 참가 완료", extra={"room": ctx.room.name})
        await closed.wait()
    finally:
        ctx.room.off("disconnected", on_disconnected)
        log.info("LiveKit 방 연결 종료")


server.rtc_session(entrypoint, agent_name=os.environ.get("LIVEKIT_AGENT_NAME", "a301-interviewer"))


def main() -> None:
    cli.run_app(server)


if __name__ == "__main__":
    main()
