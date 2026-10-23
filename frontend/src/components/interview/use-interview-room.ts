"use client";

import { Room, RoomEvent, Track } from "livekit-client";
import { useCallback, useEffect, useState } from "react";

import { issueRoomToken } from "@/lib/interview/actions";
import { STT_TOPIC, transcriptSchema } from "@/lib/interview/transcript";

// 기준: 웹 Swagger 5.14 · RoomResponse · 사용자 승인 마이크 송출/STT 표시 계획.
// SDK: https://docs.livekit.io/transport/data/text-streams/ · publishTrack(MediaStreamTrack).
export type InterviewRoomStatus =
  "idle" | "connecting" | "listening" | "reconnecting" | "failed" | "sttFailed";

const INITIAL = { status: "idle" as InterviewRoomStatus, confirmedText: "", interimText: "" };

export function useInterviewRoom(sessionId: number, stream: MediaStream | null) {
  const microphone = stream?.getAudioTracks()[0];
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(INITIAL);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const track = microphone;
    if (!track) return;
    const room = new Room({ stopLocalTrackOnUnpublish: false });
    const lifetime = new AbortController();
    let disposed = false;
    let currentStream: string | null = null;
    let revision = -1;
    let sttStatus: InterviewRoomStatus = "connecting";
    const retiredStreams = new Set<string>();

    function fail() {
      if (!disposed) setState((previous) => ({ ...previous, status: "failed" }));
    }

    room.on(RoomEvent.Reconnecting, () => {
      if (!disposed) setState((previous) => ({ ...previous, status: "reconnecting" }));
    });
    room.on(RoomEvent.Reconnected, () => {
      if (!disposed) setState((previous) => ({ ...previous, status: sttStatus }));
    });
    room.on(RoomEvent.Disconnected, fail);
    track.addEventListener("ended", fail);

    // 마이크 송출 전에 수신을 등록해 첫 인식 결과도 받을 수 있게 한다.
    room.registerTextStreamHandler(STT_TOPIC, (reader, sender) => {
      if (!room.remoteParticipants.get(sender.identity)?.isAgent) return;
      void (async () => {
        try {
          const text = await reader.readAll({
            signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10_000)]),
          });
          if (disposed || !room.remoteParticipants.get(sender.identity)?.isAgent) return;
          const parsed = transcriptSchema.safeParse(JSON.parse(text));
          if (!parsed.success) return;
          const snapshot = parsed.data;
          if (retiredStreams.has(snapshot.streamId)) return;
          if (currentStream !== snapshot.streamId) {
            if (currentStream) retiredStreams.add(currentStream);
            currentStream = snapshot.streamId;
            revision = -1;
          }
          if (snapshot.revision <= revision) return;
          revision = snapshot.revision;
          sttStatus = snapshot.state === "failed" ? "sttFailed" : "listening";
          setState({
            status: sttStatus,
            confirmedText: snapshot.confirmedText,
            interimText: snapshot.interimText,
          });
        } catch {
          // 잘못된 메시지와 종료된 스트림은 버린다. 답변 원문은 로그에 남기지 않는다.
        }
      })();
    });

    const connect = async () => {
      setState({ ...INITIAL, status: "connecting" });
      try {
        const access = await issueRoomToken(sessionId);
        if (disposed) return;
        if (!access.ok || track.readyState === "ended") {
          fail();
          return;
        }
        await room.connect(access.url, access.token);
        if (disposed) {
          await room.disconnect(false);
          return;
        }
        await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
        if (disposed) {
          await room.localParticipant.unpublishTrack(track, false);
          await room.disconnect(false);
        }
      } catch {
        fail();
        await room.disconnect(false);
      }
    };
    void connect();

    return () => {
      disposed = true;
      lifetime.abort();
      track.removeEventListener("ended", fail);
      room.unregisterTextStreamHandler(STT_TOPIC);
      room.removeAllListeners();
      // 마이크 소유자는 기존 useInterviewMedia다. SDK가 원본 트랙을 중지하지 않게 한다.
      void room.disconnect(false);
    };
  }, [sessionId, microphone, attempt]);

  return { ...state, retry };
}
