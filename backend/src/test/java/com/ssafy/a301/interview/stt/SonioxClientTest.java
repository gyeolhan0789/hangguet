package com.ssafy.a301.interview.stt;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import org.junit.jupiter.api.Test;

class SonioxClientTest {

    @Test
    void missingApiKeyIsSttUnavailable() {
        SonioxClient client = new SonioxClient("");

        assertThatThrownBy(() -> client.issueTemporaryKey("test-soniox-client"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.STT_UNAVAILABLE));
    }
}
