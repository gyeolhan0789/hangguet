import asyncio
from unittest.mock import AsyncMock, Mock, patch

import pytest
from livekit.agents import AutoSubscribe

from app.agent.main import entrypoint, main, server


def test_room_disconnect_releases_job_without_subscribing_media() -> None:
    async def run() -> None:
        ctx = Mock()
        ctx.connect = AsyncMock()
        task = asyncio.create_task(entrypoint(ctx))
        await asyncio.sleep(0)
        assert not task.done()
        ctx.connect.assert_awaited_once_with(auto_subscribe=AutoSubscribe.SUBSCRIBE_NONE)
        on_disconnected = ctx.room.on.call_args.args[1]
        on_disconnected(0)
        await asyncio.wait_for(task, timeout=1)
        ctx.room.off.assert_called_once_with("disconnected", on_disconnected)

    asyncio.run(run())


def test_server_shutdown_releases_waiting_job() -> None:
    async def run() -> None:
        ctx = Mock()
        ctx.connect = AsyncMock()
        task = asyncio.create_task(entrypoint(ctx))
        await asyncio.sleep(0)
        on_shutdown = ctx.add_shutdown_callback.call_args.args[0]
        await on_shutdown()
        await asyncio.wait_for(task, timeout=1)
        ctx.room.off.assert_called_once()

    asyncio.run(run())


def test_connection_failure_does_not_leave_listener() -> None:
    ctx = Mock()
    ctx.connect = AsyncMock(side_effect=ConnectionError("unavailable"))
    with pytest.raises(ConnectionError):
        asyncio.run(entrypoint(ctx))
    ctx.room.off.assert_called_once_with("disconnected", ctx.room.on.call_args.args[1])


def test_main_starts_only_the_agent_server() -> None:
    with patch("app.agent.main.cli.run_app") as run_app:
        main()
    run_app.assert_called_once_with(server)
