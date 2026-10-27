package com.ssafy.a301.common.crypto;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class HashesTest {

    @Test
    void sha256HexMatchesKnownValue() {
        assertThat(Hashes.sha256Hex("abc"))
                .isEqualTo("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    @Test
    // Redis에 이미 저장된 멱등성 지문과 같아야 한다(앞부분을 먼저 넣고 본문을 이어 넣던 방식)
    void partsHashLikeConcatenation() {
        byte[] head = "POST /a\n".getBytes(StandardCharsets.UTF_8);
        byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
        assertThat(Hashes.sha256Hex(head, body)).isEqualTo(Hashes.sha256Hex("POST /a\n{}"));
    }
}
