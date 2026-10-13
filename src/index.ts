'use strict'
import {
    nvim,
    services,
    commands,
    window,
    workspace,
    ExtensionContext,
} from 'coc.nvim'

import * as commons from './utils'
import { ApiManager } from "./apiManager"
import { ExtensionAPI } from "./api"
import { registerJavaDataService, registerClasspathService } from "./utils"
import { startPropertiesConversionSupport } from "./convert-props-yaml"

const PROPERTIES_LANGUAGE_ID = "spring-boot-properties"
const YAML_LANGUAGE_ID = "spring-boot-properties-yaml"
const JAVA_LANGUAGE_ID = "java"
const XML_LANGUAGE_ID = "xml"
const FACTORIES_LANGUAGE_ID = "spring-factories"
const JPA_QUERY_PROPERTIES_LANGUAGE_ID = "jpa-query-properties"

const STOP_ASKING = "Stop Asking"

export function activate(context: ExtensionContext): Promise<ExtensionAPI> {
    const specificVmArgs = [
        "-Dspring.config.location=classpath:/application.properties",
        "-Djdk.util.zip.disableZip64ExtraFieldValidation=true"
    ]

    const aiPreferencesConfig = workspace.getConfiguration("boot-java.ai")
    const mcpServerEnabled = aiPreferencesConfig.get<boolean>("mcp-server-enabled")
    const mcpServerPort = aiPreferencesConfig.get<number>("mcp-server-port", 50627)

    if (mcpServerEnabled === true && mcpServerPort >= 0 && mcpServerPort <= 65535) {
        specificVmArgs.push("-Dserver.port=" + mcpServerPort)
    } else {
        // the embedded mcp server is a web application, do not start it when it is not requested
        specificVmArgs.push("-Dspring.main.web-application-type=NONE")
    }

    let options: commons.ActivatorOptions = {
        extensionId: 'springboot',
        CONNECT_TO_LS: false,
        jvmHeap: '1024m',
        preferJdk: true,
        DEBUG: false,
        vmArgs: specificVmArgs,
        checkjvm: (_, jvm: commons.JVM) => {
            let version = jvm.getMajorVersion()
            if (version < 21) {
                throw Error(`Spring Tools Language Server requires Java 21 or higher to be launched. Current Java version is ${version}`)
            }

            const missingModules = jvm.getMissingJdkModules()
            if (missingModules.length > 0) {
                window.showWarningMessage(
                    `The Java runtime used by Spring Tools (${jvm.getJavaHome()}) does not provide the ${missingModules.join(' and ')} module${missingModules.length > 1 ? 's' : ''}. `
                    + 'A full JDK is required to attach to locally running Spring Boot apps, hence live process information (live hovers and live metrics) is unavailable. All other features work as usual.',
                    STOP_ASKING).then(selection => {
                        if (selection === STOP_ASKING) {
                            options.workspaceOptions.update('checkJVM', false)
                        }
                    })
            }
        },
        workspaceOptions: workspace.getConfiguration("spring-boot.ls"),
        clientOptions: {
            markdown: {
                isTrusted: true
            },
            disabledFeatures: [
                // TODO: coc does not handle multiple symbol providing clients
                "documentHighlight",
                "documentSymbol"
            ],
            documentSelector: [
                {
                    language: PROPERTIES_LANGUAGE_ID,
                    scheme: 'file'
                },
                {
                    language: YAML_LANGUAGE_ID,
                    scheme: 'file'
                },
                {
                    language: FACTORIES_LANGUAGE_ID,
                    scheme: 'file'
                },
                {
                    language: JPA_QUERY_PROPERTIES_LANGUAGE_ID,
                    scheme: 'file'
                },
                {
                    language: XML_LANGUAGE_ID,
                    scheme: 'file'
                },
                {
                    language: JAVA_LANGUAGE_ID,
                    scheme: 'file'
                },
                {
                    language: JAVA_LANGUAGE_ID,
                    scheme: 'jdt'
                },
            ],
            synchronize: {
                configurationSection: ['boot-java', 'spring-boot', 'http']
            },
            initializationOptions: () => ({
                workspaceFolders: workspace.workspaceFolders ? workspace.workspaceFolders.map(f => f.uri.toString()) : null,
                // Do not enable JDT classpath listeners at the startup - classpath service would enable it later if needed based on the Java extension mode
                // Classpath service registration requires commands to be registered and Boot LS needs to register classpath
                // listeners when client has callbacks for STS4 extension java related messages registered via JDT classpath and Data Service registration
                enableJdtClasspath: false
            })
        }
    }

    return commons.activate(options, context).then(client => {
        // @Note that the name of this command is hard coded in the spring boot extensions and is expected to be exactly - vscode-spring-boot.ls.start
        context.subscriptions.push(commands.registerCommand('vscode-spring-boot.ls.start', () => client.start().then(() => {
            console.log(`Starting spring-boot server`)

            // TODO: workaround with filetypes for https://github.com/neoclide/coc.nvim/issues/5112,
            // other language servers which rely on the correct ft will not work, namely - yaml/yml
            workspace.registerAutocmd({
                event: ["BufRead", "BufNewFile"],
                callback: async () => {
                    await nvim.exec(`set ft=${YAML_LANGUAGE_ID}`)
                    await nvim.exec("setl syntax=yaml")
                },
                pattern: "application*.yml,bootstrap*.yml,application*.yaml,bootstrap*.yaml"
            })

            workspace.registerAutocmd({
                event: ["BufRead", "BufNewFile"],
                callback: async () => {
                    await nvim.exec(`set ft=${PROPERTIES_LANGUAGE_ID}`)
                    await nvim.exec("setl syntax=jproperties")
                },
                pattern: "application*.properties,bootstrap*.properties"
            })

            workspace.registerAutocmd({
                event: ["BufRead", "BufNewFile"],
                callback: async () => {
                    await nvim.exec(`set ft=${FACTORIES_LANGUAGE_ID}`)
                    await nvim.exec("setl syntax=jproperties")
                },
                pattern: "spring*.factories"
            })

            workspace.registerAutocmd({
                event: ["BufRead", "BufNewFile"],
                callback: async () => {
                    await nvim.exec(`set ft=${JPA_QUERY_PROPERTIES_LANGUAGE_ID}`)
                    await nvim.exec("setl syntax=jproperties")
                },
                pattern: "jpa*.properties"
            })

            services.registerLanguageClient(client)
            registerClasspathService(client)
            registerJavaDataService(client)

            // Force classpath listener to be enabled. Boot LS can only be launched iff classpath is available and there Spring-Boot on the classpath somewhere.
            commands.executeCommand('sts.vscode-spring-boot.enableClasspathListening', true)
        })))
        context.subscriptions.push(commands.registerCommand('vscode-spring-boot.ls.stop', () => client.stop()))

        commons.registerCommands(context)
        startPropertiesConversionSupport(context)
        registerMiscCommands(context)

        return new ApiManager(client).api
    })
}

function registerMiscCommands(context: ExtensionContext) {
    context.subscriptions.push(
        commands.registerCommand('springboot.spring.modulith.metadata.refresh', async () => {
            const modulithProjects: any = await commands.executeCommand('sts/modulith/projects')
            const projectNames: any[] = Object.keys(modulithProjects)
            if (projectNames.length === 0) {
                window.showErrorMessage('No Spring Modulith projects found')
            } else {
                const projectName = projectNames.length === 1 ? projectNames[0] : await window.showQuickPick(
                    projectNames,
                    { placeholder: "Select the target project." },
                )
                if (projectName) {
                    commands.executeCommand('sts/modulith/metadata/refresh', modulithProjects[projectName])
                }
            }
        }),

        commands.registerCommand('springboot.properties.reload', async () => {
            const reloadOutput = await commands.executeCommand("sts/common-properties/reload")
            if (reloadOutput) {
                window.showInformationMessage('Reloading common properties metadata')
            }
        }),
    )
}
