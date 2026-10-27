package com.ssafy.a301.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** 주기 작업(보내지 못한 AI 작업 재발행)을 켠다. */
@Configuration
@EnableScheduling
public class SchedulingConfig {}
