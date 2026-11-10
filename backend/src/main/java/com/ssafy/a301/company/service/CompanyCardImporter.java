package com.ssafy.a301.company.service;

import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.company.config.CompanyCardProperties;
import com.ssafy.a301.company.domain.CompanyCardImport;
import com.ssafy.a301.company.repository.CompanyCardImportRepository;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/**
 * 공용 버킷의 manifest로 회사 카드를 적재한다(docs/ERD-회사카드.md BE 적재 규칙).
 *
 * <ol>
 *   <li>처음 보는 run_id일 때만 적재한다. 같은 실행을 다시 읽어도 아무것도 하지 않는다
 *   <li>회사마다 회사·별칭을 맞추고, 해시가 바뀐 카드만 읽어 넣는다(CompanyCardWriter)
 *   <li>보관 기간이 지난 카드를 지운다
 *   <li>모든 회사가 성공했을 때만 run_id를 남긴다. 실패한 회사는 다음 주기에 다시 하고, 이미 넣은 회사는 해시가 같아 넘어간다
 * </ol>
 *
 * manifest에서 빠진 회사(파이프라인 목록에서 뺀 회사)는 건드리지 않는다.
 */
@Service
public class CompanyCardImporter {
    private static final Logger LOG = LoggerFactory.getLogger(CompanyCardImporter.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final CompanyCardSource source;
    private final CompanyCardWriter writer;
    private final CompanyCardImportRepository imports;
    private final CompanyCardProperties properties;

    public CompanyCardImporter(
            CompanyCardSource source,
            CompanyCardWriter writer,
            CompanyCardImportRepository imports,
            CompanyCardProperties properties) {
        this.source = source;
        this.writer = writer;
        this.imports = imports;
        this.properties = properties;
    }

    /** 이번에 적재한 결과. 버킷이 없거나, manifest가 없거나, 이미 적재한 실행이면 empty */
    public Optional<ImportResult> importLatest() {
        if (!properties.enabled()) {
            return Optional.empty();
        }
        Optional<byte[]> raw = source.read(CompanyCardSource.MANIFEST);
        if (raw.isEmpty()) {
            LOG.info("공용 버킷에 회사 카드 manifest가 아직 없다");
            return Optional.empty();
        }
        CompanyCardManifest manifest = JSON.readValue(raw.get(), CompanyCardManifest.class);
        if (manifest.format() != CompanyCardManifest.SUPPORTED_FORMAT) {
            LOG.warn("모르는 manifest 형식이라 적재하지 않았다: format {}", manifest.format());
            return Optional.empty();
        }
        String runId = manifest.runId();
        if (runId == null
                || runId.isBlank()
                || runId.length() > CompanyCardImport.MAX_RUN_ID_LENGTH) {
            LOG.warn("manifest run_id가 맞지 않아 적재하지 않았다: {}", runId);
            return Optional.empty();
        }
        if (imports.existsById(runId)) {
            return Optional.empty();
        }

        List<CompanyCardManifest.Entry> entries =
                manifest.companies() == null ? List.of() : manifest.companies();
        int imported = 0;
        int failed = 0;
        for (CompanyCardManifest.Entry entry : entries) {
            try {
                if (writer.apply(entry, this::load)) {
                    imported++;
                }
            } catch (RuntimeException ex) {
                failed++;
                LOG.warn("회사 카드를 적재하지 못했다: {}", entry.corpCode(), ex);
            }
        }
        int removed = writer.deleteStale(KoreaTime.now().minus(properties.keep()));
        if (failed == 0) {
            writer.recordRun(runId);
        }
        ImportResult result = new ImportResult(runId, entries.size(), imported, failed, removed);
        LOG.info(
                "회사 카드 적재 {}: 회사 {}곳 중 새 카드 {}장, 실패 {}곳, 지난 카드 {}장 삭제",
                runId,
                result.companies(),
                imported,
                failed,
                removed);
        return Optional.of(result);
    }

    private byte[] load(String key) {
        return source.read(key).orElseThrow(() -> new IllegalStateException("카드 파일이 없다: " + key));
    }

    public record ImportResult(
            String runId, int companies, int imported, int failed, int removed) {}
}
