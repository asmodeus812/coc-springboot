#!/bin/bash
set -e

workdir=$(pwd)

rm -fr "${workdir}"/jars
mkdir -p "${workdir}"/jars

rm -fr "${workdir}"/language-server
mkdir -p "${workdir}"/language-server

modules=spring-boot-language-server,sts-gradle-model-plugin,:org.springframework.tooling.gradle,:org.springframework.tooling.jdt.ls.extension,:org.springframework.tooling.jdt.ls.commons,:org.springframework.tooling.jdt.ls.commons.test
cd "${workdir}"/sts4/headless-services/spring-boot-language-server

if command -v xvfb-run; then
    echo "Using xvfb to run in headless environment..."
    xvfb-run ../mvnw \
        -DskipTests=true \
        -DtrimStackTrace=false \
        -f ../pom.xml \
        -pl $modules \
        -am \
        -B \
        clean install
else
    ../mvnw \
        -DskipTests=true \
        -DtrimStackTrace=false \
        -f ../pom.xml \
        -pl $modules \
        -am \
        -B \
        clean install
fi

cd ../xml-ls-extension
../mvnw \
    -DskipTests=true \
    -DtrimStackTrace=false \
    -f ../pom.xml \
    -pl xml-ls-extension \
    -am \
    -B \
    clean install

cd ../jdt-ls-extension
../mvnw \
    -DskipTests=true \
    -DtrimStackTrace=false \
    -f ../pom.xml \
    -pl xml-ls-extension \
    -am \
    -B \
    clean install

cd "${workdir}"/sts4/headless-services/spring-boot-language-server/target
server_jar_file=$(find . -name '*-exec.jar')
java -Djarmode=tools -jar "$server_jar_file" extract --destination "${workdir}"/language-server

cd "${workdir}"/sts4/headless-services/xml-ls-extension
find . -name "*-sources.jar" -delete
cp target/*.jar "${workdir}"/jars/xml-ls-extension.jar
cp target/dependencies/commons-lsp-extensions.jar "${workdir}"/jars/

cd "${workdir}"/sts4/headless-services/jdt-ls-extension
find . -name "*-sources.jar" -delete
cp org.springframework.tooling.jdt.ls.extension/target/*.jar "${workdir}"/jars/jdt-ls-extension.jar
cp org.springframework.tooling.jdt.ls.commons/target/*.jar "${workdir}"/jars/jdt-ls-commons.jar
cp org.springframework.tooling.gradle/target/*.jar "${workdir}"/jars/sts-gradle-tooling.jar

cp org.springframework.tooling.jdt.ls.commons/target/dependencies/io.projectreactor.reactor-core.jar "${workdir}"/jars/
cp org.springframework.tooling.jdt.ls.commons/target/dependencies/org.reactivestreams.reactive-streams.jar "${workdir}"/jars/
