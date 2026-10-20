package com.ssafy.a301.interview.tts;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.domain.Persona;
import org.junit.jupiter.api.Test;

class ElevenLabsClientTest {

    @Test
    void missingApiKeyIsTtsUnavailable() {
        ElevenLabsClient client = new ElevenLabsClient("");

        assertThatThrownBy(() -> client.issueToken(Persona.DEVIL))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.TTS_UNAVAILABLE));
    }
}
