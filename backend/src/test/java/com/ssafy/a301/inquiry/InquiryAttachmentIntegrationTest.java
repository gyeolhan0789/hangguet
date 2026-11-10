package com.ssafy.a301.inquiry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.storage.s3.PresignedUrl;
import com.ssafy.a301.storage.s3.S3FileStorage;
import com.ssafy.a301.storage.s3.StoredFile;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 실제 PostgreSQL · Redis로 문의 사진(9.11 → 9.1 · 9.4)을 확인한다. 비회원도 로그인 없이 주소를 받아 붙이고, 키는 한 번만 쓰며, 틀린 요청은
 * 키를 쓰지 않아 다시 시도할 수 있다. S3만 가짜로 둔다(올린 파일의 형식 · 크기는 S3가 돌려준 값을 저장한다).
 */
@SpringBootTest
@AutoConfigureMockMvc
class InquiryAttachmentIntegrationTest {
    private static final String ACCESS = "X-Inquiry-Password";

    @Autowired private MockMvc mvc;
    @Autowired private JdbcTemplate jdbc;
    @MockitoBean private S3FileStorage storage;
    private final JsonMapper json = JsonMapper.builder().build();
    private final List<Long> inquiryIds = new ArrayList<>();

    @BeforeEach
    void fakeS3() {
        when(storage.presignUpload(anyString(), anyString(), anyLong()))
                .thenReturn(new PresignedUrl("https://s3.test/put", OffsetDateTime.now()));
        when(storage.presignDownload(anyString()))
                .thenAnswer(call -> "https://s3.test/get/" + call.getArgument(0));
    }

    @AfterEach
    void cleanup() {
        for (long id : inquiryIds) {
            jdbc.update(
                    "DELETE FROM inquiry_attachments WHERE message_id IN (SELECT id FROM"
                            + " inquiry_messages WHERE inquiry_id = ?)",
                    id);
            jdbc.update("DELETE FROM inquiry_messages WHERE inquiry_id = ?", id);
            jdbc.update("DELETE FROM inquiries WHERE id = ?", id);
        }
    }

    @Test
    void guestAttachesPhotosToFirstAndNextQuestion() throws Exception {
        List<String> keys = uploaded("image/png", "image/jpeg");
        when(storage.find(keys.get(0))).thenReturn(Optional.of(new StoredFile("image/png", 100L)));
        when(storage.find(keys.get(1))).thenReturn(Optional.of(new StoredFile("image/jpeg", 200L)));

        long id =
                created(
                        create(keys)
                                .andExpect(status().isCreated())
                                .andExpect(jsonPath("$.messages[0].attachments.length()").value(2))
                                .andExpect(
                                        jsonPath("$.messages[0].attachments[0].url")
                                                .value("https://s3.test/get/" + keys.get(0))));

        Map<String, Object> row =
                jdbc.queryForMap(
                        "SELECT content_type, size FROM inquiry_attachments WHERE object_key = ?",
                        keys.get(1));
        assertThat(row).containsEntry("content_type", "image/jpeg");
        assertThat(((Number) row.get("size")).longValue()).isEqualTo(200L);

        String next = uploaded("image/png").get(0);
        when(storage.find(next)).thenReturn(Optional.of(new StoredFile("image/png", 300L)));
        question(id, List.of(next))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.attachments.length()").value(1));
        question(id, List.of())
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.attachments.length()").value(0));

        mvc.perform(get("/api/v1/inquiries/" + id).header(ACCESS, "1234"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages[0].attachments.length()").value(2))
                .andExpect(jsonPath("$.messages[1].attachments.length()").value(1))
                .andExpect(jsonPath("$.messages[2].attachments.length()").value(0));
    }

    @Test
    void usedKeyCannotBeAttachedAgain() throws Exception {
        String key = uploaded("image/png").get(0);
        when(storage.find(key)).thenReturn(Optional.of(new StoredFile("image/png", 100L)));
        long id = created(create(List.of(key)));

        // 사진 주소로 키가 보여도 다른 문의 · 다른 메시지에 붙일 수 없다
        create(List.of(key))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("attachmentKeys"));
        question(id, List.of(key)).andExpect(status().isBadRequest());
        create(List.of("inquiry/never-issued.png")).andExpect(status().isBadRequest());
    }

    @Test
    void failedRequestKeepsKeyForRetry() throws Exception {
        String key = uploaded("image/png").get(0);
        // 아직 S3에 올리지 않았다
        when(storage.find(key)).thenReturn(Optional.empty());
        create(List.of(key))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("FILE_NOT_FOUND"));

        when(storage.find(key)).thenReturn(Optional.of(new StoredFile("image/png", 100L)));
        long id = created(create(List.of()));
        mvc.perform(post("/api/v1/inquiries/" + id + "/close").header(ACCESS, "1234"))
                .andExpect(status().isNoContent());
        question(id, List.of(key)).andExpect(status().isConflict());

        // 앞의 두 실패에서 키를 쓰지 않았다
        created(
                create(List.of(key))
                        .andExpect(jsonPath("$.messages[0].attachments.length()").value(1)));
    }

    @Test
    void uploadUrlRequestIsLimited() throws Exception {
        uploadUrls("[]").andExpect(status().isBadRequest());
        uploadUrls("[{\"contentType\":\"image/gif\",\"size\":10}]")
                .andExpect(status().isBadRequest());
        uploadUrls("[{\"contentType\":\"image/png\",\"size\":5242881}]")
                .andExpect(status().isBadRequest());
        String six = String.join(",", Collections.nCopies(6, file("image/png")));
        uploadUrls("[" + six + "]").andExpect(status().isBadRequest());
        create(List.of("a", "b", "c", "d", "e", "f"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("attachmentKeys"));
    }

    // 로그인 없이 업로드 주소를 받는다
    private List<String> uploaded(String... contentTypes) throws Exception {
        List<String> files = new ArrayList<>();
        for (String type : contentTypes) {
            files.add(file(type));
        }
        JsonNode body =
                json.readTree(
                        uploadUrls("[" + String.join(",", files) + "]")
                                .andExpect(status().isOk())
                                .andReturn()
                                .getResponse()
                                .getContentAsString(StandardCharsets.UTF_8));
        List<String> keys = new ArrayList<>();
        body.get("files").forEach(url -> keys.add(url.get("objectKey").asString()));
        return keys;
    }

    private ResultActions uploadUrls(String files) throws Exception {
        return mvc.perform(
                post("/api/v1/inquiries/attachments/upload-url")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"files\":" + files + "}"));
    }

    private static String file(String contentType) {
        return "{\"contentType\":\"%s\",\"size\":100}".formatted(contentType);
    }

    private ResultActions create(List<String> keys) throws Exception {
        return mvc.perform(
                post("/api/v1/inquiries")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                json.writeValueAsString(
                                        Map.of(
                                                "title", "사진 문의",
                                                "content", "화면이 이상해요",
                                                "email", "guest@example.com",
                                                "accessPassword", "1234",
                                                "attachmentKeys", keys))));
    }

    private ResultActions question(long id, List<String> keys) throws Exception {
        return mvc.perform(
                post("/api/v1/inquiries/" + id + "/messages")
                        .header(ACCESS, "1234")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                json.writeValueAsString(
                                        Map.of("content", "사진 더 있어요", "attachmentKeys", keys))));
    }

    // 만든 문의 id를 기억해 두었다가 지운다
    private long created(ResultActions result) throws Exception {
        long id =
                json.readTree(
                                result.andExpect(status().isCreated())
                                        .andReturn()
                                        .getResponse()
                                        .getContentAsString(StandardCharsets.UTF_8))
                        .get("id")
                        .asLong();
        inquiryIds.add(id);
        return id;
    }
}
