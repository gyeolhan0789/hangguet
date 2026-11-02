package com.ssafy.a301.company.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(CompanyCardProperties.class)
public class CompanyCardConfig {}
