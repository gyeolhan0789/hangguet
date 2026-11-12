"""분석 작업자.

BE가 Redis 작업 큐에 추가한 작업을 처리한다.
작업 종류는 PLAN·EXTRACT_CLAIMS·SCORE_ANSWER·EVALUATE·MERGE_RECORDING이다.
"""
