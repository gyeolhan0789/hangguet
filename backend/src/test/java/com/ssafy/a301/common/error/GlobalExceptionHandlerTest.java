package com.ssafy.a301.common.error;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.interview.domain.InputType;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** 본문·경로 값을 읽지 못한 400도 명세 1장대로 errors[{ field, reason }]를 준다. */
class GlobalExceptionHandlerTest {
    private final MockMvc mvc =
            MockMvcBuilders.standaloneSetup(new SampleController())
                    .setControllerAdvice(new GlobalExceptionHandler())
                    .build();

    @Test
    void malformedJsonIsValidationFailedOnBody() throws Exception {
        mvc.perform(
                        post("/sample")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"inputType\":"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("body"));
    }

    @Test
    void unknownEnumValueNamesTheField() throws Exception {
        mvc.perform(
                        post("/sample")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"inputType\":\"FOO\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("inputType"))
                .andExpect(jsonPath("$.errors[0].reason").value("형식이 맞지 않습니다."));
    }

    @Test
    void nestedFieldIsWrittenWithPathAndIndex() throws Exception {
        mvc.perform(
                        post("/sample")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"inputType\":\"TEXT\",\"items\":[{\"count\":1},{\"count\":\"x\"}]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("items[1].count"));
    }

    @Test
    void pathValueTypeMismatchNamesTheParameter() throws Exception {
        mvc.perform(get("/sample/abc"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("sampleId"));
    }

    record Item(int count) {}

    record SampleRequest(InputType inputType, List<Item> items) {}

    @RestController
    static class SampleController {
        @PostMapping("/sample")
        void create(@RequestBody SampleRequest request) {
            // 요청 본문을 읽다 실패할 때의 오류 응답만 확인한다
        }

        @GetMapping("/sample/{sampleId}")
        void get(@PathVariable long sampleId) {
            // 경로 값을 바꾸다 실패할 때의 오류 응답만 확인한다
        }
    }
}
