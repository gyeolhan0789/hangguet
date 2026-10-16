# syntax=docker/dockerfile:1

# 빌드: CI와 같은 JDK 이미지에서 실행 가능한 jar를 만든다.
FROM eclipse-temurin:21-jdk-noble AS build
WORKDIR /workspace

# 의존성만 먼저 받아 레이어를 캐시한다. 소스만 바뀌면 다시 받지 않는다.
COPY gradlew settings.gradle build.gradle gradle.properties ./
COPY gradle ./gradle
RUN ./gradlew dependencies --no-daemon -q > /dev/null

COPY src ./src
RUN ./gradlew bootJar --no-daemon -q

# 실행: JRE만 담는다.
FROM eclipse-temurin:21-jre-noble
WORKDIR /app

RUN groupadd --system --gid 10001 a301 \
    && useradd --system --uid 10001 --gid a301 a301

COPY --from=build --chown=a301:a301 /workspace/build/libs/*.jar app.jar

USER a301

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
