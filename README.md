# Coc Language Server for Spring Boot

Coc spring boot extension and Language Server providing support for working with Spring Boot
`application.properties`, `application.yml` and `.java` files.

# Usage

The extension will automatically activate when you edit files with the following
name patterns:

The extension by default is bundled with the minimal resources needed to be deployed and started, due to size
limitations some of the libraries are removed from the final packaging - e.g for not immediately used features for
`kotlin`

To build your own server binaries checkout the `build.sh` script which uses the locally cloned `sts4` submodule to build
the language server and corresponding jar bundles. Once you clone the repository do execute the submodule commands below
to initialize them, and clone any submodules

```sh
    git submodule init
    git submodule update
```

This extension also provides a custom root directory where the spring boot binaries are to be found, in case you do not
desire to use the one bundled with this extension, note that the folder configured must contain a sub-folder called
`language-server` where the spring boot tools language server jar and libraries must be located, the extension also
supports exploded jar format, in case you are using an older packing version of spring boot tools.

```json
{
    "spring-boot.ls.directly": "/home/yourname/springboot"
}
```

To configure custom set of bundles to be attached to the java language server one must also specify the full
path/location to the jar extensions, these are also distributed by the spring boot tools. These jars are injected during
`jdtls` startup and are responsible for the startup and communication between `jdtls` and spring language server

```json
{
    "java.jdt.ls.bundles": [
        "/home/yourname/springboot/jars/commons-lsp-extensions.jar",
        "/home/yourname/springboot/jars/io.projectreactor.reactor-core.jar",
        "/home/yourname/springboot/jars/jdt-ls-commons.jar",
        "/home/yourname/springboot/jars/jdt-ls-extension.jar",
        "/home/yourname/springboot/jars/org.reactivestreams.reactive-streams.jar",
        "/home/yourname/springboot/jars/sts-gradle-tooling.jar",
        "/home/yourname/springboot/jars/xml-ls-extension.jar",
    ]
}
```

You can also define your own patterns and map them to the language-ids
`spring-boot-properties` or `spring-boot-properties-yaml`

 - `*.java` =>  activates Spring Boot specific support editing `.java` files.
 - `application*.properties` => activates support for Spring Boot properties in `.properties`format.
 - `application*.yml` =>  activates support for Spring Boot properties in `.yml` format.

# Functionality for `.java`

## Navigating the source code - Go to symbol in file/workspace
Easy navigation to Spring-specific elements of your source code.

* `@/`                 shows all defined request mappings (mapped path, request method, source location)
* `@+`                 shows all defined beans (bean name, bean type, source location)
* `@>`                 shows all functions (prototype implementation)
* `@`                  shows all Spring annotations in the code
* `//`                 shows all request mappings of all running Spring Boot apps and opens a browser for the selected endpoint

Easy navigation to Spring-specific elements of your source code.
* `@Prpofile`:          shows information about the active profiles on the running apps
* `@Component`,        `@Bean`, `@Autowired`: shows detailed information about the beans and their wiring from the live app
* `@ConditionalOn...`: shows information about the conditions and their evaluation at runtime

## Code templates

Write Spring code with templates, available via regular code completion.

* `@GetMapping`
* `@PostMapping`
* `@PutMapping`

## Smart code completions
Additional code completions for Spring-specific annotations

![Smart code completion for boot properties][java-code-completion]

### Examples
* `@Value`: code completion for Spring Boot property keys
* `@Scope`: code completion for standard scope names

# Functionality for `.properties` and `.yml`

This extension analyzes your project's classpath and parses and indexes any [Spring Boot
Properties Metadata](https://docs.spring.io/spring-boot/docs/current/reference/html/configuration-metadata.html) it finds. Both Maven and Gradle projects are supported.

The data in the index is used to provide validation, code completions and information
hovers while editing Spring Boot Properties in either `.properties` or `.yml` format.

## Validation

![application-yaml-validation][yaml-validation]
![application-properties-validation][properties-validation]

## Code Completions

![application-yaml-completions][yaml-completion]

![application-properties-completions][properties-completion]
