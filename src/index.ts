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
import * as rewrite from './rewrite'
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

export function activate(context: ExtensionContext): Thenable<ExtensionAPI> {
    let options: commons.ActivatorOptions = {
        // explodedLsJarData: {
        //     lsLocation: 'language-server',
        //     configFileName: 'application.properties',
        //     mainClass: 'org.springframework.ide.vscode.boot.app.BootLanguageServerBootApp',
        // },
        extensionId: 'springboot',
        CONNECT_TO_LS: false,
        jvmHeap: '1024m',
        preferJdk: true,
        DEBUG: false,
        vmArgs: [],
        checkjvm: (_, jvm: commons.JVM) => {
            let version = jvm.getMajorVersion()
            if (version < 17) {
                throw Error(`Spring Tools Language Server requires Java 17 or higher to be launched. Current Java version is ${version}`)
            }

            if (!jvm.isJdk()) {
                window.showWarningMessage(
                    'JAVA_HOME or PATH environment variable seems to point to a JRE. A JDK is required, hence Boot Hints are unavailable.',
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
        commands.registerCommand('vscode-spring-boot.ls.start', () => client.start().then(() => {
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

        }))
        commands.registerCommand('vscode-spring-boot.ls.stop', () => client.stop())
        rewrite.activate(client, options, context)
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
                commands.executeCommand('sts/modulith/metadata/refresh', modulithProjects[projectName])
            }
        }),

        commands.registerCommand('springboot.open.url', async (openUrl) => {
            window.showInformationMessage(`Opening ${openUrl} with browser`)
            return workspace.nvim.call('coc#ui#open_url', [openUrl], true)
        }),

        commands.registerCommand('springboot.properties.reload', async () => {
            const relaodOutput = await commands.executeCommand("sts/common-properties/reload")
            if (relaodOutput) {
                window.showInformationMessage('Reloading common properties metadata')
            }
        }),
    )
}
