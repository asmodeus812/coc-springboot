# coc-springboot

Spring Boot support for [coc.nvim](https://github.com/neoclide/coc.nvim). The extension runs the
Spring Boot language server of the Spring Tools project inside Neovim: Spring aware completion,
hover and validation for Java files and for `application.properties`, `application.yml` and
`*.factories` files, symbol search for request mappings and beans, and live data from running
Spring Boot applications.

Using it inside Neovim (commands, live data, build lenses, conversion) is described in the help
page, `:help coc-springboot`, available once the extension is activated. This README covers
requirements, setup, configuration and troubleshooting.

## Requirements

- Neovim with coc.nvim 0.0.82 or later.
- Java 21 or later to run the language server. With an older Java the server does not start.
- A full JDK, not only a JRE, for live data from running applications. With a JRE the server still
  starts, but live data is unavailable and the extension warns when it loads.
- The coc extension [coc-java](https://github.com/neoclide/coc-java) (or `coc-java-dev`). The
  Spring Boot server is started through it; without coc-java it does not start.
- A Spring Boot project built with Maven or Gradle.

## Installation

```vim
:CocInstall coc-java coc-springboot
```

The extension ships with the language server (in `language-server/`) and its coc-java bundles (in
`jars/`). Some optional libraries of the upstream server are not included, for example for Kotlin.

The extension activates when you open a Java file, or when the workspace contains `pom.xml`,
`build.gradle`, `settings.gradle`, their `.kts` variants or `.classpath`. The server starts once
coc-java has loaded the project.

## Setup

### Java

The extension picks the Java that runs the server in this order and writes the choice to its
`SpringBoot` output channel:

1. the `spring-boot.ls.java.home` setting, when the directory exists,
2. the `jre/` directory of coc-java (or coc-java-dev),
3. the `java.home` setting of coc-java, when the directory exists,
4. a JDK found through `JAVA_HOME` or `PATH`.

If none of them gives a Java, the extension reports "Couldn't locate java in $JAVA_HOME or $PATH".

### A custom server directory

To run another build of the server, point `spring-boot.ls.directory` to a directory with a
`language-server/` subdirectory:

```json
{
    "spring-boot.ls.directory": "/home/user/springboot"
}
```

`language-server/` holds either exactly one jar whose name contains `language-server`, or the
exploded layout of older Spring Tools releases (`BOOT-INF/classes` and `BOOT-INF/lib`). Only the
server is replaced: the bundles in `jars/` always come from the extension, and you need no
`java.jdt.ls.bundles` entry. When the directory does not exist, the bundled server runs (see
[Troubleshooting](#troubleshooting)).

### Preparing an application for live data

Live data comes from the actuator endpoints of a running application, read over JMX. Start the
application with:

```text
-Dspring.jmx.enabled=true
-Dmanagement.endpoints.jmx.exposure.include=*
-Dspring.application.admin.enabled=true
```

The last argument also exposes the server port, which the request mapping links use. Local
applications are only found when the server may scan all local Java processes:

```json
{
    "boot-java.live-information.all-local-java-processes": true
}
```

Applications on other machines go into `boot-java.remote-apps` (see [Live data](#live-data)).

## Configuration

Set the keys in `coc-settings.json` (`:CocConfig`). Changes reach the running server, except the
keys under `spring-boot.ls` and `boot-java.ai` that the extension reads when it loads: run
`:CocRestart` after changing those.

### Language server

| Key | Type | Default | Effect |
|---|---|---|---|
| `spring-boot.ls.java.home` | string \| null | none | Java that runs the server, used before every other Java (see [Java](#java)). `~` and environment variables are expanded. Ignored when the directory does not exist. |
| `spring-boot.ls.java.heap` | string \| null | none | Maximum heap of the server, for example `2g`. Empty means `1024m`. Ignored when `spring-boot.ls.java.vmargs` sets `-Xmx`. |
| `spring-boot.ls.java.vmargs` | array | none | Extra JVM arguments of the server, one per item. |
| `spring-boot.ls.checkJVM` | boolean | `true` | Refuse a Java older than 21 and warn when the JDK modules for live data are missing. The warning's "Stop Asking" button sets this to `false` in your user `coc-settings.json`. |
| `spring-boot.ls.directory` | string \| null | none | Directory whose `language-server/` subdirectory holds the server to run instead of the bundled one (see [A custom server directory](#a-custom-server-directory)). Ignored when it does not exist. |
| `spring-boot.ls.logfile` | string \| null | none | File the server writes its log to; `~` is expanded. Without it the server writes no log file. |
| `spring-boot.ls.logLevel` | string: `error`, `warn`, `info`, `debug`, `trace`, `off` | `"error"` | Root log level of the server. |

```json
{
    "spring-boot.ls.java.home": "/usr/lib/jvm/java-21-openjdk",
    "spring-boot.ls.java.vmargs": [
        "-XX:+UseG1GC"
    ]
}
```

### Live data

| Key | Type | Default | Effect |
|---|---|---|---|
| `boot-java.live-information.automatic-connection.on` | boolean | `true` | Connect to applications automatically over JMX. |
| `boot-java.live-information.all-local-java-processes` | boolean | `false` | Look at all local Java processes for Spring Boot applications. Needed to find local applications (see [Preparing an application for live data](#preparing-an-application-for-live-data)). |
| `boot-java.live-information.fetch-data.max-retries` | number | `10` | How often the server retries fetching live data before it gives up. |
| `boot-java.live-information.fetch-data.retry-delay-in-seconds` | number | `3` | Seconds between those retries. |
| `boot-java.remote-apps` | array | none | Remote applications the server polls for live data: objects with the required `jmxurl` and `host` and the optional `urlScheme` and `port` (see the example below). |
| `boot-java.highlight-codelens.on` | boolean | `true` | Show the live data code lenses. A change applies at once. |

```json
{
    "boot-java.remote-apps": [
        {
            "jmxurl": "service:jmx:rmi:///jndi/rmi://localhost:9111/jmxrmi",
            "host": "localhost"
        }
    ]
}
```

### Java code

| Key | Type | Default | Effect |
|---|---|---|---|
| `boot-java.embedded-syntax-highlighting` | boolean | `true` | Syntax highlighting of languages embedded in Java code. |
| `boot-java.java.reconcilers` | boolean | `true` | Reconcile Java sources. |
| `boot-java.scan-java-test-sources.on` | boolean | `false` | Scan the Java test sources too. |
| `boot-java.java.completions.inject-bean` | boolean | `true` | Completion proposals that inject a bean. |
| `boot-java.java.beans-structure-tree` | boolean | `true` | Beans structure tree in the server's outline (experimental). |
| `boot-java.java.codelens-over-query-methods` | boolean | `true` | Code lens with the AOT generated query over Spring Data query methods. |
| `boot-java.code-action.data-query-multiline` | boolean | `false` | Generate `@Query` annotations as multi-line Java text blocks. |
| `boot-java.java.codelens-web-configs-on-controller-classes` | boolean | `true` | Code lens with web configuration details on controller classes. |
| `boot-java.jpql` | boolean | `true` | Support for the JPA query language (JPQL). |
| `boot-java.cron.inlay-hints` | boolean | `true` | Inlay hints for CRON expressions. |
| `boot-java.modulith-project-tracking` | boolean | `true` | Track Spring Modulith projects and update their metadata automatically. |

### Code lenses

The server and the extension show these code lenses in Java files:

| Lens | Turn it off with |
|---|---|
| Live data summaries over beans, wiring, profiles and conditions | `boot-java.highlight-codelens.on` |
| The AOT generated query over Spring Data query methods, with the build lens that refreshes it | `boot-java.java.codelens-over-query-methods` |
| Web configuration details on controller classes | `boot-java.java.codelens-web-configs-on-controller-classes` |

All of them are coc.nvim code lenses, so coc's `codeLens.enable` shows or hides every one of
them at once. It can be set per language, for example to hide them in Java files only:

```json
{
    "[java]": { "codeLens.enable": false }
}
```

### Configuration files

| Key | Type | Default | Effect |
|---|---|---|---|
| `boot-java.common.properties-metadata` | string \| null | none | Path of a shared properties metadata JSON file ([format](https://docs.spring.io/spring-boot/docs/current/reference/html/configuration-metadata.html)). |
| `boot-java.properties.completions.elide-prefix` | boolean | `false` | Elide the common prefix in completions of property keys. |
| `spring.tools.properties.replace-converted-file` | boolean | `false` | Replace the source file when converting between `.properties` and YAML. |

### Spring XML

| Key | Type | Default | Effect |
|---|---|---|---|
| `boot-java.support-spring-xml-config.on` | boolean | `false` | Support for Spring XML configuration files; the other three keys need it. |
| `boot-java.support-spring-xml-config.hyperlinks` | boolean | `true` | Hyperlinks in Spring XML files. |
| `boot-java.support-spring-xml-config.content-assist` | boolean | `true` | Content assist in Spring XML files. |
| `boot-java.support-spring-xml-config.scan-folders` | string | `"src/main"` | Folders scanned for Spring XML files. |

### Embedded MCP server

The server can run an MCP (Model Context Protocol) server that gives AI assistants access to the
Spring data of your projects. It is off by default and is only useful with an AI assistant, so
messages of the server about MCP, for example that it is not configured, can be ignored. When it
is enabled, an MCP client connects over streamable HTTP to `http://localhost:<port>/mcp`, with
the port of `boot-java.ai.mcp-server-port`; with port `0` the server picks a free port and logs
"Embedded Spring Tools MCP server started at port: <port>".

| Key | Type | Default | Effect |
|---|---|---|---|
| `boot-java.ai.mcp-server-enabled` | boolean | `false` | Run the server's embedded MCP server (experimental). |
| `boot-java.ai.mcp-server-port` | integer | `50627` | Port of the embedded MCP server. A port outside 0 to 65535 leaves it off. |

```json
{
    "boot-java.ai.mcp-server-enabled": true,
    "boot-java.ai.mcp-server-port": 50627
}
```

### Validation

Each area of checks has a switch; its severities below apply while it is on.

| Key | Type | Default | Effect |
|---|---|---|---|
| `boot-java.validation.java.boot2` | string: `AUTO`, `OFF`, `ON` | `"AUTO"` | Spring Boot 2 best practice checks of Java code. |
| `boot-java.validation.java.boot3` | string: `AUTO`, `OFF`, `ON` | `"AUTO"` | Spring Boot 3 checks of Java code. |
| `boot-java.validation.java.boot4` | string: `AUTO`, `OFF`, `ON` | `"AUTO"` | Spring Boot 4 checks of Java code. |
| `boot-java.validation.java.spring-aot` | string: `OFF`, `ON` | `"OFF"` | Checks for ahead-of-time (AOT) optimizations. |
| `boot-java.validation.spel.on` | string: `OFF`, `ON` | `"ON"` | Checks of SpEL expressions and property placeholders. |
| `boot-java.validation.java.version-validation` | string: `OFF`, `ON` | `"ON"` | Checks of the Spring Boot version against the support ranges and available updates. |
| `boot-java.validation.data-query` | string: `OFF`, `ON` | `"ON"` | Syntax checks of queries in `@Query` annotations. |
| `boot-java.validation.cron` | string: `OFF`, `ON` | `"ON"` | Checks of CRON expressions. |
| `boot-java.validation.spring-ai` | string: `OFF`, `ON` | `"ON"` | Checks of Spring AI tool, prompt and resource declarations. |
| `spring-boot.ls.problem-parameters.version-validation.use-project-build-file` | boolean | `true` | Look up available versions in the repositories of the project's build file. |
| `spring-boot.ls.problem-parameters.spring-ai.SPRING_AI_TOOL_DESCRIPTION_TOO_SHORT.minimum-length` | integer, min 1 | `30` | Minimum length of the description of a Spring AI tool (`@Tool`, `@McpTool`, `@McpPrompt`, `@McpResource`). |

### Severities

Each key is `spring-boot.ls.problem.<area>.<CHECK>` and takes `IGNORE`, `INFO`, `WARNING`, `HINT` or `ERROR`:

```json
{
    "spring-boot.ls.problem.spel.PROPERTY_PLACE_HOLDER_SYNTAX": "IGNORE",
    "spring-boot.ls.problem.cron.FIELD": "WARNING"
}
```

#### Spring Boot 2 (`spring-boot.ls.problem.boot2.*`)

| Check | Default | Problem |
|---|---|---|
| `PATH_IN_CONTROLLER_ANNOTATION` | `WARNING` | Controller annotation default attribute might contain a path |
| `JAVA_AUTOWIRED_CONSTRUCTOR` | `WARNING` | Unnecessary `@Autowired` over the only constructor |
| `JAVA_PUBLIC_BEAN_METHOD` | `HINT` | Public modifier on `@Bean` method. They no longer have to be public visibility to be usable by Spring |
| `JAVA_TEST_SPRING_EXTENSION` | `WARNING` | `@SpringBootTest` and all test slice annotations already applies `@SpringExtension` as of Spring Boot 2.1.0 |
| `JAVA_CONSTRUCTOR_PARAMETER_INJECTION` | `WARNING` | Use constructor parameter injection |
| `JAVA_PRECISE_REQUEST_MAPPING` | `HINT` | Use precise mapping annotation, i.e. `@GetMapping`, `@PostMapping`, etc |
| `JAVA_PRECISE_SCOPE` | `HINT` | Use precise scope annotation, i.e. `@RequestScope`, `@SessionScope`, `@ApplicationScope` |
| `JAVA_REPOSITORY` | `WARNING` | Unnecessary `@Repository` |
| `JAVA_LAMBDA_DSL` | `INFO` | Consider switching to Lambda DSL syntax |
| `MISSING_CONFIGURATION_ANNOTATION` | `WARNING` | Class likely missing `@Configuration` annotation, i.e. has Bean methods but no `@Configuration` annotation |
| `HTTP_SECURITY_AUTHORIZE_HTTP_REQUESTS` | `WARNING` | `HttpSecurity.authorizeRequests(...)` API and related classes are to be deprecated use new `authorizeHttpRequests(...)` and related classes |
| `WEB_SECURITY_CONFIGURER_ADAPTER` | `WARNING` | `WebSecurityConfigurerAdapter` is removed in Spring-Security 6.x. Refactor classes extending the `WebSecurityConfigurerAdapter` into `Configuration` beans and methods into `Bean` definitions  |
| `DOMAIN_ID_FOR_REPOSITORY` | `ERROR` | Invalid Domain ID type for Spring Data Repository |
| `WEB_ANNOTATION_NAMES` | `HINT` | Web annotation names are unnecessary when it is the same as method parameter name |
| `VALUE_CLASSPATH_RESOURCE_TYPE` | `WARNING` | Type is not compatible with classpath resource injection |
| `WEB_CONFIGURER_CONFIGURATION` | `WARNING` | Class implementing a web configurer interface should be annotated with `@Configuration` |
| `MISSING_VALIDATED_ANNOTATION` | `WARNING` | Component class using bean validation annotations should be annotated with `@Validated` |
| `JAVA_FINAL_AUTOWIRED_FIELD` | `WARNING` | `@Autowired` field should not be `final` |
| `EXTRACT_REQUEST_MAPPING_PARENT_PATH` | `INFO` | Request mappings share a common parent path that could be extracted into a class-level `@RequestMapping` |
| `REST_CONTROLLER_COMBINATION` | `INFO` | Class annotated with both `@Controller` and `@ResponseBody` could use `@RestController` instead |
| `SPRING_JUNIT_CONFIG_COMBINATION` | `INFO` | Test class annotated with both `@ExtendWith(SpringExtension.class)` and `@ContextConfiguration` could use `@SpringJUnitConfig` instead |

#### Spring Boot 3 (`spring-boot.ls.problem.boot3.*`)

| Check | Default | Problem |
|---|---|---|
| `JAVA_TYPE_NOT_SUPPORTED` | `ERROR` | Type not supported as of Spring Boot 3 |
| `FACTORIES_KEY_NOT_SUPPORTED` | `ERROR` | Spring factories key not supported |
| `MODULITH_TYPE_REF_VIOLATION` | `ERROR` | Modulith restricted type reference |
| `MODULITH_APPLICATION_MODULE_LISTENER` | `INFO` | Use `@ApplicationModuleListener` instead of `@Async`/`@Transactional`/`@TransactionalEventListener` |

#### Spring Boot 4 (`spring-boot.ls.problem.boot4.*`)

| Check | Default | Problem |
|---|---|---|
| `REGISTRAR_BEAN_INVALID_ANNOTATION` | `WARNING` | Bean Registrar cannot be registered as a bean via `@Component` annotations |
| `REGISTRAR_BEAN_DECLARATION` | `WARNING` | Bean Registrar should be added to a configuration bean via `@Import` |
| `API_VERSIONING_NOT_CONFIGURED` | `WARNING` | API Versioning used but not configured anywhere |
| `API_VERSION_SYNTAX_ERROR` | `WARNING` | API version cannot be parsed into a standard semantic version |
| `API_VERSIONING_VIA_PATH_SEGMENT_CONFIGURED_IN_COMBINATION` | `WARNING` | API versioning path segment strategy should not be mixed with other strategies |
| `API_VERSIONING_STRATEGY_CONFIGURATION_DUPLICATED` | `WARNING` | API versioning strategy is configured multiple times with the same strategy |
| `SPRING_DATA_STRING_PROPERTY_REFERENCE` | `INFO` | Non type-safe String-based property reference for a Spring Data domain type |

#### AOT (`spring-boot.ls.problem.spring-aot.*`)

| Check | Default | Problem |
|---|---|---|
| `JAVA_CONCRETE_BEAN_TYPE` | `WARNING` | Bean definition should have precise type |
| `JAVA_BEAN_POST_PROCESSOR_IGNORED_IN_AOT` | `WARNING` | `BeanPostProcessor` behaviour is ignored |
| `JAVA_BEAN_NOT_REGISTERED_IN_AOT` | `WARNING` | Not registered as Bean |

#### `.properties` files (`spring-boot.ls.problem.application-properties.*`)

| Check | Default | Problem |
|---|---|---|
| `PROP_INVALID_BEAN_NAVIGATION` | `ERROR` | Accessing a `bean property` in a type that doesn't have properties (e.g. like String or Integer) |
| `PROP_INVALID_INDEXED_NAVIGATION` | `ERROR` | Accessing a property using [] in a type that doesn't support that |
| `PROP_EXPECTED_DOT_OR_LBRACK` | `ERROR` | Unexpected character found where a `.` or `[` was expected |
| `PROP_NO_MATCHING_RBRACK` | `ERROR` | Found a `[` but no matching `]` |
| `PROP_NON_INTEGER_IN_BRACKETS` | `ERROR` | Use of [..] navigation with non-integer value |
| `PROP_VALUE_TYPE_MISMATCH` | `ERROR` | Expecting a value of a certain type, but value doesn't parse as such |
| `PROP_INVALID_BEAN_PROPERTY` | `ERROR` | Accessing a named property in a type that doesn't provide a property accessor with that name |
| `PROP_UNKNOWN_PROPERTY` | `WARNING` | Property-key not found in any configuration metadata on the project's classpath |
| `PROP_DEPRECATED` | `WARNING` | Property is marked as Deprecated |
| `PROP_DUPLICATE_KEY` | `ERROR` | Multiple assignments to the same property value |
| `PROP_SYNTAX_ERROR` | `ERROR` | Syntax Error |

#### YAML files (`spring-boot.ls.problem.application-yaml.*`)

| Check | Default | Problem |
|---|---|---|
| `YAML_SYNTAX_ERROR` | `ERROR` | Error parsing the input using snakeyaml |
| `YAML_UNKNOWN_PROPERTY` | `WARNING` | Property-key not found in the configuration metadata on the project's classpath |
| `YAML_VALUE_TYPE_MISMATCH` | `ERROR` | Expecting a value of a certain type, but value doesn't parse as such |
| `YAML_EXPECT_SCALAR` | `ERROR` | Expecting a `scalar` value but found something more complex |
| `YAML_EXPECT_TYPE_FOUND_SEQUENCE` | `ERROR` | Found a `sequence` node where a non `list-like` type is expected |
| `YAML_EXPECT_TYPE_FOUND_MAPPING` | `ERROR` | Found a `mapping` node where a type that can't be treated as a `property map` is expected |
| `YAML_EXPECT_MAPPING` | `ERROR` | Expecting a `mapping` node but found something else |
| `YAML_EXPECT_BEAN_PROPERTY_NAME` | `ERROR` | Expecting a `bean property` name but found something more complex |
| `YAML_INVALID_BEAN_PROPERTY` | `ERROR` | Accessing a named property in a type that doesn't provide a property accessor with that name |
| `YAML_DEPRECATED_ERROR` | `ERROR` | Property is marked as Deprecated(Error) |
| `YAML_DEPRECATED_WARNING` | `WARNING` | Property is marked as Deprecated(Warning) |
| `YAML_DUPLICATE_KEY` | `ERROR` | A mapping node contains multiple entries for the same key |
| `YAML_SHOULD_ESCAPE` | `WARNING` | This key contains special characters and should probably be escaped by surrounding it with `[]` |

#### SpEL (`spring-boot.ls.problem.spel.*`)

| Check | Default | Problem |
|---|---|---|
| `JAVA_SPEL_EXPRESSION_SYNTAX` | `ERROR` | SpEL parser raised a ParseException |
| `PROPERTY_PLACE_HOLDER_SYNTAX` | `ERROR` | Property place holder raised a ParseException |

#### Spring Boot version (`spring-boot.ls.problem.version-validation.*`)

| Check | Default | Problem |
|---|---|---|
| `SUPPORTED_OSS_VERSION` | `IGNORE` | Supported OSS Boot Version |
| `UNSUPPORTED_OSS_VERSION` | `WARNING` | Unsupported OSS Version |
| `UNSUPPORTED_COMMERCIAL_VERSION` | `WARNING` | Unsupported Commercial Version |
| `SUPPORTED_COMMERCIAL_VERSION` | `IGNORE` | Supported Commercial Version |
| `UPDATE_LATEST_MAJOR_VERSION` | `IGNORE` | Update to Latest Major Version |
| `UPDATE_LATEST_MINOR_VERSION` | `INFO` | Update to Latest Minor Version |
| `UPDATE_LATEST_PATCH_VERSION` | `WARNING` | Update to Latest Patch Version |
| `SPRING_CLOUD_INCOMPATIBLE_BOOT_VERSION` | `WARNING` | Incompatible Spring Boot Version for Spring Cloud |

#### Data queries (`spring-boot.ls.problem.data-query.*`)

| Check | Default | Problem |
|---|---|---|
| `JPQL_SYNTAX` | `ERROR` | JPQL syntax |
| `HQL_SYNTAX` | `ERROR` | HQL syntax |
| `SQL_SYNTAX` | `ERROR` | SQL syntax |

#### CRON (`spring-boot.ls.problem.cron.*`)

| Check | Default | Problem |
|---|---|---|
| `SYNTAX` | `ERROR` | CRON expression syntax |
| `FIELD` | `ERROR` | CRON expression field |

#### Spring AI (`spring-boot.ls.problem.spring-ai.*`)

| Check | Default | Problem |
|---|---|---|
| `SPRING_AI_TOOL_MISSING_DESCRIPTION` | `WARNING` | Spring AI tool/prompt/resource is missing a description. Descriptions are critical for the LLM to correctly select and invoke the tool |
| `SPRING_AI_TOOL_DESCRIPTION_TOO_SHORT` | `WARNING` | Spring AI tool/prompt/resource description is too short. A meaningful description helps the LLM decide when and how to invoke the tool |

## Files

- The `SpringBoot` output channel holds the messages of the extension and the server, the
  `SpringBoot Build` output channel the output of the Maven and Gradle builds. Open them with
  `:CocCommand workspace.showOutput`.
- The server writes a log file only when `spring-boot.ls.logfile` is set.
- The builds write the generated Spring Data AOT metadata into the project, under
  `target/spring-aot/main/resources` or `build/generated/aotResources`.

The extension stores nothing else.

## Troubleshooting

- The server does not start: check that coc-java is installed and that a Java file or a build file
  of the project is open, then read the `SpringBoot` output channel. It names the Java the
  extension found and why it failed. When the server cannot be launched at all, the extension
  shows "Unable to launch the spring boot language server: {reason}".
- "Spring Tools Language Server requires Java 21 or higher to be launched. Current Java version is
  {version}": point `spring-boot.ls.java.home` to a Java 21 or later.
- "The Java runtime used by Spring Tools ({path}) does not provide the {module} module. A full JDK
  is required to attach to locally running Spring Boot apps, hence live process information (live
  hovers and live metrics) is unavailable. All other features work as usual.": install a full JDK
  and point `spring-boot.ls.java.home` to it, or press "Stop Asking" to silence the warning.
- "Couldn't locate java in $JAVA_HOME or $PATH": set `spring-boot.ls.java.home` (see
  [Java](#java)).
- The bundled server runs although `spring-boot.ls.directory` is set: the `SpringBoot` output
  channel shows `"spring-boot.ls.directory" points to folder that does NOT exist: <path>`; correct
  the path and run `:CocRestart`.
- "Multiple server jars found in ...": keep one `language-server*.jar` in the `language-server/`
  directory of the server directory.
- "Classpath listener not supported while Java Language Server is in LightWeight mode": coc-java
  runs in its lightweight mode; the project features of the server need its standard mode.
- Other language servers stop working on `application.yml` and the `SpringBoot` output channel
  shows "Dynamic registration middleware not supported by coc, forcing spring filetypes on
  configuration files": your coc.nvim is too old to let configuration files keep their filetype,
  so the extension sets the Spring filetypes on them about 10 seconds after the start. Update
  coc.nvim.
- No local application in the live data picker: set
  `boot-java.live-information.all-local-java-processes` and start the application with the JMX
  arguments of [Preparing an application for live data](#preparing-an-application-for-live-data).
- A change under `spring-boot.ls` or `boot-java.ai` has no effect: run `:CocRestart`.

## Development

Install the dependencies with `npm install`, then:

```sh
npm run build       # build lib/index.js
npm run watch       # rebuild on change
npm run typecheck   # type check
make update         # replace the bundled server with the latest Spring Tools release (needs gh)
```

Set `SPRING_LS_USE_SOCKET` before coc.nvim starts to talk to the server over a local socket
instead of stdio.

### Extension API

The extension returns an object to other coc extensions with:

- `client`: the language client of the server.
- Events for live applications, each with a live process as payload: `onDidLiveProcessConnect`,
  `onDidLiveProcessDisconnect`, `onDidLiveProcessUpdate`, `onDidLiveProcessGcPausesMetricsUpdate`
  and `onDidLiveProcessMemoryMetricsUpdate`.
- Functions for live data: `getLiveProcessData`, `refreshLiveProcessData`,
  `getLiveProcessMetricsData`, `refreshLiveProcessMetricsData` and `listConnectedProcesses`.
- `getSpringIndex()`: returns `beans({projectName})`, a promise of the beans of that project
  (name, type, location, injection points and supertypes), and `onSpringIndexUpdated`, an event
  fired when the server's Spring index changes; its payload has `affectedProjects`, the names of
  the updated projects, when the server reports them.

A live data query is an object with `processKey` and an `endpoint`: one of `mappings`,
`contextPath`, `port`, `properties` and `profiles`, `beans` (with `beanName` and `dependingOn` as
optional filters), or `metrics` (with `metricName` and optional `tags`).

## Contributing

Issues and pull requests are welcome at <https://github.com/asmodeus812/coc-springboot>. Run
`npm run typecheck` and `npm run build` before you send a change.

## License

GNU General Public License, version 3 only (`GPL-3.0-only`); the full text is in `LICENSE`.
