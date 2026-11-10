package com.ssafy.a301.company.service;

import com.ssafy.a301.company.domain.Company;
import com.ssafy.a301.company.domain.CompanyAlias;
import com.ssafy.a301.company.domain.CompanyCard;
import com.ssafy.a301.company.domain.CompanyCardImport;
import com.ssafy.a301.company.repository.CompanyAliasRepository;
import com.ssafy.a301.company.repository.CompanyCardImportRepository;
import com.ssafy.a301.company.repository.CompanyCardRepository;
import com.ssafy.a301.company.repository.CompanyRepository;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** 적재의 DB 쪽. 회사 하나를 manifest에 맞추는 일은 회사마다 트랜잭션을 나눠, 한 회사가 실패해도 다른 회사는 들어간다. */
@Component
public class CompanyCardWriter {
    private static final Logger LOG = LoggerFactory.getLogger(CompanyCardWriter.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final CompanyRepository companies;
    private final CompanyAliasRepository aliases;
    private final CompanyCardRepository cards;
    private final CompanyCardImportRepository imports;

    public CompanyCardWriter(
            CompanyRepository companies,
            CompanyAliasRepository aliases,
            CompanyCardRepository cards,
            CompanyCardImportRepository imports) {
        this.companies = companies;
        this.aliases = aliases;
        this.cards = cards;
        this.imports = imports;
    }

    /**
     * 회사·별칭을 manifest에 맞추고, 지금 카드와 해시가 다를 때만 카드 파일을 읽어(load) 새 최신 카드로 넣는다. 새로 넣었으면 true.
     *
     * <p>읽은 파일의 해시가 manifest와 다르면 IllegalStateException(올라오는 도중이거나 깨진 파일).
     */
    @Transactional
    public boolean apply(CompanyCardManifest.Entry entry, Function<String, byte[]> load) {
        validate(entry);
        Company company =
                companies
                        .findByCorpCode(entry.corpCode())
                        .orElseGet(
                                () ->
                                        companies.save(
                                                new Company(
                                                        entry.corpCode(),
                                                        entry.name(),
                                                        entry.listed())));
        company.update(entry.name(), entry.listed());
        syncAliases(company, entry.aliases());

        Optional<CompanyCard> current = cards.findCurrent(company.getId());
        if (current.isPresent() && current.get().getContentHash().equals(entry.sha256())) {
            return false;
        }
        byte[] body = load.apply(entry.cardKey());
        String hash = sha256(body);
        if (!hash.equals(entry.sha256())) {
            throw new IllegalStateException("카드 파일 해시가 manifest와 다르다: " + entry.cardKey());
        }
        Map<String, Object> card = parse(body);
        // 회사당 최신 카드는 하나(부분 UNIQUE)라 이전 카드를 먼저 내려 둔다. IDENTITY라 새 카드는 save 때 바로 INSERT된다
        current.ifPresent(
                previous -> {
                    previous.retire();
                    cards.flush();
                });
        cards.save(new CompanyCard(company, card, hash, entry.generatedAt()));
        return true;
    }

    /** 최신이 아니고, 어느 면접도 쓰지 않고, before보다 먼저 넣은 카드를 지운다 */
    @Transactional
    public int deleteStale(OffsetDateTime before) {
        return cards.deleteStale(before);
    }

    @Transactional
    public void recordRun(String runId) {
        imports.save(new CompanyCardImport(runId));
    }

    /** 별칭을 manifest에 맞춘다. 다른 회사가 이미 쓰는 별칭은 넣지 않는다(그 회사가 다음 실행에서 놓으면 그때 들어온다) */
    private void syncAliases(Company company, List<String> wanted) {
        Set<String> names = new LinkedHashSet<>();
        for (String name : wanted == null ? List.<String>of() : wanted) {
            if (name != null && !name.isBlank() && name.length() <= CompanyAlias.MAX_LENGTH) {
                names.add(name);
            }
        }
        Set<String> kept = new HashSet<>();
        for (CompanyAlias alias : aliases.findByCompanyId(company.getId())) {
            if (names.contains(alias.getAlias())) {
                kept.add(alias.getAlias());
            } else {
                aliases.delete(alias);
            }
        }
        for (String name : names) {
            if (!kept.contains(name)) {
                addAlias(company, name);
            }
        }
    }

    private void addAlias(Company company, String name) {
        if (aliases.existsByAlias(name)) {
            LOG.warn("다른 회사가 쓰는 별칭이라 넣지 않았다: {} ({})", name, company.getCorpCode());
            return;
        }
        aliases.save(new CompanyAlias(company, name));
    }

    private static void validate(CompanyCardManifest.Entry entry) {
        if (entry.corpCode() == null
                || entry.corpCode().length() != 8
                || entry.name() == null
                || entry.name().isBlank()
                || entry.name().length() > 100
                || entry.cardKey() == null
                || entry.sha256() == null
                || entry.sha256().length() != 64
                || entry.generatedAt() == null) {
            throw new IllegalArgumentException("manifest 회사 항목 형식이 맞지 않다: " + entry.corpCode());
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> parse(byte[] body) {
        return JSON.readValue(body, Map.class);
    }

    static String sha256(byte[] body) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
