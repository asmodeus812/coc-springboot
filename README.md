# Coc Language Server for Spring Boot

Coc spring boot extension and Language Server providing support for working with Spring Boot
`application.properties`, `application.yml` and `.java` files.

# Usage

The extension will automatically activate when you edit files with the following
name patterns:

This extension also provides a custom root directory where the spring boot binaries are to be found, in case you do not desire to use the one bundled with this extension

```json
{
    "spring-boot.ls.directly": "/home/yourname/springboot"
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
